import { describe, expect, it } from 'vitest';

import type { MessageTemplate } from '@/types';
import { buildBroadcastInboxSnapshot } from './broadcast-inbox';

const carouselTemplate: MessageTemplate = {
  id: 'template-1',
  user_id: 'user-1',
  name: 'carousel_offer',
  category: 'Marketing',
  language: 'en_US',
  status: 'APPROVED',
  template_type: 'carousel',
  body_text: 'Hi {{1}}, choose an offer',
  carousel_cards: [
    {
      header_type: 'image',
      header_media_url: 'https://example.com/sample.jpg',
      body_text: 'Offer for {{1}}',
      buttons: [{ type: 'QUICK_REPLY', text: 'Choose' }],
    },
  ],
  created_at: '2026-08-03T00:00:00.000Z',
};

describe('buildBroadcastInboxSnapshot', () => {
  it('captures the exact resolved carousel content sent to a recipient', () => {
    expect(
      buildBroadcastInboxSnapshot(
        carouselTemplate.name,
        carouselTemplate,
        ['Legacy'],
        {
          body: ['Samaam'],
          carouselCards: [
            {
              body: ['Samaam'],
              headerMediaUrl: 'https://cdn.example.com/live-card.jpg',
            },
          ],
        },
      ),
    ).toEqual({
      contentText: 'Hi Samaam, choose an offer',
      templatePayload: expect.objectContaining({
        body_text: 'Hi Samaam, choose an offer',
        carousel_cards: [
          expect.objectContaining({
            header_media_url: 'https://cdn.example.com/live-card.jpg',
            body_text: 'Offer for Samaam',
          }),
        ],
      }),
    });
  });

  it('uses a readable fallback when the local template row is unavailable', () => {
    expect(buildBroadcastInboxSnapshot('legacy_template', null)).toEqual({
      contentText: 'Template: legacy_template',
      templatePayload: null,
    });
  });
});
