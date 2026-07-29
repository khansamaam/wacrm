import { NextResponse } from 'next/server';

import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) {
  try {
    await requirePlatformAdmin();
    const { workspaceId } = await context.params;
    const db = supabaseAdmin();

    const [
      { data: account, error: accountError },
      { data: subscription, error: subscriptionError },
      { count: memberCount, error: memberError },
      { data: whatsapp, error: whatsappError },
    ] = await Promise.all([
      db
        .from('accounts')
        .select('id, name, owner_user_id, created_at')
        .eq('id', workspaceId)
        .maybeSingle(),
      db
        .from('account_subscriptions')
        .select(
          'plan_code, status, billing_cycle, amount_minor, currency, starts_at, renews_at, expires_at, grace_ends_at, notes'
        )
        .eq('account_id', workspaceId)
        .maybeSingle(),
      db
        .from('profiles')
        .select('user_id', { count: 'exact', head: true })
        .eq('account_id', workspaceId)
        .eq('access_status', 'active'),
      db
        .from('whatsapp_config')
        .select('status, phone_number_id, connected_at')
        .eq('account_id', workspaceId)
        .maybeSingle(),
    ]);

    if (accountError || !account) {
      return NextResponse.json(
        { error: 'Client workspace was not found' },
        { status: 404 }
      );
    }
    if (subscriptionError || memberError || whatsappError) {
      console.error('[platform/workspace] related data error:', {
        subscriptionError,
        memberError,
        whatsappError,
      });
      return NextResponse.json(
        { error: 'Failed to load workspace details' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      workspace: {
        id: account.id,
        name: account.name,
        clientAdminAssigned: Boolean(account.owner_user_id),
        memberCount: memberCount ?? 0,
        createdAt: account.created_at,
        whatsapp,
        subscription: subscription
          ? {
              planCode: subscription.plan_code,
              status: subscription.status,
              billingCycle: subscription.billing_cycle,
              amountMinor: subscription.amount_minor,
              currency: subscription.currency,
              startsAt: subscription.starts_at,
              renewsAt: subscription.renews_at,
              expiresAt: subscription.expires_at,
              graceEndsAt: subscription.grace_ends_at,
              notes: subscription.notes,
            }
          : null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
