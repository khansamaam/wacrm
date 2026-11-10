/**
 * Inbox text for a message WhatsApp delivered without its content
 * (`type: "unsupported"`). Meta withholds some messages from the API, e.g.
 * the preview card of a Click-to-WhatsApp ad, view-once media, polls or
 * photo albums; on a coexistence number the phone app still shows them.
 */
export function describeUnsupportedMessage(message: {
  type?: string;
  errors?: Array<{ code?: number }>;
  unsupported?: { type?: string };
}): string {
  const code = message.errors?.[0]?.code;
  const kind = message.unsupported?.type;

  if (kind === 'album') {
    return '[Album of photos: WhatsApp does not share albums with wacrm. View it in the WhatsApp app on the phone.]';
  }
  if (code === 131060 || code === 131051 || message.type === 'unsupported') {
    return "[Message not available: WhatsApp didn't share its content (for example an ad preview, a view-once photo or a poll). View it in the WhatsApp app on the phone.]";
  }
  return `[Unsupported message type: ${message.type ?? 'unknown'}]`;
}

/**
 * Meta reports "played" when a voice note is listened to. The messages
 * table only knows sent/delivered/read/failed, and played implies read.
 */
export function normalizeWebhookMessageStatus(status: string): string {
  return status === 'played' ? 'read' : status;
}
