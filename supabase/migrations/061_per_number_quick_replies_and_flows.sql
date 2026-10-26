BEGIN;

-- Phase 3b: quick replies and flows become per WhatsApp number.
--
-- * whatsapp_number_id NULL = unscoped (accounts without numbers, legacy
--   rows): visible and usable on every number, exactly as before.
-- * Existing rows are assigned to the account's default number.
-- * A flow only starts for messages that arrive on its number; flow nodes,
--   runs and run events follow their flow.
-- * RLS: reads need access to the number, writes need write access.
--
-- Additive for the previous release, which keeps working on NULL rows.

ALTER TABLE public.quick_replies
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;

UPDATE public.quick_replies q
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE q.whatsapp_number_id IS NULL AND wn.account_id = q.account_id AND wn.is_default;

UPDATE public.flows f
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE f.whatsapp_number_id IS NULL AND wn.account_id = f.account_id AND wn.is_default;

CREATE INDEX IF NOT EXISTS idx_quick_replies_account_number
  ON public.quick_replies (account_id, whatsapp_number_id);
CREATE INDEX IF NOT EXISTS idx_flows_account_number_active
  ON public.flows (account_id, whatsapp_number_id)
  WHERE status = 'active';

-- quick_replies
DROP POLICY IF EXISTS quick_replies_select ON public.quick_replies;
DROP POLICY IF EXISTS quick_replies_insert ON public.quick_replies;
DROP POLICY IF EXISTS quick_replies_update ON public.quick_replies;
DROP POLICY IF EXISTS quick_replies_delete ON public.quick_replies;
CREATE POLICY quick_replies_select ON public.quick_replies FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY quick_replies_insert ON public.quick_replies FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY quick_replies_update ON public.quick_replies FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY quick_replies_delete ON public.quick_replies FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

-- flows
DROP POLICY IF EXISTS flows_select ON public.flows;
DROP POLICY IF EXISTS flows_insert ON public.flows;
DROP POLICY IF EXISTS flows_update ON public.flows;
DROP POLICY IF EXISTS flows_delete ON public.flows;
CREATE POLICY flows_select ON public.flows FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY flows_insert ON public.flows FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY flows_update ON public.flows FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY flows_delete ON public.flows FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS flow_nodes_select ON public.flow_nodes;
DROP POLICY IF EXISTS flow_nodes_modify ON public.flow_nodes;
CREATE POLICY flow_nodes_select ON public.flow_nodes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.flows f
    WHERE f.id = flow_nodes.flow_id AND public.is_account_member(f.account_id)
      AND (f.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(f.whatsapp_number_id)))
);
CREATE POLICY flow_nodes_modify ON public.flow_nodes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.flows f
    WHERE f.id = flow_nodes.flow_id AND public.is_account_member(f.account_id, 'agent')
      AND (f.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(f.whatsapp_number_id)))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.flows f
    WHERE f.id = flow_nodes.flow_id AND public.is_account_member(f.account_id, 'agent')
      AND (f.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(f.whatsapp_number_id)))
);

DROP POLICY IF EXISTS flow_runs_select ON public.flow_runs;
CREATE POLICY flow_runs_select ON public.flow_runs FOR SELECT USING (
  public.is_account_member(account_id)
  AND EXISTS (SELECT 1 FROM public.flows f
    WHERE f.id = flow_runs.flow_id
      AND (f.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(f.whatsapp_number_id)))
);

NOTIFY pgrst, 'reload schema';

COMMIT;
