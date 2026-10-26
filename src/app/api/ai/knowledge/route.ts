import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey, resolveAiNumberScope } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

/**
 * GET /api/ai/knowledge
 *
 * List the account's knowledge-base documents (any member).
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    // Knowledge is per WhatsApp number (migration 062): with
    // ?whatsapp_number_id= list that number's and account-wide documents.
    const scope = await resolveAiNumberScope(
      supabase,
      accountId,
      new URL(request.url).searchParams.get('whatsapp_number_id'),
    )
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: 400 })
    }
    let query = supabase
      .from('ai_knowledge_documents')
      .select('*')
      .eq('account_id', accountId)
    if (scope.numberId) {
      query = query.or(
        `whatsapp_number_id.is.null,whatsapp_number_id.eq.${scope.numberId}`,
      )
    }
    const { data: rows, error } = await query.order('updated_at', {
      ascending: false,
    })
    // List view only: never ship document bodies here.
    const data = (rows ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      updated_at: row.updated_at as string,
      whatsapp_number_id: (row.whatsapp_number_id as string | null | undefined) ?? null,
    }))
    if (error) {
      console.error('[ai/knowledge GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load knowledge base' },
        { status: 500 },
      )
    }
    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/knowledge  (admin+)
 *
 * Create a document, then chunk + (optionally) embed it. If indexing
 * fails the document is still saved so the admin can retry via reindex.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    if (!title || !content) {
      return NextResponse.json(
        { error: 'title and content are required' },
        { status: 400 },
      )
    }

    const scope = await resolveAiNumberScope(supabase, accountId, body?.whatsapp_number_id)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: 400 })
    }
    const numberId = scope.numberId

    const { data: doc, error } = await supabase
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        title,
        content,
        ...(numberId ? { whatsapp_number_id: numberId } : {}),
      })
      .select('id')
      .single()
    if (error || !doc) {
      console.error('[ai/knowledge POST] insert error:', error)
      return NextResponse.json(
        { error: 'Failed to save document' },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
      supabase,
      accountId,
      numberId,
    )
    try {
      await ingestDocument(
        supabase,
        accountId,
        { embeddingsApiKey },
        doc.id,
        content,
        numberId,
      )
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'indexing failed'
      console.error('[ai/knowledge POST] ingest error:', err)
      return NextResponse.json(
        {
          success: true,
          id: doc.id,
          warning: `Saved, but semantic indexing failed (${message}). Lexical search still works; use Reindex to retry.`,
        },
        { status: 200 },
      )
    }

    if (corrupt) {
      return NextResponse.json({
        success: true,
        id: doc.id,
        warning:
          'Saved with keyword search only — your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key).',
      })
    }
    return NextResponse.json({ success: true, id: doc.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
