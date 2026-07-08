# SQL migrations

Starting with `0001`, schema changes ship as numbered, sequential files in this
folder instead of being run ad hoc from the Supabase SQL editor. This is the
first piece of the CI/CD-mindset shift: a schema change now travels inside the
same PR as the frontend code that needs it, and is reviewable/replayable.

## Convention

- One file per migration: `NNNN_short_description.sql`, zero-padded, sequential.
- Never edit a migration that has already been applied to prod — write a new
  one instead, even to fix a mistake in a previous migration.
- Each migration should be runnable top-to-bottom in the Supabase SQL editor
  (or via `supabase db push` if/when we adopt the CLI) against the current
  state of the database.
- `SQL/*.sql` (the files outside this folder — `tables.sql`, `enums.sql`,
  etc.) remain the historical bootstrap baseline for a brand-new database.
  They are not retroactively migrated into this folder.

## Applying a migration

Until we wire up `supabase db push` in CI, apply each migration by hand once,
in order, via the Supabase SQL editor — same as the legacy `SQL/*.sql` files,
just numbered and reviewed via PR before being run.

## Granting the `master` / `planner` roles

Per-user role grants are intentionally **not** editable from any frontend —
see `0001_master_and_change_log.sql` for the rationale. To grant a role, run
by hand in the Supabase SQL editor:

```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "master"}'::jsonb
WHERE email = 'someone@example.org';
```

Valid roles today: `master`, `planner`. `master` is a superset of `planner`
(see the migration for details) — grant `master` to anyone who should also
have dispositivo access plus the master console.
