import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
}

/**
 * The config row that applies to a WhatsApp number (migration 062): the
 * number's own config, else the account-wide (unscoped) config. Without a
 * number only the unscoped config — or, before the migration, the single
 * account config — applies.
 */
export async function selectAiConfigRow<T>(
  db: SupabaseClient,
  accountId: string,
  columns: string,
  whatsappNumberId?: string | null,
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await db
    .from('ai_configs')
    .select(`${columns}, whatsapp_number_id`)
    .eq('account_id', accountId)
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') {
      // Migration 062 not applied: one config per account.
      const legacy = await db
        .from('ai_configs')
        .select(columns)
        .eq('account_id', accountId)
        .maybeSingle()
      return { data: (legacy.data as T | null) ?? null, error: legacy.error }
    }
    return { data: null, error }
  }
  const rows = (data ?? []) as unknown as Array<T & { whatsapp_number_id: string | null }>
  const own = whatsappNumberId
    ? rows.find((row) => row.whatsapp_number_id === whatsappNumberId)
    : undefined
  const unscoped = rows.find((row) => row.whatsapp_number_id === null)
  return { data: (own ?? unscoped ?? null) as T | null, error: null }
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean; whatsappNumberId?: string | null } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await selectAiConfigRow<AiConfigRow>(
    db,
    accountId,
    CONFIG_COLUMNS,
    opts.whatsappNumberId,
  )

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
  whatsappNumberId?: string | null,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await selectAiConfigRow<{ embeddings_api_key: string | null }>(
    db,
    accountId,
    'embeddings_api_key',
    whatsappNumberId,
  )
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}

/**
 * Validate an optional WhatsApp number id for AI settings routes. The
 * RLS-scoped client only sees numbers the caller can access, so a foreign
 * or inaccessible id resolves to "not found". Returns null for the
 * account-wide scope (no number).
 */
export async function resolveAiNumberScope(
  db: SupabaseClient,
  accountId: string,
  raw: unknown,
): Promise<{ ok: true; numberId: string | null } | { ok: false; error: string }> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, numberId: null }
  }
  if (typeof raw !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw)) {
    return { ok: false, error: 'Invalid whatsapp_number_id' }
  }
  const { data } = await db
    .from('whatsapp_numbers')
    .select('id')
    .eq('id', raw)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return { ok: false, error: 'WhatsApp number not found' }
  return { ok: true, numberId: raw }
}
