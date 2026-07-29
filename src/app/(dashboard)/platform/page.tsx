'use client';

import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquareMore,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import {
  daysUntil,
  isUpcomingRenewal,
  type WorkspaceSubscription,
} from '@/lib/platform/subscriptions';
import { cn } from '@/lib/utils';

interface PlatformMetrics {
  workspaces: number;
  activeSubscriptions: number;
  trials: number;
  upcomingRenewals: number;
  expiredOrSuspended: number;
  members: number;
  connectedWhatsApp: number;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  clientAdminAssigned: boolean;
  memberCount: number;
  whatsapp: {
    status: string;
    phoneNumberId: string;
  } | null;
  subscription: WorkspaceSubscription | null;
  createdAt: string;
}

interface CreatedInvitation {
  email: string;
  emailSent: boolean;
  url: string;
  expiresAt: string;
}

const EMPTY_METRICS: PlatformMetrics = {
  workspaces: 0,
  activeSubscriptions: 0,
  trials: 0,
  upcomingRenewals: 0,
  expiredOrSuspended: 0,
  members: 0,
  connectedWhatsApp: 0,
};

function defaultTrialExpiry(): string {
  const date = new Date(Date.now() + 14 * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function subscriptionTone(status: WorkspaceSubscription['status']) {
  if (status === 'active') return 'text-emerald-300 bg-emerald-500/10';
  if (status === 'trialing') return 'text-sky-300 bg-sky-500/10';
  if (status === 'past_due') return 'text-amber-300 bg-amber-500/10';
  return 'text-red-300 bg-red-500/10';
}

function Metric({
  label,
  value,
  icon: Icon,
  attention = false,
}: {
  label: string;
  value: number;
  icon: typeof Building2;
  attention?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-5">
        <div>
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="text-foreground mt-1 text-3xl font-semibold">
            {value.toLocaleString()}
          </p>
        </div>
        <div
          className={cn(
            'flex size-11 items-center justify-center rounded-xl',
            attention
              ? 'bg-amber-500/10 text-amber-300'
              : 'bg-primary/10 text-primary'
          )}
        >
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlatformDashboardPage() {
  const { isSuperAdmin, profileLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [clientAdminEmail, setClientAdminEmail] = useState('');
  const [planCode, setPlanCode] = useState('standard');
  const [expiresAt, setExpiresAt] = useState(defaultTrialExpiry);
  const [createdInvitation, setCreatedInvitation] =
    useState<CreatedInvitation | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/platform/workspaces', {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to load the platform dashboard');
        return;
      }
      setWorkspaces(payload.workspaces ?? []);
      setMetrics(payload.metrics ?? EMPTY_METRICS);
    } catch (error) {
      console.error('[PlatformDashboard] load error:', error);
      toast.error('Could not reach the platform service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profileLoading || !isSuperAdmin) {
      if (!profileLoading) setLoading(false);
      return;
    }
    void loadDashboard();
  }, [isSuperAdmin, loadDashboard, profileLoading]);

  const upcomingRenewals = useMemo(
    () =>
      workspaces
        .filter(
          (workspace) =>
            workspace.subscription &&
            isUpcomingRenewal(workspace.subscription, 30)
        )
        .sort(
          (a, b) =>
            new Date(a.subscription!.renewsAt!).getTime() -
            new Date(b.subscription!.renewsAt!).getTime()
        ),
    [workspaces]
  );

  async function createWorkspace() {
    setCreating(true);
    setCreatedInvitation(null);
    try {
      const response = await fetch('/api/platform/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          clientAdminEmail,
          planCode,
          expiresAt,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to create workspace');
        return;
      }

      setCreatedInvitation(payload.invitation);
      setName('');
      setClientAdminEmail('');
      setPlanCode('standard');
      setExpiresAt(defaultTrialExpiry());
      toast.success('Client workspace created');
      await loadDashboard();
    } catch (error) {
      console.error('[PlatformDashboard] create error:', error);
      toast.error('Could not reach the workspace service');
    } finally {
      setCreating(false);
    }
  }

  async function enterWorkspace(workspace: WorkspaceSummary) {
    setEnteringId(workspace.id);
    try {
      const response = await fetch('/api/platform/workspace-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: workspace.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to enter client workspace');
        return;
      }
      // A full navigation rebuilds AuthProvider and every RLS-backed query
      // against the newly selected workspace context.
      window.location.assign('/dashboard');
    } finally {
      setEnteringId(null);
    }
  }

  async function copyInvitation() {
    if (!createdInvitation) return;
    await navigator.clipboard.writeText(createdInvitation.url);
    toast.success('Client Admin invitation copied');
  }

  if (profileLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="py-10 text-center">
          <ShieldCheck className="text-muted-foreground mx-auto size-8" />
          <h1 className="text-foreground mt-3 text-lg font-semibold">
            Platform access required
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            This dashboard is available only to the Platform Super Admin.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">
          Platform dashboard
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Monitor client workspaces, subscriptions, renewals, and connection
          health from one control plane.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Client workspaces"
          value={metrics.workspaces}
          icon={Building2}
        />
        <Metric
          label="Active subscriptions"
          value={metrics.activeSubscriptions}
          icon={CheckCircle2}
        />
        <Metric
          label="Upcoming renewals"
          value={metrics.upcomingRenewals}
          icon={CalendarClock}
          attention={metrics.upcomingRenewals > 0}
        />
        <Metric
          label="Expired or suspended"
          value={metrics.expiredOrSuspended}
          icon={AlertTriangle}
          attention={metrics.expiredOrSuspended > 0}
        />
        <Metric
          label="Active trials"
          value={metrics.trials}
          icon={CalendarClock}
        />
        <Metric label="Total members" value={metrics.members} icon={Users} />
        <Metric
          label="WhatsApp connected"
          value={metrics.connectedWhatsApp}
          icon={MessageSquareMore}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="text-primary size-5" />
              New client workspace
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme Clinic"
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-admin-email">Client Admin email</Label>
              <Input
                id="client-admin-email"
                type="email"
                value={clientAdminEmail}
                onChange={(event) => setClientAdminEmail(event.target.value)}
                placeholder="admin@client.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-code">Plan</Label>
              <Input
                id="plan-code"
                value={planCode}
                onChange={(event) => setPlanCode(event.target.value)}
                placeholder="standard"
                maxLength={40}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscription-expiry">Trial/access expiry</Label>
              <Input
                id="subscription-expiry"
                type="date"
                value={expiresAt}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Button
                onClick={createWorkspace}
                disabled={
                  creating ||
                  !name.trim() ||
                  !clientAdminEmail.trim() ||
                  !expiresAt
                }
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Building2 className="size-4" />
                )}
                Create workspace
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming renewals</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingRenewals.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                No renewals due in the next 30 days.
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {upcomingRenewals.slice(0, 6).map((workspace) => (
                  <li
                    key={workspace.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-medium">
                        {workspace.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {workspace.subscription!.planCode} ·{' '}
                        {new Date(
                          workspace.subscription!.renewsAt!
                        ).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-amber-300">
                      {daysUntil(workspace.subscription!.renewsAt)} days
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {createdInvitation ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-3 py-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" />
              <div>
                <p className="text-foreground font-medium">
                  Client Admin invitation created
                </p>
                <p className="text-muted-foreground text-sm">
                  {createdInvitation.emailSent
                    ? `Supabase emailed ${createdInvitation.email}.`
                    : `${createdInvitation.email} already has a login; share this link manually.`}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                readOnly
                value={createdInvitation.url}
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={copyInvitation}>
                <Copy className="size-4" />
                Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Client workspaces</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : workspaces.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No client workspaces yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-border text-muted-foreground border-b text-xs">
                  <tr>
                    <th className="px-3 py-2 font-medium">Workspace</th>
                    <th className="px-3 py-2 font-medium">Subscription</th>
                    <th className="px-3 py-2 font-medium">Renewal/expiry</th>
                    <th className="px-3 py-2 font-medium">Members</th>
                    <th className="px-3 py-2 font-medium">WhatsApp</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {workspaces.map((workspace) => (
                    <tr key={workspace.id}>
                      <td className="px-3 py-3">
                        <p className="text-foreground font-medium">
                          {workspace.name}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          Client Admin:{' '}
                          {workspace.clientAdminAssigned ? 'active' : 'pending'}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {workspace.subscription ? (
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize',
                              subscriptionTone(workspace.subscription.status)
                            )}
                          >
                            {workspace.subscription.planCode} ·{' '}
                            {workspace.subscription.status.replace('_', ' ')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            Not configured
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-3">
                        {workspace.subscription?.renewsAt ||
                        workspace.subscription?.expiresAt
                          ? new Date(
                              workspace.subscription.renewsAt ??
                                workspace.subscription.expiresAt!
                            ).toLocaleDateString()
                          : 'No fixed date'}
                      </td>
                      <td className="text-muted-foreground px-3 py-3">
                        {workspace.memberCount}
                      </td>
                      <td className="text-muted-foreground px-3 py-3">
                        {workspace.whatsapp?.status ?? 'Not configured'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            render={
                              <Link
                                href={`/platform/workspaces/${workspace.id}`}
                              />
                            }
                          >
                            Manage
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => enterWorkspace(workspace)}
                            disabled={enteringId === workspace.id}
                          >
                            {enteringId === workspace.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ExternalLink className="size-4" />
                            )}
                            Open workspace
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
