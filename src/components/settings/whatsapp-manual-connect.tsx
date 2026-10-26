'use client';

import { useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Search, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PreviewNumber {
  phone_number_id: string;
  display_phone_number: string;
  verified_name: string | null;
  status: string | null;
  is_on_biz_app: boolean;
  ready: boolean;
  already_connected: boolean;
}

interface ConnectResult {
  phone_number_id: string;
  ok: boolean;
  error?: string;
  webhook_routed?: boolean;
  webhook_error?: string | null;
  relay_error?: string | null;
}

/**
 * Manual connection for numbers from ANY Meta Business, including WhatsApp
 * Business App (coexistence) numbers: WABA ID + System User token → pick
 * one or more numbers → each is saved separately and its webhooks are
 * routed to this app.
 */
export function WhatsAppManualConnect({
  onBack,
  onConnected,
}: {
  onBack: () => void;
  onConnected: () => Promise<void> | void;
}) {
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [metaAppId, setMetaAppId] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [numbers, setNumbers] = useState<PreviewNumber[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [requestHistorySync, setRequestHistorySync] = useState(false);
  const [relayUrl, setRelayUrl] = useState('');
  const [results, setResults] = useState<ConnectResult[] | null>(null);

  async function fetchNumbers() {
    setLoadingPreview(true);
    setNumbers(null);
    setResults(null);
    try {
      const response = await fetch('/api/whatsapp/numbers/manual/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waba_id: wabaId.trim(),
          access_token: accessToken.trim(),
        }),
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Could not load numbers from Meta'));
      const list = Array.isArray(body.numbers)
        ? (body.numbers as PreviewNumber[])
        : [];
      setNumbers(list);
      setSelected(
        list
          .filter((n) => n.ready && !n.already_connected)
          .map((n) => n.phone_number_id)
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not load numbers'
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      const response = await fetch('/api/whatsapp/numbers/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waba_id: wabaId.trim(),
          access_token: accessToken.trim(),
          phone_number_ids: selected,
          labels,
          meta_app_id: metaAppId.trim(),
          meta_app_secret: metaAppSecret.trim(),
          request_history_sync: requestHistorySync,
          relay_url: relayUrl.trim(),
        }),
      });
      const body = await readJson(response);
      const list = Array.isArray(body.results)
        ? (body.results as ConnectResult[])
        : [];
      if (!response.ok && list.length === 0)
        throw new Error(readError(body, 'Failed to connect numbers'));
      setResults(list);
      const connected = list.filter((r) => r.ok).length;
      if (connected > 0) {
        toast.success(
          `${connected} number${connected === 1 ? '' : 's'} connected`
        );
        await onConnected();
      } else {
        toast.error('No numbers were connected');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to connect numbers'
      );
    } finally {
      setConnecting(false);
    }
  }

  const displayFor = (id: string) =>
    numbers?.find((n) => n.phone_number_id === id)?.display_phone_number ||
    id;

  if (results) {
    return (
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          {results.map((result) => (
            <div
              key={result.phone_number_id}
              className="rounded-lg border p-3 text-sm"
            >
              <div className="flex items-center gap-2 font-medium">
                {result.ok ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <XCircle className="text-destructive size-4" />
                )}
                {displayFor(result.phone_number_id)}
              </div>
              {result.error && (
                <p className="text-destructive mt-1 text-xs">{result.error}</p>
              )}
              {result.ok && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {result.webhook_routed
                    ? 'Webhooks now come directly to this app.'
                    : `Saved, but webhook routing needs attention: ${result.webhook_error ?? 'unknown error'}. Use “Webhook & relay” on the number to retry.`}
                </p>
              )}
              {result.relay_error && (
                <p className="mt-1 text-xs text-amber-500">
                  Relay not enabled: {result.relay_error}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => setResults(null)}>
            Connect more
          </Button>
          <Button onClick={onBack}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <div className="bg-muted/30 text-muted-foreground space-y-1 rounded-lg border p-4 text-sm">
        <p className="text-foreground font-medium">
          Works with numbers from any Meta Business
        </p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>
            In the number owner&apos;s Business Settings → Users → System
            users, add a system user and assign the WhatsApp account (WABA)
            and this app to it.
          </li>
          <li>
            Generate a permanent token with{' '}
            <code>whatsapp_business_messaging</code> and{' '}
            <code>whatsapp_business_management</code>.
          </li>
          <li>
            Copy the WABA ID from WhatsApp Manager → Account tools, then fetch
            its numbers below.
          </li>
        </ol>
        <p className="pt-1 text-xs">
          WhatsApp Business App numbers keep working on the phone; they are
          not re-registered.
        </p>
      </div>

      <Field label="WhatsApp Business Account (WABA) ID">
        <Input
          value={wabaId}
          inputMode="numeric"
          onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <Field label="System User access token">
        <Input
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Meta App ID (optional)">
          <Input
            value={metaAppId}
            onChange={(e) => setMetaAppId(e.target.value)}
            placeholder="Server default"
          />
        </Field>
        <Field label="Meta App Secret (optional)">
          <Input
            type="password"
            value={metaAppSecret}
            onChange={(e) => setMetaAppSecret(e.target.value)}
            placeholder="Server default"
          />
        </Field>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">
        Only needed when the token belongs to a different Meta app than this
        server&apos;s. The App Secret verifies webhook signatures.
      </p>

      <Button
        variant="outline"
        className="w-full"
        disabled={loadingPreview || !wabaId || !accessToken.trim()}
        onClick={() => void fetchNumbers()}
      >
        {loadingPreview ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Search className="mr-2 size-4" />
        )}
        Fetch numbers
      </Button>

      {numbers && (
        <div className="space-y-2">
          <Label>Numbers on this account</Label>
          <div className="divide-y rounded-lg border">
            {numbers.map((n) => {
              const disabled = !n.ready || n.already_connected;
              const checked = selected.includes(n.phone_number_id);
              return (
                <div key={n.phone_number_id} className="space-y-2 p-3">
                  <label className="flex cursor-pointer items-start gap-3 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(value) =>
                        setSelected((current) =>
                          value
                            ? [...new Set([...current, n.phone_number_id])]
                            : current.filter((id) => id !== n.phone_number_id)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {n.display_phone_number || n.phone_number_id}
                        </span>
                        {n.is_on_biz_app && (
                          <Badge variant="outline">Business App</Badge>
                        )}
                        {n.already_connected && (
                          <Badge variant="secondary">Already connected</Badge>
                        )}
                        {!n.ready && (
                          <Badge variant="outline" className="text-amber-500">
                            Not verified
                          </Badge>
                        )}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {n.verified_name || '—'} · ID {n.phone_number_id}
                      </span>
                    </span>
                  </label>
                  {checked && (
                    <Input
                      className="h-8"
                      placeholder={`Label (default: ${n.verified_name || n.display_phone_number})`}
                      value={labels[n.phone_number_id] ?? ''}
                      onChange={(e) =>
                        setLabels((current) => ({
                          ...current,
                          [n.phone_number_id]: e.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>

          <label className="flex cursor-pointer items-start gap-3 pt-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={requestHistorySync}
              onCheckedChange={(value) => setRequestHistorySync(value === true)}
            />
            <span>
              Request chat history &amp; contacts sync
              <span className="text-muted-foreground block text-xs">
                Business App numbers only. Meta allows this once, within 24
                hours of onboarding the number.
              </span>
            </span>
          </label>

          <Field label="Also send a copy to Chatwoot (optional)">
            <Input
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="http://10.0.0.111:3001"
            />
            <p className="text-muted-foreground text-xs">
              Each webhook is forwarded unchanged to Chatwoot so it keeps
              receiving messages. The host must be listed in
              WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS on the server. Do not press
              “Setup webhook” in Chatwoot for these numbers afterwards — that
              takes the webhook back from this app.
            </p>
          </Field>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          disabled={connecting || !numbers || selected.length === 0}
          onClick={() => void connect()}
        >
          {connecting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Connect {selected.length > 0 ? selected.length : ''} number
          {selected.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
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
