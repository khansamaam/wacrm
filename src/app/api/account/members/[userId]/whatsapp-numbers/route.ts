import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;
    const { supabase } = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as {
      access_mode?: unknown;
      whatsapp_number_ids?: unknown;
    } | null;
    const mode = body?.access_mode;
    const ids = body?.whatsapp_number_ids;
    if (
      (mode !== 'all' && mode !== 'selected') ||
      !Array.isArray(ids) ||
      !ids.every((value) => typeof value === 'string')
    ) {
      return NextResponse.json(
        {
          error:
            'access_mode must be all or selected and whatsapp_number_ids must be an array',
        },
        { status: 400 }
      );
    }
    if (mode === 'selected' && ids.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one WhatsApp number' },
        { status: 400 }
      );
    }

    const { error } = await supabase.rpc('set_member_whatsapp_number_access', {
      p_user_id: userId,
      p_access_mode: mode,
      p_whatsapp_number_ids: ids,
    });
    if (error) {
      console.error('[member number access] update failed:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
