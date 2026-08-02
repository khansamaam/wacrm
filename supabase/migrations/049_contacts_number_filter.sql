-- Server-side contact pagination for the combined tag + WhatsApp-number filter.
-- Contacts remain workspace-wide; selecting a number means "contacts that
-- have a conversation on this number".

BEGIN;

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags_and_number(
  p_tag_ids UUID[],
  p_whatsapp_number_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM public.contacts c
    JOIN public.contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_whatsapp_number_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.conversations conversation
          WHERE conversation.contact_id = c.id
            AND conversation.whatsapp_number_id = p_whatsapp_number_id
        )
      )
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ), page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page JOIN public.contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags_and_number(UUID[], UUID, TEXT, INT, INT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags_and_number(UUID[], UUID, TEXT, INT, INT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags_and_number(UUID[], UUID, TEXT, INT, INT)
  TO authenticated;

COMMIT;
