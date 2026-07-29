import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import {
  ExternalMessageValidationError,
  parseExternalMessageSyncPayload,
} from '@/lib/whatsapp/external-message-schema';
import { syncExternalMessage } from '@/lib/whatsapp/external-message-sync';
import { SendMessageError } from '@/lib/whatsapp/send-message';

/**
 * Record a message that an external system already sent through Meta.
 * This route only mirrors data into the CRM; it never sends to WhatsApp.
 */
export async function POST(request: Request) {
  try {
    const context = await requireApiKey(request, 'messages:sync');
    const body = await request.json().catch(() => null);
    const input = parseExternalMessageSyncPayload(body);
    const result = await syncExternalMessage(
      context.supabase,
      context.accountId,
      input
    );

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: input.whatsappMessageId,
        conversation_id: result.conversationId,
        contact_id: result.contactId,
        contact_created: result.contactCreated,
        created: result.created,
        status: result.status,
        status_changed: result.statusChanged,
      },
      result.created ? 201 : 200
    );
  } catch (error) {
    if (error instanceof ExternalMessageValidationError) {
      return fail('bad_request', error.message, 400);
    }
    if (error instanceof SendMessageError) {
      return fail(error.code, error.message, error.status);
    }
    return toApiErrorResponse(error);
  }
}
