import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts'
import { decrypt } from '@/lib/whatsapp/encryption'
import { requestSmbAppDataSync } from '@/lib/whatsapp/meta-api'

type JsonRecord = Record<string, unknown>

interface SyncEventRow {
  id: string
  account_id: string
  whatsapp_number_id: string
  event_type: 'history' | 'smb_app_state_sync' | 'smb_message_echoes' | 'account_update'
  payload: JsonRecord
  attempts: number
}

interface SyncJobRow {
  id: string
  account_id: string
  whatsapp_number_id: string
  sync_type: 'history' | 'contacts' | 'app_state'
  attempts: number
}

interface NumberIdentity {
  id: string
  display_phone_number: string | null
  metadata: JsonRecord
}

interface SyncJobNumber {
  id: string
  phone_number_id: string
  access_token: string | null
}

interface ImportedMessage {
  messageId: string
  phone: string
  senderType: 'contact' | 'agent'
  origin: 'history_sync' | 'business_app'
  content: string
  contentType: string
  timestamp: string
  status: string
  raw: JsonRecord
}

const MESSAGE_TYPES = new Set([
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'reaction',
  'button',
  'order',
  'system',
  'unknown',
])

/**
 * Process captured coexistence webhooks outside the webhook request. Meta can
 * deliver history in large, out-of-order chunks, so the public webhook only
 * stores an idempotent event and this worker performs the heavier DB writes.
 */
export async function processPendingCoexistenceEvents(
  db: SupabaseClient,
  limit = 20,
): Promise<{ processed: number; failed: number }> {
  const { data: rows, error } = await db
    .from('whatsapp_webhook_events')
    .select('id, account_id, whatsapp_number_id, event_type, payload, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 5)
    .order('received_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Unable to load coexistence events: ${error.message}`)

  let processed = 0
  let failed = 0

  for (const rawRow of rows ?? []) {
    const row = rawRow as unknown as SyncEventRow
    const claimed = await claimEvent(db, row.id, row.attempts)
    if (!claimed) continue

    try {
      await processEvent(db, row)
      await db
        .from('whatsapp_webhook_events')
        .update({
          status: 'completed',
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', row.id)
      processed += 1
    } catch (eventError) {
      const message = eventError instanceof Error ? eventError.message : String(eventError)
      console.error(`[coexistence-sync] event ${row.id} failed:`, message)
      await db
        .from('whatsapp_webhook_events')
        .update({ status: 'failed', last_error: message.slice(0, 2000) })
        .eq('id', row.id)
      failed += 1
    }
  }

  return { processed, failed }
}

/**
 * Kick off Meta's SMB App Data sync requests for onboarded coexistence
 * numbers. This is distinct from `processPendingCoexistenceEvents`, which
 * digests the webhooks Meta sends after these requests are accepted.
 */
export async function processPendingCoexistenceSyncJobs(
  db: SupabaseClient,
  options?: {
    limit?: number
    whatsappNumberId?: string
  },
): Promise<{ processed: number; failed: number }> {
  const limit = options?.limit ?? 10
  let query = db
    .from('whatsapp_sync_jobs')
    .select('id, account_id, whatsapp_number_id, sync_type, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 5)
    .order('requested_at', { ascending: true })
    .limit(limit)

  if (options?.whatsappNumberId) {
    query = query.eq('whatsapp_number_id', options.whatsappNumberId)
  }

  const { data: rows, error } = await query
  if (error) throw new Error(`Unable to load coexistence sync jobs: ${error.message}`)

  let processed = 0
  let failed = 0

  for (const rawRow of rows ?? []) {
    const row = rawRow as unknown as SyncJobRow
    const claimed = await claimSyncJob(db, row.id, row.attempts)
    if (!claimed) continue

    try {
      await processSyncJob(db, row)
      processed += 1
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError)
      await db
        .from('whatsapp_sync_jobs')
        .update({
          status: 'failed',
          last_error: message.slice(0, 2000),
        })
        .eq('id', row.id)
      failed += 1
    }
  }

  return { processed, failed }
}

async function claimSyncJob(
  db: SupabaseClient,
  jobId: string,
  attempts: number,
): Promise<boolean> {
  const { data, error } = await db
    .from('whatsapp_sync_jobs')
    .update({
      status: 'processing',
      attempts: attempts + 1,
      started_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['pending', 'failed'])
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Unable to claim coexistence sync job: ${error.message}`)
  return Boolean(data)
}

async function processSyncJob(db: SupabaseClient, job: SyncJobRow): Promise<void> {
  const { data: number, error } = await db
    .from('whatsapp_numbers')
    .select('id, phone_number_id, access_token')
    .eq('id', job.whatsapp_number_id)
    .eq('account_id', job.account_id)
    .single()

  const connectedNumber = number as unknown as SyncJobNumber | null
  if (error || !connectedNumber?.access_token) {
    throw new Error('Connected WhatsApp number no longer has an access token')
  }

  const accessToken = decrypt(connectedNumber.access_token)
  const syncType =
    job.sync_type === 'history'
      ? 'history'
      : 'smb_app_state_sync'
  const accepted = await requestSmbAppDataSync({
    phoneNumberId: connectedNumber.phone_number_id,
    accessToken,
    syncType,
  })

  await db
    .from('whatsapp_sync_jobs')
    .update({
      status: 'completed',
      processed_count: 1,
      metadata: {
        request_id: accepted.request_id,
        sync_type: syncType,
      },
      last_error: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id)
}

async function claimEvent(
  db: SupabaseClient,
  eventId: string,
  attempts: number,
): Promise<boolean> {
  const { data, error } = await db
    .from('whatsapp_webhook_events')
    .update({
      status: 'processing',
      attempts: attempts + 1,
    })
    .eq('id', eventId)
    .in('status', ['pending', 'failed'])
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Unable to claim coexistence event: ${error.message}`)
  return Boolean(data)
}

async function processEvent(db: SupabaseClient, event: SyncEventRow): Promise<void> {
  const { data: number, error } = await db
    .from('whatsapp_numbers')
    .select('id, display_phone_number, metadata')
    .eq('id', event.whatsapp_number_id)
    .eq('account_id', event.account_id)
    .single()

  if (error || !number) throw new Error('Connected WhatsApp number no longer exists')
  const identity = number as unknown as NumberIdentity

  if (event.event_type === 'history' || event.event_type === 'smb_message_echoes') {
    const imported = extractMessages(event.payload, identity, event.event_type)
    for (const message of imported) {
      await persistImportedMessage(db, event.account_id, identity.id, message)
    }
  }
  if (event.event_type === 'smb_app_state_sync') {
    const auditUserId = await resolveAuditUserId(db, event.account_id)
    for (const contact of extractContacts(event.payload)) {
      await findOrCreateContact(db, event.account_id, auditUserId, contact)
    }
  }

  const now = new Date().toISOString()
  if (event.event_type === 'history') {
    const progress = readProgress(event.payload)
    await db
      .from('whatsapp_numbers')
      .update({
        history_sync_status: progress >= 100 ? 'completed' : 'processing',
        history_sync_completed_at: progress >= 100 ? now : null,
        metadata: { ...(identity.metadata ?? {}), history_progress: progress },
      })
      .eq('id', identity.id)
  } else if (event.event_type === 'smb_app_state_sync') {
    await db
      .from('whatsapp_numbers')
      .update({ contacts_sync_status: 'completed', contacts_sync_completed_at: now })
      .eq('id', identity.id)
  }
}

async function persistImportedMessage(
  db: SupabaseClient,
  accountId: string,
  whatsappNumberId: string,
  message: ImportedMessage,
): Promise<void> {
  const { data: duplicate } = await db
    .from('messages')
    .select('id')
    .eq('whatsapp_number_id', whatsappNumberId)
    .eq('message_id', message.messageId)
    .maybeSingle()
  if (duplicate) return

  const resolved = await resolveConversationByPhone(
    db,
    accountId,
    message.phone,
    null,
    { requireWhatsAppConfig: false, whatsappNumberId },
  )

  const { error } = await db.from('messages').insert({
    conversation_id: resolved.conversationId,
    whatsapp_number_id: whatsappNumberId,
    message_id: message.messageId,
    sender_type: message.senderType === 'contact' ? 'customer' : 'agent',
    content_text: message.content,
    content_type: normalizeContentType(message.contentType),
    message_origin: message.origin,
    status: message.status,
    created_at: message.timestamp,
  })
  if (error?.code === '23505') return
  if (error) throw new Error(`Unable to import coexistence message: ${error.message}`)

  await db
    .from('conversations')
    .update({
      last_message_at: message.timestamp,
      updated_at: new Date().toISOString(),
    })
    .eq('id', resolved.conversationId)
}

/**
 * Meta has changed the wrapper names used by history and message-echo
 * payloads over time. Walk the payload and accept only objects that have the
 * stable message fields, while carrying a parent thread/phone as fallback.
 */
function extractMessages(
  payload: JsonRecord,
  number: NumberIdentity,
  eventType: SyncEventRow['event_type'],
): ImportedMessage[] {
  const output: ImportedMessage[] = []
  const seen = new Set<string>()
  const businessPhone = sanitizePhoneForMeta(number.display_phone_number ?? '')

  const visit = (value: unknown, parentPhone: string | null): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, parentPhone))
      return
    }
    if (!isRecord(value)) return

    const possibleParent =
      readPhone(value, ['phone', 'wa_id', 'phone_number', 'thread_id']) ||
      (Array.isArray(value.messages) ? readPhone(value, ['id']) : null)
    const nextParent = possibleParent || parentPhone
    const id = typeof value.id === 'string' ? value.id : null
    const type = typeof value.type === 'string' ? value.type.toLowerCase() : null
    const timestamp = normalizeTimestamp(value.timestamp)
    const from = readPhone(value, ['from'])
    const to = readPhone(value, ['to', 'recipient_id'])

    if (id && type && MESSAGE_TYPES.has(type) && timestamp && (from || to || nextParent)) {
      const isEcho = eventType === 'smb_message_echoes'
      const isOutbound = isEcho || Boolean(to && sanitizePhoneForMeta(to) !== businessPhone)
      const contactPhone = isOutbound ? to || nextParent : from || nextParent
      if (contactPhone && !seen.has(id)) {
        seen.add(id)
        output.push({
          messageId: id,
          phone: contactPhone,
          senderType: isOutbound ? 'agent' : 'contact',
          origin: isEcho ? 'business_app' : 'history_sync',
          content: readContent(value, type),
          contentType: type,
          timestamp,
          status: normalizeStatus(value.status, isOutbound),
          raw: value,
        })
      }
    }

    Object.values(value).forEach((child) => visit(child, nextParent))
  }

  visit(payload, null)
  return output
}

function readContent(message: JsonRecord, type: string): string {
  if (type === 'text' && isRecord(message.text) && typeof message.text.body === 'string') {
    return message.text.body
  }
  const typed = message[type]
  if (isRecord(typed)) {
    if (typeof typed.caption === 'string') return typed.caption
    if (typeof typed.title === 'string') return typed.title
    if (typeof typed.name === 'string') return typed.name
  }
  return `[${type}]`
}

function readPhone(value: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate !== 'string') continue
    const normalized = sanitizePhoneForMeta(candidate)
    if (/^\+?\d{7,15}$/.test(normalized)) return candidate
  }
  return null
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeStatus(value: unknown, outbound: boolean): string {
  if (typeof value !== 'string') return outbound ? 'sent' : 'delivered'
  const normalized = value.toLowerCase()
  if (normalized === 'error' || normalized === 'failed') return 'failed'
  if (normalized === 'received') return 'delivered'
  if (['sent', 'delivered', 'read'].includes(normalized)) return normalized
  return outbound ? 'sent' : 'delivered'
}

function normalizeContentType(type: string): string {
  if (['text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive'].includes(type)) {
    return type
  }
  return type === 'sticker' ? 'image' : 'text'
}

function readProgress(payload: JsonRecord): number {
  let progress = 0
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!isRecord(value)) return
    if (typeof value.progress === 'number') progress = Math.max(progress, value.progress)
    if (typeof value.progress === 'string') progress = Math.max(progress, Number(value.progress) || 0)
    if (typeof value.phase === 'string' && ['COMPLETE', 'COMPLETED', 'FINISHED', 'DONE'].includes(value.phase.toUpperCase())) {
      progress = 100
    }
    Object.values(value).forEach(visit)
  }
  visit(payload)
  return Math.min(100, Math.max(0, progress))
}

function extractContacts(payload: JsonRecord): Array<{ phone: string; name?: string }> {
  const contacts = new Map<string, { phone: string; name?: string }>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!isRecord(value)) return
    const phone = readPhone(value, ['wa_id', 'phone_number', 'phone'])
    if (phone) {
      const name = readString(value.name) ||
        (isRecord(value.profile) ? readString(value.profile.name) : '')
      contacts.set(sanitizePhoneForMeta(phone), { phone, ...(name ? { name } : {}) })
    }
    Object.values(value).forEach(visit)
  }
  visit(payload)
  return [...contacts.values()]
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
