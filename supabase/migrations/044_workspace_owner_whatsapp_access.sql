-- ============================================================
-- 044_workspace_owner_whatsapp_access.sql
--
-- Restricts WhatsApp connection changes to the Workspace Owner.
--
-- The SELECT policy intentionally remains account-member scoped.
-- Authenticated messaging routes use the account-scoped Supabase
-- client to read this configuration when sending messages. The
-- application API separately restricts configuration display and
-- diagnostics to the Workspace Owner.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS whatsapp_config_insert ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON public.whatsapp_config;

CREATE POLICY whatsapp_config_insert
  ON public.whatsapp_config
  FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'owner'));

CREATE POLICY whatsapp_config_update
  ON public.whatsapp_config
  FOR UPDATE
  USING (public.is_account_member(account_id, 'owner'))
  WITH CHECK (public.is_account_member(account_id, 'owner'));

CREATE POLICY whatsapp_config_delete
  ON public.whatsapp_config
  FOR DELETE
  USING (public.is_account_member(account_id, 'owner'));

NOTIFY pgrst, 'reload schema';

COMMIT;
