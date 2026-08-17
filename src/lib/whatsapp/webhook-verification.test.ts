import { describe, expect, it } from 'vitest'

import { matchesWebhookVerifyToken } from './webhook-verification'

describe('matchesWebhookVerifyToken', () => {
  it('accepts an exact token match', () => {
    expect(matchesWebhookVerifyToken('platform-secret', 'platform-secret')).toBe(
      true
    )
  })

  it('rejects different tokens', () => {
    expect(matchesWebhookVerifyToken('provided', 'configured')).toBe(false)
  })

  it('rejects missing tokens', () => {
    expect(matchesWebhookVerifyToken('', 'configured')).toBe(false)
    expect(matchesWebhookVerifyToken('provided', undefined)).toBe(false)
  })
})
