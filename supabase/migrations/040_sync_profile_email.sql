-- ============================================================
-- 040_sync_profile_email.sql
--
-- Keep the application profile email aligned with the canonical email in
-- Supabase Auth after a verified email-change flow completes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET
      email = NEW.email,
      updated_at = NOW()
    WHERE user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_profile_email_from_auth() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- Repair profiles that became stale before this trigger was installed.
UPDATE public.profiles AS profile
SET
  email = auth_user.email,
  updated_at = NOW()
FROM auth.users AS auth_user
WHERE profile.user_id = auth_user.id
  AND profile.email IS DISTINCT FROM auth_user.email;

