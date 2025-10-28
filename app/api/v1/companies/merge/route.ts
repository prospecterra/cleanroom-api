import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { getOpenAIClient } from "@/lib/openai"
import { detectCRMFromHeaders, createCRMClient } from "@/lib/crm"
import { checkRateLimit } from "@/lib/ratelimit"
import {
  validateCompanyObject,
  validateRecordId,
  sanitizeRule,
  sanitizePropertyRules,
  validateContentType,
  sanitizeErrorMessage
} from "@/lib/validation"

// Clean filter values to remove JSON syntax and malformed patterns
function cleanFilterValue(value: string | null): string | null {
  if (!value || typeof value !== 'string') return value

  return value
    .replace(/[{}\[\],"']+$/g, '') // Remove trailing JSON syntax: { } [ ] , " '
    .replace(/[:/?#&=].*$/g, '')    // Remove everything after URL-like chars: : / ? # & =
    .replace(/^https?:\/\//g, '')   // Remove protocol prefix if present
    .trim()
}

// Step 1: Duplicate search filter generation schema (base)
const BASE_DUPLICATE_SEARCH_SCHEMA = {
  "type": "object",
  "description": "Generate HubSpot search filters. Extract clean property values from input - NO JSON syntax chars in values. OR logic between filterGroups, AND within. Max 5 groups. Priority 1=domain; Priority 2=name+city/phone/fuzzy; Priority 3=address+city.",
  "properties": {
    "filterGroups": {
      "type": "array",
      "description": "Filter groups combined with OR logic. Each group is independent duplicate criterion.",
      "items": {
        "type": "object",
        "description": "Single filter group with AND logic between all filters.",
        "properties": {
          "filters": {
            "type": "array",
            "description": "Filters within group (AND logic). Skip null/empty properties.",
            "items": {
              "type": "object",
              "description": "Single filter: property + operator + value. VALUE MUST BE CLEAN STRING.",
              "properties": {
                "propertyName": {
                  "type": "string",
                  "description": "HubSpot property: name/domain/website/phone/city/state/zip/country/address. Lowercase, no spaces."
                },
                "operator": {
                  "type": "string",
                  "description": "EQ=exact match, CONTAINS_TOKEN=fuzzy text, IN=multiple values, HAS_PROPERTY=exists check.",
                  "enum": ["EQ", "NEQ", "LT", "LTE", "GT", "GTE", "BETWEEN", "IN", "NOT_IN", "HAS_PROPERTY", "NOT_HAS_PROPERTY", "CONTAINS_TOKEN"]
                },
                "value": {
                  "type": ["string", "null"],
                  "description": "Extract ONLY the core property value - no extra characters. CORRECT: 'acme.com', 'John Smith', '555-1234'. WRONG: 'acme.com}', 'acme.com:n/a?', 'acme.com:80', 'acme.com/path', 'http://acme.com'. For domains: strip protocol/port/path/query. NO trailing : / ? # & = chars. NO { } [ ] , \" '. Null for HAS_PROPERTY/NOT_HAS_PROPERTY/IN/NOT_IN."
                },
                "values": {
                  "type": ["array", "null"],
                  "description": "Array of strings for IN/NOT_IN operators only. Null otherwise.",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": ["propertyName", "operator", "value", "values"],
              "additionalProperties": false
            }
          }
        },
        "required": ["filters"],
        "additionalProperties": false
      }
    },
    "reasoning": {
      "type": "string",
      "description": "1 sentence: explain duplicate search strategy and key properties used."
    },
    "confidence": {
      "type": "string",
      "description": "HIGH=strong identifiers (domain/phone). MEDIUM=name+location. LOW=weak/generic data.",
      "enum": ["LOW", "MEDIUM", "HIGH"]
    }
  },
  "required": ["filterGroups", "reasoning", "confidence"],
  "additionalProperties": false
}

// Step 2: Merge decision schema (base)
const BASE_MERGE_DECISION_SCHEMA = {
  "type": "object",
  "description": "Decide KEEP vs MERGE for current record. Scoring: completeness 40%, quality 25%, engagement 20%, source 10%, history 5%. TIEBREAKER: oldest created date wins.",
  "properties": {
    "recommendedAction": {
      "type": "string",
      "description": "KEEP=current record stays primary (primaryRecordId=current). MERGE=current merges into primaryRecordId (another duplicate).",
      "enum": ["MERGE", "KEEP"]
    },
    "reasoning": {
      "type": "string",
      "description": "2-3 sentences: (1) Why duplicates/not, (2) Why this primary choice, (3) Key factors. Include relevant dates/scores if using tiebreaker."
    },
    "confidence": {
      "type": "string",
      "description": "HIGH=clear indicators (domain/phone match) + 80%+ overlap. MEDIUM=50-80% overlap + minor conflicts. LOW=weak indicators/conflicts.",
      "enum": ["LOW", "MEDIUM", "HIGH"]
    },
    "primaryRecordId": {
      "type": "string",
      "description": "ID of primary record. Equals current ID if KEEP, duplicate ID if MERGE. TIEBREAKER: when scores within 5pts, select oldest createdate."
    }
  },
  "required": ["recommendedAction", "reasoning", "confidence", "primaryRecordId"],
  "additionalProperties": false
}

// Step 3: Field-by-field merge schema (base)
const BASE_MERGE_FIELD_SCHEMA = {
  "type": "object",
  "description": "Field-level merge analysis. Only update primary with better/newer values from current.",
  "properties": {
    "primaryRecordPropertiesToUpdate": {
      "type": "object",
      "description": "Property map: {propertyName: newValue}. Only include if current > primary. Empty {} if no updates. Example: {\"phone\":\"+1-555-0123\"}.",
      "additionalProperties": {
        "type": "string"
      }
    },
    "reasoning": {
      "type": "string",
      "description": "1-2 sentences: merge strategy + key decisions."
    },
    "confidence": {
      "type": "string",
      "enum": ["LOW", "MEDIUM", "HIGH"],
      "description": "HIGH=clear path, MEDIUM=ambiguity, LOW=uncertain."
    }
  },
  "required": ["reasoning", "confidence"],
  "additionalProperties": false
}

// Schema builder for Step 1: Duplicate search
interface DuplicateSearchInput {
  duplicateRules?: string
}

function buildDuplicateSearchSchema(input: DuplicateSearchInput) {
  const schema = JSON.parse(JSON.stringify(BASE_DUPLICATE_SEARCH_SCHEMA))

  // Add duplicateRules to root description
  if (input.duplicateRules && typeof input.duplicateRules === "string" && input.duplicateRules.trim()) {
    schema.description = `${schema.description} User rules: ${input.duplicateRules}`
  }

  return schema
}

// Schema builder for Step 2: Merge decision
interface MergeDecisionInput {
  primaryRules?: string
}

function buildMergeDecisionSchema(input: MergeDecisionInput) {
  const schema = JSON.parse(JSON.stringify(BASE_MERGE_DECISION_SCHEMA))

  // Add primaryRules to root description
  if (input.primaryRules && typeof input.primaryRules === "string" && input.primaryRules.trim()) {
    schema.description = `${schema.description} User rules: ${input.primaryRules}`
  }

  return schema
}

// Schema builder for Step 3: Field merge
interface MergeFieldInput {
  mergeRules?: string
  mergePropertyRules?: Record<string, string>
}

function buildMergeFieldSchema(input: MergeFieldInput) {
  const schema = JSON.parse(JSON.stringify(BASE_MERGE_FIELD_SCHEMA))

  // Add mergeRules to root description
  if (input.mergeRules && typeof input.mergeRules === "string" && input.mergeRules.trim()) {
    schema.description = `${schema.description} User rules: ${input.mergeRules}`
  }

  // Add mergePropertyRules to primaryRecordPropertiesToUpdate description
  if (input.mergePropertyRules && typeof input.mergePropertyRules === "object") {
    const propertyRules = Object.entries(input.mergePropertyRules)
      .filter(([, rule]) => typeof rule === "string" && rule.trim())
      .map(([property, rule]) => `${property}: ${rule}`)
      .join(", ")

    if (propertyRules) {
      schema.properties.primaryRecordPropertiesToUpdate.description = `${schema.properties.primaryRecordPropertiesToUpdate.description} User property rules: ${propertyRules}`
    }
  }

  return schema
}

export async function POST(req: NextRequest) {
  try {
    // Validate Content-Type
    const contentTypeValidation = validateContentType(req.headers.get('content-type'))
    if (!contentTypeValidation.valid) {
      return NextResponse.json(
        { error: contentTypeValidation.error },
        { status: 400 }
      )
    }

    // Get API key from header
    const apiKey = req.headers.get("x-api-key")

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key required" },
        { status: 401 }
      )
    }

    // Validate API key and get user ID
    const supabase = createServiceClient()

    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from("api_keys")
      .select("id, user_id")
      .eq("key", apiKey)
      .single()

    if (apiKeyError || !apiKeyData) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      )
    }

    const userId = apiKeyData.user_id

    // Check rate limits BEFORE doing anything else
    const rateLimitResult = await checkRateLimit(userId, "merge-endpoint")

    if (!rateLimitResult.allowed) {
      const resetDate = new Date(rateLimitResult.reset!)
      return NextResponse.json(
        {
          error: `Rate limit exceeded (${rateLimitResult.limitType})`,
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          reset: resetDate.toISOString()
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitResult.limit!.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining!.toString(),
            'X-RateLimit-Reset': resetDate.toISOString()
          }
        }
      )
    }

    // Check feature access and credit balance
    const access = await checkFeatureAccess(userId, "api_credits")

    if (!access.allowed) {
      return NextResponse.json(
        { error: "Insufficient credits" },
        { status: 403 }
      )
    }

    // Parse request body
    let body
    try {
      body = await req.json()
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError)
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      )
    }

    const {
      company,
      recordId,
      mergeRecord = false
    } = body

    let duplicateRules = body.duplicateRules
    let primaryRules = body.primaryRules
    let mergeRules = body.mergeRules
    let mergePropertyRules = body.mergePropertyRules

    if (!company || typeof company !== "object") {
      return NextResponse.json(
        { error: "Company object is required" },
        { status: 400 }
      )
    }

    // Validate company object size and content
    const companyValidation = validateCompanyObject(company)
    if (!companyValidation.valid) {
      return NextResponse.json(
        { error: companyValidation.error },
        { status: 400 }
      )
    }

    // Validate recordId
    const recordIdValidation = validateRecordId(recordId)
    if (!recordIdValidation.valid) {
      return NextResponse.json(
        { error: `Invalid recordId: ${recordIdValidation.error}` },
        { status: 400 }
      )
    }

    // Sanitize user rules
    duplicateRules = sanitizeRule(duplicateRules)
    primaryRules = sanitizeRule(primaryRules)
    mergeRules = sanitizeRule(mergeRules)
    mergePropertyRules = sanitizePropertyRules(mergePropertyRules)

    // Detect CRM credentials
    const crmCredentials = detectCRMFromHeaders(req.headers)
    if (!crmCredentials) {
      return NextResponse.json(
        { error: "CRM API key required. Please provide x-hubspot-api-key header." },
        { status: 400 }
      )
    }

    interface AIUsage {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      totalTokens: number
    }

    // Track total AI usage across all steps
    const totalAiUsage: {
      step1DuplicateSearch: AIUsage | null
      step2MergeDecision: AIUsage | null
      step3FieldMerge: AIUsage | null
    } = {
      step1DuplicateSearch: null,
      step2MergeDecision: null,
      step3FieldMerge: null
    }

    // STEP 1: Generate duplicate search filters
    const openai = getOpenAIClient()

    // Build schema with duplicate rules if provided
    const step1Schema = buildDuplicateSearchSchema({ duplicateRules })

    const step1Completion = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      reasoning_effort: "low",
      messages: [
        {
          role: "user",
          content: JSON.stringify(company),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "duplicate_search",
          schema: step1Schema,
          strict: true
        }
      },
      max_completion_tokens: 16000
    })

    const step1Content = step1Completion.choices[0]?.message?.content
    if (!step1Content) {
      return NextResponse.json(
        { error: "Failed to generate duplicate search filters" },
        { status: 500 }
      )
    }

    const duplicateSearch = JSON.parse(step1Content)

    // Clean filter values to remove any JSON syntax characters
    if (duplicateSearch.filterGroups) {
      for (const group of duplicateSearch.filterGroups) {
        if (group.filters) {
          for (const filter of group.filters) {
            if (filter.value) {
              filter.value = cleanFilterValue(filter.value)
            }
          }
        }
      }
    }

    totalAiUsage.step1DuplicateSearch = {
      inputTokens: step1Completion.usage?.prompt_tokens || 0,
      outputTokens: step1Completion.usage?.completion_tokens || 0,
      reasoningTokens: step1Completion.usage?.completion_tokens_details?.reasoning_tokens || 0,
      totalTokens: step1Completion.usage?.total_tokens || 0
    }

    // STEP 2: Search for duplicates in CRM
    // Clean filters: HubSpot requires value and values to be mutually exclusive
    // Remove null values to avoid "mutually exclusive" error
    interface FilterGroup {
      filters: Array<{
        propertyName: string
        operator: string
        value?: string | null
        values?: string[] | null
      }>
    }

    const cleanedFilterGroups = duplicateSearch.filterGroups.map((group: FilterGroup) => ({
      filters: group.filters.map((filter) => {
        const cleanedFilter: Record<string, unknown> = {
          propertyName: filter.propertyName,
          operator: filter.operator
        }
        // Only include value if it's not null
        if (filter.value !== null) {
          cleanedFilter.value = filter.value
        }
        // Only include values if it's not null
        if (filter.values !== null) {
          cleanedFilter.values = filter.values
        }
        return cleanedFilter
      })
    }))

    // Add timeout to HubSpot search call
    const searchController = new AbortController()
    const searchTimeout = setTimeout(() => searchController.abort(), 15000) // 15 second timeout

    let searchResponse
    try {
      searchResponse = await fetch(
        "https://api.hubapi.com/crm/v3/objects/companies/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${crmCredentials.apiKey}`,
          },
          body: JSON.stringify({
            filterGroups: cleanedFilterGroups,
            properties: ["name", "domain", "website", "phone", "city", "state", "zip", "country", "address", "linkedin", "createdate", "hs_lastmodifieddate"],
            limit: 100
          }),
          signal: searchController.signal
        }
      )
    } finally {
      clearTimeout(searchTimeout)
    }

    if (!searchResponse.ok) {
      const error = await searchResponse.text()
      const errorMsg = sanitizeErrorMessage(error, 'merge-crm-search')
      return NextResponse.json(
        { error: errorMsg },
        { status: 500 }
      )
    }

    const searchResults = await searchResponse.json()
    const duplicates = searchResults.results || []

    // Filter out the current record from duplicates
    interface DuplicateRecord {
      id: string
      [key: string]: unknown
    }
    const otherDuplicates = (duplicates as DuplicateRecord[]).filter((dup) => dup.id !== recordId)

    // If no duplicates found (or only found self), return early
    if (otherDuplicates.length === 0) {
      // Track usage (1 credit for the search)
      await trackFeatureUsage(userId, "api_credits", 1)

      await supabase
        .from("api_keys")
        .update({ last_used: new Date().toISOString() })
        .eq("id", apiKeyData.id)

      const updatedAccess = await checkFeatureAccess(userId, "api_credits")

      const inputCost = (totalAiUsage.step1DuplicateSearch.inputTokens / 1_000_000) * 0.30
      const outputCost = (totalAiUsage.step1DuplicateSearch.outputTokens / 1_000_000) * 1.20

      return NextResponse.json({
        company,
        recordId,
        duplicatesFound: false,
        duplicateCount: 0,
        duplicates: [],
        step1DuplicateSearch: {
          filterGroups: duplicateSearch.filterGroups,
          reasoning: duplicateSearch.reasoning,
          confidence: duplicateSearch.confidence
        },
        step2MergeDecision: {
          recommendedAction: "KEEP",
          reasoning: "No duplicate records found in CRM search",
          confidence: "HIGH",
          primaryRecordId: recordId
        },
        duplicateRules: duplicateRules || null,
        primaryRules: primaryRules || null,
        mergeRules: mergeRules || null,
        mergePropertyRules: mergePropertyRules || null,
        creditCost: 1,
        creditsRemaining: updatedAccess.remaining || 0,
        recordMerged: false,
        aiUsage: {
          step1DuplicateSearch: {
            model: "gpt-5-nano-2025-08-07",
            ...totalAiUsage.step1DuplicateSearch,
            costUSD: parseFloat((inputCost + outputCost).toFixed(6))
          }
        },
        jsonSchemas: {
          step1DuplicateSearch: step1Schema
        }
      })
    }

    // STEP 3: Analyze merge decision
    const step2Schema = buildMergeDecisionSchema({ primaryRules })

    const mergeAnalysisInput = {
      currentRecord: { id: recordId, ...company },
      duplicateRecords: otherDuplicates
    }

    const step2Completion = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      reasoning_effort: "low",
      messages: [
        {
          role: "user",
          content: JSON.stringify(mergeAnalysisInput),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "merge_decision",
          schema: step2Schema,
          strict: true
        }
      },
      max_completion_tokens: 16000
    })

    const step2Content = step2Completion.choices[0]?.message?.content
    if (!step2Content) {
      return NextResponse.json(
        { error: "Failed to generate merge decision" },
        { status: 500 }
      )
    }

    const mergeDecision = JSON.parse(step2Content)

    totalAiUsage.step2MergeDecision = {
      inputTokens: step2Completion.usage?.prompt_tokens || 0,
      outputTokens: step2Completion.usage?.completion_tokens || 0,
      reasoningTokens: step2Completion.usage?.completion_tokens_details?.reasoning_tokens || 0,
      totalTokens: step2Completion.usage?.total_tokens || 0
    }

    // If KEEP or primary is current record, return without field merge analysis
    if (mergeDecision.recommendedAction === "KEEP" || mergeDecision.primaryRecordId === recordId) {
      const totalCredits = 2 // Step 1 + Step 2

      await trackFeatureUsage(userId, "api_credits", totalCredits)

      await supabase
        .from("api_keys")
        .update({ last_used: new Date().toISOString() })
        .eq("id", apiKeyData.id)

      const updatedAccess = await checkFeatureAccess(userId, "api_credits")

      return NextResponse.json({
        company,
        recordId,
        duplicatesFound: true,
        duplicateCount: otherDuplicates.length,
        duplicates: otherDuplicates,
        step1DuplicateSearch: {
          filterGroups: duplicateSearch.filterGroups,
          reasoning: duplicateSearch.reasoning,
          confidence: duplicateSearch.confidence
        },
        step2MergeDecision: {
          recommendedAction: mergeDecision.recommendedAction,
          primaryRecordId: mergeDecision.primaryRecordId,
          reasoning: mergeDecision.reasoning,
          confidence: mergeDecision.confidence
        },
        duplicateRules: duplicateRules || null,
        primaryRules: primaryRules || null,
        mergeRules: mergeRules || null,
        mergePropertyRules: mergePropertyRules || null,
        creditCost: totalCredits,
        creditsRemaining: updatedAccess.remaining || 0,
        recordMerged: false,
        aiUsage: {
          step1DuplicateSearch: {
            model: "gpt-5-nano-2025-08-07",
            ...totalAiUsage.step1DuplicateSearch,
            costUSD: parseFloat(((totalAiUsage.step1DuplicateSearch.inputTokens / 1_000_000) * 0.30 + (totalAiUsage.step1DuplicateSearch.outputTokens / 1_000_000) * 1.20).toFixed(6))
          },
          step2MergeDecision: {
            model: "gpt-5-nano-2025-08-07",
            ...totalAiUsage.step2MergeDecision,
            costUSD: parseFloat(((totalAiUsage.step2MergeDecision.inputTokens / 1_000_000) * 0.30 + (totalAiUsage.step2MergeDecision.outputTokens / 1_000_000) * 1.20).toFixed(6))
          }
        },
        jsonSchemas: {
          step1DuplicateSearch: step1Schema,
          step2MergeDecision: step2Schema
        }
      })
    }

    // STEP 4: Field-by-field merge analysis
    // Current record should merge into primaryRecordId - analyze which fields to transfer

    // First, fetch the primary record from CRM
    const crmClient = createCRMClient(crmCredentials)
    const primaryRecord = await crmClient.getCompany(mergeDecision.primaryRecordId)

    // Build schema with merge rules if provided
    const step3Schema = buildMergeFieldSchema({ mergeRules, mergePropertyRules })

    const fieldMergeInput = {
      currentRecord: { id: recordId, ...company },
      primaryRecord: primaryRecord
    }

    const step3Completion = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      reasoning_effort: "low",
      messages: [
        {
          role: "user",
          content: JSON.stringify(fieldMergeInput),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "field_merge",
          schema: step3Schema,
          strict: true
        }
      },
      max_completion_tokens: 16000
    })

    const step3Content = step3Completion.choices[0]?.message?.content
    if (!step3Content) {
      return NextResponse.json(
        { error: "Failed to generate field merge analysis" },
        { status: 500 }
      )
    }

    const fieldMerge = JSON.parse(step3Content)

    totalAiUsage.step3FieldMerge = {
      inputTokens: step3Completion.usage?.prompt_tokens || 0,
      outputTokens: step3Completion.usage?.completion_tokens || 0,
      reasoningTokens: step3Completion.usage?.completion_tokens_details?.reasoning_tokens || 0,
      totalTokens: step3Completion.usage?.total_tokens || 0
    }

    // Track credits for all 3 AI steps
    const totalCredits = 3
    let recordMerged = false
    let recordUpdated = false

    // STEP 5 & 6: Update primary record and merge (only if mergeRecord is true)
    if (mergeRecord) {
      // STEP 5: Update primary record with better properties if any exist
      const propertiesToUpdate = fieldMerge.primaryRecordPropertiesToUpdate || {}

      if (Object.keys(propertiesToUpdate).length > 0) {
        try {
          await crmClient.updateCompany({
            recordId: mergeDecision.primaryRecordId,
            properties: propertiesToUpdate
          })
          recordUpdated = true
        } catch (updateError) {
          const errorMsg = sanitizeErrorMessage(updateError, 'merge-crm-update')
          return NextResponse.json(
            { error: errorMsg },
            { status: 500 }
          )
        }
      }

      // STEP 6: Merge the current record into the primary record
      try {
        // Add timeout to merge call
        const mergeController = new AbortController()
        const mergeTimeout = setTimeout(() => mergeController.abort(), 15000) // 15 second timeout

        let mergeResponse
        try {
          mergeResponse = await fetch(
            "https://api.hubapi.com/crm/v3/objects/companies/merge",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${crmCredentials.apiKey}`,
              },
              body: JSON.stringify({
                primaryObjectId: mergeDecision.primaryRecordId,
                objectIdToMerge: recordId
              }),
              signal: mergeController.signal
            }
          )
        } finally {
          clearTimeout(mergeTimeout)
        }

        if (!mergeResponse.ok) {
          const error = await mergeResponse.text()
          const errorMsg = sanitizeErrorMessage(error, 'merge-crm-merge-response')
          return NextResponse.json(
            { error: errorMsg },
            { status: 500 }
          )
        }

        recordMerged = true
      } catch (mergeError) {
        const errorMsg = sanitizeErrorMessage(mergeError, 'merge-crm-merge')
        return NextResponse.json(
          { error: errorMsg },
          { status: 500 }
        )
      }
    }

    // Track usage and update API key
    await trackFeatureUsage(userId, "api_credits", totalCredits)

    await supabase
      .from("api_keys")
      .update({ last_used: new Date().toISOString() })
      .eq("id", apiKeyData.id)

    const updatedAccess = await checkFeatureAccess(userId, "api_credits")

    // Calculate total costs
    const step1Cost = (totalAiUsage.step1DuplicateSearch.inputTokens / 1_000_000) * 0.30 + (totalAiUsage.step1DuplicateSearch.outputTokens / 1_000_000) * 1.20
    const step2Cost = (totalAiUsage.step2MergeDecision.inputTokens / 1_000_000) * 0.30 + (totalAiUsage.step2MergeDecision.outputTokens / 1_000_000) * 1.20
    const step3Cost = (totalAiUsage.step3FieldMerge.inputTokens / 1_000_000) * 0.30 + (totalAiUsage.step3FieldMerge.outputTokens / 1_000_000) * 1.20

    return NextResponse.json({
      company,
      recordId,
      duplicatesFound: true,
      duplicateCount: otherDuplicates.length,
      duplicates: otherDuplicates,
      step1DuplicateSearch: {
        filterGroups: duplicateSearch.filterGroups,
        reasoning: duplicateSearch.reasoning,
        confidence: duplicateSearch.confidence
      },
      step2MergeDecision: {
        recommendedAction: mergeDecision.recommendedAction,
        primaryRecordId: mergeDecision.primaryRecordId,
        reasoning: mergeDecision.reasoning,
        confidence: mergeDecision.confidence
      },
      step3FieldMerge: {
        primaryRecordPropertiesToUpdate: fieldMerge.primaryRecordPropertiesToUpdate,
        reasoning: fieldMerge.reasoning,
        confidence: fieldMerge.confidence
      },
      duplicateRules: duplicateRules || null,
      primaryRules: primaryRules || null,
      mergeRules: mergeRules || null,
      mergePropertyRules: mergePropertyRules || null,
      mergeRecord,
      recordUpdated,
      recordMerged,
      creditCost: totalCredits,
      creditsRemaining: updatedAccess.remaining || 0,
      aiUsage: {
        step1DuplicateSearch: {
          model: "gpt-5-nano-2025-08-07",
          ...totalAiUsage.step1DuplicateSearch,
          costUSD: parseFloat(step1Cost.toFixed(6))
        },
        step2MergeDecision: {
          model: "gpt-5-nano-2025-08-07",
          ...totalAiUsage.step2MergeDecision,
          costUSD: parseFloat(step2Cost.toFixed(6))
        },
        step3FieldMerge: {
          model: "gpt-5-nano-2025-08-07",
          ...totalAiUsage.step3FieldMerge,
          costUSD: parseFloat(step3Cost.toFixed(6))
        },
        totalCostUSD: parseFloat((step1Cost + step2Cost + step3Cost).toFixed(6))
      },
      jsonSchemas: {
        step1DuplicateSearch: step1Schema,
        step2MergeDecision: step2Schema,
        step3FieldMerge: step3Schema
      }
    })

  } catch (error) {
    console.error("Error in merge analysis:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
