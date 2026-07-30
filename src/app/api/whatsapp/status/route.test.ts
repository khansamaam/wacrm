import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireRole = vi.fn()
const decrypt = vi.fn(() => 'plain-token')
const verifyPhoneNumber = vi.fn()

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 }
    ),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ verifyPhoneNumber }))

interface ConfigRow {
  phone_number_id: string
  display_phone_number: string | null
  access_token: string
  status: 'connected' | 'disconnected'
}

function createSupabase(config: ConfigRow | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: config, error: null })
  const selectEq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq: selectEq }))
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq: updateEq }))

  return {
    from: vi.fn(() => ({ select, update })),
    update,
    updateEq,
  }
}

describe('GET /api/whatsapp/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns only the cached display number and connection state', async () => {
    const client = createSupabase({
      phone_number_id: 'meta-phone-id',
      display_phone_number: '+971 50 123 4567',
      access_token: 'encrypted-secret',
      status: 'connected',
    })
    requireRole.mockResolvedValue({
      accountId: 'account-1',
      role: 'agent',
      supabase: client,
    })

    const { GET } = await import('./route')
    const response = await GET()
    const body = await response.json()

    expect(requireRole).toHaveBeenCalledWith('viewer')
    expect(body).toEqual({
      configured: true,
      connected: true,
      phoneNumber: '+971 50 123 4567',
      numberKind: 'display',
    })
    expect(JSON.stringify(body)).not.toContain('encrypted-secret')
    expect(verifyPhoneNumber).not.toHaveBeenCalled()
  })

  it('resolves and caches the display number for a legacy owner row', async () => {
    const client = createSupabase({
      phone_number_id: 'meta-phone-id',
      display_phone_number: null,
      access_token: 'encrypted-secret',
      status: 'connected',
    })
    requireRole.mockResolvedValue({
      accountId: 'account-1',
      role: 'owner',
      supabase: client,
    })
    verifyPhoneNumber.mockResolvedValue({
      id: 'meta-phone-id',
      display_phone_number: '+971 55 765 4321',
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(await response.json()).toMatchObject({
      phoneNumber: '+971 55 765 4321',
      numberKind: 'display',
    })
    expect(decrypt).toHaveBeenCalledWith('encrypted-secret')
    expect(client.update).toHaveBeenCalledWith({
      display_phone_number: '+971 55 765 4321',
    })
    expect(client.updateEq).toHaveBeenCalledWith('account_id', 'account-1')
  })

  it('supports a database where migration 045 has not run yet', async () => {
    const legacyConfig = {
      phone_number_id: 'legacy-meta-id',
      access_token: 'encrypted-secret',
      status: 'connected',
    }
    const select = vi.fn((columns: string) => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue(
          columns.includes('display_phone_number')
            ? {
                data: null,
                error: {
                  code: 'PGRST204',
                  message: 'display_phone_number was not found',
                },
              }
            : { data: legacyConfig, error: null }
        ),
      })),
    }))
    requireRole.mockResolvedValue({
      accountId: 'account-1',
      role: 'agent',
      supabase: { from: vi.fn(() => ({ select })) },
    })
    verifyPhoneNumber.mockResolvedValue({
      id: 'legacy-meta-id',
      display_phone_number: '+971 52 000 0000',
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      phoneNumber: '+971 52 000 0000',
      numberKind: 'display',
    })
    expect(select).toHaveBeenCalledTimes(2)
  })

  it('reports an unconfigured workspace without exposing details', async () => {
    const client = createSupabase(null)
    requireRole.mockResolvedValue({
      accountId: 'account-1',
      role: 'viewer',
      supabase: client,
    })

    const { GET } = await import('./route')
    const response = await GET()

    expect(await response.json()).toEqual({
      configured: false,
      connected: false,
      phoneNumber: null,
      numberKind: null,
    })
  })
})
