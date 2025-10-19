import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkApiKey() {
  const apiKey = 'ak_97f2cee1acf54d238fa7dd768e749b63'

  console.log('🔍 Checking for API key:', apiKey)
  console.log('')

  // Check if the API key exists
  const { data: keyRecord, error: keyError } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key', apiKey)
    .single()

  if (keyError) {
    console.error('❌ API key not found:', keyError.message)
    console.log('')
    console.log('📋 Let me check all API keys in the database...')
    console.log('')

    // List all API keys
    const { data: allKeys, error: allKeysError } = await supabase
      .from('api_keys')
      .select('*')
      .order('created_at', { ascending: false })

    if (allKeysError) {
      console.error('❌ Error fetching API keys:', allKeysError.message)
      return
    }

    if (!allKeys || allKeys.length === 0) {
      console.log('⚠️  No API keys found in the database')
      console.log('')
      console.log('💡 You need to create an API key in the dashboard:')
      console.log('   1. Sign in at http://localhost:3000/auth/signin')
      console.log('   2. Go to http://localhost:3000/dashboard')
      console.log('   3. Create a new API key')
    } else {
      console.log(`Found ${allKeys.length} API key(s):`)
      console.log('')
      allKeys.forEach((key, index) => {
        console.log(`${index + 1}. Key: ${key.key}`)
        console.log(`   Name: ${key.name}`)
        console.log(`   User ID: ${key.user_id}`)
        console.log(`   Created: ${key.created_at}`)
        console.log('')
      })
    }

    return
  }

  console.log('✅ API key found!')
  console.log('')
  console.log('Key details:')
  console.log('  ID:', keyRecord.id)
  console.log('  Name:', keyRecord.name)
  console.log('  User ID:', keyRecord.user_id)
  console.log('  Created:', keyRecord.created_at)
  console.log('  Last used:', keyRecord.last_used || 'Never')
  console.log('')

  // Get user details
  const { data: userData } = await supabase.auth.admin.getUserById(keyRecord.user_id)

  if (userData?.user) {
    console.log('User details:')
    console.log('  Email:', userData.user.email)
  }
}

checkApiKey()
