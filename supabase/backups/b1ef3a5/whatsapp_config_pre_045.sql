-- ============================================================
-- Affected-schema snapshot for base commit b1ef3a5
-- Captured before migration 045.
--
-- At this commit public.whatsapp_config did not contain
-- display_phone_number. This statement restores that exact
-- affected-object state without changing any configuration rows.
-- ============================================================

ALTER TABLE public.whatsapp_config
  DROP COLUMN IF EXISTS display_phone_number;
