import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageStatus } from '@/types';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { ExternalMessageSyncInput } from '@/lib/whatsapp/external-message-schema';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
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
  const resolved = await resolveConversationByPhone(
    db,
    accountId,
    input.phone,
    input.contactName,
    { requireWhatsAppConfig: false }
  );

  const { data: existing, error: findError } = await db
    .from('messages')
    .select('id, status, delivery_error_code, delivery_error_message')
    .eq('conversation_id', resolved.conversationId)
    .eq('message_id', input.whatsappMessageId)
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
