import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('owner')
    const { id } = await params
    const { data: target } = await supabase
      .from('whatsapp_numbers')
      .select('id, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    if (target.status !== 'connected') {
      return NextResponse.json({ error: 'Only a connected number can be the default' }, { status: 409 })
    }

    const { error: clearError } = await supabase
      .from('whatsapp_numbers')
      .update({ is_default: false })
      .eq('account_id', accountId)
      .eq('is_default', true)
      .neq('id', id)
    if (clearError) return NextResponse.json({ error: 'Failed to change default number' }, { status: 500 })

    const { error } = await supabase
      .from('whatsapp_numbers')
      .update({ is_default: true })
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Failed to set default number' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
