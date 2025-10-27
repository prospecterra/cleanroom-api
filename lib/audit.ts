/**
 * Audit logging utility for tracking important events and operations
 */

import { randomUUID } from 'crypto'

export enum AuditEventType {
  // API Key events
  API_KEY_CREATED = 'api_key.created',
  API_KEY_DELETED = 'api_key.deleted',
  API_KEY_RENAMED = 'api_key.renamed',
  API_KEY_USED = 'api_key.used',

  // Credit events
  CREDITS_CONSUMED = 'credits.consumed',
  CREDITS_INSUFFICIENT = 'credits.insufficient',

  // CRM events
  CRM_RECORD_UPDATED = 'crm.record_updated',
  CRM_RECORD_DELETED = 'crm.record_deleted',
  CRM_RECORD_MERGED = 'crm.record_merged',

  // Rate limit events
  RATE_LIMIT_EXCEEDED = 'rate_limit.exceeded',

  // Auth events
  AUTH_FAILED = 'auth.failed',
  AUTH_INVALID_API_KEY = 'auth.invalid_api_key',

  // Validation events
  VALIDATION_FAILED = 'validation.failed',

  // Error events
  ERROR_OCCURRED = 'error.occurred',
}

export interface AuditEvent {
  id: string
  timestamp: string
  requestId?: string
  eventType: AuditEventType
  userId?: string
  apiKeyId?: string
  metadata?: Record<string, unknown>
  success: boolean
  errorMessage?: string
}

/**
 * Log an audit event
 * In production, this should write to a database or logging service
 */
export function logAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): void {
  const auditEvent: AuditEvent = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...event
  }

  // For now, log to console in structured format
  // In production, send to logging service (e.g., Datadog, LogDNA, CloudWatch)
  console.log('[AUDIT]', JSON.stringify(auditEvent))

  // TODO: In production, also write to database or external logging service
  // Example:
  // await supabase.from('audit_logs').insert(auditEvent)
}

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  return `req_${randomUUID()}`
}

/**
 * Extract request ID from headers or generate new one
 */
export function getOrCreateRequestId(headers: Headers): string {
  const existingId = headers.get('x-request-id')
  return existingId || generateRequestId()
}
