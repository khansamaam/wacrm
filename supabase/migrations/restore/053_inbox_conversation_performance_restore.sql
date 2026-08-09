-- Restore the performance indexes removed by rollback 053.
--
-- Safe to run after re-applying the application version that expects the
-- optimized inbox query path.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message_desc
  ON public.conversations (
    account_id,
    last_message_at DESC NULLS LAST,
    updated_at DESC NULLS LAST,
    id DESC
  );

CREATE INDEX IF NOT EXISTS idx_conversations_account_number_last_message_desc
  ON public.conversations (
    account_id,
    whatsapp_number_id,
    last_message_at DESC NULLS LAST,
    updated_at DESC NULLS LAST,
    id DESC
  )
  WHERE whatsapp_number_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_account_status_last_message_desc
  ON public.conversations (
    account_id,
    status,
    last_message_at DESC NULLS LAST,
    updated_at DESC NULLS LAST,
    id DESC
  );

COMMIT;
