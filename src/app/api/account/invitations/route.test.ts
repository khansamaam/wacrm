import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  adminFrom: vi.fn(),
  accountInvitationInsert: vi.fn(),
  invitationSelect: vi.fn(),
  invitationSingle: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 403 }
    ),
}));

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from: mocks.adminFrom }),
}));

function postRequest(body: unknown): Request {
  return new Request('https://crm.example.com/api/account/invitations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue({ success: true });
  mocks.requireRole.mockResolvedValue({
    userId: 'user-1',
    accountId: 'account-1',
    supabase: { from: vi.fn() },
  });
  mocks.invitationSingle.mockResolvedValue({
    data: {
      id: 'invite-1',
      role: 'agent',
      label: null,
      expires_at: '2026-08-12T00:00:00.000Z',
      created_at: '2026-08-05T00:00:00.000Z',
    },
    error: null,
  });
  mocks.invitationSelect.mockReturnValue({ single: mocks.invitationSingle });
  mocks.accountInvitationInsert.mockReturnValue({
    select: mocks.invitationSelect,
  });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table !== 'account_invitations') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return { insert: mocks.accountInvitationInsert };
  });
});

describe('POST /api/account/invitations', () => {
  it('authorizes with the session and inserts the invitation with the service client', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      postRequest({ role: 'agent', expiresInDays: 7 })
    );

    expect(response.status).toBe(201);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.adminFrom).toHaveBeenCalledWith('account_invitations');
    expect(mocks.accountInvitationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        role: 'agent',
        created_by_user_id: 'user-1',
        whatsapp_number_access_mode: 'all',
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      invitation: { id: 'invite-1', role: 'agent' },
      expiresInDays: 7,
    });
  });
});
