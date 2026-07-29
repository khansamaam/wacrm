import { describe, expect, it, vi } from 'vitest';

import { findAuthUserByEmail } from './admin-users';

function adminClient(pages: Array<Array<{ id: string; email: string }>>) {
  const listUsers = vi.fn(({ page }: { page: number }) =>
    Promise.resolve({
      data: { users: pages[page - 1] ?? [] },
      error: null,
    }),
  );

  return {
    listUsers,
    client: {
      auth: { admin: { listUsers } },
    },
  };
}

describe('findAuthUserByEmail', () => {
  it('matches email case-insensitively', async () => {
    const { client } = adminClient([
      [{ id: 'user-1', email: 'Teammate@Example.com' }],
    ]);

    const user = await findAuthUserByEmail(
      client as never,
      'teammate@example.com',
    );

    expect(user?.id).toBe('user-1');
  });

  it('continues to the next full page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `other-${index}`,
      email: `other-${index}@example.com`,
    }));
    const { client, listUsers } = adminClient([
      firstPage,
      [{ id: 'target', email: 'target@example.com' }],
    ]);

    const user = await findAuthUserByEmail(
      client as never,
      'target@example.com',
    );

    expect(user?.id).toBe('target');
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it('returns null after the final partial page', async () => {
    const { client, listUsers } = adminClient([
      [{ id: 'other', email: 'other@example.com' }],
    ]);

    await expect(
      findAuthUserByEmail(client as never, 'missing@example.com'),
    ).resolves.toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('surfaces Supabase Admin lookup failures', async () => {
    const client = {
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [] },
            error: new Error('Auth unavailable'),
          }),
        },
      },
    };

    await expect(
      findAuthUserByEmail(client as never, 'target@example.com'),
    ).rejects.toThrow('Auth unavailable');
  });
});
