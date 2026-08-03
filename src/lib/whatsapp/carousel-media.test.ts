import { describe, expect, it } from 'vitest';
import { preserveCarouselMediaUrls } from './carousel-media';

describe('preserveCarouselMediaUrls', () => {
  it('keeps local send-time URLs while accepting Meta-synced card content', () => {
    expect(
      preserveCarouselMediaUrls(
        [
          {
            header_type: 'image',
            header_handle: 'meta-review-handle',
            body_text: 'Updated by Meta',
          },
        ],
        [
          {
            header_type: 'image',
            header_media_url: 'https://cdn.example.com/card.jpg',
            body_text: 'Old local body',
          },
        ],
      ),
    ).toEqual([
      {
        header_type: 'image',
        header_handle: 'meta-review-handle',
        header_media_url: 'https://cdn.example.com/card.jpg',
        body_text: 'Updated by Meta',
      },
    ]);
  });

  it('does not copy a URL between different card positions', () => {
    const cards = preserveCarouselMediaUrls(
      [
        { header_type: 'image', body_text: 'One' },
        { header_type: 'image', body_text: 'Two' },
      ],
      [{ header_type: 'image', header_media_url: 'https://cdn.example.com/one.jpg', body_text: 'One' }],
    );

    expect(cards?.[0].header_media_url).toBe('https://cdn.example.com/one.jpg');
    expect(cards?.[1].header_media_url).toBeUndefined();
  });

  it('keeps a URL supplied by Meta instead of replacing it', () => {
    const cards = preserveCarouselMediaUrls(
      [{ header_type: 'image', header_media_url: 'https://meta.example.com/card.jpg', body_text: 'One' }],
      [{ header_type: 'image', header_media_url: 'https://local.example.com/card.jpg', body_text: 'One' }],
    );

    expect(cards?.[0].header_media_url).toBe('https://meta.example.com/card.jpg');
  });
});
