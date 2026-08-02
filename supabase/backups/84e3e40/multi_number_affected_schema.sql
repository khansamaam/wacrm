-- ============================================================
-- Affected-schema snapshot for base commit 84e3e40.
-- Captured before migrations 046-049 (multi-number/coexistence).
--
-- This is intentionally a schema-only marker: production rows contain
-- customer data and encrypted Meta tokens and must never be committed to Git.
-- The executable restoration is the ordered rollback set 049 -> 046.
-- ============================================================

-- Objects absent at base commit 84e3e40:
--   public.whatsapp_numbers
--   public.whatsapp_number_members
--   public.whatsapp_invitation_number_access
--   public.whatsapp_webhook_events
--   public.whatsapp_sync_jobs
--   public.filter_contacts_by_tags_and_number(...)

-- Columns absent at the base commit:
--   profiles.whatsapp_number_access_mode
--   account_invitations.whatsapp_number_access_mode
--   conversations.whatsapp_number_id
--   messages.whatsapp_number_id
--   messages.message_origin
--   broadcasts.whatsapp_number_id
--   message_templates.waba_id

-- The pre-feature conversation invariant was one thread per workspace/contact.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON public.conversations(account_id, contact_id);

-- For an executable return to this snapshot, use:
--   supabase/rollbacks/049_contacts_number_filter.down.sql
--   supabase/rollbacks/048_whatsapp_number_access_and_sync.down.sql
--   supabase/rollbacks/047_whatsapp_number_attribution.down.sql
--   supabase/rollbacks/046_whatsapp_numbers.down.sql
