import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Load .env file
dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables')
  process.exit(1)
}

async function createTables() {
  try {
    console.log('📦 Creating api_keys table in Supabase...')

    const migrationPath = path.join(process.cwd(), 'supabase/migrations/create_api_keys_table.sql')
    const sql = fs.readFileSync(migrationPath, 'utf8')

    // Use Supabase REST API to execute SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ query: sql })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`HTTP ${response.status}: ${error}`)
    }

    console.log('✅ api_keys table created successfully!')
    console.log('✅ Row Level Security enabled')
    console.log('✅ Indexes and policies created')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    console.log('\n📝 Please run the SQL manually in Supabase dashboard:')
    console.log('   https://supabase.com/dashboard/project/nqgaooprvgrmkvfslofh/sql/new')
    console.log('\n📄 Copy this SQL:\n')

    const migrationPath = path.join(process.cwd(), 'supabase/migrations/create_api_keys_table.sql')
    const sql = fs.readFileSync(migrationPath, 'utf8')
    console.log(sql)
  }
}

createTables()
