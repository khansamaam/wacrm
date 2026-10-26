import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  assertNumberWriteAccess,
  isMissingAccessLevelSupport,
  loadMyNumberAccessLevels,
  NumberWriteAccessError,
  parseNumberAccessList,
} from './number-access'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('parseNumberAccessList', () => {
  it('parses level-aware entries and keeps the strongest duplicate', () => {
    expect(
      parseNumberAccessList([
        { id: A, level: 'view' },
        { id: B, level: 'full' },
        { id: A, level: 'full' },
      ]),
    ).toEqual([
      { id: A, level: 'full' },
      { id: B, level: 'full' },
    ])
  })

  it('treats the legacy id list as full access', () => {
    expect(parseNumberAccessList(undefined, [A])).toEqual([{ id: A, level: 'full' }])
  })

  it('rejects bad levels, bad ids and non-arrays', () => {
    expect(parseNumberAccessList([{ id: A, level: 'admin' }])).toBeNull()
    expect(parseNumberAccessList([{ id: 'not-a-uuid', level: 'view' }])).toBeNull()
    expect(parseNumberAccessList('x')).toBeNull()
    expect(parseNumberAccessList(undefined, 'x')).toBeNull()
  })

  it('returns an empty list when nothing is given', () => {
    expect(parseNumberAccessList(undefined, [])).toEqual([])
  })
})

describe('isMissingAccessLevelSupport', () => {
  it('detects a missing column or RPC from migration 059', () => {
    expect(isMissingAccessLevelSupport({ code: '42703' })).toBe(true)
    expect(isMissingAccessLevelSupport({ code: 'PGRST202' })).toBe(true)
    expect(isMissingAccessLevelSupport({ code: '42501', message: 'denied' })).toBe(false)
  })
})

function db(fixture: {
  mode?: 'all' | 'selected'
  rows?: Array<{ whatsapp_number_id: string; access_level?: string }>
}): SupabaseClient {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { whatsapp_number_access_mode: fixture.mode ?? 'all' },
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve(
            table === 'whatsapp_number_members'
              ? { data: fixture.rows ?? [], error: null }
              : { data: null, error: null },
          ),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

const base = { userId: 'u1', accountId: 'acct', numberIds: [A, B] }

describe('loadMyNumberAccessLevels', () => {
  it('gives owners and all-mode members full access everywhere', async () => {
    const owner = await loadMyNumberAccessLevels({ ...base, role: 'owner', supabase: db({}) })
    expect([...owner.entries()]).toEqual([[A, 'full'], [B, 'full']])
    const all = await loadMyNumberAccessLevels({ ...base, role: 'agent', supabase: db({ mode: 'all' }) })
    expect(all.get(B)).toBe('full')
  })

  it('uses the stored level per number in selected mode; no row = no access', async () => {
    const levels = await loadMyNumberAccessLevels({
      ...base,
      role: 'agent',
      supabase: db({ mode: 'selected', rows: [{ whatsapp_number_id: A, access_level: 'view' }] }),
    })
    expect(levels.get(A)).toBe('view')
    expect(levels.has(B)).toBe(false)
  })

  it('caps workspace viewers at view-only', async () => {
    const levels = await loadMyNumberAccessLevels({ ...base, role: 'viewer', supabase: db({ mode: 'all' }) })
    expect(levels.get(A)).toBe('view')
  })
})

describe('assertNumberWriteAccess', () => {
  it('throws for view-only and passes for full', async () => {
    const supabase = db({
      mode: 'selected',
      rows: [
        { whatsapp_number_id: A, access_level: 'view' },
        { whatsapp_number_id: B, access_level: 'full' },
      ],
    })
    await expect(
      assertNumberWriteAccess({ supabase, userId: 'u1', accountId: 'acct', role: 'agent', numberId: A }),
    ).rejects.toBeInstanceOf(NumberWriteAccessError)
    await expect(
      assertNumberWriteAccess({ supabase, userId: 'u1', accountId: 'acct', role: 'agent', numberId: B }),
    ).resolves.toBeUndefined()
  })

  it('does nothing for legacy rows without a number', async () => {
    await expect(
      assertNumberWriteAccess({ supabase: db({}), userId: 'u1', accountId: 'acct', role: 'viewer', numberId: null }),
    ).resolves.toBeUndefined()
  })
})
