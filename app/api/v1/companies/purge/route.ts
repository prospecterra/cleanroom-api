import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { getOpenAIClient } from "@/lib/openai"
import { detectCRMFromHeaders, createCRMClient } from "@/lib/crm"

// JSON schema for purge analysis
const PurgeAnalysisSchema = {
  "type": "object",
  "description": "Evaluate company for CRM purge. BE CONSERVATIVE: only REMOVE obvious test/fake data. KEEP legitimate records even if incomplete.",
  "properties": {
    "recommendedAction": {
      "type": "string",
      "enum": ["REMOVE", "KEEP"],
      "description": "REMOVE if: (1) test names (test/demo/example/sample/dummy/asdf) OR test domains (test.com/example.com/localhost), (2) fake (empty name, numbers-only name, 'Fake Company'), (3) no name AND no domain, (4) custom rule match (if provided). KEEP otherwise. When uncertain, KEEP."
    },
    "reasoning": {
      "type": "string",
      "description": "1 sentence: key factor + confidence justification."
    },
    "confidence": {
      "type": "string",
      "enum": ["LOW", "MEDIUM", "HIGH"],
      "description": "HIGH=clear match, MEDIUM=some ambiguity, LOW=uncertain."
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

    // Build user message with custom rules if provided
    let userMessage = JSON.stringify(company, null, 2)

    if (purgeRules && typeof purgeRules === "string" && purgeRules.trim()) {
      userMessage = `CUSTOM RULES (override defaults): ${purgeRules}\n\n${userMessage}`
    }

    if (purgePropertyRules && typeof purgePropertyRules === "object") {
      const propertyRules = Object.entries(purgePropertyRules)
        .filter(([_, rule]) => typeof rule === "string" && rule.trim())
        .map(([property, rule]) => `${property}: ${rule}`)
        .join(", ")

      if (propertyRules) {
        userMessage = `PROPERTY RULES (override defaults): ${propertyRules}\n\n${userMessage}`
      }
    }

    // Call OpenAI with structured output
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: "gpt-5-nano-2025-08-07",
      reasoning_effort: "low",
      messages: [
        {
          role: "user",
          content: userMessage,
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