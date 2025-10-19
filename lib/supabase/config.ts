export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  return !!(
    url &&
    key &&
    url.startsWith('http') &&
    !url.includes('placeholder') &&
    !key.includes('placeholder')
  )
}
