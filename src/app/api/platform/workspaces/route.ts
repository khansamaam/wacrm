import { NextResponse } from 'next/server';

import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account';
import {
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from '@/lib/auth/invitations';
import {
  ActiveWorkspaceError,
  provisionInvitedUser,
} from '@/lib/auth/provision-invited-user';
import { getPublicAppUrl } from '@/lib/auth/public-url';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  isUpcomingRenewal,
  subscriptionIsExpired,
  type WorkspaceSubscription,
} from '@/lib/platform/subscriptions';

const MAX_NAME_LENGTH = 80;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();
    const { data: accounts, error } = await admin
      .from('accounts')
      .select('id, name, owner_user_id, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const accountIds = (accounts ?? []).map((account) => account.id);
    const [{ data: profiles }, { data: connections }, { data: subscriptions }] =
      await Promise.all([
        accountIds.length
          ? admin
              .from('profiles')
              .select('account_id, access_status')
              .in('account_id', accountIds)
          : Promise.resolve({ data: [], error: null }),
        accountIds.length
          ? admin
              .from('whatsapp_config')
              .select('account_id, status, phone_number_id')
              .in('account_id', accountIds)
          : Promise.resolve({ data: [], error: null }),
        accountIds.length
          ? admin
              .from('account_subscriptions')
              .select(
                'account_id, plan_code, status, billing_cycle, amount_minor, currency, starts_at, renews_at, expires_at, grace_ends_at, notes'
              )
              .in('account_id', accountIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    const memberCounts = new Map<string, number>();
    for (const profile of profiles ?? []) {
      if (profile.access_status !== 'active') continue;
      memberCounts.set(
        profile.account_id,
        (memberCounts.get(profile.account_id) ?? 0) + 1
      );
    }
    const connectionByAccount = new Map(
      (connections ?? []).map((connection) => [
        connection.account_id,
        {
          status: connection.status,
          phoneNumberId: connection.phone_number_id,
        },
      ])
    );
    const subscriptionByAccount = new Map(
      (subscriptions ?? []).map((subscription) => {
        const shaped: WorkspaceSubscription = {
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
        };
        return [subscription.account_id, shaped];
      })
    );

    const workspaceRows = (accounts ?? []).map((account) => ({
      id: account.id,
      name: account.name,
      clientAdminAssigned: Boolean(account.owner_user_id),
      memberCount: memberCounts.get(account.id) ?? 0,
      whatsapp: connectionByAccount.get(account.id) ?? null,
      subscription: subscriptionByAccount.get(account.id) ?? null,
      createdAt: account.created_at,
    }));
    const subscriptionRows = workspaceRows.flatMap((workspace) =>
      workspace.subscription ? [workspace.subscription] : []
    );

    return NextResponse.json({
      metrics: {
        workspaces: workspaceRows.length,
        activeSubscriptions: subscriptionRows.filter(
          (subscription) =>
            ['active', 'trialing'].includes(subscription.status) &&
            !subscriptionIsExpired(subscription)
        ).length,
        trials: subscriptionRows.filter(
          (subscription) => subscription.status === 'trialing'
        ).length,
        upcomingRenewals: subscriptionRows.filter((subscription) =>
          isUpcomingRenewal(subscription)
        ).length,
        expiredOrSuspended: subscriptionRows.filter(
          (subscription) =>
            subscriptionIsExpired(subscription) ||
            subscription.status === 'suspended'
        ).length,
        members: [...memberCounts.values()].reduce(
          (total, count) => total + count,
          0
        ),
        connectedWhatsApp: [...connectionByAccount.values()].filter(
          (connection) => connection.status === 'connected'
        ).length,
      },
      workspaces: workspaceRows,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePlatformAdmin();
    const limit = checkRateLimit(
      `platform:workspaceCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      clientAdminEmail?: unknown;
      planCode?: unknown;
      expiresAt?: unknown;
    } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email =
      typeof body?.clientAdminEmail === 'string'
        ? body.clientAdminEmail.trim().toLowerCase()
        : '';
    const planCode =
      typeof body?.planCode === 'string' &&
      /^[a-z0-9][a-z0-9_-]{0,39}$/.test(body.planCode.trim().toLowerCase())
        ? body.planCode.trim().toLowerCase()
        : 'standard';
    const requestedExpiry =
      typeof body?.expiresAt === 'string' ? new Date(body.expiresAt) : null;
    const subscriptionExpiresAt =
      requestedExpiry && !Number.isNaN(requestedExpiry.getTime())
        ? requestedExpiry
        : new Date(Date.now() + 14 * 86_400_000);

    if (!name || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Workspace name must be 1–${MAX_NAME_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: 'A valid Client Admin email address is required' },
        { status: 400 }
      );
    }
    if (subscriptionExpiresAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'Subscription expiry must be in the future' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const { data: account, error: accountError } = await admin
      .from('accounts')
      .insert({
        name,
        owner_user_id: null,
      })
      .select('id, name, created_at')
      .single();
    if (accountError || !account) {
      console.error(
        '[platform/workspaces] account insert error:',
        accountError
      );
      return NextResponse.json(
        { error: 'Failed to create workspace' },
        { status: 500 }
      );
    }

    const { error: subscriptionError } = await admin
      .from('account_subscriptions')
      .insert({
        account_id: account.id,
        plan_code: planCode,
        status: 'trialing',
        billing_cycle: 'custom',
        amount_minor: 0,
        currency: 'USD',
        starts_at: new Date().toISOString(),
        renews_at: subscriptionExpiresAt.toISOString(),
        expires_at: subscriptionExpiresAt.toISOString(),
        updated_by: ctx.userId,
      });
    if (subscriptionError) {
      await admin.from('accounts').delete().eq('id', account.id);
      console.error(
        '[platform/workspaces] subscription insert error:',
        subscriptionError
      );
      return NextResponse.json(
        { error: 'Failed to initialize workspace subscription' },
        { status: 500 }
      );
    }

    const { token, hash } = generateInviteToken();
    const expiresAt = inviteExpiresAt(7);
    const url = inviteUrl(token, getPublicAppUrl(request));
    const { data: invitation, error: invitationError } = await admin
      .from('account_invitations')
      .insert({
        account_id: account.id,
        token_hash: hash,
        invitee_email: email,
        role: 'owner',
        created_by_user_id: ctx.userId,
        label: 'Initial Client Admin',
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single();

    if (invitationError || !invitation) {
      await admin.from('accounts').delete().eq('id', account.id);
      console.error(
        '[platform/workspaces] owner invitation insert error:',
        invitationError
      );
      return NextResponse.json(
        { error: 'Failed to create Client Admin invitation' },
        { status: 500 }
      );
    }

    try {
      const { emailSent } = await provisionInvitedUser({
        admin,
        email,
        invitationHash: hash,
        redirectTo: url,
        accountId: account.id,
        role: 'owner',
      });

      return NextResponse.json(
        {
          workspace: account,
          invitation: {
            email,
            emailSent,
            url,
            expiresAt: expiresAt.toISOString(),
          },
        },
        { status: 201 }
      );
    } catch (error) {
      await admin.from('accounts').delete().eq('id', account.id);
      if (error instanceof ActiveWorkspaceError) {
        return NextResponse.json(
          { error: 'This Client Admin already belongs to an active workspace' },
          { status: 409 }
        );
      }
      console.error('[platform/workspaces] user provisioning error:', error);
      return NextResponse.json(
        { error: 'Failed to provision the Client Admin login' },
        { status: 502 }
      );
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
