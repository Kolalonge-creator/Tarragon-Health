-- S38b: the smallest group the report shows goes from 11 to 20 (founder decision 2026-10-07, OQ-233: Nigeria's data protection rules name
-- no number, a small Nigerian cohort is easier to re-identify, so the safer figure is used until counsel confirms). A config change is a new
-- version, never an edit: outcome_config v2 becomes the active row (snapshots already taken keep the version they used, INV-16), and the
-- published measure `bp_control_90d` gets spec version 2 (minimum 20) while version 1 is retired. The report function is re-created only to
-- read the current spec instead of version 1.
update public.outcome_config set is_active = false where is_active;
-- outcome-rules-v2-begin
insert into public.outcome_config (version, is_active, config, note) values (2, true, $json$
{
  "days": [0, 30, 90, 180],
  "window_days": 7,
  "grace_days": 3,
  "min_readings": 3,
  "default_target": { "systolic": 140, "diastolic": 90 },
  "min_cell": 20,
  "min_cell_cross": 30,
  "report_spec": "bp_control_90d"
}
$json$::jsonb, 'PROPOSED, v2 (2026-10-07). Owner: CMO. Smallest group shown raised from 11 to 20 (30 for a cut by two attributes) by founder decision, until counsel confirms a figure (OQ-233).');
-- outcome-rules-v2-end

insert into public.outcome_measure_specs (code, spec_version, title, domain, rationale, numerator_definition, denominator_definition,
    exclusion_definition, limitations, data_sources, unit, direction, min_denominator, compute_key, effective_from)
select code, 2, title, domain, rationale, numerator_definition, denominator_definition, exclusion_definition, limitations, data_sources,
       unit, direction, 20, compute_key, current_date
  from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = 1
  and not exists (select 1 from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = 2);
update public.outcome_measure_specs set retired_at = now() where code = 'bp_control_90d' and spec_version = 1 and retired_at is null;

create or replace function private.bp_control_aggregate(p_from date, p_to date) returns jsonb
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
    'measure', 'bp_control_90d', 'measure_version', (select spec_version from public.outcome_measure_specs where code = 'bp_control_90d' and retired_at is null order by spec_version desc limit 1),
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
    'definition', (select numerator_definition || ' Denominator: ' || denominator_definition from public.outcome_measure_specs where code = 'bp_control_90d' and retired_at is null order by spec_version desc limit 1),
    'limitations', (select limitations from public.outcome_measure_specs where code = 'bp_control_90d' and retired_at is null order by spec_version desc limit 1),
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.bp_control_aggregate(date, date) from public, anon, authenticated;

do $$
begin
  if (select (config ->> 'min_cell')::integer from public.outcome_config where is_active) <> 20 then raise exception 'S38b: the active config is not v2'; end if;
  if (select count(*) from public.outcome_config where is_active) <> 1 then raise exception 'S38b: not exactly one active config'; end if;
  if not exists (select 1 from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = 2 and retired_at is null and min_denominator = 20) then
    raise exception 'S38b: spec v2 missing'; end if;
end $$;
