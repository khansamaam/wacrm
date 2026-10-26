BEGIN;

-- Scope automations to a WhatsApp number.
--
-- Each automation can belong to one connected number. Inbound-message
-- triggers then only fire automations of the number the message arrived on,
-- so a second number (e.g. a coexistence Business App number) never answers
-- with another number's campaigns.
--
-- * whatsapp_number_id NULL  = runs for every number (previous behaviour).
-- * Existing automations are assigned to their account's default number,
--   which is the number they were built for.
--
-- Additive: the previous app release ignores the column and keeps working.
-- ON DELETE SET NULL is never expected to fire (numbers are disconnected,
-- not deleted) but keeps a hard delete from being blocked by automations.
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS whatsapp_number_id uuid
    REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.automations.whatsapp_number_id IS
  'WhatsApp number this automation runs for; NULL = all numbers in the account.';

UPDATE public.automations a
SET whatsapp_number_id = wn.id
FROM public.whatsapp_numbers wn
WHERE a.whatsapp_number_id IS NULL
  AND wn.account_id = a.account_id
  AND wn.is_default;

CREATE INDEX IF NOT EXISTS idx_automations_account_trigger_number
  ON public.automations (account_id, trigger_type, whatsapp_number_id)
  WHERE is_active;

NOTIFY pgrst, 'reload schema';

COMMIT;
