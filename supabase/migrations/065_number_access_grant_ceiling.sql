BEGIN;

-- Grant ceiling for per-number access.
--
-- Until now any admin could give any member any level on any number, even
-- a number the admin can only view (or cannot see at all), and could raise
-- their own access the same way. From here on an admin who does not have
-- unrestricted access (Workspace Owner, or "all numbers") may only:
--   * give each number up to the level they hold on it themselves;
--   * keep levels a member already has (granted by someone allowed to);
--   * grant "all numbers" only to a member who already has it;
--   * not change their own number access.
-- Numbers the admin cannot see are left untouched on the member, so editing
-- a teammate never silently removes access the admin could not even see.
--
-- Owners and "all numbers" admins behave exactly as before.

-- Level the signed-in caller holds on a number: 'full', 'view' or NULL.
CREATE OR REPLACE FUNCTION public.caller_whatsapp_number_level(target_number_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p.account_role = 'owner' OR p.whatsapp_number_access_mode = 'all' THEN 'full'
    ELSE (
      SELECT wnm.access_level FROM public.whatsapp_number_members wnm
      WHERE wnm.whatsapp_number_id = wn.id AND wnm.user_id = p.user_id
    )
  END
  FROM public.whatsapp_numbers wn
  JOIN public.profiles p
    ON p.account_id = wn.account_id
   AND p.user_id = auth.uid()
  WHERE wn.id = target_number_id;
$$;

ALTER FUNCTION public.caller_whatsapp_number_level(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.caller_whatsapp_number_level(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_whatsapp_number_level(UUID)
  TO authenticated, service_role;

-- True when the caller is the Workspace Owner or has every number.
CREATE OR REPLACE FUNCTION public.caller_has_all_whatsapp_numbers()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p.account_role = 'owner' OR p.whatsapp_number_access_mode = 'all'
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
  ), false);
$$;

ALTER FUNCTION public.caller_has_all_whatsapp_numbers() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.caller_has_all_whatsapp_numbers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_has_all_whatsapp_numbers()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_access_rank(level TEXT)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE level WHEN 'full' THEN 2 WHEN 'view' THEN 1 ELSE 0 END;
$$;

-- 059's member update, plus the ceiling. Validation is unchanged.
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
  v_target_mode TEXT;
  v_unrestricted BOOLEAN;
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

  SELECT account_role, whatsapp_number_access_mode
    INTO v_target_role, v_target_mode
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

  v_unrestricted := public.caller_has_all_whatsapp_numbers();

  IF NOT v_unrestricted THEN
    IF p_user_id = v_caller_id THEN
      RAISE EXCEPTION 'You cannot change your own WhatsApp number access'
        USING ERRCODE = '42501';
    END IF;
    IF p_access_mode = 'all' AND v_target_mode IS DISTINCT FROM 'all' THEN
      RAISE EXCEPTION 'Only members with access to all WhatsApp numbers can grant access to all numbers'
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_invalid_count
    FROM jsonb_array_elements(COALESCE(p_numbers, '[]'::JSONB)) item
    WHERE public.whatsapp_access_rank(item->>'level')
            > public.whatsapp_access_rank(
                public.caller_whatsapp_number_level((item->>'id')::UUID))
      AND public.whatsapp_access_rank(item->>'level')
            > public.whatsapp_access_rank(
                CASE WHEN v_target_mode = 'all' THEN 'full'
                ELSE (
                  SELECT wnm.access_level FROM public.whatsapp_number_members wnm
                  WHERE wnm.user_id = p_user_id
                    AND wnm.whatsapp_number_id = (item->>'id')::UUID
                ) END);
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'You can only give access up to your own level on each WhatsApp number'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.profiles
  SET whatsapp_number_access_mode = p_access_mode
  WHERE user_id = p_user_id;

  IF v_unrestricted THEN
    DELETE FROM public.whatsapp_number_members WHERE user_id = p_user_id;
  ELSE
    -- Only touch numbers the caller can see; keep the rest as they were.
    DELETE FROM public.whatsapp_number_members
    WHERE user_id = p_user_id
      AND public.caller_whatsapp_number_level(whatsapp_number_id) IS NOT NULL;
    IF p_access_mode = 'selected' AND v_target_mode = 'all' THEN
      -- Moving an "all numbers" member to a list: they keep full access to
      -- the numbers this caller cannot see.
      INSERT INTO public.whatsapp_number_members (
        whatsapp_number_id, user_id, account_id, created_by_user_id, access_level
      )
      SELECT wn.id, p_user_id, v_account_id, v_caller_id, 'full'
      FROM public.whatsapp_numbers wn
      WHERE wn.account_id = v_account_id
        AND public.caller_whatsapp_number_level(wn.id) IS NULL
      ON CONFLICT (whatsapp_number_id, user_id) DO NOTHING;
    END IF;
  END IF;

  IF p_access_mode = 'selected' THEN
    INSERT INTO public.whatsapp_number_members (
      whatsapp_number_id, user_id, account_id, created_by_user_id, access_level
    )
    SELECT DISTINCT ON ((item->>'id')::UUID)
      (item->>'id')::UUID, p_user_id, v_account_id, v_caller_id, item->>'level'
    FROM jsonb_array_elements(COALESCE(p_numbers, '[]'::JSONB)) item
    WHERE v_unrestricted
       OR public.caller_whatsapp_number_level((item->>'id')::UUID) IS NOT NULL
    ORDER BY (item->>'id')::UUID,
             CASE WHEN item->>'level' = 'full' THEN 0 ELSE 1 END
    ON CONFLICT (whatsapp_number_id, user_id) DO UPDATE
      SET access_level = EXCLUDED.access_level;
  ELSE
    DELETE FROM public.whatsapp_number_members WHERE user_id = p_user_id;
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_whatsapp_number_access_levels(UUID, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_whatsapp_number_access_levels(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_whatsapp_number_access_levels(UUID, TEXT, JSONB) TO authenticated;

-- The 048 RPC (full access for every listed number) goes through the same
-- checks instead of bypassing them.
CREATE OR REPLACE FUNCTION public.set_member_whatsapp_number_access(
  p_user_id UUID,
  p_access_mode TEXT,
  p_whatsapp_number_ids UUID[] DEFAULT ARRAY[]::UUID[]
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.set_member_whatsapp_number_access_levels(
    p_user_id,
    p_access_mode,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'level', 'full'))
      FROM unnest(COALESCE(p_whatsapp_number_ids, ARRAY[]::UUID[])) AS id
    ), '[]'::JSONB)
  );
END;
$$;

-- Member assignments are only written through the functions above (and the
-- invitation-acceptance trigger, which runs as its owner). The direct
-- browser write policy let any admin skip every check, so it goes.
DROP POLICY IF EXISTS whatsapp_number_members_modify ON public.whatsapp_number_members;

-- Invitations: the same ceiling on the access an invite link will give.
CREATE OR REPLACE FUNCTION public.enforce_invitation_number_access_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  -- Server-side jobs (no signed-in user) and unrestricted callers are exempt.
  IF auth.uid() IS NULL OR public.caller_has_all_whatsapp_numbers() THEN
    RETURN NEW;
  END IF;
  IF public.whatsapp_access_rank(NEW.access_level)
       > public.whatsapp_access_rank(
           public.caller_whatsapp_number_level(NEW.whatsapp_number_id)) THEN
    RAISE EXCEPTION 'You can only give access up to your own level on each WhatsApp number'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_invitation_number_access_ceiling
  ON public.whatsapp_invitation_number_access;
CREATE TRIGGER enforce_invitation_number_access_ceiling
  BEFORE INSERT OR UPDATE ON public.whatsapp_invitation_number_access
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invitation_number_access_ceiling();

CREATE OR REPLACE FUNCTION public.enforce_invitation_access_mode_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.whatsapp_number_access_mode = 'all'
     AND (TG_OP = 'INSERT'
          OR NEW.whatsapp_number_access_mode IS DISTINCT FROM OLD.whatsapp_number_access_mode)
     AND auth.uid() IS NOT NULL
     AND NOT public.caller_has_all_whatsapp_numbers() THEN
    RAISE EXCEPTION 'Only members with access to all WhatsApp numbers can invite with access to all numbers'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_invitation_access_mode_ceiling
  ON public.account_invitations;
CREATE TRIGGER enforce_invitation_access_mode_ceiling
  BEFORE INSERT OR UPDATE OF whatsapp_number_access_mode
  ON public.account_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invitation_access_mode_ceiling();

NOTIFY pgrst, 'reload schema';

COMMIT;
