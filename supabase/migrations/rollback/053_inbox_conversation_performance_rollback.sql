-- Roll back migration 053.
--
-- This only removes performance indexes. It does not delete conversations,
-- contacts, messages, broadcasts, or WhatsApp configuration.

BEGIN;

DROP INDEX IF EXISTS public.idx_conversations_account_status_last_message_desc;
DROP INDEX IF EXISTS public.idx_conversations_account_number_last_message_desc;
DROP INDEX IF EXISTS public.idx_conversations_account_last_message_desc;

COMMIT;
