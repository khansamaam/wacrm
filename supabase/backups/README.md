# Versioned schema snapshots

This directory stores schema-only snapshots for database objects changed by a
feature migration. Each snapshot directory is named after the Git commit that
the feature branch started from.

These files intentionally contain no production rows, access tokens, customer
data, or other secrets. A full production backup must be encrypted and stored
outside Git before applying a migration.

To restore an earlier application version:

1. Take a fresh encrypted production backup.
2. Run the matching file in `supabase/rollbacks`.
3. Deploy the earlier application commit.
4. Verify authentication, messaging, and settings access.

The snapshot is a reference copy of the affected pre-migration schema. The
paired rollback file is the executable rollback procedure.
