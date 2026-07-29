-- ============================================================
-- 039_role_module_access.sql
--
-- Account-scoped top-level module visibility. Owners configure which
-- product areas Admin, Agent, and Viewer roles may open. Existing role
-- capabilities remain authoritative for actions inside an enabled module.
-- ============================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS module_access JSONB NOT NULL DEFAULT
  '{
    "admin": ["dashboard","inbox","notifications","contacts","pipelines","broadcasts","automations","flows","agents"],
    "agent": ["dashboard","inbox","notifications","contacts","pipelines","broadcasts","automations","flows","agents"],
    "viewer": ["dashboard","inbox","notifications","contacts","pipelines","broadcasts","automations","flows","agents"]
  }'::jsonb;

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_module_access_object;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_module_access_object
  CHECK (jsonb_typeof(module_access) = 'object');

-- accounts_update allows admin+ to rename/configure the account. Protect this
-- owner-only column even if an Admin bypasses the application endpoint and
-- sends a direct PostgREST update.
CREATE OR REPLACE FUNCTION public.protect_owner_module_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.module_access IS DISTINCT FROM OLD.module_access
     AND auth.role() <> 'service_role'
     AND auth.uid() IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'Only the account owner can change role module access'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.protect_owner_module_access() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.protect_owner_module_access() FROM PUBLIC;

DROP TRIGGER IF EXISTS protect_owner_module_access ON public.accounts;
CREATE TRIGGER protect_owner_module_access
  BEFORE UPDATE OF module_access ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.protect_owner_module_access();

-- Make the new column immediately visible to PostgREST/Supabase API queries.
NOTIFY pgrst, 'reload schema';
