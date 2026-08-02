import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/** Public identifiers needed to launch Meta's browser SDK; never returns secrets. */
export async function GET() {
  try {
    await requireRole('owner');
    const appId =
      process.env.NEXT_PUBLIC_META_APP_ID ?? process.env.META_APP_ID;
    const coexistenceConfigId =
      process.env.NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID;
    const hasAppSecret = Boolean(process.env.META_APP_SECRET);

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
