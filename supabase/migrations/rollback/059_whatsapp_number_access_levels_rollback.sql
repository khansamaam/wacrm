-- Roll back migration 059.
--
-- Restores the 048 write policies (any number access may write), the 048
-- invitation trigger body, and drops the level columns and helpers.
-- Members who had 'view' on a number end up with full access to it, which
-- is exactly the pre-059 behaviour for a selected number.

BEGIN;

DROP POLICY IF EXISTS conversations_insert ON public.conversations;
DROP POLICY IF EXISTS conversations_update ON public.conversations;
DROP POLICY IF EXISTS conversations_delete ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY conversations_update ON public.conversations FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY conversations_delete ON public.conversations FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));

DROP POLICY IF EXISTS messages_modify ON public.messages;
CREATE POLICY messages_modify ON public.messages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(c.whatsapp_number_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(c.whatsapp_number_id))
  ));

DROP POLICY IF EXISTS broadcasts_insert ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON public.broadcasts;
CREATE POLICY broadcasts_insert ON public.broadcasts FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY broadcasts_update ON public.broadcasts FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY broadcasts_delete ON public.broadcasts FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));

CREATE OR REPLACE FUNCTION public.apply_invitation_whatsapp_number_access()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.accepted_at IS NULL OR NEW.accepted_by_user_id IS NULL
     OR OLD.accepted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.profiles
  SET whatsapp_number_access_mode = NEW.whatsapp_number_access_mode
  WHERE user_id = NEW.accepted_by_user_id
    AND account_id = NEW.account_id;

  DELETE FROM public.whatsapp_number_members
  WHERE user_id = NEW.accepted_by_user_id;

  IF NEW.whatsapp_number_access_mode = 'selected' THEN
    INSERT INTO public.whatsapp_number_members (
      whatsapp_number_id, user_id, account_id, created_by_user_id
    )
    SELECT ina.whatsapp_number_id, NEW.accepted_by_user_id,
           NEW.account_id, NEW.created_by_user_id
    FROM public.whatsapp_invitation_number_access ina
    JOIN public.whatsapp_numbers wn ON wn.id = ina.whatsapp_number_id
    WHERE ina.invitation_id = NEW.id
      AND wn.account_id = NEW.account_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.set_member_whatsapp_number_access_levels(UUID, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.has_whatsapp_number_write_access(UUID);

ALTER TABLE public.whatsapp_invitation_number_access
  DROP CONSTRAINT IF EXISTS whatsapp_invitation_number_access_level_check,
  DROP COLUMN IF EXISTS access_level;
ALTER TABLE public.whatsapp_number_members
  DROP CONSTRAINT IF EXISTS whatsapp_number_members_access_level_check,
  DROP COLUMN IF EXISTS access_level;

NOTIFY pgrst, 'reload schema';

COMMIT;
