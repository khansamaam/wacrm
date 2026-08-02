import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { SAFE_NUMBER_COLUMNS } from '@/lib/whatsapp/numbers'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { label?: unknown } | null
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!label || label.length > 80) {
      return NextResponse.json({ error: 'Label must be between 1 and 80 characters' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('whatsapp_numbers')
      .update({ label })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SAFE_NUMBER_COLUMNS)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Failed to update number' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    return NextResponse.json({ number: data })
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
