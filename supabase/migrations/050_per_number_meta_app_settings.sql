BEGIN;

-- Store Meta application settings per WhatsApp number.
-- Existing legacy workspaces keep working through environment-variable fallback
-- until the Workspace Owner opens Settings → WhatsApp → Meta settings and saves
-- these values onto each connected number.
ALTER TABLE public.whatsapp_numbers
  ADD COLUMN IF NOT EXISTS meta_app_id text,
  ADD COLUMN IF NOT EXISTS meta_app_secret text,
  ADD COLUMN IF NOT EXISTS meta_coexistence_config_id text;

COMMENT ON COLUMN public.whatsapp_numbers.meta_app_id IS
  'Meta app id used by this WhatsApp phone number.';
COMMENT ON COLUMN public.whatsapp_numbers.meta_app_secret IS
  'Encrypted Meta app secret used to verify webhook signatures for this phone number.';
COMMENT ON COLUMN public.whatsapp_numbers.meta_coexistence_config_id IS
  'Meta Embedded Signup configuration id used when this number was connected via coexistence.';

NOTIFY pgrst, 'reload schema';

COMMIT;
