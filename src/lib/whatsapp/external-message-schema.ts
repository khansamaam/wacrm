import type {
  MessageStatus,
  TemplateMessageButtonSnapshot,
  TemplateMessageSnapshot,
} from '@/types';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

const CONTENT_TYPES = [
  'text',
  'template',
  'image',
  'video',
  'document',
  'audio',
] as const;
const MESSAGE_STATUSES: readonly MessageStatus[] = [
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
];
const TEMPLATE_HEADER_TYPES = ['text', 'image', 'video', 'document'] as const;
const TEMPLATE_BUTTON_TYPES = [
  'QUICK_REPLY',
  'URL',
  'PHONE_NUMBER',
  'COPY_CODE',
] as const;

const MAX_META_ID_LENGTH = 1_024;
const MAX_TEXT_LENGTH = 65_536;
const MAX_TEMPLATE_NAME_LENGTH = 512;
const MAX_ERROR_LENGTH = 2_000;

export type ExternalContentType = (typeof CONTENT_TYPES)[number];

export interface ExternalMessageSyncInput {
  phone: string;
  contactName: string | null;
  whatsappMessageId: string;
  contentType: ExternalContentType;
  contentText: string | null;
  mediaUrl: string | null;
  templateName: string | null;
  templatePayload: TemplateMessageSnapshot | null;
  timestamp: string;
  status: MessageStatus;
  deliveryErrorCode: string | null;
  deliveryErrorMessage: string | null;
}

export class ExternalMessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalMessageValidationError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ExternalMessageValidationError(`'${field}' must be a string`);
  }

  const result = value.trim();
  if (result.length > maxLength) {
    throw new ExternalMessageValidationError(
      `'${field}' must be ${maxLength} characters or fewer`
    );
  }
  return result || null;
}

function parseHttpsUrl(value: unknown, field: string): string | null {
  const raw = optionalText(value, field, 4_096);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('not https');
    return url.toString();
  } catch {
    throw new ExternalMessageValidationError(
      `'${field}' must be a valid public HTTPS URL`
    );
  }
}

function parseTimestamp(value: unknown): string {
  let timestamp: Date;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Meta uses Unix seconds, while browser integrations commonly use
    // milliseconds. Supporting both avoids lossy timestamp conversion.
    timestamp = new Date(value < 10_000_000_000 ? value * 1_000 : value);
  } else if (typeof value === 'string' && value.trim()) {
    timestamp = new Date(value);
  } else {
    throw new ExternalMessageValidationError(
      "'timestamp' must be an ISO-8601 string or Unix timestamp"
    );
  }

  if (Number.isNaN(timestamp.getTime())) {
    throw new ExternalMessageValidationError("'timestamp' is invalid");
  }
  return timestamp.toISOString();
}

function parseTemplateButtons(
  value: unknown
): TemplateMessageButtonSnapshot[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 10) {
    throw new ExternalMessageValidationError(
      "'template.buttons' must be an array with at most 10 buttons"
    );
  }

  return value.map((item, index) => {
    const button = asRecord(item);
    if (!button) {
      throw new ExternalMessageValidationError(
        `template button ${index + 1} must be an object`
      );
    }

    const type = trimmed(button.type).toUpperCase();
    if (!(TEMPLATE_BUTTON_TYPES as readonly string[]).includes(type)) {
      throw new ExternalMessageValidationError(
        `template button ${index + 1} has an unsupported type`
      );
    }

    const text = optionalText(
      button.text,
      `template.buttons[${index}].text`,
      80
    );
    if (!text) {
      throw new ExternalMessageValidationError(
        `template button ${index + 1} requires text`
      );
    }

    const parsed: TemplateMessageButtonSnapshot = {
      type: type as TemplateMessageButtonSnapshot['type'],
      text,
    };

    if (parsed.type === 'URL') {
      parsed.url =
        parseHttpsUrl(button.url, `template.buttons[${index}].url`) ??
        undefined;
      if (!parsed.url) {
        throw new ExternalMessageValidationError(
          `template button ${index + 1} requires a URL`
        );
      }
    } else if (parsed.type === 'PHONE_NUMBER') {
      parsed.phone_number =
        optionalText(
          button.phone_number,
          `template.buttons[${index}].phone_number`,
          32
        ) ?? undefined;
    } else if (parsed.type === 'COPY_CODE') {
      parsed.code =
        optionalText(button.code, `template.buttons[${index}].code`, 128) ??
        undefined;
    }

    return parsed;
  });
}

function parseTemplate(
  value: unknown,
  fallbackText: string | null,
  mediaUrl: string | null
): {
  name: string;
  contentText: string;
  payload: TemplateMessageSnapshot;
} {
  const template = asRecord(value);
  if (!template) {
    throw new ExternalMessageValidationError(
      "'template' is required when type is 'template'"
    );
  }

  const name = optionalText(
    template.name,
    'template.name',
    MAX_TEMPLATE_NAME_LENGTH
  );
  if (!name) {
    throw new ExternalMessageValidationError("'template.name' is required");
  }

  const bodyText =
    optionalText(template.body_text, 'template.body_text', MAX_TEXT_LENGTH) ??
    fallbackText;
  if (!bodyText) {
    throw new ExternalMessageValidationError(
      "'template.body_text' or 'text' is required for a template message"
    );
  }

  const rawHeaderType = trimmed(template.header_type).toLowerCase();
  if (
    rawHeaderType &&
    !(TEMPLATE_HEADER_TYPES as readonly string[]).includes(rawHeaderType)
  ) {
    throw new ExternalMessageValidationError(
      "'template.header_type' must be text, image, video, or document"
    );
  }

  const payload: TemplateMessageSnapshot = { body_text: bodyText };
  if (rawHeaderType) {
    payload.header_type =
      rawHeaderType as TemplateMessageSnapshot['header_type'];
  }

  const headerText = optionalText(
    template.header_text,
    'template.header_text',
    1_024
  );
  if (headerText) payload.header_text = headerText;

  const headerMediaUrl =
    parseHttpsUrl(template.header_media_url, 'template.header_media_url') ??
    mediaUrl;
  if (headerMediaUrl) payload.header_media_url = headerMediaUrl;

  const footerText = optionalText(
    template.footer_text,
    'template.footer_text',
    1_024
  );
  if (footerText) payload.footer_text = footerText;

  const buttons = parseTemplateButtons(template.buttons);
  if (buttons?.length) payload.buttons = buttons;

  return { name, contentText: bodyText, payload };
}

/**
 * Validate before resolving a contact so malformed requests cannot create
 * empty contacts or conversations.
 */
export function parseExternalMessageSyncPayload(
  value: unknown
): ExternalMessageSyncInput {
  const body = asRecord(value);
  if (!body) {
    throw new ExternalMessageValidationError(
      'Request body must be a JSON object'
    );
  }

  const rawPhone = trimmed(body.to) || trimmed(body.recipient_phone);
  const phone = sanitizePhoneForMeta(rawPhone);
  if (!isValidE164(phone)) {
    throw new ExternalMessageValidationError(
      "'to' must be a valid phone number in E.164 format"
    );
  }

  const whatsappMessageId =
    trimmed(body.whatsapp_message_id) || trimmed(body.meta_message_id);
  if (!whatsappMessageId) {
    throw new ExternalMessageValidationError(
      "'whatsapp_message_id' is required"
    );
  }
  if (whatsappMessageId.length > MAX_META_ID_LENGTH) {
    throw new ExternalMessageValidationError(
      `'whatsapp_message_id' must be ${MAX_META_ID_LENGTH} characters or fewer`
    );
  }

  const rawType = trimmed(body.type).toLowerCase();
  if (!(CONTENT_TYPES as readonly string[]).includes(rawType)) {
    throw new ExternalMessageValidationError(
      "'type' must be text, template, image, video, document, or audio"
    );
  }

  const contentType = rawType as ExternalContentType;
  const contentText = optionalText(body.text, 'text', MAX_TEXT_LENGTH);
  const mediaUrl = parseHttpsUrl(body.media_url, 'media_url');

  if (contentType === 'text' && !contentText) {
    throw new ExternalMessageValidationError(
      "'text' is required when type is 'text'"
    );
  }
  if (
    ['image', 'video', 'document', 'audio'].includes(contentType) &&
    !mediaUrl
  ) {
    throw new ExternalMessageValidationError(
      "'media_url' is required for media messages"
    );
  }

  const rawStatus = trimmed(body.status).toLowerCase();
  if (!(MESSAGE_STATUSES as readonly string[]).includes(rawStatus)) {
    throw new ExternalMessageValidationError(
      "'status' must be sending, sent, delivered, read, or failed"
    );
  }
  const status = rawStatus as MessageStatus;

  let templateName: string | null = null;
  let templatePayload: TemplateMessageSnapshot | null = null;
  let persistedText = contentText;
  if (contentType === 'template') {
    const parsed = parseTemplate(body.template, contentText, mediaUrl);
    templateName = parsed.name;
    templatePayload = parsed.payload;
    persistedText = parsed.contentText;
  }

  const deliveryError = asRecord(body.delivery_error);
  const deliveryErrorCode =
    status === 'failed'
      ? optionalText(
          deliveryError?.code,
          'delivery_error.code',
          MAX_ERROR_LENGTH
        )
      : null;
  const deliveryErrorMessage =
    status === 'failed'
      ? optionalText(
          deliveryError?.message,
          'delivery_error.message',
          MAX_ERROR_LENGTH
        )
      : null;

  return {
    phone,
    contactName: optionalText(body.name, 'name', 200),
    whatsappMessageId,
    contentType,
    contentText: persistedText,
    mediaUrl,
    templateName,
    templatePayload,
    timestamp: parseTimestamp(body.timestamp),
    status,
    deliveryErrorCode,
    deliveryErrorMessage,
  };
}
