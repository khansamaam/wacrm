-- Roll back migration 052 while preserving queued job metadata for recovery.
-- Sent messages, broadcasts, recipients, and delivery status history remain.

BEGIN;

CREATE SCHEMA IF NOT EXISTS migration_archive;

CREATE TABLE IF NOT EXISTS migration_archive.broadcast_queue_052 (
  recipient_id UUID PRIMARY KEY,
  archived_row JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_archive.broadcast_templates_052 (
  broadcast_id UUID PRIMARY KEY,
  template_snapshot JSONB,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON SCHEMA migration_archive FROM PUBLIC;
REVOKE ALL ON TABLE migration_archive.broadcast_queue_052
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE migration_archive.broadcast_templates_052
  FROM PUBLIC, anon, authenticated;

INSERT INTO migration_archive.broadcast_queue_052 (
  recipient_id,
  archived_row,
  archived_at
)
SELECT
  id,
  JSONB_BUILD_OBJECT(
    'queue_payload', queue_payload,
    'attempt_count', attempt_count,
    'max_attempts', max_attempts,
    'next_attempt_at', next_attempt_at,
    'lease_owner', lease_owner,
    'lease_expires_at', lease_expires_at,
    'last_attempt_at', last_attempt_at,
    'completed_at', completed_at
  ),
  NOW()
FROM public.broadcast_recipients
ON CONFLICT (recipient_id) DO UPDATE
SET archived_row = EXCLUDED.archived_row, archived_at = EXCLUDED.archived_at;

INSERT INTO migration_archive.broadcast_templates_052 (
  broadcast_id,
  template_snapshot,
  archived_at
)
SELECT id, template_snapshot, NOW()
FROM public.broadcasts
WHERE template_snapshot IS NOT NULL
ON CONFLICT (broadcast_id) DO UPDATE
SET
  template_snapshot = EXCLUDED.template_snapshot,
  archived_at = EXCLUDED.archived_at;

DROP FUNCTION IF EXISTS public.claim_broadcast_recipient_jobs(TEXT, INTEGER, INTEGER, UUID);

DROP INDEX IF EXISTS public.idx_broadcast_recipients_queue_due;
DROP INDEX IF EXISTS public.idx_broadcast_recipients_lease_expiry;

ALTER TABLE public.broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_attempt_count_check,
  DROP CONSTRAINT IF EXISTS broadcast_recipients_max_attempts_check,
  DROP COLUMN IF EXISTS queue_payload,
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS max_attempts,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS last_attempt_at,
  DROP COLUMN IF EXISTS completed_at;

ALTER TABLE public.broadcasts
  DROP COLUMN IF EXISTS template_snapshot;

NOTIFY pgrst, 'reload schema';

COMMIT;
