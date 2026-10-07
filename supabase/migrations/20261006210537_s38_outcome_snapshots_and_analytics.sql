-- S38: outcome snapshots at days 0, 30, 90 and 180, the de-identified analytics views, and the 90-day BP control report.
-- Spec 4.10, Module 22 (22.1, 22.2, 22.7, 22.8), safety case 22. Design: docs/design/S38.md. Research: docs/research/S38.md.
--
-- Depends on S25/S26 (entitlements, memberships), S08 (private.weekly_adherence, medicine_config), S10 (event bus) and the
-- existing vitals_readings (the table behind the observations view) and patient_bp_targets tables. Nothing here changes an existing table.
--
-- What this adds:
--   * outcome_config: versioned, PROPOSED values, CMO owned (mirrored as `outcomes.snapshot_rules` in the code registry).
--   * outcome_snapshots: one append-only row per person, pathway and day. BP is a 7-day average against the person's own target
--     (else 140/90); fewer than the minimum readings is `insufficient_data`, never "controlled". Adherence sits beside it, not in it.
--   * private.compute_outcome_snapshots(): daily, idempotent, bounded; emits outcome.snapshot_computed (ids only).
--   * analytics.subjects + analytics.v_outcome_snapshots (pseudonymised rows) and analytics.v_bp_control_90d_by_month (aggregates
--     with small-cell suppression). Both filter is_test themselves (INV-13, safety case 22). Service role only.
--   * public.bp_control_report(): admin or the active CMO; aggregate only, strict rate first, missing share beside every rate,
--     small cells withheld, the access written to audit_log.
--   * a new outcome_measure_specs row `bp_control_90d` so the definition is versioned and published like the existing ones.
--
-- Counts before this migration (live, 2026-10-06): no outcome_snapshots table and no analytics views existed, so there is nothing to
-- convert. Nothing in an event carries a reading or condition (INV-07): it holds ids and a day.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED values, CMO owned)
-- ---------------------------------------------------------------------------
create table public.outcome_config (
  version     integer primary key check (version >= 1),
  is_active   boolean not null default false,
  owner       text not null default 'CMO',
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null
);
create unique index outcome_config_one_active on public.outcome_config ((true)) where is_active;
alter table public.outcome_config enable row level security;
revoke all on public.outcome_config from public, anon, authenticated;

-- outcome-rules-begin
insert into public.outcome_config (version, is_active, config, note) values (1, true, $json$
{
  "days": [0, 30, 90, 180],
  "window_days": 7,
  "grace_days": 3,
  "min_readings": 3,
  "default_target": { "systolic": 140, "diastolic": 90 },
  "min_cell": 11,
  "min_cell_cross": 20,
  "report_spec": "bp_control_90d"
}
$json$::jsonb, 'PROPOSED, v1. Owner: CMO. Day 0 is the first 7 days after joining; later days are the 7 days ending on that day. A snapshot is computed once its window closed plus the grace days. Smallest cell shown 11 (20 for a cut by two attributes).');
-- outcome-rules-end

create function private.outcome_rule(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config -> p_key from public.outcome_config where is_active $$;
revoke all on function private.outcome_rule(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Snapshots
-- ---------------------------------------------------------------------------
create table public.outcome_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  pathway_code             text not null default 'bp' check (pathway_code in ('bp')),
  day                      smallint not null check (day >= 0 and day <= 730),
  anchor_date              date not null,
  window_start             date not null,
  window_end               date not null,
  bp_avg_7d_sys            numeric(5, 1),
  bp_avg_7d_dia            numeric(5, 1),
  bp_readings_7d           integer not null default 0 check (bp_readings_7d >= 0),
  bp_status                text not null check (bp_status in ('controlled', 'uncontrolled', 'insufficient_data')),
  controlled               boolean,
  target_sys               smallint not null,
  target_dia               smallint not null,
  target_source            text not null check (target_source in ('patient', 'default')),
  adherence_pct            smallint check (adherence_pct is null or adherence_pct between 0 and 100),
  adherence_doses_due      integer,
  adherence_status         text not null default 'ok' check (adherence_status in ('ok', 'no_doses', 'unavailable')),
  config_version           integer not null references public.outcome_config (version),
  computed_at              timestamptz not null default now(),
  is_test                  boolean not null default false,
  unique (patient_id, pathway_code, day),
  check (window_end >= window_start),
  check ((bp_status = 'insufficient_data') = (controlled is null)),
  check (bp_status <> 'controlled' or controlled is true),
  check (bp_status <> 'uncontrolled' or controlled is false),
  check ((bp_status = 'insufficient_data') or (bp_avg_7d_sys is not null and bp_avg_7d_dia is not null))
);
create index outcome_snapshots_day_idx on public.outcome_snapshots (pathway_code, day, anchor_date) where not is_test;
alter table public.outcome_snapshots enable row level security;
revoke all on public.outcome_snapshots from public, anon, authenticated;
grant select on public.outcome_snapshots to authenticated;
-- A person reads their own snapshots. Staff get no row-level read (aggregates only, through bp_control_report).
create policy outcome_snapshots_own on public.outcome_snapshots for select to authenticated
  using (patient_id = (select auth.uid()));

-- History is not rewritten: a snapshot is never updated or deleted (a patient deletion cascades through the owner only).
create function private.outcome_snapshots_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'outcome_snapshots_append_only' using errcode = 'P0001';
end $$;
create trigger outcome_snapshots_append_only before update on public.outcome_snapshots
  for each row execute function private.outcome_snapshots_append_only();
revoke all on function private.outcome_snapshots_append_only() from public, anon, authenticated;

insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('outcome.snapshot_computed', 'An outcome snapshot was computed', 'S38', false) on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('outcome.snapshot_computed', 1, array['snapshot_id']) on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Computation
-- ---------------------------------------------------------------------------
-- Day 0 is the date a person joined: the earliest start of a membership (any source) or a care pack / membership entitlement.
create function private.outcome_anchor(p_patient uuid) returns date
language sql stable security definer set search_path = ''
as $$
  select min(d) from (
    select (starts_at at time zone 'Africa/Lagos')::date d from public.patient_memberships where patient_id = p_patient
    union all
    select (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where patient_id = p_patient and kind in ('membership', 'care_pack')
  ) x
$$;
revoke all on function private.outcome_anchor(uuid) from public, anon, authenticated;

-- The window a day covers. Day 0 is the first window_days days after joining (nobody has a reading before they join); a later day is
-- the window_days days ending on it.
create function private.outcome_window(p_anchor date, p_day integer) returns daterange
language sql stable set search_path = ''
as $$
  select case when p_day = 0 then daterange(p_anchor, p_anchor + (private.outcome_rule('window_days') #>> '{}')::integer, '[)')
              else daterange(p_anchor + p_day - ((private.outcome_rule('window_days') #>> '{}')::integer - 1), p_anchor + p_day + 1, '[)') end
$$;
revoke all on function private.outcome_window(date, integer) from public, anon, authenticated;

create function private.outcome_compute_snapshot(p_patient uuid, p_day integer, p_now timestamptz default now()) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_anchor date := private.outcome_anchor(p_patient);
  v_win daterange;
  v_start date; v_end date;
  v_min integer := (private.outcome_rule('min_readings') #>> '{}')::integer;
  v_cfg integer := (select version from public.outcome_config where is_active);
  pr public.profiles%rowtype;
  v_t record; v_tsys integer; v_tdia integer; v_tsrc text;
  v_avg_s numeric; v_avg_d numeric; v_n integer;
  v_status text; v_ctrl boolean;
  v_adh jsonb; v_adh_pct integer; v_adh_due integer; v_adh_status text := 'ok';
  v_id uuid;
begin
  if v_anchor is null then return null; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then return null; end if;
  v_win := private.outcome_window(v_anchor, p_day);
  v_start := lower(v_win);
  v_end := upper(v_win) - 1;

  -- the person's own home target if they have one, else the configured default (and say which was used)
  select home_systolic, home_diastolic into v_t from public.patient_bp_targets
   where patient_id = p_patient and home_systolic is not null and home_diastolic is not null order by updated_at desc limit 1;
  if v_t.home_systolic is not null then
    v_tsys := v_t.home_systolic; v_tdia := v_t.home_diastolic; v_tsrc := 'patient';
  else
    v_tsys := (private.outcome_rule('default_target') ->> 'systolic')::integer;
    v_tdia := (private.outcome_rule('default_target') ->> 'diastolic')::integer;
    v_tsrc := 'default';
  end if;

  -- Readings the platform has cleared, plus readings flagged ONLY for a missing arm or position (the value is not in doubt). A reading
  -- flagged as a duplicate or a sudden change waits for a clinician and is not counted. Reads the base table, which carries the flags.
  select round(avg(systolic)::numeric, 1), round(avg(diastolic)::numeric, 1), count(*)
    into v_avg_s, v_avg_d, v_n
    from public.vitals_readings
   where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
     and (validation_status = 'valid' or coalesce(validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
     and (taken_at at time zone 'Africa/Lagos')::date between v_start and v_end;

  if v_n >= v_min then
    v_ctrl := v_avg_s < v_tsys and v_avg_d < v_tdia;
    v_status := case when v_ctrl then 'controlled' else 'uncontrolled' end;
  else
    v_status := 'insufficient_data'; v_ctrl := null; v_avg_s := null; v_avg_d := null;
  end if;

  -- adherence is stored beside BP, never inside it (22.2); S08's measure as of the end of the window
  begin
    v_adh := private.weekly_adherence(p_patient, ((v_end + 1)::timestamp at time zone 'Africa/Lagos') - interval '1 second');
    v_adh_pct := nullif(v_adh ->> 'percent', '')::integer;
    v_adh_due := nullif(v_adh ->> 'due', '')::integer;
    if v_adh_pct is null then v_adh_status := 'no_doses'; end if;
  exception when others then
    -- not the same as having no doses: it is recorded, and the report counts it (a missing medicine_config must not look like no medicines)
    v_adh_pct := null; v_adh_due := null; v_adh_status := 'unavailable';
  end;

  insert into public.outcome_snapshots (organisation_id, patient_id, pathway_code, day, anchor_date, window_start, window_end,
      bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d, bp_status, controlled, target_sys, target_dia, target_source,
      adherence_pct, adherence_doses_due, adherence_status, config_version, computed_at, is_test)
  values (pr.organisation_id, p_patient, 'bp', p_day, v_anchor, v_start, v_end,
      v_avg_s, v_avg_d, v_n, v_status, v_ctrl, v_tsys, v_tdia, v_tsrc,
      v_adh_pct, v_adh_due, v_adh_status, v_cfg, p_now, coalesce(pr.is_test, false))
  on conflict (patient_id, pathway_code, day) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into analytics.subjects (patient_id) values (p_patient) on conflict (patient_id) do nothing;
    perform private.emit_domain_event('outcome.snapshot_computed', pr.organisation_id,
      jsonb_build_object('snapshot_id', v_id, 'day', p_day), 'outcome:' || p_patient || ':bp:' || p_day, p_patient, 'outcome_snapshot', v_id);
  end if;
  return v_id;
end $$;
revoke all on function private.outcome_compute_snapshot(uuid, integer, timestamptz) from public, anon, authenticated;

-- Daily: every joined person and every configured day whose window has closed (plus the grace for offline readings) and has no snapshot.
-- Idempotent, bounded, one person's failure never stops the rest.
create function private.compute_outcome_snapshots(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_grace integer := (private.outcome_rule('grace_days') #>> '{}')::integer;
  r record; d integer; v_win daterange; n integer := 0; v_failed integer := 0; v_last text; v_org uuid;
begin
  -- Only people with a due day that has no snapshot yet, oldest due first, so a large backlog of finished people never crowds out new ones.
  for r in
    select a.patient_id, a.anchor from (
      select patient_id, min(dt) as anchor from (
        select patient_id, (starts_at at time zone 'Africa/Lagos')::date dt from public.patient_memberships
        union all
        select patient_id, (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where kind in ('membership', 'care_pack')
      ) u group by patient_id) a
     where exists (
       select 1 from jsonb_array_elements_text(private.outcome_rule('days')) dd(day)
        where upper(private.outcome_window(a.anchor, dd.day::integer)) - 1 + v_grace <= v_today
          and not exists (select 1 from public.outcome_snapshots s where s.patient_id = a.patient_id and s.pathway_code = 'bp' and s.day = dd.day::integer))
     order by a.anchor limit 5000
  loop
    for d in select jsonb_array_elements_text(private.outcome_rule('days'))::integer loop
      v_win := private.outcome_window(r.anchor, d);
      continue when upper(v_win) - 1 + v_grace > v_today;
      continue when exists (select 1 from public.outcome_snapshots where patient_id = r.patient_id and pathway_code = 'bp' and day = d);
      begin
        if private.outcome_compute_snapshot(r.patient_id, d, p_now) is not null then n := n + 1; end if;
      exception when others then
        v_failed := v_failed + 1; v_last := sqlerrm;
      end;
    end loop;
  end loop;
  -- A failure is never only a log line: count it and open one incident a person will see.
  if v_failed > 0 then
    select id into v_org from public.organisations order by created_at limit 1;
    if exists (select 1 from public.ops_incidents where external_reference = 'outcome-snapshots-failing' and status not in ('resolved', 'closed')) then
      update public.ops_incidents set summary = v_failed || ' snapshots failed on the last run (' || left(v_last, 200) || ').'
       where external_reference = 'outcome-snapshots-failing' and status not in ('resolved', 'closed');
    else
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (v_org, 'operational', 'sev3', 'Outcome snapshots are failing',
              v_failed || ' snapshots failed on the last run (' || left(v_last, 200) || '). Outcome reports cover fewer people until it is fixed.',
              'outcome-snapshots-failing', now() + interval '1 day', now() + interval '3 days');
    end if;
  end if;
  return n;
end $$;
revoke all on function private.compute_outcome_snapshots(timestamptz) from public, anon, authenticated;
select cron.schedule('outcome-snapshots', '40 1 * * *', $$ select private.compute_outcome_snapshots(); $$);

-- ---------------------------------------------------------------------------
-- 4. The de-identified analytics layer (service role only; test accounts never appear: INV-13, safety case 22)
-- ---------------------------------------------------------------------------
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to service_role;

-- a random pseudonym per person; the patient id never leaves this table
create table analytics.subjects (
  patient_id  uuid primary key references public.profiles (id) on delete cascade,
  subject_key uuid not null unique default gen_random_uuid(),
  created_at  timestamptz not null default now()
);
alter table analytics.subjects enable row level security;
revoke all on analytics.subjects from public, anon, authenticated;

create view analytics.v_outcome_snapshots with (security_invoker = off) as
  select sub.subject_key, s.organisation_id, s.pathway_code, s.day,
         date_trunc('month', s.anchor_date)::date as enrolment_month,
         s.bp_avg_7d_sys, s.bp_avg_7d_dia, s.bp_readings_7d, s.bp_status, s.target_source,
         s.adherence_pct, s.adherence_doses_due, s.config_version, s.computed_at::date as computed_on
    from public.outcome_snapshots s
    join analytics.subjects sub on sub.patient_id = s.patient_id
    join public.profiles pr on pr.id = s.patient_id
   where not s.is_test and not coalesce(pr.is_test, false);
revoke all on analytics.v_outcome_snapshots from public, anon, authenticated;
grant select on analytics.v_outcome_snapshots to service_role;
comment on view analytics.v_outcome_snapshots is
  'Pseudonymised rows (random subject_key, enrolment month, no patient id, no dates finer than a month, no test accounts). Pseudonymised is not anonymised: service role only, and never export row-level. Shareable numbers come from v_bp_control_90d_by_month.';

-- ---------------------------------------------------------------------------
-- 5. The 90-day BP control measure and report
-- ---------------------------------------------------------------------------
insert into public.outcome_measure_specs (code, spec_version, title, domain, rationale, numerator_definition, denominator_definition,
    exclusion_definition, limitations, data_sources, unit, direction, min_denominator, compute_key, effective_from)
select 'bp_control_90d', 1, 'Blood pressure control 90 days after joining', 'clinical_outcome',
       'Shows whether people who joined the programme have their blood pressure under control after three months, counting people who stopped logging as not controlled so the figure cannot be flattered by drop-out.',
       'People whose 7-day average home blood pressure in the window ending on day 90 is under their own target (or under 140/90 when none is set), from at least the minimum number of valid readings.',
       'Every person who joined and whose day-90 window has closed, including people with too few or no readings (headline). Also shown: among people with enough readings, and among people whose day-0 average was above target.',
       'Test accounts. Readings flagged as a duplicate or a sudden change (they wait for a clinician). Free users who have not joined. Nobody is excluded for missing readings: they are counted and shown.',
       'Home readings on shared or unvalidated devices; readings that sync after the grace period are not added to a past snapshot; a before and after view without a comparison group says nothing about cause; small numbers are withheld; not a ranking of clinicians and never a reason to deny care.',
       array['vitals_readings', 'patient_bp_targets', 'patient_memberships', 'entitlements'], '% of people', 'higher_is_better', 11, 'bp_control_90d', current_date
where not exists (select 1 from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = 1);

-- Cohort shaping with suppression. n under the minimum shows nothing but that; if any category count is 1 to min-1 the whole cohort's counts
-- and rates are withheld (so subtraction cannot reveal a small cell). Zero is not a small cell.
create function private.outcome_cohort_json(p_n integer, p_ctrl integer, p_unctrl integer, p_insuf integer, p_min integer) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare small boolean := (p_ctrl between 1 and p_min - 1) or (p_unctrl between 1 and p_min - 1) or (p_insuf between 1 and p_min - 1);
begin
  if p_n < p_min then return jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', p_min); end if;
  if small then return jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'n', p_n, 'minimum', p_min); end if;
  return jsonb_build_object('suppressed', false, 'n', p_n, 'controlled', p_ctrl, 'uncontrolled', p_unctrl, 'insufficient_data', p_insuf,
    'rate_strict_pct', round(100.0 * p_ctrl / p_n, 1),
    'rate_among_measured_pct', case when p_ctrl + p_unctrl >= p_min then round(100.0 * p_ctrl / (p_ctrl + p_unctrl), 1) end,
    'missing_pct', round(100.0 * p_insuf / p_n, 1));
end $$;
revoke all on function private.outcome_cohort_json(integer, integer, integer, integer, integer) from public, anon, authenticated;

-- The one place the cohort is defined and test accounts are excluded (INV-13): a snapshot flagged test, or a person flagged test now.
create view private.v_bp_cohort_90d with (security_invoker = off) as
  select s90.patient_id, s90.anchor_date as anchor, s90.bp_status as s90, s0.bp_status as s0,
         case when s90.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s90.bp_avg_7d_sys - s0.bp_avg_7d_sys end as d_sys,
         case when s90.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s90.bp_avg_7d_dia - s0.bp_avg_7d_dia end as d_dia,
         s90.adherence_pct::integer as adh, s90.adherence_status = 'unavailable' as adh_unavailable, s90.target_source = 'default' as defaulted,
         exists (select 1 from public.vitals_readings o where o.patient_id = s90.patient_id and o.vital_type = 'blood_pressure'
                    and (o.validation_status = 'valid' or coalesce(o.validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
                    and (o.taken_at at time zone 'Africa/Lagos')::date between s90.window_start and s90.window_end and o.created_at > s90.computed_at) as late
    from public.outcome_snapshots s90
    join public.profiles pr on pr.id = s90.patient_id
    left join public.outcome_snapshots s0 on s0.patient_id = s90.patient_id and s0.pathway_code = s90.pathway_code and s0.day = 0
   where s90.pathway_code = 'bp' and s90.day = 90 and not s90.is_test and not coalesce(pr.is_test, false);
revoke all on private.v_bp_cohort_90d from public, anon, authenticated;

create function private.bp_control_aggregate(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := (private.outcome_rule('min_cell') #>> '{}')::integer;
  v_grace integer := (private.outcome_rule('grace_days') #>> '{}')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  a record; b record; q record; m jsonb; v_enrolled integer; v_notdue integer; v_months_withheld integer := 0;
begin
  -- Reports are by whole calendar month of joining: two ranges one day apart could otherwise be subtracted to expose a small cohort.
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;
  drop table if exists pg_temp._s38_cohort;
  create temp table _s38_cohort on commit drop as
    select * from private.v_bp_cohort_90d c
     where (p_from is null or c.anchor >= p_from) and (p_to is null or c.anchor <= p_to);

  select count(*) as n, count(*) filter (where s90 = 'controlled') c, count(*) filter (where s90 = 'uncontrolled') u,
         count(*) filter (where s90 = 'insufficient_data') i,
         count(*) filter (where s0 is null or s0 = 'insufficient_data') base_missing,
         count(*) filter (where d_sys is not null) n_both, avg(d_sys) filter (where d_sys is not null) mean_d_sys, avg(d_dia) filter (where d_dia is not null) mean_d_dia,
         count(*) filter (where adh is not null) n_adh, avg(adh) filter (where adh is not null) mean_adh, count(*) filter (where adh_unavailable) n_adh_unavail,
         count(*) filter (where defaulted) n_def, count(*) filter (where late) n_late
    into a from _s38_cohort;
  select count(*) as n, count(*) filter (where s90 = 'controlled') c, count(*) filter (where s90 = 'uncontrolled') u,
         count(*) filter (where s90 = 'insufficient_data') i
    into b from _s38_cohort where s0 = 'uncontrolled';

  select count(*) into v_enrolled from (
    select j.patient_id, min(j.dt) anchor from (
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date dt from public.patient_memberships
      union all
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where kind in ('membership', 'care_pack')) j
      join public.profiles p on p.id = j.patient_id and not coalesce(p.is_test, false)
     group by j.patient_id) e
   where (p_from is null or e.anchor >= p_from) and (p_to is null or e.anchor <= p_to);
  v_notdue := greatest(v_enrolled - a.n, 0);

  m := '[]'::jsonb;
  for q in select date_trunc('month', anchor)::date mon, count(*) n, count(*) filter (where s90 = 'controlled') c, count(*) filter (where s90 = 'uncontrolled') u,
                  count(*) filter (where s90 = 'insufficient_data') i from _s38_cohort group by 1 order by 1 loop
    if q.n >= v_min and not ((q.c between 1 and v_min - 1) or (q.u between 1 and v_min - 1) or (q.i between 1 and v_min - 1)) then
      m := m || jsonb_build_array(jsonb_build_object('enrolment_month', q.mon) || private.outcome_cohort_json(q.n::integer, q.c::integer, q.u::integer, q.i::integer, v_min));
    else
      v_months_withheld := v_months_withheld + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'measure', 'bp_control_90d', 'measure_version', 1,
    'config_version', (select version from public.outcome_config where is_active),
    'minimum_cell', v_min,
    'cohort_all_due', private.outcome_cohort_json(a.n::integer, a.c::integer, a.u::integer, a.i::integer, v_min),
    -- The baseline cohort is a subset of everyone due: show it only when what is left over (people who started under target or unmeasured) is itself
    -- either empty or large enough in every category, so subtraction cannot expose a small group.
    'cohort_baseline_uncontrolled', case
        when (a.n - b.n = 0 or a.n - b.n >= v_min)
         and ((a.c - b.c) = 0 or (a.c - b.c) >= v_min) and ((a.u - b.u) = 0 or (a.u - b.u) >= v_min) and ((a.i - b.i) = 0 or (a.i - b.i) >= v_min)
        then private.outcome_cohort_json(b.n::integer, b.c::integer, b.u::integer, b.i::integer, v_min)
        else jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'minimum', v_min) end,
    'change_among_measured', case when a.n_both >= v_min then jsonb_build_object('n', a.n_both, 'mean_systolic_change', round(a.mean_d_sys, 1), 'mean_diastolic_change', round(a.mean_d_dia, 1))
                                  else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'adherence_separate', case when a.n_adh >= v_min then jsonb_build_object('n', a.n_adh, 'mean_pct', round(a.mean_adh, 1))
                               else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    -- If any month is withheld the list is not returned at all: the withheld month would equal the overall total minus the listed ones.
    'by_enrolment_month', case when v_months_withheld = 0 then m else '[]'::jsonb end, 'months_withheld', v_months_withheld,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'data_quality', case when a.n >= v_min then jsonb_build_object(
        'enrolled_total', v_enrolled, 'not_yet_due', v_notdue,
        'baseline_missing_pct', round(100.0 * a.base_missing / a.n, 1),
        'day90_no_reading_pct', round(100.0 * a.i / a.n, 1),
        'default_target_used_pct', round(100.0 * a.n_def / a.n, 1),
        'adherence_unavailable_pct', round(100.0 * a.n_adh_unavail / a.n, 1),
        'readings_arriving_after_snapshot_pct', round(100.0 * a.n_late / a.n, 1))
      else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min, 'enrolled_total', v_enrolled, 'not_yet_due', v_notdue) end,
    'definition', (select numerator_definition || ' Denominator: ' || denominator_definition from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = 1),
    'limitations', (select limitations from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = 1),
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.bp_control_aggregate(date, date) from public, anon, authenticated;

create function public.bp_control_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_r jsonb;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  v_r := private.bp_control_aggregate(p_from, p_to);
  perform private.log_audit('outcomes.bp_control_report', 'outcome_report', null, jsonb_build_object('from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.bp_control_report(date, date) from public, anon;
grant execute on function public.bp_control_report(date, date) to authenticated;

-- Aggregates by enrolment month for BI. Cells under the minimum, and months with any small category, are not returned.
create view analytics.v_bp_control_90d_by_month with (security_invoker = off) as
  with c as (
    select date_trunc('month', s.anchor_date)::date as enrolment_month, count(*) n,
           count(*) filter (where s.bp_status = 'controlled') ctrl, count(*) filter (where s.bp_status = 'uncontrolled') unctrl,
           count(*) filter (where s.bp_status = 'insufficient_data') insuf
      from public.outcome_snapshots s join public.profiles pr on pr.id = s.patient_id
     where s.pathway_code = 'bp' and s.day = 90 and not s.is_test and not coalesce(pr.is_test, false) group by 1)
  select enrolment_month, n, ctrl as controlled, unctrl as uncontrolled, insuf as insufficient_data,
         round(100.0 * ctrl / n, 1) as rate_strict_pct,
         round(100.0 * insuf / n, 1) as missing_pct
    from c, lateral (select (private.outcome_rule('min_cell') #>> '{}')::integer as m) cfg
   where n >= cfg.m
     and not ((ctrl between 1 and cfg.m - 1) or (unctrl between 1 and cfg.m - 1) or (insuf between 1 and cfg.m - 1));
revoke all on analytics.v_bp_control_90d_by_month from public, anon, authenticated;
grant select on analytics.v_bp_control_90d_by_month to service_role;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.outcome_snapshots', 'SELECT') then raise exception 'S38: anon can read snapshots'; end if;
  if has_table_privilege('authenticated', 'public.outcome_snapshots', 'INSERT,UPDATE,DELETE') then raise exception 'S38: authenticated can write snapshots'; end if;
  if has_table_privilege('authenticated', 'analytics.v_outcome_snapshots', 'SELECT') or has_table_privilege('anon', 'analytics.v_outcome_snapshots', 'SELECT') then raise exception 'S38: analytics view is readable by a user'; end if;
  if has_table_privilege('authenticated', 'analytics.subjects', 'SELECT') then raise exception 'S38: pseudonym table is readable by a user'; end if;
  if has_function_privilege('anon', 'public.bp_control_report(date,date)', 'EXECUTE') then raise exception 'S38: anon can run the report'; end if;
  if has_function_privilege('authenticated', 'private.compute_outcome_snapshots(timestamptz)', 'EXECUTE') then raise exception 'S38: a user can run the snapshot job'; end if;
end $$;
