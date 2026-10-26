import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/knowledge/reindex  (admin+)
 *
 * Re-chunk and re-embed every document in the account. The main use is
 * after adding an embeddings key: existing documents were stored
 * lexical-only, and this backfills their vectors so semantic search
 * turns on. Also recovers documents whose indexing failed earlier.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-reindex:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: docs, error } = await supabase
      .from('ai_knowledge_documents')
      .select('*')
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/knowledge/reindex] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load documents' },
        { status: 500 },
      )
    }

    // Documents belong to a WhatsApp number (migration 062); each is
    // embedded with the key of the config that applies to its number.
    const keyByNumber = new Map<string, Awaited<ReturnType<typeof loadEmbeddingsKey>>>()
    const keyFor = async (numberId: string | null) => {
      const cacheKey = numberId ?? ''
      let entry = keyByNumber.get(cacheKey)
      if (!entry) {
        entry = await loadEmbeddingsKey(supabase, accountId, numberId)
        keyByNumber.set(cacheKey, entry)
      }
      return entry
    }
    const numberOf = (doc: Record<string, unknown>) =>
      (doc.whatsapp_number_id as string | null | undefined) ?? null
    let corrupt = false
    for (const doc of docs ?? []) {
      if ((await keyFor(numberOf(doc))).corrupt) corrupt = true
    }
    // The whole point of Reindex is usually to backfill embeddings — so
    // if a key is configured but can't be decrypted, don't quietly do a
    // lexical-only pass and report success. Stop and tell the admin.
    if (corrupt) {
      return NextResponse.json(
        {
          success: false,
          reindexed: 0,
          error:
            'Your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key in Settings → AI Assistant). Nothing was reindexed.',
        },
        { status: 200 },
      )
    }

    let reindexed = 0
    for (const doc of docs ?? []) {
      try {
        const numberId = numberOf(doc)
        const { key: embeddingsApiKey } = await keyFor(numberId)
        await ingestDocument(
          supabase,
          accountId,
          { embeddingsApiKey },
          doc.id as string,
          doc.content as string,
          numberId,
        )
        reindexed += 1
      } catch (err) {
        // One bad document (e.g. a mid-run embeddings rate-limit) should
        // not abort the whole batch.
        const message = err instanceof AiError ? err.message : String(err)
        console.error(`[ai/knowledge/reindex] doc ${doc.id} failed:`, message)
        return NextResponse.json(
          {
            success: false,
            reindexed,
            total: (docs ?? []).length,
            error: `Reindexed ${reindexed}, then hit an error: ${message}`,
          },
          { status: 200 },
        )
      }
    }

    return NextResponse.json({ success: true, reindexed })
  } catch (err) {
    return toErrorResponse(err)
  }
}
