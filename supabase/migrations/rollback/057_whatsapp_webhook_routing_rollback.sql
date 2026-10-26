-- Roll back migration 057.
--
-- Removes only the webhook routing / relay bookkeeping columns. WhatsApp
-- numbers, tokens, conversations and messages remain untouched. Meta keeps
-- any phone-level webhook override that was already set; clear it in Meta
-- (or reconnect the number) if webhooks should go elsewhere afterwards.

BEGIN;

DROP INDEX IF EXISTS public.idx_whatsapp_numbers_relay_enabled;

ALTER TABLE public.whatsapp_numbers
  DROP CONSTRAINT IF EXISTS whatsapp_numbers_connection_source_check;

ALTER TABLE public.whatsapp_numbers
  DROP COLUMN IF EXISTS last_webhook_relay_error,
  DROP COLUMN IF EXISTS last_webhook_relay_status,
  DROP COLUMN IF EXISTS last_webhook_relay_at,
  DROP COLUMN IF EXISTS webhook_relay_url,
  DROP COLUMN IF EXISTS webhook_relay_enabled,
  DROP COLUMN IF EXISTS last_webhook_received_at,
  DROP COLUMN IF EXISTS webhook_override_set_at,
  DROP COLUMN IF EXISTS webhook_override_url,
  DROP COLUMN IF EXISTS connection_source;

NOTIFY pgrst, 'reload schema';

COMMIT;
