-- Manual rollback for migration 048.
-- Refuses to erase selected assignments or coexistence event/sync history.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE whatsapp_number_access_mode = 'selected'
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_number_members
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_invitation_number_access
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_webhook_events
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_sync_jobs
  ) THEN
    RAISE EXCEPTION
      'Rollback 048 stopped: number assignments or coexistence sync data exists. Keep the additive schema, or archive the affected rows before destructive rollback.';
  END IF;
END;
$$;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
DROP POLICY IF EXISTS conversations_insert ON public.conversations;
DROP POLICY IF EXISTS conversations_update ON public.conversations;
DROP POLICY IF EXISTS conversations_delete ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY conversations_insert ON public.conversations FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY conversations_update ON public.conversations FOR UPDATE
  USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY conversations_delete ON public.conversations FOR DELETE
  USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_modify ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id))
);
CREATE POLICY messages_modify ON public.messages FOR ALL USING (
  EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent'))
);

DROP POLICY IF EXISTS broadcasts_select ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_insert ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON public.broadcasts;
CREATE POLICY broadcasts_select ON public.broadcasts FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY broadcasts_insert ON public.broadcasts FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY broadcasts_update ON public.broadcasts FOR UPDATE
  USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY broadcasts_delete ON public.broadcasts FOR DELETE
  USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS message_templates_select ON public.message_templates;
DROP POLICY IF EXISTS message_templates_insert ON public.message_templates;
DROP POLICY IF EXISTS message_templates_update ON public.message_templates;
DROP POLICY IF EXISTS message_templates_delete ON public.message_templates;
CREATE POLICY message_templates_select ON public.message_templates FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY message_templates_insert ON public.message_templates FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY message_templates_update ON public.message_templates FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY message_templates_delete ON public.message_templates FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_numbers_select ON public.whatsapp_numbers;
CREATE POLICY whatsapp_numbers_select ON public.whatsapp_numbers FOR SELECT
  USING (public.is_account_member(account_id));

DROP TRIGGER IF EXISTS apply_invitation_whatsapp_number_access
  ON public.account_invitations;
DROP FUNCTION IF EXISTS public.apply_invitation_whatsapp_number_access();
DROP FUNCTION IF EXISTS public.set_member_whatsapp_number_access(UUID, TEXT, UUID[]);
DROP FUNCTION IF EXISTS public.has_whatsapp_number_access(UUID);
DROP TRIGGER IF EXISTS validate_whatsapp_number_assignment
  ON public.whatsapp_number_members;
DROP FUNCTION IF EXISTS public.validate_whatsapp_number_assignment();

DROP TABLE IF EXISTS public.whatsapp_sync_jobs;
DROP TABLE IF EXISTS public.whatsapp_webhook_events;
DROP TABLE IF EXISTS public.whatsapp_invitation_number_access;
DROP TABLE IF EXISTS public.whatsapp_number_members;

ALTER TABLE public.account_invitations
  DROP COLUMN IF EXISTS whatsapp_number_access_mode;
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS whatsapp_number_access_mode;

-- Restore the pre-048 privilege guard exactly.
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'account_role and account_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
