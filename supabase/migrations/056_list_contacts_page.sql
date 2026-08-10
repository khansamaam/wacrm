-- Server-side Contacts page pagination.
--
-- The Contacts UI loads 100 rows at a time, but search and filters must still
-- apply to the full contact book. This RPC keeps the query shape centralized:
--   - global search across name, phone, email, and company
--   - optional tag filter (ANY selected tag)
--   - optional WhatsApp number filter via conversations
--   - stable newest-first pagination with a windowed total count
--
-- SECURITY INVOKER preserves the existing RLS policies on contacts,
-- contact_tags, and conversations.

BEGIN;

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

ALTER FUNCTION public.list_contacts_page(UUID[], UUID, TEXT, INT, INT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_contacts_page(UUID[], UUID, TEXT, INT, INT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_contacts_page(UUID[], UUID, TEXT, INT, INT)
  TO authenticated;

-- Helps the common unfiltered page load: contacts in the current account,
-- newest first. RLS still applies; this index simply supports the ordering.
CREATE INDEX IF NOT EXISTS idx_contacts_account_created_desc
  ON public.contacts (account_id, created_at DESC, id DESC);

COMMENT ON FUNCTION public.list_contacts_page(UUID[], UUID, TEXT, INT, INT) IS
  'Contacts page: server-side search, filters, pagination, and total count.';
COMMENT ON INDEX public.idx_contacts_account_created_desc IS
  'Contacts page newest-first pagination within an account.';

COMMIT;
