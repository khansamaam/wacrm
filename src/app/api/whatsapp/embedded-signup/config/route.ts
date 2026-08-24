import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/** Public identifiers needed to launch Meta's browser SDK; never returns secrets. */
export async function GET() {
  try {
    await requireRole('owner');
    // Prefer dedicated Coexistence credentials. Legacy fallbacks preserve
    // existing installations that intentionally use one Meta app for both
    // Cloud API and Coexistence.
    const appId =
      process.env.META_COEXISTENCE_APP_ID ??
      process.env.NEXT_PUBLIC_META_APP_ID ??
      process.env.META_APP_ID;
    const coexistenceConfigId =
      process.env.META_COEXISTENCE_CONFIG_ID ??
      process.env.NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID;
    const hasAppSecret = Boolean(
      process.env.META_COEXISTENCE_APP_SECRET ?? process.env.META_APP_SECRET
    );

    return NextResponse.json(
      {
        configured: Boolean(appId && coexistenceConfigId && hasAppSecret),
        appId: appId ?? '',
        coexistenceConfigId: coexistenceConfigId ?? '',
        hasAppSecret,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
