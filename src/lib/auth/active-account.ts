import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve the single account currently visible through RLS.
 *
 * Normal users can see their one workspace. Platform Super Admins can see
 * only the workspace selected in `platform_workspace_context`. Resolving
 * through `accounts` therefore works in browser and server code without
 * trusting the profile's original account_id during a support session.
 */
export async function resolveActiveAccountId(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error } = await supabase.from('accounts').select('id').limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) return null;
  return data[0].id as string;
}
