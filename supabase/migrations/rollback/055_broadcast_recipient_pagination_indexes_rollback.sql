-- Roll back migration 055.
--
-- This removes only performance indexes. Broadcasts and recipient data remain
-- untouched.

BEGIN;

DROP INDEX IF EXISTS public.idx_broadcast_recipients_broadcast_status_created_desc;
DROP INDEX IF EXISTS public.idx_broadcast_recipients_broadcast_created_desc;

COMMIT;
