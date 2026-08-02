import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'

/** Public identifiers needed to launch Meta's browser SDK; never returns secrets. */
export async function GET() {
  try {
    await requireRole('owner')
    const appId = process.env.NEXT_PUBLIC_META_APP_ID ?? process.env.META_APP_ID
    const coexistenceConfigId = process.env.NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID

    if (!appId || !coexistenceConfigId) {
      return NextResponse.json(
        {
          configured: false,
          error:
            'Set NEXT_PUBLIC_META_APP_ID and NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID to enable Coexistence Embedded Signup.',
        },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { configured: true, appId, coexistenceConfigId },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
