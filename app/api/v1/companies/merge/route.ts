import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { getOpenAIClient } from "@/lib/openai"
import { detectCRMFromHeaders, createCRMClient } from "@/lib/crm"

// Step 1: Duplicate search filter generation schema
const DUPLICATE_SEARCH_SCHEMA = {
  "type": "object",
  "description": "Schema for CRM company duplicate detection search filters (Part 1 of merge process). This structure generates HubSpot API v3 Company Search filters to identify potential duplicate companies based on provided duplicate rules or best practice detection strategies. The output defines search criteria that will be executed against the CRM to find companies matching specific property combinations. Multiple filterGroups are combined with OR logic (any group can match), while multiple filters within a filterGroup are combined with AND logic (all filters must match). When duplicateRules are not provided, the system intelligently applies best practice duplicate detection based on available data: Priority 1 (strongest) - same domain, or same name AND website/domain; Priority 2 (medium) - same name AND city, same phone, or fuzzy name matching; Priority 3 (weak) - same address AND city, or same website alone. IMPORTANT: Max 5 filter groups are allowed.",
  "properties": {
    "filterGroups": {
      "type": "array",
      "description": "An array of filter groups where each group represents a distinct set of conditions for identifying potential duplicates. Multiple filterGroups are combined with OR logic, meaning a company matches if it satisfies ANY of the filter groups. For example, a company could be considered a duplicate if it has the same domain (filterGroup 1) OR the same phone number (filterGroup 2). Each filterGroup should represent a complete, independent criterion for duplicate detection. Use multiple filterGroups to implement 'OR' logic between different duplicate detection strategies.",
      "items": {
        "type": "object",
        "description": "A single filter group containing one or more filters that work together. All filters within a filterGroup are combined with AND logic, meaning a company must match ALL filters in the group to be considered a potential duplicate. For example, to find companies with the same name AND city, both filters would be in a single filterGroup. Use multiple filters in a group to implement 'AND' logic for compound matching criteria.",
        "properties": {
          "filters": {
            "type": "array",
            "description": "An array of individual filter conditions that define the search criteria for this filter group. Each filter specifies a property to check, an operator for comparison, and a value to match against. All filters in this array must be satisfied (AND logic) for a company to match this filterGroup. Common duplicate detection patterns include: exact matches using EQ operator for properties like domain, name, or phone; fuzzy matches using CONTAINS_TOKEN for similar company names; compound matches combining multiple properties like name + city or name + website. Skip filters for properties that are null, empty, or missing in the input company record.",
            "items": {
              "type": "object",
              "description": "A single filter condition that specifies a property-based search criterion. Defines which company property to search on (propertyName), how to compare it (operator), and what value(s) to compare against (value or values). This represents one atomic condition in the duplicate detection logic, such as 'domain equals acme.com' or 'name contains token Microsoft'. When constructing filters, always use exact HubSpot property names (e.g., 'name', 'domain', 'website', 'phone', 'city', 'state', 'zip', 'country') and select operators appropriate for the property type and matching strategy.",
              "properties": {
                "propertyName": {
                  "type": "string",
                  "description": "The exact HubSpot company property name to filter on. Must use standard HubSpot property names such as: 'name' (company name), 'domain' (primary domain), 'website' (website URL), 'phone' (phone number), 'address' (street address), 'city' (city), 'state' (state/region), 'zip' (postal code), 'country' (country), 'industry' (industry), 'numberofemployees' (employee count), 'annualrevenue' (annual revenue). For custom properties, use the exact internal property name as it appears in HubSpot. Property names are typically lowercase with no spaces. This field determines which company attribute will be used for duplicate matching in this filter condition."
                },
                "operator": {
                  "type": "string",
                  "description": "The comparison operator that defines how to match the property value. Select the appropriate operator based on the duplicate detection strategy: EQ (equals) - exact match, most common for duplicate detection on domain, phone, or specific values; CONTAINS_TOKEN - partial/fuzzy match for text fields like company names, useful for matching 'Microsoft' in 'Microsoft Corporation'; NEQ (not equals) - exclude specific values; LT/LTE/GT/GTE - numeric comparisons for ranges; BETWEEN - range matching requiring highValue; IN/NOT_IN - match against multiple values using values array; HAS_PROPERTY/NOT_HAS_PROPERTY - check property existence. For most duplicate detection use cases, EQ (exact match) and CONTAINS_TOKEN (fuzzy match) are the primary operators.",
                  "enum": [
                    "EQ",
                    "NEQ",
                    "LT",
                    "LTE",
                    "GT",
                    "GTE",
                    "BETWEEN",
                    "IN",
                    "NOT_IN",
                    "HAS_PROPERTY",
                    "NOT_HAS_PROPERTY",
                    "CONTAINS_TOKEN"
                  ]
                },
                "value": {
                  "type": ["string", "null"],
                  "description": "The value to compare against for this filter condition. This should be extracted from the input company record for the corresponding propertyName. For example, if propertyName is 'domain' and the input company has domain 'acme.com', then value should be 'acme.com'. Use null when using operators that don't require a single value (like HAS_PROPERTY, NOT_HAS_PROPERTY) or when using the values array for IN/NOT_IN operators. For website/domain properties, extract just the domain portion without protocol or paths. For fuzzy matching with CONTAINS_TOKEN, extract the core/significant part of the text (e.g., 'Microsoft' from 'Microsoft Corporation'). Do not include filters for properties where the input company record has null, empty, or missing values."
                },
                "values": {
                  "type": ["array", "null"],
                  "description": "An array of values to compare against, used exclusively with IN and NOT_IN operators for matching against multiple possible values. For example, to find companies matching any of several domains, use IN operator with values array containing all domains. Use null for single-value operators (EQ, CONTAINS_TOKEN, etc.) where the 'value' field should be used instead. This is useful for duplicate detection scenarios where a company might match multiple variations (e.g., different phone number formats, multiple domain variations, or various name spellings). Each item in the array should be a string value to match against.",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "propertyName",
                "operator",
                "value",
                "values"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "filters"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "filterGroups"
  ],
  "additionalProperties": false
}

// Step 2: Merge decision schema
const MERGE_DECISION_SCHEMA = {
  "type": "object",
  "description": "Schema for CRM company duplicate merge analysis (Part 2 of merge process). This structure determines whether the current company record being analyzed should remain as the primary record (KEEP) or be merged into another duplicate record (MERGE), and identifies which record should serve as the master/primary record. The decision is based on duplicate validation followed by primary record selection using either custom primaryRules or industry-standard CRM best practices. Best practices evaluate records using a weighted scoring system: Data Completeness (40%), Data Quality (25%), Engagement Score (20%), Source Reliability (10%), and Historical Preservation (5%). IMPORTANT TIEBREAKER RULE: When two or more records are essentially equivalent in quality, completeness, and engagement (scores within 5 points of each other), the record with the earliest created date should be selected as the primary record to preserve historical relationship data and maintain consistency. The recommendedAction describes what happens to the CURRENT record being analyzed: KEEP means this record remains primary, MERGE means this record should be merged INTO the primaryRecordId record.",
  "properties": {
    "recommendedAction": {
      "type": "string",
      "description": "The recommended action for the current company record being analyzed, automatically determined based on which record is selected as primary. Use KEEP when the current record should remain as the primary/master record (primaryRecordId equals the input company ID). Use MERGE when the current record should be merged INTO another duplicate record (primaryRecordId is one of the duplicate record IDs). The action ensures no data loss occurs during the merge, with all unique information from the current record being preserved in the primary record. This decision considers data preservation, relationship integrity (associated contacts, deals, activities), conflicting data between records, and real-world business scenarios like subsidiaries, acquisitions, or franchises that may appear similar but should remain separate.",
      "enum": [
        "MERGE",
        "KEEP"
      ]
    },
    "reasoning": {
      "type": "string",
      "description": "A detailed, comprehensive explanation of the merge recommendation that justifies the decision to a human reviewer. For MERGE recommendations, explain: (1) Why the records are confirmed duplicates, (2) Why the primary record is superior, (3) What will happen. For KEEP recommendations, explain: (1) Why the current record is the best choice, (2) Why it is better than duplicates, (3) Conclusion. For non-duplicates kept separate, explain why they are different entities. When using default best practices, reference the scoring system explicitly. When records are essentially equivalent in quality and the tiebreaker rule is applied, explicitly state that the oldest record (earliest created date) was selected to preserve historical relationship data. Include relevant data points, timestamps, source types, and any conflicts or special considerations. The reasoning should provide sufficient detail to understand and validate the decision without requiring access to the raw data."
    },
    "confidence": {
      "type": "string",
      "description": "The confidence level in the merge recommendation based on the strength of duplicate indicators and clarity of the primary selection. HIGH confidence: Clear duplicate indicators present (same domain, tax ID, or phone number) AND significant data overlap (over 80% matching fields) AND no conflicting critical information AND clear primary record selection based on rules or obvious data superiority. MEDIUM confidence: Good duplicate indicators but with some differences AND moderate data overlap (50-80% matching) AND minor conflicts in non-critical fields AND primary selection involves trade-offs. LOW confidence: Weak duplicate indicators (only name similarity or location match) OR limited data overlap (less than 50% matching) OR conflicts in important fields OR unclear if records represent truly the same entity OR difficult primary selection with no clear winner. Confidence should reflect both the certainty that records are duplicates AND the certainty about which should be primary.",
      "enum": [
        "LOW",
        "MEDIUM",
        "HIGH"
      ]
    },
    "primaryRecordId": {
      "type": "string",
      "description": "The unique identifier of the record that should be preserved as the primary/master record after the merge operation. This is ALWAYS included in the response regardless of the recommendedAction. When recommendedAction is KEEP, this will equal the input company ID (indicating the current record is best). When recommendedAction is MERGE, this will be the ID of one of the duplicate records (indicating that record is superior and the current record should merge into it). The primary record is selected based on either custom primaryRules (when provided) or industry-standard CRM best practices that evaluate: data completeness, data quality, engagement level, source reliability, and historical preservation. CRITICAL TIEBREAKER: When multiple records have essentially equivalent scores (within 5 points of each other) across all evaluation criteria, the record with the earliest created date (oldest record) must be selected as the primary record. This preserves the longest relationship history and maintains data continuity. In cases of uncertainty or non-duplicate records, this should be the current company ID with a KEEP action and LOW confidence, recommending manual review."
    }
  },
  "required": [
    "recommendedAction",
    "reasoning",
    "confidence",
    "primaryRecordId"
  ],
  "additionalProperties": false
}

// Step 3: Field-by-field merge schema
const MERGE_FIELD_SCHEMA = {
  "type": "object",
  "description": "Schema for CRM company field-by-field merge analysis (Part 3 of merge process). Evaluates each property from the current record to determine if it should be added/updated to the primary record. Analyzes value, quality, and relevance to ensure best data is preserved. Only properties that improve the primary record should be recommended for update.",
  "properties": {
    "primaryRecordPropertiesToUpdate": {
      "type": "object",
      "description": "Properties from current record to merge into primary, mapped as property name to new value. Only include where current has better/newer data than primary. Example: {'phone': '+1-555-0123', 'website': 'https://newcompany.com'}. Empty object if no updates needed.",
      "additionalProperties": {
        "type": "string"
      }
    },
    "reasoning": {
      "type": "string",
      "description": "1-2 sentence merge strategy and key property decisions."
    },
    "confidence": {
      "type": "string",
      "enum": ["LOW", "MEDIUM", "HIGH"],
      "description": "HIGH=clear merge path, MEDIUM=some ambiguity, LOW=uncertain."
    }
  },
  "required": ["primaryRecordPropertiesToUpdate", "reasoning", "confidence"],
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
          content: JSON.stringify(company, null, 2),
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

    totalAiUsage.step1DuplicateSearch = {
      inputTokens: step1Completion.usage?.prompt_tokens || 0,
      outputTokens: step1Completion.usage?.completion_tokens || 0,
      reasoningTokens: step1Completion.usage?.completion_tokens_details?.reasoning_tokens || 0,
      totalTokens: step1Completion.usage?.total_tokens || 0
    }

    // STEP 2: Search for duplicates in CRM
    const searchResponse = await fetch(
      "https://api.hubapi.com/crm/v3/objects/companies/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${crmCredentials.apiKey}`,
        },
        body: JSON.stringify({
          filterGroups: duplicateSearch.filterGroups,
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
          content: JSON.stringify(mergeAnalysisInput, null, 2),
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
          content: JSON.stringify(fieldMergeInput, null, 2),
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
