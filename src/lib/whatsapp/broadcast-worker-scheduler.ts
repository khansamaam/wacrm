import { processBroadcastQueue } from '@/lib/whatsapp/broadcast-queue';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_START_DELAY_MS = 5_000;
const MIN_INTERVAL_MS = 10_000;
const NEXT_PRODUCTION_BUILD_PHASE = 'phase-production-build';
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled', 'no']);
const ENABLED_VALUES = new Set(['1', 'true', 'on', 'enabled', 'yes']);

interface EmbeddedBroadcastWorkerState {
  interval?: ReturnType<typeof setInterval>;
  starter?: ReturnType<typeof setTimeout>;
  running: boolean;
}

interface EmbeddedBroadcastWorkerConfig {
  enabled: boolean;
  intervalMs: number;
  maxJobs?: number;
  batchSize?: number;
  timeBudgetMs?: number;
}

const stateKey = Symbol.for('wacrm.embeddedBroadcastWorker');

function getState(): EmbeddedBroadcastWorkerState {
  const globalState = globalThis as typeof globalThis & {
    [stateKey]?: EmbeddedBroadcastWorkerState;
  };
  globalState[stateKey] ??= { running: false };
  return globalState[stateKey];
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function embeddedBroadcastWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): EmbeddedBroadcastWorkerConfig {
  const mode = env.BROADCAST_WORKER_EMBEDDED?.trim().toLowerCase();
  if (env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE) {
    return { enabled: false, intervalMs: DEFAULT_INTERVAL_MS };
  }

  let enabled = env.NODE_ENV === 'production';
  if (mode && DISABLED_VALUES.has(mode)) enabled = false;
  if (mode && ENABLED_VALUES.has(mode)) enabled = true;

  const intervalMs = Math.max(
    parsePositiveInteger(env.BROADCAST_WORKER_INTERVAL_MS) ??
      DEFAULT_INTERVAL_MS,
    MIN_INTERVAL_MS
  );

  return {
    enabled,
    intervalMs,
    maxJobs: parsePositiveInteger(env.BROADCAST_WORKER_MAX_JOBS),
    batchSize: parsePositiveInteger(env.BROADCAST_WORKER_BATCH_SIZE),
    timeBudgetMs: parsePositiveInteger(env.BROADCAST_WORKER_TIME_BUDGET_MS),
  };
}

export function startEmbeddedBroadcastWorker(): void {
  const config = embeddedBroadcastWorkerConfig();
  if (!config.enabled) return;

  const state = getState();
  if (state.interval || state.starter) return;

  const run = async () => {
    if (state.running) return;
    state.running = true;

    try {
      const result = await processBroadcastQueue({
        maxJobs: config.maxJobs,
        batchSize: config.batchSize,
        timeBudgetMs: config.timeBudgetMs,
      });
      if (result.claimed > 0) {
        console.info('[broadcast-worker] embedded run completed:', result);
      }
    } catch (error) {
      console.error('[broadcast-worker] embedded run failed:', error);
    } finally {
      state.running = false;
    }
  };

  state.starter = setTimeout(() => {
    state.starter = undefined;
    void run();
  }, DEFAULT_START_DELAY_MS);
  state.starter.unref?.();

  state.interval = setInterval(() => {
    void run();
  }, config.intervalMs);
  state.interval.unref?.();

  console.info(
    `[broadcast-worker] embedded worker started; interval=${config.intervalMs}ms`
  );
}
