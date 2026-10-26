/**
 * Manual / cross-business WhatsApp number connection.
 *
 * Mirrors the flow Chatwoot uses for "manual setup": the owner supplies a
 * WABA ID plus a System User access token from ANY Meta Business (not just
 * the business that owns the Meta app). We validate the token against Meta,
 * let the owner pick one or more numbers on that WABA, and then route each
 * number's webhooks to this deployment with a phone-level
 * `override_callback_uri` — so no Meta App dashboard change is needed and
 * the number keeps working in the WhatsApp Business App (coexistence).
 */
import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  checkTemplateAccess,
  getTokenPermissions,
  listWabaPhoneNumbers,
  setPhoneNumberWebhookOverride,
  subscribeWabaToApp,
  type PhoneNumberWebhookConfiguration,
  type TokenPermission,
  type WabaPhoneNumber,
} from './meta-api'

export const MESSAGING_PERMISSION = 'whatsapp_business_messaging'
export const MANAGEMENT_PERMISSION = 'whatsapp_business_management'
export const MAX_NUMBERS_PER_CONNECT = 20

/** Webhook routing columns added by migration 057. */
export const WEBHOOK_ROUTING_COLUMNS = [
  'id',
  'connection_source',
  'webhook_override_url',
  'webhook_override_set_at',
  'last_webhook_received_at',
  'webhook_relay_enabled',
  'webhook_relay_url',
  'last_webhook_relay_at',
  'last_webhook_relay_status',
  'last_webhook_relay_error',
].join(', ')

export interface WebhookRoutingRow {
  id: string
  connection_source: 'embedded_signup' | 'manual' | 'legacy' | null
  webhook_override_url: string | null
  webhook_override_set_at: string | null
  last_webhook_received_at: string | null
  webhook_relay_enabled: boolean
  webhook_relay_url: string | null
  last_webhook_relay_at: string | null
  last_webhook_relay_status: number | null
  last_webhook_relay_error: string | null
}

/** PostgREST / Postgres errors meaning "migration 057 is not applied yet". */
export function isMissingRoutingColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return /column .* does not exist|could not find the .* column/i.test(
    error.message ?? '',
  )
}

export const ROUTING_MIGRATION_HINT =
  'Database migration 057_whatsapp_webhook_routing.sql has not been applied yet.'

/** A number is usable when Meta reports it connected or ownership-verified. */
export function isPhoneNumberReady(number: WabaPhoneNumber): boolean {
  return (
    number.status === 'CONNECTED' ||
    number.code_verification_status === 'VERIFIED'
  )
}

/** "+971 50 123 4567" → "+971501234567" (empty string when unknown). */
export function normalizeDisplayPhoneNumber(value: string | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}

/**
 * Pick the number Embedded Signup onboarded. Coexistence completions
 * (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) often carry only `waba_id`, so
 * the number is inferred from the WABA. A provided id is authoritative; with
 * no id only a sole number is unambiguous.
 */
export function resolveOnboardedPhoneNumber(
  numbers: WabaPhoneNumber[],
  phoneNumberId?: string | null,
): WabaPhoneNumber {
  if (numbers.length === 0) {
    throw new Error('Meta returned no phone numbers for this WhatsApp Business Account')
  }
  if (phoneNumberId) {
    const match = numbers.find((n) => String(n.id) === String(phoneNumberId))
    if (!match) {
      throw new Error('This Phone Number ID does not belong to the WhatsApp Business Account')
    }
    return match
  }
  if (numbers.length > 1) {
    throw new Error(
      'This WhatsApp Business Account has several numbers and Meta did not say which one was onboarded. Use Manual connection and select the number.',
    )
  }
  return numbers[0]
}

export function hasGrantedPermission(
  permissions: TokenPermission[],
  permission: string,
): boolean {
  return permissions.some(
    (p) => p.permission === permission && p.status === 'granted',
  )
}

/**
 * The public callback Meta will call for overridden numbers. Meta requires
 * HTTPS, so a missing or non-https NEXT_PUBLIC_SITE_URL is a hard error.
 */
export function buildWebhookCallbackUrl(
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  const base = (siteUrl ?? '').trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL must be set to the public https URL of this app before webhooks can be routed to it',
    )
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_SITE_URL must use https:// — Meta only delivers webhooks over HTTPS')
  }
  return `${parsed.origin}/api/whatsapp/webhook`
}

export type WebhookTarget = 'this_app' | 'elsewhere' | 'app_default'

/** Where Meta currently delivers this number's webhooks. */
export function classifyWebhookTarget(
  config: PhoneNumberWebhookConfiguration | undefined,
  callbackUrl: string,
): { target: WebhookTarget; url: string | null } {
  const override = config?.override_callback_uri?.trim()
  if (override) {
    return {
      target: sameUrl(override, callbackUrl) ? 'this_app' : 'elsewhere',
      url: override,
    }
  }
  const effective =
    config?.phone_number || config?.whatsapp_business_account || config?.application
  if (effective && sameUrl(effective, callbackUrl)) {
    return { target: 'this_app', url: effective }
  }
  return { target: 'app_default', url: effective ?? null }
}

function sameUrl(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '')
}

/** Fresh random verify token for Meta's GET handshake on the override URL. */
export function generateVerifyToken(): string {
  return randomBytes(24).toString('hex')
}

/**
 * Meta app credentials used to verify webhook signatures for a manually
 * connected number. Explicit values win; otherwise the server defaults are
 * used (coexistence app first, then the legacy app).
 */
export function resolveMetaAppCredentials(input: {
  appId?: string
  appSecret?: string
}): { appId: string; appSecret: string } {
  return {
    appId:
      input.appId?.trim() ||
      process.env.META_COEXISTENCE_APP_ID?.trim() ||
      process.env.META_APP_ID?.trim() ||
      '',
    appSecret:
      input.appSecret?.trim() ||
      process.env.META_COEXISTENCE_APP_SECRET?.trim() ||
      process.env.META_APP_SECRET?.trim() ||
      '',
  }
}

export interface PreviewNumber {
  phone_number_id: string
  display_phone_number: string
  verified_name: string | null
  status: string | null
  code_verification_status: string | null
  is_on_biz_app: boolean
  platform_type: string | null
  ready: boolean
}

export interface ConnectionPreview {
  waba_id: string
  numbers: PreviewNumber[]
}

/**
 * Validate a WABA ID + token pair and list the numbers it can manage.
 * Throws an Error with a user-facing message on any failed check.
 */
export async function previewManualConnection(args: {
  wabaId: string
  accessToken: string
}): Promise<ConnectionPreview> {
  const { wabaId, accessToken } = args

  let numbers: WabaPhoneNumber[]
  try {
    numbers = await listWabaPhoneNumbers({ wabaId, accessToken })
  } catch (error) {
    throw new Error(
      `The token cannot read this WhatsApp Business Account's numbers. Check the WABA ID and that the System User has the WABA assigned. ${errorText(error)}`,
    )
  }
  if (numbers.length === 0) {
    throw new Error('Meta returned no phone numbers for this WhatsApp Business Account')
  }

  try {
    await checkTemplateAccess({ wabaId, accessToken })
  } catch (error) {
    throw new Error(
      `The token can see the numbers but not the message templates. Generate the token with the ${MANAGEMENT_PERMISSION} permission. ${errorText(error)}`,
    )
  }

  let permissions: TokenPermission[] = []
  try {
    permissions = await getTokenPermissions({ accessToken })
  } catch {
    // /me/permissions is unavailable for some token types; the send-time
    // error is still explicit, so only block when Meta answers "not granted".
    permissions = []
  }
  if (permissions.length > 0 && !hasGrantedPermission(permissions, MESSAGING_PERMISSION)) {
    throw new Error(
      `The token cannot send WhatsApp messages. Generate the token with the ${MESSAGING_PERMISSION} permission.`,
    )
  }

  return {
    waba_id: wabaId,
    numbers: numbers.map((n) => ({
      phone_number_id: String(n.id),
      display_phone_number: normalizeDisplayPhoneNumber(n.display_phone_number),
      verified_name: n.verified_name ?? null,
      status: n.status ?? null,
      code_verification_status: n.code_verification_status ?? null,
      is_on_biz_app: n.is_on_biz_app === true,
      platform_type: n.platform_type ?? null,
      ready: isPhoneNumberReady(n),
    })),
  }
}

/**
 * Route one number's webhooks to this app: subscribe the app to the WABA
 * (idempotent; required before an override) and set the phone-level
 * override. The number row must already store `verifyToken` (encrypted)
 * because Meta calls the GET handshake synchronously during the override.
 */
export async function routeNumberWebhooksToApp(args: {
  wabaId: string
  phoneNumberId: string
  accessToken: string
  verifyToken: string
  callbackUrl: string
}): Promise<void> {
  await subscribeWabaToApp({ wabaId: args.wabaId, accessToken: args.accessToken })
  await setPhoneNumberWebhookOverride({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    callbackUrl: args.callbackUrl,
    verifyToken: args.verifyToken,
  })
}

export interface WebhookRoutingResult {
  routed: boolean
  callbackUrl: string | null
  error: string | null
}

/**
 * Route a saved number's webhooks to this app and record the outcome on the
 * row. Never throws: a routing failure leaves the number saved so the owner
 * can retry from Settings. Recording is skipped quietly when migration 057
 * is not applied yet.
 */
export async function applyWebhookRouting(args: {
  supabase: SupabaseClient
  numberRowId: string
  wabaId: string
  phoneNumberId: string
  accessToken: string
  verifyToken: string
  connectionSource?: 'embedded_signup' | 'manual'
}): Promise<WebhookRoutingResult> {
  let callbackUrl: string
  try {
    callbackUrl = buildWebhookCallbackUrl()
  } catch (error) {
    await recordRouting(args.supabase, args.numberRowId, {
      ...(args.connectionSource ? { connection_source: args.connectionSource } : {}),
    })
    return { routed: false, callbackUrl: null, error: errorText(error) }
  }

  try {
    await routeNumberWebhooksToApp({
      wabaId: args.wabaId,
      phoneNumberId: args.phoneNumberId,
      accessToken: args.accessToken,
      verifyToken: args.verifyToken,
      callbackUrl,
    })
  } catch (error) {
    await recordRouting(args.supabase, args.numberRowId, {
      ...(args.connectionSource ? { connection_source: args.connectionSource } : {}),
    })
    return { routed: false, callbackUrl, error: errorText(error) }
  }

  const now = new Date().toISOString()
  await recordRouting(args.supabase, args.numberRowId, {
    ...(args.connectionSource ? { connection_source: args.connectionSource } : {}),
    webhook_override_url: callbackUrl,
    webhook_override_set_at: now,
  })
  // subscribed_apps_at predates migration 057, so record it separately.
  await args.supabase
    .from('whatsapp_numbers')
    .update({ subscribed_apps_at: now })
    .eq('id', args.numberRowId)
  return { routed: true, callbackUrl, error: null }
}

async function recordRouting(
  supabase: SupabaseClient,
  numberRowId: string,
  values: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(values).length === 0) return
  const { error } = await supabase
    .from('whatsapp_numbers')
    .update(values)
    .eq('id', numberRowId)
  if (error && !isMissingRoutingColumnError(error)) {
    console.warn('[coexistence-connect] failed to record webhook routing:', error.message)
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
