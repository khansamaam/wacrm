-- Roll back migration 065: restores the 059 member-access function (no
-- grant ceiling), the 048 function body, and the direct write policy.

BEGIN;

DROP TRIGGER IF EXISTS enforce_invitation_access_mode_ceiling ON public.account_invitations;
DROP FUNCTION IF EXISTS public.enforce_invitation_access_mode_ceiling();
DROP TRIGGER IF EXISTS enforce_invitation_number_access_ceiling ON public.whatsapp_invitation_number_access;
DROP FUNCTION IF EXISTS public.enforce_invitation_number_access_ceiling();

DROP POLICY IF EXISTS whatsapp_number_members_modify ON public.whatsapp_number_members;
CREATE POLICY whatsapp_number_members_modify ON public.whatsapp_number_members FOR ALL
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Function bodies exactly as in 059 and 048.
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

CREATE OR REPLACE FUNCTION public.set_member_whatsapp_number_access(
  p_user_id UUID,
  p_access_mode TEXT,
  p_whatsapp_number_ids UUID[] DEFAULT ARRAY[]::UUID[]
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
  FROM unnest(COALESCE(p_whatsapp_number_ids, ARRAY[]::UUID[])) requested(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.whatsapp_numbers wn
    WHERE wn.id = requested.id AND wn.account_id = v_account_id
  );
  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'One or more WhatsApp numbers do not belong to this workspace'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET whatsapp_number_access_mode = p_access_mode
  WHERE user_id = p_user_id;

  DELETE FROM public.whatsapp_number_members WHERE user_id = p_user_id;
  IF p_access_mode = 'selected' THEN
    INSERT INTO public.whatsapp_number_members (
      whatsapp_number_id, user_id, account_id, created_by_user_id
    )
    SELECT DISTINCT id, p_user_id, v_account_id, v_caller_id
    FROM unnest(COALESCE(p_whatsapp_number_ids, ARRAY[]::UUID[])) ids(id);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_access_rank(TEXT);
DROP FUNCTION IF EXISTS public.caller_has_all_whatsapp_numbers();
DROP FUNCTION IF EXISTS public.caller_whatsapp_number_level(UUID);

NOTIFY pgrst, 'reload schema';

COMMIT;
