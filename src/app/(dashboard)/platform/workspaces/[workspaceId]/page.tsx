'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

export default function PlatformWorkspaceConnectionPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const { isSuperAdmin, profileLoading } = useAuth();
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function saveConnection() {
    setSaving(true);
    try {
      const response = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: workspaceId,
          phone_number_id: phoneNumberId.trim(),
          waba_id: wabaId.trim() || null,
          access_token: accessToken.trim(),
          verify_token: verifyToken.trim() || null,
          pin: pin.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to save WhatsApp connection');
        return;
      }
      toast.success(
        payload.registered
          ? 'WhatsApp connection saved and registered'
          : 'WhatsApp credentials saved',
      );
      setAccessToken('');
      setPin('');
    } catch (error) {
      console.error('[PlatformWorkspaceConnectionPage] save error:', error);
      toast.error('Could not reach the connection service');
    } finally {
      setSaving(false);
    }
  }

  async function resetConnection() {
    setResetting(true);
    try {
      const response = await fetch(
        `/api/whatsapp/config?accountId=${encodeURIComponent(workspaceId)}`,
        { method: 'DELETE' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || 'Failed to reset WhatsApp connection');
        return;
      }
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setVerifyToken('');
      setPin('');
      toast.success('WhatsApp connection removed');
    } finally {
      setResetting(false);
    }
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
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Platform Super Admin access is required.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/platform"
          className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
        >
          <ArrowLeft className="size-4" />
          Client workspaces
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-foreground">
          Manage WhatsApp connection
        </h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          Workspace: {workspaceId}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Meta API credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="platform-phone-id">Phone Number ID</Label>
            <Input
              id="platform-phone-id"
              value={phoneNumberId}
              onChange={(event) => setPhoneNumberId(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-waba-id">WhatsApp Business Account ID</Label>
            <Input
              id="platform-waba-id"
              value={wabaId}
              onChange={(event) => setWabaId(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-access-token">Permanent access token</Label>
            <Input
              id="platform-access-token"
              type="password"
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-verify-token">Webhook verify token</Label>
            <Input
              id="platform-verify-token"
              value={verifyToken}
              onChange={(event) => setVerifyToken(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-pin">Two-step PIN (optional)</Label>
            <Input
              id="platform-pin"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
            />
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              onClick={saveConnection}
              disabled={saving || !phoneNumberId.trim() || !accessToken.trim()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save connection
            </Button>
            <Button
              variant="outline"
              onClick={resetConnection}
              disabled={resetting}
              className="border-red-500/40 text-red-300 hover:bg-red-500/10"
            >
              {resetting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Reset connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
