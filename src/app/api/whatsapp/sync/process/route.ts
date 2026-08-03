import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  processPendingCoexistenceEvents,
  processPendingCoexistenceSyncJobs,
} from '@/lib/whatsapp/coexistence-sync'

export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!expected || authorization !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [jobs, events] = await Promise.all([
      processPendingCoexistenceSyncJobs(supabaseAdmin()),
      processPendingCoexistenceEvents(supabaseAdmin()),
    ])
    return NextResponse.json({ jobs, events })
  } catch (error) {
    console.error('[whatsapp/sync/process] failed:', error)
    return NextResponse.json({ error: 'Failed to process sync events' }, { status: 500 })
  }
}
