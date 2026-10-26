BEGIN;

-- Phase 3c: AI assistant settings, knowledge base and usage per WhatsApp
-- number.
--
-- * ai_configs: one config per (account, number); an unscoped config
--   (whatsapp_number_id NULL) still works as the account-wide fallback,
--   which keeps the previous release working.
-- * Knowledge documents/chunks belong to a number; retrieval for a number
--   uses that number's chunks plus unscoped ones (new 4-argument match
--   functions; the 3-argument versions stay for the previous release).
-- * ai_usage_log records the number for per-number usage reporting.
-- * Existing rows are assigned to the account's default number.
-- * RLS: reads need number access, writes need write access.

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;
ALTER TABLE public.ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;
ALTER TABLE public.ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;

UPDATE public.ai_configs c SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE c.whatsapp_number_id IS NULL AND wn.account_id = c.account_id AND wn.is_default;
UPDATE public.ai_knowledge_documents d SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE d.whatsapp_number_id IS NULL AND wn.account_id = d.account_id AND wn.is_default;
UPDATE public.ai_knowledge_chunks k SET whatsapp_number_id = d.whatsapp_number_id
FROM public.ai_knowledge_documents d
WHERE k.document_id = d.id AND k.whatsapp_number_id IS DISTINCT FROM d.whatsapp_number_id;

-- One config per number, plus at most one unscoped config per account.
-- Drop the 029 UNIQUE(account_id) whatever its name.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.ai_configs'::regclass
      AND con.contype = 'u'
      AND con.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.ai_configs'::regclass AND attname = 'account_id'
      )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.ai_configs DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_configs_account_number
  ON public.ai_configs (account_id, whatsapp_number_id)
  WHERE whatsapp_number_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_configs_account_unscoped
  ON public.ai_configs (account_id)
  WHERE whatsapp_number_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_account_number
  ON public.ai_knowledge_documents (account_id, whatsapp_number_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_account_number
  ON public.ai_knowledge_chunks (account_id, whatsapp_number_id);

-- RLS ----------------------------------------------------------------------
DROP POLICY IF EXISTS ai_configs_select ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_insert ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_update ON public.ai_configs;
DROP POLICY IF EXISTS ai_configs_delete ON public.ai_configs;
CREATE POLICY ai_configs_select ON public.ai_configs FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY ai_configs_insert ON public.ai_configs FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY ai_configs_update ON public.ai_configs FOR UPDATE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY ai_configs_delete ON public.ai_configs FOR DELETE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS ai_knowledge_documents_select ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_insert ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_update ON public.ai_knowledge_documents;
DROP POLICY IF EXISTS ai_knowledge_documents_delete ON public.ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_select ON public.ai_knowledge_documents FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY ai_knowledge_documents_insert ON public.ai_knowledge_documents FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY ai_knowledge_documents_update ON public.ai_knowledge_documents FOR UPDATE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY ai_knowledge_documents_delete ON public.ai_knowledge_documents FOR DELETE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS ai_knowledge_chunks_select ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_insert ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_update ON public.ai_knowledge_chunks;
DROP POLICY IF EXISTS ai_knowledge_chunks_delete ON public.ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_select ON public.ai_knowledge_chunks FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY ai_knowledge_chunks_insert ON public.ai_knowledge_chunks FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY ai_knowledge_chunks_update ON public.ai_knowledge_chunks FOR UPDATE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY ai_knowledge_chunks_delete ON public.ai_knowledge_chunks FOR DELETE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS ai_usage_log_select ON public.ai_usage_log;
CREATE POLICY ai_usage_log_select ON public.ai_usage_log FOR SELECT
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));

-- Number-aware retrieval (SECURITY INVOKER, same as 032) --------------------
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id         uuid,
  p_query              text,
  p_match_count        integer,
  p_whatsapp_number_id uuid
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND (p_whatsapp_number_id IS NULL
         OR c.whatsapp_number_id IS NULL
         OR c.whatsapp_number_id = p_whatsapp_number_id)
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic(
  p_account_id         uuid,
  p_query_embedding    text,
  p_match_count        integer,
  p_whatsapp_number_id uuid
)
RETURNS TABLE (id uuid, content text, distance real) AS $$
  SELECT c.id,
         c.content,
         (c.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND (p_whatsapp_number_id IS NULL
         OR c.whatsapp_number_id IS NULL
         OR c.whatsapp_number_id = p_whatsapp_number_id)
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid, text, integer, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
