import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturningRows(rows: Record<string, unknown>[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    // Awaited list query (per-number lookup, migration 062).
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  return dbReturningRows(row ? [{ ...row, whatsapp_number_id: null }] : [])
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

describe('loadAiConfig per WhatsApp number (migration 062)', () => {
  const active = { ...ROW, is_active: true }

  it("uses the number's own config over the account-wide one", async () => {
    const db = dbReturningRows([
      { ...active, model: 'account-wide', whatsapp_number_id: null },
      { ...active, model: 'clinic', whatsapp_number_id: 'num-clinic' },
    ])
    const config = await loadAiConfig(db, 'acct', { whatsappNumberId: 'num-clinic' })
    expect(config?.model).toBe('clinic')
  })

  it('falls back to the account-wide config for a number without its own', async () => {
    const db = dbReturningRows([
      { ...active, model: 'account-wide', whatsapp_number_id: null },
      { ...active, model: 'clinic', whatsapp_number_id: 'num-clinic' },
    ])
    const config = await loadAiConfig(db, 'acct', { whatsappNumberId: 'num-other' })
    expect(config?.model).toBe('account-wide')
  })

  it("never uses another number's config", async () => {
    const db = dbReturningRows([
      { ...active, model: 'clinic', whatsapp_number_id: 'num-clinic' },
    ])
    expect(await loadAiConfig(db, 'acct', { whatsappNumberId: 'num-other' })).toBeNull()
  })
})
