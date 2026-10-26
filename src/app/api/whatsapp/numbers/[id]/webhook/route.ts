import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { getPhoneNumberStatus } from '@/lib/whatsapp/meta-api'
import {
  applyWebhookRouting,
  buildWebhookCallbackUrl,
  classifyWebhookTarget,
  errorText,
  generateVerifyToken,
  isMissingRoutingColumnError,
  ROUTING_MIGRATION_HINT,
  WEBHOOK_ROUTING_COLUMNS,
  type WebhookRoutingRow,
} from '@/lib/whatsapp/coexistence-connect'
import { normalizeRelayUrl } from '@/lib/whatsapp/webhook-relay'
import {
  SERVER_NUMBER_COLUMNS,
  type WhatsAppNumberRow,
} from '@/lib/whatsapp/numbers'

type Params = { params: Promise<{ id: string }> }

async function loadNumber(
  supabase: SupabaseClient,
  accountId: string,
  id: string,
): Promise<WhatsAppNumberRow | null> {
  const { data } = await supabase
    .from('whatsapp_numbers')
    .select(SERVER_NUMBER_COLUMNS)
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as unknown as WhatsAppNumberRow | null) ?? null
}

async function loadRouting(
  supabase: SupabaseClient,
  id: string,
): Promise<{ routing: WebhookRoutingRow | null; migrationApplied: boolean }> {
  const { data, error } = await supabase
    .from('whatsapp_numbers')
    .select(WEBHOOK_ROUTING_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    return { routing: null, migrationApplied: !isMissingRoutingColumnError(error) }
  }
  return {
    routing: (data as unknown as WebhookRoutingRow | null) ?? null,
    migrationApplied: true,
  }
}

/** Where Meta currently delivers this number's webhooks + relay status. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { id } = await params
    const number = await loadNumber(supabase, accountId, id)
    if (!number) {
      return NextResponse.json({ error: 'WhatsApp number not found' }, { status: 404 })
    }
    const { routing, migrationApplied } = await loadRouting(supabase, id)

    let callbackUrl: string | null = null
    let callbackError: string | null = null
    try {
      callbackUrl = buildWebhookCallbackUrl()
    } catch (error) {
      callbackError = errorText(error)
    }

    let meta: { target: string; url: string | null } | null = null
    let metaError: string | null = null
    if (!number.access_token) {
      metaError = 'This number has no access token (it may be disconnected)'
    } else {
      try {
        const status = await getPhoneNumberStatus({
          phoneNumberId: number.phone_number_id,
          accessToken: decrypt(number.access_token),
        })
        meta = classifyWebhookTarget(status.webhook_configuration, callbackUrl ?? '')
      } catch (error) {
        metaError = errorText(error)
      }
    }

    return NextResponse.json({
      callback_url: callbackUrl,
      callback_error: callbackError,
      meta_target: meta?.target ?? null,
      meta_url: meta?.url ?? null,
      meta_error: metaError,
      routing,
      migration_applied: migrationApplied,
      migration_hint: migrationApplied ? null : ROUTING_MIGRATION_HINT,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** "Take over": point this number's webhooks at this deployment. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner')
    const limit = checkRateLimit(`whatsapp-manual:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const number = await loadNumber(supabase, accountId, id)
    if (!number) {
      return NextResponse.json({ error: 'WhatsApp number not found' }, { status: 404 })
    }
    if (!number.access_token || !number.waba_id) {
      return NextResponse.json(
        { error: 'This number needs an access token and WABA ID before webhooks can be routed' },
        { status: 400 },
      )
    }

    // Reuse the stored verify token when readable; otherwise mint and store
    // one first, because Meta calls the GET handshake during the override.
    let verifyToken: string | null = null
    if (number.verify_token) {
      try {
        verifyToken = decrypt(number.verify_token)
      } catch {
        verifyToken = null
      }
    }
    if (!verifyToken) {
      verifyToken = generateVerifyToken()
      const { error } = await supabase
        .from('whatsapp_numbers')
        .update({ verify_token: encrypt(verifyToken) })
        .eq('id', id)
      if (error) {
        return NextResponse.json({ error: 'Failed to store verify token' }, { status: 500 })
      }
    }

    const result = await applyWebhookRouting({
      supabase,
      numberRowId: id,
      wabaId: number.waba_id,
      phoneNumberId: number.phone_number_id,
      accessToken: decrypt(number.access_token),
      verifyToken,
    })
    if (!result.routed) {
      return NextResponse.json({ error: result.error ?? 'Webhook routing failed' }, { status: 400 })
    }
    return NextResponse.json({ routed: true, callback_url: result.callbackUrl })
  } catch (error) {
    return toErrorResponse(error)
  }
}

interface RelayBody {
  enabled?: unknown
  url?: unknown
}

/** Configure the optional copy-to-another-system relay for this number. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { id } = await params
    const number = await loadNumber(supabase, accountId, id)
    if (!number) {
      return NextResponse.json({ error: 'WhatsApp number not found' }, { status: 404 })
    }
    const body = (await request.json().catch(() => null)) as RelayBody | null
    if (!body || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
    }

    const updates: Record<string, unknown> = { webhook_relay_enabled: body.enabled }
    if (typeof body.url === 'string' && body.url.trim()) {
      try {
        updates.webhook_relay_url = normalizeRelayUrl(
          body.url,
          number.display_phone_number,
        )
      } catch (error) {
        return NextResponse.json({ error: errorText(error) }, { status: 400 })
      }
    } else if (body.enabled) {
      const { routing } = await loadRouting(supabase, id)
      if (!routing?.webhook_relay_url) {
        return NextResponse.json({ error: 'Enter the relay URL' }, { status: 400 })
      }
    }

    const { error } = await supabase
      .from('whatsapp_numbers')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) {
      if (isMissingRoutingColumnError(error)) {
        return NextResponse.json({ error: ROUTING_MIGRATION_HINT }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to save relay settings' }, { status: 500 })
    }
    const { routing } = await loadRouting(supabase, id)
    return NextResponse.json({ routing })
  } catch (error) {
    return toErrorResponse(error)
  }
}
