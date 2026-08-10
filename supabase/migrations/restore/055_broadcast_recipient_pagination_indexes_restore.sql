-- Restore the broadcast recipient pagination indexes removed by rollback 055.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_created_desc
  ON public.broadcast_recipients (broadcast_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status_created_desc
  ON public.broadcast_recipients (broadcast_id, status, created_at DESC, id DESC);

COMMIT;
