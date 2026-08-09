-- Restore the search-performance indexes removed by rollback 054.

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

COMMIT;
