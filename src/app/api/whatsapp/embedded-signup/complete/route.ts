import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  exchangeEmbeddedSignupCode,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import { processPendingCoexistenceSyncJobs } from '@/lib/whatsapp/coexistence-sync';
import {
  SERVER_NUMBER_COLUMNS,
  sanitizeWhatsAppNumber,
  type WhatsAppNumberRow,
} from '@/lib/whatsapp/numbers';

interface CompletionBody {
  code?: unknown;
  app_id?: unknown;
  app_secret?: unknown;
  coexistence_config_id?: unknown;
  phone_number_id?: unknown;
  waba_id?: unknown;
  business_id?: unknown;
  label?: unknown;
}

/**
 * Complete the coexistence flavor of Embedded Signup. Coexistence numbers are
 * already registered by Meta, so this intentionally does not call /register.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('owner');
    const body = (await request
      .json()
      .catch(() => null)) as CompletionBody | null;
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const requestedAppId =
      typeof body?.app_id === 'string' ? body.app_id.trim() : '';
    const requestedAppSecret =
      typeof body?.app_secret === 'string' ? body.app_secret.trim() : '';
    const requestedCoexistenceConfigId =
      typeof body?.coexistence_config_id === 'string'
        ? body.coexistence_config_id.trim()
        : '';
    const phoneNumberId =
      typeof body?.phone_number_id === 'string'
        ? body.phone_number_id.trim()
        : '';
    const wabaId = typeof body?.waba_id === 'string' ? body.waba_id.trim() : '';
    const businessId =
      typeof body?.business_id === 'string' ? body.business_id.trim() : '';
    const label =
      typeof body?.label === 'string' && body.label.trim()
        ? body.label.trim()
        : 'WhatsApp Business App';

    if (!code || !phoneNumberId || !wabaId) {
      return NextResponse.json(
        {
          error:
            'Embedded Signup did not return code, phone_number_id and waba_id',
        },
        { status: 400 }
      );
    }
    if (label.length > 80) {
      return NextResponse.json(
        { error: 'Label must be 80 characters or fewer' },
        { status: 400 }
      );
    }

    const legacyConfiguredAppId =
      process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID;
    const appId = requestedAppId || legacyConfiguredAppId || '';
    const appSecret = requestedAppSecret;
    if (!appId || !appSecret || !requestedCoexistenceConfigId) {
      return NextResponse.json(
        {
          error:
            'Meta App ID, Meta App Secret, and Coexistence Configuration ID are required to complete Embedded Signup',
        },
        { status: 503 }
      );
    }

    let accessToken: string;
    try {
      const exchanged = await exchangeEmbeddedSignupCode({
        code,
        appId,
        appSecret,
      });
      accessToken = exchanged.access_token;
    } catch (error) {
      console.error('[embedded-signup/complete] code exchange failed:', error);
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Embedded Signup exchange failed',
        },
        { status: 400 }
      );
    }

    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken });
      await subscribeWabaToApp({ wabaId, accessToken });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Meta asset verification failed',
        },
        { status: 400 }
      );
    }

    const { count } = await supabase
      .from('whatsapp_numbers')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('whatsapp_numbers')
      .insert({
        account_id: accountId,
        created_by_user_id: userId,
        label,
        phone_number_id: phoneNumberId,
        display_phone_number: phoneInfo.display_phone_number,
        waba_id: wabaId,
        connection_method: 'coexistence',
        access_token: encrypt(accessToken),
        meta_app_id: appId,
        meta_app_secret: encrypt(appSecret),
        meta_coexistence_config_id: requestedCoexistenceConfigId,
        status: 'connected',
        is_default: (count ?? 0) === 0,
        connected_at: now,
        registered_at: now,
        subscribed_apps_at: now,
        is_on_biz_app: true,
        platform_type: 'CLOUD_API',
        coexistence_onboarded_at: now,
        history_sync_status: 'pending',
        history_sync_requested_at: now,
        contacts_sync_status: 'pending',
        contacts_sync_requested_at: now,
        metadata: businessId ? { business_id: businessId } : {},
      })
      .select(SERVER_NUMBER_COLUMNS)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This WhatsApp number is already connected to a workspace' },
          { status: 409 }
        );
      }
      console.error('[embedded-signup/complete] insert failed:', error);
      return NextResponse.json(
        { error: 'Failed to save coexistence number' },
        { status: 500 }
      );
    }

    const number = data as unknown as { id: string };
    const { error: jobError } = await supabase
      .from('whatsapp_sync_jobs')
      .insert([
        {
          whatsapp_number_id: number.id,
          account_id: accountId,
          sync_type: 'history',
        },
        {
          whatsapp_number_id: number.id,
          account_id: accountId,
          sync_type: 'contacts',
        },
      ]);
    if (jobError) {
      console.warn(
        '[embedded-signup/complete] sync job creation failed:',
        jobError.message
      );
    } else {
      try {
        await processPendingCoexistenceSyncJobs(supabase, {
          whatsappNumberId: number.id,
          limit: 2,
        });
      } catch (syncError) {
        console.warn(
          '[embedded-signup/complete] sync request initiation failed:',
          syncError instanceof Error ? syncError.message : syncError
        );
      }
    }

    return NextResponse.json(
      { number: sanitizeWhatsAppNumber(data as unknown as WhatsAppNumberRow) },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
