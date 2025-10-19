import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables:')
  console.error('   - NEXT_PUBLIC_SUPABASE_URL')
  console.error('   - SUPABASE_SERVICE_ROLE_KEY')
  console.error('')
  console.error('Please add SUPABASE_SERVICE_ROLE_KEY to your .env file')
  console.error('You can find it in: Supabase Dashboard > Settings > API > service_role key')
  process.exit(1)
}

console.log('🔧 Manual Migration Required')
console.log('')
console.log('Please run the SQL migration manually:')
console.log('1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/editor')
console.log('2. Copy the SQL from: supabase/migrations/create_api_keys_table.sql')
console.log('3. Paste and execute in the SQL Editor')
console.log('')
console.log('Or, add SUPABASE_SERVICE_ROLE_KEY to .env and we can run it programmatically.')
process.exit(0)
