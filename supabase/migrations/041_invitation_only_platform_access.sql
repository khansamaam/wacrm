-- ============================================================
-- 041_invitation_only_platform_access.sql
--
-- Enforces the hosted product hierarchy:
--   platform Super Admin -> workspace Client Admin -> Agent / Viewer.
--
-- Public Auth signups are rejected at the database boundary. A new user
-- can only be bootstrapped when Supabase Admin created them with a valid
-- invitation hash in raw_user_meta_data.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- A workspace may exist briefly without a Client Admin while its initial
-- email invitation is pending.
ALTER TABLE public.accounts
  ALTER COLUMN owner_user_id DROP NOT NULL;

ALTER TABLE public.account_invitations
  DROP CONSTRAINT IF EXISTS account_invitations_role_check;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admins_select_self ON public.platform_admins;
CREATE POLICY platform_admins_select_self
  ON public.platform_admins
  FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_platform_admin(
  target_user_id UUID DEFAULT auth.uid()
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = target_user_id
  );
$$;

ALTER FUNCTION public.is_platform_admin(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_platform_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID)
  TO authenticated, service_role;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_access_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_access_status_check
  CHECK (access_status IN ('active', 'pending', 'removed'));

CREATE INDEX IF NOT EXISTS idx_profiles_account_access
  ON public.profiles(account_id, access_status);

ALTER TABLE public.account_invitations
  ADD COLUMN IF NOT EXISTS invitee_email TEXT;

CREATE INDEX IF NOT EXISTS idx_account_invitations_invitee_email
  ON public.account_invitations(LOWER(invitee_email))
  WHERE accepted_at IS NULL;

-- Removed and not-yet-accepted users are not workspace members. Keeping
-- their profile row allows a later invitation to reactivate the same login.
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid()
      AND profile.account_id = target_account_id
      AND profile.access_status = 'active'
      AND CASE profile.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION public.is_account_member(UUID, account_role_enum)
  OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum)
  TO authenticated, service_role;

-- Supabase Admin includes the invitation hash when it creates an invited
-- Auth user. Any direct signUp() call lacks that server-controlled value
-- and the exception rolls back the auth.users insert.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
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
    RAISE EXCEPTION 'Public registration is disabled; a valid invitation is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO invitation
  FROM public.account_invitations
  WHERE token_hash = invitation_hash
    AND accepted_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation is invalid, expired, or already used'
      USING ERRCODE = '22023';
  END IF;

  IF invitation.invitee_email IS NULL
     OR LOWER(invitation.invitee_email) <> LOWER(NEW.email) THEN
    RAISE EXCEPTION 'Invitation email does not match the new account'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (
    user_id,
    full_name,
    email,
    account_id,
    account_role,
    access_status
  )
  VALUES (
    NEW.id,
    full_name,
    NEW.email,
    invitation.account_id,
    invitation.role,
    'pending'
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Redeeming an invitation activates a pending/removed profile. Active
-- users cannot move between client workspaces in this single-membership
-- model.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id UUID := auth.uid();
  caller_email TEXT;
  invitation public.account_invitations%ROWTYPE;
  profile_row public.profiles%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO caller_email
  FROM auth.users
  WHERE id = caller_id;

  SELECT *
  INTO invitation
  FROM public.account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF invitation.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF invitation.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;
  IF invitation.invitee_email IS NOT NULL
     AND LOWER(invitation.invitee_email) <> LOWER(caller_email) THEN
    RAISE EXCEPTION 'Sign in with the email address this invitation was sent to'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO profile_row
  FROM public.profiles
  WHERE user_id = caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This login was not created through an invitation'
      USING ERRCODE = '42501';
  END IF;

  IF profile_row.access_status = 'active' THEN
    RAISE EXCEPTION 'This login already belongs to an active workspace'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.profiles
  SET
    account_id = invitation.account_id,
    account_role = invitation.role,
    access_status = 'active',
    updated_at = NOW()
  WHERE user_id = caller_id;

  IF invitation.role = 'owner' THEN
    UPDATE public.accounts
    SET owner_user_id = caller_id
    WHERE id = invitation.account_id
      AND (owner_user_id IS NULL OR owner_user_id = caller_id);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This workspace already has a Client Admin'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.account_invitations
  SET
    accepted_at = NOW(),
    accepted_by_user_id = caller_id
  WHERE id = invitation.id;

  RETURN invitation.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- Removing a member revokes workspace access without creating a new owner
-- workspace. The same Auth login may later be reactivated by a fresh invite.
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_account_id UUID;
  caller_role account_role_enum;
  target_account_id UUID;
  target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO caller_account_id, caller_role
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND access_status = 'active';

  IF caller_role <> 'owner' THEN
    RAISE EXCEPTION 'This action requires Client Admin access'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO target_account_id, target_role
  FROM public.profiles
  WHERE user_id = p_user_id
    AND access_status = 'active';

  IF target_account_id IS NULL OR target_account_id <> caller_account_id THEN
    RAISE EXCEPTION 'Target user is not an active member of your workspace'
      USING ERRCODE = '42501';
  END IF;
  IF target_role = 'owner' THEN
    RAISE EXCEPTION 'The Client Admin cannot be removed here'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET
    account_role = 'viewer',
    access_status = 'removed',
    updated_at = NOW()
  WHERE user_id = p_user_id;

  RETURN caller_account_id;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

-- Workspace administrators can assign operational roles only. Platform
-- Super Admins retain an escape hatch for controlled support migrations.
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_account_id UUID;
  caller_role account_role_enum;
  target_account_id UUID;
  target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO caller_account_id, caller_role
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND access_status = 'active';

  IF caller_role <> 'owner' THEN
    RAISE EXCEPTION 'This action requires Client Admin access'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO target_account_id, target_role
  FROM public.profiles
  WHERE user_id = p_user_id
    AND access_status = 'active';

  IF target_account_id IS NULL OR target_account_id <> caller_account_id THEN
    RAISE EXCEPTION 'Target user is not an active member of your workspace'
      USING ERRCODE = '42501';
  END IF;
  IF target_role = 'owner' OR p_new_role = 'owner' THEN
    RAISE EXCEPTION 'The Client Admin role cannot be assigned here'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'admin' AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Client Admins may assign only Agent or Viewer roles'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET
    account_role = p_new_role,
    updated_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum)
  TO authenticated;

-- All workspace members may inspect connection health, but only the
-- platform Super Admin may connect, rotate, or disconnect credentials.
DROP POLICY IF EXISTS whatsapp_config_insert ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON public.whatsapp_config;

CREATE POLICY whatsapp_config_insert
  ON public.whatsapp_config
  FOR INSERT
  WITH CHECK (public.is_platform_admin());

CREATE POLICY whatsapp_config_update
  ON public.whatsapp_config
  FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY whatsapp_config_delete
  ON public.whatsapp_config
  FOR DELETE
  USING (public.is_platform_admin());

-- Client Admin is represented by the existing owner role. Legacy workspace
-- Admins remain readable for compatibility but cannot manage memberships or
-- issue invitations.
DROP POLICY IF EXISTS account_invitations_select
  ON public.account_invitations;
DROP POLICY IF EXISTS account_invitations_modify
  ON public.account_invitations;

CREATE POLICY account_invitations_select
  ON public.account_invitations
  FOR SELECT
  USING (public.is_account_member(account_id, 'owner'));

CREATE POLICY account_invitations_modify
  ON public.account_invitations
  FOR ALL
  USING (public.is_account_member(account_id, 'owner'))
  WITH CHECK (public.is_account_member(account_id, 'owner'));

NOTIFY pgrst, 'reload schema';
