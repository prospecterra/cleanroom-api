import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve } from "path"

// Load environment variables from .env.local
dotenv.config({ path: resolve(__dirname, ".env.local") })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getApiKey() {
  const email = "elias@prospecterra.com"

  // First, find the user
  const { data: userData, error: userError } = await supabase.auth.admin.listUsers()

  if (userError) {
    console.error("Error fetching users:", userError)
    return
  }

  const user = userData.users.find(u => u.email === email)

  if (!user) {
    console.error(`User with email ${email} not found`)
    return
  }

  console.log(`User ID: ${user.id}`)

  // Get the API key for this user
  const { data: apiKeyData, error: apiKeyError } = await supabase
    .from("api_keys")
    .select("key, name")
    .eq("user_id", user.id)
    .limit(1)
    .single()

  if (apiKeyError) {
    console.error("Error fetching API key:", apiKeyError)
    return
  }

  console.log(`\nAPI Key Name: ${apiKeyData.name}`)
  console.log(`API Key: ${apiKeyData.key}`)
}

getApiKey()
