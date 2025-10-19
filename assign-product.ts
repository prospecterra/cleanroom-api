import "dotenv/config"
import { autumn } from "./lib/autumn"

async function assignProduct() {
  console.log("🔗 Assigning Product to User\n")

  const testUserId = "cmguxoydu0000um12jjm9sg4v"
  const productId = "starter_product"

  try {
    console.log(`   User ID: ${testUserId}`)
    console.log(`   Product: ${productId}\n`)

    console.log("   Calling Autumn attach()...")

    const result = await autumn.attach({
      customer_id: testUserId,
      product_id: productId
    })

    console.log("\n✅ Product assigned successfully!")
    console.log("\nResult:", JSON.stringify(result, null, 2))

    console.log("\n" + "=".repeat(60))
    console.log("✅ SUCCESS!")
    console.log("=".repeat(60))
    console.log("The test user now has access to 'starter_product'")
    console.log("\nRun this to verify:")
    console.log("  npx tsx test-autumn-api.ts")
    console.log("=".repeat(60))

  } catch (error) {
    console.error("\n❌ Error assigning product:")
    console.error(error)
    console.log("\n💡 Troubleshooting:")
    console.log("   1. Verify product ID 'starter_product' exists in Autumn dashboard")
    console.log("   2. Check AUTUMN_SECRET_KEY has correct permissions")
    console.log("   3. Ensure the product is properly configured with features")
  }
}

assignProduct()
