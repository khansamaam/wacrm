BEGIN;
DROP FUNCTION IF EXISTS public.filter_contacts_by_tags_and_number(UUID[], UUID, TEXT, INT, INT);
COMMIT;
