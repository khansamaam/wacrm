import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveWhatsAppNumber } from './numbers'

const connected = {
  id: 'number-primary',
  account_id: 'account-1',
  created_by_user_id: 'owner-1',
  label: 'Primary',
  phone_number_id: 'PNID-1',
  display_phone_number: '+971500000001',
  waba_id: 'WABA-1',
  connection_method: 'cloud_api',
  access_token: 'encrypted',
  verify_token: null,
  status: 'connected',
  is_default: true,
} as const

interface Fixture {
  numbers: Array<Record<string, unknown>>
  conversationNumberId?: string | null
}

/** Small PostgREST-style query double that applies the filters the resolver uses. */
function makeDb(fixture: Fixture): SupabaseClient {
  return {
    from(table: string) {
      let filters: Array<[string, unknown]> = []
      let limit: number | null = null
      const builder = {
        select() { return builder },
        eq(column: string, value: unknown) {
          filters = [...filters, [column, value]]
          return builder
        },
        limit(value: number) {
          limit = value
          return builder
        },
        async maybeSingle() {
          if (table === 'conversations') {
            return {
              data: fixture.conversationNumberId === undefined
                ? null
                : { whatsapp_number_id: fixture.conversationNumberId },
              error: null,
            }
          }
          const rows = filteredRows()
          return { data: rows[0] ?? null, error: null }
        },
        then(resolve: (value: { data: unknown[]; error: null }) => void) {
          resolve({ data: filteredRows(), error: null })
        },
      }

      function filteredRows() {
        if (table !== 'whatsapp_numbers') return []
        const rows = fixture.numbers.filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        )
        return limit === null ? rows : rows.slice(0, limit)
      }

      return builder
    },
  } as unknown as SupabaseClient
}

describe('resolveWhatsAppNumber', () => {
  it('uses the connected workspace default when no number is selected', async () => {
    const result = await resolveWhatsAppNumber({
      supabase: makeDb({ numbers: [connected] }),
      accountId: 'account-1',
    })
    expect(result.id).toBe('number-primary')
  })

  it('keeps a conversation on its original sender number', async () => {
    const second = {
      ...connected,
      id: 'number-second',
      phone_number_id: 'PNID-2',
      is_default: false,
      connection_method: 'coexistence',
    }
    const result = await resolveWhatsAppNumber({
      supabase: makeDb({
        numbers: [connected, second],
        conversationNumberId: 'number-second',
      }),
      accountId: 'account-1',
      conversationId: 'conversation-1',
    })
    expect(result.id).toBe('number-second')
  })

  it('rejects a selected number that conflicts with the conversation', async () => {
    await expect(resolveWhatsAppNumber({
      supabase: makeDb({
        numbers: [connected],
        conversationNumberId: 'number-primary',
      }),
      accountId: 'account-1',
      conversationId: 'conversation-1',
      whatsappNumberId: 'number-second',
    })).rejects.toMatchObject({
      code: 'not_accessible',
    })
  })

  it('does not send through a disconnected number', async () => {
    await expect(resolveWhatsAppNumber({
      supabase: makeDb({
        numbers: [{ ...connected, status: 'disconnected' }],
      }),
      accountId: 'account-1',
    })).rejects.toMatchObject({
      code: 'not_connected',
    })
  })
})
