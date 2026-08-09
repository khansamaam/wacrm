-- Speed up the inbox conversation list for large workspaces.
--
-- The browser inbox reads "latest conversations for this account/number" and
-- embeds each contact's tags. Without indexes matching that order, Postgres can
-- scan too many conversation rows and Supabase may cancel the statement with
-- code 57014 (statement timeout).

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

COMMENT ON INDEX public.idx_conversations_account_last_message_desc IS
  'Inbox list: newest conversations for an account.';
COMMENT ON INDEX public.idx_conversations_account_number_last_message_desc IS
  'Inbox list: newest conversations for an account filtered by WhatsApp number.';
COMMENT ON INDEX public.idx_conversations_account_status_last_message_desc IS
  'Inbox list: newest conversations for an account filtered by status.';

COMMIT;
