import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRole = vi.fn();

vi.mock('@/lib/auth/account', () => ({
  requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 403 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 60_000 } },
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));

function accountClient() {
  const single = vi.fn().mockResolvedValue({
    data: { module_access: { admin: ['dashboard'], agent: [], viewer: [] } },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  return { update, eq, select, single };
}

describe('PATCH /api/account/module-access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires the owner role and saves a normalized matrix', async () => {
    const client = accountClient();
    requireRole.mockResolvedValue({
      userId: 'owner-1',
      accountId: 'account-1',
      supabase: { from: () => client },
    });
    const { PATCH } = await import('./route');

    const response = await PATCH(
      new Request('http://localhost/api/account/module-access', {
        method: 'PATCH',
        body: JSON.stringify({
          moduleAccess: {
            admin: ['dashboard', 'unknown'],
            agent: [],
            viewer: [],
          },
        }),
      })
    );

    expect(requireRole).toHaveBeenCalledWith('owner');
    expect(client.update).toHaveBeenCalledWith({
      module_access: {
        admin: ['dashboard'],
        agent: [],
        viewer: [],
      },
    });
    expect(response.status).toBe(200);
  });

  it('rejects a missing matrix', async () => {
    requireRole.mockResolvedValue({
      userId: 'owner-1',
      accountId: 'account-1',
      supabase: {},
    });
    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request('http://localhost/api/account/module-access', {
        method: 'PATCH',
        body: JSON.stringify({}),
      })
    );
    expect(response.status).toBe(400);
  });
});
