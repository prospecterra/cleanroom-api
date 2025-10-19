import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { getOpenAIClient } from "@/lib/openai"

// JSON schema for purge analysis
const PurgeAnalysisSchema = {
  type: "object",
  properties: {
    recommendedAction: {
      type: "string",
      enum: ["REMOVE", "KEEP"],
      description: "The recommended action for the company record. REMOVE should only be used for clearly unusable data including: (1) Obvious test data - company names containing 'test', 'testing', 'demo', 'example', 'sample', 'asdf', 'qwerty', 'xxx', 'dummy' or domains like test.com, example.com, localhost, fake.com, demo.com; (2) Completely fake/invalid data - empty/null company names, names that are just numbers or special characters, obviously fabricated data like 'Mickey Mouse Inc', 'Fake Company', 'Delete Me Corp'; (3) Unusable records - no company name AND no domain/website, critical data corruption, clear placeholder entries. KEEP should be used for all legitimate company records, even those with incomplete data, missing fields, or no associated contacts/activities. When in doubt, always recommend KEEP. Custom purge rules take absolute precedence over default criteria when provided."
    },
    reasoning: {
      type: "string",
      description: "A clear, detailed paragraph explaining the reasoning behind the recommendation. For REMOVE recommendations, specify which test/fake data indicators were identified (e.g., test terminology in name, placeholder domains, fabricated data patterns) and why the record has no business value. For KEEP recommendations, explain why the record appears legitimate despite any missing or incomplete data, noting the presence of valid company identifiers (legitimate name, real domain, etc.). The reasoning should reference specific data points from the company record and explain how they led to the recommendation. When custom purge rules are applied, explicitly state which rule criteria were matched and how they override default logic. The reasoning should be substantive enough to justify the action to a human reviewer."
    },
    confidence: {
      type: "string",
      enum: ["LOW", "MEDIUM", "HIGH"],
      description: "The confidence level in the purge recommendation based on clarity of indicators. HIGH: Obvious test/fake data with clear, unambiguous indicators (e.g., company name is 'Test Company Demo' with domain 'example.com', or explicit fabricated data like 'Fake Business Inc') or clear custom rule match. MEDIUM: Some test/fake indicators present but not completely certain (e.g., suspicious patterns like 'XXX Corp' but with some legitimate data, or company name contains test-like words but could be legitimate like 'Testing Services Ltd'). LOW: Unclear or borderline cases where the evidence is ambiguous (e.g., very minimal data but potentially legitimate, unusual naming that could be real or fake). Confidence should reflect both the strength of the indicators and the potential risk of incorrectly removing a legitimate company record."
    }
  },
  required: ["recommendedAction", "reasoning", "confidence"],
  additionalProperties: false
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
    const body = await req.json()
    const { company, purgeRules } = body

    if (!company || typeof company !== "object") {
      return NextResponse.json(
        { error: "Company object is required" },
        { status: 400 }
      )
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

IMPORTANT: These custom purge rules take absolute precedence over all default criteria. If a custom rule applies, follow it exactly, even if it contradicts the default logic above. Always mention in your reasoning when a custom rule was applied.`
    }

    systemPrompt += `\n\nAnalyze the following company record and determine if it should be REMOVED (purged) or KEPT in the CRM system. Provide detailed reasoning for your recommendation.`

    // Prepare company data for analysis
    const companyData = JSON.stringify(company, null, 2)

    // Call OpenAI with structured output
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: "gpt-5-main-mini",
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
      temperature: 0.3,
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
      reasoning: string
      confidence: "LOW" | "MEDIUM" | "HIGH"
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

    return NextResponse.json({
      analysis,
      creditsRemaining: updatedAccess.remaining || 0,
    })
  } catch (error) {
    console.error("Error in purge analysis:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
