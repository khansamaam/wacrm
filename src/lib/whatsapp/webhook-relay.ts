/**
 * Optional webhook relay: forward an UNMODIFIED copy of a verified Meta
 * webhook (same raw body + X-Hub-Signature-256) to another system that
 * shares the Meta app — e.g. a Chatwoot instance still in use while numbers
 * migrate to this app. Because the body and signature are untouched, the
 * receiver verifies it exactly as if Meta had called it directly.
 *
 * The relay is strictly best-effort: it runs after this app has processed
 * the webhook, never throws, and a down/slow receiver cannot affect inbound
 * processing here. Targets must be explicitly allow-listed by the operator
 * via WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS because they are usually private
 * LAN addresses that the public outbound-webhook SSRF guard would refuse.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingRoutingColumnError } from './coexistence-connect'

export const RELAY_TIMEOUT_MS = 5_000

/** Hosts (`host` or `host:port`) the operator allows relays to reach. */
export function relayAllowedHosts(
  raw: string | undefined = process.env.WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS,
): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Validate and normalise a relay target. A bare base URL such as
 * `http://10.0.0.111:3001` is expanded to Chatwoot's per-number webhook
 * route `/webhooks/whatsapp/+<number>`. Throws a user-facing Error.
 */
export function normalizeRelayUrl(
  input: string,
  displayPhoneNumber: string | null,
  allowedHosts: string[] = relayAllowedHosts(),
): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Relay URL must be a valid http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Relay URL must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('Relay URL must not contain credentials')
  }
  if (!isRelayHostAllowed(url, allowedHosts)) {
    throw new Error(
      allowedHosts.length === 0
        ? 'Relays are disabled. Add the target host to WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS on the server (e.g. 10.0.0.111:3001).'
        : `Host ${url.host} is not in WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS`,
    )
  }
  if (url.pathname === '/' || url.pathname === '') {
    const digits = (displayPhoneNumber ?? '').replace(/\D/g, '')
    if (!digits) {
      throw new Error('Enter the full relay URL; this number has no display phone number to build it from')
    }
    url.pathname = `/webhooks/whatsapp/+${digits}`
  }
  url.hash = ''
  return url.toString()
}

export function isRelayHostAllowed(url: URL, allowedHosts: string[]): boolean {
  const host = url.host.toLowerCase()
  const hostname = url.hostname.toLowerCase()
  return allowedHosts.some((allowed) => allowed === host || allowed === hostname)
}

interface WebhookEntryLike {
  id?: unknown
  changes?: Array<{ value?: Record<string, unknown> | null }>
}

/**
 * Phone number ids referenced by the payload, plus WABA ids for entries
 * that carry no phone number id (template status / account events).
 */
export function collectWebhookTargets(body: { entry?: WebhookEntryLike[] }): {
  phoneNumberIds: string[]
  wabaIdsWithoutPhone: string[]
} {
  const phoneNumberIds = new Set<string>()
  const wabaIds = new Set<string>()
  for (const entry of body.entry ?? []) {
    let entryHasPhone = false
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {}
      const metadata = value.metadata as { phone_number_id?: unknown } | undefined
      for (const candidate of [metadata?.phone_number_id, value.phone_number_id]) {
        if (typeof candidate === 'string' && candidate) {
          phoneNumberIds.add(candidate)
          entryHasPhone = true
        }
      }
    }
    if (!entryHasPhone && typeof entry.id === 'string' && entry.id) {
      wabaIds.add(entry.id)
    }
  }
  return { phoneNumberIds: [...phoneNumberIds], wabaIdsWithoutPhone: [...wabaIds] }
}

/** Ids are Meta numeric strings; anything else is dropped from filters. */
function numericIds(ids: string[]): string[] {
  return ids.filter((id) => /^\d+$/.test(id))
}

/** Best-effort "last webhook received" bookkeeping for the status panel. */
export async function markWebhookReceived(
  admin: SupabaseClient,
  phoneNumberIds: string[],
): Promise<void> {
  const ids = numericIds(phoneNumberIds)
  if (ids.length === 0) return
  try {
    const { error } = await admin
      .from('whatsapp_numbers')
      .update({ last_webhook_received_at: new Date().toISOString() })
      .in('phone_number_id', ids)
    if (error && !isMissingRoutingColumnError(error)) {
      console.warn('[webhook-relay] last_webhook_received_at update failed:', error.message)
    }
  } catch (error) {
    console.warn('[webhook-relay] last_webhook_received_at update failed:', error)
  }
}

interface RelayRow {
  id: string
  webhook_relay_url: string | null
}

/**
 * Forward the raw webhook to every enabled relay target for the numbers in
 * the payload. Each distinct URL receives the payload once. Never throws.
 */
export async function relayWebhookCopies(args: {
  admin: SupabaseClient
  rawBody: string
  signature: string | null
  body: { entry?: WebhookEntryLike[] }
  fetchImpl?: typeof fetch
}): Promise<void> {
  const { admin, rawBody, signature, body } = args
  const doFetch = args.fetchImpl ?? fetch
  try {
    const { phoneNumberIds, wabaIdsWithoutPhone } = collectWebhookTargets(body)
    const phoneIds = numericIds(phoneNumberIds)
    const wabaIds = numericIds(wabaIdsWithoutPhone)
    if (phoneIds.length === 0 && wabaIds.length === 0) return

    const filters: string[] = []
    if (phoneIds.length) filters.push(`phone_number_id.in.(${phoneIds.join(',')})`)
    if (wabaIds.length) filters.push(`waba_id.in.(${wabaIds.join(',')})`)

    const { data, error } = await admin
      .from('whatsapp_numbers')
      .select('id, webhook_relay_url')
      .eq('webhook_relay_enabled', true)
      .or(filters.join(','))
    if (error) {
      if (!isMissingRoutingColumnError(error)) {
        console.warn('[webhook-relay] relay lookup failed:', error.message)
      }
      return
    }

    const rowsByUrl = new Map<string, string[]>()
    for (const row of (data ?? []) as RelayRow[]) {
      if (!row.webhook_relay_url) continue
      const ids = rowsByUrl.get(row.webhook_relay_url) ?? []
      ids.push(row.id)
      rowsByUrl.set(row.webhook_relay_url, ids)
    }
    if (rowsByUrl.size === 0) return

    const allowedHosts = relayAllowedHosts()
    await Promise.all(
      [...rowsByUrl.entries()].map(async ([target, numberIds]) => {
        const result = await sendRelay(doFetch, target, rawBody, signature, allowedHosts)
        const { error: updateError } = await admin
          .from('whatsapp_numbers')
          .update({
            last_webhook_relay_at: new Date().toISOString(),
            last_webhook_relay_status: result.status,
            last_webhook_relay_error: result.error,
          })
          .in('id', numberIds)
        if (updateError) {
          console.warn('[webhook-relay] relay status update failed:', updateError.message)
        }
      }),
    )
  } catch (error) {
    console.warn('[webhook-relay] relay failed:', error)
  }
}

async function sendRelay(
  doFetch: typeof fetch,
  target: string,
  rawBody: string,
  signature: string | null,
  allowedHosts: string[],
): Promise<{ status: number | null; error: string | null }> {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return { status: null, error: 'Invalid relay URL' }
  }
  // Re-check at send time so removing a host from the env var takes
  // effect immediately, even for rows saved earlier.
  if (!isRelayHostAllowed(url, allowedHosts)) {
    return { status: null, error: `Host ${url.host} is not in WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS` }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (signature) headers['X-Hub-Signature-256'] = signature

  try {
    const response = await doFetch(url.toString(), {
      method: 'POST',
      headers,
      body: rawBody,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    })
    return {
      status: response.status,
      error: response.ok ? null : `Receiver responded ${response.status}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: null, error: message.slice(0, 500) }
  }
}
