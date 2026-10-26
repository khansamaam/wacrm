import type { SupabaseClient } from '@supabase/supabase-js'

export type AutomationNumberParse =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

/**
 * Validate a `whatsapp_number_id` sent by the automation builder/API.
 * `null` or '' means "all numbers". A uuid must be a number in the caller's
 * account — the routes write through the service-role client, so this check
 * is the tenant guard.
 */
export async function parseAutomationNumberId(
  db: SupabaseClient,
  accountId: string,
  raw: unknown,
): Promise<AutomationNumberParse> {
  if (raw === null || raw === '' || raw === 'all') return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'whatsapp_number_id must be a string or null' }
  }
  const { data, error } = await db
    .from('whatsapp_numbers')
    .select('id')
    .eq('id', raw)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) {
    return { ok: false, error: 'WhatsApp number not found in this workspace' }
  }
  return { ok: true, value: data.id as string }
}
