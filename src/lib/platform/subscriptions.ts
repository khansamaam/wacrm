export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'expired',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = [
  'monthly',
  'quarterly',
  'yearly',
  'custom',
] as const;

export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface WorkspaceSubscription {
  planCode: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  amountMinor: number;
  currency: string;
  startsAt: string;
  renewsAt: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  notes: string | null;
}

export interface SubscriptionInput {
  planCode: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  amountMinor: number;
  currency: string;
  startsAt: string;
  renewsAt: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  notes: string | null;
}

const PLAN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function parseDate(value: unknown, field: string, nullable = false) {
  if ((value === null || value === '') && nullable) return null;
  if (typeof value !== 'string') {
    throw new Error(`${field} must be an ISO date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  return date.toISOString();
}

/**
 * Validate and normalize the platform subscription form at the API boundary.
 * Keeping this pure makes future Stripe/webhook adapters use the exact same
 * lifecycle contract as manual Super Admin updates.
 */
export function parseSubscriptionInput(value: unknown): SubscriptionInput {
  const body =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};

  const planCode =
    typeof body.planCode === 'string' ? body.planCode.trim().toLowerCase() : '';
  if (!PLAN_PATTERN.test(planCode)) {
    throw new Error(
      'Plan code must contain 1–40 lowercase letters, numbers, dashes, or underscores'
    );
  }

  if (
    typeof body.status !== 'string' ||
    !SUBSCRIPTION_STATUSES.includes(body.status as SubscriptionStatus)
  ) {
    throw new Error('Invalid subscription status');
  }
  if (
    typeof body.billingCycle !== 'string' ||
    !BILLING_CYCLES.includes(body.billingCycle as BillingCycle)
  ) {
    throw new Error('Invalid billing cycle');
  }

  const amountMinor = Number(body.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error(
      'Amount must be a non-negative whole number in minor units'
    );
  }

  const currency =
    typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new Error('Currency must be a three-letter ISO code');
  }

  const startsAt = parseDate(body.startsAt, 'Start date') as string;
  const renewsAt = parseDate(body.renewsAt, 'Renewal date', true);
  const expiresAt = parseDate(body.expiresAt, 'Expiry date', true);
  const graceEndsAt = parseDate(body.graceEndsAt, 'Grace end date', true);

  if (renewsAt && renewsAt < startsAt) {
    throw new Error('Renewal date cannot be before the start date');
  }
  if (expiresAt && expiresAt < startsAt) {
    throw new Error('Expiry date cannot be before the start date');
  }
  if (graceEndsAt && expiresAt && graceEndsAt < expiresAt) {
    throw new Error('Grace period cannot end before the expiry date');
  }

  const notes =
    typeof body.notes === 'string' && body.notes.trim()
      ? body.notes.trim().slice(0, 2000)
      : null;

  return {
    planCode,
    status: body.status as SubscriptionStatus,
    billingCycle: body.billingCycle as BillingCycle,
    amountMinor,
    currency,
    startsAt,
    renewsAt,
    expiresAt,
    graceEndsAt,
    notes,
  };
}

export function daysUntil(
  value: string | null,
  now = new Date()
): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - now.getTime()) / 86_400_000);
}

export function isUpcomingRenewal(
  subscription: Pick<WorkspaceSubscription, 'status' | 'renewsAt'>,
  withinDays = 30,
  now = new Date()
): boolean {
  if (
    !['trialing', 'active', 'past_due'].includes(subscription.status) ||
    !subscription.renewsAt
  ) {
    return false;
  }
  const days = daysUntil(subscription.renewsAt, now);
  return days !== null && days >= 0 && days <= withinDays;
}

export function subscriptionIsExpired(
  subscription: Pick<WorkspaceSubscription, 'status' | 'expiresAt'>,
  now = new Date()
): boolean {
  return (
    subscription.status === 'expired' ||
    (!!subscription.expiresAt &&
      new Date(subscription.expiresAt).getTime() < now.getTime())
  );
}
