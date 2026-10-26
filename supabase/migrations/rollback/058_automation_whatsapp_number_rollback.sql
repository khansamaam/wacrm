-- Roll back migration 058.
--
-- Removes the per-number scope from automations; every automation runs for
-- every number again. Automation definitions, steps and logs are untouched.

BEGIN;

DROP INDEX IF EXISTS public.idx_automations_account_trigger_number;

ALTER TABLE public.automations
  DROP COLUMN IF EXISTS whatsapp_number_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
