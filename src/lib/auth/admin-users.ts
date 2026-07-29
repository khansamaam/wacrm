import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Supabase Admin does not expose a direct get-by-email method. Keep the
 * paginated lookup in one server-only helper so invitation and platform
 * provisioning routes do not duplicate subtly different scans.
 */
export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;

    const match =
      data.users.find(
        (user) => user.email?.trim().toLowerCase() === normalizedEmail,
      ) ?? null;
    if (match || data.users.length < 100) return match;
  }

  throw new Error('Auth user lookup exceeded the supported page limit');
}
