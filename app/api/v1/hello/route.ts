import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { checkFeatureAccess, trackFeatureUsage } from "@/lib/autumn"

export async function GET(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-api-key")

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 401 }
      )
    }

    // Validate API key using service role client (bypasses RLS)
    const supabase = createServiceClient()

    const { data: keyRecord, error: keyError } = await supabase
      .from('api_keys')
      .select('id, user_id')
      .eq('key', apiKey)
      .single()

    if (keyError || !keyRecord) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      )
    }

    const userId = keyRecord.user_id

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

    // Track usage with Autumn (deduct 1 credit)
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
      message: "Hello World",
      creditsRemaining: featureAccess.remaining ? featureAccess.remaining - 1 : undefined
    })
  } catch (error) {
    console.error("API error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
