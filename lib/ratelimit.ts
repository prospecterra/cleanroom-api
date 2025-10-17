// In-memory rate limiting implementation
// In production, use Redis/Upstash for distributed rate limiting

interface RateLimitEntry {
  count: number
  resetAt: number
}

class InMemoryRateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map()

  // Cleanup old entries every 5 minutes
  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000)
  }

  private cleanup() {
    const now = Date.now()
    for (const [key, entry] of this.limits.entries()) {
      if (entry.resetAt < now) {
        this.limits.delete(key)
      }
    }
  }

  async limit(
    identifier: string,
    maxRequests: number,
    windowMs: number
  ): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
    const now = Date.now()
    const key = identifier
    const entry = this.limits.get(key)

    if (!entry || entry.resetAt < now) {
      // Create new window
      this.limits.set(key, {
        count: 1,
        resetAt: now + windowMs
      })
      return {
        success: true,
        limit: maxRequests,
        remaining: maxRequests - 1,
        reset: now + windowMs
      }
    }

    if (entry.count >= maxRequests) {
      // Rate limit exceeded
      return {
        success: false,
        limit: maxRequests,
        remaining: 0,
        reset: entry.resetAt
      }
    }

    // Increment count
    entry.count++
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests - entry.count,
      reset: entry.resetAt
    }
  }
}

// Singleton instance
const rateLimiter = new InMemoryRateLimiter()

// Rate limit configurations
export const RATE_LIMITS = {
  // Per-user limits for the clean endpoint
  CLEAN_ENDPOINT_PER_MINUTE: { requests: 10, window: 60 * 1000 }, // 10 requests per minute
  CLEAN_ENDPOINT_PER_HOUR: { requests: 100, window: 60 * 60 * 1000 }, // 100 requests per hour
  CLEAN_ENDPOINT_PER_DAY: { requests: 1000, window: 24 * 60 * 60 * 1000 }, // 1000 requests per day
}

export async function checkRateLimit(
  userId: string,
  endpoint: string
): Promise<{
  allowed: boolean
  limitType?: string
  limit?: number
  remaining?: number
  reset?: number
}> {
  // Check per-minute limit
  const perMinute = await rateLimiter.limit(
    `${endpoint}:${userId}:minute`,
    RATE_LIMITS.CLEAN_ENDPOINT_PER_MINUTE.requests,
    RATE_LIMITS.CLEAN_ENDPOINT_PER_MINUTE.window
  )

  if (!perMinute.success) {
    return {
      allowed: false,
      limitType: 'per-minute',
      limit: perMinute.limit,
      remaining: perMinute.remaining,
      reset: perMinute.reset
    }
  }

  // Check per-hour limit
  const perHour = await rateLimiter.limit(
    `${endpoint}:${userId}:hour`,
    RATE_LIMITS.CLEAN_ENDPOINT_PER_HOUR.requests,
    RATE_LIMITS.CLEAN_ENDPOINT_PER_HOUR.window
  )

  if (!perHour.success) {
    return {
      allowed: false,
      limitType: 'per-hour',
      limit: perHour.limit,
      remaining: perHour.remaining,
      reset: perHour.reset
    }
  }

  // Check per-day limit
  const perDay = await rateLimiter.limit(
    `${endpoint}:${userId}:day`,
    RATE_LIMITS.CLEAN_ENDPOINT_PER_DAY.requests,
    RATE_LIMITS.CLEAN_ENDPOINT_PER_DAY.window
  )

  if (!perDay.success) {
    return {
      allowed: false,
      limitType: 'per-day',
      limit: perDay.limit,
      remaining: perDay.remaining,
      reset: perDay.reset
    }
  }

  return { allowed: true }
}
