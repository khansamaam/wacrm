import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageStatus } from '@/types';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { ExternalMessageSyncInput } from '@/lib/whatsapp/external-message-schema';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';

const SUCCESS_STATUS_ORDER: readonly MessageStatus[] = [
  'sending',
  'sent',
  'delivered',
  'read',
];

interface ExistingMessage {
  id: string;
  status: MessageStatus;
  delivery_error_code: string | null;
  delivery_error_message: string | null;
}

export interface ExternalMessageSyncResult {
  messageId: string;
  conversationId: string;
  contactId: string;
  contactCreated: boolean;
  created: boolean;
  status: MessageStatus;
  statusChanged: boolean;
}

/**
 * Status callbacks can arrive late or out of order. Keep the furthest known
 * success state, and only accept failure before delivery has been confirmed.
 */
export function nextExternalMessageStatus(
  current: MessageStatus,
  incoming: MessageStatus
): MessageStatus {
  if (current === 'failed') return current;
  if (incoming === 'failed') {
    return current === 'sending' || current === 'sent' ? 'failed' : current;
  }

  const currentIndex = SUCCESS_STATUS_ORDER.indexOf(current);
  const incomingIndex = SUCCESS_STATUS_ORDER.indexOf(incoming);
  return incomingIndex > currentIndex ? incoming : current;
}

function messagePreview(input: ExternalMessageSyncInput): string {
  if (input.contentText) return input.contentText;
  if (input.templateName) return `Template: ${input.templateName}`;
  return `[${input.contentType}]`;
}

function buildMessageValues(
  input: ExternalMessageSyncInput,
  status: MessageStatus,
  existing?: ExistingMessage | null
): Record<string, unknown> {
  const preserveExistingFailure =
    status === 'failed' &&
    existing?.status === 'failed' &&
    input.status !== 'failed';

  return {
    sender_type: 'agent',
    content_type: input.contentType,
    content_text: input.contentText,
    media_url: input.mediaUrl,
    template_name: input.templateName,
    template_payload: input.templatePayload,
    message_id: input.whatsappMessageId,
    status,
    delivery_error_code:
      status === 'failed'
        ? preserveExistingFailure
          ? existing.delivery_error_code
          : input.deliveryErrorCode
        : null,
    delivery_error_message:
      status === 'failed'
        ? preserveExistingFailure
          ? existing.delivery_error_message
          : input.deliveryErrorMessage
        : null,
  };
}

interface SenderNumberRow {
  id: string;
  phone_number_id: string | null;
  display_phone_number: string | null;
  waba_id: string | null;
}

/**
 * Pick the business number a synced message was sent from. Never throws:
 * a lookup problem only means the workspace default is used, as before.
 *
 * 1. The caller's hint (phone_number_id, whatsapp_number_id or from).
 * 2. The only number whose WABA owns the template.
 * 3. The number this customer most recently chatted with.
 * 4. null, i.e. the workspace default.
 *
 * A wrong guess is corrected when Meta's status webhook reports the real
 * sender (see relocateSyncedMessage).
 */
export async function resolveSyncSender(
  db: SupabaseClient,
  accountId: string,
  input: Pick<ExternalMessageSyncInput, 'sender' | 'templateName' | 'phone'>
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('whatsapp_numbers')
      .select('id, phone_number_id, display_phone_number, waba_id')
      .eq('account_id', accountId);
    if (error) throw error;
    const rows = (data ?? []) as SenderNumberRow[];
    if (rows.length === 0) return null;

    const { sender } = input;
    if (sender.whatsappNumberId || sender.phoneNumberId || sender.phone) {
      const match = rows.find((row) => {
        if (sender.whatsappNumberId) return row.id === sender.whatsappNumberId;
        if (sender.phoneNumberId) return row.phone_number_id === sender.phoneNumberId;
        return sanitizePhoneForMeta(row.display_phone_number ?? '') === sender.phone;
      });
      if (match) return match.id;
      console.warn(
        '[external-message-sync] sender hint matches no number in this workspace; detecting automatically'
      );
    }
    if (rows.length === 1) return rows[0].id;

    if (input.templateName) {
      const { data: templates } = await db
        .from('message_templates')
        .select('waba_id')
        .eq('account_id', accountId)
        .eq('name', input.templateName);
      const wabaIds = new Set(
        ((templates ?? []) as Array<{ waba_id: string | null }>)
          .map((t) => t.waba_id)
          .filter(Boolean)
      );
      const owners = rows.filter((row) => row.waba_id && wabaIds.has(row.waba_id));
      if (owners.length === 1) return owners[0].id;
    }

    const suffix = input.phone.slice(-8);
    const { data: recent } = await db
      .from('conversations')
      .select('whatsapp_number_id, contacts!inner(phone_normalized)')
      .eq('account_id', accountId)
      .not('whatsapp_number_id', 'is', null)
      .like('contacts.phone_normalized', `%${suffix}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1);
    const recentId = (recent?.[0] as { whatsapp_number_id?: string } | undefined)
      ?.whatsapp_number_id;
    if (recentId && rows.some((row) => row.id === recentId)) return recentId;
  } catch (error) {
    console.error('[external-message-sync] sender detection failed:', error);
  }
  return null;
}

/**
 * Mirror a message that another system already sent through Meta.
 *
 * The Meta message id is the idempotency key inside the resolved
 * conversation, so retries update one inbox bubble instead of duplicating it.
 */
export async function syncExternalMessage(
  db: SupabaseClient,
  accountId: string,
  input: ExternalMessageSyncInput
): Promise<ExternalMessageSyncResult> {
  // A retry (e.g. a later status report) must update the bubble wherever it
  // now lives, even if the status webhook has since moved it to the real
  // sender's chat, so look it up across the workspace first.
  const { data: synced, error: findError } = await db
    .from('messages')
    .select(
      'id, status, delivery_error_code, delivery_error_message, conversation_id, conversations!inner(account_id, contact_id)'
    )
    .eq('message_id', input.whatsappMessageId)
    .eq('sender_type', 'agent')
    .eq('conversations.account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError) {
    console.error('[external-message-sync] message lookup failed:', findError);
    throw new SendMessageError(
      'db_error',
      'Failed to check whether the message was already synced',
      500
    );
  }

  let resolved: Awaited<ReturnType<typeof resolveConversationByPhone>>;
  if (synced) {
    const conversation = synced.conversations as unknown as { contact_id: string };
    resolved = {
      conversationId: synced.conversation_id as string,
      contactId: conversation.contact_id,
      contactCreated: false,
    };
  } else {
    const whatsappNumberId = await resolveSyncSender(db, accountId, input);
    resolved = await resolveConversationByPhone(
      db,
      accountId,
      input.phone,
      input.contactName,
      { requireWhatsAppConfig: false, whatsappNumberId }
    );
  }
  const existing = synced;

  const previous = existing as ExistingMessage | null;
  const effectiveStatus = previous
    ? nextExternalMessageStatus(previous.status, input.status)
    : input.status;
  const statusChanged =
    previous !== null && previous.status !== effectiveStatus;

  let messageId: string;
  if (previous) {
    const { error: updateError } = await db
      .from('messages')
      .update(buildMessageValues(input, effectiveStatus, previous))
      .eq('id', previous.id);

    if (updateError) {
      console.error(
        '[external-message-sync] message update failed:',
        updateError
      );
      throw new SendMessageError(
        'db_error',
        'Failed to update the synced message',
        500
      );
    }
    messageId = previous.id;
  } else {
    const { data: inserted, error: insertError } = await db
      .from('messages')
      .insert({
        conversation_id: resolved.conversationId,
        ...buildMessageValues(input, effectiveStatus),
        // Marks the row as mirrored, so the status webhook may move it to
        // the number Meta reports as the real sender.
        message_origin: 'external_api',
        created_at: input.timestamp,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error(
        '[external-message-sync] message insert failed:',
        insertError
      );
      throw new SendMessageError(
        'db_error',
        'Failed to save the externally sent message',
        500
      );
    }
    messageId = inserted.id;
  }

  // Importing historical data must not replace a newer conversation preview.
  const { data: conversation, error: conversationFindError } = await db
    .from('conversations')
    .select('last_message_at')
    .eq('id', resolved.conversationId)
    .single();

  if (conversationFindError) {
    console.error(
      '[external-message-sync] conversation lookup failed:',
      conversationFindError
    );
    throw new SendMessageError(
      'db_error',
      'Message was saved, but the conversation could not be refreshed',
      500
    );
  }

  const lastMessageAt =
    typeof conversation?.last_message_at === 'string'
      ? Date.parse(conversation.last_message_at)
      : Number.NEGATIVE_INFINITY;
  if (
    !Number.isFinite(lastMessageAt) ||
    Date.parse(input.timestamp) >= lastMessageAt
  ) {
    const { error: conversationUpdateError } = await db
      .from('conversations')
      .update({
        last_message_text: messagePreview(input),
        last_message_at: input.timestamp,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolved.conversationId);

    if (conversationUpdateError) {
      console.error(
        '[external-message-sync] conversation update failed:',
        conversationUpdateError
      );
      throw new SendMessageError(
        'db_error',
        'Message was saved, but the Inbox conversation could not be updated',
        500
      );
    }
  }

  if (statusChanged) {
    await dispatchWebhookEvent(db, accountId, 'message.status_updated', {
      whatsapp_message_id: input.whatsappMessageId,
      conversation_id: resolved.conversationId,
      status: effectiveStatus,
      delivery_error_code:
        effectiveStatus === 'failed' ? input.deliveryErrorCode : null,
      delivery_error_message:
        effectiveStatus === 'failed' ? input.deliveryErrorMessage : null,
    });
  }

  return {
    messageId,
    conversationId: resolved.conversationId,
    contactId: resolved.contactId,
    contactCreated: resolved.contactCreated,
    created: previous === null,
    status: effectiveStatus,
    statusChanged,
  };
}
