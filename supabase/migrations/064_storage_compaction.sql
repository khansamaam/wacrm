BEGIN;

-- Storage compaction. Two values were stored long after they stopped
-- being useful and together made up most of the database size:
--
-- 1. broadcast_recipients.queue_payload holds each recipient's send-time
--    variables. Only the broadcast worker reads it, and only while the row
--    is 'pending' (claim_broadcast_recipient_jobs). Nothing moves a row
--    back to 'pending', so the payload is cleared once the row leaves it.
--
-- 2. messages.template_payload repeated the rendered body in body_text,
--    which is the same text already stored in messages.content_text. The
--    inbox falls back to content_text when body_text is absent, so the
--    duplicate is dropped when the two are identical.
--
-- Both are enforced by BEFORE triggers so every writer (worker, API,
-- browser) is covered without code changes. Existing rows are compacted
-- separately (see the one-off cleanup steps), not here, to keep this
-- migration fast.

CREATE OR REPLACE FUNCTION public.clear_finished_broadcast_queue_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending'
     AND NEW.queue_payload IS DISTINCT FROM '{}'::jsonb THEN
    NEW.queue_payload := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS broadcast_recipients_clear_queue_payload
  ON public.broadcast_recipients;
CREATE TRIGGER broadcast_recipients_clear_queue_payload
  BEFORE INSERT OR UPDATE OF status, queue_payload
  ON public.broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.clear_finished_broadcast_queue_payload();

CREATE OR REPLACE FUNCTION public.compact_message_template_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.template_payload IS NOT NULL
     AND jsonb_typeof(NEW.template_payload) = 'object'
     AND NEW.template_payload ? 'body_text'
     AND NEW.template_payload->>'body_text' = NEW.content_text THEN
    NEW.template_payload := NEW.template_payload - 'body_text';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_compact_template_payload ON public.messages;
CREATE TRIGGER messages_compact_template_payload
  BEFORE INSERT OR UPDATE OF template_payload, content_text
  ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.compact_message_template_payload();

NOTIFY pgrst, 'reload schema';

COMMIT;
