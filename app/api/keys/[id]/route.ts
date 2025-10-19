import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id } = await params
    const { name } = await req.json()

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: "Invalid API key ID format" },
        { status: 400 }
      )
    }

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

    // Check if user already has another API key with this name
    const { data: existingKey } = await supabase
      .from('api_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', sanitizedName)
      .neq('id', id)
      .maybeSingle()

    if (existingKey) {
      return NextResponse.json(
        { error: "An API key with this name already exists" },
        { status: 400 }
      )
    }

    // Update API key name (RLS policy ensures user can only update their own keys)
    const { data: updatedKey, error: updateError } = await supabase
      .from('api_keys')
      .update({ name: sanitizedName })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle()

    if (updateError) {
      console.error("Error updating API key:", updateError)
      return NextResponse.json(
        { error: "Failed to update API key" },
        { status: 500 }
      )
    }

    if (!updatedKey) {
      return NextResponse.json(
        { error: "API key not found" },
        { status: 404 }
      )
    }

    console.log(`API key renamed: ${id} to "${sanitizedName}" for user ${user.id}`)

    // Transform to match the expected format (camelCase)
    const formattedKey = {
      id: updatedKey.id,
      name: updatedKey.name,
      key: updatedKey.key,
      lastUsed: updatedKey.last_used,
      createdAt: updatedKey.created_at
    }

    return NextResponse.json({ apiKey: formattedKey })
  } catch (error) {
    console.error("Error updating API key:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id } = await params

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: "Invalid API key ID format" },
        { status: 400 }
      )
    }

    // First verify the key exists and belongs to the user
    const { data: existingKey, error: fetchError } = await supabase
      .from('api_keys')
      .select('id, name')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (fetchError) {
      console.error("Error fetching API key:", fetchError)
      return NextResponse.json(
        { error: "Failed to verify API key" },
        { status: 500 }
      )
    }

    if (!existingKey) {
      return NextResponse.json(
        { error: "API key not found" },
        { status: 404 }
      )
    }

    // Delete API key (RLS policy ensures user can only delete their own keys)
    const { error: deleteError } = await supabase
      .from('api_keys')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error("Error deleting API key:", deleteError)
      return NextResponse.json(
        { error: "Failed to delete API key" },
        { status: 500 }
      )
    }

    console.log(`API key deleted: ${existingKey.name} (${id}) for user ${user.id}`)

    return NextResponse.json({
      message: "API key deleted successfully",
      deletedKey: {
        id: existingKey.id,
        name: existingKey.name
      }
    })
  } catch (error) {
    console.error("Error deleting API key:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
