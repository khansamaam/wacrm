-- ============================================================
-- 042_platform_subscriptions_and_workspace_access.sql
--
-- Adds the commercial control plane for the hosted product:
--   * one subscription lifecycle per client workspace
--   * indexed renewal / expiry dates for platform reporting
--   * an explicit Super Admin workspace context
--   * append-only audit records for support access
--
-- A Super Admin never impersonates a client's Auth user. Instead, they
-- select one workspace and RLS grants owner-equivalent access only to that
-- workspace until they exit or select another. This preserves tenant
-- isolation and gives us an auditable support-access trail.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_subscriptions (
  account_id UUID PRIMARY KEY
    REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'trialing',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renews_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT account_subscriptions_status_check
    CHECK (status IN (
      'trialing', 'active', 'past_due', 'suspended', 'cancelled', 'expired'
    )),
  CONSTRAINT account_subscriptions_billing_cycle_check
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly', 'custom')),
  CONSTRAINT account_subscriptions_date_order_check
    CHECK (
      (renews_at IS NULL OR renews_at >= starts_at)
      AND (expires_at IS NULL OR expires_at >= starts_at)
      AND (grace_ends_at IS NULL OR expires_at IS NULL OR grace_ends_at >= expires_at)
    )
);

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_renewals
  ON public.account_subscriptions(renews_at)
  WHERE status IN ('trialing', 'active', 'past_due');

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_expiry
  ON public.account_subscriptions(expires_at)
  WHERE status NOT IN ('cancelled', 'expired');

-- Existing workspaces remain active and unmetered. New workspaces receive
-- an explicit trial record from the platform provisioning endpoint.
INSERT INTO public.account_subscriptions (
  account_id,
  plan_code,
  status,
  billing_cycle,
  amount_minor,
  currency,
  starts_at
)
SELECT
  account.id,
  'legacy',
  'active',
  'custom',
  0,
  'USD',
  account.created_at
FROM public.accounts AS account
ON CONFLICT (account_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_workspace_context (
  platform_admin_user_id UUID PRIMARY KEY
    REFERENCES public.platform_admins(user_id) ON DELETE CASCADE,
  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_workspace_context_account
  ON public.platform_workspace_context(account_id);

CREATE TABLE IF NOT EXISTS public.platform_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_user_id UUID NOT NULL
    REFERENCES public.platform_admins(user_id) ON DELETE RESTRICT,
  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('enter', 'exit')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_access_audit_admin_created
  ON public.platform_access_audit(platform_admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_access_audit_account_created
  ON public.platform_access_audit(account_id, created_at DESC);

ALTER TABLE public.account_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_workspace_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_access_audit ENABLE ROW LEVEL SECURITY;

-- Context changes and their audit records must commit together. Keeping this
-- operation in the database avoids a support session ever becoming active
-- without its corresponding audit event.
CREATE OR REPLACE FUNCTION public.enter_platform_workspace(
  target_account_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  workspace_name TEXT;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Platform Super Admin access required'
      USING ERRCODE = '42501';
  END IF;

  SELECT account.name
  INTO workspace_name
  FROM public.accounts AS account
  WHERE account.id = target_account_id;

  IF workspace_name IS NULL THEN
    RAISE EXCEPTION 'Client workspace not found'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.platform_workspace_context (
    platform_admin_user_id,
    account_id,
    entered_at,
    updated_at
  )
  VALUES (auth.uid(), target_account_id, NOW(), NOW())
  ON CONFLICT (platform_admin_user_id)
  DO UPDATE SET
    account_id = EXCLUDED.account_id,
    entered_at = EXCLUDED.entered_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.platform_access_audit (
    platform_admin_user_id,
    account_id,
    action,
    metadata
  )
  VALUES (
    auth.uid(),
    target_account_id,
    'enter',
    jsonb_build_object('workspace_name', workspace_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.exit_platform_workspace()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_account_id UUID;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Platform Super Admin access required'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.platform_workspace_context
  WHERE platform_admin_user_id = auth.uid()
  RETURNING account_id INTO selected_account_id;

  IF selected_account_id IS NOT NULL THEN
    INSERT INTO public.platform_access_audit (
      platform_admin_user_id,
      account_id,
      action
    )
    VALUES (auth.uid(), selected_account_id, 'exit');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enter_platform_workspace(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exit_platform_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enter_platform_workspace(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exit_platform_workspace()
  TO authenticated, service_role;

DROP POLICY IF EXISTS account_subscriptions_select
  ON public.account_subscriptions;
CREATE POLICY account_subscriptions_select
  ON public.account_subscriptions
  FOR SELECT
  USING (
    public.is_platform_admin()
    OR public.is_account_member(account_id, 'owner')
  );

DROP POLICY IF EXISTS platform_workspace_context_select_self
  ON public.platform_workspace_context;
CREATE POLICY platform_workspace_context_select_self
  ON public.platform_workspace_context
  FOR SELECT
  USING (platform_admin_user_id = auth.uid());

DROP POLICY IF EXISTS platform_access_audit_select_self
  ON public.platform_access_audit;
CREATE POLICY platform_access_audit_select_self
  ON public.platform_access_audit
  FOR SELECT
  USING (platform_admin_user_id = auth.uid());

-- Platform and subscription mutations intentionally have no client write
-- policies. The authenticated platform endpoints validate the caller and
-- perform writes with the service role so there is one auditable boundary.

-- When a platform workspace context exists, it replaces (rather than adds
-- to) the Super Admin's ordinary membership. This is critical: client
-- queries often rely on RLS without an explicit account_id filter, so
-- additive access would mix the Super Admin's personal workspace with the
-- selected client workspace.
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_admin(auth.uid()) THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.platform_workspace_context AS context
      WHERE context.platform_admin_user_id = auth.uid()
        AND context.account_id = target_account_id
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid()
      AND profile.account_id = target_account_id
      AND profile.access_status = 'active'
      AND CASE profile.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
END;
$$;

ALTER FUNCTION public.is_account_member(UUID, account_role_enum)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_account_member(UUID, account_role_enum)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_member(UUID, account_role_enum)
  TO authenticated, service_role;

-- Client Admins now own their Meta connection lifecycle. A platform
-- administrator receives the same owner-equivalent permission only while
-- explicitly inside that workspace context.
DROP POLICY IF EXISTS whatsapp_config_insert ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON public.whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON public.whatsapp_config;

CREATE POLICY whatsapp_config_insert
  ON public.whatsapp_config
  FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'owner'));

CREATE POLICY whatsapp_config_update
  ON public.whatsapp_config
  FOR UPDATE
  USING (public.is_account_member(account_id, 'owner'))
  WITH CHECK (public.is_account_member(account_id, 'owner'));

CREATE POLICY whatsapp_config_delete
  ON public.whatsapp_config
  FOR DELETE
  USING (public.is_account_member(account_id, 'owner'));

NOTIFY pgrst, 'reload schema';
