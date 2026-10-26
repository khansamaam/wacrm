import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkGrantCeiling,
  isMissingAccessLevelSupport,
  loadMyGrantCeiling,
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
    const { supabase, userId: callerId, accountId, role } = await requireRole('admin');
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

    // An admin can't hand out more than they have, or raise their own
    // access. Migration 065 enforces the same rule in the database.
    const ceiling = await loadMyGrantCeiling({ supabase, userId: callerId, accountId, role });
    if (!ceiling.unrestricted && userId === callerId) {
      return NextResponse.json(
        { error: 'You cannot change your own WhatsApp number access' },
        { status: 403 }
      );
    }
    let existing: Parameters<typeof checkGrantCeiling>[3];
    if (!ceiling.unrestricted) {
      const [{ data: target }, { data: rows }] = await Promise.all([
        supabase
          .from('profiles')
          .select('whatsapp_number_access_mode')
          .eq('user_id', userId)
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('whatsapp_number_members')
          .select('whatsapp_number_id, access_level')
          .eq('user_id', userId),
      ]);
      existing = {
        mode: target?.whatsapp_number_access_mode === 'all' ? 'all' : 'selected',
        levels: new Map(
          ((rows ?? []) as Array<{ whatsapp_number_id: string; access_level?: string }>).map(
            (row) => [row.whatsapp_number_id, row.access_level === 'view' ? 'view' : 'full'] as const
          )
        ),
      };
    }
    const ceilingError = checkGrantCeiling(
      ceiling,
      mode,
      mode === 'selected' ? access : [],
      existing
    );
    if (ceilingError) {
      return NextResponse.json({ error: ceilingError }, { status: 403 });
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
