import type { SupabaseClient } from '@supabase/supabase-js'

/** Database row shape used only by trusted server-side WhatsApp services. */
export interface WhatsAppNumberRow {
  id: string
  account_id: string
  created_by_user_id: string | null
  label: string
  phone_number_id: string
  display_phone_number: string | null
  waba_id: string | null
  connection_method: 'cloud_api' | 'coexistence'
  access_token: string | null
  verify_token: string | null
  status: 'pending' | 'connected' | 'error' | 'disconnected'
  is_default: boolean
  connected_at: string | null
  registered_at: string | null
  subscribed_apps_at: string | null
  last_registration_error: string | null
  is_on_biz_app: boolean | null
  platform_type: string | null
  coexistence_onboarded_at: string | null
  history_sync_status:
    | 'not_requested'
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
  contacts_sync_status:
    | 'not_requested'
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
  created_at: string
  updated_at: string
}

/** Safe shape returned to browser clients. It intentionally contains no tokens. */
export type WhatsAppNumberSummary = Omit<
  WhatsAppNumberRow,
  'access_token' | 'verify_token' | 'created_by_user_id'
>

export class WhatsAppNumberError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_configured'
      | 'not_found'
      | 'not_accessible'
      | 'not_connected'
      | 'database_error',
  ) {
    super(message)
    this.name = 'WhatsAppNumberError'
  }
}

const SERVER_COLUMNS = [
  'id',
  'account_id',
  'created_by_user_id',
  'label',
  'phone_number_id',
  'display_phone_number',
  'waba_id',
  'connection_method',
  'access_token',
  'verify_token',
  'status',
  'is_default',
  'connected_at',
  'registered_at',
  'subscribed_apps_at',
  'last_registration_error',
  'is_on_biz_app',
  'platform_type',
  'coexistence_onboarded_at',
  'history_sync_status',
  'contacts_sync_status',
  'created_at',
  'updated_at',
].join(', ')

export const SAFE_NUMBER_COLUMNS = [
  'id',
  'account_id',
  'label',
  'phone_number_id',
  'display_phone_number',
  'waba_id',
  'connection_method',
  'status',
  'is_default',
  'connected_at',
  'registered_at',
  'subscribed_apps_at',
  'last_registration_error',
  'is_on_biz_app',
  'platform_type',
  'coexistence_onboarded_at',
  'history_sync_status',
  'contacts_sync_status',
  'created_at',
  'updated_at',
].join(', ')

interface ResolveOptions {
  supabase: SupabaseClient
  accountId: string
  /** Explicit sender selected by an API/UI caller. */
  whatsappNumberId?: string | null
  /** Existing threads always keep their original sender number. */
  conversationId?: string | null
  requireConnected?: boolean
}

/**
 * Resolve one sender using the shared compatibility rules:
 * conversation number → explicit number → workspace default → sole number.
 *
 * RLS remains authoritative when this receives a session-scoped client, so a
 * selected-only agent cannot resolve a number they were not assigned.
 */
export async function resolveWhatsAppNumber({
  supabase,
  accountId,
  whatsappNumberId,
  conversationId,
  requireConnected = true,
}: ResolveOptions): Promise<WhatsAppNumberRow> {
  let resolvedId = whatsappNumberId ?? null

  if (conversationId) {
    const { data: conversation, error } = await supabase
      .from('conversations')
      .select('whatsapp_number_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      throw new WhatsAppNumberError(
        `Failed to resolve the conversation sender: ${error.message}`,
        'database_error',
      )
    }
    if (!conversation) {
      throw new WhatsAppNumberError('Conversation not found', 'not_found')
    }

    const conversationNumberId = conversation.whatsapp_number_id as string | null
    if (resolvedId && conversationNumberId && resolvedId !== conversationNumberId) {
      throw new WhatsAppNumberError(
        'This conversation belongs to a different WhatsApp number',
        'not_accessible',
      )
    }
    resolvedId = conversationNumberId ?? resolvedId
  }

  let query = supabase
    .from('whatsapp_numbers')
    .select(SERVER_COLUMNS)
    .eq('account_id', accountId)

  if (resolvedId) {
    query = query.eq('id', resolvedId)
  } else {
    query = query.eq('is_default', true)
  }

  const { data, error } = await query.limit(1).maybeSingle()
  if (error) {
    throw new WhatsAppNumberError(
      `Failed to load the WhatsApp number: ${error.message}`,
      'database_error',
    )
  }

  let number = data as unknown as WhatsAppNumberRow | null

  // A pre-connection workspace may have no default. If it has exactly one
  // accessible row, using that row is deterministic and matches legacy UX.
  if (!number && !resolvedId) {
    const { data: rows, error: rowsError } = await supabase
      .from('whatsapp_numbers')
      .select(SERVER_COLUMNS)
      .eq('account_id', accountId)
      .limit(2)
    if (rowsError) {
      throw new WhatsAppNumberError(
        `Failed to load WhatsApp numbers: ${rowsError.message}`,
        'database_error',
      )
    }
    if (rows?.length === 1) number = rows[0] as unknown as WhatsAppNumberRow
  }

  if (!number) {
    throw new WhatsAppNumberError(
      resolvedId
        ? 'WhatsApp number not found or not assigned to this member'
        : 'No WhatsApp number is configured for this workspace',
      resolvedId ? 'not_accessible' : 'not_configured',
    )
  }

  if (requireConnected && number.status !== 'connected') {
    throw new WhatsAppNumberError(
      `WhatsApp number “${number.label}” is not connected`,
      'not_connected',
    )
  }

  return number
}

export function sanitizeWhatsAppNumber(
  row: WhatsAppNumberRow,
): WhatsAppNumberSummary {
  const { access_token: _accessToken, verify_token: _verifyToken,
    created_by_user_id: _createdBy, ...safe } = row
  void _accessToken
  void _verifyToken
  void _createdBy
  return safe
}
