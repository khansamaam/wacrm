import { describe, expect, it, vi } from 'vitest';

import { nextExternalMessageStatus, resolveSyncSender } from './external-message-sync';

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

describe('resolveSyncSender', () => {
  const numbers = [
    { id: 'bfl', phone_number_id: '111', display_phone_number: '+971 50 247 4568', waba_id: 'w-bfl' },
    { id: 'tgt', phone_number_id: '206353349218600', display_phone_number: '+971 800 4526687', waba_id: 'w-tgt' },
  ];

  /** Fake client: each table returns its canned rows from any query chain. */
  function db(tables: Record<string, unknown>) {
    return {
      from: vi.fn((table: string) => {
        const result = { data: tables[table] ?? [], error: null };
        const chain: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'not', 'like', 'order', 'limit']) {
          chain[method] = vi.fn(() => chain);
        }
        chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
        return chain;
      }),
    } as never;
  }
  const noHint = { whatsappNumberId: null, phoneNumberId: null, phone: null };
  const input = (over: Record<string, unknown> = {}) => ({
    sender: noHint,
    templateName: null,
    phone: '971556636519',
    ...over,
  });

  it('uses the sender hint when it matches a number', async () => {
    await expect(
      resolveSyncSender(db({ whatsapp_numbers: numbers }), 'a',
        input({ sender: { ...noHint, phoneNumberId: '206353349218600' } }))
    ).resolves.toBe('tgt');
    await expect(
      resolveSyncSender(db({ whatsapp_numbers: numbers }), 'a',
        input({ sender: { ...noHint, phone: '9718004526687' } }))
    ).resolves.toBe('tgt');
  });

  it('falls back to detection when the hint matches nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      resolveSyncSender(
        db({ whatsapp_numbers: numbers, message_templates: [{ waba_id: 'w-tgt' }] }),
        'a',
        input({ sender: { ...noHint, phoneNumberId: '999' }, templateName: 'pay' })
      )
    ).resolves.toBe('tgt');
    warn.mockRestore();
  });

  it('picks the only number whose WABA owns the template', async () => {
    await expect(
      resolveSyncSender(
        db({ whatsapp_numbers: numbers, message_templates: [{ waba_id: 'w-tgt' }] }),
        'a',
        input({ templateName: 'payment_request_general_2026' })
      )
    ).resolves.toBe('tgt');
  });

  it('uses the latest chat when the template is on both numbers', async () => {
    await expect(
      resolveSyncSender(
        db({
          whatsapp_numbers: numbers,
          message_templates: [{ waba_id: 'w-tgt' }, { waba_id: 'w-bfl' }],
          conversations: [{ whatsapp_number_id: 'bfl' }],
        }),
        'a',
        input({ templateName: 'shared_template' })
      )
    ).resolves.toBe('bfl');
  });

  it('returns null (workspace default) when nothing decides it', async () => {
    await expect(
      resolveSyncSender(db({ whatsapp_numbers: numbers }), 'a', input())
    ).resolves.toBeNull();
  });

  it('never throws when the lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = {
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('down') }) }) }),
    } as never;
    await expect(resolveSyncSender(broken, 'a', input())).resolves.toBeNull();
    error.mockRestore();
  });
});
