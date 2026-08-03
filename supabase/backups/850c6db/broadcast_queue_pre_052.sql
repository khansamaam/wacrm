-- Affected-schema snapshot for base commit 850c6db, captured before the
-- durable broadcast queue migration (052).
--
-- This file intentionally contains no production rows, contact details,
-- access tokens, or customer data. Take an encrypted live database backup
-- before applying migration 052 in production.

-- Objects absent at base commit 850c6db:
--   public.claim_broadcast_recipient_jobs(TEXT, INTEGER, INTEGER, UUID)

-- Columns absent from public.broadcasts:
--   template_snapshot

-- Columns absent from public.broadcast_recipients:
--   queue_payload
--   attempt_count
--   max_attempts
--   next_attempt_at
--   lease_owner
--   lease_expires_at
--   last_attempt_at
--   completed_at

-- Existing status values remain unchanged by migration 052:
--   broadcasts: draft, scheduled, sending, sent, failed
--   broadcast_recipients: pending, sent, delivered, read, replied, failed

-- Executable rollback:
--   supabase/migrations/rollback/052_durable_broadcast_queue_rollback.sql
-- Queue metadata recovery after reapplying 052:
--   supabase/migrations/restore/052_durable_broadcast_queue_restore.sql
