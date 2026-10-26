-- Roll back migration 060.
--
-- Restores workspace-wide contacts, tags, custom fields and pipelines:
--   * RLS policies return to their 017 definitions,
--   * list_contacts_page returns to its 056 body,
--   * per-number contact copies of the same phone are merged back into the
--     oldest contact with merge_duplicate_contacts() (022): conversations,
--     notes, deals, recipients and logs are re-pointed, duplicate tag links
--     and custom values on the copy are dropped,
--   * the (account, phone) unique index is recreated and the columns drop.
-- Conversations and messages are never deleted.

BEGIN;

DROP TRIGGER IF EXISTS validate_contact_tag_number ON public.contact_tags;
DROP TRIGGER IF EXISTS validate_contact_custom_value_number ON public.contact_custom_values;
DROP FUNCTION IF EXISTS public.validate_contact_link_number();

-- Policies (017 shapes)
DROP POLICY IF EXISTS contacts_select ON public.contacts;
DROP POLICY IF EXISTS contacts_insert ON public.contacts;
DROP POLICY IF EXISTS contacts_update ON public.contacts;
DROP POLICY IF EXISTS contacts_delete ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY contacts_insert ON public.contacts FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY contacts_update ON public.contacts FOR UPDATE USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY contacts_delete ON public.contacts FOR DELETE USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tags_select ON public.tags;
DROP POLICY IF EXISTS tags_insert ON public.tags;
DROP POLICY IF EXISTS tags_update ON public.tags;
DROP POLICY IF EXISTS tags_delete ON public.tags;
CREATE POLICY tags_select ON public.tags FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY tags_insert ON public.tags FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY tags_update ON public.tags FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY tags_delete ON public.tags FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS custom_fields_select ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_insert ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_update ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_delete ON public.custom_fields;
CREATE POLICY custom_fields_select ON public.custom_fields FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY custom_fields_insert ON public.custom_fields FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY custom_fields_update ON public.custom_fields FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY custom_fields_delete ON public.custom_fields FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS pipelines_select ON public.pipelines;
DROP POLICY IF EXISTS pipelines_insert ON public.pipelines;
DROP POLICY IF EXISTS pipelines_update ON public.pipelines;
DROP POLICY IF EXISTS pipelines_delete ON public.pipelines;
CREATE POLICY pipelines_select ON public.pipelines FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY pipelines_insert ON public.pipelines FOR INSERT WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY pipelines_update ON public.pipelines FOR UPDATE USING (public.is_account_member(account_id, 'admin'));
CREATE POLICY pipelines_delete ON public.pipelines FOR DELETE USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS pipeline_stages_select ON public.pipeline_stages;
DROP POLICY IF EXISTS pipeline_stages_modify ON public.pipeline_stages;
CREATE POLICY pipeline_stages_select ON public.pipeline_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_stages.pipeline_id AND public.is_account_member(p.account_id))
);
CREATE POLICY pipeline_stages_modify ON public.pipeline_stages FOR ALL USING (
  EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_stages.pipeline_id AND public.is_account_member(p.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = pipeline_stages.pipeline_id AND public.is_account_member(p.account_id, 'admin'))
);

DROP POLICY IF EXISTS deals_select ON public.deals;
DROP POLICY IF EXISTS deals_insert ON public.deals;
DROP POLICY IF EXISTS deals_update ON public.deals;
DROP POLICY IF EXISTS deals_delete ON public.deals;
CREATE POLICY deals_select ON public.deals FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY deals_insert ON public.deals FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY deals_update ON public.deals FOR UPDATE USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY deals_delete ON public.deals FOR DELETE USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_notes_select ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_insert ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_update ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_delete ON public.contact_notes;
CREATE POLICY contact_notes_select ON public.contact_notes FOR SELECT USING (public.is_account_member(account_id));
CREATE POLICY contact_notes_insert ON public.contact_notes FOR INSERT WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY contact_notes_update ON public.contact_notes FOR UPDATE USING (public.is_account_member(account_id, 'agent'));
CREATE POLICY contact_notes_delete ON public.contact_notes FOR DELETE USING (public.is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_tags_select ON public.contact_tags;
DROP POLICY IF EXISTS contact_tags_modify ON public.contact_tags;
CREATE POLICY contact_tags_select ON public.contact_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_tags.contact_id AND public.is_account_member(c.account_id))
);
CREATE POLICY contact_tags_modify ON public.contact_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_tags.contact_id AND public.is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_tags.contact_id AND public.is_account_member(c.account_id, 'agent'))
);

DROP POLICY IF EXISTS contact_custom_values_select ON public.contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_modify ON public.contact_custom_values;
CREATE POLICY contact_custom_values_select ON public.contact_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_values.contact_id AND public.is_account_member(c.account_id))
);
CREATE POLICY contact_custom_values_modify ON public.contact_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_values.contact_id AND public.is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_values.contact_id AND public.is_account_member(c.account_id, 'agent'))
);

-- list_contacts_page (056 body)
CREATE OR REPLACE FUNCTION public.list_contacts_page(
  p_tag_ids UUID[] DEFAULT NULL,
  p_whatsapp_number_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT c.id, c.created_at
    FROM public.contacts c
    WHERE (
        COALESCE(array_length(p_tag_ids, 1), 0) = 0
        OR EXISTS (
          SELECT 1
          FROM public.contact_tags ct
          WHERE ct.contact_id = c.id
            AND ct.tag_id = ANY(p_tag_ids)
        )
      )
      AND (
        p_whatsapp_number_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.conversations conversation
          WHERE conversation.contact_id = c.id
            AND conversation.whatsapp_number_id = p_whatsapp_number_id
        )
      )
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
        OR c.company ILIKE '%' || p_search || '%'
      )
  ), page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN public.contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id DESC;
$$;

-- Merge per-number copies back, then restore account-wide uniqueness.
DROP INDEX IF EXISTS public.idx_contacts_account_number_phone;
DROP INDEX IF EXISTS public.idx_contacts_account_phone_unscoped;
SELECT public.merge_duplicate_contacts();
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_normalized
  ON public.contacts (account_id, phone_normalized)
  WHERE phone_normalized <> '';

DROP INDEX IF EXISTS public.idx_contacts_account_number_created_desc;
DROP INDEX IF EXISTS public.idx_tags_account_number;
DROP INDEX IF EXISTS public.idx_custom_fields_account_number;
DROP INDEX IF EXISTS public.idx_pipelines_account_number;

ALTER TABLE public.contacts DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.tags DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.custom_fields DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.pipelines DROP COLUMN IF EXISTS whatsapp_number_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
