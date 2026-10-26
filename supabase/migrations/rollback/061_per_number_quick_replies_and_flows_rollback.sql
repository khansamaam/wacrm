-- Roll back migration 061.
--
-- Quick replies and flows become account-wide again: policies return to
-- their 017 / 035 definitions and the number columns drop. Rows are kept.

BEGIN;

DROP POLICY IF EXISTS quick_replies_select ON public.quick_replies;
DROP POLICY IF EXISTS quick_replies_insert ON public.quick_replies;
DROP POLICY IF EXISTS quick_replies_update ON public.quick_replies;
DROP POLICY IF EXISTS quick_replies_delete ON public.quick_replies;
CREATE POLICY quick_replies_select ON public.quick_replies FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY quick_replies_insert ON public.quick_replies FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY quick_replies_update ON public.quick_replies FOR UPDATE
  USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY quick_replies_delete ON public.quick_replies FOR DELETE
  USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS flows_select ON public.flows;
DROP POLICY IF EXISTS flows_insert ON public.flows;
DROP POLICY IF EXISTS flows_update ON public.flows;
DROP POLICY IF EXISTS flows_delete ON public.flows;
CREATE POLICY flows_select ON public.flows FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY flows_insert ON public.flows FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY flows_update ON public.flows FOR UPDATE USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY flows_delete ON public.flows FOR DELETE USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS flow_nodes_select ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_modify ON public.flow_nodes;
CREATE POLICY flow_nodes_select ON public.flow_nodes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.flows f WHERE f.id = flow_nodes.flow_id AND public.is_account_member(f.account_id))
);
CREATE POLICY flow_nodes_modify ON public.flow_nodes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.flows f WHERE f.id = flow_nodes.flow_id AND public.is_account_member(f.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.flows f WHERE f.id = flow_nodes.flow_id AND public.is_account_member(f.account_id, 'agent'))
);

DROP POLICY IF EXISTS flow_runs_select ON public.flow_runs;
CREATE POLICY flow_runs_select ON public.flow_runs FOR SELECT USING (public.is_account_member(account_id));

DROP INDEX IF EXISTS public.idx_quick_replies_account_number;
DROP INDEX IF EXISTS public.idx_flows_account_number_active;

ALTER TABLE public.quick_replies DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.flows DROP COLUMN IF EXISTS whatsapp_number_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
