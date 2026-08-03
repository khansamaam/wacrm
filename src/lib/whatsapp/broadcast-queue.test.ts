import { describe, expect, it } from 'vitest';

import {
  broadcastRetryDelayMs,
  isRetryableBroadcastError,
} from './broadcast-queue';

describe('broadcast queue retry policy', () => {
  it('uses bounded exponential delays', () => {
    expect(broadcastRetryDelayMs(1)).toBe(60_000);
    expect(broadcastRetryDelayMs(2)).toBe(300_000);
    expect(broadcastRetryDelayMs(4)).toBe(3_600_000);
    expect(broadcastRetryDelayMs(99)).toBe(21_600_000);
  });

  it('retries network, throttling, and Meta service failures', () => {
    expect(isRetryableBroadcastError('fetch failed')).toBe(true);
    expect(isRetryableBroadcastError('Meta API error: 503')).toBe(true);
    expect(isRetryableBroadcastError('Rate limited (Meta code 4)')).toBe(true);
  });

  it('does not retry permanent recipient or template failures', () => {
    expect(isRetryableBroadcastError('Invalid phone number')).toBe(false);
    expect(
      isRetryableBroadcastError('[131049] Healthy ecosystem engagement')
    ).toBe(false);
  });
});
