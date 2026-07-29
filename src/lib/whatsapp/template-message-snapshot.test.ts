import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '@/types';
import { buildTemplateMessageSnapshot } from './template-message-snapshot';

const template: MessageTemplate = {
  id: 'template-1',
  user_id: 'user-1',
  name: 'last_minute_offer',
  category: 'Marketing',
  language: 'en_US',
  header_type: 'image',
  header_media_url: 'https://cdn.example.com/default.jpg',
  body_text: 'Hey {{1}}',
  footer_text: 'Contact us today!',
  buttons: [
    { type: 'PHONE_NUMBER', text: 'CALL NOW', phone_number: '+971500000000' },
    {
      type: 'URL',
      text: 'BOOK AN APPOINTMENT',
      url: 'https://example.com/book/{{1}}',
    },
  ],
  created_at: '2026-01-01T00:00:00Z',
};

describe('buildTemplateMessageSnapshot', () => {
  it('captures the exact media and resolved buttons used for this send', () => {
    expect(
      buildTemplateMessageSnapshot(template, 'Hey Acme', {
        headerMediaUrl: 'https://cdn.example.com/offer.jpg',
        buttonParams: { 1: 'acme' },
      }),
    ).toEqual({
      header_type: 'image',
      header_text: undefined,
      header_media_url: 'https://cdn.example.com/offer.jpg',
      body_text: 'Hey Acme',
      footer_text: 'Contact us today!',
      buttons: [
        {
          type: 'PHONE_NUMBER',
          text: 'CALL NOW',
          phone_number: '+971500000000',
        },
        {
          type: 'URL',
          text: 'BOOK AN APPOINTMENT',
          url: 'https://example.com/book/acme',
        },
      ],
    });
  });
});
