'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, Copy, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

interface WorkspaceSummary {
  id: string;
  name: string;
  clientAdminAssigned: boolean;
  memberCount: number;
  whatsapp: {
    status: string;
    phoneNumberId: string;
  } | null;
  createdAt: string;
}

interface CreatedInvitation {
  email: string;
  emailSent: boolean;
  url: string;
  expiresAt: string;
}

export default function PlatformWorkspacesPage() {
  const { isSuperAdmin, profileLoading } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [clientAdminEmail, setClientAdminEmail] = useState('');
  const [createdInvitation, setCreatedInvitation] =
    useState<CreatedInvitation | null>(null);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/platform/workspaces', {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to load client workspaces');
        return;
      }
      setWorkspaces(payload.workspaces ?? []);
    } catch (error) {
      console.error('[PlatformWorkspacesPage] load error:', error);
      toast.error('Could not reach the workspace service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profileLoading || !isSuperAdmin) {
      if (!profileLoading) setLoading(false);
      return;
    }
    void loadWorkspaces();
  }, [isSuperAdmin, loadWorkspaces, profileLoading]);

  async function createWorkspace() {
    setCreating(true);
    setCreatedInvitation(null);
    try {
      const response = await fetch('/api/platform/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, clientAdminEmail }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to create workspace');
        return;
      }

      setCreatedInvitation(payload.invitation);
      setName('');
      setClientAdminEmail('');
      toast.success('Client workspace created');
      await loadWorkspaces();
    } catch (error) {
      console.error('[PlatformWorkspacesPage] create error:', error);
      toast.error('Could not reach the workspace service');
    } finally {
      setCreating(false);
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
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="py-10 text-center">
          <h1 className="text-lg font-semibold text-foreground">
            Platform access required
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is available only to the Platform Super Admin.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Client workspaces
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create isolated client environments and invite their initial Client
          Admin.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-5 text-primary" />
            New client workspace
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
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
          <Button
            onClick={createWorkspace}
            disabled={creating || !name.trim() || !clientAdminEmail.trim()}
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Building2 className="size-4" />
            )}
            Create
          </Button>
        </CardContent>
      </Card>

      {createdInvitation ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-3 py-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium text-foreground">
                  Client Admin invitation created
                </p>
                <p className="text-sm text-muted-foreground">
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
          <CardTitle>All workspaces</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : workspaces.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No client workspaces yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Workspace</th>
                    <th className="px-3 py-2 font-medium">Client Admin</th>
                    <th className="px-3 py-2 font-medium">Members</th>
                    <th className="px-3 py-2 font-medium">WhatsApp</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {workspaces.map((workspace) => (
                    <tr key={workspace.id}>
                      <td className="px-3 py-3 font-medium text-foreground">
                        {workspace.name}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {workspace.clientAdminAssigned ? 'Active' : 'Pending'}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {workspace.memberCount}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        <Link
                          href={`/platform/workspaces/${workspace.id}`}
                          className="text-primary hover:text-primary/80"
                        >
                          {workspace.whatsapp?.status ?? 'Configure'}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {new Date(workspace.createdAt).toLocaleDateString()}
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
