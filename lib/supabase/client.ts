import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Provide default values if not configured
  const supabaseUrl = url && url.startsWith('http') ? url : 'https://placeholder.supabase.co'
  const supabaseKey = key || 'placeholder-key'

  return createBrowserClient(supabaseUrl, supabaseKey)
}
