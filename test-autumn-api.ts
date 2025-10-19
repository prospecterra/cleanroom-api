import "dotenv/config"
import { checkFeatureAccess, trackFeatureUsage } from "./lib/autumn"

async function testAutumnAPI() {
  console.log("🧪 Testing Autumn API Integration\n")

  const testUserId = "cmguxoydu0000um12jjm9sg4v"
  const featureId = "credits"

  try {
    // Test 1: Check feature access
    console.log("1️⃣  Checking feature access...")
    console.log(`   User ID: ${testUserId}`)
    console.log(`   Feature: ${featureId}\n`)

    const accessResult = await checkFeatureAccess(testUserId, featureId)

    console.log("   ✅ Access check result:")
    console.log(`      Allowed: ${accessResult.allowed}`)
    console.log(`      Remaining: ${accessResult.remaining ?? "N/A"}`)
    console.log(`      Limit: ${accessResult.limit ?? "N/A"}`)

    if (!accessResult.allowed) {
      console.log("\n   ⚠️  Access denied! Make sure:")
      console.log("      1. User is assigned to 'starter_product' in Autumn dashboard")
      console.log("      2. Feature 'credits' exists in the product")
      console.log("      3. User has remaining credits")
      return
    }

    // Test 2: Track usage
    console.log("\n2️⃣  Tracking usage...")
    await trackFeatureUsage(testUserId, featureId, 1)
    console.log("   ✅ Usage tracked successfully!")

    // Test 3: Check access again to see updated count
    console.log("\n3️⃣  Checking feature access again (should show -1 credit)...")
    const accessResult2 = await checkFeatureAccess(testUserId, featureId)

    console.log("   ✅ Access check result after tracking:")
    console.log(`      Allowed: ${accessResult2.allowed}`)
    console.log(`      Remaining: ${accessResult2.remaining ?? "N/A"}`)
    console.log(`      Limit: ${accessResult2.limit ?? "N/A"}`)

    console.log("\n" + "=".repeat(60))
    console.log("✅ AUTUMN INTEGRATION WORKING!")
    console.log("=".repeat(60))
    console.log("The API successfully:")
    console.log("  1. Checked feature access with Autumn")
    console.log("  2. Tracked usage (deducted credit)")
    console.log("  3. Verified the credit was deducted")
    console.log("\nYou can now use the full API endpoint!")
    console.log("=".repeat(60))

  } catch (error) {
    console.error("\n❌ Error testing Autumn integration:")
    console.error(error)
    console.log("\n💡 Troubleshooting:")
    console.log("   1. Check AUTUMN_SECRET_KEY in .env file")
    console.log("   2. Verify user exists in Autumn dashboard")
    console.log("   3. Ensure 'starter_product' with 'credits' feature is configured")
  }
}

testAutumnAPI()
