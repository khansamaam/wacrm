-- ============================================================
-- Rollback for 043_invitation_only_workspace_signup.sql
--
-- Run this file manually before deploying application code from
-- before migration 043. It restores public signup behavior where
-- every new Auth user receives a personal workspace and owner role.
--
-- This is a behavioral rollback only. Users who already joined a
-- workspace through an invitation remain members of that workspace.
-- No existing user, profile, invitation, or workspace is deleted.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  full_name TEXT;
  account_id UUID;
BEGIN
  full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(full_name, ''), NEW.email, 'My account'),
    NEW.id
  )
  RETURNING id INTO account_id;

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
    account_id,
    'owner'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Preserve the exact pre-043 behavior: Auth user creation succeeds even
  -- if profile/workspace bootstrapping encounters an unexpected failure.
  RAISE WARNING
    'Failed to bootstrap account/profile for user %: %',
    NEW.id,
    SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

NOTIFY pgrst, 'reload schema';

COMMIT;
