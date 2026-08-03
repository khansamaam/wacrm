-- Additive storage for Meta carousel message templates.
-- Existing rows remain standard templates without any manual migration.

BEGIN;

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS template_type TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS carousel_cards JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_templates_template_type_check'
      AND conrelid = 'public.message_templates'::regclass
  ) THEN
    ALTER TABLE public.message_templates
      ADD CONSTRAINT message_templates_template_type_check
      CHECK (template_type IN ('standard', 'carousel'));
  END IF;
END $$;

COMMENT ON COLUMN public.message_templates.template_type IS
  'Template layout: standard or Meta media carousel.';
COMMENT ON COLUMN public.message_templates.carousel_cards IS
  'Ordered carousel card definitions. NULL for standard templates.';

-- The default above keeps both old application releases and existing rows
-- compatible: legacy inserts that omit template_type remain standard, while
-- no existing template content or status is rewritten.

NOTIFY pgrst, 'reload schema';

COMMIT;
