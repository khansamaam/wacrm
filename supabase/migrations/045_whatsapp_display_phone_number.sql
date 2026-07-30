-- ============================================================
-- 045_whatsapp_display_phone_number.sql
--
-- Cache Meta's human-readable WhatsApp phone number separately
-- from phone_number_id, which is an internal Meta identifier.
-- Existing rows are populated lazily by /api/whatsapp/status.
-- ============================================================

BEGIN;

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT;

COMMENT ON COLUMN public.whatsapp_config.display_phone_number IS
  'Human-readable business number returned by Meta, displayed in workspace navigation.';

NOTIFY pgrst, 'reload schema';

COMMIT;
