-- Restore queue metadata archived by the migration 052 rollback.
-- Run migration 052 again before executing this recovery script.

BEGIN;

DO $$
BEGIN
  IF to_regclass('migration_archive.broadcast_queue_052') IS NULL THEN
    RAISE EXCEPTION 'Migration 052 recipient archive was not found.';
  END IF;
END $$;

UPDATE public.broadcast_recipients AS recipient
SET
  queue_payload = COALESCE(archive.archived_row -> 'queue_payload', '{}'::JSONB),
  attempt_count = COALESCE((archive.archived_row ->> 'attempt_count')::INTEGER, 0),
  max_attempts = COALESCE((archive.archived_row ->> 'max_attempts')::INTEGER, 5),
  next_attempt_at = COALESCE(
    (archive.archived_row ->> 'next_attempt_at')::TIMESTAMPTZ,
    recipient.created_at,
    NOW()
  ),
  lease_owner = archive.archived_row ->> 'lease_owner',
  lease_expires_at = (archive.archived_row ->> 'lease_expires_at')::TIMESTAMPTZ,
  last_attempt_at = (archive.archived_row ->> 'last_attempt_at')::TIMESTAMPTZ,
  completed_at = (archive.archived_row ->> 'completed_at')::TIMESTAMPTZ
FROM migration_archive.broadcast_queue_052 AS archive
WHERE recipient.id = archive.recipient_id;

UPDATE public.broadcasts AS broadcast
SET template_snapshot = archive.template_snapshot
FROM migration_archive.broadcast_templates_052 AS archive
WHERE broadcast.id = archive.broadcast_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
