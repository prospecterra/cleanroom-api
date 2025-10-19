import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { randomBytes } from "crypto"

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { data: apiKeys, error: fetchError } = await supabase
      .from('api_keys')
      .select('id, name, key, last_used, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error("Error fetching API keys:", fetchError)
      return NextResponse.json(
        { error: "Failed to fetch API keys" },
        { status: 500 }
      )
    }

    // Transform to match the expected format (camelCase)
    const formattedKeys = apiKeys?.map(key => ({
      id: key.id,
      name: key.name,
      key: key.key,
      lastUsed: key.last_used,
      createdAt: key.created_at
    })) || []

    return NextResponse.json({ apiKeys: formattedKeys })
  } catch (error) {
    console.error("Error fetching API keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { name } = await req.json()

    // Validate input
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: "Name is required and must be a string" },
        { status: 400 }
      )
    }

    // Sanitize and validate name
    const sanitizedName = name.trim()
    if (sanitizedName.length < 1 || sanitizedName.length > 100) {
      return NextResponse.json(
        { error: "Name must be between 1 and 100 characters" },
        { status: 400 }
      )
    }

    // Check how many API keys the user already has
    const { count, error: countError } = await supabase
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (countError) {
      console.error("Error counting API keys:", countError)
      return NextResponse.json(
        { error: "Failed to check existing API keys" },
        { status: 500 }
      )
    }

    // Limit to 10 API keys per user
    const MAX_KEYS_PER_USER = 10
    if (count !== null && count >= MAX_KEYS_PER_USER) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_KEYS_PER_USER} API keys allowed per user` },
        { status: 400 }
      )
    }

    // Check if user already has an API key with this name
    const { data: existingKey } = await supabase
      .from('api_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', sanitizedName)
      .maybeSingle()

    if (existingKey) {
      return NextResponse.json(
        { error: "An API key with this name already exists" },
        { status: 400 }
      )
    }

    // Generate a cryptographically secure API key
    // Using 32 bytes (256 bits) of entropy, encoded as hex
    const keyBytes = randomBytes(32)
    const key = `ak_${keyBytes.toString('hex')}`

    const { data: apiKey, error: createError } = await supabase
      .from('api_keys')
      .insert({
        name: sanitizedName,
        key,
        user_id: user.id
      })
      .select()
      .single()

    if (createError) {
      console.error("Error creating API key:", createError)

      // Check for unique constraint violation (shouldn't happen with crypto.randomBytes, but just in case)
      if (createError.code === '23505') {
        return NextResponse.json(
          { error: "Failed to generate unique API key. Please try again." },
          { status: 500 }
        )
      }

      return NextResponse.json(
        { error: "Failed to create API key" },
        { status: 500 }
      )
    }

    // Transform to match the expected format (camelCase)
    const formattedKey = {
      id: apiKey.id,
      name: apiKey.name,
      key: apiKey.key,
      lastUsed: apiKey.last_used,
      createdAt: apiKey.created_at
    }

    return NextResponse.json({ apiKey: formattedKey }, { status: 201 })
  } catch (error) {
    console.error("Error creating API key:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
