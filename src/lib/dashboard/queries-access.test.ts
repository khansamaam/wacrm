import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadActivity,
  loadMetrics,
  type DashboardDataAccess,
} from './queries';

function createDbRecorder() {
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const result = {
      data: table === 'deals' ? [] : [],
      count: 0,
      error: null,
    };
    const chain: Record<string, unknown> = {};
    const keepChaining = () => chain;
    for (const method of [
      'select',
      'eq',
      'gte',
      'lt',
      'order',
      'limit',
    ]) {
      chain[method] = vi.fn(keepChaining);
    }
    chain.then = (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return chain;
  });

  return {
    db: { from } as unknown as SupabaseClient,
    tables,
  };
}

const noAccess: DashboardDataAccess = {
  inbox: false,
  contacts: false,
  pipelines: false,
  broadcasts: false,
  automations: false,
};

describe('dashboard module-aware queries', () => {
  it('does not query hidden metric sources', async () => {
    const { db, tables } = createDbRecorder();
    await loadMetrics(db, { ...noAccess, contacts: true });

    expect(tables).toEqual(['contacts', 'contacts']);
  });

  it('loads activity only from enabled modules', async () => {
    const { db, tables } = createDbRecorder();
    const activity = await loadActivity(db, 20, {
      ...noAccess,
      pipelines: true,
      broadcasts: true,
    });

    expect(tables).toEqual(['deals', 'broadcasts']);
    expect(activity).toEqual([]);
  });

  it('makes no dashboard data queries when every source module is hidden', async () => {
    const { db, tables } = createDbRecorder();
    await loadMetrics(db, noAccess);
    await loadActivity(db, 20, noAccess);

    expect(tables).toEqual([]);
  });
});
