import { NextResponse } from 'next/server';

import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requirePlatformAdmin();
    const limit = checkRateLimit(
      `platform:workspaceContext:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      accountId?: unknown;
    } | null;
    const accountId =
      typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) {
      return NextResponse.json(
        { error: 'A workspace ID is required' },
        { status: 400 }
      );
    }

    const { data: account, error: accountError } = await ctx.supabase
      .from('accounts')
      .select('id, name')
      .eq('id', accountId)
      .maybeSingle();
    if (accountError || !account) {
      return NextResponse.json(
        { error: 'Client workspace was not found' },
        { status: 404 }
      );
    }

    const { error: contextError } = await ctx.supabase.rpc(
      'enter_platform_workspace',
      { target_account_id: account.id }
    );
    if (contextError) {
      console.error('[platform/context] enter error:', contextError);
      return NextResponse.json(
        { error: 'Failed to enter client workspace' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      workspace: { id: account.id, name: account.name },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const ctx = await requirePlatformAdmin();
    const { error } = await ctx.supabase.rpc('exit_platform_workspace');
    if (error) {
      console.error('[platform/context] exit error:', error);
      return NextResponse.json(
        { error: 'Failed to exit client workspace' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
