import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

interface ConnectionRow {
  phone_number_id: string
  display_phone_number: string | null
  access_token: string
  status: string
}

/**
 * Return the non-sensitive WhatsApp connection summary used by the sidebar.
 *
 * Every workspace member may see the business number they are working with,
 * but this endpoint never returns tokens, WABA details, or configuration
 * controls. Those remain Workspace Owner-only.
 */
export async function GET() {
  try {
    const { supabase, accountId, role } = await requireRole('viewer')
    const result = await supabase
      .from('whatsapp_config')
      .select(
        'phone_number_id, display_phone_number, access_token, status'
      )
      .eq('account_id', accountId)
      .maybeSingle()
    let config = result.data as ConnectionRow | null
    let queryError = result.error

    // Keep rolling deployments functional when application code reaches an
    // instance before migration 045. PostgREST reports an unknown column;
    // retry against the pre-045 shape and resolve the display number via Meta.
    if (
      queryError &&
      (queryError.code === '42703' ||
        queryError.code === 'PGRST204' ||
        queryError.message.includes('display_phone_number'))
    ) {
      const legacyResult = await supabase
        .from('whatsapp_config')
        .select('phone_number_id, access_token, status')
        .eq('account_id', accountId)
        .maybeSingle()

      config = legacyResult.data
        ? {
            ...(legacyResult.data as Omit<
              ConnectionRow,
              'display_phone_number'
            >),
            display_phone_number: null,
          }
        : null
      queryError = legacyResult.error
    }

    if (queryError) {
      throw new Error('Failed to load WhatsApp connection status')
    }

    if (!config) {
      return NextResponse.json(
        {
          configured: false,
          connected: false,
          phoneNumber: null,
          numberKind: null,
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      )
    }

    let displayPhoneNumber = config.display_phone_number as string | null

    // Existing rows predate display_phone_number. Resolve it once from Meta;
    // the Workspace Owner can cache it under the owner-only RLS policy.
    if (!displayPhoneNumber) {
      try {
        const phoneInfo = await verifyPhoneNumber({
          phoneNumberId: config.phone_number_id,
          accessToken: decrypt(config.access_token),
        })
        displayPhoneNumber = phoneInfo.display_phone_number

        if (role === 'owner') {
          const { error: cacheError } = await supabase
            .from('whatsapp_config')
            .update({ display_phone_number: displayPhoneNumber })
            .eq('account_id', accountId)

          if (cacheError) {
            console.warn(
              '[whatsapp/status] Could not cache display phone number:',
              cacheError.message
            )
          }
        }
      } catch (metaError) {
        // The Meta number ID is still a safe fallback if metadata cannot be
        // refreshed. Never expose the provider error or encrypted credential.
        console.warn(
          '[whatsapp/status] Could not resolve display phone number:',
          metaError instanceof Error ? metaError.message : metaError
        )
      }
    }

    return NextResponse.json(
      {
        configured: true,
        connected: config.status === 'connected',
        phoneNumber: displayPhoneNumber ?? config.phone_number_id,
        numberKind: displayPhoneNumber ? 'display' : 'id',
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
