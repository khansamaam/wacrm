-- Roll back migration 063: drops the "deleted by customer" marker only.

BEGIN;

ALTER TABLE public.messages DROP COLUMN IF EXISTS deleted_by_customer_at;

NOTIFY pgrst, 'reload schema';

COMMIT;
