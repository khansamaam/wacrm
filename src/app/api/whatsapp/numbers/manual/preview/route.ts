import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  errorText,
  previewManualConnection,
} from '@/lib/whatsapp/coexistence-connect'

interface PreviewBody {
  waba_id?: unknown
  access_token?: unknown
}

/**
 * Validate a WABA ID + System User token (from any Meta Business) and list
 * the phone numbers it manages, flagging the ones this workspace already
 * has. Nothing is saved.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner')
    const limit = checkRateLimit(`whatsapp-manual:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as PreviewBody | null
    const wabaId = typeof body?.waba_id === 'string' ? body.waba_id.trim() : ''
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : ''
    if (!/^\d+$/.test(wabaId) || !accessToken) {
      return NextResponse.json(
        { error: 'A numeric WABA ID and an access token are required' },
        { status: 400 },
      )
    }

    let preview
    try {
      preview = await previewManualConnection({ wabaId, accessToken })
    } catch (error) {
      return NextResponse.json({ error: errorText(error) }, { status: 400 })
    }

    const ids = preview.numbers.map((n) => n.phone_number_id)
    const { data: existing, error } = await supabase
      .from('whatsapp_numbers')
      .select('id, phone_number_id, status')
      .eq('account_id', accountId)
      .in('phone_number_id', ids)
    if (error) {
      return NextResponse.json({ error: 'Failed to inspect workspace numbers' }, { status: 500 })
    }
    const existingById = new Map(
      (existing ?? []).map((row) => [row.phone_number_id as string, row]),
    )

    return NextResponse.json({
      waba_id: preview.waba_id,
      numbers: preview.numbers.map((n) => {
        const row = existingById.get(n.phone_number_id)
        return {
          ...n,
          already_connected: Boolean(row),
          existing_number_id: row?.id ?? null,
          existing_status: row?.status ?? null,
        }
      }),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
