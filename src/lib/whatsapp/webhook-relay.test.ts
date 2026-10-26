import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  collectWebhookTargets,
  normalizeRelayUrl,
  relayAllowedHosts,
  relayWebhookCopies,
} from './webhook-relay'

describe('normalizeRelayUrl', () => {
  const allowed = ['10.0.0.111:3001']

  it('expands a bare Chatwoot base URL to its per-number webhook route', () => {
    expect(normalizeRelayUrl('http://10.0.0.111:3001', '+971 50 123 4567', allowed)).toBe(
      'http://10.0.0.111:3001/webhooks/whatsapp/+971501234567',
    )
  })

  it('keeps an explicit path', () => {
    expect(normalizeRelayUrl('http://10.0.0.111:3001/custom/hook', null, allowed)).toBe(
      'http://10.0.0.111:3001/custom/hook',
    )
  })

  it('refuses hosts that are not allow-listed, and everything when the list is empty', () => {
    expect(() => normalizeRelayUrl('http://169.254.169.254/', '+1', allowed)).toThrow(/not in/)
    expect(() => normalizeRelayUrl('http://10.0.0.111:3001/', '+1', [])).toThrow(/disabled/)
  })

  it('refuses non-http schemes and embedded credentials', () => {
    expect(() => normalizeRelayUrl('ftp://10.0.0.111:3001/', '+1', allowed)).toThrow(/http/)
    expect(() => normalizeRelayUrl('http://u:p@10.0.0.111:3001/', '+1', allowed)).toThrow(/credentials/)
  })

  it('parses the allow-list env var', () => {
    expect(relayAllowedHosts(' 10.0.0.111:3001 , Chat.Example.com ,')).toEqual([
      '10.0.0.111:3001',
      'chat.example.com',
    ])
  })
})

describe('collectWebhookTargets', () => {
  it('collects phone ids and WABA ids only for entries without phone ids', () => {
    expect(
      collectWebhookTargets({
        entry: [
          { id: 'WABA1', changes: [{ value: { metadata: { phone_number_id: '111' } } }] },
          { id: 'WABA2', changes: [{ value: { event: 'APPROVED' } }] },
        ],
      }),
    ).toEqual({ phoneNumberIds: ['111'], wabaIdsWithoutPhone: ['WABA2'] })
  })
})

function relayDb(rows: Array<{ id: string; webhook_relay_url: string | null }>) {
  const updates: Array<Record<string, unknown>> = []
  const orFilters: string[] = []
  const db = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                or(filter: string) {
                  orFilters.push(filter)
                  return Promise.resolve({ data: rows, error: null })
                },
              }
            },
          }
        },
        update(values: Record<string, unknown>) {
          updates.push(values)
          return { in: () => Promise.resolve({ error: null }) }
        },
      }
    },
  } as unknown as SupabaseClient
  return { db, updates, orFilters }
}

describe('relayWebhookCopies', () => {
  const body = {
    entry: [{ id: '900', changes: [{ value: { metadata: { phone_number_id: '111' } } }] }],
  }

  it('forwards the raw body and Meta signature unchanged, once per URL', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS', '10.0.0.111:3001')
    const url = 'http://10.0.0.111:3001/webhooks/whatsapp/+9715'
    const { db, updates, orFilters } = relayDb([
      { id: 'n1', webhook_relay_url: url },
      { id: 'n2', webhook_relay_url: url },
    ])
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }))
    const rawBody = '{"entry":[ "exact bytes" ]}'

    await relayWebhookCopies({ admin: db, rawBody, signature: 'sha256=abc', body, fetchImpl })

    expect(orFilters[0]).toBe('phone_number_id.in.(111)')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(target).toBe(url)
    expect(init.body).toBe(rawBody)
    expect((init.headers as Record<string, string>)['X-Hub-Signature-256']).toBe('sha256=abc')
    expect(init.redirect).toBe('manual')
    expect(updates[0]).toMatchObject({ last_webhook_relay_status: 200, last_webhook_relay_error: null })
    vi.unstubAllEnvs()
  })

  it('does nothing when no number has a relay enabled', async () => {
    const { db } = relayDb([])
    const fetchImpl = vi.fn()
    await relayWebhookCopies({ admin: db, rawBody: '{}', signature: null, body, fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('records receiver failures without throwing', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS', '10.0.0.111:3001')
    const { db, updates } = relayDb([
      { id: 'n1', webhook_relay_url: 'http://10.0.0.111:3001/webhooks/whatsapp/+9715' },
    ])
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    await expect(
      relayWebhookCopies({ admin: db, rawBody: '{}', signature: null, body, fetchImpl }),
    ).resolves.toBeUndefined()
    expect(updates[0]).toMatchObject({
      last_webhook_relay_status: null,
      last_webhook_relay_error: 'connect ECONNREFUSED',
    })
    vi.unstubAllEnvs()
  })

  it('skips targets whose host was removed from the allow-list', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS', '')
    const { db, updates } = relayDb([
      { id: 'n1', webhook_relay_url: 'http://10.0.0.111:3001/webhooks/whatsapp/+9715' },
    ])
    const fetchImpl = vi.fn()
    await relayWebhookCopies({ admin: db, rawBody: '{}', signature: null, body, fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(updates[0]).toMatchObject({ last_webhook_relay_error: expect.stringMatching(/not in/) })
    vi.unstubAllEnvs()
  })
})
