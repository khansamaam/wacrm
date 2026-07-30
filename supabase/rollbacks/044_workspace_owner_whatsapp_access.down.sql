-- ============================================================
-- Rollback for 044_workspace_owner_whatsapp_access.sql
--
-- Run manually before deploying application code from before
-- migration 044. This restores WhatsApp configuration mutations
-- for both Admins and Workspace Owners.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS whatsapp_config_insert ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON public.whatsapp_config;

CREATE POLICY whatsapp_config_insert
  ON public.whatsapp_config
  FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));

CREATE POLICY whatsapp_config_update
  ON public.whatsapp_config
  FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'));

CREATE POLICY whatsapp_config_delete
  ON public.whatsapp_config
  FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

NOTIFY pgrst, 'reload schema';

COMMIT;
