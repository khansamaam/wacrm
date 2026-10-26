import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { errorText } from '@/lib/whatsapp/coexistence-connect'
import { decrypt } from '@/lib/whatsapp/encryption'
import { requestSmbAppDataSync } from '@/lib/whatsapp/meta-api'
import {
  SERVER_NUMBER_COLUMNS,
  type WhatsAppNumberRow,
} from '@/lib/whatsapp/numbers'

type Params = { params: Promise<{ id: string }> }

type SyncKind = 'history' | 'contacts'

/**
 * Ask Meta to send a coexistence number's WhatsApp Business App chat
 * history (and contacts). Meta delivers the data later through the
 * `history` / `smb_app_state_sync` webhooks, which the existing webhook
 * pipeline imports. Meta only accepts this within 24 hours of the number
 * being onboarded, and only if the owner chose to share history on the
 * phone; otherwise its error is returned as-is so the owner sees why.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner')
    const limit = checkRateLimit(`history-sync:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const { data } = await supabase
      .from('whatsapp_numbers')
      .select(SERVER_NUMBER_COLUMNS)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    const number = (data as unknown as WhatsAppNumberRow | null) ?? null
    if (!number) {
      return NextResponse.json({ error: 'WhatsApp number not found' }, { status: 404 })
    }
    if (number.connection_method !== 'coexistence') {
      return NextResponse.json(
        { error: 'Chat history import is only available for WhatsApp Business App (coexistence) numbers.' },
        { status: 400 },
      )
    }
    if (!number.access_token) {
      return NextResponse.json(
        { error: 'This number has no access token (it may be disconnected).' },
        { status: 400 },
      )
    }

    const accessToken = decrypt(number.access_token)
    const results: Record<SyncKind, { ok: boolean; request_id?: string; error?: string }> = {
      history: { ok: false },
      contacts: { ok: false },
    }
    for (const kind of ['history', 'contacts'] as const) {
      const syncType = kind === 'history' ? 'history' : 'smb_app_state_sync'
      let result: { ok: boolean; request_id?: string; error?: string }
      try {
        const accepted = await requestSmbAppDataSync({
          phoneNumberId: number.phone_number_id,
          accessToken,
          syncType,
        })
        result = { ok: true, request_id: accepted.request_id }
      } catch (error) {
        result = { ok: false, error: errorText(error) }
      }
      results[kind] = result

      // Keep a record next to the jobs the connect flow creates.
      await supabase.from('whatsapp_sync_jobs').insert({
        whatsapp_number_id: number.id,
        account_id: accountId,
        sync_type: kind,
        status: result.ok ? 'completed' : 'failed',
        // A failed manual request is final (Meta's answer won't change on
        // retry), so keep the background job runner from re-sending it.
        attempts: result.ok ? 1 : 5,
        processed_count: result.ok ? 1 : 0,
        last_error: result.error?.slice(0, 2000) ?? null,
        metadata: result.ok ? { request_id: result.request_id, sync_type: syncType } : {},
        completed_at: result.ok ? new Date().toISOString() : null,
      })
    }

    if (results.history.ok) {
      await supabase
        .from('whatsapp_numbers')
        .update({ history_sync_status: 'pending' })
        .eq('id', number.id)
        .eq('account_id', accountId)
    }

    return NextResponse.json({ results })
  } catch (error) {
    return toErrorResponse(error)
  }
}
