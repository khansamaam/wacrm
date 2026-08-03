-- Roll back migration 051 without losing carousel definitions.
--
-- The previous application cannot interpret carousel columns, so carousel
-- rows are archived in a non-public schema before being converted to drafts.
-- Existing standard templates are never modified. The archive allows a later
-- manual restore if migration 051 is applied again.

BEGIN;

CREATE SCHEMA IF NOT EXISTS migration_archive;

CREATE TABLE IF NOT EXISTS migration_archive.message_template_carousels_051 (
  template_id UUID PRIMARY KEY,
  archived_row JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON SCHEMA migration_archive FROM PUBLIC;
REVOKE ALL ON TABLE migration_archive.message_template_carousels_051
  FROM PUBLIC, anon, authenticated;

INSERT INTO migration_archive.message_template_carousels_051 (
  template_id,
  archived_row,
  archived_at
)
SELECT
  id,
  to_jsonb(message_templates),
  NOW()
FROM public.message_templates
WHERE template_type = 'carousel'
ON CONFLICT (template_id) DO UPDATE
SET
  archived_row = EXCLUDED.archived_row,
  archived_at = EXCLUDED.archived_at;

UPDATE public.message_templates
SET
  template_type = 'standard',
  status = 'DRAFT',
  submission_error = 'Carousel data removed by migration 051 rollback.'
WHERE template_type = 'carousel';

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_template_type_check;

ALTER TABLE public.message_templates
  DROP COLUMN IF EXISTS carousel_cards,
  DROP COLUMN IF EXISTS template_type;

NOTIFY pgrst, 'reload schema';

COMMIT;
