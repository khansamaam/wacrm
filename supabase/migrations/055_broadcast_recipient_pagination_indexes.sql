-- Speed up paginated broadcast recipient reads on the detail page.
--
-- The UI now loads recipients 100 at a time. These indexes match the two
-- query shapes used by that table:
--   1) all recipients for a broadcast, newest first
--   2) recipients for a broadcast filtered by status, newest first

BEGIN;

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_created_desc
  ON public.broadcast_recipients (broadcast_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status_created_desc
  ON public.broadcast_recipients (broadcast_id, status, created_at DESC, id DESC);

COMMENT ON INDEX public.idx_broadcast_recipients_broadcast_created_desc IS
  'Broadcast detail recipients table: paged reads by broadcast newest first.';
COMMENT ON INDEX public.idx_broadcast_recipients_broadcast_status_created_desc IS
  'Broadcast detail recipients table: paged reads by broadcast and status newest first.';

COMMIT;
