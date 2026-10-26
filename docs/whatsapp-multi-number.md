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
META_COEXISTENCE_APP_ID=...
META_COEXISTENCE_APP_SECRET=...
META_COEXISTENCE_CONFIG_ID=...
NEXT_PUBLIC_SITE_URL=https://your-host.example   # must be public https
AUTOMATION_CRON_SECRET=...
```

`META_APP_ID` / `META_APP_SECRET` (legacy Cloud API app) and
`NEXT_PUBLIC_META_APP_ID` / `NEXT_PUBLIC_META_COEXISTENCE_CONFIG_ID` are still
accepted as fallbacks. The browser receives only the App ID and configuration
ID; the authorization code is exchanged on the server and is never stored.
Webhook signatures are accepted from `META_APP_SECRET`,
`META_COEXISTENCE_APP_SECRET`, or the number's own saved App Secret.

When Embedded Signup returns only the WABA ID (common for Business App
onboarding), the server resolves the onboarded number from that WABA. If the
WABA holds several numbers, use the manual connection below instead.

## Manual connection (numbers from any Meta Business)

Settings → WhatsApp → Add number → **Manual (any business)** connects one or
more numbers with a WABA ID and a System User access token, the same way
Chatwoot's manual setup does. The number can belong to a different Meta
Business than the app.

1. In the number owner's Business Settings → System users, assign the WABA and
   this app to a system user, then generate a permanent token with
   `whatsapp_business_messaging` and `whatsapp_business_management`.
2. Enter the WABA ID and token, click **Fetch numbers**, and select the
   numbers to connect. Each number is stored separately with its own token,
   verify token, and webhook routing.
3. WhatsApp Business App numbers are stored as coexistence and are never
   re-registered, so they keep working on the phone.

For every connected number the app subscribes itself to the WABA and sets a
phone-level webhook override (`override_callback_uri`) to
`NEXT_PUBLIC_SITE_URL/api/whatsapp/webhook`. No Meta App dashboard change is
needed. A number can only have one override per app: if another system (for
example Chatwoot) set its own override, use the number's **Webhook & relay**
dialog → **Route webhooks to this app**.

### Keeping Chatwoot (or another system) in sync

In **Webhook & relay**, enable **Send a copy to Chatwoot** and enter the
Chatwoot base URL (for example `http://10.0.0.111:3001`). Each webhook is
forwarded unchanged — same body and `X-Hub-Signature-256` — to
`/webhooks/whatsapp/+<number>`, so Chatwoot verifies it as if Meta had called
it. Relays are best-effort and never delay or block processing here. The
target host must be listed in `WHATSAPP_WEBHOOK_RELAY_ALLOWED_HOSTS`. Do not
press "Setup webhook" in Chatwoot for these numbers afterwards; that moves the
override back to Chatwoot.

Database migration `057_whatsapp_webhook_routing.sql` stores the routing and
relay state. Connecting numbers works without it, but the status panel and
relay need it.

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
