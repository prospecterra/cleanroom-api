// Supabase Edge Function for Autumn billing integration
// Deploy this with: supabase functions deploy autumn

import { autumnHandler } from "autumn-js/supabase"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    })
  }

  try {
    // Create Supabase client with user's auth token
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    )

    // Get the authenticated user
    const { data, error } = await supabaseClient.auth.getUser()

    if (error || !data.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Create Autumn handler with user identification
    const handler = autumnHandler({
      corsHeaders,
      identify: async () => {
        return {
          customerId: data.user?.id,
          customerData: {
            email: data.user?.email,
            name: data.user?.user_metadata?.name || data.user?.email?.split("@")[0],
          },
        }
      },
    })

    return handler(req)
  } catch (error) {
    console.error("Edge function error:", error)
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
