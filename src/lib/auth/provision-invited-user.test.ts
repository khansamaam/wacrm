import { describe, expect, it, vi } from 'vitest';

import {
  ActiveWorkspaceError,
  provisionInvitedUser,
} from './provision-invited-user';

vi.mock('./admin-users', () => ({
  findAuthUserByEmail: vi.fn(),
}));

const { findAuthUserByEmail } = await import('./admin-users');

describe('provisionInvitedUser', () => {
  it('emails a new Auth user with server-controlled invitation metadata', async () => {
    vi.mocked(findAuthUserByEmail).mockResolvedValueOnce(null);
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      auth: { admin: { inviteUserByEmail } },
    };

    await expect(
      provisionInvitedUser({
        admin: admin as never,
        email: 'agent@example.com',
        invitationHash: 'hash-1',
        redirectTo: 'https://app.example/join/token',
        accountId: 'account-1',
        role: 'agent',
      }),
    ).resolves.toEqual({ emailSent: true });
    expect(inviteUserByEmail).toHaveBeenCalledWith('agent@example.com', {
      redirectTo: 'https://app.example/join/token',
      data: { invite_token_hash: 'hash-1' },
    });
  });

  it('rejects an existing active workspace member', async () => {
    vi.mocked(findAuthUserByEmail).mockResolvedValueOnce({
      id: 'user-1',
      user_metadata: {},
    } as never);
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { account_id: 'account-2', access_status: 'active' },
        error: null,
      }),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    const admin = { from: vi.fn().mockReturnValue(builder) };

    const error = await provisionInvitedUser({
      admin: admin as never,
      email: 'agent@example.com',
      invitationHash: 'hash-1',
      redirectTo: 'https://app.example/join/token',
      accountId: 'account-1',
      role: 'agent',
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ActiveWorkspaceError);
    expect(error.accountId).toBe('account-2');
  });

  it('repairs a profile-less existing login as pending', async () => {
    vi.mocked(findAuthUserByEmail).mockResolvedValueOnce({
      id: 'user-1',
      email: 'agent@example.com',
      user_metadata: { full_name: 'Agent One' },
    } as never);
    const insert = vi.fn().mockResolvedValue({ error: null });
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert,
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    const admin = { from: vi.fn().mockReturnValue(builder) };

    await expect(
      provisionInvitedUser({
        admin: admin as never,
        email: 'agent@example.com',
        invitationHash: 'hash-1',
        redirectTo: 'https://app.example/join/token',
        accountId: 'account-1',
        role: 'agent',
      }),
    ).resolves.toEqual({ emailSent: false });
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      full_name: 'Agent One',
      email: 'agent@example.com',
      account_id: 'account-1',
      account_role: 'agent',
      access_status: 'pending',
    });
  });
});
