import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { getOpenAIClient } from "@/lib/openai"
import { detectCRMFromHeaders, createCRMClient } from "@/lib/crm"

// Clean filter values to remove JSON syntax characters that AI sometimes includes
function cleanFilterValue(value: string | null): string | null {
  if (!value || typeof value !== 'string') return value
  // Remove JSON syntax characters: {, }, [, ], ,, ", '
  return value.replace(/[{}\[\],"']+$/g, '').trim()
}

// Step 1: Duplicate search filter generation schema
const DUPLICATE_SEARCH_SCHEMA = {
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
                  "description": "Clean value only. CORRECT: 'acme.com'. WRONG: 'acme.com}' or 'acme.com}]},{'. Stop at property value end. No { } [ ] , \" ' characters. Strip http/https. Null for HAS_PROPERTY/NOT_HAS_PROPERTY/IN/NOT_IN."
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
    }
  },
  "required": ["filterGroups"],
  "additionalProperties": false
}

// Step 2: Merge decision schema
const MERGE_DECISION_SCHEMA = {
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

// Step 3: Field-by-field merge schema
const MERGE_FIELD_SCHEMA = {
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

export async function POST(req: NextRequest) {
  try {
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
      duplicateRules,
      primaryRules,
      mergeRules,
      mergePropertyRules,
      mergeRecord = false
    } = body

    if (!company || typeof company !== "object") {
      return NextResponse.json(
        { error: "Company object is required" },
        { status: 400 }
      )
    }

    if (!recordId || typeof recordId !== "string" || !recordId.trim()) {
      return NextResponse.json(
        { error: "recordId is required" },
        { status: 400 }
      )
    }

    // Detect CRM credentials
    const crmCredentials = detectCRMFromHeaders(req.headers)
    if (!crmCredentials) {
      return NextResponse.json(
        { error: "CRM API key required. Please provide x-hubspot-api-key header." },
        { status: 400 }
      )
    }

    // Track total AI usage across all steps
    const totalAiUsage = {
      step1DuplicateSearch: null as any,
      step2MergeDecision: null as any,
      step3FieldMerge: null as any
    }

    // STEP 1: Generate duplicate search filters
    const openai = getOpenAIClient()

    // Build schema with duplicate rules if provided
    const step1Schema = JSON.parse(JSON.stringify(DUPLICATE_SEARCH_SCHEMA))
    if (duplicateRules && typeof duplicateRules === "string" && duplicateRules.trim()) {
      step1Schema.description = `${step1Schema.description} User duplicate rules: ${duplicateRules}`
    }

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
    const cleanedFilterGroups = duplicateSearch.filterGroups.map((group: any) => ({
      filters: group.filters.map((filter: any) => {
        const cleanedFilter: any = {
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

    const searchResponse = await fetch(
      "https://api.hubapi.com/crm/v3/objects/companies/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${crmCredentials.apiKey}`,
        },
        body: JSON.stringify({
          filterGroups: cleanedFilterGroups,
          properties: ["name", "domain", "website", "phone", "city", "state", "zip", "country", "address", "linkedin", "createdate"],
          limit: 100
        }),
      }
    )

    if (!searchResponse.ok) {
      const error = await searchResponse.text()
      return NextResponse.json(
        { error: `CRM search failed: ${error}` },
        { status: 500 }
      )
    }

    const searchResults = await searchResponse.json()
    const duplicates = searchResults.results || []

    // Filter out the current record from duplicates
    const otherDuplicates = duplicates.filter((dup: any) => dup.id !== recordId)

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
        searchFilters: duplicateSearch.filterGroups,
        recommendedAction: "KEEP",
        reasoning: "No duplicate records found in CRM search",
        confidence: "HIGH",
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
    const step2Schema = JSON.parse(JSON.stringify(MERGE_DECISION_SCHEMA))
    if (primaryRules && typeof primaryRules === "string" && primaryRules.trim()) {
      step2Schema.description = `${step2Schema.description} User primary record selection rules: ${primaryRules}`
    }

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
        searchFilters: duplicateSearch.filterGroups,
        ...mergeDecision,
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
    const step3Schema = JSON.parse(JSON.stringify(MERGE_FIELD_SCHEMA))
    if (mergeRules && typeof mergeRules === "string" && mergeRules.trim()) {
      step3Schema.description = `${step3Schema.description} User merge rules: ${mergeRules}`
    }
    if (mergePropertyRules && typeof mergePropertyRules === "object") {
      const propertyRules = Object.entries(mergePropertyRules)
        .filter(([_, rule]) => typeof rule === "string" && rule.trim())
        .map(([property, rule]) => `${property}: ${rule}`)
        .join(", ")

      if (propertyRules) {
        step3Schema.properties.primaryRecordPropertiesToUpdate.description = `${step3Schema.properties.primaryRecordPropertiesToUpdate.description} User property rules: ${propertyRules}`
      }
    }

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
          console.error("CRM update error:", updateError)
          const errorMessage = updateError instanceof Error ? updateError.message : "Unknown CRM error"

          return NextResponse.json(
            { error: `Failed to update primary record in CRM: ${errorMessage}` },
            { status: 500 }
          )
        }
      }

      // STEP 6: Merge the current record into the primary record
      try {
        const mergeResponse = await fetch(
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
          }
        )

        if (!mergeResponse.ok) {
          const error = await mergeResponse.text()
          return NextResponse.json(
            { error: `CRM merge failed: ${error}` },
            { status: 500 }
          )
        }

        recordMerged = true
      } catch (mergeError) {
        console.error("CRM merge error:", mergeError)
        const errorMessage = mergeError instanceof Error ? mergeError.message : "Unknown CRM error"

        return NextResponse.json(
          { error: `Failed to merge records in CRM: ${errorMessage}` },
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
      searchFilters: duplicateSearch.filterGroups,
      ...mergeDecision,
      fieldMergeAnalysis: fieldMerge,
      primaryRecordPropertiesToUpdate: fieldMerge.primaryRecordPropertiesToUpdate,
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
