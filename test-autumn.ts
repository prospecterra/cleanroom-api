import { prisma } from "./lib/prisma"
import bcrypt from "bcrypt"
import { v4 as uuidv4 } from "uuid"

async function testAutumnIntegration() {
  console.log("🧪 Testing Autumn Integration\n")

  // Step 1: Create or get test user
  console.log("1️⃣  Setting up test user...")
  const testEmail = "test@autumn.local"
  const testPassword = "testpassword123"

  let user = await prisma.user.findUnique({
    where: { email: testEmail }
  })

  if (!user) {
    const hashedPassword = await bcrypt.hash(testPassword, 10)
    user = await prisma.user.create({
      data: {
        email: testEmail,
        password: hashedPassword,
        name: "Test User",
        credits: 0, // Start with 0 credits (Autumn will manage)
        creditsReserved: 0
      }
    })
    console.log("   ✅ Created test user:", user.email)
  } else {
    console.log("   ✅ Found existing test user:", user.email)
  }

  // Step 2: Create or get API key
  console.log("\n2️⃣  Setting up API key...")
  let apiKey = await prisma.apiKey.findFirst({
    where: { userId: user.id }
  })

  if (!apiKey) {
    const key = `sk_test_${uuidv4().replace(/-/g, "")}`
    apiKey = await prisma.apiKey.create({
      data: {
        key,
        name: "Test Key",
        userId: user.id
      }
    })
    console.log("   ✅ Created API key:", apiKey.key)
  } else {
    console.log("   ✅ Found existing API key:", apiKey.key)
  }

  // Step 3: Display test information
  console.log("\n" + "=".repeat(60))
  console.log("📋 TEST INFORMATION")
  console.log("=".repeat(60))
  console.log(`User ID:     ${user.id}`)
  console.log(`User Email:  ${user.email}`)
  console.log(`API Key:     ${apiKey.key}`)
  console.log("=".repeat(60))

  // Step 4: Provide test curl command
  console.log("\n3️⃣  Test with this curl command:\n")
  console.log(`curl -X POST http://localhost:3000/api/v1/companies/clean \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey.key}" \\
  -d '{
    "company": {
      "name": "acme corp",
      "city": "NEW YORK"
    }
  }'`)

  console.log("\n" + "=".repeat(60))
  console.log("📝 NEXT STEPS:")
  console.log("=".repeat(60))
  console.log("1. Make sure dev server is running: npm run dev")
  console.log("2. In Autumn dashboard, assign the 'starter_product' to this user:")
  console.log(`   - User ID: ${user.id}`)
  console.log(`   - Email: ${user.email}`)
  console.log("3. Run the curl command above to test the API")
  console.log("4. Check if Autumn tracks the usage")
  console.log("=".repeat(60))

  await prisma.$disconnect()
}

testAutumnIntegration().catch(console.error)
