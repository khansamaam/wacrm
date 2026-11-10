-- Rollback for 066_performance_indexes.sql (indexes only; no data touched).
BEGIN;
DROP INDEX IF EXISTS public.idx_contacts_phone_normalized_trgm;
DROP INDEX IF EXISTS public.idx_conversations_account_unread;
DROP INDEX IF EXISTS public.idx_messages_conversation_created_desc;
COMMIT;
