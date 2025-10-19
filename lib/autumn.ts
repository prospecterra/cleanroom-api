import { Autumn } from "autumn-js"

// Initialize Autumn client with secret key
const autumnClient = new Autumn({
  secretKey: process.env.AUTUMN_SECRET_KEY!
})

export const autumn = autumnClient

/**
 * Check if a user has access to a feature
 * @param userId - The user's ID
 * @param featureId - The feature identifier (e.g., "company-cleaning")
 * @returns Whether the user has access to the feature
 */
export async function checkFeatureAccess(userId: string, featureId: string): Promise<{
  allowed: boolean
  remaining?: number
  limit?: number
}> {
  try {
    const response = await autumn.check({
      customer_id: userId,
      feature_id: featureId
    })

    const { data } = response

    // Autumn API uses 'balance' for remaining credits and 'included_usage' for limit
    const remaining = (data as any)?.balance ?? undefined
    const limit = (data as any)?.included_usage ?? undefined

    return {
      allowed: data?.allowed ?? false,
      remaining,
      limit
    }
  } catch (error) {
    console.error("Autumn check error:", error)
    return { allowed: false }
  }
}

/**
 * Track usage of a feature
 * @param userId - The user's ID
 * @param featureId - The feature identifier
 * @param value - The amount to track (default: 1)
 */
export async function trackFeatureUsage(
  userId: string,
  featureId: string,
  value: number = 1
): Promise<void> {
  try {
    await autumn.track({
      customer_id: userId,
      feature_id: featureId,
      value
    })
  } catch (error) {
    console.error("Autumn track error:", error)
    throw error
  }
}
