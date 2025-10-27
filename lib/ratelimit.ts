// Rate limiting using Vercel KV (Redis) with in-memory fallback for local dev
import { kv } from '@vercel/kv'

interface RateLimitEntry {
  count: number
  resetAt: number
}

class InMemoryRateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map()
  private readonly MAX_ENTRIES = 10000 // Prevent memory exhaustion

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

    // Emergency cleanup if map is too large
    if (this.limits.size > this.MAX_ENTRIES) {
      const sortedEntries = Array.from(this.limits.entries())
        .sort((a, b) => a[1].resetAt - b[1].resetAt)

      // Remove oldest 20%
      const toRemove = Math.floor(this.MAX_ENTRIES * 0.2)
      for (let i = 0; i < toRemove; i++) {
        this.limits.delete(sortedEntries[i][0])
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
      return {
        success: false,
        limit: maxRequests,
        remaining: 0,
        reset: entry.resetAt
      }
    }

    entry.count++
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests - entry.count,
      reset: entry.resetAt
    }
  }
}

// Check if KV is available (production) or use in-memory (local dev)
const isKVAvailable = Boolean(process.env.KV_REST_API_URL)
const inMemoryLimiter = new InMemoryRateLimiter()

async function limit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  // Use in-memory for local dev
  if (!isKVAvailable) {
    return inMemoryLimiter.limit(identifier, maxRequests, windowMs)
  }

  // Use Vercel KV for production with atomic operations
  try {
    const now = Date.now()
    const key = `ratelimit:${identifier}`
    const resetKey = `ratelimit:${identifier}:reset`
    const windowSeconds = Math.ceil(windowMs / 1000)

    // Get or initialize reset time
    let resetAt = await kv.get<number>(resetKey)

    if (!resetAt || resetAt < now) {
      // New window - initialize
      resetAt = now + windowMs
      await kv.set(resetKey, resetAt, { ex: windowSeconds })
      await kv.set(key, 0, { ex: windowSeconds })
    }

    // Atomic increment
    const currentCount = await kv.incr(key)

    // Set expiration on first increment (in case it wasn't set)
    if (currentCount === 1) {
      await kv.expire(key, windowSeconds)
    }

    if (currentCount > maxRequests) {
      // Rate limit exceeded
      return {
        success: false,
        limit: maxRequests,
        remaining: 0,
        reset: resetAt
      }
    }

    return {
      success: true,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - currentCount),
      reset: resetAt
    }
  } catch (error) {
    console.error('KV rate limit error, falling back to in-memory:', error)
    return inMemoryLimiter.limit(identifier, maxRequests, windowMs)
  }
}

// Rate limit configurations
export const RATE_LIMITS = {
  // Per-user limits for the clean endpoint
  CLEAN_ENDPOINT_PER_MINUTE: { requests: 10, window: 60 * 1000 }, // 10 requests per minute
  CLEAN_ENDPOINT_PER_HOUR: { requests: 100, window: 60 * 60 * 1000 }, // 100 requests per hour
  CLEAN_ENDPOINT_PER_DAY: { requests: 1000, window: 24 * 60 * 60 * 1000 }, // 1000 requests per day

  // Per-user limits for the merge endpoint (more expensive - uses up to 3 AI calls)
  MERGE_ENDPOINT_PER_MINUTE: { requests: 5, window: 60 * 1000 }, // 5 requests per minute
  MERGE_ENDPOINT_PER_HOUR: { requests: 50, window: 60 * 60 * 1000 }, // 50 requests per hour
  MERGE_ENDPOINT_PER_DAY: { requests: 500, window: 24 * 60 * 60 * 1000 }, // 500 requests per day

  // Per-user limits for the purge endpoint
  PURGE_ENDPOINT_PER_MINUTE: { requests: 10, window: 60 * 1000 }, // 10 requests per minute
  PURGE_ENDPOINT_PER_HOUR: { requests: 100, window: 60 * 60 * 1000 }, // 100 requests per hour
  PURGE_ENDPOINT_PER_DAY: { requests: 1000, window: 24 * 60 * 60 * 1000 }, // 1000 requests per day
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
  // Determine which rate limits to apply based on endpoint
  let perMinuteConfig, perHourConfig, perDayConfig

  switch (endpoint) {
    case 'clean-endpoint':
      perMinuteConfig = RATE_LIMITS.CLEAN_ENDPOINT_PER_MINUTE
      perHourConfig = RATE_LIMITS.CLEAN_ENDPOINT_PER_HOUR
      perDayConfig = RATE_LIMITS.CLEAN_ENDPOINT_PER_DAY
      break
    case 'merge-endpoint':
      perMinuteConfig = RATE_LIMITS.MERGE_ENDPOINT_PER_MINUTE
      perHourConfig = RATE_LIMITS.MERGE_ENDPOINT_PER_HOUR
      perDayConfig = RATE_LIMITS.MERGE_ENDPOINT_PER_DAY
      break
    case 'purge-endpoint':
      perMinuteConfig = RATE_LIMITS.PURGE_ENDPOINT_PER_MINUTE
      perHourConfig = RATE_LIMITS.PURGE_ENDPOINT_PER_HOUR
      perDayConfig = RATE_LIMITS.PURGE_ENDPOINT_PER_DAY
      break
    default:
      // Default to clean endpoint limits
      perMinuteConfig = RATE_LIMITS.CLEAN_ENDPOINT_PER_MINUTE
      perHourConfig = RATE_LIMITS.CLEAN_ENDPOINT_PER_HOUR
      perDayConfig = RATE_LIMITS.CLEAN_ENDPOINT_PER_DAY
  }

  // Check per-minute limit
  const perMinute = await limit(
    `${endpoint}:${userId}:minute`,
    perMinuteConfig.requests,
    perMinuteConfig.window
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
  const perHour = await limit(
    `${endpoint}:${userId}:hour`,
    perHourConfig.requests,
    perHourConfig.window
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
  const perDay = await limit(
    `${endpoint}:${userId}:day`,
    perDayConfig.requests,
    perDayConfig.window
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
