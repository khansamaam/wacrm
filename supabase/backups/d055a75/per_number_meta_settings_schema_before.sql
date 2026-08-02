-- Backup snapshot for commit base d055a75 before applying
-- 050_per_number_meta_app_settings.sql.
--
-- This is the relevant affected schema state for rollback review. A full live
-- data dump should still be taken from Supabase before production migration.

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'whatsapp_numbers'
ORDER BY ordinal_position;

SELECT
  constraint_name,
  constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name = 'whatsapp_numbers'
ORDER BY constraint_name;
