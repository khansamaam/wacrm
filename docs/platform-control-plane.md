# Platform control plane

The hosted product separates platform authority from client workspace roles.
Migration `042_platform_subscriptions_and_workspace_access.sql` provides the
subscription lifecycle and audited Super Admin workspace access.

## Authority model

- `platform_admins` grants access to the platform dashboard.
- `profiles.account_role = owner` represents a Client Admin.
- Client Admins may configure the WhatsApp connection for their own workspace.
- A Platform Super Admin must explicitly enter a workspace before using its
  operational screens.

Platform access never signs in as, or changes the password of, a client user.
The selected workspace is stored in `platform_workspace_context`, and
`is_account_member()` grants owner-equivalent RLS access only to that account.
Selecting another workspace replaces the previous context.

Every enter and exit is appended to `platform_access_audit`.

## Subscription model

`account_subscriptions` contains one row per workspace:

- plan and lifecycle status;
- billing cycle, amount in minor units, and ISO currency;
- start, renewal, expiry, and grace-period dates;
- internal notes and update attribution.

Dates are indexed for renewal and expiry reporting. Existing workspaces are
backfilled as active `legacy` subscriptions without a forced expiry. Newly
provisioned workspaces receive a trial with the expiry selected in the platform
dashboard.

The current release records and reports subscription state but does not block
workspace access. A future paywall should enforce access from this table at the
server/RLS boundary rather than hiding navigation only.

## Super Admin workflow

1. Open `/platform`.
2. Review workspace, subscription, member, renewal, and WhatsApp metrics.
3. Create a client workspace and its initial Client Admin invitation.
4. Use **Manage** to edit subscription dates and status.
5. Use **Open workspace** to enter an audited workspace context.
6. Use the header **Exit** action to return to the platform dashboard.

## Deployment

Apply migrations before deploying code that consumes them:

1. `041_invitation_only_platform_access.sql`
2. `042_platform_subscriptions_and_workspace_access.sql`

After applying them, reload the PostgREST schema cache or wait for Supabase to
reload it automatically.
