# SR2: performance advisor triage, connection pooling audit, per-role limits

Date: 2026-10-12. Scope: plan `docs/plans/SCALE-READINESS-PLAN.md` Phase 1 items 1 to 3. Source of truth: read-only queries against the live project `koiplnmbgnqnbywhpjlf` on 2026-10-12 and a local replay of every migration. Nothing in this file was applied to the live project.

How the advisor was read. The Supabase performance advisor returned a report too large to read in one piece (a single response of several hundred thousand characters). Rather than page through it, the same finding classes were re-derived with exact catalog queries (the advisor's own definitions: an unindexed foreign key, a row-level-security expression that re-evaluates a function per row, several permissive policies for one role and command, an identical index, an index never scanned). That gives counts that can be re-run at any time, and only the classes that matter were fixed.

## 1. Ranked findings

| Rank | Class | Live count 2026-10-12 | Risk it carries at scale | Action |
|---|---|---|---|---|
| 1 | Cron run history growth | `cron.job_run_details` 377,797 rows, 182 MB, 112 jobs, about 4,000 rows a day | Largest object in the database; unbounded | FIXED: (REMOVED in the two-tier integration: superseded by the already-live sr2_cron_history_purge_and_failure_incidents, #1055) SR2a migration `20261013003534_sr2a_cron_history_cleanup.sql`, daily, 7 days kept (30 for failures) |
| 2 | Hot-path query shapes that cannot use an index | Two in the minute-by-minute task sweep, one in the lab awaiting list | The overdue-task sweep ran a full table scan every minute: 1.26 s at 1,000,000 task rows | FIXED: SR2d migration `20261013004916_sr2d_hot_path_indexes_and_overdue_sweep_sargable.sql` (details in `SR2-query-plans.md`) |
| 3 | Foreign keys with no covering index | 1,019 of 2,123 foreign keys in `public` | Slow deletes and joins on the parent side; lock amplification | PARTLY FIXED: 25 on the hot tables in SR2c migration `20261013004442_sr2c_hot_table_indexes_and_policy_initplan.sql`. About 995 remain, all on cold or tiny tables. Left on purpose, see section 2 |
| 4 | Row-level-security re-evaluation per row (bare `auth.uid()`) | 6 policies of 1,561 (656 were already wrapped by an earlier sweep) | One function call per row scanned | 5 FIXED in SR2c. 1 left (see below) |
| 5 | Multiple permissive policies for the same role and command | 52 role/command combinations on 34 tables, none on a hot table; worst case 3 policies | Each permissive policy is evaluated and OR-ed per row | NOT changed. See section 3 |
| 6 | Duplicate indexes (same table, same columns in the same order, same predicate) | 1 | A wasted write per row | FIXED in SR2c: `async_consults_patient_month_idx` dropped, `async_consults_patient_idx` kept (definitions compared inside the migration before dropping) |
| 7 | Indexes never scanned | 565 non-unique indexes, 8.4 MB in total | None today | NOT changed. Statistics were never reset and the database has 12 accounts, so "never scanned" proves nothing yet. Revisit after Stage A with real traffic |

Checks to re-run any time (each should trend down, none should be read as an alarm on its own):

```sql
-- unindexed foreign keys (all of public)
select count(*) filter (where not covered) from (
  select exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
                 and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey) as covered
  from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace) x;

-- policies that still carry a bare auth.uid()
select tablename, policyname from pg_policies where schemaname = 'public'
  and regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), 'auth\.uid\(\)')
    > regexp_count(coalesce(qual,'') || ' ' || coalesce(with_check,''), '\( ?SELECT auth\.uid\(\) AS uid\)');
```

## 2. Foreign-key indexes: what was done and what was deliberately not

Done (25 indexes, on the tables the queue, paging, emergency, vitals, labs and encounter paths use): `clinical_encounters` (2), `clinical_task_transitions` (1), `clinical_tasks` (5, including the `(type, task_type_version)` pair), `clinician_alerts` (5), `emergency_events` (5), `encounters` (2), `lab_orders` (2), `task_claims` (1), `vitals_readings` (2). Nullable columns got partial indexes (`where col is not null`), which serve the parent-delete check `col = $1` and stay small.

Not done on purpose:
- `organisation_id` foreign keys on those tables. The platform has one organisation, so an index on that column cannot be selective, and an organisation is never deleted. If a second organisation ever holds real volume this should be revisited table by table.
- `pages`, `notifications`, `entitlements` and `audit_log` had no unindexed foreign key other than `organisation_id`, so they needed nothing.
- The other roughly 995 foreign keys, on cold tables. Each index costs a write on every insert and update of its table; indexing a table nobody queries is a net loss. A foreign key on a table that later becomes hot is fixed by the same pattern in a later migration.

Index builds are plain `create index` inside the migration transaction because every target table is empty or tiny today (clinical_tasks 0 rows, task_claims 0, vitals_readings 12). The migration header says to build `concurrently` by hand first if it is ever replayed on a populated copy; the `if not exists` then makes the migration a no-op.

The one bare `auth.uid()` left, `scribe_consents_insert_clinical`, is branch-owned drift: live carries a newer definition (it calls `private.staff_may_write`) than `main-dev` (it calls `private.is_org_staff`), from a migration on an unmerged branch. Rewriting it from `main-dev` would either regress live or change meaning, so it is left for the branch that owns the change.

## 3. Why the multiple-permissive-policy class was not merged

Merging two permissive policies into one is only safe when the OR of their expressions is provably the same set of rows, and proving that table by table is a row-level-security review of patient data. The class has no instance on any hot table (clinical_tasks, task_claims, pages, notifications, vitals_readings, encounters, entitlements, lab_orders, audit_log all have at most one permissive policy per role and command). The cost on the 34 affected tables is one extra boolean per row scanned. The risk of an accidental exposure outweighs it. Recommended handling: when one of those 34 tables becomes hot, merge its policies in a migration with a simulated-session proof (owner sees, stranger does not, and a sabotage step), the same way as the CLAUDE.md RLS-change checklist.

## 4. Connection pooling audit

Finding: nothing in this repository opens a direct Postgres connection. Searched `apps/`, `packages/`, `services/`, `scripts/`, `supabase/functions/` and CI for `DATABASE_URL`, `SUPABASE_DB_URL`, `POSTGRES_URL`, `pg`, `new Pool`, `asyncpg`, `psycopg`, `sqlalchemy`: the only hits are the database proof scripts (`packages/db/tests/*.sh`, `scripts/run-db-proofs.sh`), which are local-only by design and refuse a non-local URL. Every runtime client uses `supabase-js` (or `@supabase/ssr`) over HTTPS:

| Client | How it reaches the database | Connection behaviour |
|---|---|---|
| `apps/web` server components, route handlers, server actions | `@supabase/ssr` and `createServiceRoleClient` to the project's REST/Auth URL | HTTP to PostgREST. No connection held per Vercel instance. |
| `apps/console` (staff) | same packages | same |
| `apps/mobile` | `supabase-js` | same |
| Edge functions (all 16) | `jsr:@supabase/supabase-js@2` | same |
| `services/ml` | none (stateless by rule) | none |
| `pg_cron` jobs | in-database workers | Count toward `max_connections`; 1 scheduler plus one short-lived worker per running job |
| `net.http_post` jobs | `pg_net` background worker | 1 |

Measured on live (pg_stat_activity, 2026-10-12): `authenticator` / PostgREST 5 idle, `postgres` management API 1, `pg_net` 1, `supabase_admin` (pg_cron scheduler, exporter, one idle) 3. No role other than PostgREST's `authenticator` connection holds an application session.

Consequences for the plan:
- "Switch every server client to the pooler in transaction mode" has nothing to switch. The serverless-instance connection storm the plan worried about cannot occur while the app keeps using supabase-js. It becomes real only if someone adds a direct driver (Prisma, drizzle, `pg`, a Railway worker with SQL). If that happens, use the Supavisor pooler URL in TRANSACTION mode (port 6543), with these caveats: no session-level state across statements (`set`, advisory locks held across statements, `listen/notify`, temporary tables), named prepared statements must be turned off (`prepareThreshold=0` in pgJDBC, `prepare: false` in postgres.js, `statement_cache_size=0` in asyncpg), and every statement must be self-contained. The `tarragon.task_transition` and `tarragon.paging_write` settings used inside the queue and paging functions are set with `set_config(..., true)` (transaction-local) inside one function call, which is safe under transaction pooling.
- The real ceiling is PostgREST's pool and the plan's compute-tier `max_connections` (60 today). Raise it by stepping up compute and by setting the PostgREST pool size in the dashboard (checklist item 1.7), not by code. `ops.health_thresholds` makes `/api/health/deep` go degraded at 70 percent and down at 90 percent of `max_connections`.
- Documented env vars for the day a direct driver is added (not set anywhere now): `SUPABASE_POOLER_URL` (transaction mode, 6543), `SUPABASE_DIRECT_URL` (session mode or direct, migrations and `LISTEN` only). They are intentionally NOT added to `.env.example` yet, to avoid inviting a direct connection that nothing needs.

## 5. Per-role connection limits for rota, payment and notification paths

Not implemented, and here is why. Postgres connection limits attach to roles (`alter role ... connection limit n`). Every request from the web app, the console, the mobile app and all edge functions arrives as the single role `authenticator` (PostgREST then does `set role` to `anon`, `authenticated` or `service_role` inside the transaction). The rota, payment and notification code paths therefore share one connection pool and cannot be given separate role-level limits without giving them a separate way to connect, which would mean introducing direct-connection roles that do not exist today. Setting a limit on `authenticator` would cap everything together, which is the opposite of protecting the critical paths from browsing traffic.

What protects the critical paths today, and what to do next:
1. Existing role timeouts bound a runaway query: `authenticated` 8 s, `anon` 3 s, `authenticator` 8 s statement and 8 s lock timeout. Keep them.
2. The minute-granular sweeps (page escalation, task sweep, claim expiry, notification send) run inside the database (`pg_cron`) and so do not compete for PostgREST connections at all.
3. If load tests (SR4) show browsing traffic starving the critical paths, the designed remedy is three NOLOGIN-by-default worker roles created with `alter role ... connection limit` and used only by a Railway or edge worker that connects through Supavisor in transaction mode. Sketch, NOT applied:

```sql
-- design only: create these only when a worker with a direct driver exists, and give each a vault-held password
create role app_rota_worker       login connection limit 5  noinherit;
create role app_payment_worker    login connection limit 5  noinherit;
create role app_notification_worker login connection limit 10 noinherit;
-- each gets only EXECUTE on its own SECURITY DEFINER entry points (private.sweep_pages, the payment activation
-- functions, the notification claim function), never table access; revoke from public as for every function here
```

4. Meanwhile the better lever is the compute tier and the PostgREST pool size, both dashboard settings (checklist 1.2 and 1.7).

## 6. What each piece changed, for the reviewer

| Migration | Contents | Proof |
|---|---|---|
| `20261013003534_sr2a_cron_history_cleanup.sql` | `private.cron_history_cleanup(keep, keep_failed)`, scheduled `17 3 * * *`, incident on failure, anon and authenticated revoked | `packages/db/tests/sr2a_cron_history_cleanup.sql` |
| `20261013004442_sr2c_hot_table_indexes_and_policy_initplan.sql` | 25 foreign-key indexes, 1 duplicate index dropped, 5 policies wrapped | `packages/db/tests/sr2c_hot_table_indexes_and_initplan.sql` |
| `20261013004916_sr2d_hot_path_indexes_and_overdue_sweep_sargable.sql` | 4 hot-path indexes, overdue sweep rewritten to be index-friendly | `packages/db/tests/sr2d_overdue_sweep_sargable_and_hot_indexes.sql` |

All three are written for `apply_migration`-style application but are NOT applied to the live project. When applying, pin `schema_migrations.version` to the filename timestamp (CI does not push migrations), check `list_migrations` for anything recent you do not recognise first, and run the SR2a clean-up once by hand afterwards to see its first deletion count.
