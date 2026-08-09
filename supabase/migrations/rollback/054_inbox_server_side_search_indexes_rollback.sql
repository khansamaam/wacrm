-- Roll back migration 054.
--
-- This removes only search-performance indexes. It intentionally leaves the
-- pg_trgm extension installed because another feature or manual index may use
-- it after this migration has run.

BEGIN;

DROP INDEX IF EXISTS public.idx_conversations_last_message_text_trgm;
DROP INDEX IF EXISTS public.idx_contacts_company_trgm;
DROP INDEX IF EXISTS public.idx_contacts_email_trgm;
DROP INDEX IF EXISTS public.idx_contacts_phone_trgm;
DROP INDEX IF EXISTS public.idx_contacts_name_trgm;

COMMIT;
