-- Preserve the reason Meta reports when an accepted outbound message later
-- fails delivery. These fields are populated by WhatsApp status webhooks and
-- surfaced in the Inbox failure indicator and public conversations API.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivery_error_code TEXT,
  ADD COLUMN IF NOT EXISTS delivery_error_message TEXT;
