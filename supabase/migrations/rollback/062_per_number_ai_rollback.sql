-- Roll back migration 062.
--
-- AI becomes account-wide again. Preflight: the 029 UNIQUE(account_id)
-- cannot be restored while an account has several per-number configs, so
-- the rollback refuses until extra configs are deleted (keep one per
-- account). Knowledge documents, chunks and usage rows are kept.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ai_configs GROUP BY account_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Rollback 062 blocked: an account has more than one AI config. Delete the extra per-number configs first.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.match_ai_knowledge_fts(uuid, text, integer, uuid);
DROP FUNCTION IF EXISTS public.match_ai_knowledge_semantic(uuid, text, integer, uuid);

DROP POLICY IF EXISTS ai_configs_select ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_insert ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_update ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_delete ON public.ai_configs;
CREATE POLICY ai_configs_select ON public.ai_configs FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY ai_configs_insert ON public.ai_configs FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_configs_update ON public.ai_configs FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_configs_delete ON public.ai_configs FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_select ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_insert ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_update ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_delete ON public.ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_select ON public.ai_knowledge_documents FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY ai_knowledge_documents_insert ON public.ai_knowledge_documents FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_knowledge_documents_update ON public.ai_knowledge_documents FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_knowledge_documents_delete ON public.ai_knowledge_documents FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_chunks_select ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_insert ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_update ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_delete ON public.ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_select ON public.ai_knowledge_chunks FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY ai_knowledge_chunks_insert ON public.ai_knowledge_chunks FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_knowledge_chunks_update ON public.ai_knowledge_chunks FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_knowledge_chunks_delete ON public.ai_knowledge_chunks FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_usage_log_select ON public.ai_usage_log;
CREATE POLICY ai_usage_log_select ON public.ai_usage_log FOR SELECT USING (public.is_account_member(account_id, 'admin'));

DROP INDEX IF EXISTS public.idx_ai_configs_account_number;
DROP INDEX IF EXISTS public.idx_ai_configs_account_unscoped;
DROP INDEX IF EXISTS public.idx_ai_knowledge_documents_account_number;
DROP INDEX IF EXISTS public.idx_ai_knowledge_chunks_account_number;
ALTER TABLE public.ai_configs ADD CONSTRAINT ai_configs_account_id_key UNIQUE (account_id);

ALTER TABLE public.ai_usage_log DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.ai_knowledge_chunks DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.ai_knowledge_documents DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.ai_configs DROP COLUMN IF EXISTS whatsapp_number_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
