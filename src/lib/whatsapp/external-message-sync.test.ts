import { describe, expect, it } from 'vitest';

import { nextExternalMessageStatus } from './external-message-sync';

describe('nextExternalMessageStatus', () => {
  it('advances along the successful delivery ladder', () => {
    expect(nextExternalMessageStatus('sent', 'delivered')).toBe('delivered');
    expect(nextExternalMessageStatus('delivered', 'read')).toBe('read');
  });

  it('does not regress when reports arrive out of order', () => {
    expect(nextExternalMessageStatus('read', 'sent')).toBe('read');
    expect(nextExternalMessageStatus('delivered', 'sending')).toBe('delivered');
  });

  it('accepts failure only before delivery and keeps it terminal', () => {
    expect(nextExternalMessageStatus('sent', 'failed')).toBe('failed');
    expect(nextExternalMessageStatus('delivered', 'failed')).toBe('delivered');
    expect(nextExternalMessageStatus('failed', 'read')).toBe('failed');
  });
});
