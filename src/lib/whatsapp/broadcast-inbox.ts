import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageTemplate } from '@/types';
import { renderTemplateBody } from '@/lib/whatsapp/template-render';
import { buildTemplateMessageSnapshot } from '@/lib/whatsapp/template-message-snapshot';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import {
  resolveConversationByPhone,
  resolveConversationForContact,
} from '@/lib/whatsapp/resolve-conversation';

export interface BroadcastInboxMessageInput {
  accountId: string;
  auditUserId: string;
  contactId?: string | null;
  recipientPhone: string;
  whatsappNumberId: string;
  metaMessageId: string;
  templateName: string;
  template: MessageTemplate | null;
  params?: string[];
  messageParams?: SendTimeParams;
}

export interface BroadcastInboxSnapshot {
  contentText: string;
  templatePayload: ReturnType<typeof buildTemplateMessageSnapshot> | null;
}

/** Build the immutable text and visual payload shown in the Inbox. */
export function buildBroadcastInboxSnapshot(
  templateName: string,
  template: MessageTemplate | null,
  params: string[] = [],
  messageParams?: SendTimeParams,
): BroadcastInboxSnapshot {
  if (!template) {
    return {
      contentText: `Template: ${templateName}`,
      templatePayload: null,
    };
  }

  const bodyValues = messageParams?.body ?? params;
  const contentText = renderTemplateBody(template.body_text, bodyValues);
  return {
    contentText,
    templatePayload: buildTemplateMessageSnapshot(
      template,
      contentText,
      messageParams,
    ),
  };
}

/**
 * Persist one Meta-accepted broadcast delivery into the Inbox.
 *
 * The Meta message id is checked first so a retried persistence call is
 * idempotent. This function never sends to Meta; callers invoke it only after
 * a successful send, eliminating any risk of duplicate customer deliveries.
 */
export async function persistBroadcastInboxMessage(
  db: SupabaseClient,
  input: BroadcastInboxMessageInput,
): Promise<string> {
  const snapshot = buildBroadcastInboxSnapshot(
    input.templateName,
    input.template,
    input.params,
    input.messageParams,
  );
  const { data: existingRows, error: existingError } = await db
    .from('messages')
    .select('id, conversation_id, created_at')
    .eq('whatsapp_number_id', input.whatsappNumberId)
    .eq('message_id', input.metaMessageId)
    .limit(1);

  if (existingError) {
    throw new Error(`Failed to check existing Inbox message: ${existingError.message}`);
  }
  if (existingRows && existingRows.length > 0) {
    // A previous attempt may have inserted the message but failed while
    // updating its conversation preview. Repair that second half on retry.
    const { error: repairError } = await db
      .from('conversations')
      .update({
        last_message_text: snapshot.contentText,
        last_message_at: existingRows[0].created_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingRows[0].conversation_id);
    if (repairError) {
      throw new Error(
        `Inbox message exists but its conversation preview could not be repaired: ${repairError.message}`,
      );
    }
    return existingRows[0].id as string;
  }

  let conversationId: string;
  if (input.contactId) {
    const { data: contact, error: contactError } = await db
      .from('contacts')
      .select('id')
      .eq('id', input.contactId)
      .eq('account_id', input.accountId)
      .maybeSingle();
    if (contactError || !contact) {
      throw new Error('Broadcast contact is not available in this workspace.');
    }
    conversationId = await resolveConversationForContact(
      db,
      input.accountId,
      contact.id,
      input.auditUserId,
      input.whatsappNumberId,
    );
  } else {
    const resolved = await resolveConversationByPhone(
      db,
      input.accountId,
      input.recipientPhone,
      null,
      {
        requireWhatsAppConfig: false,
        whatsappNumberId: input.whatsappNumberId,
      },
    );
    conversationId = resolved.conversationId;
  }

  const now = new Date().toISOString();
  const { data: message, error: messageError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: input.auditUserId,
      content_type: 'template',
      content_text: snapshot.contentText,
      template_name: input.templateName,
      template_payload: snapshot.templatePayload,
      message_id: input.metaMessageId,
      status: 'sent',
      whatsapp_number_id: input.whatsappNumberId,
      message_origin: 'cloud_api',
      created_at: now,
    })
    .select('id')
    .single();

  if (messageError || !message) {
    throw new Error(
      `Message reached Meta but could not be saved to Inbox: ${messageError?.message ?? 'unknown error'}`,
    );
  }

  const { error: conversationError } = await db
    .from('conversations')
    .update({
      last_message_text: snapshot.contentText,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', conversationId);

  if (conversationError) {
    throw new Error(
      `Broadcast message was saved but its conversation preview was not updated: ${conversationError.message}`,
    );
  }

  return message.id as string;
}
