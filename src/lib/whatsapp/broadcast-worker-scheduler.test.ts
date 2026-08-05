import { describe, expect, it } from 'vitest';

import { embeddedBroadcastWorkerConfig } from './broadcast-worker-scheduler';

describe('embedded broadcast worker config', () => {
  it('starts automatically in production', () => {
    expect(
      embeddedBroadcastWorkerConfig({ NODE_ENV: 'production' }).enabled
    ).toBe(true);
  });

  it('stays off in development unless explicitly enabled', () => {
    expect(
      embeddedBroadcastWorkerConfig({ NODE_ENV: 'development' }).enabled
    ).toBe(false);
    expect(
      embeddedBroadcastWorkerConfig({
        NODE_ENV: 'development',
        BROADCAST_WORKER_EMBEDDED: 'true',
      }).enabled
    ).toBe(true);
  });

  it('can be disabled on production hosts', () => {
    expect(
      embeddedBroadcastWorkerConfig({
        NODE_ENV: 'production',
        BROADCAST_WORKER_EMBEDDED: 'false',
      }).enabled
    ).toBe(false);
  });

  it('never starts during production builds', () => {
    expect(
      embeddedBroadcastWorkerConfig({
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
        BROADCAST_WORKER_EMBEDDED: 'true',
      }).enabled
    ).toBe(false);
  });

  it('uses a bounded interval and optional queue tuning values', () => {
    expect(
      embeddedBroadcastWorkerConfig({
        NODE_ENV: 'production',
        BROADCAST_WORKER_INTERVAL_MS: '100',
        BROADCAST_WORKER_MAX_JOBS: '250',
        BROADCAST_WORKER_BATCH_SIZE: '20',
        BROADCAST_WORKER_TIME_BUDGET_MS: '30000',
      })
    ).toMatchObject({
      intervalMs: 10_000,
      maxJobs: 250,
      batchSize: 20,
      timeBudgetMs: 30_000,
    });
  });
});
