-- ============================================================
-- Affected-schema snapshot for base commit e3d6618
-- Captured before migration 044.
--
-- This file contains the complete pre-044 RLS policy set for
-- public.whatsapp_config. It is a schema reference snapshot;
-- use the paired rollback file to reverse migration 044.
-- ============================================================

DROP POLICY IF EXISTS whatsapp_config_select ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_insert ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON public.whatsapp_config;

CREATE POLICY whatsapp_config_select
  ON public.whatsapp_config
  FOR SELECT
  USING (public.is_account_member(account_id));

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
