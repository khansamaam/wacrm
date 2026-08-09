-- Add trigram indexes for inbox server-side search.
--
-- Inbox search can now look beyond the latest loaded conversations. These
-- indexes keep partial text searches fast across contact fields and the
-- conversation preview text.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON public.contacts USING GIN (name gin_trgm_ops)
  WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_phone_trgm
  ON public.contacts USING GIN (phone gin_trgm_ops)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm
  ON public.contacts USING GIN (email gin_trgm_ops)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_company_trgm
  ON public.contacts USING GIN (company gin_trgm_ops)
  WHERE company IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_text_trgm
  ON public.conversations USING GIN (last_message_text gin_trgm_ops)
  WHERE last_message_text IS NOT NULL;

COMMENT ON INDEX public.idx_contacts_name_trgm IS
  'Inbox search: partial match contact names across the workspace.';
COMMENT ON INDEX public.idx_contacts_phone_trgm IS
  'Inbox search: partial match contact phone numbers across the workspace.';
COMMENT ON INDEX public.idx_contacts_email_trgm IS
  'Inbox search: partial match contact emails across the workspace.';
COMMENT ON INDEX public.idx_contacts_company_trgm IS
  'Inbox search: partial match contact companies across the workspace.';
COMMENT ON INDEX public.idx_conversations_last_message_text_trgm IS
  'Inbox search: partial match latest message preview text.';

COMMIT;
