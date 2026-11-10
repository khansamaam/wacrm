import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';

/** A thread created this close to the message was created for it. */
const CREATED_FOR_MESSAGE_MS = 10 * 60 * 1000;

interface MisfiledRow {
  id: string;
  conversation_id: string;
  created_at: string;
  conversations: {
    account_id: string;
    contact_id: string;
    created_at: string;
    contacts: { phone: string } | null;
  };
}

/**
 * Meta's status webhook names the number that really sent a message. A
 * message mirrored by /api/v1/messages/sync may have been filed under a
 * guessed number; when the two disagree, move it to the sender's chat.
 *
 * Only rows with message_origin 'external_api' are moved, so messages sent
 * from wacrm itself are never touched. Errors are logged, never thrown, so
 * status processing always continues.
 */
export async function relocateSyncedMessage(
  db: SupabaseClient,
  wamid: string,
  sender: { id: string; account_id: string }
): Promise<number> {
  try {
    const { data, error } = await db
      .from('messages')
      .select(
        'id, conversation_id, created_at, conversations!inner(account_id, contact_id, created_at, contacts(phone))'
      )
      .eq('message_id', wamid)
      .eq('message_origin', 'external_api')
      .neq('whatsapp_number_id', sender.id)
      .eq('conversations.account_id', sender.account_id)
      .limit(5);
    if (error) throw error;
    const rows = (data ?? []) as unknown as MisfiledRow[];
    if (rows.length === 0) return 0;

    // Already mirrored on the right number (e.g. synced twice): leave it.
    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('message_id', wamid)
      .eq('whatsapp_number_id', sender.id);
    if ((count ?? 0) > 0) return 0;

    let moved = 0;
    for (const row of rows) {
      const phone = row.conversations.contacts?.phone;
      if (!phone) continue;

      const target = await resolveConversationByPhone(
        db,
        sender.account_id,
        phone,
        null,
        { requireWhatsAppConfig: false, whatsappNumberId: sender.id }
      );
      const { error: moveError } = await db
        .from('messages')
        .update({
          conversation_id: target.conversationId,
          whatsapp_number_id: sender.id,
        })
        .eq('id', row.id);
      if (moveError) throw moveError;
      moved++;

      await refreshPreview(db, target.conversationId);
      const leftover = await refreshPreview(db, row.conversation_id);
      const cutoff = Date.parse(row.created_at) - CREATED_FOR_MESSAGE_MS;
      if (leftover === 0 && Date.parse(row.conversations.created_at) >= cutoff) {
        await removeEmptyThread(db, row.conversation_id, row.conversations.contact_id, cutoff);
      }
      console.info(
        `[sync-relocation] moved ${wamid} to number ${sender.id} (conversation ${target.conversationId})`
      );
    }
    return moved;
  } catch (error) {
    console.error('[sync-relocation] failed:', error);
    return 0;
  }
}

/** Re-point the inbox preview at the latest message; returns the message count. */
async function refreshPreview(db: SupabaseClient, conversationId: string): Promise<number> {
  const { data, count } = await db
    .from('messages')
    .select('content_text, content_type, template_name, created_at', { count: 'exact' })
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1);
  const latest = data?.[0] as
    | { content_text: string | null; content_type: string; template_name: string | null; created_at: string }
    | undefined;
  if (latest) {
    await db
      .from('conversations')
      .update({
        last_message_text:
          latest.content_text ||
          (latest.template_name ? `Template: ${latest.template_name}` : `[${latest.content_type}]`),
        last_message_at: latest.created_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
  }
  return count ?? 0;
}

/**
 * The wrong-number thread existed only because of the misfiled message.
 * Remove it, and its contact when that was also created for the message
 * and nothing else uses it.
 */
async function removeEmptyThread(
  db: SupabaseClient,
  conversationId: string,
  contactId: string,
  cutoff: number
) {
  await db.from('conversations').delete().eq('id', conversationId);

  const { data: contact } = await db
    .from('contacts')
    .select('created_at')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact || Date.parse(contact.created_at as string) < cutoff) return;

  const [{ count: conversations }, { count: deals }] = await Promise.all([
    db.from('conversations').select('id', { count: 'exact', head: true }).eq('contact_id', contactId),
    db.from('deals').select('id', { count: 'exact', head: true }).eq('contact_id', contactId),
  ]);
  if ((conversations ?? 0) === 0 && (deals ?? 0) === 0) {
    await db.from('contacts').delete().eq('id', contactId);
  }
}
