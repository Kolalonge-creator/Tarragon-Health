-- Tarragon Health
-- Data Architecture Gaps Build Plan, §3 Phase 1 (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md).
-- Confirmed a genuine gap before writing this: no analytics/BI warehouse of
-- any kind exists. All ~45 analytics RPCs under lib/analytics/queries.ts
-- (public.analytics_*) aggregate live against the transactional tables on
-- every call, uncached, with no MATERIALIZED VIEW anywhere in this repo's
-- migrations. Given this repo's own "Stack A -- Final, Do Not Relitigate"
-- rule and the pre-revenue/pilot scale docs/MASTER_ARCHITECTURE_BLUEPRINT_GAP_ANALYSIS.md
-- already documents, a genuinely separate OLAP system (Snowflake/BigQuery/
-- dbt) is premature -- see the build-plan doc's Phase 3. This migration does
-- NOT introduce a new database technology. It generalises a pattern this
-- codebase already built and proved once: public_impact_metrics
-- (20260730153159) -- a summary table populated by a pg_cron-scheduled
-- SECURITY DEFINER refresh function, small-cell-suppression included -- but
-- that pattern was a one-off for a single public marketing page. This
-- migration lifts it into a reusable internal metrics layer.
--
-- Design: one generic snapshot table (analytics.rpc_snapshots) rather than a
-- table per RPC, so future RPCs can adopt the same pattern additively without
-- a new table each time. Phase 1 proves the pattern on exactly one RPC
-- (analytics_business_summary, the simplest of the ~45 and the one every
-- other analytics dashboard's "top line" numbers roll up from) rather than
-- materialising all ~45 pre-emptively -- per the build-plan doc's Phase 2,
-- which RPCs actually need this is an empirical question (real query timing),
-- not something to guess at wholesale in one migration.
--
-- analytics.rpc_snapshots is not exposed to any role directly -- schema USAGE
-- and table privileges are revoked from public/anon/authenticated. Every read
-- and write goes through a SECURITY DEFINER function (owned by the migration
-- role), same posture as the private schema's own tables/functions
-- throughout this codebase. public.analytics_business_summary() keeps its
-- existing signature, return type, and is_analyst() gate -- callers
-- (lib/analytics/queries.ts) need no change.

create schema if not exists analytics;

revoke all on schema analytics from public;
revoke all on schema analytics from anon;
revoke all on schema analytics from authenticated;

comment on schema analytics is
  'Internal metrics/snapshot layer -- see docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §3. Not directly reachable by any role; every read/write goes through a SECURITY DEFINER function in public/private. Not a replacement for a real external OLAP warehouse (see the build-plan doc''s Phase 3) -- a Postgres-native materialisation layer sized for this platform''s current pre-revenue/pilot scale.';

create table analytics.rpc_snapshots (
  rpc_name     text primary key,
  payload      jsonb not null,
  computed_at  timestamptz not null default now()
);

comment on table analytics.rpc_snapshots is
  'One row per materialised analytics RPC. public.analytics_business_summary() (and any future RPC adopting this pattern) reads its payload from here instead of live-aggregating on every call; private.refresh_analytics_snapshot_business_summary() (pg_cron, nightly) keeps it current.';

revoke all on analytics.rpc_snapshots from public;
revoke all on analytics.rpc_snapshots from anon;
revoke all on analytics.rpc_snapshots from authenticated;

-- ---------------------------------------------------------------------------
-- Phase 1 proof: materialise analytics_business_summary.
-- ---------------------------------------------------------------------------

create or replace function private.refresh_analytics_snapshot_business_summary()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
    'total_orgs', (select count(*) from public.organisations),
    'active_orgs', (select count(*) from public.organisations where is_active),
    'total_profiles', (select count(*) from public.profiles),
    'total_patients', (select count(*) from public.profiles where role = 'patient'),
    'active_patients', (select count(*) from public.profiles where role = 'patient' and is_active),
    'onboarded_patients', (select count(*) from public.profiles where role = 'patient' and onboarding_completed_at is not null),
    'total_subscriptions', (select count(*) from public.subscriptions),
    'active_subscriptions', (select count(*) from public.subscriptions where status in ('active','trialing')),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'count', c) order by c desc), '[]'::jsonb)
              from (select role::text as role, count(*) c from public.profiles group by role) t),
    'org_types', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'count', c) order by c desc), '[]'::jsonb)
                  from (select type::text as type, count(*) c from public.organisations group by type) t),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', c) order by c desc), '[]'::jsonb)
               from (select coalesce(state, 'Unknown') as state, count(*) c from public.profiles where role = 'patient' group by coalesce(state, 'Unknown')) t)
  ) into v_payload;

  insert into analytics.rpc_snapshots (rpc_name, payload, computed_at)
  values ('analytics_business_summary', v_payload, now())
  on conflict (rpc_name) do update set
    payload = excluded.payload,
    computed_at = excluded.computed_at;
end;
$$;

comment on function private.refresh_analytics_snapshot_business_summary() is
  'Recomputes the analytics_business_summary snapshot from live transactional tables and upserts it into analytics.rpc_snapshots. Identical aggregation logic to the original live public.analytics_business_summary() body (20260717180931) -- moved here so it runs on a schedule instead of per-request.';

revoke all on function private.refresh_analytics_snapshot_business_summary() from public;
revoke all on function private.refresh_analytics_snapshot_business_summary() from anon;

-- Same gate, same signature, same return type as before -- callers need no
-- change. Reads the snapshot instead of live-aggregating.
create or replace function public.analytics_business_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select payload into v_payload
  from analytics.rpc_snapshots
  where rpc_name = 'analytics_business_summary';

  return coalesce(v_payload, '{}'::jsonb);
end;
$$;

-- Lets an analyst force a recompute without waiting for the nightly cron --
-- same shape as admin_refresh_public_impact_metrics, gated by is_analyst()
-- rather than an admin permission since this is analyst-facing, not a public
-- page.
create or replace function public.admin_refresh_analytics_business_summary()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_analyst() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform private.refresh_analytics_snapshot_business_summary();
  perform private.log_audit('analytics.snapshot_recomputed', 'analytics.rpc_snapshots', null::uuid,
    jsonb_build_object('rpc_name', 'analytics_business_summary'));
end;
$$;

revoke all on function public.admin_refresh_analytics_business_summary() from public;
revoke all on function public.admin_refresh_analytics_business_summary() from anon;
grant execute on function public.admin_refresh_analytics_business_summary() to authenticated;

-- Populate immediately rather than waiting for the first cron tick.
select private.refresh_analytics_snapshot_business_summary();

-- Staggered 10 minutes behind public-impact-metrics' existing 03:20 daily
-- refresh to avoid both jobs contending for the same tables at once.
select cron.schedule('analytics-business-summary-refresh-daily', '10 3 * * *', $$select private.refresh_analytics_snapshot_business_summary();$$);

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'analytics') then
    raise exception 'analytics schema missing after migration';
  end if;

  if has_schema_privilege('authenticated', 'analytics', 'USAGE') then
    raise exception 'authenticated must not hold USAGE on schema analytics';
  end if;
  if has_schema_privilege('anon', 'analytics', 'USAGE') then
    raise exception 'anon must not hold USAGE on schema analytics';
  end if;

  if has_table_privilege('authenticated', 'analytics.rpc_snapshots', 'SELECT') then
    raise exception 'authenticated must not have direct SELECT on analytics.rpc_snapshots -- read only via public.analytics_business_summary()';
  end if;

  if not exists (select 1 from analytics.rpc_snapshots where rpc_name = 'analytics_business_summary') then
    raise exception 'analytics_business_summary snapshot was not populated';
  end if;

  if not exists (select 1 from cron.job where jobname = 'analytics-business-summary-refresh-daily') then
    raise exception 'analytics-business-summary-refresh-daily cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'public.admin_refresh_analytics_business_summary()', 'EXECUTE') then
    raise exception 'anon must not be able to execute admin_refresh_analytics_business_summary';
  end if;

  raise notice 'PASS: analytics schema + rpc_snapshots table created (not directly reachable by any role), analytics_business_summary snapshot populated, nightly refresh scheduled';
end $$;
