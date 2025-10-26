import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { getOpenAIClient } from "@/lib/openai"
import { detectCRMFromHeaders, createCRMClient } from "@/lib/crm"

// JSON schema for purge analysis
const PurgeAnalysisSchema = {
  "type": "object",
  "description": "CRM company purge evaluation. INPUT: (1) company object with data to evaluate, (2) purgeRules string with general removal criteria, (3) purgePropertyRules object mapping properties to specific removal criteria. OUTPUT: Recommendation to REMOVE or KEEP based on rule evaluation.",
  "properties": {
    "recommendedAction": {
      "type": "string",
      "enum": ["REMOVE", "KEEP"],
      "description": "Recommendation based on: DEFAULT CRITERIA (auto-applied): test data (names with test/demo/example/sample/asdf/dummy, domains like test.com/example.com/localhost); fake data (empty names, numbers-only names, 'Fake Company'/'Mickey Mouse Inc'); unusable records (no name AND no domain, severe corruption). CUSTOM RULES (override defaults): purgeRules for general conditions (e.g., '≤100 employees', 'no activity 365+ days'); purgePropertyRules for field-specific conditions (e.g., {website: 'remove .se', industry: 'remove if null'}). PRECEDENCE: Custom rules always override defaults. GUIDANCE: REMOVE only if default criteria met (no custom rules) OR custom rule matched. KEEP for legitimate records (even incomplete), any uncertainty. Be conservative—when doubtful, KEEP."
    },
    "reasoning": {
      "type": "string",
      "description": "3-sentence explanation: (1) which criteria/rules were evaluated, (2) why REMOVE or KEEP was chosen, (3) key factors in the decision."
    },
    "confidence": {
      "type": "string",
      "enum": ["LOW", "MEDIUM", "HIGH"],
      "description": "Confidence in recommendation. HIGH=clear rule match or obvious test data, MEDIUM=reasonable certainty with some ambiguity, LOW=uncertain/borderline case."
    }
  },
  "required": ["recommendedAction", "reasoning", "confidence"],
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

    // Validate API key and get user ID using service role client (bypasses RLS)
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
      purgeRules,
      purgePropertyRules,
      deleteRecord = false,
      recordId
    } = body

    if (!company || typeof company !== "object") {
      return NextResponse.json(
        { error: "Company object is required" },
        { status: 400 }
      )
    }

    // Validate CRM integration requirements BEFORE calling AI
    if (deleteRecord) {
      if (!recordId || typeof recordId !== "string" || !recordId.trim()) {
        return NextResponse.json(
          { error: "recordId is required when deleteRecord is true" },
          { status: 400 }
        )
      }

      const crmCredentials = detectCRMFromHeaders(req.headers)
      if (!crmCredentials) {
        return NextResponse.json(
          { error: "CRM API key required when deleteRecord is true. Please provide x-hubspot-api-key header." },
          { status: 400 }
        )
      }

      // Verify the record exists in the CRM before calling AI
      try {
        const crmClient = createCRMClient(crmCredentials)
        const exists = await crmClient.companyExists(recordId)

        if (!exists) {
          return NextResponse.json(
            { error: `Company record with ID '${recordId}' not found in CRM` },
            { status: 404 }
          )
        }
      } catch (verifyError) {
        console.error("Error verifying company record:", verifyError)
        return NextResponse.json(
          { error: "Failed to verify company record in CRM" },
          { status: 500 }
        )
      }
    }

    // Build system prompt
    let systemPrompt = `You are a CRM data quality expert specializing in identifying and recommending removal of fake, test, example, or demo data that pollutes CRM systems.

Your primary goal is to detect clearly unusable data for removal while preserving ALL legitimate company records, even those with incomplete data.

CRITICAL: When analyzing company records, you must be CONSERVATIVE. Only recommend REMOVE for records that are CLEARLY test/fake/unusable data. When in doubt, ALWAYS recommend KEEP.

Test/Fake Data Indicators (warrant REMOVE):
1. Obvious test terminology: Names containing "test", "testing", "demo", "example", "sample", "asdf", "qwerty", "xxx", "dummy"
2. Test domains: example.com, test.com, localhost, fake.com, demo.com, etc.
3. Completely fake data: "Mickey Mouse Inc", "Fake Company", "Delete Me Corp", "XXXX", "123456"
4. Critical missing data: No company name AND no domain/website
5. Placeholder patterns: Names that are just numbers, special characters, or keyboard mashing

Legitimate Data (should be KEEP):
- Real company names, even if unfamiliar or unusual
- Companies with missing or incomplete data (missing contacts, activities, address, etc.)
- Small businesses or startups with minimal information
- Companies with unusual but legitimate names
- Records with at least one valid identifier (real name OR real domain)

When in doubt between REMOVE and KEEP, choose KEEP. It's better to keep a questionable record than to accidentally delete a legitimate company.`

    // Add custom purge rules if provided
    if (purgeRules && typeof purgeRules === "string" && purgeRules.trim()) {
      systemPrompt += `\n\nCUSTOM PURGE RULES (ABSOLUTE PRIORITY - OVERRIDE DEFAULT LOGIC):
${purgeRules}

IMPORTANT: These custom purge rules take absolute precedence over all default criteria. If a custom rule applies, follow it exactly, even if it contradicts the default logic above.`
    }

    // Add custom property-specific purge rules if provided
    if (purgePropertyRules && typeof purgePropertyRules === "object") {
      systemPrompt += `\n\nCUSTOM PROPERTY-SPECIFIC PURGE RULES (ABSOLUTE PRIORITY - OVERRIDE DEFAULT LOGIC):`

      for (const [property, rule] of Object.entries(purgePropertyRules)) {
        if (typeof rule === "string" && rule.trim()) {
          systemPrompt += `\n- Property '${property}': ${rule}`
        }
      }

      systemPrompt += `\n\nIMPORTANT: These property-specific purge rules take absolute precedence over all default criteria. If any property-specific rule applies, follow it exactly, even if it contradicts the default logic above.`
    }

    systemPrompt += `\n\nAnalyze the following company record and determine if it should be REMOVED (purged) or KEPT in the CRM system.`

    // Prepare company data for analysis
    const companyData = JSON.stringify(company, null, 2)

    // Call OpenAI with structured output
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Analyze this company record:\n\n${companyData}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "purge_analysis",
          schema: PurgeAnalysisSchema,
          strict: true
        }
      },
      max_completion_tokens: 16000
    })

    const responseContent = completion.choices[0]?.message?.content
    if (!responseContent) {
      return NextResponse.json(
        { error: "Failed to generate purge analysis" },
        { status: 500 }
      )
    }

    const analysis = JSON.parse(responseContent) as {
      recommendedAction: "REMOVE" | "KEEP"
    }

    // Extract token usage information
    const tokenUsage = {
      inputTokens: completion.usage?.prompt_tokens || 0,
      outputTokens: completion.usage?.completion_tokens || 0,
      reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens || 0,
      totalTokens: completion.usage?.total_tokens || 0
    }

    // CRM Integration - Delete record if requested and recommended
    let recordDeleted = false
    if (deleteRecord && recordId && analysis.recommendedAction === "REMOVE") {
      const crmCredentials = detectCRMFromHeaders(req.headers)

      if (crmCredentials) {
        try {
          const crmClient = createCRMClient(crmCredentials)

          // Delete CRM record
          await crmClient.deleteCompany({
            recordId: recordId
          })

          recordDeleted = true
        } catch (crmError) {
          console.error("CRM deletion error:", crmError)
          const errorMessage = crmError instanceof Error ? crmError.message : "Unknown CRM error"

          return NextResponse.json(
            { error: `Failed to delete record from CRM: ${errorMessage}` },
            { status: 500 }
          )
        }
      }
    }

    // Track usage (deduct 1 credit)
    await trackFeatureUsage(userId, "api_credits", 1)

    // Update last_used timestamp for API key
    await supabase
      .from("api_keys")
      .update({ last_used: new Date().toISOString() })
      .eq("id", apiKeyData.id)

    // Get updated credit balance
    const updatedAccess = await checkFeatureAccess(userId, "api_credits")

    // Calculate OpenAI costs for gpt-5-nano-2025-08-07
    // Pricing: $0.30 per 1M input tokens, $1.20 per 1M output tokens
    const inputCost = (tokenUsage.inputTokens / 1_000_000) * 0.30
    const outputCost = (tokenUsage.outputTokens / 1_000_000) * 1.20
    const totalCost = inputCost + outputCost

    return NextResponse.json({
      company,
      ...analysis,
      purgeRules: purgeRules || null,
      purgePropertyRules: purgePropertyRules || null,
      recordId: recordId || null,
      creditCost: 1,
      creditsRemaining: updatedAccess.remaining || 0,
      recordDeleted,
      aiUsage: {
        model: "gpt-5-nano-2025-08-07",
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        reasoningTokens: tokenUsage.reasoningTokens,
        totalTokens: tokenUsage.totalTokens,
        costUSD: parseFloat(totalCost.toFixed(6))
      }
    })
  } catch (error) {
    console.error("Error in purge analysis:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}