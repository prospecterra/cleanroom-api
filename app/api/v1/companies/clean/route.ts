import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { checkRateLimit } from "@/lib/ratelimit"
import { callOpenAIWithStructuredOutput } from "@/lib/openai"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { detectCRMFromHeaders, createCRMClient } from "@/lib/crm"

// Base JSON schema template for company data cleaning
const BASE_SCHEMA = {
  "type": "object",
  "description": "CRM company data cleaning schema. RULES: (1) Valid data → unchanged. (2) Invalid/poor format + high confidence → correct it. (3) Invalid/test/placeholder + unknown → null. (4) Empty + no info → null. (5) Empty + high confidence → populate. Only provide values with high certainty.",
  "properties": {
    "cleanedCompany": {
      "type": "object",
      "properties": {
        "name": {
          "type": ["string", "null"],
          "description": "Common/trade name. Proper case, no excess whitespace, standardized abbreviations. Test/fake names → null."
        },
        "legalName": {
          "type": ["string", "null"],
          "description": "Official registered name with corporate suffix (Inc., LLC, Ltd., AB, GmbH)."
        },
        "description": {
          "type": ["string", "null"],
          "description": "Brief business description. Proper grammar, professional tone, concise."
        },
        "industry": {
          "type": ["string", "null"],
          "description": "Primary industry/sector. Standard naming conventions (NAICS, SIC)."
        },
        "website": {
          "type": ["string", "null"],
          "description": "Primary URL. Format: https://www.company.com. Add protocol if missing."
        },
        "city": {
          "type": ["string", "null"],
          "description": "HQ city. Proper case, full names, no abbreviations."
        },
        "state": {
          "type": ["string", "null"],
          "description": "State/province/region. US: 2-letter codes (CA, NY). Others: full names."
        },
        "country": {
          "type": ["string", "null"],
          "description": "Country name (United States) or ISO code (US)."
        },
        "postalCode": {
          "type": ["string", "null"],
          "description": "Postal/ZIP code. Country-appropriate format. Invalid → null."
        },
        "phone": {
          "type": ["string", "null"],
          "description": "Primary phone. International format with country code (+1-555-123-4567)."
        },
        "street": {
          "type": ["string", "null"],
          "description": "Street address. Proper case, standardized abbreviations (St., Ave.)."
        },
        "linkedIn": {
          "type": ["string", "null"],
          "description": "LinkedIn company page URL. Format: https://www.linkedin.com/company/name"
        },
        "facebook": {
          "type": ["string", "null"],
          "description": "Facebook page URL. Format: https://www.facebook.com/name"
        },
        "instagram": {
          "type": ["string", "null"],
          "description": "Instagram account URL. Format: https://www.instagram.com/name"
        },
        "twitter": {
          "type": ["string", "null"],
          "description": "Twitter/X account URL. Format: https://twitter.com/name or https://x.com/name"
        }
      },
      "required": ["name", "legalName", "description", "industry", "website", "city", "state", "country", "postalCode", "phone", "street", "linkedIn", "facebook", "instagram", "twitter"],
      "additionalProperties": false
    },
    "reasoning": {
      "type": "object",
      "description": "3-sentence explanations per field: (1) original value/issue, (2) action taken, (3) final result and why correct.",
      "properties": {
        "name": { "type": "string" },
        "legalName": { "type": "string" },
        "description": { "type": "string" },
        "industry": { "type": "string" },
        "website": { "type": "string" },
        "city": { "type": "string" },
        "state": { "type": "string" },
        "country": { "type": "string" },
        "postalCode": { "type": "string" },
        "phone": { "type": "string" },
        "street": { "type": "string" },
        "linkedIn": { "type": "string" },
        "facebook": { "type": "string" },
        "instagram": { "type": "string" },
        "twitter": { "type": "string" }
      },
      "required": ["name", "legalName", "description", "industry", "website", "city", "state", "country", "postalCode", "phone", "street", "linkedIn", "facebook", "instagram", "twitter"],
      "additionalProperties": false
    },
    "confidence": {
      "type": "object",
      "description": "Confidence per field. HIGH=strong evidence, MEDIUM=reasonable certainty, LOW=limited confidence/assumptions.",
      "properties": {
        "name": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "legalName": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "description": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "industry": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "website": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "city": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "state": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "country": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "postalCode": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "phone": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "street": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "linkedIn": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "facebook": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "instagram": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
        "twitter": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] }
      },
      "required": ["name", "legalName", "description", "industry", "website", "city", "state", "country", "postalCode", "phone", "street", "linkedIn", "facebook", "instagram", "twitter"],
      "additionalProperties": false
    }
  },
  "required": ["cleanedCompany", "reasoning", "confidence"],
  "additionalProperties": false
}

interface CompanyInput {
  company: Record<string, unknown>
  cleanRules?: string
  cleanPropertyRules?: Record<string, string>
  updateRecord?: boolean
  recordId?: string
}

function buildDynamicSchema(input: CompanyInput) {
  // Deep clone the base schema
  const schema = JSON.parse(JSON.stringify(BASE_SCHEMA))

  // Update top-level description with cleanRules if provided
  if (input.cleanRules) {
    schema.description = `${schema.description}\n\nIMPORTANT: Always prioritize the user-provided instructions below over the general description above.\n\nUser instructions: ${input.cleanRules}`
  }

  // Add user-specific property rules if provided
  if (input.cleanPropertyRules) {
    for (const [key, userRule] of Object.entries(input.cleanPropertyRules)) {
      // Only add rules for properties that exist in the cleanedCompany properties
      if (schema.properties.cleanedCompany?.properties[key]) {
        const currentDescription = schema.properties.cleanedCompany.properties[key].description
        schema.properties.cleanedCompany.properties[key].description = `${currentDescription}\n\nIMPORTANT: Always prioritize the user-provided instructions below over the general description above.\n\nUser instructions: ${userRule}`
      }
    }
  }

  // For OpenAI strict mode, all properties must be in the required array
  schema.required = Object.keys(schema.properties)

  return schema
}

export async function POST(req: NextRequest) {
  let userId: string | undefined

  try {
    // Get API key from header
    const apiKey = req.headers.get("x-api-key")

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 401 }
      )
    }

    // Parse request body
    let body: CompanyInput
    try {
      body = await req.json() as CompanyInput
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      )
    }

    // Validate request body structure
    if (!body.company || typeof body.company !== 'object') {
      return NextResponse.json(
        { error: "Request body must include a 'company' object" },
        { status: 400 }
      )
    }

    // Check that at least one company property is provided
    const companyKeys = Object.keys(body.company)
    if (companyKeys.length === 0) {
      return NextResponse.json(
        { error: "Company object must contain at least one property" },
        { status: 400 }
      )
    }

    // Validate API key and get user using service role (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { data: keyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select('id, user_id')
      .eq('key', apiKey)
      .single()

    if (keyError || !keyRecord) {
      console.error('API key validation error:', keyError)
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      )
    }

    userId = keyRecord.user_id

    // Check rate limits BEFORE doing anything else
    const rateLimitResult = await checkRateLimit(userId, "clean-endpoint")

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

    // Check feature access with Autumn
    const featureAccess = await checkFeatureAccess(userId, "api_credits")

    if (!featureAccess.allowed) {
      return NextResponse.json(
        {
          error: "Insufficient credits. Please purchase more credits to continue using the API.",
          remaining: featureAccess.remaining || 0,
          limit: featureAccess.limit
        },
        { status: 402 }
      )
    }

    // Build the dynamic schema based on input
    const dynamicSchema = buildDynamicSchema(body)

    // Call OpenAI with structured output
    let cleanedData
    try {
      cleanedData = await callOpenAIWithStructuredOutput(body.company, dynamicSchema)
    } catch (openaiError) {
      console.error("OpenAI error:", openaiError)
      const details = openaiError instanceof Error ? openaiError.message : "Unknown error"

      return NextResponse.json(
        { error: "Failed to process company data", details },
        { status: 500 }
      )
    }

    // CRM Integration - Update record if requested
    let crmUpdateStatus: { success: boolean; error?: string } | undefined
    if (body.updateRecord && body.recordId) {
      const crmCredentials = detectCRMFromHeaders(req.headers)

      if (crmCredentials) {
        try {
          const crmClient = createCRMClient(crmCredentials)

          // Extract cleaned properties from OpenAI response
          const properties: Record<string, any> = {}
          if (cleanedData.cleanedCompany && typeof cleanedData.cleanedCompany === 'object') {
            for (const [key, value] of Object.entries(cleanedData.cleanedCompany)) {
              // Only include non-null values
              if (value !== null) {
                properties[key] = value
              }
            }
          }

          // Update CRM record
          await crmClient.updateCompany({
            recordId: body.recordId,
            properties
          })

          crmUpdateStatus = { success: true }
        } catch (crmError) {
          console.error("CRM update error:", crmError)
          const errorMessage = crmError instanceof Error ? crmError.message : "Unknown CRM error"
          crmUpdateStatus = { success: false, error: errorMessage }
          // Don't fail the whole request if CRM update fails
        }
      } else {
        crmUpdateStatus = {
          success: false,
          error: "No CRM credentials provided in headers (e.g., x-hubspot-api-key)"
        }
      }
    }

    // Success! Track usage with Autumn
    try {
      await trackFeatureUsage(userId, "api_credits", 1)
    } catch (trackError) {
      console.error("Failed to track usage with Autumn:", trackError)
      return NextResponse.json(
        { error: "Failed to track credit usage" },
        { status: 500 }
      )
    }

    // Update API key last used
    await supabase
      .from('api_keys')
      .update({ last_used: new Date().toISOString() })
      .eq('id', keyRecord.id)

    return NextResponse.json({
      company: body.company,
      ...cleanedData,
      cleanRules: body.cleanRules || null,
      cleanPropertyRules: body.cleanPropertyRules || null,
      creditCost: 1,
      creditsRemaining: featureAccess.remaining ? featureAccess.remaining - 1 : 0,
      recordUpdated: crmUpdateStatus?.success === true,
      ...(crmUpdateStatus && { crmUpdate: crmUpdateStatus })
    })

  } catch (error) {
    console.error("API error:", error)

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
