import "dotenv/config"
import { autumn } from "./lib/autumn"

async function checkConfig() {
  console.log("🔍 Checking Autumn Configuration\n")

  const testUserId = "cmguxoydu0000um12jjm9sg4v"
  const featureId = "credits"

  try {
    console.log("Testing with User ID:", testUserId)
    console.log("Feature ID:", featureId)
    console.log("\n" + "=".repeat(60))

    // Check if user can access the feature
    const checkResult = await autumn.check({
      customer_id: testUserId,
      feature_id: featureId
    })

    console.log("\n📊 Check Result:")
    console.log(JSON.stringify(checkResult, null, 2))

    console.log("\n" + "=".repeat(60))
    console.log("💡 RECOMMENDATIONS:")
    console.log("=".repeat(60))

    if (checkResult.data && !checkResult.data.allowed) {
      console.log("\n⚠️  User doesn't have access. This could mean:")
      console.log("\n1. Product requires payment:")
      console.log("   → In Autumn dashboard, make 'starter_product' FREE ($0)")
      console.log("   → Or set it as a trial/default product")

      console.log("\n2. Feature not configured:")
      console.log("   → Ensure 'credits' feature exists in 'starter_product'")
      console.log("   → Give it a limit (e.g., 100 credits)")

      console.log("\n3. Need to complete checkout:")
      console.log("   → Use test card: 4242 4242 4242 4242")
      console.log("   → Any future expiry date")
      console.log("   → Any CVC")
      console.log("   → Checkout URL was provided in previous output")
    } else if (checkResult.data && checkResult.data.allowed) {
      console.log("\n✅ ACCESS GRANTED!")
      const data = checkResult.data as { balance?: number; included_usage?: number }
      console.log(`   Remaining: ${data.balance ?? "N/A"}`)
      console.log(`   Limit: ${data.included_usage ?? "N/A"}`)
      console.log("\n🎉 You can now test the API!")
    }

    console.log("\n" + "=".repeat(60))

  } catch (error) {
    console.error("\n❌ Error:", error)
  }
}

checkConfig()
