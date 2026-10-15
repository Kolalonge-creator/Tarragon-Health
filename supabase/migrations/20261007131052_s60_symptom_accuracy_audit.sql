-- S60 part 2 of 3: the monthly accuracy audit of the symptom checker (spec 12.12).
--
-- WHAT IT DOES. Once a month it compares, for every symptom check a clinician has reviewed that month, the checker's urgency
-- category with the clinician's own category (public.symptom_reviews, part 1), and stores an AGGREGATE report: overall, and one
-- way by age band, sex and region. For each cell: how many reviewed, how often the checker matched the clinician, how often it
-- UNDER-triaged (was less urgent than the clinician, the unsafe direction) and how often it over-triaged, each with a Wilson
-- score interval. Top-suggestion accuracy against the final diagnosis cannot be measured yet because no possible-causes screen
-- exists (founder decision of 2026-10-07: interface plus in-house adapter only); the final diagnosis code is recorded now so
-- that measurement can be added without a backfill.
--
-- WHAT IT REFUSES TO DO.
--   * No figure is ever publishable: `publishable` is a column with a CHECK that it is false. The first report that has something in
--     it, per basis, is the BASELINE (is_baseline; an empty month is recorded but is never the baseline), recorded for the go-live
--     guard, and is not an accuracy claim. Publishing a number needs an independent local validation and a founder decision, which
--     would change this constraint in a reviewed migration.
--   * Small cells are suppressed (fewer reviewed cases than the configured minimum: counts and rates become null), and when
--     exactly one cell of a dimension is suppressed the smallest remaining cell is suppressed with it, so a suppressed cell
--     cannot be recovered by subtracting from the overall figure.
--   * Test accounts are excluded (INV-13). Only an admin or the CMO may deliberately include them, to build a pre-launch
--     validation baseline from clinician-reviewed test sessions; that report is marked includes_test_accounts and the founder
--     decides whether it may satisfy the guard (OQ-S60-04). The scheduled job never includes them.
--   * It measures what the checker said (symptom_triage_assessments.category), not a clinician's later override of it: the question is how
--     the checker itself performed.
--   * Aggregates only: no patient id, name or note is stored in a report (INV-12). The report is readable by an admin or the CMO.
--
-- CONFIG. public.symptom_accuracy_config is versioned (INV-16); the active row is read at run time and its version is stored on
-- every report. Seed v1 mirrors the PROPOSED `symptom.accuracy_audit` entry (a Jest test fails if they drift). Not signed by
-- anyone: min cell size, confidence level and age bands await the CMO.
--
-- ROWS AFFECTED: none changed; two new tables and one config row. The scheduled job (pg_cron, 03:30 UTC on the 2nd of each month)
-- writes a report only for organisations that have at least one completed non-test review in the previous month, so there is
-- never an empty baseline.

create table public.symptom_accuracy_config (
  version    integer primary key check (version >= 1),
  config     jsonb not null,
  notes      text,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index symptom_accuracy_config_one_active on public.symptom_accuracy_config (is_active) where is_active;
alter table public.symptom_accuracy_config enable row level security;
revoke all on public.symptom_accuracy_config from public, anon, authenticated;
create policy symptom_accuracy_config_read on public.symptom_accuracy_config
  for select to authenticated using (private.is_admin() or private.credential_is_cmo());
grant select on public.symptom_accuracy_config to authenticated;

-- accuracy-config-begin
insert into public.symptom_accuracy_config (version, config, notes, is_active)
values (1, $json$
{"min_cell_size": 10, "confidence_level": 0.95, "age_bands": [[0, 4], [5, 17], [18, 39], [40, 59], [60, 150]]}
$json$::jsonb, 'PROPOSED, not signed. Mirrors the symptom.accuracy_audit entry in packages/shared/src/proposed-config.', true);
-- accuracy-config-end

create table public.symptom_accuracy_reports (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  period_start           date not null,
  period_end             date not null,
  config_version         integer not null references public.symptom_accuracy_config (version) on delete restrict,
  is_baseline            boolean not null,
  includes_test_accounts boolean not null default false,
  reviewed_total         integer not null check (reviewed_total >= 0),
  -- array of cells: {dimension, group, suppressed, n, matched, under, over, match_rate, under_rate, over_rate, *_low, *_high}
  cells                  jsonb not null,
  generated_by           uuid references public.profiles (id) on delete set null,
  generated_at           timestamptz not null default now(),
  -- NEVER true in this build: a published accuracy figure needs independent local validation and a founder decision
  publishable            boolean not null default false check (publishable = false),
  unique (organisation_id, period_start, includes_test_accounts),
  check (period_end > period_start)
);
alter table public.symptom_accuracy_reports enable row level security;
revoke all on public.symptom_accuracy_reports from public, anon, authenticated;
create policy symptom_accuracy_reports_read on public.symptom_accuracy_reports
  for select to authenticated
  using ((private.is_admin() or private.credential_is_cmo()) and organisation_id = private.caller_org());
grant select on public.symptom_accuracy_reports to authenticated;

create or replace function private.symptom_accuracy_reports_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'an accuracy report is a permanent record and cannot be changed or deleted' using errcode = '42501';
end $$;
create trigger symptom_accuracy_reports_00_immutable
  before update or delete on public.symptom_accuracy_reports
  for each row execute function private.symptom_accuracy_reports_immutable();

-- Wilson score interval for k successes of n at the confidence in the config. Returns {low, high}, or nulls when n = 0.
create or replace function private.wilson_interval(p_k integer, p_n integer, p_confidence numeric) returns numeric[]
language plpgsql immutable set search_path = ''
as $$
declare
  z numeric;
  p numeric;
  denom numeric;
  centre numeric;
  margin numeric;
begin
  if p_n is null or p_n <= 0 then return array[null::numeric, null::numeric]; end if;
  z := case p_confidence when 0.90 then 1.6448536 when 0.95 then 1.9599640 when 0.99 then 2.5758293
       else null end;
  if z is null then raise exception 'unsupported confidence level %, use 0.90, 0.95 or 0.99', p_confidence using errcode = '22023'; end if;
  p := p_k::numeric / p_n;
  denom := 1 + z * z / p_n;
  centre := p + z * z / (2 * p_n);
  margin := z * sqrt(p * (1 - p) / p_n + z * z / (4 * p_n * p_n));
  return array[round(greatest(0, (centre - margin) / denom), 4), round(least(1, (centre + margin) / denom), 4)];
end $$;
revoke all on function private.wilson_interval(integer, integer, numeric) from public, anon, authenticated;

-- The audit for one organisation and one month. Idempotent: a report that exists is returned, never rewritten (the baseline stays).
create or replace function private.run_symptom_accuracy_audit(p_org uuid, p_month date, p_include_test boolean default false, p_by uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month::timestamp)::date;
  v_end date := (date_trunc('month', p_month::timestamp) + interval '1 month')::date;
  -- month boundaries are Africa/Lagos midnights, whatever the session time zone
  v_start_ts timestamptz := (date_trunc('month', p_month::timestamp)) at time zone 'Africa/Lagos';
  v_end_ts timestamptz := (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Africa/Lagos';
  cfg public.symptom_accuracy_config%rowtype;
  v_min integer;
  v_conf numeric;
  v_bands jsonb;
  v_cells jsonb;
  v_total integer;
  v_id uuid;
begin
  select id into v_id from public.symptom_accuracy_reports
   where organisation_id = p_org and period_start = v_start and includes_test_accounts = p_include_test;
  if v_id is not null then return v_id; end if;

  select * into cfg from public.symptom_accuracy_config where is_active;
  if not found then raise exception 'no active symptom_accuracy_config' using errcode = 'P0001'; end if;
  v_min := (cfg.config ->> 'min_cell_size')::integer;
  v_conf := (cfg.config ->> 'confidence_level')::numeric;
  v_bands := cfg.config -> 'age_bands';
  if v_min is null or v_min < 5 then raise exception 'min_cell_size must be at least 5' using errcode = '22023'; end if;

  with base as (
    select
      (a.category = r.clinician_category) as matched,
      (private.triage_rank(a.category) < private.triage_rank(r.clinician_category)) as is_under,
      (private.triage_rank(a.category) > private.triage_rank(r.clinician_category)) as is_over,
      coalesce((select (b ->> 0) || '-' || (b ->> 1)
                  from jsonb_array_elements(v_bands) b
                 where p.date_of_birth is not null
                   and extract(year from age((r.reviewed_at at time zone 'Africa/Lagos')::date, p.date_of_birth))::integer between (b ->> 0)::integer and (b ->> 1)::integer
                 limit 1), 'unknown') as age_band,
      coalesce(p.sex::text, 'unknown') as sex,
      coalesce(nullif(btrim(p.state), ''), 'unknown') as region
    from public.symptom_reviews r
    join public.symptom_triage_assessments a on a.id = r.assessment_id
    join public.profiles p on p.id = r.patient_id
    where r.organisation_id = p_org and r.status = 'completed'
      and r.reviewed_at >= v_start_ts and r.reviewed_at < v_end_ts
      and (p_include_test or (not r.is_test and not coalesce(p.is_test, false)))
  ),
  dims as (
    select 'overall'::text as dimension, 'all'::text as grp, count(*)::integer n,
           count(*) filter (where matched)::integer n_matched, count(*) filter (where is_under)::integer n_under, count(*) filter (where is_over)::integer n_over from base
    union all select 'age_band', age_band, count(*)::integer, count(*) filter (where matched)::integer, count(*) filter (where is_under)::integer, count(*) filter (where is_over)::integer from base group by age_band
    union all select 'sex', sex, count(*)::integer, count(*) filter (where matched)::integer, count(*) filter (where is_under)::integer, count(*) filter (where is_over)::integer from base group by sex
    union all select 'region', region, count(*)::integer, count(*) filter (where matched)::integer, count(*) filter (where is_under)::integer, count(*) filter (where is_over)::integer from base group by region
  ),
  flagged as (
    select d.*,
           (d.n < v_min) as small,
           count(*) filter (where d.n < v_min) over (partition by d.dimension) as small_in_dim,
           row_number() over (partition by d.dimension, (d.n < v_min) order by d.n, d.grp) as rn_in_class
      from dims d
  ),
  decided as (
    select f.*,
           -- complementary suppression: one suppressed cell is recoverable by subtraction, so suppress the smallest remaining one too
           (f.small or (f.dimension <> 'overall' and f.small_in_dim = 1 and not f.small and f.rn_in_class = 1)) as suppress
      from flagged f
  )
  select coalesce(jsonb_agg(
           case when d.suppress then
             jsonb_build_object('dimension', d.dimension, 'group', d.grp, 'suppressed', true)
           else
             jsonb_build_object('dimension', d.dimension, 'group', d.grp, 'suppressed', false, 'n', d.n,
               'matched', d.n_matched, 'under', d.n_under, 'over', d.n_over,
               'match_rate', round(d.n_matched::numeric / d.n, 4), 'under_rate', round(d.n_under::numeric / d.n, 4), 'over_rate', round(d.n_over::numeric / d.n, 4),
               'match_low', (private.wilson_interval(d.n_matched, d.n, v_conf))[1], 'match_high', (private.wilson_interval(d.n_matched, d.n, v_conf))[2],
               'under_low', (private.wilson_interval(d.n_under, d.n, v_conf))[1], 'under_high', (private.wilson_interval(d.n_under, d.n, v_conf))[2],
               'over_low', (private.wilson_interval(d.n_over, d.n, v_conf))[1], 'over_high', (private.wilson_interval(d.n_over, d.n, v_conf))[2])
           end order by d.dimension, d.grp), '[]'::jsonb),
         coalesce(max(d.n) filter (where d.dimension = 'overall'), 0)
    into v_cells, v_total
    from decided d;

  insert into public.symptom_accuracy_reports
    (organisation_id, period_start, period_end, config_version, is_baseline, includes_test_accounts, reviewed_total, cells, generated_by)
  values
    (p_org, v_start, v_end, cfg.version,
     -- the baseline is the first report that has something in it, per basis (real accounts, or test accounts deliberately included).
     -- An empty month is recorded but is never the baseline: an empty record must not read as a baseline in the go-live condition.
     v_total > 0 and not exists (select 1 from public.symptom_accuracy_reports x
                                  where x.organisation_id = p_org and x.is_baseline and x.includes_test_accounts = p_include_test),
     p_include_test, v_total, v_cells, p_by)
  on conflict (organisation_id, period_start, includes_test_accounts) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.symptom_accuracy_reports
     where organisation_id = p_org and period_start = v_start and includes_test_accounts = p_include_test;
  end if;
  return v_id;
end $$;
revoke all on function private.run_symptom_accuracy_audit(uuid, date, boolean, uuid) from public, anon, authenticated;

-- The scheduled monthly job: the previous month, every organisation that has something to report.
create or replace function private.run_symptom_accuracy_audit_monthly() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_month date := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month')::date;
  v_from timestamptz := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month') at time zone 'Africa/Lagos';
  v_to timestamptz := date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct s.organisation_id
      from public.symptom_reviews s
      join public.profiles p on p.id = s.patient_id
     where s.status = 'completed' and not s.is_test and not coalesce(p.is_test, false)
       and s.reviewed_at >= v_from and s.reviewed_at < v_to
  loop
    begin
      perform private.run_symptom_accuracy_audit(r.organisation_id, v_month, false, null);
      v_n := v_n + 1;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, event)
        values (r.organisation_id, 'symptom_accuracy_audit.error', 'symptom_accuracy_report', jsonb_build_object('month', v_month, 'error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'symptom_accuracy_audit_failed:' || v_month, 'The monthly symptom checker audit failed',
        'The monthly accuracy audit could not be produced; see audit_log action symptom_accuracy_audit.error.');
    end;
  end loop;
  return v_n;
end $$;
revoke all on function private.run_symptom_accuracy_audit_monthly() from public, anon, authenticated;

select cron.schedule('symptom-accuracy-audit-monthly', '30 3 2 * *', $$ select private.run_symptom_accuracy_audit_monthly(); $$);

-- An admin or the CMO can produce the report now (for the baseline), optionally including test sessions.
create or replace function public.run_symptom_accuracy_audit_now(p_month date, p_include_test boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'only an admin or the Chief Medical Officer can run the audit' using errcode = '42501';
  end if;
  if p_month is null then raise exception 'say which month' using errcode = '22023'; end if;
  if date_trunc('month', p_month::timestamp) >= date_trunc('month', now() at time zone 'Africa/Lagos') then
    raise exception 'choose a month that has finished' using errcode = '22023';
  end if;
  v_id := private.run_symptom_accuracy_audit(private.caller_org(), p_month, coalesce(p_include_test, false), v_uid);
  perform private.log_audit('symptom_accuracy_audit.run', 'symptom_accuracy_report', v_id, jsonb_build_object('month', p_month, 'include_test', coalesce(p_include_test, false)));
  return v_id;
end $$;
revoke all on function public.run_symptom_accuracy_audit_now(date, boolean) from public;
grant execute on function public.run_symptom_accuracy_audit_now(date, boolean) to authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'symptom-accuracy-audit-monthly') then raise exception 'S60 assertion: the monthly job is not scheduled'; end if;
  if has_function_privilege('anon', 'public.run_symptom_accuracy_audit_now(date,boolean)', 'EXECUTE') then raise exception 'S60 assertion: anon can run the audit'; end if;
  if has_table_privilege('authenticated', 'public.symptom_accuracy_reports', 'INSERT') or has_table_privilege('authenticated', 'public.symptom_accuracy_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.symptom_accuracy_reports', 'DELETE') then
    raise exception 'S60 assertion: authenticated can write an accuracy report';
  end if;
  if private.wilson_interval(5, 10, 0.95) <> array[0.2366, 0.7634] then
    raise exception 'S60 assertion: wilson interval for 5 of 10 is %, expected {0.2366,0.7634}', private.wilson_interval(5, 10, 0.95);
  end if;
end $$;
