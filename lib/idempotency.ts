/**
 * Idempotency support for API endpoints
 * Prevents duplicate processing of the same request
 */

import { kv } from '@vercel/kv'

interface IdempotencyRecord {
  responseStatus: number
  responseBody: string
  createdAt: number
}

// Check if KV is available
const isKVAvailable = Boolean(process.env.KV_REST_API_URL)

// In-memory storage for local development
const inMemoryStore = new Map<string, IdempotencyRecord>()

// Idempotency keys expire after 24 hours
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60

/**
 * Check if request with this idempotency key was already processed
 * Returns cached response if found
 */
export async function checkIdempotency(
  idempotencyKey: string,
  userId: string
): Promise<{ cached: boolean; status?: number; body?: string }> {
  if (!idempotencyKey) {
    return { cached: false }
  }

  const key = `idempotency:${userId}:${idempotencyKey}`

  try {
    if (isKVAvailable) {
      const record = await kv.get<IdempotencyRecord>(key)
      if (record) {
        return {
          cached: true,
          status: record.responseStatus,
          body: record.responseBody
        }
      }
    } else {
      // Use in-memory for local dev
      const record = inMemoryStore.get(key)
      if (record) {
        // Check if expired
        const now = Date.now()
        if (now - record.createdAt < IDEMPOTENCY_TTL_SECONDS * 1000) {
          return {
            cached: true,
            status: record.responseStatus,
            body: record.responseBody
          }
        } else {
          // Expired - remove it
          inMemoryStore.delete(key)
        }
      }
    }

    return { cached: false }
  } catch (error) {
    console.error('Error checking idempotency:', error)
    // On error, don't block the request
    return { cached: false }
  }
}

/**
 * Store response for future idempotent requests
 */
export async function storeIdempotentResponse(
  idempotencyKey: string,
  userId: string,
  status: number,
  body: string
): Promise<void> {
  if (!idempotencyKey) {
    return
  }

  const key = `idempotency:${userId}:${idempotencyKey}`
  const record: IdempotencyRecord = {
    responseStatus: status,
    responseBody: body,
    createdAt: Date.now()
  }

  try {
    if (isKVAvailable) {
      await kv.set(key, record, { ex: IDEMPOTENCY_TTL_SECONDS })
    } else {
      // Use in-memory for local dev
      inMemoryStore.set(key, record)

      // Cleanup old entries if map gets too large
      if (inMemoryStore.size > 1000) {
        const now = Date.now()
        for (const [k, v] of inMemoryStore.entries()) {
          if (now - v.createdAt >= IDEMPOTENCY_TTL_SECONDS * 1000) {
            inMemoryStore.delete(k)
          }
        }
      }
    }
  } catch (error) {
    console.error('Error storing idempotent response:', error)
    // Don't throw - storing for idempotency is not critical
  }
}

/**
 * Validate idempotency key format
 */
export function validateIdempotencyKey(key: string | null): { valid: boolean; error?: string } {
  if (!key) {
    return { valid: true } // Optional header
  }

  if (typeof key !== 'string') {
    return { valid: false, error: 'Idempotency-Key must be a string' }
  }

  // Must be between 1 and 255 characters
  if (key.length < 1 || key.length > 255) {
    return {
      valid: false,
      error: 'Idempotency-Key must be between 1 and 255 characters'
    }
  }

  // Should contain only safe characters (alphanumeric, dash, underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return {
      valid: false,
      error: 'Idempotency-Key must contain only alphanumeric characters, dashes, and underscores'
    }
  }

  return { valid: true }
}
