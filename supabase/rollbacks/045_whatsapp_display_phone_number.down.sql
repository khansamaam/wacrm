-- ============================================================
-- Rollback for 045_whatsapp_display_phone_number.sql
--
-- Run manually before deploying application code from before
-- migration 045. No WhatsApp configuration rows are deleted.
-- ============================================================

BEGIN;

ALTER TABLE public.whatsapp_config
  DROP COLUMN IF EXISTS display_phone_number;

NOTIFY pgrst, 'reload schema';

COMMIT;
