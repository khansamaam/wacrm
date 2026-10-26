import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { processPendingCoexistenceSyncJobs } from '@/lib/whatsapp/coexistence-sync'
import {
  applyWebhookRouting,
  errorText,
  generateVerifyToken,
  isMissingRoutingColumnError,
  MAX_NUMBERS_PER_CONNECT,
  previewManualConnection,
  resolveMetaAppCredentials,
} from '@/lib/whatsapp/coexistence-connect'
import { normalizeRelayUrl } from '@/lib/whatsapp/webhook-relay'
import {
  insertWhatsAppNumberRow,
  sanitizeWhatsAppNumber,
  type WhatsAppNumberRow,
} from '@/lib/whatsapp/numbers'

const MAX_LABEL_LENGTH = 80

interface ManualConnectBody {
  waba_id?: unknown
  access_token?: unknown
  phone_number_ids?: unknown
  labels?: unknown
  meta_app_id?: unknown
  meta_app_secret?: unknown
  request_history_sync?: unknown
  relay_url?: unknown
}

interface ConnectResult {
  phone_number_id: string
  ok: boolean
  error?: string
  number?: ReturnType<typeof sanitizeWhatsAppNumber>
  webhook_routed?: boolean
  webhook_error?: string | null
  relay_error?: string | null
}

/**
 * Connect one or more numbers from a WABA owned by ANY Meta Business using
 * a System User token (Chatwoot-style "manual setup"). WhatsApp Business App
 * numbers are stored as coexistence and are never re-registered, so the
 * phone app keeps working. Each number gets its own row, verify token and
 * phone-level webhook override pointing at this deployment.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner')
    const limit = checkRateLimit(`whatsapp-manual:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as ManualConnectBody | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const wabaId = typeof body.waba_id === 'string' ? body.waba_id.trim() : ''
    const accessToken =
      typeof body.access_token === 'string' ? body.access_token.trim() : ''
    const phoneNumberIds = Array.isArray(body.phone_number_ids)
      ? [
          ...new Set(
            body.phone_number_ids
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter((id) => /^\d+$/.test(id)),
          ),
        ]
      : []
    const labels =
      body.labels && typeof body.labels === 'object' && !Array.isArray(body.labels)
        ? (body.labels as Record<string, unknown>)
        : {}
    const requestHistorySync = body.request_history_sync === true
    const relayInput =
      typeof body.relay_url === 'string' ? body.relay_url.trim() : ''

    if (!/^\d+$/.test(wabaId) || !accessToken) {
      return NextResponse.json(
        { error: 'A numeric WABA ID and an access token are required' },
        { status: 400 },
      )
    }
    if (phoneNumberIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one phone number to connect' },
        { status: 400 },
      )
    }
    if (phoneNumberIds.length > MAX_NUMBERS_PER_CONNECT) {
      return NextResponse.json(
        { error: `Connect at most ${MAX_NUMBERS_PER_CONNECT} numbers at a time` },
        { status: 400 },
      )
    }

    const credentials = resolveMetaAppCredentials({
      appId: typeof body.meta_app_id === 'string' ? body.meta_app_id : undefined,
      appSecret:
        typeof body.meta_app_secret === 'string' ? body.meta_app_secret : undefined,
    })
    if (!credentials.appSecret) {
      return NextResponse.json(
        {
          error:
            'A Meta App Secret is required to verify webhook signatures. Enter the App Secret of the app the token belongs to, or set META_COEXISTENCE_APP_SECRET / META_APP_SECRET on the server.',
        },
        { status: 400 },
      )
    }

    let preview
    try {
      preview = await previewManualConnection({ wabaId, accessToken })
    } catch (error) {
      return NextResponse.json({ error: errorText(error) }, { status: 400 })
    }
    const previewById = new Map(preview.numbers.map((n) => [n.phone_number_id, n]))

    const { count, error: countError } = await supabase
      .from('whatsapp_numbers')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (countError) {
      return NextResponse.json({ error: 'Failed to inspect workspace numbers' }, { status: 500 })
    }
    let workspaceHasNumbers = (count ?? 0) > 0

    let encryptedAccessToken: string
    let encryptedAppSecret: string
    try {
      encryptedAccessToken = encrypt(accessToken)
      encryptedAppSecret = encrypt(credentials.appSecret)
    } catch {
      return NextResponse.json(
        { error: 'Failed to encrypt credentials. Verify ENCRYPTION_KEY.' },
        { status: 500 },
      )
    }

    const results: ConnectResult[] = []
    for (const phoneNumberId of phoneNumberIds) {
      const info = previewById.get(phoneNumberId)
      if (!info) {
        results.push({
          phone_number_id: phoneNumberId,
          ok: false,
          error: 'This Phone Number ID does not belong to the WhatsApp Business Account',
        })
        continue
      }
      if (!info.ready) {
        results.push({
          phone_number_id: phoneNumberId,
          ok: false,
          error: 'Complete phone number verification in Meta before connecting this number',
        })
        continue
      }

      const rawLabel = labels[phoneNumberId]
      const label =
        typeof rawLabel === 'string' && rawLabel.trim()
          ? rawLabel.trim().slice(0, MAX_LABEL_LENGTH)
          : (info.verified_name || info.display_phone_number || 'WhatsApp').slice(
              0,
              MAX_LABEL_LENGTH,
            )

      const isCoexistence = info.is_on_biz_app
      const verifyToken = generateVerifyToken()
      const now = new Date().toISOString()
      const { data, error } = await insertWhatsAppNumberRow(supabase, {
          account_id: accountId,
          created_by_user_id: userId,
          label,
          phone_number_id: phoneNumberId,
          display_phone_number: info.display_phone_number || null,
          waba_id: wabaId,
          connection_method: isCoexistence ? 'coexistence' : 'cloud_api',
          access_token: encryptedAccessToken,
          verify_token: encrypt(verifyToken),
          meta_app_id: credentials.appId || null,
          meta_app_secret: encryptedAppSecret,
          status: 'connected',
          is_default: !workspaceHasNumbers,
          connected_at: now,
          is_on_biz_app: info.is_on_biz_app,
          platform_type: info.platform_type,
          ...(isCoexistence ? { coexistence_onboarded_at: now } : {}),
          ...(isCoexistence && requestHistorySync
            ? {
                history_sync_status: 'pending',
                history_sync_requested_at: now,
                contacts_sync_status: 'pending',
                contacts_sync_requested_at: now,
              }
            : {}),
        })

      if (error) {
        results.push({
          phone_number_id: phoneNumberId,
          ok: false,
          error:
            error.code === '23505'
              ? 'This WhatsApp number is already connected to a workspace'
              : 'Failed to save WhatsApp number',
        })
        if (error.code !== '23505') {
          console.error('[POST /api/whatsapp/numbers/manual] insert failed:', error)
        }
        continue
      }
      workspaceHasNumbers = true
      const row = data as unknown as WhatsAppNumberRow

      const routing = await applyWebhookRouting({
        supabase,
        numberRowId: row.id,
        wabaId,
        phoneNumberId,
        accessToken,
        verifyToken,
        connectionSource: 'manual',
      })

      let relayError: string | null = null
      if (relayInput) {
        try {
          const relayUrl = normalizeRelayUrl(relayInput, info.display_phone_number)
          const { error: relayUpdateError } = await supabase
            .from('whatsapp_numbers')
            .update({ webhook_relay_enabled: true, webhook_relay_url: relayUrl })
            .eq('id', row.id)
          if (relayUpdateError) {
            relayError = isMissingRoutingColumnError(relayUpdateError)
              ? 'Apply database migration 057 to enable relays'
              : 'Failed to save relay settings'
          }
        } catch (error) {
          relayError = errorText(error)
        }
      }

      if (isCoexistence && requestHistorySync) {
        const { error: jobError } = await supabase.from('whatsapp_sync_jobs').insert([
          { whatsapp_number_id: row.id, account_id: accountId, sync_type: 'history' },
          { whatsapp_number_id: row.id, account_id: accountId, sync_type: 'contacts' },
        ])
        if (jobError) {
          console.warn('[POST /api/whatsapp/numbers/manual] sync job creation failed:', jobError.message)
        } else {
          try {
            await processPendingCoexistenceSyncJobs(supabase, {
              whatsappNumberId: row.id,
              limit: 2,
            })
          } catch (syncError) {
            console.warn('[POST /api/whatsapp/numbers/manual] sync request failed:', errorText(syncError))
          }
        }
      }

      results.push({
        phone_number_id: phoneNumberId,
        ok: true,
        number: sanitizeWhatsAppNumber(row),
        webhook_routed: routing.routed,
        webhook_error: routing.error,
        relay_error: relayError,
      })
    }

    const anyConnected = results.some((r) => r.ok)
    return NextResponse.json(
      { results },
      { status: anyConnected ? 201 : 400 },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
