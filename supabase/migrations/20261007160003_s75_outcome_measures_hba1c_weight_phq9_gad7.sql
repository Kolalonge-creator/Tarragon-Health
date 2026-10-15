-- S75 (track D, CMO decision S-5): outcome measures for HbA1c, weight, PHQ-9 and GAD-7, added to S38's snapshots as DATA.
-- Design: docs/design/S75-outcome-measures.md. Builds on S38 (outcome_config, private.outcome_anchor, private.outcome_rule, analytics.subjects,
-- private.v_bp_cohort_90d), S38c (private.open_job_incident) and S35 (private.s35_audit_read, private.s35_is_my_lead).
--
-- WHAT THIS CHANGES IN LIVE BEHAVIOUR: NOTHING UNTIL THE CMO ACTIVATES outcome_config version 3.
--   * outcome_config v3 is inserted PROPOSED, UNSIGNED and INACTIVE. The active row stays v2. Every S38 function keeps reading v2.
--   * The new daily job reads the active config and returns at once when it has no `measures` block (v2 has none), so it writes nothing.
--   * The new report functions refuse a measure the active config does not list.
--   * The BP day-180 report reads snapshots S38 already writes (config v2 already lists day 180); it is new and read-only.
--   Activation is a CMO act (set v3 active in the sign-off screen) and is deliberately NOT done here.
--
-- The measures (all descriptive, no comparison group, never a causal claim):
--   * HbA1c (lab_analyte_readings, code hba1c, percent): change from baseline, and whether the value is below 7.0 percent or at the
--     patient's own care-plan target (patient_glucose_targets.hba1c_target_percent).
--   * Weight (vitals_readings.weight_kg): percent change from baseline, and whether it fell 5 percent or more. Adults only.
--   * PHQ-9 and GAD-7 (mental_health_screens.total_score only): change, response (a fall of 50 percent or more) and remission (below 5).
-- Sparse measures use the NEAREST result inside a configurable window around the day (baseline: before and after joining; later days:
-- a tolerance either side). No result in the window is `insufficient_data`, stored as such and never counted as "not improved".
--
-- SAFETY (CMO S-3 and S-5):
--   * Mental health outcomes live in their OWN table, outcome_mh_snapshots. It is readable row-by-row only by the patient themself. No
--     sponsor role, sponsor function, sponsor view or analytics view touches it. A treating clinician reads one patient through an audited
--     SECURITY DEFINER function with a written reason (INV-10, INV-12). An admin, analyst or the CMO reads only suppressed aggregates.
--   * The PHQ-9 self-harm item (item 9) is never read: the computation selects total_score and created_at only. It does not select
--     item_responses or crisis_flagged. Item 9 follows the red pathway, not analytics.
--   * is_test is filtered in every new view and function (INV-13). Cells under the minimum (20, 30 across two attributes) are withheld
--     with the complementary cells (private.outcome_rule min_cell). Snapshots are append-only and carry config_version (INV-16).
--
-- Counts before this migration: no outcome_measure_snapshots or outcome_mh_snapshots table existed, so there is nothing to convert.

-- ---------------------------------------------------------------------------
-- 1. Configuration: v3, PROPOSED, UNSIGNED, INACTIVE
-- ---------------------------------------------------------------------------
-- outcome-rules-v3-begin
insert into public.outcome_config (version, is_active, config, note) values (3, false, $json$
{
  "days": [0, 30, 90, 180],
  "window_days": 7,
  "grace_days": 3,
  "min_readings": 3,
  "default_target": { "systolic": 140, "diastolic": 90 },
  "min_cell": 20,
  "min_cell_cross": 30,
  "report_spec": "bp_control_90d",
  "bp_report_days": [90, 180],
  "measures": {
    "hba1c": {
      "days": [0, 90, 180],
      "goal_below_percent": 7.0,
      "use_care_plan_target": true,
      "valid_min": 3.0,
      "valid_max": 20.0,
      "baseline_before_days": 90,
      "baseline_after_days": 14,
      "followup_tolerance_days": 30,
      "definition": "HbA1c, as a percentage. Change is the value near the day minus the baseline value near joining. A person reached the goal when the value near the day is under 7.0 percent or at their own care-plan HbA1c target. The result nearest the day inside the window is used.",
      "limitations": "Only people with an HbA1c result are counted in the measure; a person with no result near a day is shown as no result, never as not improved. Results come from the lab results recorded on the platform, not from every lab a person may have used. A before and after view without a comparison group says nothing about cause."
    },
    "weight": {
      "days": [0, 30, 90, 180],
      "goal_loss_percent": 5.0,
      "valid_min": 20,
      "valid_max": 400,
      "min_age_years": 18,
      "baseline_before_days": 14,
      "baseline_after_days": 7,
      "followup_tolerance_days": 14,
      "definition": "Weight in kilograms. Change is the percent difference between the weight near the day and the baseline weight near joining. A person reached the goal when weight fell by 5 percent or more. The weight nearest the day inside the window is used. Adults only.",
      "limitations": "Only people who logged a weight are counted; a person with no weight near a day is shown as no result, never as not improved. Weight changes for many reasons, including pregnancy, illness and fluid; the measure is not a judgement of any person. A before and after view without a comparison group says nothing about cause."
    },
    "phq9": {
      "days": [0, 30, 90, 180],
      "max_score": 27,
      "response_fall_percent": 50,
      "remission_below": 5,
      "min_baseline_for_outcome": 5,
      "baseline_before_days": 14,
      "baseline_after_days": 14,
      "followup_tolerance_days": 21,
      "definition": "PHQ-9 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
      "limitations": "Only total scores are used; no answer to any single question is read. A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor."
    },
    "gad7": {
      "days": [0, 30, 90, 180],
      "max_score": 21,
      "response_fall_percent": 50,
      "remission_below": 5,
      "min_baseline_for_outcome": 5,
      "baseline_before_days": 14,
      "baseline_after_days": 14,
      "followup_tolerance_days": 21,
      "definition": "GAD-7 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
      "limitations": "A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor."
    }
  }
}
$json$::jsonb, 'PROPOSED, v3, UNSIGNED, INACTIVE (S75, CMO decision S-5). Owner: CMO. Same rules as v2 plus a measures block: HbA1c, weight, PHQ-9, GAD-7 windows, goals and thresholds. Becomes live only when the CMO activates it; until then the active row stays v2.');
-- outcome-rules-v3-end

-- The rule for one measure in a NAMED config version (so a computation names the version it used, INV-16, and a proof can use v3 without
-- anything depending on which version is active).
create function private.s75_measure_rule(p_version integer, p_measure text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config -> 'measures' -> p_measure from public.outcome_config where version = p_version $$;
revoke all on function private.s75_measure_rule(integer, text) from public, anon, authenticated;

-- The active version, but only when it lists measures. v2 does not, so this is null until the CMO activates v3.
create function private.s75_measures_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.outcome_config where is_active and config ? 'measures' $$;
revoke all on function private.s75_measures_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
-- HbA1c and weight. Not mental health: staff and analytics may aggregate it (suppressed); sponsors have no function that reads it.
create table public.outcome_measure_snapshots (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  measure_code     text not null check (measure_code in ('hba1c', 'weight')),
  day              smallint not null check (day >= 0 and day <= 730),
  anchor_date      date not null,
  baseline_value   numeric(7, 2),
  baseline_date    date,
  value            numeric(7, 2),
  value_date       date,
  change_abs       numeric(7, 2),
  change_pct       numeric(6, 2),
  target_value     numeric(4, 1),
  target_source    text check (target_source in ('care_plan', 'guideline')),
  goal_status      text not null check (goal_status in ('reached', 'not_reached', 'insufficient_data', 'not_applicable')),
  change_status    text not null check (change_status in ('measured', 'baseline', 'insufficient_data')),
  config_version   integer not null references public.outcome_config (version),
  computed_at      timestamptz not null default now(),
  is_test          boolean not null default false,
  unique (patient_id, measure_code, day),
  check ((change_status = 'measured') = (change_abs is not null)),
  check (goal_status <> 'reached' or value is not null),
  check ((baseline_value is null) = (baseline_date is null)),
  check ((value is null) = (value_date is null))
);
create index outcome_measure_snapshots_day_idx on public.outcome_measure_snapshots (measure_code, day, anchor_date) where not is_test;
alter table public.outcome_measure_snapshots enable row level security;
revoke all on public.outcome_measure_snapshots from public, anon, authenticated;
grant select on public.outcome_measure_snapshots to authenticated;
create policy outcome_measure_snapshots_own on public.outcome_measure_snapshots for select to authenticated
  using (patient_id = (select auth.uid()));

-- Mental health: a separate table, PATIENT-ONLY at row level. No staff, org-staff or sponsor policy exists on purpose.
create table public.outcome_mh_snapshots (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  instrument       text not null check (instrument in ('phq9', 'gad7')),
  day              smallint not null check (day >= 0 and day <= 730),
  anchor_date      date not null,
  baseline_score   smallint check (baseline_score between 0 and 27),
  baseline_date    date,
  score            smallint check (score between 0 and 27),
  score_date       date,
  change           smallint,
  response_status  text not null check (response_status in ('response', 'no_response', 'insufficient_data', 'not_applicable')),
  remission_status text not null check (remission_status in ('remitted', 'not_remitted', 'insufficient_data', 'not_applicable')),
  config_version   integer not null references public.outcome_config (version),
  computed_at      timestamptz not null default now(),
  is_test          boolean not null default false,
  unique (patient_id, instrument, day),
  check ((baseline_score is null) = (baseline_date is null)),
  check ((score is null) = (score_date is null))
);
create index outcome_mh_snapshots_day_idx on public.outcome_mh_snapshots (instrument, day, anchor_date) where not is_test;
alter table public.outcome_mh_snapshots enable row level security;
revoke all on public.outcome_mh_snapshots from public, anon, authenticated;
grant select on public.outcome_mh_snapshots to authenticated;
create policy outcome_mh_snapshots_own on public.outcome_mh_snapshots for select to authenticated
  using (patient_id = (select auth.uid()));
comment on table public.outcome_mh_snapshots is
  'S75. PHQ-9 and GAD-7 outcome snapshots (total scores only, never an item). Patient-only at row level. A treating clinician reads one patient through clinician_mental_health_outcomes (audited, with a reason); an admin, analyst or the CMO reads suppressed aggregates through mental_health_outcome_report. Never reachable by a sponsor role, sponsor function or analytics view (S-3, S-5).';

-- History is not rewritten.
create function private.s75_snapshots_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'outcome_snapshots_append_only' using errcode = 'P0001';
end $$;
revoke all on function private.s75_snapshots_append_only() from public, anon, authenticated;
create trigger outcome_measure_snapshots_append_only before update on public.outcome_measure_snapshots
  for each row execute function private.s75_snapshots_append_only();
create trigger outcome_mh_snapshots_append_only before update on public.outcome_mh_snapshots
  for each row execute function private.s75_snapshots_append_only();

-- ---------------------------------------------------------------------------
-- 3. Computation
-- ---------------------------------------------------------------------------
-- The nearest result to a centre date inside [lo, hi]. Ties go to the earlier date. HbA1c and weight only; mental health has its own
-- reader below so that no mental health column can be reached from here.
create function private.s75_nearest(p_patient uuid, p_measure text, p_lo date, p_hi date, p_centre date, p_rule jsonb,
                                    out val numeric, out on_date date)
language sql stable security definer set search_path = ''
as $$
  select x.v, x.d from (
    select l.value::numeric as v, (l.taken_at at time zone 'Africa/Lagos')::date as d, l.taken_at as t
      from public.lab_analyte_readings l
     where p_measure = 'hba1c' and l.patient_id = p_patient and l.code = 'hba1c' and l.unit = 'percent'
       and l.value between (p_rule ->> 'valid_min')::numeric and (p_rule ->> 'valid_max')::numeric
       and (l.taken_at at time zone 'Africa/Lagos')::date between p_lo and p_hi
    union all
    select v.weight_kg::numeric, (v.taken_at at time zone 'Africa/Lagos')::date, v.taken_at
      from public.vitals_readings v
     where p_measure = 'weight' and v.patient_id = p_patient and v.vital_type = 'weight' and v.weight_kg is not null
       and v.validation_status = 'valid'
       and v.weight_kg between (p_rule ->> 'valid_min')::numeric and (p_rule ->> 'valid_max')::numeric
       and (v.taken_at at time zone 'Africa/Lagos')::date between p_lo and p_hi
  ) x order by abs(x.d - p_centre), x.d, x.t limit 1
$$;
revoke all on function private.s75_nearest(uuid, text, date, date, date, jsonb) from public, anon, authenticated;

-- Mental health reader: TOTAL SCORE and date only. It does not name item_responses or crisis_flagged. (Item 9 follows the red pathway.)
create function private.s75_mh_nearest(p_patient uuid, p_instrument text, p_lo date, p_hi date, p_centre date, p_max integer,
                                       out val integer, out on_date date)
language sql stable security definer set search_path = ''
as $$
  select s.total_score, (s.created_at at time zone 'Africa/Lagos')::date
    from public.mental_health_screens s
   where s.patient_id = p_patient and s.instrument = p_instrument and s.total_score between 0 and p_max
     and (s.created_at at time zone 'Africa/Lagos')::date between p_lo and p_hi
   order by abs((s.created_at at time zone 'Africa/Lagos')::date - p_centre), s.created_at limit 1
$$;
revoke all on function private.s75_mh_nearest(uuid, text, date, date, date, integer) from public, anon, authenticated;

-- Is this person in the measure at all? A person with no HbA1c result and no glucose target, no weight, or no screen is not in it (they
-- would otherwise be a wall of "no result" rows). Adults only for weight. Evaluated when a snapshot is due.
create function private.s75_in_scope(p_patient uuid, p_measure text, p_rule jsonb, p_anchor date) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_dob date;
begin
  if p_measure = 'hba1c' then
    return exists (select 1 from public.lab_analyte_readings l where l.patient_id = p_patient and l.code = 'hba1c')
        or exists (select 1 from public.patient_glucose_targets t where t.patient_id = p_patient);
  elsif p_measure = 'weight' then
    select date_of_birth into v_dob from public.profiles where id = p_patient;
    if v_dob is not null and v_dob > (p_anchor - make_interval(years => (p_rule ->> 'min_age_years')::integer))::date then return false; end if;
    return exists (select 1 from public.vitals_readings v where v.patient_id = p_patient and v.vital_type = 'weight' and v.weight_kg is not null);
  elsif p_measure in ('phq9', 'gad7') then
    return exists (select 1 from public.mental_health_screens s where s.patient_id = p_patient and s.instrument = p_measure);
  end if;
  return false;
end $$;
revoke all on function private.s75_in_scope(uuid, text, jsonb, date) from public, anon, authenticated;

-- The last date a day's result can arrive (window end), used with the grace days to decide when a snapshot is due.
create function private.s75_day_close(p_anchor date, p_day integer, p_rule jsonb) returns date
language sql immutable set search_path = ''
as $$ select case when p_day = 0 then p_anchor + (p_rule ->> 'baseline_after_days')::integer
                  else p_anchor + p_day + (p_rule ->> 'followup_tolerance_days')::integer end $$;
revoke all on function private.s75_day_close(date, integer, jsonb) from public, anon, authenticated;

-- HbA1c and weight snapshot for one person and day. Returns the new id, or null (out of scope, not a configured day, already there).
create function private.outcome_measure_compute(p_patient uuid, p_measure text, p_day integer, p_version integer, p_now timestamptz default now())
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_anchor date := private.outcome_anchor(p_patient);
  v_rule jsonb := private.s75_measure_rule(p_version, p_measure);
  pr public.profiles%rowtype;
  v_lo date; v_hi date; v_centre date;
  v_base numeric; v_base_date date; v_val numeric; v_val_date date; v_d0 public.outcome_measure_snapshots%rowtype;
  v_chg numeric; v_pct numeric; v_tv numeric(4, 1); v_tsrc text; v_goal text; v_chgs text; v_id uuid;
begin
  if p_measure not in ('hba1c', 'weight') or v_anchor is null or v_rule is null then return null; end if;
  if not (v_rule -> 'days') @> to_jsonb(p_day) then return null; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then return null; end if;
  if not private.s75_in_scope(p_patient, p_measure, v_rule, v_anchor) then return null; end if;

  -- the value near the day
  v_centre := v_anchor + p_day;
  if p_day = 0 then
    v_lo := v_anchor - (v_rule ->> 'baseline_before_days')::integer; v_hi := v_anchor + (v_rule ->> 'baseline_after_days')::integer;
  else
    v_lo := v_centre - (v_rule ->> 'followup_tolerance_days')::integer; v_hi := v_centre + (v_rule ->> 'followup_tolerance_days')::integer;
  end if;
  select val, on_date into v_val, v_val_date from private.s75_nearest(p_patient, p_measure, v_lo, v_hi, v_centre, v_rule);

  -- the baseline: the day-0 row (made first if it is missing), so every later day compares with the same baseline (append-only)
  if p_day = 0 then
    v_base := v_val; v_base_date := v_val_date;
  else
    select * into v_d0 from public.outcome_measure_snapshots where patient_id = p_patient and measure_code = p_measure and day = 0;
    if not found and (v_rule -> 'days') @> '0'::jsonb then
      perform private.outcome_measure_compute(p_patient, p_measure, 0, p_version, p_now);
      select * into v_d0 from public.outcome_measure_snapshots where patient_id = p_patient and measure_code = p_measure and day = 0;
    end if;
    v_base := v_d0.baseline_value; v_base_date := v_d0.baseline_date;
  end if;

  if p_measure = 'hba1c' then
    select hba1c_target_percent into v_tv from public.patient_glucose_targets where patient_id = p_patient;
    v_tsrc := case when v_tv is not null then 'care_plan' else 'guideline' end;
    if v_val is null then v_goal := 'insufficient_data';
    elsif v_val < (v_rule ->> 'goal_below_percent')::numeric
       or ((v_rule ->> 'use_care_plan_target')::boolean and v_tv is not null and v_val <= v_tv) then v_goal := 'reached';
    else v_goal := 'not_reached'; end if;
    if p_day = 0 then
      v_chgs := case when v_val is null then 'insufficient_data' else 'baseline' end;
    elsif v_val is null or v_base is null then v_chgs := 'insufficient_data';
    else v_chgs := 'measured'; v_chg := round(v_val - v_base, 2); end if;
  else
    v_tv := null; v_tsrc := null;
    if p_day = 0 then
      v_chgs := case when v_val is null then 'insufficient_data' else 'baseline' end;
      v_goal := case when v_val is null then 'insufficient_data' else 'not_applicable' end;
    elsif v_val is null or v_base is null or v_base <= 0 then
      v_chgs := 'insufficient_data'; v_goal := 'insufficient_data';
    else
      v_chgs := 'measured'; v_chg := round(v_val - v_base, 2); v_pct := round(100.0 * (v_val - v_base) / v_base, 2);
      v_goal := case when v_pct <= -(v_rule ->> 'goal_loss_percent')::numeric then 'reached' else 'not_reached' end;
    end if;
  end if;

  insert into public.outcome_measure_snapshots (organisation_id, patient_id, measure_code, day, anchor_date, baseline_value, baseline_date,
      value, value_date, change_abs, change_pct, target_value, target_source, goal_status, change_status, config_version, computed_at, is_test)
  values (pr.organisation_id, p_patient, p_measure, p_day, v_anchor, v_base, v_base_date, v_val, v_val_date, v_chg, v_pct, v_tv, v_tsrc,
      v_goal, v_chgs, p_version, p_now, coalesce(pr.is_test, false))
  on conflict (patient_id, measure_code, day) do nothing
  returning id into v_id;
  if v_id is not null then insert into analytics.subjects (patient_id) values (p_patient) on conflict (patient_id) do nothing; end if;
  return v_id;
end $$;
revoke all on function private.outcome_measure_compute(uuid, text, integer, integer, timestamptz) from public, anon, authenticated;

-- PHQ-9 and GAD-7 snapshot for one person and day: total scores only.
create function private.outcome_mh_compute(p_patient uuid, p_instrument text, p_day integer, p_version integer, p_now timestamptz default now())
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_anchor date := private.outcome_anchor(p_patient);
  v_rule jsonb := private.s75_measure_rule(p_version, p_instrument);
  pr public.profiles%rowtype;
  v_lo date; v_hi date; v_centre date; v_max integer;
  v_base integer; v_base_date date; v_val integer; v_val_date date; v_d0 public.outcome_mh_snapshots%rowtype;
  v_chg integer; v_resp text; v_rem text; v_id uuid;
begin
  if p_instrument not in ('phq9', 'gad7') or v_anchor is null or v_rule is null then return null; end if;
  if not (v_rule -> 'days') @> to_jsonb(p_day) then return null; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then return null; end if;
  if not private.s75_in_scope(p_patient, p_instrument, v_rule, v_anchor) then return null; end if;
  v_max := (v_rule ->> 'max_score')::integer;

  v_centre := v_anchor + p_day;
  if p_day = 0 then
    v_lo := v_anchor - (v_rule ->> 'baseline_before_days')::integer; v_hi := v_anchor + (v_rule ->> 'baseline_after_days')::integer;
  else
    v_lo := v_centre - (v_rule ->> 'followup_tolerance_days')::integer; v_hi := v_centre + (v_rule ->> 'followup_tolerance_days')::integer;
  end if;
  select val, on_date into v_val, v_val_date from private.s75_mh_nearest(p_patient, p_instrument, v_lo, v_hi, v_centre, v_max);

  if p_day = 0 then
    v_base := v_val; v_base_date := v_val_date;
  else
    select * into v_d0 from public.outcome_mh_snapshots where patient_id = p_patient and instrument = p_instrument and day = 0;
    if not found and (v_rule -> 'days') @> '0'::jsonb then
      perform private.outcome_mh_compute(p_patient, p_instrument, 0, p_version, p_now);
      select * into v_d0 from public.outcome_mh_snapshots where patient_id = p_patient and instrument = p_instrument and day = 0;
    end if;
    v_base := v_d0.baseline_score; v_base_date := v_d0.baseline_date;
  end if;

  if p_day = 0 then
    v_resp := case when v_val is null then 'insufficient_data' else 'not_applicable' end;
    v_rem := v_resp;
  elsif v_val is null or v_base is null then
    v_resp := 'insufficient_data'; v_rem := 'insufficient_data';
  elsif v_base < (v_rule ->> 'min_baseline_for_outcome')::integer then
    -- a baseline already under the remission line cannot "respond" or "remit": not counted either way
    v_resp := 'not_applicable'; v_rem := 'not_applicable'; v_chg := v_val - v_base;
  else
    v_chg := v_val - v_base;
    v_resp := case when (v_base - v_val) * 100 >= v_base * (v_rule ->> 'response_fall_percent')::integer then 'response' else 'no_response' end;
    v_rem := case when v_val < (v_rule ->> 'remission_below')::integer then 'remitted' else 'not_remitted' end;
  end if;

  insert into public.outcome_mh_snapshots (organisation_id, patient_id, instrument, day, anchor_date, baseline_score, baseline_date,
      score, score_date, change, response_status, remission_status, config_version, computed_at, is_test)
  values (pr.organisation_id, p_patient, p_instrument, p_day, v_anchor, v_base, v_base_date, v_val, v_val_date, v_chg, v_resp, v_rem,
      p_version, p_now, coalesce(pr.is_test, false))
  on conflict (patient_id, instrument, day) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.outcome_mh_compute(uuid, text, integer, integer, timestamptz) from public, anon, authenticated;

-- Daily: every joined person in a measure, for every configured day that has closed (plus the grace days) and has no snapshot.
-- Returns 0 and writes nothing unless the active config lists measures (v3, once the CMO activates it).
create function private.compute_outcome_measure_snapshots(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver integer := private.s75_measures_version();
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_grace integer := (private.outcome_rule('grace_days') #>> '{}')::integer;
  m text; v_rule jsonb; r record; d integer; n integer := 0; v_failed integer := 0; v_last text; v_has boolean;
begin
  if v_ver is null then return 0; end if;
  for m in select jsonb_object_keys(config -> 'measures') from public.outcome_config where version = v_ver loop
    v_rule := private.s75_measure_rule(v_ver, m);
    for r in
      select a.patient_id, a.anchor from (
        select patient_id, min(dt) as anchor from (
          select patient_id, (starts_at at time zone 'Africa/Lagos')::date dt from public.patient_memberships
          union all
          select patient_id, (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where kind in ('membership', 'care_pack')
        ) u group by patient_id) a
       where private.s75_in_scope(a.patient_id, m, v_rule, a.anchor)
         and exists (
           select 1 from jsonb_array_elements_text(v_rule -> 'days') dd(day)
            where private.s75_day_close(a.anchor, dd.day::integer, v_rule) + v_grace <= v_today
              and not exists (select 1 from public.outcome_measure_snapshots s where m in ('hba1c', 'weight') and s.patient_id = a.patient_id and s.measure_code = m and s.day = dd.day::integer)
              and not exists (select 1 from public.outcome_mh_snapshots s where m in ('phq9', 'gad7') and s.patient_id = a.patient_id and s.instrument = m and s.day = dd.day::integer))
       order by a.anchor limit 5000
    loop
      for d in select jsonb_array_elements_text(v_rule -> 'days')::integer order by 1 loop
        continue when private.s75_day_close(r.anchor, d, v_rule) + v_grace > v_today;
        if m in ('hba1c', 'weight') then
          select exists (select 1 from public.outcome_measure_snapshots where patient_id = r.patient_id and measure_code = m and day = d) into v_has;
        else
          select exists (select 1 from public.outcome_mh_snapshots where patient_id = r.patient_id and instrument = m and day = d) into v_has;
        end if;
        continue when v_has;
        begin
          if m in ('hba1c', 'weight') then
            if private.outcome_measure_compute(r.patient_id, m, d, v_ver, p_now) is not null then n := n + 1; end if;
          else
            if private.outcome_mh_compute(r.patient_id, m, d, v_ver, p_now) is not null then n := n + 1; end if;
          end if;
        exception when others then
          v_failed := v_failed + 1; v_last := sqlerrm;
        end;
      end loop;
    end loop;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('outcome-measure-snapshots-failing', 'Outcome measure snapshots are failing',
      v_failed || ' snapshots failed on the last run (' || left(v_last, 200) || '). Outcome measure reports cover fewer people until it is fixed.');
  end if;
  return n;
end $$;
revoke all on function private.compute_outcome_measure_snapshots(timestamptz) from public, anon, authenticated;
select cron.schedule('outcome-measure-snapshots', '55 1 * * *', $$ select private.compute_outcome_measure_snapshots(); $$);

-- ---------------------------------------------------------------------------
-- 4. Who may read what
-- ---------------------------------------------------------------------------
-- An admin, an analyst or the CMO: the aggregate readers. Never a sponsor role.
create function private.s75_is_outcome_analyst() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'analyst') and is_active)
      or private.credential_is_cmo()
$$;
revoke all on function private.s75_is_outcome_analyst() from public, anon, authenticated;

-- Cohort shaping with suppression, the S38 rule for any yes / no / no-result measure. Under the minimum shows nothing but that; if any
-- category count is 1 to min-1 the whole cohort is withheld (subtraction cannot reveal a small cell). Zero is not a small cell.
create function private.s75_cohort_json(p_n integer, p_yes integer, p_no integer, p_insuf integer, p_min integer) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare small boolean := (p_yes between 1 and p_min - 1) or (p_no between 1 and p_min - 1) or (p_insuf between 1 and p_min - 1);
begin
  if p_n < p_min then return jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', p_min); end if;
  if small then return jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'n', p_n, 'minimum', p_min); end if;
  return jsonb_build_object('suppressed', false, 'n', p_n, 'reached', p_yes, 'not_reached', p_no, 'insufficient_data', p_insuf,
    'rate_strict_pct', round(100.0 * p_yes / p_n, 1),
    'rate_among_measured_pct', case when p_yes + p_no >= p_min then round(100.0 * p_yes / (p_yes + p_no), 1) end,
    'missing_pct', round(100.0 * p_insuf / p_n, 1));
end $$;
revoke all on function private.s75_cohort_json(integer, integer, integer, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. HbA1c and weight report (admin, analyst or CMO; aggregate only)
-- ---------------------------------------------------------------------------
create function private.outcome_measure_aggregate(p_measure text, p_day integer, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver integer := private.s75_measures_version();
  v_rule jsonb;
  v_min integer := (private.outcome_rule('min_cell') #>> '{}')::integer;
  a record; v_chg jsonb; v_goal text;
begin
  if v_ver is null then raise exception 'outcome_measures_not_active' using errcode = '22023'; end if;
  v_rule := private.s75_measure_rule(v_ver, p_measure);
  if p_measure not in ('hba1c', 'weight') or v_rule is null or not (v_rule -> 'days') @> to_jsonb(p_day) then
    raise exception 'outcome_measure_not_enabled' using errcode = '22023';
  end if;
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;

  select count(*) as n,
         count(*) filter (where s.goal_status = 'reached') as yes_n,
         count(*) filter (where s.goal_status = 'not_reached') as no_n,
         count(*) filter (where s.goal_status = 'insufficient_data') as ins,
         count(*) filter (where s.change_status = 'measured') as n_chg,
         avg(s.change_abs) filter (where s.change_status = 'measured') as mean_abs,
         avg(s.change_pct) filter (where s.change_status = 'measured') as mean_pct,
         count(*) filter (where s.baseline_value is null) as base_missing,
         count(*) filter (where s.target_source = 'care_plan') as n_target
    into a
    from public.outcome_measure_snapshots s join public.profiles pr on pr.id = s.patient_id
   where s.measure_code = p_measure and s.day = p_day and not s.is_test and not coalesce(pr.is_test, false)
     and (p_from is null or s.anchor_date >= p_from) and (p_to is null or s.anchor_date <= p_to);

  v_chg := case
    when a.n_chg < v_min then jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min)
    when p_measure = 'hba1c' then jsonb_build_object('suppressed', false, 'n', a.n_chg, 'mean_change_percentage_points', round(a.mean_abs, 2))
    else jsonb_build_object('suppressed', false, 'n', a.n_chg, 'mean_change_percent', round(a.mean_pct, 1), 'mean_change_kg', round(a.mean_abs, 1)) end;

  return jsonb_build_object(
    'measure', p_measure, 'day', p_day, 'config_version', v_ver, 'minimum_cell', v_min,
    'goal', case when p_measure = 'hba1c' then 'under 7.0 percent, or at the care-plan target' else 'a fall of 5 percent or more' end,
    'cohort_all_due', private.s75_cohort_json(a.n::integer, a.yes_n::integer, a.no_n::integer, a.ins::integer, v_min),
    'change_among_measured', v_chg,
    'data_quality', case when a.n >= v_min then jsonb_build_object('baseline_missing_pct', round(100.0 * a.base_missing / a.n, 1),
                         'care_plan_target_used_pct', case when p_measure = 'hba1c' then round(100.0 * a.n_target / a.n, 1) end)
                    else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'definition', v_rule ->> 'definition',
    'limitations', v_rule ->> 'limitations',
    'comparison_group', 'none',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.outcome_measure_aggregate(text, integer, date, date) from public, anon, authenticated;

create function public.outcome_measures_report(p_measure text, p_day integer, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_r jsonb;
begin
  if v_uid is null or not private.s75_is_outcome_analyst() then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  v_r := private.outcome_measure_aggregate(p_measure, p_day, p_from, p_to);
  perform private.log_audit('outcomes.measure_report', 'outcome_report', null, jsonb_build_object('measure', p_measure, 'day', p_day, 'from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.outcome_measures_report(text, integer, date, date) from public, anon;
grant execute on function public.outcome_measures_report(text, integer, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. BP report at day 180 (read-only on the snapshots S38 already writes; the BP rules are untouched)
-- ---------------------------------------------------------------------------
create view private.v_bp_cohort_180d with (security_invoker = off) as
  select s.patient_id, s.anchor_date as anchor, s.bp_status as s_day, s0.bp_status as s0,
         case when s.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s.bp_avg_7d_sys - s0.bp_avg_7d_sys end as d_sys,
         case when s.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s.bp_avg_7d_dia - s0.bp_avg_7d_dia end as d_dia,
         s.target_source = 'default' as defaulted
    from public.outcome_snapshots s
    join public.profiles pr on pr.id = s.patient_id
    left join public.outcome_snapshots s0 on s0.patient_id = s.patient_id and s0.pathway_code = s.pathway_code and s0.day = 0
   where s.pathway_code = 'bp' and s.day = 180 and not s.is_test and not coalesce(pr.is_test, false);
revoke all on private.v_bp_cohort_180d from public, anon, authenticated;

create function private.bp_control_aggregate_180(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := (private.outcome_rule('min_cell') #>> '{}')::integer;
  a record; b record; v_enrolled integer; v_notdue integer;
begin
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;
  select count(*) as n, count(*) filter (where s_day = 'controlled') c, count(*) filter (where s_day = 'uncontrolled') u,
         count(*) filter (where s_day = 'insufficient_data') i, count(*) filter (where s0 is null or s0 = 'insufficient_data') base_missing,
         count(*) filter (where d_sys is not null) n_both, avg(d_sys) filter (where d_sys is not null) mean_d_sys, avg(d_dia) filter (where d_dia is not null) mean_d_dia,
         count(*) filter (where defaulted) n_def
    into a from private.v_bp_cohort_180d k where (p_from is null or k.anchor >= p_from) and (p_to is null or k.anchor <= p_to);
  select count(*) as n, count(*) filter (where s_day = 'controlled') c, count(*) filter (where s_day = 'uncontrolled') u,
         count(*) filter (where s_day = 'insufficient_data') i
    into b from private.v_bp_cohort_180d k where s0 = 'uncontrolled' and (p_from is null or k.anchor >= p_from) and (p_to is null or k.anchor <= p_to);
  select count(*) into v_enrolled from (
    select j.patient_id, min(j.dt) anchor from (
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date dt from public.patient_memberships
      union all
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where kind in ('membership', 'care_pack')) j
      join public.profiles p on p.id = j.patient_id and not coalesce(p.is_test, false)
     group by j.patient_id) e
   where (p_from is null or e.anchor >= p_from) and (p_to is null or e.anchor <= p_to);
  v_notdue := greatest(v_enrolled - a.n, 0);
  return jsonb_build_object(
    'measure', 'bp_control_180d', 'day', 180,
    'config_version', (select version from public.outcome_config where is_active),
    'minimum_cell', v_min,
    'cohort_all_due', private.outcome_cohort_json(a.n::integer, a.c::integer, a.u::integer, a.i::integer, v_min),
    'cohort_baseline_uncontrolled', case
        when (a.n - b.n = 0 or a.n - b.n >= v_min)
         and ((a.c - b.c) = 0 or (a.c - b.c) >= v_min) and ((a.u - b.u) = 0 or (a.u - b.u) >= v_min) and ((a.i - b.i) = 0 or (a.i - b.i) >= v_min)
        then private.outcome_cohort_json(b.n::integer, b.c::integer, b.u::integer, b.i::integer, v_min)
        else jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'minimum', v_min) end,
    'change_among_measured', case when a.n_both >= v_min then jsonb_build_object('n', a.n_both, 'mean_systolic_change', round(a.mean_d_sys, 1), 'mean_diastolic_change', round(a.mean_d_dia, 1))
                                  else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'data_quality', case when a.n >= v_min then jsonb_build_object('enrolled_total', v_enrolled, 'not_yet_due', v_notdue,
        'baseline_missing_pct', round(100.0 * a.base_missing / a.n, 1), 'day_no_reading_pct', round(100.0 * a.i / a.n, 1),
        'default_target_used_pct', round(100.0 * a.n_def / a.n, 1))
      else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min, 'enrolled_total', v_enrolled, 'not_yet_due', v_notdue) end,
    'definition', 'People whose 7-day average home blood pressure in the window ending on day 180 is under their own target (or under 140/90 when none is set), from at least the minimum number of valid readings. Denominator: every person who joined and whose day-180 window has closed, including people with too few or no readings.',
    'limitations', 'Home readings on shared or unvalidated devices; readings that sync after the grace period are not added to a past snapshot; a before and after view without a comparison group says nothing about cause; small numbers are withheld; not a ranking of clinicians and never a reason to deny care.',
    'comparison_group', 'none',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.bp_control_aggregate_180(date, date) from public, anon, authenticated;

-- Day 90 delegates to the existing S38 aggregate unchanged; day 180 is the new report. Admin or the CMO, as bp_control_report.
create function public.bp_control_report_day(p_day integer, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_r jsonb;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  if p_day = 90 then v_r := private.bp_control_aggregate(p_from, p_to);
  elsif p_day = 180 then v_r := private.bp_control_aggregate_180(p_from, p_to);
  else raise exception 'outcome_day_not_reported' using errcode = '22023'; end if;
  perform private.log_audit('outcomes.bp_control_report', 'outcome_report', null, jsonb_build_object('day', p_day, 'from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.bp_control_report_day(integer, date, date) from public, anon;
grant execute on function public.bp_control_report_day(integer, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Mental health reads: the patient, an audited treating clinician, and suppressed aggregates for admin, analyst or the CMO
-- ---------------------------------------------------------------------------
-- The person reads their own snapshots.
create function public.my_mental_health_outcomes() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('instrument', s.instrument, 'day', s.day, 'baseline_score', s.baseline_score, 'score', s.score,
            'change', s.change, 'response', s.response_status, 'remission', s.remission_status, 'score_date', s.score_date) order by s.instrument, s.day)
          from public.outcome_mh_snapshots s where s.patient_id = v_uid), '[]'::jsonb);
end $$;
revoke all on function public.my_mental_health_outcomes() from public, anon;
grant execute on function public.my_mental_health_outcomes() to authenticated;

-- A treating clinician reads one patient: needs an active clinical_staff row, a real tie (care team, routed case, or active lead; the
-- break-glass and support-view routes are NOT accepted for this data), and a written reason. Every call is audited, a refusal included.
create function public.clinician_mental_health_outcomes(p_patient uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_rows jsonb;
begin
  if v_uid is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = p_patient and role <> 'patient') then
    raise exception 'not a patient' using errcode = '22023';
  end if;
  if not (private.clinician_has_patient_access(p_patient) or private.s35_is_my_lead(p_patient)) then
    perform private.s35_audit_read(p_patient, array['mental_health_outcomes'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('instrument', s.instrument, 'day', s.day, 'baseline_score', s.baseline_score, 'score', s.score,
            'change', s.change, 'response', s.response_status, 'remission', s.remission_status, 'score_date', s.score_date) order by s.instrument, s.day), '[]'::jsonb)
    into v_rows from public.outcome_mh_snapshots s where s.patient_id = p_patient;
  perform private.s35_audit_read(p_patient, array['mental_health_outcomes'], p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'rows', v_rows, 'note', 'Screening scores, not a diagnosis. Total scores only.');
end $$;
revoke all on function public.clinician_mental_health_outcomes(uuid, text) from public, anon;
grant execute on function public.clinician_mental_health_outcomes(uuid, text) to authenticated;

-- Suppressed aggregate: response and remission among people whose baseline total was at or above the configured line.
create function public.mental_health_outcome_report(p_instrument text, p_day integer, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ver integer := private.s75_measures_version();
  v_rule jsonb;
  v_min integer := (private.outcome_rule('min_cell') #>> '{}')::integer;
  a record; v_r jsonb;
begin
  if v_uid is null or not private.s75_is_outcome_analyst() then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  if v_ver is null then raise exception 'outcome_measures_not_active' using errcode = '22023'; end if;
  v_rule := private.s75_measure_rule(v_ver, p_instrument);
  if p_instrument not in ('phq9', 'gad7') or v_rule is null or p_day = 0 or not (v_rule -> 'days') @> to_jsonb(p_day) then
    raise exception 'outcome_measure_not_enabled' using errcode = '22023';
  end if;
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;
  select count(*) as n,
         count(*) filter (where s.response_status = 'response') as r_yes,
         count(*) filter (where s.response_status = 'no_response') as r_no,
         count(*) filter (where s.response_status = 'insufficient_data') as ins,
         count(*) filter (where s.remission_status = 'remitted') as m_yes,
         count(*) filter (where s.remission_status = 'not_remitted') as m_no
    into a
    from public.outcome_mh_snapshots s join public.profiles pr on pr.id = s.patient_id
   where s.instrument = p_instrument and s.day = p_day and s.response_status <> 'not_applicable'
     and not s.is_test and not coalesce(pr.is_test, false)
     and (p_from is null or s.anchor_date >= p_from) and (p_to is null or s.anchor_date <= p_to);
  v_r := jsonb_build_object(
    'measure', p_instrument, 'day', p_day, 'config_version', v_ver, 'minimum_cell', v_min,
    'response', private.s75_cohort_json(a.n::integer, a.r_yes::integer, a.r_no::integer, a.ins::integer, v_min),
    'remission', private.s75_cohort_json(a.n::integer, a.m_yes::integer, a.m_no::integer, a.ins::integer, v_min),
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'definition', v_rule ->> 'definition', 'limitations', v_rule ->> 'limitations',
    'comparison_group', 'none', 'not_a_causal_claim', true, 'generated_at', now());
  perform private.log_audit('outcomes.mental_health_report', 'outcome_report', null, jsonb_build_object('measure', p_instrument, 'day', p_day, 'from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.mental_health_outcome_report(text, integer, date, date) from public, anon;
grant execute on function public.mental_health_outcome_report(text, integer, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. De-identified analytics view for the NON mental health measures (service role only). Mental health has no analytics object.
-- ---------------------------------------------------------------------------
create view analytics.v_outcome_measure_snapshots with (security_invoker = off) as
  select sub.subject_key, s.organisation_id, s.measure_code, s.day,
         date_trunc('month', s.anchor_date)::date as enrolment_month,
         s.baseline_value, s.value, s.change_abs, s.change_pct, s.goal_status, s.change_status, s.target_source,
         s.config_version, s.computed_at::date as computed_on
    from public.outcome_measure_snapshots s
    join analytics.subjects sub on sub.patient_id = s.patient_id
    join public.profiles pr on pr.id = s.patient_id
   where not s.is_test and not coalesce(pr.is_test, false);
revoke all on analytics.v_outcome_measure_snapshots from public, anon, authenticated;
grant select on analytics.v_outcome_measure_snapshots to service_role;
comment on view analytics.v_outcome_measure_snapshots is
  'HbA1c and weight only: pseudonymised rows, no patient id, no test accounts, service role only. Mental health outcomes are deliberately not exposed through analytics.';

-- ---------------------------------------------------------------------------
-- 9. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select is_active from public.outcome_config where version = 3) then raise exception 'S75: config v3 must be inactive'; end if;
  if (select count(*) from public.outcome_config where is_active) <> 1 then raise exception 'S75: exactly one active outcome_config expected'; end if;
  if (select version from public.outcome_config where is_active) = 3 then raise exception 'S75: v3 became active'; end if;
  if private.s75_measures_version() is not null and (select version from public.outcome_config where is_active) = 3 then raise exception 'S75: measures live'; end if;
  if has_table_privilege('anon', 'public.outcome_mh_snapshots', 'SELECT') or has_table_privilege('anon', 'public.outcome_measure_snapshots', 'SELECT') then raise exception 'S75: anon can read a snapshot table'; end if;
  if has_table_privilege('authenticated', 'public.outcome_mh_snapshots', 'INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', 'public.outcome_measure_snapshots', 'INSERT,UPDATE,DELETE') then raise exception 'S75: a user can write a snapshot table'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'outcome_mh_snapshots' and policyname <> 'outcome_mh_snapshots_own') then raise exception 'S75: unexpected policy on the mental health table'; end if;
  if has_function_privilege('anon', 'public.outcome_measures_report(text,integer,date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mental_health_outcome_report(text,integer,date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clinician_mental_health_outcomes(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_mental_health_outcomes()', 'EXECUTE')
     or has_function_privilege('anon', 'public.bp_control_report_day(integer,date,date)', 'EXECUTE') then raise exception 'S75: anon can run a report'; end if;
  if has_function_privilege('authenticated', 'private.compute_outcome_measure_snapshots(timestamptz)', 'EXECUTE') then raise exception 'S75: a user can run the measure job'; end if;
  if has_table_privilege('authenticated', 'analytics.v_outcome_measure_snapshots', 'SELECT') then raise exception 'S75: analytics view is readable by a user'; end if;
end $$;
