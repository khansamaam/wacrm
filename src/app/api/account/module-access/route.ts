import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizeModuleAccess } from '@/lib/auth/module-access';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/** Owner-only update for the account's role-to-module matrix. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('owner');
    const limit = checkRateLimit(
      `owner:module-access:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      moduleAccess?: unknown;
    } | null;
    if (
      !body ||
      !body.moduleAccess ||
      typeof body.moduleAccess !== 'object' ||
      Array.isArray(body.moduleAccess)
    ) {
      return NextResponse.json(
        { error: "'moduleAccess' must be an object" },
        { status: 400 }
      );
    }

    const moduleAccess = normalizeModuleAccess(body.moduleAccess);
    const { data, error } = await ctx.supabase
      .from('accounts')
      .update({ module_access: moduleAccess })
      .eq('id', ctx.accountId)
      .select('module_access')
      .single();

    if (error) {
      console.error('[PATCH /api/account/module-access] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update module access' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      moduleAccess: normalizeModuleAccess(data.module_access),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
