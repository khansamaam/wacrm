-- Roll back migration 064: stops compacting new rows. Values already
-- cleared are not restored (they were redundant copies / spent queue data).

BEGIN;

DROP TRIGGER IF EXISTS broadcast_recipients_clear_queue_payload
  ON public.broadcast_recipients;
DROP FUNCTION IF EXISTS public.clear_finished_broadcast_queue_payload();

DROP TRIGGER IF EXISTS messages_compact_template_payload ON public.messages;
DROP FUNCTION IF EXISTS public.compact_message_template_payload();

NOTIFY pgrst, 'reload schema';

COMMIT;
