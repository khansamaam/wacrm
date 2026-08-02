-- Per-member number assignments plus durable coexistence webhook/sync state.
-- Existing members and pending invitations retain `all` access. New invite
-- flows may choose `selected` and attach specific number ids.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_number_access_mode TEXT NOT NULL DEFAULT 'all'
  CHECK (whatsapp_number_access_mode IN ('all', 'selected'));

ALTER TABLE public.account_invitations
  ADD COLUMN IF NOT EXISTS whatsapp_number_access_mode TEXT NOT NULL DEFAULT 'all'
  CHECK (whatsapp_number_access_mode IN ('all', 'selected'));

CREATE TABLE IF NOT EXISTS public.whatsapp_number_members (
  whatsapp_number_id UUID NOT NULL
    REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (whatsapp_number_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_number_members_user
  ON public.whatsapp_number_members(user_id, account_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_invitation_number_access (
  invitation_id UUID NOT NULL
    REFERENCES public.account_invitations(id) ON DELETE CASCADE,
  whatsapp_number_id UUID NOT NULL
    REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invitation_id, whatsapp_number_id)
);

-- SECURITY DEFINER avoids recursive RLS checks when a conversation policy
-- asks whether its number is visible to the current user.
CREATE OR REPLACE FUNCTION public.has_whatsapp_number_access(target_number_id UUID)
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
        )
      )
  );
$$;

ALTER FUNCTION public.has_whatsapp_number_access(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.has_whatsapp_number_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_whatsapp_number_access(UUID)
  TO authenticated, service_role;

-- Validate account consistency even for service-role/API writes.
CREATE OR REPLACE FUNCTION public.validate_whatsapp_number_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_number_account UUID;
  v_user_account UUID;
BEGIN
  SELECT account_id INTO v_number_account
  FROM public.whatsapp_numbers WHERE id = NEW.whatsapp_number_id;
  SELECT account_id INTO v_user_account
  FROM public.profiles WHERE user_id = NEW.user_id;

  IF v_number_account IS NULL OR v_user_account IS NULL
     OR v_number_account <> NEW.account_id
     OR v_user_account <> NEW.account_id THEN
    RAISE EXCEPTION 'WhatsApp number assignment crosses workspace boundaries'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_whatsapp_number_assignment
  ON public.whatsapp_number_members;
CREATE TRIGGER validate_whatsapp_number_assignment
  BEFORE INSERT OR UPDATE ON public.whatsapp_number_members
  FOR EACH ROW EXECUTE FUNCTION public.validate_whatsapp_number_assignment();

-- One atomic authorization boundary for member assignment changes. Admins
-- may manage teammates; Workspace Owners always retain unrestricted access.
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

ALTER FUNCTION public.set_member_whatsapp_number_access(UUID, TEXT, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_whatsapp_number_access(UUID, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_whatsapp_number_access(UUID, TEXT, UUID[]) TO authenticated;

-- Invitation acceptance already has two paths (new-user trigger and existing
-- user RPC). Applying number access when the invitation is marked accepted
-- keeps both paths consistent without duplicating security logic.
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

DROP TRIGGER IF EXISTS apply_invitation_whatsapp_number_access
  ON public.account_invitations;
CREATE TRIGGER apply_invitation_whatsapp_number_access
  AFTER UPDATE OF accepted_at, accepted_by_user_id
  ON public.account_invitations
  FOR EACH ROW EXECUTE FUNCTION public.apply_invitation_whatsapp_number_access();

-- Extend the existing privilege-column guard so agents cannot change their
-- own number_access_mode through the browser's direct Supabase client.
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.whatsapp_number_access_mode IS DISTINCT FROM OLD.whatsapp_number_access_mode)
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'Membership and WhatsApp number access cannot be changed directly; use the account management APIs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- Durable raw event receipt and async sync tracking. The webhook stores large
-- history payloads here before a worker processes them, avoiding request-time
-- loss and allowing idempotent retries/out-of-order chunks.
CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whatsapp_number_id UUID NOT NULL REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE (whatsapp_number_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_events_pending
  ON public.whatsapp_webhook_events(status, received_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS public.whatsapp_sync_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whatsapp_number_id UUID NOT NULL REFERENCES public.whatsapp_numbers(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('history', 'contacts', 'app_state')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  cursor TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sync_jobs_number_status
  ON public.whatsapp_sync_jobs(whatsapp_number_id, status, requested_at);

ALTER TABLE public.whatsapp_number_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_invitation_number_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_number_members_select ON public.whatsapp_number_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_number_members_modify ON public.whatsapp_number_members FOR ALL
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

CREATE POLICY whatsapp_invitation_number_access_select
  ON public.whatsapp_invitation_number_access FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.account_invitations ai
    WHERE ai.id = whatsapp_invitation_number_access.invitation_id
      AND public.is_account_member(ai.account_id, 'admin')
  ));
CREATE POLICY whatsapp_invitation_number_access_modify
  ON public.whatsapp_invitation_number_access FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.account_invitations ai
    WHERE ai.id = whatsapp_invitation_number_access.invitation_id
      AND public.is_account_member(ai.account_id, 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.account_invitations ai
    JOIN public.whatsapp_numbers wn
      ON wn.id = whatsapp_invitation_number_access.whatsapp_number_id
    WHERE ai.id = whatsapp_invitation_number_access.invitation_id
      AND wn.account_id = ai.account_id
      AND public.is_account_member(ai.account_id, 'admin')
  ));

CREATE POLICY whatsapp_webhook_events_owner_select ON public.whatsapp_webhook_events FOR SELECT
  USING (public.is_account_member(account_id, 'owner'));
CREATE POLICY whatsapp_sync_jobs_owner_select ON public.whatsapp_sync_jobs FOR SELECT
  USING (public.is_account_member(account_id, 'owner'));

-- Tighten number-bearing records at the database boundary. NULL number ids
-- remain readable for legacy/orphan rows; connected records require access.
DROP POLICY IF EXISTS whatsapp_numbers_select ON public.whatsapp_numbers;
CREATE POLICY whatsapp_numbers_select ON public.whatsapp_numbers FOR SELECT
  USING (public.has_whatsapp_number_access(id));

DROP POLICY IF EXISTS conversations_select ON public.conversations;
DROP POLICY IF EXISTS conversations_insert ON public.conversations;
DROP POLICY IF EXISTS conversations_update ON public.conversations;
DROP POLICY IF EXISTS conversations_delete ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY conversations_insert ON public.conversations FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY conversations_update ON public.conversations FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY conversations_delete ON public.conversations FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));

DROP POLICY IF EXISTS messages_select ON public.messages;
DROP POLICY IF EXISTS messages_modify ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id)
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(c.whatsapp_number_id))
  ));
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

DROP POLICY IF EXISTS broadcasts_select ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_insert ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON public.broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON public.broadcasts;
CREATE POLICY broadcasts_select ON public.broadcasts FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY broadcasts_insert ON public.broadcasts FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY broadcasts_update ON public.broadcasts FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY broadcasts_delete ON public.broadcasts FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));

DROP POLICY IF EXISTS message_templates_select ON public.message_templates;
DROP POLICY IF EXISTS message_templates_insert ON public.message_templates;
DROP POLICY IF EXISTS message_templates_update ON public.message_templates;
DROP POLICY IF EXISTS message_templates_delete ON public.message_templates;
CREATE POLICY message_templates_select ON public.message_templates FOR SELECT
  USING (public.is_account_member(account_id)
    AND (waba_id IS NULL OR EXISTS (
      SELECT 1 FROM public.whatsapp_numbers wn
      WHERE wn.account_id = message_templates.account_id
        AND wn.waba_id = message_templates.waba_id
        AND public.has_whatsapp_number_access(wn.id)
    )));
CREATE POLICY message_templates_insert ON public.message_templates FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin')
    AND (waba_id IS NULL OR EXISTS (
      SELECT 1 FROM public.whatsapp_numbers wn
      WHERE wn.account_id = message_templates.account_id
        AND wn.waba_id = message_templates.waba_id
        AND public.has_whatsapp_number_access(wn.id)
    )));
CREATE POLICY message_templates_update ON public.message_templates FOR UPDATE
  USING (public.is_account_member(account_id, 'admin')
    AND (waba_id IS NULL OR EXISTS (
      SELECT 1 FROM public.whatsapp_numbers wn
      WHERE wn.account_id = message_templates.account_id
        AND wn.waba_id = message_templates.waba_id
        AND public.has_whatsapp_number_access(wn.id)
    )));
CREATE POLICY message_templates_delete ON public.message_templates FOR DELETE
  USING (public.is_account_member(account_id, 'admin')
    AND (waba_id IS NULL OR EXISTS (
      SELECT 1 FROM public.whatsapp_numbers wn
      WHERE wn.account_id = message_templates.account_id
        AND wn.waba_id = message_templates.waba_id
        AND public.has_whatsapp_number_access(wn.id)
    )));

NOTIFY pgrst, 'reload schema';
COMMIT;
