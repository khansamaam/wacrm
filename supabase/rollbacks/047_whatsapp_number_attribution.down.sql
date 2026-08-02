-- Manual rollback for migration 047.
-- Run after 048 rollback and before deploying pre-multi-number code.

BEGIN;

DROP INDEX IF EXISTS public.idx_messages_coexistence_meta_id_unique;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Rollback 047 stopped: at least one contact has conversations on multiple WhatsApp numbers. The old schema cannot represent this without merging history.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.messages
    WHERE message_origin IN ('business_app', 'history_sync')
  ) THEN
    RAISE EXCEPTION
      'Rollback 047 stopped: coexistence/app history messages exist. Archive them before destructive rollback.';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS set_message_whatsapp_number ON public.messages;
DROP FUNCTION IF EXISTS public.set_message_whatsapp_number();

DROP INDEX IF EXISTS public.message_templates_account_waba_name_language_key;
DROP INDEX IF EXISTS public.idx_message_templates_account_waba;
DROP INDEX IF EXISTS public.idx_broadcasts_whatsapp_number;
DROP INDEX IF EXISTS public.idx_messages_number_meta_id;
DROP INDEX IF EXISTS public.idx_messages_whatsapp_number_created;
DROP INDEX IF EXISTS public.idx_conversations_whatsapp_number;
DROP INDEX IF EXISTS public.idx_conversations_account_contact_without_number;
DROP INDEX IF EXISTS public.idx_conversations_account_contact_number;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON public.conversations(account_id, contact_id);

ALTER TABLE public.message_templates DROP COLUMN IF EXISTS waba_id;
ALTER TABLE public.broadcasts DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.messages
  DROP COLUMN IF EXISTS message_origin,
  DROP COLUMN IF EXISTS whatsapp_number_id;
ALTER TABLE public.conversations DROP COLUMN IF EXISTS whatsapp_number_id;

NOTIFY pgrst, 'reload schema';
COMMIT;
