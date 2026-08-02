# Multi-number WhatsApp deployment

This release adds multiple WhatsApp senders per workspace while preserving the
legacy `whatsapp_config` row as a rolling-deployment compatibility boundary.
Existing workspaces are backfilled automatically as one default `cloud_api`
number; customers do not reconnect or change credentials.

## Data ownership and routing

- `whatsapp_numbers` owns each sender, its WABA, encrypted token, connection
  method, status, and coexistence sync state.
- Conversations, messages, and broadcasts retain the sender number that owns
  them. Templates are scoped by WABA because Meta shares templates across
  numbers in the same WABA.
- Inbound message and status webhooks resolve the workspace using
  `value.metadata.phone_number_id`. Unknown phone IDs are rejected from the
  persistence path instead of falling back to another workspace's default.
- Coexistence history, Business App echoes, and app-state events are stored
  idempotently in `whatsapp_webhook_events`, then processed asynchronously.
- Existing members and invitations receive `all` number access. Owners always
  retain all-number access. Admins can change another member to `selected` and
  assign one or more connected numbers.

## Required deployment order

1. Take an encrypted production database backup outside Git.
2. Apply migrations in order:
   `046_whatsapp_numbers.sql`, `047_whatsapp_number_attribution.sql`,
   `048_whatsapp_number_access_and_sync.sql`, then
   `049_contacts_number_filter.sql`.
3. Deploy the application from the matching feature commit.
4. Verify the existing default number can send and receive before adding a
   second number.
5. If coexistence is enabled, configure the variables below and schedule the
   sync worker.

The migration bridge mirrors the default `whatsapp_numbers` record back to
`whatsapp_config`, and mirrors legacy config changes into the new table. This
allows old and new application instances to overlap during a rolling deploy.

## Coexistence configuration

Set these server variables:

```dotenv
META_APP_ID=...
META_APP_SECRET=...
NEXT_PUBLIC_META_APP_ID=...
NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID=...
AUTOMATION_CRON_SECRET=...
```

The Meta app and Embedded Signup configuration must be approved/enabled for
WhatsApp Business App onboarding. The browser receives only the App ID and
configuration ID; the authorization code is exchanged using `META_APP_SECRET`
on the server and is never stored.

Run the coexistence worker every minute:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $AUTOMATION_CRON_SECRET" \
  https://your-host.example/api/whatsapp/sync/process
```

Meta webhooks still use `/api/whatsapp/webhook`. Subscribe the app to every
WABA used by connected numbers and enable the message/history/app-state fields
required by the coexistence configuration.

## Rollback

Rollback is intentionally conservative because the old schema cannot represent
multiple threads for the same contact or Business App history. Stop application
writes, take a fresh backup, and run:

1. `049_contacts_number_filter.down.sql`
2. `048_whatsapp_number_access_and_sync.down.sql`
3. `047_whatsapp_number_attribution.down.sql`
4. `046_whatsapp_numbers.down.sql`
5. Deploy base application commit `84e3e40`.

The scripts stop with an explanatory exception if selected-number assignments,
coexistence history, or multiple sender threads would be lost. In that case,
keep the additive schema or archive/merge the affected data deliberately.

## Acceptance checklist

- Existing default Cloud API number sends and receives without reconnection.
- A second Cloud API number creates a separate thread for the same contact.
- A coexistence number displays its own badge and imports Business App echoes.
- Inbox, Contacts, Dashboard, Broadcasts, and Templates filter by number.
- A selected-number agent cannot query or send through an unassigned number.
- Disconnecting a number retains history and promotes another connected number
  if the disconnected number was the default.
