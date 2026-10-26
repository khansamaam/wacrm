import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  isMissingAccessLevelSupport,
  parseNumberAccessList,
} from '@/lib/whatsapp/number-access';

/**
 * Update a member's WhatsApp number access.
 *
 * Body: `{ access_mode: 'all' | 'selected', numbers?: [{ id, level }] }`
 * where level is 'view' or 'full'. The legacy `whatsapp_number_ids` array
 * (every id = full access) is still accepted.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;
    const { supabase } = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as {
      access_mode?: unknown;
      numbers?: unknown;
      whatsapp_number_ids?: unknown;
    } | null;
    const mode = body?.access_mode;
    const access = parseNumberAccessList(body?.numbers, body?.whatsapp_number_ids ?? []);
    if ((mode !== 'all' && mode !== 'selected') || !access) {
      return NextResponse.json(
        {
          error:
            'access_mode must be all or selected, and numbers must be a list of { id, level } with level view or full',
        },
        { status: 400 }
      );
    }
    if (mode === 'selected' && access.length === 0) {
      return NextResponse.json(
        { error: 'Give access to at least one WhatsApp number' },
        { status: 400 }
      );
    }

    let { error } = await supabase.rpc('set_member_whatsapp_number_access_levels', {
      p_user_id: userId,
      p_access_mode: mode,
      p_numbers: access,
    });
    if (error && isMissingAccessLevelSupport(error)) {
      // Migration 059 not applied yet: levels cannot be stored, so only
      // full access is possible. Refuse rather than silently upgrade a
      // requested view-only assignment to full access.
      if (access.some((entry) => entry.level === 'view')) {
        return NextResponse.json(
          { error: 'View-only access needs database migration 059 to be applied' },
          { status: 409 }
        );
      }
      ({ error } = await supabase.rpc('set_member_whatsapp_number_access', {
        p_user_id: userId,
        p_access_mode: mode,
        p_whatsapp_number_ids: access.map((entry) => entry.id),
      }));
    }
    if (error) {
      console.error('[member number access] update failed:', error);
      const status = error.code === '42501' ? 403 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
