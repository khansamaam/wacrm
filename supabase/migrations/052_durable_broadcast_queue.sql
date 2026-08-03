-- Durable, lease-based delivery queue for dashboard and API broadcasts.
--
-- Existing broadcasts and delivered messages are untouched. Pending recipient
-- rows become immediately eligible for the worker, allowing campaigns that
-- were interrupted by a closed browser to resume after deployment.

BEGIN;

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS template_snapshot JSONB;

ALTER TABLE public.broadcast_recipients
  ADD COLUMN IF NOT EXISTS queue_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'broadcast_recipients_attempt_count_check'
      AND conrelid = 'public.broadcast_recipients'::regclass
  ) THEN
    ALTER TABLE public.broadcast_recipients
      ADD CONSTRAINT broadcast_recipients_attempt_count_check
      CHECK (attempt_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'broadcast_recipients_max_attempts_check'
      AND conrelid = 'public.broadcast_recipients'::regclass
  ) THEN
    ALTER TABLE public.broadcast_recipients
      ADD CONSTRAINT broadcast_recipients_max_attempts_check
      CHECK (max_attempts BETWEEN 1 AND 20);
  END IF;
END $$;

-- Only pending rows participate in queue scans. The lease condition is
-- evaluated by the claim function, while this index supplies due rows in the
-- order they should be processed.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_queue_due
  ON public.broadcast_recipients(next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_lease_expiry
  ON public.broadcast_recipients(lease_expires_at)
  WHERE status = 'pending' AND lease_expires_at IS NOT NULL;

COMMENT ON COLUMN public.broadcasts.template_snapshot IS
  'Immutable template definition captured when a campaign is queued.';
COMMENT ON COLUMN public.broadcast_recipients.queue_payload IS
  'Resolved per-recipient template parameters used by the durable worker.';
COMMENT ON COLUMN public.broadcast_recipients.lease_expires_at IS
  'Expired leases are reclaimable after a worker crash or deployment.';

-- Atomically claim jobs with row locks. SKIP LOCKED allows multiple cron
-- invocations to cooperate without sending the same recipient twice.
CREATE OR REPLACE FUNCTION public.claim_broadcast_recipient_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 180,
  p_account_id UUID DEFAULT NULL
)
RETURNS TABLE(recipient_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NULLIF(BTRIM(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'p_worker_id is required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT recipient.id
    FROM public.broadcast_recipients AS recipient
    JOIN public.broadcasts AS broadcast
      ON broadcast.id = recipient.broadcast_id
    WHERE recipient.status = 'pending'
      AND recipient.next_attempt_at <= NOW()
      AND (
        recipient.lease_expires_at IS NULL
        OR recipient.lease_expires_at <= NOW()
      )
      AND broadcast.status IN ('sending', 'scheduled')
      AND (broadcast.scheduled_at IS NULL OR broadcast.scheduled_at <= NOW())
      AND (p_account_id IS NULL OR broadcast.account_id = p_account_id)
    ORDER BY recipient.next_attempt_at, recipient.created_at
    FOR UPDATE OF recipient SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  ), claimed AS (
    UPDATE public.broadcast_recipients AS recipient
    SET
      lease_owner = p_worker_id,
      lease_expires_at = NOW() +
        MAKE_INTERVAL(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 180), 30), 900)),
      last_attempt_at = NOW(),
      attempt_count = recipient.attempt_count + 1
    FROM candidates
    WHERE recipient.id = candidates.id
    RETURNING recipient.id
  )
  SELECT claimed.id FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_broadcast_recipient_jobs(TEXT, INTEGER, INTEGER, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_recipient_jobs(TEXT, INTEGER, INTEGER, UUID)
  TO service_role;

-- Existing pending rows remain valid and become claimable immediately. Empty
-- queue_payload rows are resolved from broadcasts.template_variables and the
-- current contact by the worker for backward compatibility.
UPDATE public.broadcast_recipients
SET next_attempt_at = COALESCE(next_attempt_at, created_at, NOW())
WHERE status = 'pending';

NOTIFY pgrst, 'reload schema';

COMMIT;
