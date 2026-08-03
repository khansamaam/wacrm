import { timingSafeEqual } from 'node:crypto';
import { after, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { processBroadcastQueue } from '@/lib/whatsapp/broadcast-queue';

export const maxDuration = 60;

function hasValidWorkerSecret(request: Request): boolean {
  const expected =
    process.env.BROADCAST_WORKER_SECRET ?? process.env.AUTOMATION_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

/** Cron entry point. Run every minute; leases make overlaps safe. */
export async function GET(request: Request) {
  if (
    !process.env.BROADCAST_WORKER_SECRET &&
    !process.env.AUTOMATION_CRON_SECRET
  ) {
    return NextResponse.json(
      { error: 'broadcast worker is not configured' },
      { status: 503 }
    );
  }
  if (!hasValidWorkerSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await processBroadcastQueue());
  } catch (error) {
    console.error('[broadcast-worker] cron run failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Worker failed' },
      { status: 500 }
    );
  }
}

/**
 * Authenticated kick after a dashboard enqueue. The durable cron remains the
 * recovery mechanism; this merely starts delivery without waiting a minute.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 403 });
  }

  after(async () => {
    try {
      await processBroadcastQueue({ accountId: profile.account_id });
    } catch (error) {
      console.error('[broadcast-worker] dashboard kick failed:', error);
    }
  });

  return NextResponse.json({ queued: true }, { status: 202 });
}
