-- S75b: outcome snapshots for HbA1c, weight, PHQ-9 and GAD-7 (22.1); the report that shows them only once the CMO has signed the definitions.
-- Design: docs/design/S75.md. Research: docs/research/S75.md. Decisions: S75-1 (BP basis unchanged), S75-2 (severity-banded, with a caveat,
-- anyone with PHQ-9 item 9 above zero or a score of 20 or more is routed to the EXISTING mental-health follow-up and never appears in a report).
-- Depends on S75a (private.min_cell_floor / suppress_*), S38 (outcome_anchor, outcome_config) and S37 (proposed_config_signoffs).
--
-- What this adds:
--   * outcome_measure_config: versioned, PROPOSED, CMO owned, mirrored as `outcomes.measures` in the code registry (drift test). Immutable once
--     written (a change is a new version), because a sign-off is bound to a version.
--   * private.outcome_measures_signed(): true only when the CMO's latest recorded decision for the ACTIVE config version is "confirmed"
--     (proposed_config_signoffs, key outcomes.measures). Unsigned means every report withholds its figures. Nothing is signed by this migration.
--   * outcome_measure_snapshots: one append-only row per person, measure and day (0, 90, 180). No policy and no grant: nobody reads rows;
--     reports are aggregates only. A person excluded for pregnancy, age under 18 or safeguarding has NO value stored at all.
--   * private.compute_outcome_measure_snapshots(): daily, idempotent, bounded; reuses S38's anchor ("day 0 is the day a person joined").
--   * private.ensure_mental_health_followup(): defence in depth. A PHQ-9 with item 9 above zero or a score of 20+ is already routed by the
--     existing trigger on insert; if no follow-up exists for such a screen when the job meets it, the same kind of alert is raised.
--   * public.outcome_measures_report(measure, from, to): admin or the active CMO; aggregate only; every cell through private.suppress_*.
--
-- Counts before this migration (local replay, 2026-10-07): the tables did not exist; nothing to convert. On production there are 0 current members
-- (S38c note), so the first snapshots appear when people join. Events: none new (ids only would add nothing a report needs).

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned) and the sign-off gate
-- ---------------------------------------------------------------------------
create table public.outcome_measure_config (
  version     integer primary key check (version >= 1),
  is_active   boolean not null default false,
  owner       text not null default 'CMO',
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  note        text,
  created_at  timestamptz not null default now()
);
create unique index outcome_measure_config_one_active on public.outcome_measure_config ((true)) where is_active;
alter table public.outcome_measure_config enable row level security;
revoke all on public.outcome_measure_config from public, anon, authenticated;

-- A sign-off binds to a version, so the value of a version may never change after the fact (only is_active may).
create function private.outcome_measure_config_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'outcome_measure_config_immutable' using errcode = 'P0001'; end if;
  if new.config is distinct from old.config or new.version is distinct from old.version or new.owner is distinct from old.owner then
    raise exception 'outcome_measure_config_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger outcome_measure_config_immutable before update or delete on public.outcome_measure_config
  for each row execute function private.outcome_measure_config_immutable();
revoke all on function private.outcome_measure_config_immutable() from public, anon, authenticated;

-- measures-rules-begin
insert into public.outcome_measure_config (version, is_active, config, note) values (1, true, $json$
{
  "days": [0, 90, 180],
  "grace_days": 3,
  "min_age_years": 18,
  "hba1c": { "baseline_before_days": 90, "baseline_after_days": 14, "half_width_days": 30, "meaningful_change_pp": 0.5, "target_pct": 7.0, "min_plausible": 3.0, "max_plausible": 20.0 },
  "weight": { "baseline_before_days": 14, "baseline_after_days": 14, "half_width_days": 14, "loss_pct": 5.0 },
  "phq9": { "baseline_before_days": 30, "baseline_after_days": 14, "half_width_days": 21, "response_pct": 50, "remission_below": 5, "meaningful_change": 5,
            "safeguard_item9_above": 0, "safeguard_score_from": 20,
            "bands": [["minimal", 0, 4], ["mild", 5, 9], ["moderate", 10, 14], ["moderately_severe", 15, 19], ["severe", 20, 27]] },
  "gad7": { "baseline_before_days": 30, "baseline_after_days": 14, "half_width_days": 21, "response_pct": 50, "remission_below": 5, "meaningful_change": 4,
            "bands": [["minimal", 0, 4], ["mild", 5, 9], ["moderate", 10, 14], ["severe", 15, 21]] },
  "response_times": { "min_clinicians_per_group": 3, "priority_bands": { "urgent": [1, 2], "soon": [3, 5], "routine": [6, 9] } },
  "retention": { "days": [30, 90, 180], "engaged_window_days": 30 },
  "pack": {
    "evaluation_design": "What this pack is: a descriptive before-and-after summary of the members who agreed to share group figures, taken at the day they joined and again 90 and 180 days later. There is no comparison group, members were not chosen at random, and the people who stay are not the same as the people who leave. For these reasons the figures describe what happened to these members and cannot show what would have happened without the programme. Differences between months or groups can arise from who joined, not from anything the programme did.",
    "caveat": "A change in a measure is not a verdict on the programme. Results for the same programme will differ with who joined, how long they stayed and how often they were measured."
  }
}
$json$::jsonb, 'PROPOSED, v1 (2026-10-07). Owner: CMO. Windows, thresholds and bands for the HbA1c, weight, PHQ-9 and GAD-7 outcome snapshots. Figures are withheld until the CMO has signed this version (decision S75-2).');
-- measures-rules-end

create function private.outcome_measure_rule(p_path text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config #> p_path from public.outcome_measure_config where is_active $$;
revoke all on function private.outcome_measure_rule(text[]) from public, anon, authenticated;

-- True only when the CMO's newest decision for the active version is "confirmed". Fail closed on anything else (no row, changes requested).
create function private.outcome_measures_signed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.decision = 'confirmed'
                     from public.proposed_config_signoffs s
                    where s.config_key = 'outcomes.measures' and s.config_version = (select version from public.outcome_measure_config where is_active)
                    order by s.id desc limit 1), false)
$$;
revoke all on function private.outcome_measures_signed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Snapshots
-- ---------------------------------------------------------------------------
create table public.outcome_measure_snapshots (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  measure_code     text not null check (measure_code in ('hba1c', 'weight', 'phq9', 'gad7')),
  day              smallint not null check (day between 0 and 730),
  anchor_date      date not null,
  window_start     date not null,
  window_end       date not null,
  status           text not null check (status in ('measured', 'no_reading', 'excluded')),
  exclusion_reason text check (exclusion_reason in ('pregnant', 'under_18', 'age_unknown', 'safeguarding')),
  value            numeric(7, 2),
  value_date       date,
  severity_band    text,
  config_version   integer not null references public.outcome_measure_config (version),
  computed_at      timestamptz not null default now(),
  is_test          boolean not null default false,
  unique (patient_id, measure_code, day),
  check (window_end >= window_start),
  check ((status = 'measured') = (value is not null and value_date is not null)),
  check ((status = 'excluded') = (exclusion_reason is not null)),
  check (status <> 'excluded' or (value is null and severity_band is null)),
  check (severity_band is null or measure_code in ('phq9', 'gad7'))
);
create index outcome_measure_snapshots_idx on public.outcome_measure_snapshots (measure_code, day, anchor_date) where not is_test;
alter table public.outcome_measure_snapshots enable row level security;
revoke all on public.outcome_measure_snapshots from public, anon, authenticated;
-- No policy and no grant: a row (a person's HbA1c, weight or mental-health score) is read by nobody. Reports are aggregates (INV-10: no staff row-level read).

create function private.outcome_measure_snapshots_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'outcome_measure_snapshots_append_only' using errcode = 'P0001';
end $$;
create trigger outcome_measure_snapshots_append_only before update on public.outcome_measure_snapshots
  for each row execute function private.outcome_measure_snapshots_append_only();
revoke all on function private.outcome_measure_snapshots_append_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The mental-health safeguard: reuse the existing follow-up, never a report
-- ---------------------------------------------------------------------------
-- A PHQ-9 screen counts as "safeguarding" when item 9 is above zero, the screen carries the crisis flag, or the score reaches the configured line.
create function private.mh_screen_is_safeguarding(p_instrument text, p_total integer, p_crisis boolean, p_items jsonb) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_instrument = 'phq9' and (
    coalesce(p_crisis, false)
    or p_total >= (private.outcome_measure_rule('{phq9,safeguard_score_from}') #>> '{}')::integer
    or coalesce((p_items -> 'items' ->> 8)::integer, 0) > (private.outcome_measure_rule('{phq9,safeguard_item9_above}') #>> '{}')::integer)
$$;
revoke all on function private.mh_screen_is_safeguarding(text, integer, boolean, jsonb) from public, anon, authenticated;

-- The existing trigger (handle_mental_health_screen_concern) opens an emergency event for a crisis flag and a clinician alert for a high band, on insert.
-- This only fills a hole: a screen that qualifies but has neither (an older row, a flag not set by the client). Idempotent per screen.
create function private.ensure_mental_health_followup(p_screen uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare s public.mental_health_screens%rowtype;
begin
  select * into s from public.mental_health_screens where id = p_screen;
  if not found then return false; end if;
  if exists (select 1 from public.clinician_alerts a where a.patient_id = s.patient_id and a.detail like '%' || s.id::text || '%')
     or exists (select 1 from public.emergency_events e where e.patient_id = s.patient_id and e.source in ('mental_health_screen', 'intake_screen')
                  and e.created_at >= s.created_at - interval '1 hour') then
    return false;   -- already routed
  end if;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (s.organisation_id, s.patient_id, 'urgent_escalation'::public.alert_level, 'open',
          'Mental-health screen: high concern - ' || upper(s.instrument) || ' (found by the outcomes check)',
          format('Screen %s scored %s (%s band)%s. This screen met a safeguarding line (item 9 above zero or a high score) but had no follow-up on record. Screening/triage telemetry only - review before actioning.',
                 s.id, s.total_score, s.severity_band, case when coalesce(s.crisis_flagged, false) then '; crisis flag set' else '' end),
          now() + interval '24 hours');
  return true;
end $$;
revoke all on function private.ensure_mental_health_followup(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Computation
-- ---------------------------------------------------------------------------
create function private.outcome_measure_band(p_measure text, p_value numeric) returns text
language sql stable security definer set search_path = ''
as $$
  select b ->> 0 from jsonb_array_elements(private.outcome_measure_rule(array[p_measure, 'bands'])) b
   where p_value between (b ->> 1)::numeric and (b ->> 2)::numeric limit 1
$$;
revoke all on function private.outcome_measure_band(text, numeric) from public, anon, authenticated;

create function private.outcome_measure_compute(p_patient uuid, p_measure text, p_day integer, p_now timestamptz default now()) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_anchor date := private.outcome_anchor(p_patient);
  v_cfg integer := (select version from public.outcome_measure_config where is_active);
  c jsonb := private.outcome_measure_rule(array[p_measure]);
  pr public.profiles%rowtype;
  v_target date; v_from date; v_to date;
  v_status text := 'no_reading'; v_reason text; v_val numeric; v_vdate date; v_band text; v_item record; v_id uuid;
  v_age numeric;
begin
  if v_anchor is null or c is null then return null; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then return null; end if;
  if p_day = 0 then
    v_target := v_anchor; v_from := v_anchor - (c ->> 'baseline_before_days')::integer; v_to := v_anchor + (c ->> 'baseline_after_days')::integer;
  else
    v_target := v_anchor + p_day; v_from := v_target - (c ->> 'half_width_days')::integer; v_to := v_target + (c ->> 'half_width_days')::integer;
  end if;

  -- Eligibility first: nobody under the minimum age, nobody pregnant (HbA1c and weight targets do not apply), and no value is read for them at all.
  v_age := extract(year from age(v_anchor, pr.date_of_birth));
  if pr.date_of_birth is null then
    v_status := 'excluded'; v_reason := 'age_unknown';
  elsif v_age < (private.outcome_measure_rule('{min_age_years}') #>> '{}')::integer then
    v_status := 'excluded'; v_reason := 'under_18';
  elsif p_measure in ('hba1c', 'weight') and exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p_patient and pp.is_pregnant) then
    v_status := 'excluded'; v_reason := 'pregnant';
  elsif p_measure = 'phq9' and exists (
      select 1 from public.mental_health_screens m
       where m.patient_id = p_patient and m.instrument = 'phq9' and (m.created_at at time zone 'Africa/Lagos')::date between v_from and v_to
         and private.mh_screen_is_safeguarding(m.instrument, m.total_score, m.crisis_flagged, m.item_responses)) then
    -- routed to the existing follow-up (not a report); no value from this person is stored
    v_status := 'excluded'; v_reason := 'safeguarding';
    for v_item in select m.id from public.mental_health_screens m
       where m.patient_id = p_patient and m.instrument = 'phq9' and (m.created_at at time zone 'Africa/Lagos')::date between v_from and v_to
         and private.mh_screen_is_safeguarding(m.instrument, m.total_score, m.crisis_flagged, m.item_responses) loop
      perform private.ensure_mental_health_followup(v_item.id);
    end loop;
  end if;

  if v_status = 'no_reading' then
    if p_measure = 'hba1c' then
      select x.v, x.d into v_val, v_vdate from (
        select case when l.unit = '%' then l.value when lower(l.unit) = 'mmol/mol' then round((0.09148 * l.value + 2.152)::numeric, 2) end as v,
               (coalesce(l.specimen_collected_at, l.taken_at) at time zone 'Africa/Lagos')::date as d
          from public.lab_analyte_readings l
         where l.patient_id = p_patient and l.code = 'hba1c' and l.value is not null and l.report_status in ('final', 'corrected', 'amended')
           and lower(l.unit) in ('%', 'mmol/mol')) x
       where x.v between (c ->> 'min_plausible')::numeric and (c ->> 'max_plausible')::numeric and x.d between v_from and v_to
       order by abs(x.d - v_target), x.d desc limit 1;
    elsif p_measure = 'weight' then
      select w.weight_kg, (w.taken_at at time zone 'Africa/Lagos')::date into v_val, v_vdate
        from public.vitals_readings w
       where w.patient_id = p_patient and w.vital_type = 'weight' and w.weight_kg is not null and w.weight_kg between 20 and 400
         and (w.validation_status = 'valid' or coalesce(w.validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
         and (w.taken_at at time zone 'Africa/Lagos')::date between v_from and v_to
       order by abs((w.taken_at at time zone 'Africa/Lagos')::date - v_target), w.taken_at desc limit 1;
    else
      select m.total_score, (m.created_at at time zone 'Africa/Lagos')::date into v_val, v_vdate
        from public.mental_health_screens m
       where m.patient_id = p_patient and m.instrument = p_measure and (m.created_at at time zone 'Africa/Lagos')::date between v_from and v_to
       order by abs((m.created_at at time zone 'Africa/Lagos')::date - v_target), m.created_at desc limit 1;
      if v_val is not null then v_band := private.outcome_measure_band(p_measure, v_val); end if;
    end if;
    if v_val is not null then v_status := 'measured'; end if;
  end if;

  insert into public.outcome_measure_snapshots (organisation_id, patient_id, measure_code, day, anchor_date, window_start, window_end, status, exclusion_reason,
      value, value_date, severity_band, config_version, computed_at, is_test)
  values (pr.organisation_id, p_patient, p_measure, p_day, v_anchor, v_from, v_to, v_status, v_reason,
      case when v_status = 'measured' then v_val end, case when v_status = 'measured' then v_vdate end,
      case when v_status = 'measured' then v_band end, v_cfg, p_now, coalesce(pr.is_test, false))
  on conflict (patient_id, measure_code, day) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.outcome_measure_compute(uuid, text, integer, timestamptz) from public, anon, authenticated;

create function private.compute_outcome_measure_snapshots(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_grace integer := (private.outcome_measure_rule('{grace_days}') #>> '{}')::integer;
  r record; m text; d integer; v_upper date; n integer := 0; v_failed integer := 0; v_last text; c jsonb;
begin
  for r in
    select patient_id, min(dt) as anchor from (
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date dt from public.patient_memberships
      union all
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where kind in ('membership', 'care_pack')) u
     group by patient_id order by min(dt) limit 5000
  loop
    foreach m in array array['hba1c', 'weight', 'phq9', 'gad7'] loop
      c := private.outcome_measure_rule(array[m]);
      for d in select jsonb_array_elements_text(private.outcome_measure_rule('{days}'))::integer loop
        v_upper := case when d = 0 then r.anchor + (c ->> 'baseline_after_days')::integer else r.anchor + d + (c ->> 'half_width_days')::integer end;
        continue when v_upper + v_grace > v_today;
        continue when exists (select 1 from public.outcome_measure_snapshots s where s.patient_id = r.patient_id and s.measure_code = m and s.day = d);
        begin
          if private.outcome_measure_compute(r.patient_id, m, d, p_now) is not null then n := n + 1; end if;
        exception when others then
          v_failed := v_failed + 1; v_last := sqlerrm;
        end;
      end loop;
    end loop;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('outcome-measures-failing', 'Outcome measure snapshots are failing',
      v_failed || ' outcome measure snapshots failed on the last run (' || left(v_last, 200) || '). Those reports cover fewer people until it is fixed.');
  end if;
  return n;
end $$;
revoke all on function private.compute_outcome_measure_snapshots(timestamptz) from public, anon, authenticated;
select cron.schedule('outcome-measures', '50 1 * * *', $$ select private.compute_outcome_measure_snapshots(); $$);

-- ---------------------------------------------------------------------------
-- 5. The report
-- ---------------------------------------------------------------------------
-- One cohort shape for every measure: people measured at day 0 and at day D, how many improved by the configured rule. Counts only; the rates are
-- derived from counts that already cleared private.suppress_cell, so a rate never appears without its count.
create function private.outcome_measure_cohort(p_measure text, p_day integer, p_from date, p_to date, p_patients uuid[] default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := private.min_cell_floor();
  c jsonb := private.outcome_measure_rule(array[p_measure]);
  a record; v_bands jsonb := '[]'::jsonb; v_groups jsonb; g jsonb; v_all jsonb; v_cov text; v_excl text;
begin
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;
  drop table if exists pg_temp._s75_mc;
  create temp table _s75_mc on commit drop as
    select f.patient_id, f.status as s_due, f.exclusion_reason as x_due, b.status as s0, b.value as v0, f.value as vd, b.severity_band as band0, f.severity_band as bandd
      from public.outcome_measure_snapshots f
      join public.profiles pr on pr.id = f.patient_id
      left join public.outcome_measure_snapshots b on b.patient_id = f.patient_id and b.measure_code = f.measure_code and b.day = 0
     where f.measure_code = p_measure and f.day = p_day and not f.is_test and not coalesce(pr.is_test, false)
       and (p_from is null or f.anchor_date >= p_from) and (p_to is null or f.anchor_date <= p_to)
       and (p_patients is null or f.patient_id = any (p_patients));
  -- a pair needs a measured baseline and a measured follow-up; anyone excluded at either end is out of the pair (and never described)
  drop table if exists pg_temp._s75_pairs;
  create temp table _s75_pairs on commit drop as
    select *, (vd - v0) as chg,
           case p_measure
             when 'hba1c' then (v0 - vd) >= (c ->> 'meaningful_change_pp')::numeric
             when 'weight' then v0 > 0 and (100.0 * (v0 - vd) / v0) >= (c ->> 'loss_pct')::numeric
             else v0 > 0 and (100.0 * (v0 - vd) / v0) >= (c ->> 'response_pct')::numeric end as improved,
           case p_measure when 'hba1c' then vd < (c ->> 'target_pct')::numeric when 'weight' then null else vd < (c ->> 'remission_below')::numeric end as at_goal
      from _s75_mc where s_due = 'measured' and s0 = 'measured';
  select (select count(*) from _s75_mc where s_due <> 'excluded') as n_due,
         (select count(*) from _s75_mc where s_due = 'no_reading') as n_none,
         (select count(*) from _s75_mc where s_due = 'excluded') as n_excl,
         count(*) as n, count(*) filter (where improved) as imp, count(*) filter (where not improved) as notimp,
         count(*) filter (where at_goal) as goal, count(*) filter (where at_goal is false) as notgoal, avg(chg) as mean_chg
    into a from _s75_pairs;

  v_all := case when private.suppress_cell(a.n, array[a.imp, a.notimp]::bigint[], v_min) is null
    then jsonb_build_object('suppressed', false, 'n', a.n, 'improved', a.imp, 'improved_pct', round(100.0 * a.imp / a.n, 1), 'mean_change', round(a.mean_chg, 2),
           'at_goal_pct', case when a.goal + a.notgoal > 0 then round(100.0 * a.goal / (a.goal + a.notgoal), 1) end)
    else jsonb_build_object('suppressed', true, 'reason', private.suppress_cell(a.n, array[a.imp, a.notimp]::bigint[], v_min), 'minimum', v_min) end;

  -- coverage: of the people whose day is due, how many have a usable pair. A rate over the measured is only meaningful beside this.
  v_cov := private.suppress_cell(a.n_due, null, v_min);
  v_excl := private.suppress_cell(a.n_excl, null, v_min);

  -- severity bands (mental health only): the starting band decides what "improvement" can mean, so each band is its own group
  if p_measure in ('phq9', 'gad7') then
    select coalesce(jsonb_agg(jsonb_build_object('key', band0, 'n', n, 'cats', jsonb_build_array(imp, n - imp), 'imp', imp, 'mean', mean_chg, 'resp_ok', goal, 'resp_n', n) order by band0), '[]'::jsonb) into v_groups
      from (select band0, count(*) n, count(*) filter (where improved) imp, avg(chg) mean_chg, count(*) filter (where at_goal) goal from _s75_pairs group by band0) x;
    for g in select * from jsonb_array_elements(private.suppress_groups(v_groups, v_min)) loop
      v_bands := v_bands || jsonb_build_array(case when (g ->> 'suppressed')::boolean then jsonb_build_object('baseline_band', g ->> 'key', 'suppressed', true)
        else jsonb_build_object('baseline_band', g ->> 'key', 'suppressed', false, 'n', (g ->> 'n')::integer, 'responded_pct', round(100.0 * (g ->> 'imp')::numeric / (g ->> 'n')::numeric, 1),
               'in_remission_pct', round(100.0 * (g ->> 'resp_ok')::numeric / (g ->> 'n')::numeric, 1), 'mean_change', round((g ->> 'mean')::numeric, 2)) end);
    end loop;
  end if;

  return jsonb_build_object(
    'due_day', p_day,
    'pairs', v_all,
    'coverage', case when v_cov is null then jsonb_build_object('suppressed', false, 'due', a.n_due, 'with_usable_pair', a.n,
                       'with_usable_pair_pct', case when a.n_due > 0 then round(100.0 * a.n / a.n_due, 1) end,
                       'no_reading_pct', case when a.n_due > 0 then round(100.0 * a.n_none / a.n_due, 1) end)
                else jsonb_build_object('suppressed', true, 'reason', v_cov, 'minimum', v_min) end,
    'excluded', case when v_excl is null then jsonb_build_object('suppressed', false, 'n', a.n_excl) else jsonb_build_object('suppressed', true, 'reason', v_excl, 'minimum', v_min) end,
    'by_baseline_band', case when p_measure in ('phq9', 'gad7') then v_bands end);
end $$;
revoke all on function private.outcome_measure_cohort(text, integer, date, date, uuid[]) from public, anon, authenticated;

create function public.outcome_measures_report(p_measure text, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_signed boolean; v_has boolean; v_out jsonb; d integer; v_by jsonb := '{}'::jsonb;
  v_def text; v_lim text; v_cfg integer := (select version from public.outcome_measure_config where is_active);
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  if p_measure is null or p_measure not in ('hba1c', 'weight', 'phq9', 'gad7') then raise exception 'unknown_measure' using errcode = '22023'; end if;
  v_signed := private.outcome_measures_signed();
  v_has := exists (select 1 from public.outcome_measure_snapshots s where s.measure_code = p_measure and s.status = 'measured' and not s.is_test);
  perform private.log_audit('outcomes.measures_report', 'outcome_report', null, jsonb_build_object('measure', p_measure, 'from', p_from, 'to', p_to, 'signed', v_signed));
  -- Only pathways with real data are shown, and nothing at all until the CMO has signed the definitions (decision S75-2).
  if not v_signed then
    return jsonb_build_object('measure', p_measure, 'config_version', v_cfg, 'withheld', true, 'reason', 'awaiting_cmo_signature', 'has_data', v_has, 'not_a_causal_claim', true);
  end if;
  if not v_has then
    return jsonb_build_object('measure', p_measure, 'config_version', v_cfg, 'withheld', false, 'has_data', false, 'not_a_causal_claim', true);
  end if;
  foreach d in array array[90, 180] loop
    v_by := v_by || jsonb_build_object(d::text, private.outcome_measure_cohort(p_measure, d, p_from, p_to));
  end loop;
  v_def := case p_measure
    when 'hba1c' then 'HbA1c (percent) from a final laboratory result, taken as the result nearest to the day within the window. "Improved" is a fall of at least the configured number of percentage points from the starting value; "under target" is below the configured target. Adults only, not in pregnancy.'
    when 'weight' then 'Body weight from a validated reading nearest to the day within the window. "Improved" is a loss of at least the configured percentage of the starting weight. Adults only, not in pregnancy.'
    when 'phq9' then 'PHQ-9 total score from the screen nearest to the day within the window. "Responded" is a fall of at least the configured percentage from the starting score; "in remission" is below the configured score. People with any answer above zero to item 9, or a score at or above the safeguarding line, are looked after by the care team and are in no figure.'
    else 'GAD-7 total score from the screen nearest to the day within the window. "Responded" is a fall of at least the configured percentage from the starting score; "in remission" is below the configured score.' end;
  v_lim := 'Only people with a usable result at the start and at the due day are in the pairs, and coverage is shown beside every rate. Results are shown by starting severity because what counts as meaningful change depends on where a person starts, and published estimates of it differ. A before and after view without a comparison group says nothing about cause. Small groups are withheld, and so is the next smallest. Not a ranking of anyone and never a reason to deny care.';
  return jsonb_build_object('measure', p_measure, 'config_version', v_cfg, 'withheld', false, 'has_data', true, 'minimum_cell', private.min_cell_floor(),
    'by_day', v_by, 'range', jsonb_build_object('from', p_from, 'to', p_to), 'definition', v_def, 'limitations', v_lim,
    'caveat', private.outcome_measure_rule('{pack,caveat}') #>> '{}', 'not_a_causal_claim', true, 'generated_at', now());
end $$;
revoke all on function public.outcome_measures_report(text, date, date) from public, anon;
grant execute on function public.outcome_measures_report(text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.outcome_measure_snapshots', 'SELECT') or has_table_privilege('authenticated', 'public.outcome_measure_snapshots', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'S75b: a user can touch outcome_measure_snapshots';
  end if;
  if has_table_privilege('authenticated', 'public.outcome_measure_config', 'SELECT,INSERT,UPDATE,DELETE') then raise exception 'S75b: a user can touch outcome_measure_config'; end if;
  if has_function_privilege('anon', 'public.outcome_measures_report(text,date,date)', 'EXECUTE') then raise exception 'S75b: anon can run the measures report'; end if;
  if has_function_privilege('authenticated', 'private.compute_outcome_measure_snapshots(timestamptz)', 'EXECUTE') then raise exception 'S75b: a user can run the snapshot job'; end if;
  if private.outcome_measures_signed() then raise exception 'S75b: the measures must start UNSIGNED (an agent never signs)'; end if;
  if (select count(*) from public.proposed_config_signoffs where config_key = 'outcomes.measures') <> 0 then raise exception 'S75b: a sign-off was seeded'; end if;
end $$;
