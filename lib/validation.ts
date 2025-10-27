/**
 * Input validation utilities for API endpoints
 */

// Validation limits
export const VALIDATION_LIMITS = {
  MAX_COMPANY_PROPERTIES: 50,
  MAX_STRING_LENGTH: 10000,
  MAX_RULE_LENGTH: 2000,
  MAX_PROPERTY_RULES: 20,
} as const

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate company object size and content
 */
export function validateCompanyObject(company: Record<string, unknown>): {
  valid: boolean
  error?: string
} {
  // Check number of properties
  const propertyCount = Object.keys(company).length
  if (propertyCount === 0) {
    return { valid: false, error: 'Company object must contain at least one property' }
  }
  if (propertyCount > VALIDATION_LIMITS.MAX_COMPANY_PROPERTIES) {
    return {
      valid: false,
      error: `Too many properties. Maximum ${VALIDATION_LIMITS.MAX_COMPANY_PROPERTIES} allowed, received ${propertyCount}`
    }
  }

  // Check individual property values
  for (const [key, value] of Object.entries(company)) {
    if (typeof value === 'string' && value.length > VALIDATION_LIMITS.MAX_STRING_LENGTH) {
      return {
        valid: false,
        error: `Property '${key}' exceeds maximum length of ${VALIDATION_LIMITS.MAX_STRING_LENGTH} characters`
      }
    }

    // Check for nested objects or arrays (not supported)
    if (typeof value === 'object' && value !== null) {
      return {
        valid: false,
        error: `Property '${key}' contains nested object or array. Only primitive values are supported.`
      }
    }
  }

  return { valid: true }
}

/**
 * Sanitize user-provided rules to prevent prompt injection
 */
export function sanitizeRule(rule: string | undefined): string | undefined {
  if (!rule || typeof rule !== 'string') {
    return undefined
  }

  // Trim and limit length
  const trimmed = rule.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  if (trimmed.length > VALIDATION_LIMITS.MAX_RULE_LENGTH) {
    return trimmed.substring(0, VALIDATION_LIMITS.MAX_RULE_LENGTH)
  }

  // Remove potentially harmful characters that could affect JSON schema
  // Allow alphanumerics, spaces, common punctuation, but remove schema control chars
  return trimmed
    .replace(/[{}[\]]/g, '') // Remove JSON syntax characters
    .replace(/[<>]/g, '') // Remove HTML-like tags
    .replace(/\\/g, '') // Remove backslashes
    .trim()
}

/**
 * Sanitize property-specific rules
 */
export function sanitizePropertyRules(
  rules: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!rules || typeof rules !== 'object') {
    return undefined
  }

  // Limit number of property rules
  const ruleKeys = Object.keys(rules)
  if (ruleKeys.length === 0) {
    return undefined
  }

  if (ruleKeys.length > VALIDATION_LIMITS.MAX_PROPERTY_RULES) {
    return undefined // Too many rules - reject entirely
  }

  const sanitized: Record<string, string> = {}

  for (const [key, value] of Object.entries(rules)) {
    if (typeof value === 'string') {
      const sanitizedValue = sanitizeRule(value)
      if (sanitizedValue) {
        sanitized[key] = sanitizedValue
      }
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

/**
 * Validate UUID format
 */
export function isValidUUID(id: string | undefined): boolean {
  if (!id || typeof id !== 'string') {
    return false
  }
  return UUID_REGEX.test(id)
}

/**
 * Validate CRM record ID
 */
export function validateRecordId(recordId: unknown): {
  valid: boolean
  error?: string
} {
  if (!recordId || typeof recordId !== 'string') {
    return { valid: false, error: 'recordId must be a non-empty string' }
  }

  const trimmed = recordId.trim()
  if (!trimmed) {
    return { valid: false, error: 'recordId cannot be empty' }
  }

  // For now, we accept any non-empty string as HubSpot uses numeric IDs
  // UUID validation is applied in other contexts (API keys)
  return { valid: true }
}

/**
 * Sanitize error message to prevent information leakage
 */
export function sanitizeErrorMessage(error: unknown, context: string): string {
  // Log full error server-side
  console.error(`[${context}] Error:`, error)

  // Return generic message to user
  if (error instanceof Error) {
    // Check for known safe error patterns
    if (error.message.includes('Rate limit') ||
        error.message.includes('Invalid') ||
        error.message.includes('not found')) {
      return error.message
    }
  }

  // Default generic message
  return 'An error occurred while processing your request. Please contact support if this persists.'
}

/**
 * Validate Content-Type header
 */
export function validateContentType(contentType: string | null): {
  valid: boolean
  error?: string
} {
  if (!contentType) {
    return { valid: false, error: 'Content-Type header is required' }
  }

  // Accept application/json with optional charset
  if (contentType.includes('application/json')) {
    return { valid: true }
  }

  return {
    valid: false,
    error: 'Content-Type must be application/json'
  }
}
