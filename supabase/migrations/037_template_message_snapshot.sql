-- Preserve the exact visual payload used for each outbound template send.
-- The source template can later be edited, synced, or deleted; the message
-- must still render the image/header/footer/buttons the recipient received.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS template_payload JSONB;
