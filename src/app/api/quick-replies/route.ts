import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { parseAutomationNumberId } from '@/lib/automations/number-scope'
import {
  assertNumberWriteAccess,
  NumberWriteAccessError,
} from '@/lib/whatsapp/number-access'

// Quick replies — reusable snippets (plain text or a saved interactive
// message) shared across the account. GET lists; POST creates. Mirrors
// the automations route: RLS-scoped read via the user client, service-
// role write after an explicit role check.

export async function GET(request: Request) {
  try {
    const { supabase } = await getCurrentAccount()
    // Quick replies are per WhatsApp number (migration 061). With
    // ?whatsapp_number_id= only that number's (and unscoped) replies.
    const numberId = new URL(request.url).searchParams.get('whatsapp_number_id')
    if (numberId && !/^[0-9a-f-]{36}$/i.test(numberId)) {
      return NextResponse.json({ error: 'Invalid whatsapp_number_id' }, { status: 400 })
    }
    // RLS (quick_replies_select) scopes to the caller's account + numbers.
    let query = supabase.from('quick_replies').select('*')
    if (numberId) {
      query = query.or(`whatsapp_number_id.is.null,whatsapp_number_id.eq.${numberId}`)
    }
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ quick_replies: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const kind = body.kind === 'interactive' ? 'interactive' : 'text'
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  let content_text: string | null = null
  let interactive_payload: unknown = null

  if (kind === 'interactive') {
    const result = validateInteractivePayload(body.interactive_payload)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    interactive_payload = body.interactive_payload
  } else {
    const text = typeof body.content_text === 'string' ? body.content_text : ''
    if (!text.trim()) {
      return NextResponse.json(
        { error: 'content_text is required for text quick replies' },
        { status: 400 },
      )
    }
    content_text = text
  }

  // Optional number scope; the service-role insert bypasses RLS, so the
  // account and write-access checks happen here.
  let numberScope: { whatsapp_number_id: string | null } | Record<string, never> = {}
  if ('whatsapp_number_id' in body) {
    const parsed = await parseAutomationNumberId(
      supabaseAdmin(),
      ctx.accountId,
      body.whatsapp_number_id,
    )
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    try {
      await assertNumberWriteAccess({ ...ctx, numberId: parsed.value })
    } catch (error) {
      if (error instanceof NumberWriteAccessError) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      throw error
    }
    numberScope = { whatsapp_number_id: parsed.value }
  }

  const { data, error } = await supabaseAdmin()
    .from('quick_replies')
    .insert({
      account_id: ctx.accountId,
      user_id: ctx.userId,
      title,
      kind,
      content_text,
      interactive_payload,
      ...numberScope,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ quick_reply: data }, { status: 201 })
}
