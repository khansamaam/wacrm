BEGIN;

-- Per-number access LEVELS for members and invitations.
--
-- Migration 048 gave each member either access to all numbers or to a
-- selected list. This adds a level per selected number:
--   * 'view' — can read the number's conversations, messages and
--              broadcasts, but cannot reply, assign, close or broadcast.
--   * 'full' — read and write (previous behaviour for every assignment).
-- No row = no access (unchanged). Owners and 'all'-mode members keep full
-- access to every number. Account roles still apply on top: a workspace
-- 'viewer' stays read-only everywhere.
--
-- Backward compatible: existing assignments default to 'full', the 048
-- read helper and RPC keep working, and only write policies change from
-- has_whatsapp_number_access() to has_whatsapp_number_write_access().

ALTER TABLE public.whatsapp_number_members
  ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'full';
ALTER TABLE public.whatsapp_invitation_number_access
  ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_number_members_access_level_check'
      AND conrelid = 'public.whatsapp_number_members'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_number_members
      ADD CONSTRAINT whatsapp_number_members_access_level_check
      CHECK (access_level IN ('view', 'full'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_invitation_number_access_level_check'
      AND conrelid = 'public.whatsapp_invitation_number_access'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_invitation_number_access
      ADD CONSTRAINT whatsapp_invitation_number_access_level_check
      CHECK (access_level IN ('view', 'full'));
  END IF;
END $$;

-- Write counterpart of has_whatsapp_number_access(): owners, 'all'-mode
-- members, or a 'full' assignment.
CREATE OR REPLACE FUNCTION public.has_whatsapp_number_write_access(target_number_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.whatsapp_numbers wn
    JOIN public.profiles p
      ON p.account_id = wn.account_id
     AND p.user_id = auth.uid()
    WHERE wn.id = target_number_id
      AND (
        p.account_role = 'owner'
        OR p.whatsapp_number_access_mode = 'all'
        OR EXISTS (
          SELECT 1 FROM public.whatsapp_number_members wnm
          WHERE wnm.whatsapp_number_id = wn.id
            AND wnm.user_id = p.user_id
            AND wnm.access_level = 'full'
        )
      )
  );
$$;

ALTER FUNCTION public.has_whatsapp_number_write_access(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_whatsapp_number_write_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_whatsapp_number_write_access(UUID)
  TO authenticated, service_role;

-- Atomic member update with levels. p_numbers is a JSON array of
-- {"id": "<number uuid>", "level": "view" | "full"}; ignored for 'all'.
CREATE OR REPLACE FUNCTION public.set_member_whatsapp_number_access_levels(
  p_user_id UUID,
  p_access_mode TEXT,
  p_numbers JSONB DEFAULT '[]'::JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_account_id UUID;
  v_target_role public.account_role_enum;
  v_invalid_count INTEGER;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_access_mode NOT IN ('all', 'selected') THEN
    RAISE EXCEPTION 'Access mode must be all or selected' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_numbers, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Numbers must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM public.profiles
  WHERE user_id = v_caller_id
    AND account_role IN ('owner', 'admin');
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT account_role INTO v_target_role
  FROM public.profiles
  WHERE user_id = p_user_id AND account_id = v_account_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Member not found in this workspace' USING ERRCODE = '22023';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Workspace Owner number access cannot be restricted'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_invalid_count
  FROM jsonb_array_elements(COALESCE(p_numbers, '[]'::JSONB)) item
  WHERE (item->>'level') IS NULL
     OR (item->>'level') NOT IN ('view', 'full')
     OR (item->>'id') IS NULL
     OR (item->>'id') !~* '^[0-9a-f-]{36}$'
     OR NOT EXISTS (
       -- Compared as text so a malformed id can never raise a cast error
       -- (SQL does not guarantee OR short-circuiting).
       SELECT 1 FROM public.whatsapp_numbers wn
       WHERE wn.id::TEXT = lower(item->>'id') AND wn.account_id = v_account_id
     );
  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Invalid WhatsApp number access list'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET whatsapp_number_access_mode = p_access_mode
  WHERE user_id = p_user_id;

  DELETE FROM public.whatsapp_number_members WHERE user_id = p_user_id;
  IF p_access_mode = 'selected' THEN
    INSERT INTO public.whatsapp_number_members (
      whatsapp_number_id, user_id, account_id, created_by_user_id, access_level
    )
    SELECT DISTINCT ON ((item->>'id')::UUID)
      (item->>'id')::UUID, p_user_id, v_account_id, v_caller_id, item->>'level'
    FROM jsonb_array_elements(COALESCE(p_numbers, '[]'::JSONB)) item
    ORDER BY (item->>'id')::UUID,
             CASE WHEN item->>'level' = 'full' THEN 0 ELSE 1 END;
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_whatsapp_number_access_levels(UUID, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_whatsapp_number_access_levels(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_whatsapp_number_access_levels(UUID, TEXT, JSONB) TO authenticated;

-- Invitation acceptance now copies the level as well (048 body + level).
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
      whatsapp_number_id, user_id, account_id, created_by_user_id, access_level
    )
    SELECT ina.whatsapp_number_id, NEW.accepted_by_user_id,
           NEW.account_id, NEW.created_by_user_id, ina.access_level
    FROM public.whatsapp_invitation_number_access ina
    JOIN public.whatsapp_numbers wn ON wn.id = ina.whatsapp_number_id
    WHERE ina.invitation_id = NEW.id
      AND wn.account_id = NEW.account_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Write policies: same shape as 048, write helper instead of read helper.
DROP POLICY IF EXISTS conversations_insert ON public.conversations;
DROP POLICY IF EXISTS conversations_update ON public.conversations;
DROP POLICY IF EXISTS conversations_delete ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY conversations_update ON public.conversations FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY conversations_delete ON public.conversations FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS messages_modify ON public.messages;
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

DROP POLICY IF EXISTS broadcasts_insert ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON public.broadcasts;
CREATE POLICY broadcasts_insert ON public.broadcasts FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY broadcasts_update ON public.broadcasts FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY broadcasts_delete ON public.broadcasts FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

NOTIFY pgrst, 'reload schema';

COMMIT;
