'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import type { WhatsAppNumber } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface RoutingRow {
  connection_source: string | null;
  webhook_override_url: string | null;
  webhook_override_set_at: string | null;
  last_webhook_received_at: string | null;
  webhook_relay_enabled: boolean;
  webhook_relay_url: string | null;
  last_webhook_relay_at: string | null;
  last_webhook_relay_status: number | null;
  last_webhook_relay_error: string | null;
}

interface WebhookStatus {
  callback_url: string | null;
  callback_error: string | null;
  meta_target: 'this_app' | 'elsewhere' | 'app_default' | null;
  meta_url: string | null;
  meta_error: string | null;
  routing: RoutingRow | null;
  migration_applied: boolean;
  migration_hint: string | null;
}

type HistorySyncResults = Record<
  'history' | 'contacts',
  { ok: boolean; request_id?: string; error?: string }
>;

const TARGET_LABEL: Record<string, string> = {
  this_app: 'Receiving in this app',
  elsewhere: 'Points to another system',
  app_default: 'Using the Meta app default',
};

/** Per-number webhook routing status, take-over, and Chatwoot relay. */
export function WhatsAppNumberWebhookDialog({
  number,
  onClose,
}: {
  number: WhatsAppNumber | null;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [relayUrl, setRelayUrl] = useState('');
  const [historyResult, setHistoryResult] = useState<HistorySyncResults | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/whatsapp/numbers/${id}/webhook`, {
        cache: 'no-store',
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to load webhook status'));
      const next = body as unknown as WebhookStatus;
      setStatus(next);
      setRelayEnabled(Boolean(next.routing?.webhook_relay_enabled));
      setRelayUrl(next.routing?.webhook_relay_url ?? '');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load webhook status'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (number) {
      setStatus(null);
      setHistoryResult(null);
      void load(number.id);
    }
  }, [number, load]);

  async function takeOver() {
    if (!number) return;
    if (
      status?.meta_target === 'elsewhere' &&
      !window.confirm(
        'Meta will stop sending this number’s webhooks to the other system and send them here instead. Enable the Chatwoot copy below if it should keep receiving them. Continue?'
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`/api/whatsapp/numbers/${number.id}/webhook`, {
        method: 'POST',
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to route webhooks'));
      toast.success('Webhooks now come directly to this app');
      await load(number.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to route webhooks'
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestHistory() {
    if (!number) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/whatsapp/numbers/${number.id}/history-sync`, {
        method: 'POST',
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to request chat history'));
      const results = body.results as unknown as HistorySyncResults;
      setHistoryResult(results);
      if (results.history.ok) {
        toast.success('Meta accepted the request — chats will appear in the inbox as they arrive');
      } else {
        toast.error('Meta did not accept the chat history request');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to request chat history'
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveRelay() {
    if (!number) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/whatsapp/numbers/${number.id}/webhook`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: relayEnabled, url: relayUrl }),
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to save relay settings'));
      toast.success(relayEnabled ? 'Chatwoot copy enabled' : 'Chatwoot copy disabled');
      await load(number.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save relay settings'
      );
    } finally {
      setBusy(false);
    }
  }

  const routing = status?.routing;

  return (
    <Dialog
      open={Boolean(number)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Webhook &amp; relay</DialogTitle>
          <DialogDescription>
            {number?.label} ·{' '}
            {number?.display_phone_number || number?.phone_number_id}
          </DialogDescription>
        </DialogHeader>

        {loading && !status ? (
          <div className="flex min-h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : status ? (
          <div className="space-y-5 py-2 text-sm">
            {status.migration_hint && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600">
                {status.migration_hint}
              </p>
            )}

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Where Meta sends this number&apos;s webhooks</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => number && void load(number.id)}
                >
                  <RefreshCw className="mr-1 size-3.5" />
                  Check
                </Button>
              </div>
              {status.meta_error ? (
                <p className="text-destructive text-xs">{status.meta_error}</p>
              ) : (
                <div className="space-y-1">
                  <Badge
                    variant={
                      status.meta_target === 'this_app' ? 'secondary' : 'outline'
                    }
                    className={
                      status.meta_target === 'this_app'
                        ? 'text-emerald-600'
                        : 'text-amber-600'
                    }
                  >
                    {TARGET_LABEL[status.meta_target ?? ''] ?? 'Unknown'}
                  </Badge>
                  {status.meta_url && (
                    <code className="text-muted-foreground block truncate text-xs">
                      {status.meta_url}
                    </code>
                  )}
                </div>
              )}
              {status.callback_error && (
                <p className="text-xs text-amber-600">{status.callback_error}</p>
              )}
              <p className="text-muted-foreground text-xs">
                Last webhook received here:{' '}
                {formatTime(routing?.last_webhook_received_at) ?? 'never'}
              </p>
              {status.meta_target !== 'this_app' && (
                <Button
                  disabled={busy || Boolean(status.callback_error)}
                  onClick={() => void takeOver()}
                >
                  {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Route webhooks to this app
                </Button>
              )}
            </section>

            {number?.connection_method === 'coexistence' && (
              <section className="space-y-3 border-t pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label>Import chat history from the phone</Label>
                    <p className="text-muted-foreground text-xs">
                      Asks Meta to send the WhatsApp Business App chats (up to
                      6 months) and contacts. Meta only allows this within 24
                      hours of connecting the number, and only if history
                      sharing was approved on the phone.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void requestHistory()}
                  >
                    Request history
                  </Button>
                </div>
                {historyResult && (
                  <ul className="space-y-1 text-xs">
                    {(['history', 'contacts'] as const).map((kind) => (
                      <li key={kind}>
                        <span className="font-medium">
                          {kind === 'history' ? 'Chats' : 'Contacts'}:
                        </span>{' '}
                        {historyResult[kind].ok ? (
                          <span className="text-emerald-600">accepted by Meta</span>
                        ) : (
                          <span className="text-destructive">
                            {historyResult[kind].error ?? 'not accepted'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Send a copy to Chatwoot</Label>
                  <p className="text-muted-foreground text-xs">
                    Forwards each webhook unchanged (same Meta signature) so
                    Chatwoot keeps receiving messages. This app is not affected
                    if Chatwoot is down.
                  </p>
                </div>
                <Switch
                  checked={relayEnabled}
                  onCheckedChange={setRelayEnabled}
                  disabled={!status.migration_applied}
                />
              </div>
              <Input
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                placeholder="http://10.0.0.111:3001"
                disabled={!status.migration_applied}
              />
              {routing?.last_webhook_relay_at && (
                <p className="text-muted-foreground text-xs">
                  Last copy {formatTime(routing.last_webhook_relay_at)}:{' '}
                  {routing.last_webhook_relay_error ? (
                    <span className="text-destructive">
                      {routing.last_webhook_relay_error}
                    </span>
                  ) : (
                    <span className="text-emerald-600">
                      delivered ({routing.last_webhook_relay_status})
                    </span>
                  )}
                </p>
              )}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  disabled={busy || !status.migration_applied}
                  onClick={() => void saveRelay()}
                >
                  Save relay
                </Button>
              </div>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatTime(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: `Unexpected server response (${response.status})` };
  }
}

function readError(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}
