-- ============================================================
-- 043_invitation_only_workspace_signup.sql
--
-- Public registration is disabled at the database boundary.
-- A new Auth user must present the hash of a valid, unused
-- workspace invitation in raw_user_meta_data. The user is added
-- directly to that workspace, so signup never creates a temporary
-- personal account or grants the owner role.
--
-- Existing authenticated users continue to join workspaces using
-- redeem_invitation() from migration 019.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invitation_hash TEXT;
  invitation public.account_invitations%ROWTYPE;
  full_name TEXT;
BEGIN
  invitation_hash := NEW.raw_user_meta_data->>'invite_token_hash';
  full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  IF invitation_hash IS NULL OR invitation_hash = '' THEN
    RAISE EXCEPTION
      'Public registration is disabled; a valid workspace invitation is required'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the invitation so concurrent signup attempts cannot both consume it.
  SELECT *
  INTO invitation
  FROM public.account_invitations
  WHERE token_hash = invitation_hash
    AND accepted_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Workspace invitation is invalid, expired, or already used'
      USING ERRCODE = '22023';
  END IF;

  -- Workspace invitations cannot grant owner by schema constraint. Keep a
  -- defensive check here in case legacy data was inserted outside the API.
  IF invitation.role = 'owner' THEN
    RAISE EXCEPTION
      'Workspace invitations cannot grant the owner role'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (
    user_id,
    full_name,
    email,
    account_id,
    account_role
  )
  VALUES (
    NEW.id,
    full_name,
    NEW.email,
    invitation.account_id,
    invitation.role
  );

  UPDATE public.account_invitations
  SET
    accepted_at = NOW(),
    accepted_by_user_id = NEW.id
  WHERE id = invitation.id;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

NOTIFY pgrst, 'reload schema';
