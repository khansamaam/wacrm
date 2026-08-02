BEGIN;

ALTER TABLE public.whatsapp_numbers
  DROP COLUMN IF EXISTS meta_coexistence_config_id,
  DROP COLUMN IF EXISTS meta_app_secret,
  DROP COLUMN IF EXISTS meta_app_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
