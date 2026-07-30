/**
 * Hash an invitation token before attaching it to Supabase user metadata.
 *
 * The database stores invitation hashes rather than plaintext tokens. The
 * signup trigger compares this value with an unused workspace invitation
 * before it creates the profile.
 */
export async function hashSignupInviteToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Choose where to send an invited user when Supabase returns an authenticated
 * session directly from signUp().
 *
 * New invited users are linked directly to the inviting workspace by the
 * database trigger, so no second invitation-redemption step is necessary.
 * When confirmation is enabled the email redirect handles navigation.
 */
export function getPostSignupDestination(
  hasSession: boolean,
): string | null {
  if (!hasSession) return null;
  return "/dashboard";
}
