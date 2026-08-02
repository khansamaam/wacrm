import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  SERVER_NUMBER_COLUMNS,
  sanitizeWhatsAppNumber,
  type WhatsAppNumberRow,
} from '@/lib/whatsapp/numbers'

interface UpdateNumberBody {
  label?: unknown
  meta_app_id?: unknown
  meta_app_secret?: unknown
  meta_coexistence_config_id?: unknown
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as UpdateNumberBody | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const updates: Record<string, string | null> = {}
    if (typeof body.label === 'string') {
      const label = body.label.trim()
      if (!label || label.length > 80) {
        return NextResponse.json({ error: 'Label must be between 1 and 80 characters' }, { status: 400 })
      }
      updates.label = label
    }
    if (typeof body.meta_app_id === 'string') {
      updates.meta_app_id = body.meta_app_id.trim() || null
    }
    if (typeof body.meta_coexistence_config_id === 'string') {
      updates.meta_coexistence_config_id = body.meta_coexistence_config_id.trim() || null
    }
    if (typeof body.meta_app_secret === 'string' && body.meta_app_secret.trim()) {
      try {
        updates.meta_app_secret = encrypt(body.meta_app_secret.trim())
      } catch {
        return NextResponse.json(
          { error: 'Failed to encrypt Meta App Secret. Verify ENCRYPTION_KEY.' },
          { status: 500 },
        )
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes submitted' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('whatsapp_numbers')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SERVER_NUMBER_COLUMNS)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Failed to update number' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    return NextResponse.json({
      number: sanitizeWhatsAppNumber(data as unknown as WhatsAppNumberRow),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/** Soft-disconnect: history remains attributable and other numbers are untouched. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { id } = await params
    const { data: current, error: currentError } = await supabase
      .from('whatsapp_numbers')
      .select('id, is_default')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (currentError) return NextResponse.json({ error: 'Failed to load number' }, { status: 500 })
    if (!current) return NextResponse.json({ error: 'Number not found' }, { status: 404 })

    if (current.is_default) {
      const { data: replacement } = await supabase
        .from('whatsapp_numbers')
        .select('id')
        .eq('account_id', accountId)
        .eq('status', 'connected')
        .neq('id', id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      const { error: demoteError } = await supabase
        .from('whatsapp_numbers')
        .update({ is_default: false })
        .eq('id', id)
      if (demoteError) return NextResponse.json({ error: 'Failed to change default number' }, { status: 500 })

      if (replacement) {
        const { error: promoteError } = await supabase
          .from('whatsapp_numbers')
          .update({ is_default: true })
          .eq('id', replacement.id)
        if (promoteError) return NextResponse.json({ error: 'Failed to promote replacement number' }, { status: 500 })
      }
    }

    const { error } = await supabase
      .from('whatsapp_numbers')
      .update({
        status: 'disconnected',
        access_token: null,
        verify_token: null,
        disconnected_at: new Date().toISOString(),
        is_default: false,
      })
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Failed to disconnect number' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
