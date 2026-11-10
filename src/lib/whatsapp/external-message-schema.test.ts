import { describe, expect, it, vi } from 'vitest';

import {
  ExternalMessageValidationError,
  parseExternalMessageSyncPayload,
} from './external-message-schema';

describe('parseExternalMessageSyncPayload', () => {
  it('normalizes a text message and Unix timestamp', () => {
    const result = parseExternalMessageSyncPayload({
      recipient_phone: '+1 (415) 555-0123',
      meta_message_id: 'wamid.123',
      type: 'TEXT',
      text: 'Hello',
      timestamp: 1_785_321_000,
      status: 'sent',
    });

    expect(result).toMatchObject({
      phone: '14155550123',
      whatsappMessageId: 'wamid.123',
      contentType: 'text',
      contentText: 'Hello',
      status: 'sent',
    });
    expect(result.timestamp).toBe(new Date(1_785_321_000_000).toISOString());
  });

  it('keeps a complete rendered template snapshot', () => {
    const result = parseExternalMessageSyncPayload({
      to: '+14155550123',
      whatsapp_message_id: 'wamid.template',
      type: 'template',
      timestamp: '2026-07-29T12:30:00Z',
      status: 'delivered',
      template: {
        name: 'order_update',
        body_text: 'Hello Jane, order A123 is ready.',
        header_type: 'image',
        header_media_url: 'https://cdn.example.com/header.jpg',
        footer_text: 'Acme Support',
        buttons: [
          {
            type: 'URL',
            text: 'View order',
            url: 'https://example.com/orders/A123',
          },
        ],
      },
    });

    expect(result.templateName).toBe('order_update');
    expect(result.contentText).toBe('Hello Jane, order A123 is ready.');
    expect(result.templatePayload).toEqual({
      body_text: 'Hello Jane, order A123 is ready.',
      header_type: 'image',
      header_media_url: 'https://cdn.example.com/header.jpg',
      footer_text: 'Acme Support',
      buttons: [
        {
          type: 'URL',
          text: 'View order',
          url: 'https://example.com/orders/A123',
        },
      ],
    });
  });

  it.each([
    [{ to: 'invalid' }, "'to' must be a valid phone number in E.164 format"],
    [
      {
        to: '+14155550123',
        whatsapp_message_id: 'wamid.1',
        type: 'image',
        media_url: 'http://example.com/image.jpg',
        timestamp: '2026-07-29T12:30:00Z',
        status: 'sent',
      },
      "'media_url' must be a valid public HTTPS URL",
    ],
  ])('rejects invalid payload %#', (payload, expectedMessage) => {
    expect(() => parseExternalMessageSyncPayload(payload)).toThrow(
      new ExternalMessageValidationError(expectedMessage)
    );
  });
});

describe('parseExternalMessageSyncPayload sender', () => {
  const base = {
    to: '+971556636519',
    whatsapp_message_id: 'wamid.sender',
    type: 'text',
    text: 'Hi',
    timestamp: '2026-11-08T10:00:00Z',
    status: 'sent',
  };

  it('defaults to no sender hint', () => {
    expect(parseExternalMessageSyncPayload(base).sender).toEqual({
      whatsappNumberId: null,
      phoneNumberId: null,
      phone: null,
    });
  });

  it('reads the Meta phone number ID and the from number', () => {
    const result = parseExternalMessageSyncPayload({
      ...base,
      phone_number_id: '206353349218600',
      from: '+971 800 4526687',
    });
    expect(result.sender).toEqual({
      whatsappNumberId: null,
      phoneNumberId: '206353349218600',
      phone: '9718004526687',
    });
  });

  it.each([
    { phone_number_id: 'abc' },
    { whatsapp_number_id: 'not-a-uuid' },
    { from: '12' },
  ])('ignores a malformed sender instead of failing %#', (extra) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = parseExternalMessageSyncPayload({ ...base, ...extra });
    expect(result.sender).toEqual({
      whatsappNumberId: null,
      phoneNumberId: null,
      phone: null,
    });
    expect(result.whatsappMessageId).toBe('wamid.sender');
    warn.mockRestore();
  });
});
