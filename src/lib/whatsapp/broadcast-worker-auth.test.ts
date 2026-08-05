import { describe, expect, it } from 'vitest';

import { isBroadcastWorkerRequestAuthorized } from './broadcast-worker-auth';

function request(secret?: string): Request {
  return new Request('https://crm.example.com/api/whatsapp/broadcast/worker', {
    headers: secret ? { 'x-cron-secret': secret } : undefined,
  });
}

describe('broadcast worker authentication', () => {
  it('allows a worker kick when no secret is configured', () => {
    expect(isBroadcastWorkerRequestAuthorized(request(), '')).toBe(true);
  });

  it('requires an exact header match when a worker secret is configured', () => {
    expect(isBroadcastWorkerRequestAuthorized(request(), 'worker-secret')).toBe(
      false
    );
    expect(
      isBroadcastWorkerRequestAuthorized(
        request('wrong-secret'),
        'worker-secret'
      )
    ).toBe(false);
    expect(
      isBroadcastWorkerRequestAuthorized(
        request('worker-secret'),
        'worker-secret'
      )
    ).toBe(true);
  });
});
