/**
 * Choose where to send a user when Supabase returns an authenticated
 * session directly from signUp().
 *
 * This happens when Confirm Email is disabled. Invited signups must return
 * to the invitation page so the explicit redemption step can move their
 * profile out of the temporary personal account and into the team.
 *
 * When confirmation is enabled, signUp() returns no session and the email's
 * redirectTo handles navigation instead, so this helper returns null.
 */
export function getPostSignupDestination(
  inviteToken: string | null,
  hasSession: boolean,
): string | null {
  if (!hasSession) return null;
  if (inviteToken) {
    return `/join/${encodeURIComponent(inviteToken)}`;
  }
  return "/dashboard";
}
