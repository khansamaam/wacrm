import { NextResponse } from 'next/server';

import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { parseSubscriptionInput } from '@/lib/platform/subscriptions';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const adminContext = await requirePlatformAdmin();
    const limit = checkRateLimit(
      `platform:subscription:${adminContext.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { workspaceId } = await context.params;
    let input;
    try {
      input = parseSubscriptionInput(await request.json());
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid subscription details',
        },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();
    const { data: account, error: accountError } = await db
      .from('accounts')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle();
    if (accountError || !account) {
      return NextResponse.json(
        { error: 'Client workspace was not found' },
        { status: 404 }
      );
    }

    const { data, error } = await db
      .from('account_subscriptions')
      .upsert(
        {
          account_id: workspaceId,
          plan_code: input.planCode,
          status: input.status,
          billing_cycle: input.billingCycle,
          amount_minor: input.amountMinor,
          currency: input.currency,
          starts_at: input.startsAt,
          renews_at: input.renewsAt,
          expires_at: input.expiresAt,
          grace_ends_at: input.graceEndsAt,
          notes: input.notes,
          updated_at: new Date().toISOString(),
          updated_by: adminContext.userId,
        },
        { onConflict: 'account_id' }
      )
      .select(
        'plan_code, status, billing_cycle, amount_minor, currency, starts_at, renews_at, expires_at, grace_ends_at, notes'
      )
      .single();

    if (error || !data) {
      console.error('[platform/subscription] upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to update subscription' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      subscription: {
        planCode: data.plan_code,
        status: data.status,
        billingCycle: data.billing_cycle,
        amountMinor: data.amount_minor,
        currency: data.currency,
        startsAt: data.starts_at,
        renewsAt: data.renews_at,
        expiresAt: data.expires_at,
        graceEndsAt: data.grace_ends_at,
        notes: data.notes,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
