import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveConversationByPhone: vi.fn() }));
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: mocks.resolveConversationByPhone,
}));

import { relocateSyncedMessage } from './synced-message-relocation';

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

/**
 * Fake client. `select` results come from `reads` in call order per table;
 * updates and deletes are recorded in `calls`.
 */
function fakeDb(reads: Record<string, Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      let op = 'select';
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'order', 'limit', 'maybeSingle']) {
        chain[method] = vi.fn(() => chain);
      }
      chain.update = vi.fn((values: unknown) => {
        op = 'update';
        calls.push({ table, op, args: [values] });
        return chain;
      });
      chain.delete = vi.fn(() => {
        op = 'delete';
        calls.push({ table, op, args: [] });
        return chain;
      });
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve(op === 'select' ? reads[table]?.shift() ?? { data: [], error: null } : { error: null });
      return chain;
    },
  };
  return { client: client as never, calls };
}

const sender = { id: 'tgt', account_id: 'acct' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConversationByPhone.mockResolvedValue({
    conversationId: 'tgt-conv',
    contactId: 'tgt-contact',
    contactCreated: false,
  });
});

describe('relocateSyncedMessage', () => {
  it('does nothing when no synced message sits under another number', async () => {
    const { client, calls } = fakeDb({ messages: [{ data: [], error: null }] });
    await expect(relocateSyncedMessage(client, 'wamid.1', sender)).resolves.toBe(0);
    expect(calls).toEqual([]);
    expect(mocks.resolveConversationByPhone).not.toHaveBeenCalled();
  });

  it('leaves it alone when the right number already has the message', async () => {
    const { client, calls } = fakeDb({
      messages: [
        {
          data: [{ id: 'm1', conversation_id: 'bfl-conv', created_at: '2026-11-08T10:00:00Z',
            conversations: { account_id: 'acct', contact_id: 'c1', created_at: '2026-11-08T10:00:05Z', contacts: { phone: '971556636519' } } }],
          error: null,
        },
        { count: 1, error: null },
      ],
    });
    await expect(relocateSyncedMessage(client, 'wamid.1', sender)).resolves.toBe(0);
    expect(calls).toEqual([]);
  });

  it('moves the message to the sender chat and removes the empty misfiled thread', async () => {
    const { client, calls } = fakeDb({
      messages: [
        {
          data: [{ id: 'm1', conversation_id: 'bfl-conv', created_at: '2026-11-08T10:00:00Z',
            conversations: { account_id: 'acct', contact_id: 'c1', created_at: '2026-11-08T10:00:05Z', contacts: { phone: '971556636519' } } }],
          error: null,
        },
        { count: 0, error: null },
        { data: [{ content_text: 'Dear Samaam', content_type: 'template', template_name: 'pay', created_at: '2026-11-08T10:00:00Z' }], count: 1, error: null },
        { data: [], count: 0, error: null },
      ],
      contacts: [{ data: { created_at: '2026-11-08T10:00:05Z' }, error: null }],
      conversations: [{ count: 0, error: null }],
      deals: [{ count: 0, error: null }],
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(relocateSyncedMessage(client, 'wamid.1', sender)).resolves.toBe(1);

    expect(mocks.resolveConversationByPhone).toHaveBeenCalledWith(
      client, 'acct', '971556636519', null,
      { requireWhatsAppConfig: false, whatsappNumberId: 'tgt' }
    );
    expect(calls).toContainEqual({
      table: 'messages',
      op: 'update',
      args: [{ conversation_id: 'tgt-conv', whatsapp_number_id: 'tgt' }],
    });
    expect(calls).toContainEqual({ table: 'conversations', op: 'delete', args: [] });
    expect(calls).toContainEqual({ table: 'contacts', op: 'delete', args: [] });
  });

  it('never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fakeDb({ messages: [{ data: null, error: new Error('down') }] });
    await expect(relocateSyncedMessage(client, 'wamid.1', sender)).resolves.toBe(0);
  });
});
