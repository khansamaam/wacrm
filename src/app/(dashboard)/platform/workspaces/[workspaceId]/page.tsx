'use client';

import { ArrowLeft, ExternalLink, Loader2, Save } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import {
  BILLING_CYCLES,
  SUBSCRIPTION_STATUSES,
  type BillingCycle,
  type SubscriptionStatus,
  type WorkspaceSubscription,
} from '@/lib/platform/subscriptions';

interface WorkspaceDetails {
  id: string;
  name: string;
  clientAdminAssigned: boolean;
  memberCount: number;
  createdAt: string;
  whatsapp: {
    status: string;
    phone_number_id: string;
    connected_at: string | null;
  } | null;
  subscription: WorkspaceSubscription | null;
}

function dateInput(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

export default function PlatformWorkspacePage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const { isSuperAdmin, profileLoading } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState(false);

  const [planCode, setPlanCode] = useState('standard');
  const [status, setStatus] = useState<SubscriptionStatus>('trialing');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [amount, setAmount] = useState('0');
  const [currency, setCurrency] = useState('USD');
  const [startsAt, setStartsAt] = useState('');
  const [renewsAt, setRenewsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [graceEndsAt, setGraceEndsAt] = useState('');
  const [notes, setNotes] = useState('');

  const hydrateSubscription = useCallback(
    (subscription: WorkspaceSubscription | null) => {
      const fallbackStart = new Date().toISOString().slice(0, 10);
      setPlanCode(subscription?.planCode ?? 'standard');
      setStatus(subscription?.status ?? 'trialing');
      setBillingCycle(subscription?.billingCycle ?? 'monthly');
      setAmount(
        subscription ? (subscription.amountMinor / 100).toFixed(2) : '0.00'
      );
      setCurrency(subscription?.currency ?? 'USD');
      setStartsAt(dateInput(subscription?.startsAt ?? fallbackStart));
      setRenewsAt(dateInput(subscription?.renewsAt ?? null));
      setExpiresAt(dateInput(subscription?.expiresAt ?? null));
      setGraceEndsAt(dateInput(subscription?.graceEndsAt ?? null));
      setNotes(subscription?.notes ?? '');
    },
    []
  );

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/platform/workspaces/${encodeURIComponent(workspaceId)}`,
        { cache: 'no-store' }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to load workspace');
        return;
      }
      setWorkspace(payload.workspace);
      hydrateSubscription(payload.workspace.subscription);
    } finally {
      setLoading(false);
    }
  }, [hydrateSubscription, workspaceId]);

  useEffect(() => {
    if (!profileLoading && isSuperAdmin) void loadWorkspace();
  }, [isSuperAdmin, loadWorkspace, profileLoading]);

  async function saveSubscription() {
    const majorAmount = Number(amount);
    if (!Number.isFinite(majorAmount) || majorAmount < 0) {
      toast.error('Enter a valid non-negative subscription amount');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/platform/workspaces/${encodeURIComponent(workspaceId)}/subscription`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planCode,
            status,
            billingCycle,
            amountMinor: Math.round(majorAmount * 100),
            currency,
            startsAt,
            renewsAt: renewsAt || null,
            expiresAt: expiresAt || null,
            graceEndsAt: graceEndsAt || null,
            notes: notes || null,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to update subscription');
        return;
      }
      setWorkspace((current) =>
        current ? { ...current, subscription: payload.subscription } : current
      );
      hydrateSubscription(payload.subscription);
      toast.success('Subscription updated');
    } finally {
      setSaving(false);
    }
  }

  async function enterWorkspace() {
    setEntering(true);
    try {
      const response = await fetch('/api/platform/workspace-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: workspaceId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to enter client workspace');
        return;
      }
      window.location.assign('/dashboard');
    } finally {
      setEntering(false);
    }
  }

  if (profileLoading || loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }
  if (!isSuperAdmin) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="text-muted-foreground py-10 text-center text-sm">
          Platform Super Admin access is required.
        </CardContent>
      </Card>
    );
  }
  if (!workspace) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/platform"
            className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" />
            Platform dashboard
          </Link>
          <h1 className="text-foreground mt-3 text-2xl font-bold">
            {workspace.name}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {workspace.memberCount} members · Client Admin{' '}
            {workspace.clientAdminAssigned ? 'active' : 'pending'} · WhatsApp{' '}
            {workspace.whatsapp?.status ?? 'not configured'}
          </p>
        </div>
        <Button onClick={enterWorkspace} disabled={entering}>
          {entering ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ExternalLink className="size-4" />
          )}
          Open workspace
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscription and access period</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="plan-code">Plan code</Label>
            <Input
              id="plan-code"
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value)}
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                value && setStatus(value as SubscriptionStatus)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Billing cycle</Label>
            <Select
              value={billingCycle}
              onValueChange={(value) =>
                value && setBillingCycle(value as BillingCycle)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_CYCLES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                value={currency}
                maxLength={3}
                onChange={(event) =>
                  setCurrency(event.target.value.toUpperCase())
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="starts-at">Starts</Label>
            <Input
              id="starts-at"
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="renews-at">Next renewal</Label>
            <Input
              id="renews-at"
              type="date"
              value={renewsAt}
              onChange={(event) => setRenewsAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expires-at">Access expires</Label>
            <Input
              id="expires-at"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="grace-ends-at">Grace period ends</Label>
            <Input
              id="grace-ends-at"
              type="date"
              value={graceEndsAt}
              onChange={(event) => setGraceEndsAt(event.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="subscription-notes">Internal notes</Label>
            <textarea
              id="subscription-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={4}
              className="border-input bg-background text-foreground focus:border-ring focus:ring-ring/30 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
          <div className="md:col-span-2">
            <Button onClick={saveSubscription} disabled={saving || !startsAt}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save subscription
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
