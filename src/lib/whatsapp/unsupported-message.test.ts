import { describe, expect, it } from 'vitest';

import {
  describeUnsupportedMessage,
  normalizeWebhookMessageStatus,
} from './unsupported-message';

describe('describeUnsupportedMessage', () => {
  it('explains a message WhatsApp withheld (131060)', () => {
    const text = describeUnsupportedMessage({
      type: 'unsupported',
      errors: [{ code: 131060 }],
      unsupported: { type: 'unknown' },
    });
    expect(text).toContain('Message not available');
    expect(text).toContain('phone');
  });

  it('names photo albums', () => {
    expect(
      describeUnsupportedMessage({
        type: 'unsupported',
        errors: [{ code: 131051 }],
        unsupported: { type: 'album' },
      })
    ).toContain('Album of photos');
  });

  it('keeps the raw type for anything else', () => {
    expect(describeUnsupportedMessage({ type: 'order' })).toBe(
      '[Unsupported message type: order]'
    );
  });
});

describe('normalizeWebhookMessageStatus', () => {
  it('treats a played voice note as read', () => {
    expect(normalizeWebhookMessageStatus('played')).toBe('read');
    expect(normalizeWebhookMessageStatus('delivered')).toBe('delivered');
  });
});
