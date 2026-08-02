'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Check, Cloud, Loader2, MoreHorizontal, Plus, Smartphone, Unplug } from 'lucide-react'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/use-auth'
import type { WhatsAppNumber } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsPanelHead } from './settings-panel-head'

type AddStep = 'choose' | 'cloud_api' | 'coexistence'

interface EmbeddedSignupConfig {
  appId: string
  coexistenceConfigId: string
}

interface EmbeddedSignupResult {
  code: string
  phoneNumberId: string
  wabaId: string
  businessId?: string
}

interface FacebookLoginResponse {
  authResponse?: { code?: string }
  status?: string
}

declare global {
  interface Window {
    FB?: {
      init(options: Record<string, unknown>): void
      login(
        callback: (response: FacebookLoginResponse) => void,
        options: Record<string, unknown>,
      ): void
    }
    fbAsyncInit?: () => void
  }
}

export function WhatsAppNumbers() {
  const { isOwner } = useAuth()
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [step, setStep] = useState<AddStep>('choose')
  const [submitting, setSubmitting] = useState(false)
  const [label, setLabel] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [pin, setPin] = useState('')
  const signupResultRef = useRef<Omit<EmbeddedSignupResult, 'code'> | null>(null)

  const loadNumbers = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/whatsapp/numbers', { cache: 'no-store' })
      const body = await readJson(response)
      if (!response.ok) throw new Error(readError(body, 'Failed to load WhatsApp numbers'))
      setNumbers(Array.isArray(body.numbers) ? body.numbers : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load WhatsApp numbers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNumbers()
  }, [loadNumbers])

  useEffect(() => {
    const receiveSignupEvent = (event: MessageEvent) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return
      let payload: unknown = event.data
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload) } catch { return }
      }
      if (!isRecord(payload) || payload.type !== 'WA_EMBEDDED_SIGNUP' || !isRecord(payload.data)) return
      if (payload.event !== 'FINISH' && payload.event !== 'FINISH_ONLY_WABA') return
      const phoneNumberId = readString(payload.data.phone_number_id, payload.data.phoneNumberId)
      const wabaId = readString(payload.data.waba_id, payload.data.wabaId)
      if (!phoneNumberId || !wabaId) return
      signupResultRef.current = {
        phoneNumberId,
        wabaId,
        businessId: readString(payload.data.business_id, payload.data.businessId) || undefined,
      }
    }
    window.addEventListener('message', receiveSignupEvent)
    return () => window.removeEventListener('message', receiveSignupEvent)
  }, [])

  function openAdd() {
    setStep('choose')
    setLabel('')
    setPhoneNumberId('')
    setWabaId('')
    setAccessToken('')
    setVerifyToken('')
    setPin('')
    setDialogOpen(true)
  }

  async function addCloudNumber() {
    setSubmitting(true)
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
          pin,
        }),
      })
      const body = await readJson(response)
      if (!response.ok) throw new Error(readError(body, 'Failed to connect number'))
      toast.success(body.registration_error ? 'Saved, but Meta registration needs attention' : 'WhatsApp number connected')
      setDialogOpen(false)
      await loadNumbers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to connect number')
    } finally {
      setSubmitting(false)
    }
  }

  async function startCoexistenceSignup() {
    setSubmitting(true)
    signupResultRef.current = null
    try {
      const configResponse = await fetch('/api/whatsapp/embedded-signup/config', { cache: 'no-store' })
      const configBody = await readJson(configResponse)
      if (!configResponse.ok) throw new Error(readError(configBody, 'Embedded Signup is not configured'))
      const config = parseEmbeddedSignupConfig(configBody)
      await loadFacebookSdk(config.appId)

      const code = await new Promise<string>((resolve, reject) => {
        window.FB!.login((response) => {
          const value = response.authResponse?.code
          if (value) resolve(value)
          else reject(new Error('Embedded Signup was cancelled or did not return a code'))
        }, {
          config_id: config.coexistenceConfigId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        })
      })

      // The FINISH window message and FB.login callback are independent. Give
      // the structured event a brief chance to arrive before rejecting.
      const signup = await waitForSignupResult(signupResultRef, 5000)
      const response = await fetch('/api/whatsapp/embedded-signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, label, ...signup }),
      })
      const body = await readJson(response)
      if (!response.ok) throw new Error(readError(body, 'Failed to complete Embedded Signup'))
      toast.success('Coexistence number connected; history sync is queued')
      setDialogOpen(false)
      await loadNumbers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Coexistence signup failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function setDefault(id: string) {
    const response = await fetch(`/api/whatsapp/numbers/${id}/default`, { method: 'POST' })
    const body = await readJson(response)
    if (!response.ok) return toast.error(readError(body, 'Failed to change default number'))
    toast.success('Default sending number updated')
    await loadNumbers()
  }

  async function disconnect(id: string) {
    if (!window.confirm('Disconnect this number? Existing messages will remain available.')) return
    const response = await fetch(`/api/whatsapp/numbers/${id}`, { method: 'DELETE' })
    const body = await readJson(response)
    if (!response.ok) return toast.error(readError(body, 'Failed to disconnect number'))
    toast.success('WhatsApp number disconnected')
    await loadNumbers()
  }

  return (
    <div className="space-y-5">
      <SettingsPanelHead
        title="WhatsApp numbers"
        description="Connect and manage the business numbers used by this workspace."
        action={isOwner ? <Button onClick={openAdd}><Plus className="mr-2 size-4" />Add number</Button> : null}
      />

      {loading ? (
        <div className="flex min-h-40 items-center justify-center"><Loader2 className="size-5 animate-spin" /></div>
      ) : numbers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No WhatsApp numbers connected yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {numbers.map((number) => (
            <div key={number.id} className="flex flex-wrap items-center gap-4 border-b p-4 last:border-b-0">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Smartphone className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{number.label}</span>
                  {number.is_default && <Badge variant="secondary">Default</Badge>}
                  <Badge variant="outline">{number.connection_method === 'coexistence' ? 'Coexistence' : 'Cloud API'}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {number.display_phone_number || number.phone_number_id}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {number.connected_at
                    ? `Connected ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(number.connected_at))}`
                    : 'Not connected yet'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={number.status === 'connected' ? 'text-sm text-emerald-500' : 'text-sm text-amber-500'}>
                  {number.status}
                </span>
                {isOwner && (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!number.is_default && number.status === 'connected' && (
                        <DropdownMenuItem onClick={() => void setDefault(number.id)}><Check className="mr-2 size-4" />Make default</DropdownMenuItem>
                      )}
                      {number.status !== 'disconnected' && (
                        <DropdownMenuItem className="text-destructive" onClick={() => void disconnect(number.id)}><Unplug className="mr-2 size-4" />Disconnect</DropdownMenuItem>
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
              Choose whether this number is dedicated to Cloud API or remains usable in WhatsApp Business App.
            </DialogDescription>
          </DialogHeader>

          {step === 'choose' && (
            <div className="grid gap-3 py-2 sm:grid-cols-2">
              <button className="rounded-xl border p-5 text-left hover:border-emerald-500" onClick={() => setStep('cloud_api')}>
                <Cloud className="mb-3 size-6 text-emerald-500" />
                <strong>Cloud API only</strong>
                <p className="mt-2 text-sm text-muted-foreground">For a number dedicated to Meta Cloud API.</p>
              </button>
              <button className="rounded-xl border p-5 text-left hover:border-emerald-500" onClick={() => setStep('coexistence')}>
                <Smartphone className="mb-3 size-6 text-emerald-500" />
                <strong>Coexistence</strong>
                <p className="mt-2 text-sm text-muted-foreground">Keep using the number in WhatsApp Business App and this dashboard.</p>
              </button>
            </div>
          )}

          {step === 'cloud_api' && (
            <div className="space-y-4 py-2">
              <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Dubai Clinic" /></Field>
              <Field label="Phone Number ID"><Input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} /></Field>
              <Field label="WABA ID"><Input value={wabaId} onChange={(e) => setWabaId(e.target.value)} /></Field>
              <Field label="Permanent access token"><Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} /></Field>
              <Field label="Webhook verify token (optional)"><Input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} /></Field>
              <Field label="Two-step verification PIN (optional)"><Input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
              <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep('choose')}>Back</Button><Button disabled={submitting || !phoneNumberId || !accessToken} onClick={() => void addCloudNumber()}>{submitting && <Loader2 className="mr-2 size-4 animate-spin" />}Connect number</Button></div>
            </div>
          )}

          {step === 'coexistence' && (
            <div className="space-y-4 py-2">
              <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main Business App" /></Field>
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Meta will open a secure Embedded Signup window. Select the existing WhatsApp Business App number and approve history, app state, and message-echo access.
              </div>
              <div className="flex justify-between"><Button variant="ghost" onClick={() => setStep('choose')}>Back</Button><Button disabled={submitting} onClick={() => void startCoexistenceSignup()}>{submitting && <Loader2 className="mr-2 size-4 animate-spin" />}Continue with Meta</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return { error: `Unexpected server response (${response.status})` } }
}

async function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return
  await new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v21.0' })
      resolve()
    }
    const existing = document.getElementById('facebook-jssdk')
    if (existing) {
      // A previous dialog may have inserted the script while it was still
      // loading. Reuse it and settle this caller instead of leaving the
      // Embedded Signup button permanently busy.
      existing.addEventListener('load', () => {
        if (window.FB) {
          window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v21.0' })
          resolve()
        } else {
          reject(new Error('Meta SDK loaded without exposing Embedded Signup'))
        }
      }, { once: true })
      existing.addEventListener('error', () => reject(new Error('Unable to load Meta Embedded Signup')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = 'facebook-jssdk'
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.onerror = () => reject(new Error('Unable to load Meta Embedded Signup'))
    document.head.appendChild(script)
  })
}

async function waitForSignupResult(
  ref: MutableRefObject<Omit<EmbeddedSignupResult, 'code'> | null>,
  timeoutMs: number,
): Promise<Omit<EmbeddedSignupResult, 'code'>> {
  const started = Date.now()
  while (!ref.current && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  if (!ref.current) throw new Error('Meta did not return the selected phone number details')
  return ref.current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string') || ''
}

function readError(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback
}

function parseEmbeddedSignupConfig(body: Record<string, unknown>): EmbeddedSignupConfig {
  const appId = readString(body.appId)
  const coexistenceConfigId = readString(body.coexistenceConfigId)
  if (!appId || !coexistenceConfigId) {
    throw new Error('Embedded Signup configuration is incomplete')
  }
  return { appId, coexistenceConfigId }
}
