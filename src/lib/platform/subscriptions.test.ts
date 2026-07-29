import { describe, expect, it } from 'vitest';

import {
  daysUntil,
  isUpcomingRenewal,
  parseSubscriptionInput,
  subscriptionIsExpired,
} from './subscriptions';

const NOW = new Date('2026-07-29T00:00:00.000Z');

describe('platform subscription helpers', () => {
  it('normalizes a valid subscription payload', () => {
    expect(
      parseSubscriptionInput({
        planCode: ' Standard ',
        status: 'active',
        billingCycle: 'monthly',
        amountMinor: 29900,
        currency: 'aed',
        startsAt: '2026-07-01',
        renewsAt: '2026-08-01',
        expiresAt: null,
        graceEndsAt: null,
        notes: ' Annual client ',
      })
    ).toMatchObject({
      planCode: 'standard',
      amountMinor: 29900,
      currency: 'AED',
      notes: 'Annual client',
    });
  });

  it('rejects invalid date ordering', () => {
    expect(() =>
      parseSubscriptionInput({
        planCode: 'standard',
        status: 'active',
        billingCycle: 'monthly',
        amountMinor: 0,
        currency: 'USD',
        startsAt: '2026-08-01',
        renewsAt: '2026-07-01',
        expiresAt: null,
        graceEndsAt: null,
      })
    ).toThrow('Renewal date cannot be before the start date');
  });

  it('calculates renewal and expiry state deterministically', () => {
    const subscription = {
      status: 'active' as const,
      renewsAt: '2026-08-05T00:00:00.000Z',
      expiresAt: '2026-08-10T00:00:00.000Z',
    };
    expect(daysUntil(subscription.renewsAt, NOW)).toBe(7);
    expect(isUpcomingRenewal(subscription, 30, NOW)).toBe(true);
    expect(subscriptionIsExpired(subscription, NOW)).toBe(false);
    expect(
      subscriptionIsExpired(subscription, new Date('2026-08-11T00:00:00Z'))
    ).toBe(true);
  });
});
