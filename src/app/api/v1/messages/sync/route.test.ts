import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  syncExternalMessage: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));

vi.mock('@/lib/whatsapp/external-message-sync', () => ({
  syncExternalMessage: mocks.syncExternalMessage,
}));

import { POST } from './route';

const validBody = {
  to: '+14155550123',
  whatsapp_message_id: 'wamid.123',
  type: 'text',
  text: 'Hello',
  timestamp: '2026-07-29T12:30:00Z',
  status: 'sent',
};

function request(body: unknown) {
  return new Request('http://localhost/api/v1/messages/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiKey.mockResolvedValue({
    accountId: 'account-1',
    supabase: { name: 'scoped-client' },
  });
});

describe('POST /api/v1/messages/sync', () => {
  it('requires the dedicated scope and returns 201 for a new message', async () => {
    mocks.syncExternalMessage.mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      contactCreated: true,
      created: true,
      status: 'sent',
      statusChanged: false,
    });

    const response = await POST(request(validBody));
    const json = await response.json();

    expect(mocks.requireApiKey).toHaveBeenCalledWith(
      expect.any(Request),
      'messages:sync'
    );
    expect(response.status).toBe(201);
    expect(json.data).toMatchObject({
      message_id: 'message-1',
      whatsapp_message_id: 'wamid.123',
      created: true,
      status: 'sent',
    });
  });

  it('returns 200 for an idempotent update', async () => {
    mocks.syncExternalMessage.mockResolvedValue({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      contactCreated: false,
      created: false,
      status: 'delivered',
      statusChanged: true,
    });

    const response = await POST(request({ ...validBody, status: 'delivered' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        created: false,
        status: 'delivered',
        status_changed: true,
      },
    });
  });

  it('rejects malformed input before persistence', async () => {
    const response = await POST(request({ to: 'not-a-phone' }));

    expect(response.status).toBe(400);
    expect(mocks.syncExternalMessage).not.toHaveBeenCalled();
  });
});
