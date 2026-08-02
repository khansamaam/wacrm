import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { SAFE_NUMBER_COLUMNS } from '@/lib/whatsapp/numbers'

const MAX_LABEL_LENGTH = 80

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { data, error } = await supabase
      .from('whatsapp_numbers')
      .select(SAFE_NUMBER_COLUMNS)
      .eq('account_id', accountId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[GET /api/whatsapp/numbers] query failed:', error)
      return NextResponse.json({ error: 'Failed to load WhatsApp numbers' }, { status: 500 })
    }

    return NextResponse.json(
      { numbers: data ?? [] },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}

interface AddCloudApiNumberBody {
  label?: unknown
  connection_method?: unknown
  phone_number_id?: unknown
  waba_id?: unknown
  access_token?: unknown
  verify_token?: unknown
  pin?: unknown
}

/** Add a manually configured, API-dedicated Cloud API number. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner')
    const body = (await request.json().catch(() => null)) as AddCloudApiNumberBody | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (body.connection_method !== undefined && body.connection_method !== 'cloud_api') {
      return NextResponse.json(
        { error: 'Coexistence numbers must be added through Embedded Signup' },
        { status: 400 },
      )
    }

    const phoneNumberId = typeof body.phone_number_id === 'string'
      ? body.phone_number_id.trim()
      : ''
    const wabaId = typeof body.waba_id === 'string' ? body.waba_id.trim() : ''
    const accessToken = typeof body.access_token === 'string'
      ? body.access_token.trim()
      : ''
    const verifyToken = typeof body.verify_token === 'string'
      ? body.verify_token.trim()
      : ''
    const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
    const label = typeof body.label === 'string' && body.label.trim()
      ? body.label.trim()
      : 'WhatsApp'

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { error: 'phone_number_id and access_token are required' },
        { status: 400 },
      )
    }
    if (label.length > MAX_LABEL_LENGTH) {
      return NextResponse.json(
        { error: `Label must be ${MAX_LABEL_LENGTH} characters or fewer` },
        { status: 400 },
      )
    }
    if (pin && !/^\d{6}$/.test(pin)) {
      return NextResponse.json({ error: 'PIN must be exactly 6 digits' }, { status: 400 })
    }

    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Meta rejected the credentials' },
        { status: 400 },
      )
    }

    let registeredAt: string | null = null
    let registrationError: string | null = null
    if (pin) {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken, pin })
        registeredAt = new Date().toISOString()
      } catch (error) {
        registrationError = error instanceof Error ? error.message : String(error)
      }
    }

    let subscribedAppsAt: string | null = null
    if (wabaId) {
      try {
        await subscribeWabaToApp({ wabaId, accessToken })
        subscribedAppsAt = new Date().toISOString()
      } catch (error) {
        console.warn('[POST /api/whatsapp/numbers] subscribed_apps failed:', error)
      }
    }

    const { count, error: countError } = await supabase
      .from('whatsapp_numbers')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (countError) {
      return NextResponse.json({ error: 'Failed to inspect workspace numbers' }, { status: 500 })
    }

    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(accessToken)
      encryptedVerifyToken = verifyToken ? encrypt(verifyToken) : null
    } catch {
      return NextResponse.json(
        { error: 'Failed to encrypt credentials. Verify ENCRYPTION_KEY.' },
        { status: 500 },
      )
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('whatsapp_numbers')
      .insert({
        account_id: accountId,
        created_by_user_id: userId,
        label,
        phone_number_id: phoneNumberId,
        display_phone_number: phoneInfo.display_phone_number,
        waba_id: wabaId || null,
        connection_method: 'cloud_api',
        access_token: encryptedAccessToken,
        verify_token: encryptedVerifyToken,
        status: registrationError ? 'error' : 'connected',
        is_default: (count ?? 0) === 0,
        connected_at: registrationError ? null : now,
        registered_at: registeredAt,
        subscribed_apps_at: subscribedAppsAt,
        last_registration_error: registrationError,
      })
      .select(SAFE_NUMBER_COLUMNS)
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This WhatsApp phone number is already connected' },
          { status: 409 },
        )
      }
      console.error('[POST /api/whatsapp/numbers] insert failed:', error)
      return NextResponse.json({ error: 'Failed to save WhatsApp number' }, { status: 500 })
    }

    return NextResponse.json(
      {
        number: data,
        registered: registeredAt !== null,
        registration_skipped: !pin,
        registration_error: registrationError,
      },
      { status: 201 },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
