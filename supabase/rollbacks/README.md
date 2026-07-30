# Manual database rollbacks

Files in this directory are **not applied automatically**. They are paired
with forward migrations in `supabase/migrations` and should be run manually
only when the application is being reverted to a version from before the
corresponding migration.

## Procedure

1. Back up the production database.
2. Stop application writes or enable maintenance mode.
3. Run the matching `.down.sql` file in Supabase SQL Editor or with `psql`.
4. Deploy the older application version.
5. Restart the application and verify authentication and core workflows.

Do not move rollback files into `supabase/migrations`; doing so would cause a
normal forward deployment to apply the rollback automatically.
