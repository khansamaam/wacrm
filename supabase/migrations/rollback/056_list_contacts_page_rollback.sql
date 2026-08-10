-- Roll back migration 056.
--
-- Drops the Contacts page RPC and its helper index. Contact data remains
-- untouched.

BEGIN;

DROP FUNCTION IF EXISTS public.list_contacts_page(UUID[], UUID, TEXT, INT, INT);
DROP INDEX IF EXISTS public.idx_contacts_account_created_desc;

COMMIT;
