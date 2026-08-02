-- Manual rollback for migration 046.
-- Safe only while each workspace still has one Cloud API number.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    GROUP BY account_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_numbers
    WHERE connection_method = 'coexistence'
       OR history_sync_status <> 'not_requested'
       OR contacts_sync_status <> 'not_requested'
  ) THEN
    RAISE EXCEPTION
      'Rollback 046 stopped: multi-number or coexistence state exists. Keep the additive table, or take an encrypted backup and explicitly choose one default per workspace.';
  END IF;
END;
$$;

-- Ensure the old application receives the final default state before the
-- bridge and new table are removed.
INSERT INTO public.whatsapp_config (
  id, account_id, user_id, phone_number_id, display_phone_number, waba_id,
  access_token, verify_token, status, connected_at, registered_at,
  subscribed_apps_at, last_registration_error, created_at, updated_at
)
SELECT
  wn.id, wn.account_id,
  COALESCE(wn.created_by_user_id, a.owner_user_id),
  wn.phone_number_id, wn.display_phone_number, wn.waba_id,
  COALESCE(wn.access_token, ''), wn.verify_token,
  CASE wn.status WHEN 'connected' THEN 'connected' ELSE 'disconnected' END,
  wn.connected_at, wn.registered_at, wn.subscribed_apps_at,
  wn.last_registration_error, wn.created_at, wn.updated_at
FROM public.whatsapp_numbers wn
JOIN public.accounts a ON a.id = wn.account_id
-- The preflight guarantees at most one row per workspace, so restore that row
-- even if an asynchronous Meta disconnect cleared its default flag.
ON CONFLICT (account_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  phone_number_id = EXCLUDED.phone_number_id,
  display_phone_number = EXCLUDED.display_phone_number,
  waba_id = EXCLUDED.waba_id,
  access_token = EXCLUDED.access_token,
  verify_token = EXCLUDED.verify_token,
  status = EXCLUDED.status,
  connected_at = EXCLUDED.connected_at,
  registered_at = EXCLUDED.registered_at,
  subscribed_apps_at = EXCLUDED.subscribed_apps_at,
  last_registration_error = EXCLUDED.last_registration_error,
  updated_at = EXCLUDED.updated_at;

DROP TRIGGER IF EXISTS sync_legacy_whatsapp_config_to_numbers
  ON public.whatsapp_config;
DROP TRIGGER IF EXISTS sync_default_whatsapp_number_to_legacy
  ON public.whatsapp_numbers;
DROP FUNCTION IF EXISTS public.sync_legacy_whatsapp_config_to_numbers();
DROP FUNCTION IF EXISTS public.sync_default_whatsapp_number_to_legacy();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'whatsapp_numbers'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_numbers;
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.whatsapp_numbers;
NOTIFY pgrst, 'reload schema';
COMMIT;
