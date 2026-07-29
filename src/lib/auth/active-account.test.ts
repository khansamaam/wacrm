import { describe, expect, it, vi } from 'vitest';

import { resolveActiveAccountId } from './active-account';

function clientWith(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ select }));
  return {
    client: { from },
    from,
    select,
    limit,
  };
}

describe('resolveActiveAccountId', () => {
  it('returns the single RLS-visible workspace', async () => {
    const { client, from, select, limit } = clientWith({
      data: [{ id: 'account-1' }],
      error: null,
    });

    await expect(resolveActiveAccountId(client as never)).resolves.toBe(
      'account-1'
    );
    expect(from).toHaveBeenCalledWith('accounts');
    expect(select).toHaveBeenCalledWith('id');
    expect(limit).toHaveBeenCalledWith(2);
  });

  it('fails closed when no workspace or multiple workspaces are visible', async () => {
    await expect(
      resolveActiveAccountId(
        clientWith({ data: [], error: null }).client as never
      )
    ).resolves.toBeNull();
    await expect(
      resolveActiveAccountId(
        clientWith({
          data: [{ id: 'one' }, { id: 'two' }],
          error: null,
        }).client as never
      )
    ).resolves.toBeNull();
  });

  it('surfaces database errors', async () => {
    const error = new Error('database unavailable');
    await expect(
      resolveActiveAccountId(clientWith({ data: null, error }).client as never)
    ).rejects.toBe(error);
  });
});
