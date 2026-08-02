-- Attribute conversations, messages, broadcasts and templates to the
-- WhatsApp number/WABA that owns them. Columns remain nullable for workspaces
-- that have never connected WhatsApp; connected legacy workspaces are fully
-- backfilled to their default number.

BEGIN;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
  REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
    REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS message_origin TEXT NOT NULL DEFAULT 'cloud_api'
    CHECK (message_origin IN ('cloud_api', 'business_app', 'history_sync', 'external_api'));

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS whatsapp_number_id UUID
  REFERENCES public.whatsapp_numbers(id) ON DELETE RESTRICT;

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS waba_id TEXT;

UPDATE public.conversations c
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE wn.account_id = c.account_id
  AND wn.is_default
  AND c.whatsapp_number_id IS NULL;

UPDATE public.messages m
SET whatsapp_number_id = c.whatsapp_number_id
FROM public.conversations c
WHERE c.id = m.conversation_id
  AND m.whatsapp_number_id IS NULL;

UPDATE public.broadcasts b
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE wn.account_id = b.account_id
  AND wn.is_default
  AND b.whatsapp_number_id IS NULL;

UPDATE public.message_templates mt
SET waba_id = wn.waba_id
FROM public.whatsapp_numbers wn
WHERE wn.account_id = mt.account_id
  AND wn.is_default
  AND mt.waba_id IS NULL;

-- A contact can now have one thread per business number. Preserve a separate
-- uniqueness guard for pre-connection/orphan conversations whose number is
-- NULL, so concurrent inbound retries cannot recreate the old duplicate bug.
DROP INDEX IF EXISTS public.idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_number
  ON public.conversations(account_id, contact_id, whatsapp_number_id)
  WHERE whatsapp_number_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_without_number
  ON public.conversations(account_id, contact_id)
  WHERE whatsapp_number_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_number
  ON public.conversations(whatsapp_number_id);
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_number_created
  ON public.messages(whatsapp_number_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_number_meta_id
  ON public.messages(whatsapp_number_id, message_id)
  WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_coexistence_meta_id_unique
  ON public.messages(whatsapp_number_id, message_id)
  WHERE message_id IS NOT NULL
    AND message_origin IN ('business_app', 'history_sync');
CREATE INDEX IF NOT EXISTS idx_broadcasts_whatsapp_number
  ON public.broadcasts(whatsapp_number_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_account_waba
  ON public.message_templates(account_id, waba_id);

-- Meta template names are unique per WABA/language, not per author. Keep the
-- old user index until all rows have a WABA, and enforce the correct key for
-- every migrated/new WABA-scoped row.
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_waba_name_language_key
  ON public.message_templates(account_id, waba_id, name, language)
  WHERE waba_id IS NOT NULL;

-- Prevent an accidental message insert from disagreeing with its parent
-- conversation. Service/API callers only need to provide the conversation;
-- this trigger fills the number and rejects a conflicting explicit value.
CREATE OR REPLACE FUNCTION public.set_message_whatsapp_number()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_number_id UUID;
BEGIN
  SELECT whatsapp_number_id INTO v_number_id
  FROM public.conversations WHERE id = NEW.conversation_id;

  IF NEW.whatsapp_number_id IS NOT NULL
     AND v_number_id IS NOT NULL
     AND NEW.whatsapp_number_id <> v_number_id THEN
    RAISE EXCEPTION 'Message WhatsApp number does not match its conversation'
      USING ERRCODE = '23514';
  END IF;

  NEW.whatsapp_number_id := COALESCE(NEW.whatsapp_number_id, v_number_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_message_whatsapp_number ON public.messages;
CREATE TRIGGER set_message_whatsapp_number
  BEFORE INSERT OR UPDATE OF conversation_id, whatsapp_number_id
  ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_message_whatsapp_number();

NOTIFY pgrst, 'reload schema';
COMMIT;
