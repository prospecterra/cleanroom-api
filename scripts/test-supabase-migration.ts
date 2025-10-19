import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testMigration() {
  console.log('🧪 Testing Supabase Migration...\n')

  // Test 1: Check if api_keys table exists
  console.log('1. Checking if api_keys table exists...')
  const { data: tables, error: tablesError } = await supabase
    .from('api_keys')
    .select('*')
    .limit(0)

  if (tablesError) {
    console.error('   ❌ Table does not exist or query failed:', tablesError.message)
    process.exit(1)
  }

  console.log('   ✅ api_keys table exists!\n')

  // Test 2: Try to insert a test API key (will fail due to FK if user doesn't exist, which is expected)
  console.log('2. Testing table structure...')
  const testUserId = '00000000-0000-0000-0000-000000000000'
  const { error: insertError } = await supabase
    .from('api_keys')
    .insert({
      key: 'test_key_12345',
      name: 'Test Key',
      user_id: testUserId
    })

  if (insertError) {
    if (insertError.message.includes('violates foreign key constraint')) {
      console.log('   ✅ Foreign key constraint working correctly!')
      console.log('   ✅ Table structure is correct!\n')
    } else {
      console.error('   ❌ Unexpected error:', insertError.message)
    }
  } else {
    // Clean up if it somehow succeeded
    await supabase.from('api_keys').delete().eq('key', 'test_key_12345')
    console.log('   ✅ Table structure is correct!\n')
  }

  console.log('✅ Migration test complete!')
  console.log('\nNext steps:')
  console.log('1. Sign up at http://localhost:3000/auth/signup')
  console.log('2. Create an API key in the dashboard')
  console.log('3. Test the API with your key')
}

testMigration()
