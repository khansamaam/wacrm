import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  loadStepsTree: vi.fn(),
  replaceSteps: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'auth failed' },
      { status: 403 }
    ),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

vi.mock('@/lib/automations/steps-tree', () => ({
  loadStepsTree: mocks.loadStepsTree,
  replaceSteps: mocks.replaceSteps,
}));

import { DELETE, GET, PATCH } from './route';

const accountContext = {
  accountId: 'account-1',
  userId: 'teammate-2',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
  supabase: {},
};

const params = { params: Promise.resolve({ id: 'automation-1' }) };

function createAdmin(existing: Record<string, unknown> | null) {
  const selectEq = vi.fn();
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: existing, error: null });
  const selectQuery = {
    eq: selectEq,
    maybeSingle,
  };
  selectEq.mockReturnValue(selectQuery);

  const updateEq = vi.fn();
  const updateResult = { error: null };
  const updateQuery = {
    eq: updateEq,
    then: (resolve: (value: typeof updateResult) => unknown) =>
      Promise.resolve(updateResult).then(resolve),
  };
  updateEq.mockReturnValue(updateQuery);

  const deleteEq = vi.fn();
  const deleteResult = { error: null };
  const deleteQuery = {
    eq: deleteEq,
    then: (resolve: (value: typeof deleteResult) => unknown) =>
      Promise.resolve(deleteResult).then(resolve),
  };
  deleteEq.mockReturnValue(deleteQuery);

  const select = vi.fn(() => selectQuery);
  const update = vi.fn(() => updateQuery);
  const deleteRows = vi.fn(() => deleteQuery);
  const from = vi.fn(() => ({ select, update, delete: deleteRows }));

  return {
    client: { from },
    selectEq,
    update,
    updateEq,
    deleteRows,
    deleteEq,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue(accountContext);
  mocks.loadStepsTree.mockResolvedValue([]);
  mocks.replaceSteps.mockResolvedValue(null);
});

describe('/api/automations/[id]', () => {
  it('loads an automation belonging to the caller workspace', async () => {
    const admin = createAdmin({
      id: 'automation-1',
      account_id: 'account-1',
      user_id: 'original-creator',
    });
    mocks.supabaseAdmin.mockReturnValue(admin.client);

    const response = await GET(new Request('http://localhost'), params);

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    expect(admin.selectEq).toHaveBeenCalledWith('account_id', 'account-1');
  });

  it('lets a permitted teammate disable a workspace automation', async () => {
    const admin = createAdmin({
      id: 'automation-1',
      account_id: 'account-1',
      user_id: 'original-creator',
      is_active: true,
      trigger_type: 'conversation_assigned',
      trigger_config: {},
    });
    mocks.supabaseAdmin.mockReturnValue(admin.client);

    const response = await PATCH(
      new Request('http://localhost/api/automations/automation-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      }),
      params
    );

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    expect(admin.selectEq).toHaveBeenCalledWith('account_id', 'account-1');
    expect(admin.update).toHaveBeenCalledWith({ is_active: false });
    expect(admin.updateEq).toHaveBeenCalledWith('account_id', 'account-1');
  });

  it('does not expose an automation from another workspace', async () => {
    const admin = createAdmin(null);
    mocks.supabaseAdmin.mockReturnValue(admin.client);

    const response = await PATCH(
      new Request('http://localhost/api/automations/automation-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      }),
      params
    );

    expect(response.status).toBe(404);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('deletes only within the caller workspace', async () => {
    const admin = createAdmin({ id: 'automation-1' });
    mocks.supabaseAdmin.mockReturnValue(admin.client);

    const response = await DELETE(new Request('http://localhost'), params);

    expect(response.status).toBe(200);
    expect(admin.deleteRows).toHaveBeenCalledOnce();
    expect(admin.deleteEq).toHaveBeenCalledWith('account_id', 'account-1');
  });
});
