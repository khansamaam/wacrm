import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildWebhookCallbackUrl,
  classifyWebhookTarget,
  hasGrantedPermission,
  isMissingRoutingColumnError,
  isPhoneNumberReady,
  normalizeDisplayPhoneNumber,
  previewManualConnection,
  resolveMetaAppCredentials,
  resolveOnboardedPhoneNumber,
} from './coexistence-connect'

describe('resolveOnboardedPhoneNumber', () => {
  const a = { id: '111', display_phone_number: '+971 50 000 0001' }
  const b = { id: '222', display_phone_number: '+971 50 000 0002' }

  it('returns the sole number when no id is given (coexistence FINISH with waba_id only)', () => {
    expect(resolveOnboardedPhoneNumber([a]).id).toBe('111')
  })

  it('matches an explicit id on a multi-number WABA', () => {
    expect(resolveOnboardedPhoneNumber([a, b], '222').id).toBe('222')
  })

  it('refuses to guess when several numbers exist and no id is given', () => {
    expect(() => resolveOnboardedPhoneNumber([a, b])).toThrow(/several numbers/)
  })

  it('rejects an id that is not on the WABA', () => {
    expect(() => resolveOnboardedPhoneNumber([a], '999')).toThrow(/does not belong/)
  })

  it('rejects an empty WABA', () => {
    expect(() => resolveOnboardedPhoneNumber([])).toThrow(/no phone numbers/)
  })
})

describe('readiness and formatting helpers', () => {
  it('treats CONNECTED or VERIFIED numbers as ready', () => {
    expect(isPhoneNumberReady({ id: '1', status: 'CONNECTED' })).toBe(true)
    expect(isPhoneNumberReady({ id: '1', code_verification_status: 'VERIFIED' })).toBe(true)
    expect(isPhoneNumberReady({ id: '1', status: 'PENDING' })).toBe(false)
  })

  it('normalizes display numbers to +digits', () => {
    expect(normalizeDisplayPhoneNumber('+971 (50) 123-4567')).toBe('+971501234567')
    expect(normalizeDisplayPhoneNumber(undefined)).toBe('')
  })

  it('checks granted permissions only', () => {
    const perms = [
      { permission: 'whatsapp_business_messaging', status: 'declined' },
      { permission: 'whatsapp_business_management', status: 'granted' },
    ]
    expect(hasGrantedPermission(perms, 'whatsapp_business_messaging')).toBe(false)
    expect(hasGrantedPermission(perms, 'whatsapp_business_management')).toBe(true)
  })

  it('recognizes missing-column errors from migration 057 not being applied', () => {
    expect(isMissingRoutingColumnError({ code: '42703' })).toBe(true)
    expect(isMissingRoutingColumnError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingRoutingColumnError({ code: '23505' })).toBe(false)
    expect(isMissingRoutingColumnError(null)).toBe(false)
  })
})

describe('buildWebhookCallbackUrl', () => {
  it('builds the webhook URL from an https site URL', () => {
    expect(buildWebhookCallbackUrl('https://crm.example.com/')).toBe(
      'https://crm.example.com/api/whatsapp/webhook',
    )
  })

  it('rejects http and missing site URLs', () => {
    expect(() => buildWebhookCallbackUrl('http://crm.example.com')).toThrow(/https/)
    expect(() => buildWebhookCallbackUrl('')).toThrow(/NEXT_PUBLIC_SITE_URL/)
  })
})

describe('classifyWebhookTarget', () => {
  const ours = 'https://crm.example.com/api/whatsapp/webhook'

  it('detects an override pointing at this app', () => {
    expect(classifyWebhookTarget({ override_callback_uri: `${ours}/` }, ours).target).toBe('this_app')
  })

  it('detects an override pointing elsewhere (e.g. Chatwoot)', () => {
    const result = classifyWebhookTarget(
      { override_callback_uri: 'https://chat.example.com/webhooks/whatsapp/+9715' },
      ours,
    )
    expect(result).toEqual({
      target: 'elsewhere',
      url: 'https://chat.example.com/webhooks/whatsapp/+9715',
    })
  })

  it('falls back to the app default when there is no override', () => {
    expect(classifyWebhookTarget({ application: 'https://other/hook' }, ours).target).toBe('app_default')
    expect(classifyWebhookTarget({ application: ours }, ours).target).toBe('this_app')
    expect(classifyWebhookTarget(undefined, ours).target).toBe('app_default')
  })
})

describe('resolveMetaAppCredentials', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('prefers explicit values, then the coexistence app, then the legacy app', () => {
    vi.stubEnv('META_COEXISTENCE_APP_ID', 'coex-id')
    vi.stubEnv('META_COEXISTENCE_APP_SECRET', 'coex-secret')
    vi.stubEnv('META_APP_ID', 'legacy-id')
    vi.stubEnv('META_APP_SECRET', 'legacy-secret')
    expect(resolveMetaAppCredentials({ appId: 'x', appSecret: 'y' })).toEqual({ appId: 'x', appSecret: 'y' })
    expect(resolveMetaAppCredentials({})).toEqual({ appId: 'coex-id', appSecret: 'coex-secret' })

    vi.stubEnv('META_COEXISTENCE_APP_ID', '')
    vi.stubEnv('META_COEXISTENCE_APP_SECRET', '')
    expect(resolveMetaAppCredentials({})).toEqual({ appId: 'legacy-id', appSecret: 'legacy-secret' })
  })
})

describe('previewManualConnection', () => {
  afterEach(() => vi.unstubAllGlobals())

  function mockMeta(responses: Record<string, { status: number; body: unknown }>) {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      const key = Object.keys(responses).find((k) => url.includes(k))
      const response = key ? responses[key] : { status: 404, body: {} }
      return new Response(JSON.stringify(response.body), { status: response.status })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('lists every number with readiness and coexistence flags', async () => {
    mockMeta({
      '/WABA/phone_numbers': {
        status: 200,
        body: {
          data: [
            { id: '1', display_phone_number: '+971 50 000 0001', status: 'CONNECTED', is_on_biz_app: true, verified_name: 'Shop' },
            { id: '2', display_phone_number: '+971 50 000 0002', status: 'PENDING' },
          ],
        },
      },
      '/WABA/message_templates': { status: 200, body: { data: [] } },
      '/me/permissions': {
        status: 200,
        body: { data: [{ permission: 'whatsapp_business_messaging', status: 'granted' }] },
      },
    })
    const preview = await previewManualConnection({ wabaId: 'WABA', accessToken: 'token' })
    expect(preview.numbers).toEqual([
      expect.objectContaining({ phone_number_id: '1', display_phone_number: '+971500000001', is_on_biz_app: true, ready: true, verified_name: 'Shop' }),
      expect.objectContaining({ phone_number_id: '2', is_on_biz_app: false, ready: false }),
    ])
  })

  it('explains a missing messaging permission', async () => {
    mockMeta({
      '/WABA/phone_numbers': { status: 200, body: { data: [{ id: '1', status: 'CONNECTED' }] } },
      '/WABA/message_templates': { status: 200, body: { data: [] } },
      '/me/permissions': {
        status: 200,
        body: { data: [{ permission: 'whatsapp_business_management', status: 'granted' }] },
      },
    })
    await expect(previewManualConnection({ wabaId: 'WABA', accessToken: 'token' })).rejects.toThrow(
      /whatsapp_business_messaging/,
    )
  })

  it('explains a missing template permission', async () => {
    mockMeta({
      '/WABA/phone_numbers': { status: 200, body: { data: [{ id: '1', status: 'CONNECTED' }] } },
      '/WABA/message_templates': { status: 403, body: { error: { message: 'denied' } } },
    })
    await expect(previewManualConnection({ wabaId: 'WABA', accessToken: 'token' })).rejects.toThrow(
      /whatsapp_business_management/,
    )
  })

  it('explains a token that cannot see the WABA', async () => {
    mockMeta({
      '/WABA/phone_numbers': { status: 400, body: { error: { message: 'Unsupported get request' } } },
    })
    await expect(previewManualConnection({ wabaId: 'WABA', accessToken: 'token' })).rejects.toThrow(
      /cannot read this WhatsApp Business Account/,
    )
  })
})
