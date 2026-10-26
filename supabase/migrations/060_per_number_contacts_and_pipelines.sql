BEGIN;

-- Phase 3a: each connected WhatsApp number becomes its own data silo for
-- contacts, tags, custom fields and pipelines (deals, stages, notes, tag
-- links and custom values follow their parent).
--
-- * whatsapp_number_id NULL = unscoped (accounts without numbers, legacy
--   rows); visible to every member exactly as before.
-- * Contacts are unique per (account, number, phone): the same customer can
--   exist separately under each number.
-- * Existing rows are assigned to the number they belong to: a contact to
--   the number of its first conversation, everything else to the account's
--   default number. A contact with conversations on several numbers gets a
--   copy per extra number and those conversations move to the copy.
-- * RLS: reads need access to the number, writes need write access
--   (has_whatsapp_number_access / has_whatsapp_number_write_access, 048/059).
--
-- Additive for the previous app release: it keeps inserting unscoped
-- (NULL-number) rows, which stay valid and visible; the new release claims
-- them on first use.

-- 1. Columns ---------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;
ALTER TABLE public.custom_fields
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;

-- 2. Backfill --------------------------------------------------------------
UPDATE public.contacts c
SET whatsapp_number_id = first_conversation.whatsapp_number_id
FROM (
  SELECT DISTINCT ON (contact_id) contact_id, whatsapp_number_id
  FROM public.conversations
  WHERE whatsapp_number_id IS NOT NULL
  ORDER BY contact_id, created_at, id
) first_conversation
WHERE c.id = first_conversation.contact_id
  AND c.whatsapp_number_id IS NULL;

UPDATE public.contacts c
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE c.whatsapp_number_id IS NULL
  AND wn.account_id = c.account_id
  AND wn.is_default;

UPDATE public.tags t
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE t.whatsapp_number_id IS NULL AND wn.account_id = t.account_id AND wn.is_default;

UPDATE public.custom_fields f
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE f.whatsapp_number_id IS NULL AND wn.account_id = f.account_id AND wn.is_default;

UPDATE public.pipelines p
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE p.whatsapp_number_id IS NULL AND wn.account_id = p.account_id AND wn.is_default;

-- 3. Uniqueness per number (before the split, which inserts same-phone rows)
DROP INDEX IF EXISTS public.idx_contacts_account_phone_normalized;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_number_phone
  ON public.contacts (account_id, whatsapp_number_id, phone_normalized)
  WHERE phone_normalized <> '' AND whatsapp_number_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_unscoped
  ON public.contacts (account_id, phone_normalized)
  WHERE phone_normalized <> '' AND whatsapp_number_id IS NULL;

-- 4. Split contacts that talk to several numbers ----------------------------
DO $$
DECLARE
  r RECORD;
  v_copy UUID;
BEGIN
  FOR r IN
    SELECT conv.id AS conversation_id,
           conv.whatsapp_number_id AS number_id,
           c.id AS contact_id, c.account_id, c.user_id, c.phone,
           c.phone_normalized, c.name, c.email, c.company, c.avatar_url
    FROM public.conversations conv
    JOIN public.contacts c ON c.id = conv.contact_id
    WHERE conv.whatsapp_number_id IS NOT NULL
      AND c.whatsapp_number_id IS DISTINCT FROM conv.whatsapp_number_id
  LOOP
    SELECT id INTO v_copy
    FROM public.contacts
    WHERE account_id = r.account_id
      AND whatsapp_number_id = r.number_id
      AND phone_normalized = r.phone_normalized
      AND phone_normalized <> ''
    LIMIT 1;

    IF v_copy IS NULL THEN
      INSERT INTO public.contacts (
        account_id, user_id, phone, name, email, company, avatar_url,
        whatsapp_number_id
      ) VALUES (
        r.account_id, r.user_id, r.phone, r.name, r.email, r.company,
        r.avatar_url, r.number_id
      )
      RETURNING id INTO v_copy;
    END IF;

    UPDATE public.conversations SET contact_id = v_copy
    WHERE id = r.conversation_id;

    UPDATE public.broadcast_recipients br
    SET contact_id = v_copy
    FROM public.broadcasts b
    WHERE br.broadcast_id = b.id
      AND b.whatsapp_number_id = r.number_id
      AND br.contact_id = r.contact_id;

    UPDATE public.flow_runs SET contact_id = v_copy
    WHERE conversation_id = r.conversation_id AND contact_id = r.contact_id;
  END LOOP;
END $$;

-- 5. Indexes for number-scoped lists ---------------------------------------
CREATE INDEX IF NOT EXISTS idx_contacts_account_number_created_desc
  ON public.contacts (account_id, whatsapp_number_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tags_account_number
  ON public.tags (account_id, whatsapp_number_id);
CREATE INDEX IF NOT EXISTS idx_custom_fields_account_number
  ON public.custom_fields (account_id, whatsapp_number_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_account_number
  ON public.pipelines (account_id, whatsapp_number_id);

-- 6. Integrity: tags / custom values must belong to the contact's number --
CREATE OR REPLACE FUNCTION public.validate_contact_link_number()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_contact_number UUID;
  v_other_number UUID;
BEGIN
  SELECT whatsapp_number_id INTO v_contact_number
  FROM public.contacts WHERE id = NEW.contact_id;

  IF TG_TABLE_NAME = 'contact_tags' THEN
    SELECT whatsapp_number_id INTO v_other_number
    FROM public.tags WHERE id = NEW.tag_id;
  ELSE
    SELECT whatsapp_number_id INTO v_other_number
    FROM public.custom_fields WHERE id = NEW.custom_field_id;
  END IF;

  IF v_contact_number IS NOT NULL AND v_other_number IS NOT NULL
     AND v_contact_number <> v_other_number THEN
    RAISE EXCEPTION 'Tag or field belongs to a different WhatsApp number than the contact'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_contact_tag_number ON public.contact_tags;
CREATE TRIGGER validate_contact_tag_number
  BEFORE INSERT OR UPDATE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.validate_contact_link_number();

DROP TRIGGER IF EXISTS validate_contact_custom_value_number ON public.contact_custom_values;
CREATE TRIGGER validate_contact_custom_value_number
  BEFORE INSERT OR UPDATE ON public.contact_custom_values
  FOR EACH ROW EXECUTE FUNCTION public.validate_contact_link_number();

-- 7. RLS -------------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON public.contacts;
DROP POLICY IF EXISTS contacts_insert ON public.contacts;
DROP POLICY IF EXISTS contacts_update ON public.contacts;
DROP POLICY IF EXISTS contacts_delete ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY contacts_insert ON public.contacts FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY contacts_update ON public.contacts FOR UPDATE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)))
  WITH CHECK (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY contacts_delete ON public.contacts FOR DELETE
  USING (public.is_account_member(account_id, 'agent')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS tags_select ON public.tags;
DROP POLICY IF EXISTS tags_insert ON public.tags;
DROP POLICY IF EXISTS tags_update ON public.tags;
DROP POLICY IF EXISTS tags_delete ON public.tags;
CREATE POLICY tags_select ON public.tags FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY tags_insert ON public.tags FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY tags_update ON public.tags FOR UPDATE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY tags_delete ON public.tags FOR DELETE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS custom_fields_select ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_insert ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_update ON public.custom_fields;
DROP POLICY IF EXISTS custom_fields_delete ON public.custom_fields;
CREATE POLICY custom_fields_select ON public.custom_fields FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY custom_fields_insert ON public.custom_fields FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY custom_fields_update ON public.custom_fields FOR UPDATE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY custom_fields_delete ON public.custom_fields FOR DELETE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS pipelines_select ON public.pipelines;
DROP POLICY IF EXISTS pipelines_insert ON public.pipelines;
DROP POLICY IF EXISTS pipelines_update ON public.pipelines;
DROP POLICY IF EXISTS pipelines_delete ON public.pipelines;
CREATE POLICY pipelines_select ON public.pipelines FOR SELECT
  USING (public.is_account_member(account_id)
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(whatsapp_number_id)));
CREATE POLICY pipelines_insert ON public.pipelines FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY pipelines_update ON public.pipelines FOR UPDATE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));
CREATE POLICY pipelines_delete ON public.pipelines FOR DELETE
  USING (public.is_account_member(account_id, 'admin')
    AND (whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(whatsapp_number_id)));

DROP POLICY IF EXISTS pipeline_stages_select ON public.pipeline_stages;
DROP POLICY IF EXISTS pipeline_stages_modify ON public.pipeline_stages;
CREATE POLICY pipeline_stages_select ON public.pipeline_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = pipeline_stages.pipeline_id AND public.is_account_member(p.account_id)
      AND (p.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(p.whatsapp_number_id)))
);
CREATE POLICY pipeline_stages_modify ON public.pipeline_stages FOR ALL USING (
  EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = pipeline_stages.pipeline_id AND public.is_account_member(p.account_id, 'admin')
      AND (p.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(p.whatsapp_number_id)))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = pipeline_stages.pipeline_id AND public.is_account_member(p.account_id, 'admin')
      AND (p.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(p.whatsapp_number_id)))
);

-- Deals follow their pipeline's number.
DROP POLICY IF EXISTS deals_select ON public.deals;
DROP POLICY IF EXISTS deals_insert ON public.deals;
DROP POLICY IF EXISTS deals_update ON public.deals;
DROP POLICY IF EXISTS deals_delete ON public.deals;
CREATE POLICY deals_select ON public.deals FOR SELECT USING (
  public.is_account_member(account_id)
  AND EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = deals.pipeline_id
      AND (p.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(p.whatsapp_number_id)))
);
CREATE POLICY deals_insert ON public.deals FOR INSERT WITH CHECK (
  public.is_account_member(account_id, 'agent')
  AND EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = deals.pipeline_id
      AND (p.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(p.whatsapp_number_id)))
);
CREATE POLICY deals_update ON public.deals FOR UPDATE USING (
  public.is_account_member(account_id, 'agent')
  AND EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = deals.pipeline_id
      AND (p.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(p.whatsapp_number_id)))
);
CREATE POLICY deals_delete ON public.deals FOR DELETE USING (
  public.is_account_member(account_id, 'agent')
  AND EXISTS (SELECT 1 FROM public.pipelines p
    WHERE p.id = deals.pipeline_id
      AND (p.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(p.whatsapp_number_id)))
);

-- Notes, tag links and custom values follow their contact's number.
DROP POLICY IF EXISTS contact_notes_select ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_insert ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_update ON public.contact_notes;
DROP POLICY IF EXISTS contact_notes_delete ON public.contact_notes;
CREATE POLICY contact_notes_select ON public.contact_notes FOR SELECT USING (
  public.is_account_member(account_id)
  AND EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_notes.contact_id
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(c.whatsapp_number_id)))
);
CREATE POLICY contact_notes_insert ON public.contact_notes FOR INSERT WITH CHECK (
  public.is_account_member(account_id, 'agent')
  AND EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_notes.contact_id
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id)))
);
CREATE POLICY contact_notes_update ON public.contact_notes FOR UPDATE USING (
  public.is_account_member(account_id, 'agent')
  AND EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_notes.contact_id
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id)))
);
CREATE POLICY contact_notes_delete ON public.contact_notes FOR DELETE USING (
  public.is_account_member(account_id, 'agent')
  AND EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_notes.contact_id
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id)))
);

DROP POLICY IF EXISTS contact_tags_select ON public.contact_tags;
DROP POLICY IF EXISTS contact_tags_modify ON public.contact_tags;
CREATE POLICY contact_tags_select ON public.contact_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_tags.contact_id AND public.is_account_member(c.account_id)
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(c.whatsapp_number_id)))
);
CREATE POLICY contact_tags_modify ON public.contact_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_tags.contact_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id)))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_tags.contact_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id)))
);

DROP POLICY IF EXISTS contact_custom_values_select ON public.contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_modify ON public.contact_custom_values;
CREATE POLICY contact_custom_values_select ON public.contact_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_custom_values.contact_id AND public.is_account_member(c.account_id)
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_access(c.whatsapp_number_id)))
);
CREATE POLICY contact_custom_values_modify ON public.contact_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_custom_values.contact_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id)))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.contacts c
    WHERE c.id = contact_custom_values.contact_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id)))
);

-- 8. Contacts page RPC: filter by the contact's own number ------------------
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
        OR c.whatsapp_number_id = p_whatsapp_number_id
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

NOTIFY pgrst, 'reload schema';

COMMIT;
