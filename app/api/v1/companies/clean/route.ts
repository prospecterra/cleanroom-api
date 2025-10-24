import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { checkRateLimit } from "@/lib/ratelimit"
import { callOpenAIWithStructuredOutput } from "@/lib/openai"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"
import { detectCRMFromHeaders, createCRMClient } from "@/lib/crm"

// Base JSON schema template for company data cleaning
const BASE_SCHEMA = {
  "type": "object",
  "description": "Schema for CRM company data cleaning to standardize and improve data quality for company identification, location, and digital presence properties. CLEANING GUIDELINES: (1) If input data is correct and properly formatted, return it unchanged in the cleaned output. (2) If input data is incorrect, invalid, or poorly formatted AND you are highly confident of the correct value, return the corrected value in the cleaned output. (3) If input data is incorrect, invalid, or test/placeholder data AND you do not know the correct value, return null in the cleaned output. (4) If input data is empty/null AND you do not have sufficient information to populate it, return null in the cleaned output. (5) If input data is empty/null AND you are highly confident of the correct value based on other available context, return the correct value in the cleaned output. CONFIDENCE REQUIREMENT: Only provide corrected or populated values when you have high certainty - when in doubt, preserve existing valid data or return null rather than making uncertain assumptions.",
  "properties": {
    "cleanedCompany": {
      "type": "object",
      "description": "Object containing all cleaned company data fields",
      "properties": {
        "name": {
          "type": ["string", "null"],
          "description": "The cleaned common or trade name of the company. Cleaned for proper case formatting, excessive whitespace removal, and standardization of common abbreviations while preserving intentional stylization (e.g., 'eBay', 'iPhone'). Test or fake company names (e.g., 'Test Company', 'Demo Inc', 'Fake Company Name Inc.') are identified and removed (set to null)."
        },
        "legalName": {
          "type": ["string", "null"],
          "description": "The cleaned official registered legal name of the company including appropriate corporate suffixes (Inc., LLC, Ltd., AB, GmbH, etc.). Cleaned for proper case formatting and standardization while maintaining legal accuracy. Includes the correct jurisdiction-specific corporate designation."
        },
        "description": {
          "type": ["string", "null"],
          "description": "A cleaned brief description of the company's primary business activities, products, or services. Cleaned for proper grammar, punctuation, professional tone, and excessive marketing language. Concise yet informative."
        },
        "industry": {
          "type": ["string", "null"],
          "description": "The cleaned primary industry or sector classification for the company. Cleaned to use standard industry naming conventions, fixed spelling errors, and mapped to recognized classification systems (e.g., NAICS, SIC). Consistent and specific."
        },
        "website": {
          "type": ["string", "null"],
          "description": "The cleaned primary company website URL (e.g., 'https://www.company.com'). Cleaned to standardize URL format, add missing protocols (https://), remove unnecessary parameters, and ensure proper domain structure."
        },
        "city": {
          "type": ["string", "null"],
          "description": "The cleaned city name for the company's headquarters or primary location. Cleaned for proper case formatting, spelling corrections, and standardization of city names. Abbreviations expanded to full names."
        },
        "state": {
          "type": ["string", "null"],
          "description": "The cleaned state, province, or region for the company's location. Cleaned to use standard two-letter state codes for US states (e.g., 'CA', 'NY') or full names for other regions, depending on context."
        },
        "country": {
          "type": ["string", "null"],
          "description": "The cleaned country name for the company's location. Cleaned to use standard country names (e.g., 'United States', 'United Kingdom') or ISO country codes (e.g., 'US', 'GB') as appropriate. Spelling corrections and standardization applied."
        },
        "postalCode": {
          "type": ["string", "null"],
          "description": "The cleaned postal/ZIP code for the company's location. Cleaned to proper format for the specific country (e.g., '12345' or '12345-6789' for US ZIP codes, 'SW1A 1AA' for UK postcodes). Invalid or placeholder codes removed."
        },
        "phone": {
          "type": ["string", "null"],
          "description": "The cleaned primary phone number for the company. Cleaned to standardized international format with country code (e.g., '+1-555-123-4567'), proper spacing, and removal of invalid or placeholder numbers."
        },
        "street": {
          "type": ["string", "null"],
          "description": "The cleaned street address for the company's location. Cleaned for proper case formatting, standardization of abbreviations (St., Ave., Blvd.), and removal of unnecessary punctuation. Complete street address including number."
        },
        "linkedIn": {
          "type": ["string", "null"],
          "description": "The cleaned full URL to the company's official LinkedIn page (e.g., 'https://www.linkedin.com/company/companyname'). Cleaned to standardize URL format, add missing protocols, and ensure proper LinkedIn URL structure."
        },
        "facebook": {
          "type": ["string", "null"],
          "description": "The cleaned full URL to the company's official Facebook page (e.g., 'https://www.facebook.com/companyname'). Cleaned to standardize URL format, add missing protocols, and ensure proper Facebook URL structure."
        },
        "instagram": {
          "type": ["string", "null"],
          "description": "The cleaned full URL to the company's official Instagram account (e.g., 'https://www.instagram.com/companyname'). Cleaned to standardize URL format, add missing protocols, and ensure proper Instagram URL structure."
        },
        "twitter": {
          "type": ["string", "null"],
          "description": "The cleaned full URL to the company's official Twitter/X account (e.g., 'https://twitter.com/companyname' or 'https://x.com/companyname'). Cleaned to standardize URL format, add missing protocols, and ensure proper Twitter/X URL structure."
        }
      },
      "required": ["name", "legalName", "description", "industry", "website", "city", "state", "country", "postalCode", "phone", "street", "linkedIn", "facebook", "instagram", "twitter"],
      "additionalProperties": false
    }
  },
  "required": ["cleanedCompany"],
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
      // Only add rules for properties that exist in the base schema
      if (schema.properties[key]) {
        const currentDescription = schema.properties[key].description
        schema.properties[key].description = `${currentDescription}\n\nIMPORTANT: Always prioritize the user-provided instructions below over the general description above.\n\nUser instructions: ${userRule}`
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
          for (const [key, value] of Object.entries(cleanedData)) {
            if (value && typeof value === 'object' && 'recommendedValue' in value) {
              const fieldData = value as { recommendedValue: any }
              // Only include non-null values
              if (fieldData.recommendedValue !== null) {
                properties[key] = fieldData.recommendedValue
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
      data: {
        company: body.company,
        ...cleanedData
      },
      remaining: featureAccess.remaining ? featureAccess.remaining - 1 : undefined,
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
