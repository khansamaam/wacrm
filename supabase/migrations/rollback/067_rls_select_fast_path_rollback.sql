-- Rollback for 067_rls_select_fast_path.sql: restores the 048/059/060
-- policy definitions verbatim and drops the helper functions.
BEGIN;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));

DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id)
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(c.whatsapp_number_id))
  ));

DROP POLICY IF EXISTS messages_insert ON public.messages;
DROP POLICY IF EXISTS messages_update ON public.messages;
DROP POLICY IF EXISTS messages_delete ON public.messages;
CREATE POLICY messages_modify ON public.messages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id))
  ));

DROP FUNCTION IF EXISTS public.caller_readable_number_ids();
DROP FUNCTION IF EXISTS public.caller_viewer_account_id();

NOTIFY pgrst, 'reload schema';

COMMIT;
