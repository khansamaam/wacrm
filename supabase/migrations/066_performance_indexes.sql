-- 066: indexes for the full-table scans seen in pg_stat_user_tables.
--
-- 1. Contact matching (webhook, message sync, API sends) looks contacts up
--    by the last 8 digits of the phone: phone_normalized LIKE '%12345678'.
--    A leading wildcard can't use a btree, so every lookup scanned the
--    whole contacts table. A trigram index serves it.
-- 2. The sidebar unread badge reads conversations with unread_count > 0;
--    a small partial index answers it without scanning every conversation.
-- 3. Opening a chat loads its newest messages; a composite index returns
--    them already ordered instead of sorting the chat's rows.
--
-- Additive only; no data changes. Rollback:
-- supabase/migrations/rollback/066_performance_indexes_rollback.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_contacts_phone_normalized_trgm
  ON public.contacts USING GIN (phone_normalized gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_conversations_account_unread
  ON public.conversations (account_id)
  WHERE unread_count > 0;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_desc
  ON public.messages (conversation_id, created_at DESC);

ANALYZE public.contacts;
ANALYZE public.conversations;
ANALYZE public.messages;

COMMIT;
