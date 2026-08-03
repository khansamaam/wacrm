import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '@/types';
import { buildBroadcastTemplateParams } from './broadcast-template-params';

const template: MessageTemplate = {
  id: 'template-1',
  user_id: 'user-1',
  name: 'carousel_offer',
  category: 'Marketing',
  language: 'en_US',
  template_type: 'carousel',
  body_text: 'Offers for {{1}}',
  carousel_cards: [
    {
      header_type: 'image',
      body_text: 'Hello {{1}}',
      buttons: [
        {
          type: 'URL',
          text: 'Book',
          url: 'https://example.com/{{1}}',
          example: 'offer-one',
        },
      ],
    },
    {
      header_type: 'image',
      header_media_url: 'https://cdn.example.com/stored-two.jpg',
      body_text: 'Second card',
    },
  ],
  created_at: '2026-01-01T00:00:00Z',
};

describe('buildBroadcastTemplateParams', () => {
  it('builds per-card media, recipient body values, and dynamic button values', () => {
    expect(
      buildBroadcastTemplateParams(template, {
        body: ['Samaam'],
        carouselCardMediaUrls: ['https://cdn.example.com/uploaded-one.jpg', ''],
      })
    ).toEqual({
      body: ['Samaam'],
      carouselCards: [
        {
          body: ['Samaam'],
          headerMediaUrl: 'https://cdn.example.com/uploaded-one.jpg',
          buttonParams: { 0: 'offer-one' },
        },
        {
          body: ['Samaam'],
          headerMediaUrl: 'https://cdn.example.com/stored-two.jpg',
          buttonParams: undefined,
        },
      ],
    });
  });
});
