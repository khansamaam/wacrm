-- Multi-number foundation. Existing whatsapp_config rows are retained and
-- mirrored as default Cloud API connections for zero-downtime compatibility.

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT 'WhatsApp',
  phone_number_id TEXT NOT NULL UNIQUE,
  display_phone_number TEXT,
  waba_id TEXT,
  connection_method TEXT NOT NULL DEFAULT 'cloud_api'
    CHECK (connection_method IN ('cloud_api', 'coexistence')),
  access_token TEXT,
  verify_token TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'disconnected')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  connected_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ,
  subscribed_apps_at TIMESTAMPTZ,
  last_registration_error TEXT,
  is_on_biz_app BOOLEAN,
  platform_type TEXT,
  coexistence_onboarded_at TIMESTAMPTZ,
  history_sync_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (history_sync_status IN ('not_requested', 'pending', 'processing', 'completed', 'failed')),
  history_sync_requested_at TIMESTAMPTZ,
  history_sync_completed_at TIMESTAMPTZ,
  contacts_sync_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (contacts_sync_status IN ('not_requested', 'pending', 'processing', 'completed', 'failed')),
  contacts_sync_requested_at TIMESTAMPTZ,
  contacts_sync_completed_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.whatsapp_numbers IS
  'Workspace WhatsApp senders. A workspace may connect multiple Cloud API or coexistence numbers.';
COMMENT ON COLUMN public.whatsapp_numbers.access_token IS
  'Application-encrypted Meta token; never expose through client-facing list APIs.';
COMMENT ON COLUMN public.whatsapp_numbers.metadata IS
  'Non-secret Meta metadata only. Never store Embedded Signup authorization codes.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_account
  ON public.whatsapp_numbers(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_account_status
  ON public.whatsapp_numbers(account_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_waba
  ON public.whatsapp_numbers(waba_id) WHERE waba_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_numbers_one_default
  ON public.whatsapp_numbers(account_id) WHERE is_default;

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_numbers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reuse the legacy UUID and encrypted credentials. Every existing workspace
-- therefore continues on exactly the same default Cloud API connection.
INSERT INTO public.whatsapp_numbers (
  id, account_id, created_by_user_id, label, phone_number_id,
  display_phone_number, waba_id, connection_method, access_token,
  verify_token, status, is_default, connected_at, registered_at,
  subscribed_apps_at, last_registration_error, created_at, updated_at
)
SELECT
  wc.id, wc.account_id, wc.user_id,
  COALESCE(NULLIF(wc.display_phone_number, ''), 'WhatsApp'),
  wc.phone_number_id, wc.display_phone_number, wc.waba_id, 'cloud_api',
  wc.access_token, wc.verify_token,
  CASE wc.status WHEN 'connected' THEN 'connected' ELSE 'disconnected' END,
  TRUE, wc.connected_at, wc.registered_at, wc.subscribed_apps_at,
  wc.last_registration_error, wc.created_at, wc.updated_at
FROM public.whatsapp_config wc
ON CONFLICT (id) DO NOTHING;

-- Keep the legacy singleton synchronized with whichever number is default.
-- Trigger-depth checks prevent the reverse bridge from recursively firing.
CREATE OR REPLACE FUNCTION public.sync_default_whatsapp_number_to_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.whatsapp_numbers%ROWTYPE;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.is_default AND NOT NEW.is_default) THEN
    SELECT * INTO v_row FROM public.whatsapp_numbers
    WHERE account_id = OLD.account_id AND is_default LIMIT 1;
    IF NOT FOUND THEN
      DELETE FROM public.whatsapp_config WHERE account_id = OLD.account_id;
      RETURN COALESCE(NEW, OLD);
    END IF;
  ELSE
    v_row := NEW;
  END IF;

  IF NOT v_row.is_default THEN RETURN COALESCE(NEW, OLD); END IF;

  INSERT INTO public.whatsapp_config (
    id, account_id, user_id, phone_number_id, display_phone_number, waba_id,
    access_token, verify_token, status, connected_at, registered_at,
    subscribed_apps_at, last_registration_error, created_at, updated_at
  ) VALUES (
    v_row.id, v_row.account_id,
    COALESCE(v_row.created_by_user_id,
      (SELECT owner_user_id FROM public.accounts WHERE id = v_row.account_id)),
    v_row.phone_number_id, v_row.display_phone_number, v_row.waba_id,
    COALESCE(v_row.access_token, ''), v_row.verify_token,
    CASE v_row.status WHEN 'connected' THEN 'connected' ELSE 'disconnected' END,
    v_row.connected_at, v_row.registered_at, v_row.subscribed_apps_at,
    v_row.last_registration_error, v_row.created_at, v_row.updated_at
  ) ON CONFLICT (account_id) DO UPDATE SET
    id = EXCLUDED.id,
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
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_default_whatsapp_number_to_legacy ON public.whatsapp_numbers;
CREATE TRIGGER sync_default_whatsapp_number_to_legacy
  AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.sync_default_whatsapp_number_to_legacy();

CREATE OR REPLACE FUNCTION public.sync_legacy_whatsapp_config_to_numbers()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.whatsapp_numbers WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  UPDATE public.whatsapp_numbers SET is_default = FALSE
  WHERE account_id = NEW.account_id AND id <> NEW.id AND is_default;

  INSERT INTO public.whatsapp_numbers (
    id, account_id, created_by_user_id, label, phone_number_id,
    display_phone_number, waba_id, connection_method, access_token,
    verify_token, status, is_default, connected_at, registered_at,
    subscribed_apps_at, last_registration_error, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.account_id, NEW.user_id,
    COALESCE(NULLIF(NEW.display_phone_number, ''), 'WhatsApp'),
    NEW.phone_number_id, NEW.display_phone_number, NEW.waba_id, 'cloud_api',
    NEW.access_token, NEW.verify_token,
    CASE NEW.status WHEN 'connected' THEN 'connected' ELSE 'disconnected' END,
    TRUE, NEW.connected_at, NEW.registered_at, NEW.subscribed_apps_at,
    NEW.last_registration_error, NEW.created_at, NEW.updated_at
  ) ON CONFLICT (id) DO UPDATE SET
    created_by_user_id = EXCLUDED.created_by_user_id,
    phone_number_id = EXCLUDED.phone_number_id,
    display_phone_number = EXCLUDED.display_phone_number,
    waba_id = EXCLUDED.waba_id,
    access_token = EXCLUDED.access_token,
    verify_token = EXCLUDED.verify_token,
    status = EXCLUDED.status,
    is_default = TRUE,
    connected_at = EXCLUDED.connected_at,
    registered_at = EXCLUDED.registered_at,
    subscribed_apps_at = EXCLUDED.subscribed_apps_at,
    last_registration_error = EXCLUDED.last_registration_error,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_legacy_whatsapp_config_to_numbers ON public.whatsapp_config;
CREATE TRIGGER sync_legacy_whatsapp_config_to_numbers
  AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_whatsapp_config_to_numbers();

ALTER TABLE public.whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_numbers_select ON public.whatsapp_numbers FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY whatsapp_numbers_insert ON public.whatsapp_numbers FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'owner'));
CREATE POLICY whatsapp_numbers_update ON public.whatsapp_numbers FOR UPDATE
  USING (public.is_account_member(account_id, 'owner'))
  WITH CHECK (public.is_account_member(account_id, 'owner'));
CREATE POLICY whatsapp_numbers_delete ON public.whatsapp_numbers FOR DELETE
  USING (public.is_account_member(account_id, 'owner'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'whatsapp_numbers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_numbers;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
