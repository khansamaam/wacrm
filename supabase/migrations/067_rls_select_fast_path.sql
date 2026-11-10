-- 067: make the read policies on conversations, contacts and messages cheap.
--
-- The SELECT policies called is_account_member(account_id) and
-- has_whatsapp_number_access(whatsapp_number_id) for EVERY row scanned.
-- Both are SECURITY DEFINER SQL functions that Postgres cannot inline, so
-- each row ran its own profile/number/member lookups: list queries took
-- 2-4 s and whatsapp_numbers (2 rows) showed millions of scans. Realtime
-- runs the same policies for every change it delivers.
--
-- New helpers return the caller's account and readable numbers ONCE; the
-- policies compare each row against those values. Wrapped in (SELECT ...),
-- Postgres evaluates them once per query (an InitPlan), not once per row.
--
-- Who can see what does not change:
--   caller_viewer_account_id() = is_account_member(account_id) [viewer+]
--   caller_readable_number_ids() = numbers where has_whatsapp_number_access
-- Write policies keep their rules; messages_modify (FOR ALL) is split into
-- INSERT/UPDATE/DELETE with the same conditions, so it is no longer also
-- evaluated on every read. Every row it allowed is already readable under
-- messages_select (agent and write access imply viewer and read access).
--
-- Rollback: supabase/migrations/rollback/067_rls_select_fast_path_rollback.sql

BEGIN;

-- The caller's account when they hold any role in it (viewer or above).
CREATE OR REPLACE FUNCTION public.caller_viewer_account_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.account_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
    AND p.account_role IN ('owner', 'admin', 'agent', 'viewer')
  LIMIT 1;
$$;

-- Numbers the caller may read: same rule as has_whatsapp_number_access().
CREATE OR REPLACE FUNCTION public.caller_readable_number_ids()
RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(wn.id), '{}')
  FROM public.whatsapp_numbers wn
  JOIN public.profiles p
    ON p.account_id = wn.account_id
   AND p.user_id = auth.uid()
  WHERE p.account_role = 'owner'
     OR p.whatsapp_number_access_mode = 'all'
     OR EXISTS (
       SELECT 1 FROM public.whatsapp_number_members wnm
       WHERE wnm.whatsapp_number_id = wn.id
         AND wnm.user_id = p.user_id
     );
$$;

ALTER FUNCTION public.caller_viewer_account_id() OWNER TO postgres;
ALTER FUNCTION public.caller_readable_number_ids() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.caller_viewer_account_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.caller_readable_number_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_viewer_account_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.caller_readable_number_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  USING (
    account_id = (SELECT public.caller_viewer_account_id())
    AND (whatsapp_number_id IS NULL
         OR whatsapp_number_id = ANY ((SELECT public.caller_readable_number_ids())::uuid[]))
  );

DROP POLICY IF EXISTS contacts_select ON public.contacts;
CREATE POLICY contacts_select ON public.contacts FOR SELECT
  USING (
    account_id = (SELECT public.caller_viewer_account_id())
    AND (whatsapp_number_id IS NULL
         OR whatsapp_number_id = ANY ((SELECT public.caller_readable_number_ids())::uuid[]))
  );

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.account_id = (SELECT public.caller_viewer_account_id())
      AND (c.whatsapp_number_id IS NULL
           OR c.whatsapp_number_id = ANY ((SELECT public.caller_readable_number_ids())::uuid[]))
  ));

-- Same conditions as the 059 messages_modify, minus the read path.
DROP POLICY IF EXISTS messages_modify ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id))
  ));
CREATE POLICY messages_update ON public.messages FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id))
  ));
CREATE POLICY messages_delete ON public.messages FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND public.is_account_member(c.account_id, 'agent')
      AND (c.whatsapp_number_id IS NULL OR public.has_whatsapp_number_write_access(c.whatsapp_number_id))
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
