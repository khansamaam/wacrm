'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  Check,
  Cloud,
  Copy,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  Smartphone,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

type AddStep = 'choose' | 'cloud_api' | 'coexistence';

interface EmbeddedSignupResult {
  code: string;
  phoneNumberId: string;
  wabaId: string;
  businessId?: string;
}

type PartialEmbeddedSignupResult = Partial<Omit<EmbeddedSignupResult, 'code'>>;

interface FacebookLoginResponse {
  authResponse?: { code?: string };
  status?: string;
}

declare global {
  interface Window {
    FB?: {
      init(options: Record<string, unknown>): void;
      login(
        callback: (response: FacebookLoginResponse) => void,
        options: Record<string, unknown>
      ): void;
    };
    fbAsyncInit?: () => void;
  }
}

export function WhatsAppNumbers() {
  const { isOwner } = useAuth();
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<AddStep>('choose');
  const [submitting, setSubmitting] = useState(false);
  const [label, setLabel] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [metaAppId, setMetaAppId] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');
  const [metaCoexistenceConfigId, setMetaCoexistenceConfigId] = useState('');
  const [loadingEmbeddedConfig, setLoadingEmbeddedConfig] = useState(false);
  const [editingNumber, setEditingNumber] = useState<WhatsAppNumber | null>(
    null
  );
  const [editLabel, setEditLabel] = useState('');
  const [editMetaAppId, setEditMetaAppId] = useState('');
  const [editMetaAppSecret, setEditMetaAppSecret] = useState('');
  const [editMetaCoexistenceConfigId, setEditMetaCoexistenceConfigId] =
    useState('');
  const signupResultRef = useRef<PartialEmbeddedSignupResult | null>(
    null
  );
  const appOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (typeof window === 'undefined' ? '' : window.location.origin);
  const webhookCallbackUrl = appOrigin
    ? `${appOrigin.replace(/\/$/, '')}/api/whatsapp/webhook`
    : '';

  const loadNumbers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/whatsapp/numbers', {
        cache: 'no-store',
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to load WhatsApp numbers'));
      setNumbers(Array.isArray(body.numbers) ? body.numbers : []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to load WhatsApp numbers'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNumbers();
  }, [loadNumbers]);

  const loadEmbeddedSignupConfig = useCallback(async () => {
    setLoadingEmbeddedConfig(true);
    try {
      const response = await fetch('/api/whatsapp/embedded-signup/config', {
        cache: 'no-store',
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(
          readError(body, 'Could not load Embedded Signup configuration')
        );
      const appId = readString(body.appId);
      const coexistenceConfigId = readString(body.coexistenceConfigId);
      if (appId) setMetaAppId(appId);
      if (coexistenceConfigId) setMetaCoexistenceConfigId(coexistenceConfigId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not load Embedded Signup configuration'
      );
    } finally {
      setLoadingEmbeddedConfig(false);
    }
  }, []);

  useEffect(() => {
    const receiveSignupEvent = (event: MessageEvent) => {
      if (
        !['https://www.facebook.com', 'https://web.facebook.com'].includes(
          event.origin
        )
      )
        return;
      let payload: unknown = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (
        !isRecord(payload) ||
        payload.type !== 'WA_EMBEDDED_SIGNUP' ||
        !isRecord(payload.data)
      )
        return;
      if (
        payload.event !== 'FINISH' &&
        payload.event !== 'FINISH_ONLY_WABA' &&
        payload.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
      )
        return;
      const phoneNumberId = readString(
        payload.data.phone_number_id,
        payload.data.phoneNumberId
      );
      const wabaId = readString(payload.data.waba_id, payload.data.wabaId);
      if (!phoneNumberId && !wabaId) return;
      signupResultRef.current = {
        ...(signupResultRef.current ?? {}),
        ...(phoneNumberId ? { phoneNumberId } : {}),
        ...(wabaId ? { wabaId } : {}),
        businessId:
          readString(payload.data.business_id, payload.data.businessId) ||
          signupResultRef.current?.businessId,
      };
    };
    window.addEventListener('message', receiveSignupEvent);
    return () => window.removeEventListener('message', receiveSignupEvent);
  }, []);

  useEffect(() => {
    if (
      dialogOpen &&
      step !== 'choose' &&
      !metaAppId &&
      !metaCoexistenceConfigId
    ) {
      void loadEmbeddedSignupConfig();
    }
  }, [
    dialogOpen,
    loadEmbeddedSignupConfig,
    metaAppId,
    metaCoexistenceConfigId,
    step,
  ]);

  function openAdd() {
    setStep('choose');
    setLabel('');
    setPhoneNumberId('');
    setWabaId('');
    setAccessToken('');
    setVerifyToken('');
    setPin('');
    setMetaAppId('');
    setMetaAppSecret('');
    setMetaCoexistenceConfigId('');
    setDialogOpen(true);
  }

  async function addCloudNumber() {
    setSubmitting(true);
    try {
      const response = await fetch('/api/whatsapp/numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          connection_method: 'cloud_api',
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          access_token: accessToken,
          verify_token: verifyToken,
          meta_app_id: metaAppId,
          meta_app_secret: metaAppSecret,
          meta_coexistence_config_id: metaCoexistenceConfigId,
          pin,
        }),
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to connect number'));
      toast.success(
        body.registration_error
          ? 'Saved, but Meta registration needs attention'
          : 'WhatsApp number connected'
      );
      setDialogOpen(false);
      await loadNumbers();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to connect number'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function startCoexistenceSignup() {
    const appId = metaAppId.trim();
    const appSecret = metaAppSecret.trim();
    const coexistenceConfigId = metaCoexistenceConfigId.trim();
    if (!appId || !coexistenceConfigId || !appSecret) {
      toast.error(
        'Enter the Meta App ID, App Secret, and Coexistence Configuration ID'
      );
      return;
    }
    if (!canLaunchEmbeddedSignup()) {
      toast.error(
        'Meta Embedded Signup requires HTTPS. Open the app through your HTTPS domain or Cloudflare Tunnel, then try again.'
      );
      return;
    }
    setSubmitting(true);
    signupResultRef.current = null;
    try {
      await loadFacebookSdk(appId);

      const code = await new Promise<string>((resolve, reject) => {
        try {
          window.FB!.login(
            (response) => {
              const value = response.authResponse?.code;
              if (value) resolve(value);
              else
                reject(
                  new Error(
                    'Embedded Signup was cancelled or did not return a code'
                  )
                );
            },
            {
              config_id: coexistenceConfigId,
              response_type: 'code',
              override_default_response_type: true,
              extras: {
                featureType: 'whatsapp_business_app_onboarding',
                sessionInfoVersion: '3',
              },
            }
          );
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error('Meta Embedded Signup could not be started')
          );
        }
      });

      // The FINISH window message and FB.login callback are independent. Give
      // the structured event a brief chance to arrive before rejecting.
      const signup = await waitForSignupResult(signupResultRef, 5000);
      const response = await fetch('/api/whatsapp/embedded-signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          app_id: appId,
          app_secret: appSecret,
          coexistence_config_id: coexistenceConfigId,
          label,
          ...signup,
        }),
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to complete Embedded Signup'));
      toast.success('Coexistence number connected; history sync is queued');
      setDialogOpen(false);
      await loadNumbers();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Coexistence signup failed'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function setDefault(id: string) {
    const response = await fetch(`/api/whatsapp/numbers/${id}/default`, {
      method: 'POST',
    });
    const body = await readJson(response);
    if (!response.ok)
      return toast.error(readError(body, 'Failed to change default number'));
    toast.success('Default sending number updated');
    await loadNumbers();
  }

  async function disconnect(id: string) {
    if (
      !window.confirm(
        'Disconnect this number? Existing messages will remain available.'
      )
    )
      return;
    const response = await fetch(`/api/whatsapp/numbers/${id}`, {
      method: 'DELETE',
    });
    const body = await readJson(response);
    if (!response.ok)
      return toast.error(readError(body, 'Failed to disconnect number'));
    toast.success('WhatsApp number disconnected');
    await loadNumbers();
  }

  function openEditNumber(number: WhatsAppNumber) {
    setEditingNumber(number);
    setEditLabel(number.label);
    setEditMetaAppId(number.meta_app_id ?? '');
    setEditMetaAppSecret('');
    setEditMetaCoexistenceConfigId(
      number.meta_coexistence_config_id ?? ''
    );
  }

  async function saveMetaSettings() {
    if (!editingNumber) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/whatsapp/numbers/${editingNumber.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: editLabel,
          meta_app_id: editMetaAppId,
          meta_app_secret: editMetaAppSecret,
          meta_coexistence_config_id: editMetaCoexistenceConfigId,
        }),
      });
      const body = await readJson(response);
      if (!response.ok)
        throw new Error(readError(body, 'Failed to update Meta settings'));
      toast.success('Meta settings updated');
      setEditingNumber(null);
      await loadNumbers();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update Meta settings'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copySetupValue(value: string, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  }

  return (
    <div className="space-y-5">
      <SettingsPanelHead
        title="WhatsApp numbers"
        description="Connect and manage the business numbers used by this workspace."
        action={
          isOwner ? (
            <Button onClick={openAdd}>
              <Plus className="mr-2 size-4" />
              Add number
            </Button>
          ) : null
        }
      />

      {loading ? (
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : numbers.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          No WhatsApp numbers connected yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {numbers.map((number) => (
            <div
              key={number.id}
              className="flex flex-wrap items-center gap-4 border-b p-4 last:border-b-0"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Smartphone className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{number.label}</span>
                  {number.is_default && (
                    <Badge variant="secondary">Default</Badge>
                  )}
                  <Badge variant="outline">
                    {number.connection_method === 'coexistence'
                      ? 'Coexistence'
                      : 'Cloud API'}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {number.display_phone_number || number.phone_number_id}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {number.connected_at
                    ? `Connected ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(number.connected_at))}`
                    : 'Not connected yet'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={
                    number.status === 'connected'
                      ? 'text-sm text-emerald-500'
                      : 'text-sm text-amber-500'
                  }
                >
                  {number.status}
                </span>
                {isOwner && (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-md">
                      <MoreHorizontal className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!number.is_default && number.status === 'connected' && (
                        <DropdownMenuItem
                          onClick={() => void setDefault(number.id)}
                        >
                          <Check className="mr-2 size-4" />
                          Make default
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => openEditNumber(number)}
                      >
                        <KeyRound className="mr-2 size-4" />
                        Meta settings
                      </DropdownMenuItem>
                      {number.status !== 'disconnected' && (
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => void disconnect(number.id)}
                        >
                          <Unplug className="mr-2 size-4" />
                          Disconnect
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add WhatsApp number</DialogTitle>
            <DialogDescription>
              Choose whether this number is dedicated to Cloud API or remains
              usable in WhatsApp Business App.
            </DialogDescription>
          </DialogHeader>

          {step === 'choose' && (
            <div className="grid gap-3 py-2 sm:grid-cols-2">
              <button
                className="rounded-xl border p-5 text-left hover:border-emerald-500"
                onClick={() => setStep('cloud_api')}
              >
                <Cloud className="mb-3 size-6 text-emerald-500" />
                <strong>Cloud API only</strong>
                <p className="text-muted-foreground mt-2 text-sm">
                  For a number dedicated to Meta Cloud API.
                </p>
              </button>
              <button
                className="rounded-xl border p-5 text-left hover:border-emerald-500"
                onClick={() => setStep('coexistence')}
              >
                <Smartphone className="mb-3 size-6 text-emerald-500" />
                <strong>Coexistence</strong>
                <p className="text-muted-foreground mt-2 text-sm">
                  Keep using the number in WhatsApp Business App and this
                  dashboard.
                </p>
              </button>
            </div>
          )}

          {step === 'cloud_api' && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/30 rounded-lg border p-4 text-sm">
                <div className="mb-3 font-medium">Meta webhook setup</div>
                <SetupCopyRow
                  label="Callback URL"
                  value={
                    webhookCallbackUrl ||
                    'Set NEXT_PUBLIC_SITE_URL to show the production callback URL'
                  }
                  disabled={!webhookCallbackUrl}
                  onCopy={() =>
                    void copySetupValue(webhookCallbackUrl, 'Callback URL')
                  }
                />
                <SetupCopyRow
                  label="Verify token"
                  value={
                    verifyToken ||
                    'Enter a verify token below, then copy it here'
                  }
                  disabled={!verifyToken}
                  onCopy={() =>
                    void copySetupValue(verifyToken, 'Verify token')
                  }
                />
                <p className="text-muted-foreground mt-3 text-xs">
                  Add these in Meta Developers under WhatsApp webhook
                  configuration. Subscribe to messages and status events for
                  this app.
                </p>
              </div>
              <Field label="Label">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Dubai Clinic"
                />
              </Field>
              <Field label="Phone Number ID">
                <Input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                />
              </Field>
              <Field label="WABA ID">
                <Input
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                />
              </Field>
              <Field label="Meta App ID">
                <Input
                  value={metaAppId}
                  onChange={(event) => setMetaAppId(event.target.value)}
                  placeholder="Meta app connected to this phone number"
                />
              </Field>
              <Field label="Meta App Secret">
                <Input
                  type="password"
                  value={metaAppSecret}
                  onChange={(event) => setMetaAppSecret(event.target.value)}
                  placeholder="Used to verify this number’s webhook events"
                />
              </Field>
              <Field label="Coexistence Configuration ID (optional)">
                <Input
                  value={metaCoexistenceConfigId}
                  onChange={(event) =>
                    setMetaCoexistenceConfigId(event.target.value)
                  }
                  placeholder="Only needed if this app also supports coexistence"
                />
              </Field>
              <Field label="Permanent access token">
                <Input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
              </Field>
              <Field label="Webhook verify token (optional)">
                <Input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                />
              </Field>
              <Field label="Two-step verification PIN (optional)">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep('choose')}>
                  Back
                </Button>
                <Button
                  disabled={
                    submitting ||
                    !phoneNumberId ||
                    !accessToken ||
                    !metaAppId.trim() ||
                    !metaAppSecret.trim()
                  }
                  onClick={() => void addCloudNumber()}
                >
                  {submitting && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Connect number
                </Button>
              </div>
            </div>
          )}

          {step === 'coexistence' && (
            <div className="space-y-4 py-2">
              <Field label="Label">
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Main Business App"
                />
              </Field>
              <Field label="Meta App ID">
                <Input
                  value={metaAppId}
                  onChange={(event) => setMetaAppId(event.target.value)}
                  placeholder={
                    loadingEmbeddedConfig
                      ? 'Loading from environment...'
                      : 'Paste Meta App ID'
                  }
                />
              </Field>
              <Field label="Meta App Secret">
                <Input
                  type="password"
                  value={metaAppSecret}
                  onChange={(event) => setMetaAppSecret(event.target.value)}
                  placeholder="Paste this number’s Meta App Secret"
                />
              </Field>
              <Field label="Coexistence Configuration ID">
                <Input
                  value={metaCoexistenceConfigId}
                  onChange={(event) =>
                    setMetaCoexistenceConfigId(event.target.value)
                  }
                  placeholder={
                    loadingEmbeddedConfig
                      ? 'Loading from environment...'
                      : 'Paste Embedded Signup configuration ID'
                  }
                />
              </Field>
              <div className="bg-muted/30 text-muted-foreground rounded-lg border p-4 text-sm">
                Meta will open a secure Embedded Signup window. Select the
                existing WhatsApp Business App number and approve history, app
                state, and message-echo access.
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep('choose')}>
                  Back
                </Button>
                <Button
                  disabled={
                    submitting ||
                    loadingEmbeddedConfig ||
                    !metaAppId.trim() ||
                    !metaAppSecret.trim() ||
                    !metaCoexistenceConfigId.trim()
                  }
                  onClick={() => void startCoexistenceSignup()}
                >
                  {submitting && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Continue with Meta
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingNumber)} onOpenChange={(open) => {
        if (!open) setEditingNumber(null);
      }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Meta settings</DialogTitle>
            <DialogDescription>
              Save the Meta app details used by this WhatsApp number. Secrets
              are encrypted and never shown again after saving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Field label="Label">
              <Input
                value={editLabel}
                onChange={(event) => setEditLabel(event.target.value)}
              />
            </Field>
            <Field label="Meta App ID">
              <Input
                value={editMetaAppId}
                onChange={(event) => setEditMetaAppId(event.target.value)}
              />
            </Field>
            <Field label="Meta App Secret">
              <Input
                type="password"
                value={editMetaAppSecret}
                onChange={(event) => setEditMetaAppSecret(event.target.value)}
                placeholder={
                  editingNumber?.has_meta_app_secret
                    ? 'Leave blank to keep existing secret'
                    : 'Paste Meta App Secret'
                }
              />
            </Field>
            <Field label="Coexistence Configuration ID">
              <Input
                value={editMetaCoexistenceConfigId}
                onChange={(event) =>
                  setEditMetaCoexistenceConfigId(event.target.value)
                }
                placeholder="Optional for Cloud API numbers"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingNumber(null)}>
                Cancel
              </Button>
              <Button disabled={submitting} onClick={() => void saveMetaSettings()}>
                {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save settings
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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

function SetupCopyRow({
  label,
  value,
  disabled,
  onCopy,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="bg-background/60 mt-2 rounded-md border p-3">
      <div className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-xs">{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          disabled={disabled}
          onClick={onCopy}
          aria-label={`Copy ${label}`}
        >
          <Copy className="size-4" />
        </Button>
      </div>
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

async function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return;
  await new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v21.0',
      });
      resolve();
    };
    const existing = document.getElementById('facebook-jssdk');
    if (existing) {
      // A previous dialog may have inserted the script while it was still
      // loading. Reuse it and settle this caller instead of leaving the
      // Embedded Signup button permanently busy.
      existing.addEventListener(
        'load',
        () => {
          if (window.FB) {
            window.FB.init({
              appId,
              autoLogAppEvents: true,
              xfbml: false,
              version: 'v21.0',
            });
            resolve();
          } else {
            reject(
              new Error('Meta SDK loaded without exposing Embedded Signup')
            );
          }
        },
        { once: true }
      );
      existing.addEventListener(
        'error',
        () => reject(new Error('Unable to load Meta Embedded Signup')),
        { once: true }
      );
      return;
    }
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.onerror = () =>
      reject(new Error('Unable to load Meta Embedded Signup'));
    document.head.appendChild(script);
  });
}

async function waitForSignupResult(
  ref: MutableRefObject<PartialEmbeddedSignupResult | null>,
  timeoutMs: number
): Promise<Omit<EmbeddedSignupResult, 'code'>> {
  const started = Date.now();
  while (
    (!ref.current?.phoneNumberId || !ref.current?.wabaId) &&
    Date.now() - started < timeoutMs
  ) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  if (!ref.current?.phoneNumberId || !ref.current?.wabaId) {
    throw new Error(
      'Meta did not return the selected phone number details. Make sure session logging is enabled for this Embedded Signup configuration.'
    );
  }
  return {
    phoneNumberId: ref.current.phoneNumberId,
    wabaId: ref.current.wabaId,
    businessId: ref.current.businessId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(...values: unknown[]): string {
  return (
    values.find((value): value is string => typeof value === 'string') || ''
  );
}

function readError(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}

function canLaunchEmbeddedSignup(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:';
}
