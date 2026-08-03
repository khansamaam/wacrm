-- Restore carousel rows archived by the migration 051 rollback.
-- Run migration 051 again before running this recovery script.

BEGIN;

DO $$
BEGIN
  IF to_regclass('migration_archive.message_template_carousels_051') IS NULL THEN
    RAISE EXCEPTION
      'Migration 051 carousel archive was not found; nothing can be restored.';
  END IF;
END $$;

UPDATE public.message_templates AS template
SET
  template_type = 'carousel',
  carousel_cards = archive.archived_row -> 'carousel_cards',
  status = COALESCE(archive.archived_row ->> 'status', template.status),
  submission_error = archive.archived_row ->> 'submission_error',
  updated_at = COALESCE(
    (archive.archived_row ->> 'updated_at')::TIMESTAMPTZ,
    template.updated_at
  )
FROM migration_archive.message_template_carousels_051 AS archive
WHERE template.id = archive.template_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
