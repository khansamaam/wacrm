BEGIN;

-- When a customer deletes a message "for everyone", Meta sends a `revoke`
-- notification. The original stays visible to staff for the record and is
-- tagged with the time it was deleted. Additive and nullable.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_by_customer_at timestamptz;

COMMENT ON COLUMN public.messages.deleted_by_customer_at IS
  'Set when the customer deleted this message for everyone in WhatsApp (revoke).';

NOTIFY pgrst, 'reload schema';

COMMIT;
