BEGIN;

-- Per-number webhook routing for manually connected numbers (including
-- WhatsApp Business App coexistence numbers owned by another Meta Business).
-- Several numbers, from one or many WABAs/businesses, can each be routed
-- independently.
--
-- * connection_source records how the number was added.
-- * webhook_override_* records the phone-level callback override this
--   deployment set on Meta, so the UI can show where webhooks are routed.
-- * webhook_relay_* lets the owner forward an unmodified copy of each
--   inbound webhook (same body + Meta signature) to another system that
--   shares the Meta app, e.g. a Chatwoot instance during a migration.
--
-- Additive only: every column is nullable or defaulted, so the previous app
-- release keeps working. No policies, triggers or bridge functions change.
ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS connection_source text,
  ADD COLUMN IF NOT EXISTS webhook_override_url text,
  ADD COLUMN IF NOT EXISTS webhook_override_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_relay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_relay_url text,
  ADD COLUMN IF NOT EXISTS last_webhook_relay_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_relay_status integer,
  ADD COLUMN IF NOT EXISTS last_webhook_relay_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_numbers_connection_source_check'
      AND conrelid = 'public.whatsapp_numbers'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_numbers
      ADD CONSTRAINT whatsapp_numbers_connection_source_check
      CHECK (
        connection_source IS NULL
        OR connection_source IN ('embedded_signup', 'manual', 'legacy')
      );
  END IF;
END $$;

-- Relay lookups run on every inbound webhook; keep them cheap.
CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_relay_enabled
  ON public.whatsapp_numbers (phone_number_id)
  WHERE webhook_relay_enabled;

COMMENT ON COLUMN public.whatsapp_numbers.connection_source IS
  'How the number was connected: embedded_signup, manual, or legacy (NULL = before migration 057).';
COMMENT ON COLUMN public.whatsapp_numbers.webhook_override_url IS
  'Phone-level webhook override_callback_uri this deployment set on Meta.';
COMMENT ON COLUMN public.whatsapp_numbers.last_webhook_received_at IS
  'Last time a signed Meta webhook for this number reached this deployment.';
COMMENT ON COLUMN public.whatsapp_numbers.webhook_relay_url IS
  'Optional URL that receives an unmodified copy of each inbound webhook for this number.';

NOTIFY pgrst, 'reload schema';

COMMIT;
