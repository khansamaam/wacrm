import { describe, expect, it } from 'vitest';
import {
  deliveryErrorLabel,
  parseMetaDeliveryError,
} from './delivery-error';

describe('parseMetaDeliveryError', () => {
  it('preserves the Meta code and unique human-readable details', () => {
    const error = parseMetaDeliveryError([
      {
        code: 131026,
        title: 'Message undeliverable',
        message: 'Message undeliverable',
        error_data: {
          details: 'The recipient phone number is not on WhatsApp.',
        },
      },
    ]);

    expect(error).toEqual({
      code: '131026',
      message:
        'Message undeliverable — The recipient phone number is not on WhatsApp.',
    });
    expect(deliveryErrorLabel(error)).toBe(
      '[131026] Message undeliverable — The recipient phone number is not on WhatsApp.',
    );
  });

  it('returns null when Meta supplies no error array', () => {
    expect(parseMetaDeliveryError(undefined)).toBeNull();
    expect(deliveryErrorLabel(null)).toBe(
      'Meta reported a delivery failure.',
    );
  });
});
