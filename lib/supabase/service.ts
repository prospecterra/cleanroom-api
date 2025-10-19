import { createClient } from '@supabase/supabase-js'

/**
 * Create a Supabase client with SERVICE ROLE privileges
 * This bypasses Row Level Security (RLS) and should only be used in server-side code
 * for trusted operations like API key validation, admin operations, etc.
 *
 * IMPORTANT: Never expose this client to the client-side
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase service role credentials')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}
