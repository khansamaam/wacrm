# Durable broadcast worker

Broadcast recipients are persisted as leased jobs in Postgres before the UI
reports that a campaign has started. Closing the browser, restarting Next.js,
or a transient Meta/network failure therefore does not discard the remaining
audience.

## Deployment

1. Apply `supabase/migrations/052_durable_broadcast_queue.sql`.
2. Optionally set a long random `BROADCAST_WORKER_SECRET` on the application
   server. If it is omitted, the route uses `AUTOMATION_CRON_SECRET`. When both
   are omitted, the worker accepts an unauthenticated cron request.
3. Configure a scheduler to call the worker once per minute:

```sh
curl --fail --silent --show-error \
  -H "x-cron-secret: YOUR_BROADCAST_WORKER_SECRET" \
  https://YOUR_APP_HOST/api/whatsapp/broadcast/worker
```

Without either secret, omit the header:

```sh
curl --fail --silent --show-error \
  https://YOUR_APP_HOST/api/whatsapp/broadcast/worker
```

For cPanel, add that command under **Cron Jobs** with the once-per-minute
schedule (`* * * * *`). Store the secret in the hosting environment and do not
commit it to Git.

The unauthenticated mode cannot create campaigns or recipient jobs, but a
public caller could repeatedly invoke the existing queue and consume server
resources. A secret remains recommended for internet-facing deployments.

The dashboard also sends an authenticated best-effort worker kick immediately
after enqueueing. That reduces startup latency, but cron is the recovery path
and must remain configured.

## Delivery behavior

- Jobs are claimed atomically with `FOR UPDATE SKIP LOCKED`, so overlapping
  worker calls can cooperate.
- A claim has a three-minute lease. An interrupted worker leaves the recipient
  pending and another worker reclaims it after expiry.
- Retryable network, throttling, and Meta service errors use exponential
  backoff: 1 minute, 5 minutes, 15 minutes, 1 hour, then 6 hours.
- Permanent validation/permission failures are recorded immediately. Each
  recipient retains its error for the broadcast report.
- Personalization and template structure are snapshotted when enqueued, so
  later contact/template edits do not change an in-flight campaign.

Meta does not provide an idempotency key for message sends. There is therefore
a very small at-least-once window if Meta accepts a message and the worker dies
before saving the returned message ID. The lease prevents normal concurrent
duplicates, but no database-only queue can eliminate that external side-effect
window.

## Rollback and recovery

- `supabase/migrations/rollback/052_durable_broadcast_queue_rollback.sql`
  archives queue metadata before removing queue objects.
- Reapply migration 052 and then run
  `supabase/migrations/restore/052_durable_broadcast_queue_restore.sql` to
  recover that archived metadata.
- Existing broadcasts, recipient rows, message IDs, and delivery/read statuses
  are not deleted by rollback.
