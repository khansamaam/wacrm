import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccountRole } from './roles';
import { findAuthUserByEmail } from './admin-users';

export class ActiveWorkspaceError extends Error {
  constructor(
    readonly accountId: string,
  ) {
    super('This user already belongs to an active workspace');
    this.name = 'ActiveWorkspaceError';
  }
}

interface ProvisionInvitedUserInput {
  admin: SupabaseClient;
  email: string;
  invitationHash: string;
  redirectTo: string;
  accountId: string;
  role: AccountRole;
}

/**
 * Prepare the Auth/profile side of an email-bound workspace invitation.
 *
 * New emails receive Supabase's invitation message. Existing, inactive
 * logins retain their password and accept the app invitation after signing
 * in. A profile missing from an older blocked signup is repaired as pending.
 */
export async function provisionInvitedUser({
  admin,
  email,
  invitationHash,
  redirectTo,
  accountId,
  role,
}: ProvisionInvitedUserInput): Promise<{ emailSent: boolean }> {
  const existingUser = await findAuthUserByEmail(admin, email);

  if (!existingUser) {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { invite_token_hash: invitationHash },
    });
    if (error) throw error;
    return { emailSent: true };
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('account_id, access_status')
    .eq('user_id', existingUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.access_status === 'active') {
    throw new ActiveWorkspaceError(profile.account_id);
  }

  if (!profile) {
    const fullName =
      typeof existingUser.user_metadata?.full_name === 'string'
        ? existingUser.user_metadata.full_name
        : '';
    const { error: insertError } = await admin.from('profiles').insert({
      user_id: existingUser.id,
      full_name: fullName,
      email,
      account_id: accountId,
      account_role: role,
      access_status: 'pending',
    });
    if (insertError) throw insertError;
  }

  return { emailSent: false };
}
