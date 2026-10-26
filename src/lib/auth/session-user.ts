import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The signed-in user's id, verified from the session JWT.
 *
 * Uses `auth.getClaims()`, which checks the token signature locally
 * against the project's cached JWKS, instead of `auth.getUser()`, which
 * calls Supabase Auth over the network on every request. Middleware has
 * already refreshed an expired token before a route handler runs.
 *
 * Returns null when there is no valid session.
 */
export async function getSessionUser(
  supabase: SupabaseClient,
): Promise<{ id: string } | null> {
  try {
    const { data, error } = await supabase.auth.getClaims()
    const sub = data?.claims?.sub
    if (error || typeof sub !== 'string' || !sub) return null
    return { id: sub }
  } catch {
    return null
  }
}
