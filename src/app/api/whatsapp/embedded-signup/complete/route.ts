import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  exchangeEmbeddedSignupCode,
  listWabaPhoneNumbers,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import {
  applyWebhookRouting,
  generateVerifyToken,
  resolveOnboardedPhoneNumber,
} from '@/lib/whatsapp/coexistence-connect';
import { processPendingCoexistenceSyncJobs } from '@/lib/whatsapp/coexistence-sync';
import {
  insertWhatsAppNumberRow,
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
  // camelCase spellings sent by older builds of the settings UI
  phoneNumberId?: unknown;
  wabaId?: unknown;
  businessId?: unknown;
  label?: unknown;
}

function readTrimmed(...values: unknown[]): string {
  const value = values.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim() !== ''
  );
  return value ? value.trim() : '';
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
    let phoneNumberId = readTrimmed(body?.phone_number_id, body?.phoneNumberId);
    const wabaId = readTrimmed(body?.waba_id, body?.wabaId);
    const businessId = readTrimmed(body?.business_id, body?.businessId);
    const label =
      typeof body?.label === 'string' && body.label.trim()
        ? body.label.trim()
        : 'WhatsApp Business App';

    // Coexistence completions often carry only waba_id; the onboarded
    // number is then resolved from the WABA after the code exchange.
    if (!code || !wabaId) {
      return NextResponse.json(
        {
          error:
            'Embedded Signup did not return an authorization code and WhatsApp Business Account ID',
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

    const appId =
      requestedAppId ||
      process.env.META_COEXISTENCE_APP_ID ||
      process.env.NEXT_PUBLIC_META_APP_ID ||
      process.env.META_APP_ID ||
      '';
    // Prefer an explicit per-connection value for backwards compatibility,
    // otherwise use the platform secret without exposing it to the browser.
    const appSecret =
      requestedAppSecret ||
      process.env.META_COEXISTENCE_APP_SECRET ||
      process.env.META_APP_SECRET ||
      '';
    const coexistenceConfigId =
      requestedCoexistenceConfigId ||
      process.env.META_COEXISTENCE_CONFIG_ID ||
      process.env.NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID ||
      '';
    if (!appId || !appSecret || !coexistenceConfigId) {
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
      if (!phoneNumberId) {
        const wabaNumbers = await listWabaPhoneNumbers({ wabaId, accessToken });
        phoneNumberId = String(resolveOnboardedPhoneNumber(wabaNumbers).id);
      }
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

    // Stored before the webhook override so Meta's GET handshake can match it.
    const verifyToken = generateVerifyToken();
    const now = new Date().toISOString();
    const { data, error } = await insertWhatsAppNumberRow(supabase, {
        account_id: accountId,
        created_by_user_id: userId,
        label,
        phone_number_id: phoneNumberId,
        display_phone_number: phoneInfo.display_phone_number,
        waba_id: wabaId,
        connection_method: 'coexistence',
        access_token: encrypt(accessToken),
        verify_token: encrypt(verifyToken),
        meta_app_id: appId,
        meta_app_secret: encrypt(appSecret),
        meta_coexistence_config_id: coexistenceConfigId,
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
      });

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

    // Point this number's webhooks at this deployment (phone-level override),
    // so it works even when the Meta app's default callback goes elsewhere.
    const routing = await applyWebhookRouting({
      supabase,
      numberRowId: number.id,
      wabaId,
      phoneNumberId,
      accessToken,
      verifyToken,
      connectionSource: 'embedded_signup',
    });
    if (routing.error) {
      console.warn(
        '[embedded-signup/complete] webhook routing failed:',
        routing.error
      );
    }
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
      {
        number: sanitizeWhatsAppNumber(data as unknown as WhatsAppNumberRow),
        webhook_routed: routing.routed,
        webhook_error: routing.error,
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
