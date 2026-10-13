-- S75a: ONE place that decides whether a number may be shown (spec D7, decision S75-5, OQ-319).
-- Design: docs/design/S75.md. Research: docs/research/S75.md.
--
-- Before this migration the smallest-group rule was written out by hand in nine places (the BP report, the monthly cohort list, the
-- analytics view, the sponsor report, the sponsor held-back month rule, the risk distribution, the triage agreement report, and the
-- corporate / payer dashboards, which used a different number from organisations.min_cohort_size). Each copy was correct on the day it was
-- written and each could drift. This migration:
--   * adds private.min_cell_floor / suppress_cell / suppress_difference / suppress_groups, the only code that compares a count with the minimum;
--   * moves every aggregate surface onto them (the proof scans the function bodies, so a hand-written copy is found);
--   * reconciles organisations.min_cohort_size (and insurers / provider_organisations): the floor is the GREATER of the platform minimum
--     (outcome_config.min_cell, 20, or min_cell_cross, 30, for a cut by two attributes) and the organisation's own number. An organisation can
--     raise its floor, never lower it below the platform minimum. The column default (10) is left as it is: it is now simply never the binding
--     number;
--   * generalises the 90-day BP report to any due day, so the 180-day report is the same code (no copy);
--   * closes three gaps found while moving the surfaces (see the design note section 3): the BP report showed "enrolled" and "not yet due" counts
--     for a cohort it had just withheld; the triage report suppressed small grades one by one but not against the overall figure; the
--     corporate subsidy breakdown and the reproductive analytics counted rows (claims, log entries) where the rule is about people.
-- Nothing here changes a stored row.

-- ---------------------------------------------------------------------------
-- 1. The floor
-- ---------------------------------------------------------------------------
create function private.min_cell_floor(p_org_floor integer default null, p_attributes integer default 1) returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare v_platform integer;
begin
  v_platform := (private.outcome_rule(case when coalesce(p_attributes, 1) >= 2 then 'min_cell_cross' else 'min_cell' end) #>> '{}')::integer;
  -- Fail closed: with no active configuration there is no safe number, so nothing may be shown.
  if v_platform is null or v_platform < 1 then raise exception 'min_cell_not_configured' using errcode = 'P0002'; end if;
  return greatest(v_platform, coalesce(p_org_floor, 0));
end $$;
revoke all on function private.min_cell_floor(integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. One cell: null means "may be shown"; otherwise the reason it may not.
--    n below the minimum, or ANY category count of 1 to minimum-1, withholds the whole cell (so a withheld small category cannot be
--    recovered by subtracting the shown ones). Zero is not a small cell. A missing count is never shown.
-- ---------------------------------------------------------------------------
create function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_min integer := coalesce(p_min, private.min_cell_floor()); c bigint;
begin
  if v_min < 1 then raise exception 'min_cell_invalid' using errcode = '22023'; end if;
  if p_n is null or p_n < v_min then return 'under_minimum'; end if;
  if p_categories is not null then
    foreach c in array p_categories loop
      if c is null or c < 0 then return 'small_cell'; end if;
      if c between 1 and v_min - 1 then return 'small_cell'; end if;
    end loop;
  end if;
  return null;
end $$;
revoke all on function private.suppress_cell(bigint, bigint[], integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A difference between two published numbers (the held-back month rule, "people who did not agree", "everyone due minus those who
--    started above target"). True when whole - part is 1 to minimum-1 people, or is negative (an impossible pair is never shown).
-- ---------------------------------------------------------------------------
create function private.suppress_difference(p_whole bigint, p_part bigint, p_min integer default null) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_min integer := coalesce(p_min, private.min_cell_floor()); d bigint;
begin
  if v_min < 1 then raise exception 'min_cell_invalid' using errcode = '22023'; end if;
  if p_whole is null or p_part is null then return true; end if;
  d := p_whole - p_part;
  return d < 0 or (d between 1 and v_min - 1);
end $$;
revoke all on function private.suppress_difference(bigint, bigint, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A list of groups that together make a whole (by sex, by age band, by grade, by month ...).
--    In:  [{"key": "...", "n": 12, "cats": [3, 9]}, ...]   Out: the same objects with "suppressed" (bool) and "reason" (text or null), by key.
--    Primary: each group through suppress_cell. Complementary: when exactly one group is withheld the next smallest shown group is withheld
--    too (otherwise the one hidden group is the total minus the others); when two or more are withheld and together they are fewer people than
--    the minimum, the next smallest is withheld as well. Never weaker than the rule it replaces (which only had the "exactly one" case).
-- ---------------------------------------------------------------------------
create function private.suppress_groups(p_groups jsonb, p_min integer default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_min integer := coalesce(p_min, private.min_cell_floor()); v_out jsonb;
begin
  if v_min < 1 then raise exception 'min_cell_invalid' using errcode = '22023'; end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then raise exception 'suppress_groups_bad_input' using errcode = '22023'; end if;
  with raw as (
    select g.doc ->> 'key' as k, (g.doc ->> 'n')::bigint as n, g.doc,
           private.suppress_cell((g.doc ->> 'n')::bigint,
             case when g.doc ? 'cats' and jsonb_typeof(g.doc -> 'cats') = 'array'
                  then (select array_agg(case when jsonb_typeof(x) = 'number' then (x #>> '{}')::bigint end) from jsonb_array_elements(g.doc -> 'cats') x) end,
             v_min) as reason
      from jsonb_array_elements(p_groups) as g(doc)),
  s as (select count(*) as cnt, coalesce(sum(coalesce(n, 0)), 0) as sm from raw where reason is not null),
  nxt as (select k from raw where reason is null order by n, k limit 1),
  fin as (
    select r.k, r.doc,
           case when r.reason is not null then r.reason
                when r.k = (select k from nxt) and ((select cnt from s) = 1 or ((select cnt from s) >= 2 and (select sm from s) < v_min)) then 'complementary'
           end as reason
      from raw r)
  select coalesce(jsonb_agg(doc || jsonb_build_object('suppressed', reason is not null, 'reason', reason) order by k), '[]'::jsonb) into v_out from fin;
  return v_out;
end $$;
revoke all on function private.suppress_groups(jsonb, integer) from public, anon, authenticated;

-- The cohort JSON shape used by the BP report, the monthly list and the sponsor report. Same signature as before; now a thin shape over suppress_cell.
create or replace function private.outcome_cohort_json(p_n integer, p_ctrl integer, p_unctrl integer, p_insuf integer, p_min integer) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare v_reason text := private.suppress_cell(p_n, array[p_ctrl, p_unctrl, p_insuf]::bigint[], p_min);
begin
  if v_reason = 'under_minimum' then return jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', p_min); end if;
  if v_reason = 'small_cell' then return jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'n', p_n, 'minimum', p_min); end if;
  return jsonb_build_object('suppressed', false, 'n', p_n, 'controlled', p_ctrl, 'uncontrolled', p_unctrl, 'insufficient_data', p_insuf,
    'rate_strict_pct', round(100.0 * p_ctrl / p_n, 1),
    'rate_among_measured_pct', case when private.suppress_cell(p_ctrl + p_unctrl, null, p_min) is null then round(100.0 * p_ctrl / (p_ctrl + p_unctrl), 1) end,
    'missing_pct', round(100.0 * p_insuf / p_n, 1));
end $$;
revoke all on function private.outcome_cohort_json(integer, integer, integer, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The BP control report for any due day (90 and 180): one body, no copy.
-- ---------------------------------------------------------------------------
insert into public.outcome_measure_specs (code, spec_version, title, domain, rationale, numerator_definition, denominator_definition,
    exclusion_definition, limitations, data_sources, unit, direction, min_denominator, compute_key, effective_from)
select 'bp_control_180d', 1, 'Blood pressure control 180 days after joining', domain,
       'Shows whether people who joined the programme still have their blood pressure under control after six months, counting people who stopped logging as not controlled so the figure cannot be flattered by drop-out.',
       replace(numerator_definition, 'day 90', 'day 180'), replace(denominator_definition, 'day-90', 'day-180'),
       exclusion_definition, limitations, data_sources, unit, direction, 20, 'bp_control_180d', current_date
  from public.outcome_measure_specs where code = 'bp_control_90d' and retired_at is null order by spec_version desc limit 1
on conflict do nothing;

-- Both due days read one view. Day 90 comes from the existing private.v_bp_cohort_90d (the one place that cohort is defined and test accounts
-- are left out, which the sponsor report also reads); day 180 is the same definition for the later snapshot.
create view private.v_bp_cohort_day with (security_invoker = off) as
  select c.patient_id, 90 as day, c.anchor, c.s90 as s_due, c.s0, c.d_sys, c.d_dia, c.adh, c.adh_unavailable, c.defaulted, c.late
    from private.v_bp_cohort_90d c
  union all
  select s.patient_id, 180 as day, s.anchor_date as anchor, s.bp_status as s_due, s0.bp_status as s0,
         case when s.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s.bp_avg_7d_sys - s0.bp_avg_7d_sys end as d_sys,
         case when s.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s.bp_avg_7d_dia - s0.bp_avg_7d_dia end as d_dia,
         s.adherence_pct::integer as adh, s.adherence_status = 'unavailable' as adh_unavailable, s.target_source = 'default' as defaulted,
         exists (select 1 from public.vitals_readings o where o.patient_id = s.patient_id and o.vital_type = 'blood_pressure'
                    and (o.validation_status = 'valid' or coalesce(o.validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
                    and (o.taken_at at time zone 'Africa/Lagos')::date between s.window_start and s.window_end and o.created_at > s.computed_at) as late
    from public.outcome_snapshots s
    join public.profiles pr on pr.id = s.patient_id
    left join public.outcome_snapshots s0 on s0.patient_id = s.patient_id and s0.pathway_code = s.pathway_code and s0.day = 0
   where s.pathway_code = 'bp' and s.day = 180 and not s.is_test and not coalesce(pr.is_test, false);
revoke all on private.v_bp_cohort_day from public, anon, authenticated;

create function private.bp_control_aggregate_day(p_day integer, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := private.min_cell_floor();
  v_code text := 'bp_control_' || p_day || 'd';
  a record; b record; q record; m jsonb; v_enrolled integer; v_notdue integer; v_months_withheld integer := 0; v_show_enrolled boolean; v_show_notdue boolean;
begin
  if p_day not in (90, 180) then raise exception 'bp_control_day_not_supported' using errcode = '22023'; end if;
  -- Reports are by whole calendar month of joining: two ranges one day apart could otherwise be subtracted to expose a small cohort.
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;
  drop table if exists pg_temp._s75_cohort;
  create temp table _s75_cohort on commit drop as
    select * from private.v_bp_cohort_day c
     where c.day = p_day and (p_from is null or c.anchor >= p_from) and (p_to is null or c.anchor <= p_to);

  select count(*) as n, count(*) filter (where s_due = 'controlled') c, count(*) filter (where s_due = 'uncontrolled') u,
         count(*) filter (where s_due = 'insufficient_data') i,
         count(*) filter (where s0 is null or s0 = 'insufficient_data') base_missing,
         count(*) filter (where d_sys is not null) n_both, avg(d_sys) filter (where d_sys is not null) mean_d_sys, avg(d_dia) filter (where d_dia is not null) mean_d_dia,
         count(*) filter (where adh is not null) n_adh, avg(adh) filter (where adh is not null) mean_adh, count(*) filter (where adh_unavailable) n_adh_unavail,
         count(*) filter (where defaulted) n_def, count(*) filter (where late) n_late
    into a from _s75_cohort;
  select count(*) as n, count(*) filter (where s_due = 'controlled') c, count(*) filter (where s_due = 'uncontrolled') u,
         count(*) filter (where s_due = 'insufficient_data') i
    into b from _s75_cohort where s0 = 'uncontrolled';

  select count(*) into v_enrolled from (
    select j.patient_id, min(j.dt) anchor from (
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date dt from public.patient_memberships
      union all
      select patient_id, (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where kind in ('membership', 'care_pack')) j
      join public.profiles p on p.id = j.patient_id and not coalesce(p.is_test, false)
     group by j.patient_id) e
   where (p_from is null or e.anchor >= p_from) and (p_to is null or e.anchor <= p_to);
  v_notdue := greatest(v_enrolled - a.n, 0);
  -- "How many enrolled" is a count of people like any other: shown only when it clears the minimum, and "not yet due" only when it is 0 or clears it.
  v_show_enrolled := private.suppress_cell(v_enrolled, null, v_min) is null;
  v_show_notdue := v_show_enrolled and not private.suppress_difference(v_enrolled, a.n, v_min);

  m := '[]'::jsonb;
  for q in select date_trunc('month', anchor)::date mon, count(*) n, count(*) filter (where s_due = 'controlled') c, count(*) filter (where s_due = 'uncontrolled') u,
                  count(*) filter (where s_due = 'insufficient_data') i from _s75_cohort group by 1 order by 1 loop
    if private.suppress_cell(q.n, array[q.c, q.u, q.i], v_min) is null then
      m := m || jsonb_build_array(jsonb_build_object('enrolment_month', q.mon) || private.outcome_cohort_json(q.n::integer, q.c::integer, q.u::integer, q.i::integer, v_min));
    else
      v_months_withheld := v_months_withheld + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'measure', v_code, 'due_day', p_day,
    'measure_version', (select spec_version from public.outcome_measure_specs where code = v_code and retired_at is null order by spec_version desc limit 1),
    'config_version', (select version from public.outcome_config where is_active),
    'minimum_cell', v_min,
    'cohort_all_due', private.outcome_cohort_json(a.n::integer, a.c::integer, a.u::integer, a.i::integer, v_min),
    -- The baseline cohort is a subset of everyone due: show it only when what is left over is itself either empty or large enough in every
    -- category, so subtraction cannot expose a small group.
    'cohort_baseline_uncontrolled', case
        when not private.suppress_difference(a.n, b.n, v_min) and not private.suppress_difference(a.c, b.c, v_min)
         and not private.suppress_difference(a.u, b.u, v_min) and not private.suppress_difference(a.i, b.i, v_min)
        then private.outcome_cohort_json(b.n::integer, b.c::integer, b.u::integer, b.i::integer, v_min)
        else jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'minimum', v_min) end,
    'change_among_measured', case when private.suppress_cell(a.n_both, null, v_min) is null then jsonb_build_object('n', a.n_both, 'mean_systolic_change', round(a.mean_d_sys, 1), 'mean_diastolic_change', round(a.mean_d_dia, 1))
                                  else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'adherence_separate', case when private.suppress_cell(a.n_adh, null, v_min) is null then jsonb_build_object('n', a.n_adh, 'mean_pct', round(a.mean_adh, 1))
                               else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    -- If any month is withheld the list is not returned at all: the withheld month would equal the overall total minus the listed ones.
    'by_enrolment_month', case when v_months_withheld = 0 then m else '[]'::jsonb end, 'months_withheld', v_months_withheld,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'data_quality', case when private.suppress_cell(a.n, null, v_min) is null then jsonb_build_object(
        'enrolled_total', case when v_show_enrolled then v_enrolled end, 'not_yet_due', case when v_show_notdue then v_notdue end,
        'baseline_missing_pct', round(100.0 * a.base_missing / a.n, 1),
        'due_day_no_reading_pct', round(100.0 * a.i / a.n, 1),
        'day90_no_reading_pct', case when p_day = 90 then round(100.0 * a.i / a.n, 1) end,
        'default_target_used_pct', round(100.0 * a.n_def / a.n, 1),
        'adherence_unavailable_pct', round(100.0 * a.n_adh_unavail / a.n, 1),
        'readings_arriving_after_snapshot_pct', round(100.0 * a.n_late / a.n, 1))
      else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min,
                              'enrolled_total', case when v_show_enrolled then v_enrolled end, 'not_yet_due', case when v_show_notdue then v_notdue end) end,
    'bp_basis', 'Each person is judged against their own home target when they have one, otherwise 140/90 (decision S75-1). Home readings usually run lower than clinic readings, so control may be overstated. Revisit before any sponsor-facing use.',
    'definition', (select numerator_definition || ' Denominator: ' || denominator_definition from public.outcome_measure_specs where code = v_code and retired_at is null order by spec_version desc limit 1),
    'limitations', (select limitations from public.outcome_measure_specs where code = v_code and retired_at is null order by spec_version desc limit 1),
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.bp_control_aggregate_day(integer, date, date) from public, anon, authenticated;

-- The 90-day function keeps its name and signature (the public report, the admin page and the proofs call it).
create or replace function private.bp_control_aggregate(p_from date, p_to date) returns jsonb
language sql security definer set search_path = ''
as $$ select private.bp_control_aggregate_day(90, p_from, p_to) $$;
revoke all on function private.bp_control_aggregate(date, date) from public, anon, authenticated;

create function public.bp_control_report_180d(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_r jsonb;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  v_r := private.bp_control_aggregate_day(180, p_from, p_to);
  perform private.log_audit('outcomes.bp_control_report_180d', 'outcome_report', null, jsonb_build_object('from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.bp_control_report_180d(date, date) from public, anon;
grant execute on function public.bp_control_report_180d(date, date) to authenticated;

-- The analytics view for BI: same rule, same function.
create or replace view analytics.v_bp_control_90d_by_month with (security_invoker = off) as
  with c as (
    select date_trunc('month', s.anchor_date)::date as enrolment_month, count(*) n,
           count(*) filter (where s.bp_status = 'controlled') ctrl, count(*) filter (where s.bp_status = 'uncontrolled') unctrl,
           count(*) filter (where s.bp_status = 'insufficient_data') insuf
      from public.outcome_snapshots s join public.profiles pr on pr.id = s.patient_id
     where s.pathway_code = 'bp' and s.day = 90 and not s.is_test and not coalesce(pr.is_test, false) group by 1)
  select enrolment_month, n, ctrl as controlled, unctrl as uncontrolled, insuf as insufficient_data,
         round(100.0 * ctrl / n, 1) as rate_strict_pct,
         round(100.0 * insuf / n, 1) as missing_pct
    from c
   where private.suppress_cell(n, array[ctrl, unctrl, insuf]::bigint[]) is null;

-- ---------------------------------------------------------------------------
-- 6. The corporate, payer and reproductive dashboards onto the same rule.
--    (a) the floor is private.min_cell_floor(<the organisation's own number>): the greater of the platform minimum and the organisation's;
--    (b) test accounts are left out (INV-13; OQ-39 for the surfaces touched here);
--    (c) the subsidy breakdown and the reproductive frequencies count PEOPLE and withhold complementary cells.
--    generate_payer_board_report also stops asking the board engine to compute the S38 cohort measures (bp_control_90d and bp_control_180d have
--    no board computation, so switching the payer platform on would have raised on the first report).
-- ---------------------------------------------------------------------------
create function private.board_measure_keys() returns text[]
language sql immutable set search_path = ''
as $$ select array['bp_control', 'glycaemic_control', 'programme_enrolment', 'review_currency', 'escalation_response', 'screening_completion'] $$;
revoke all on function private.board_measure_keys() from public, anon, authenticated;

create or replace function public.payer_dashboard_analytics(p_insurer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_insurer public.insurers%rowtype;
  v_min_cohort integer;
  v_member_count integer;
  v_conditions jsonb;
begin
  if not private.is_payer_admin_for(p_insurer_id) then
    raise exception 'not authorised to view this insurer''s analytics' using errcode = '42501';
  end if;

  select * into v_insurer from public.insurers where id = p_insurer_id;
  v_min_cohort := private.min_cell_floor(v_insurer.min_cohort_size);

  select count(distinct ip0.patient_id) into v_member_count
  from public.insurance_policies ip0
  join public.profiles tp0 on tp0.id = ip0.patient_id and not coalesce(tp0.is_test, false)
  where ip0.insurer_id = p_insurer_id and ip0.status = 'active' and ip0.verified_at is not null
    and (ip0.effective_to is null or ip0.effective_to >= current_date);

  if private.suppress_cell(v_member_count, null, v_min_cohort) is not null then
    return jsonb_build_object(
      'suppressed', true,
      'min_cohort_size', v_min_cohort,
      'note', 'Fewer than ' || v_min_cohort || ' verified members — no figures shown to protect individual privacy.'
    );
  end if;

  -- One row per programme this insurer has ever directed, or that at least
  -- one of its members is independently enrolled in — a member can reach a
  -- Tarragon chronic-disease programme without a payer directive (a
  -- clinician can still recommend it directly), and the payer should see
  -- that too, not only what it itself triggered.
  select coalesce(jsonb_agg(jsonb_build_object(
           'programme_id', s.programme_id,
           'programme_name', s.programme_name,
           'condition', s.condition,
           'members_with_condition',
             case when private.suppress_cell(s.members_with_condition, null, v_min_cohort) is null then s.members_with_condition end,
           'enrolled', case when private.suppress_cell(s.enrolled, null, v_min_cohort) is null then s.enrolled end,
           'controlled', case when private.suppress_cell(s.controlled, null, v_min_cohort) is null then s.controlled end,
           'overdue_review', case when private.suppress_cell(s.overdue_review, null, v_min_cohort) is null then s.overdue_review end,
           'suppressed_subgroup', private.suppress_cell(s.members_with_condition, null, v_min_cohort) is not null
         )), '[]'::jsonb)
    into v_conditions
  from (
    select
      cp.id as programme_id,
      cp.name as programme_name,
      cp.condition::text as condition,
      count(distinct pc.patient_id) filter (where pc.status = 'active') as members_with_condition,
      count(distinct e.patient_id) filter (where e.status = 'enrolled') as enrolled,
      count(distinct e.patient_id) filter (
        where e.status = 'enrolled'
          and exists (
            select 1 from public.patient_risk_scores rs
            where rs.patient_id = e.patient_id and rs.risk_level = 'low'
              and rs.computed_at = (select max(computed_at) from public.patient_risk_scores
                                      where patient_id = e.patient_id)
          )
      ) as controlled,
      count(distinct pc.patient_id) filter (
        where pc.status = 'active' and pc.next_review_due_at is not null and pc.next_review_due_at < now()
      ) as overdue_review
    from public.chronic_condition_programmes cp
    join public.insurance_policies ip on ip.insurer_id = p_insurer_id
                                      and ip.status = 'active' and ip.verified_at is not null
    join public.profiles tp on tp.id = ip.patient_id and not coalesce(tp.is_test, false)
    left join public.patient_conditions pc
           on pc.patient_id = ip.patient_id and lower(pc.condition_name) = lower(cp.condition::text)
    left join public.chronic_programme_enrolments e
           on e.patient_id = ip.patient_id and e.programme_id = cp.id
    where cp.is_active
    group by cp.id, cp.name, cp.condition
    having count(distinct pc.patient_id) filter (where pc.status = 'active') > 0
        or count(distinct e.patient_id) > 0
  ) s;

  return jsonb_build_object(
    'suppressed', false,
    'min_cohort_size', v_min_cohort,
    'member_count', v_member_count,
    'programmes', v_conditions
  );
end;
$function$;

create or replace function public.generate_payer_board_report(p_insurer_id uuid, p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Bump on any change to a compute branch that alters what a number MEANS.
  c_engine_version constant text := '1.0.0';
  v_insurer        public.insurers%rowtype;
  v_spec           record;
  v_raw            jsonb;
  v_floor          integer;
  v_reportable     boolean;
  v_measures       jsonb := '[]'::jsonb;
  v_limitations    text[] := array[]::text[];
  v_any            integer;
  v_cont           integer;
  v_joiners        integer;
  v_leavers        integer;
  v_claims         jsonb;
  v_claim_count    integer;
  v_snapshot       jsonb;
  v_hash           text;
  v_seq            integer;
  v_number         text;
  v_prefix         text;
  v_generated_at   timestamptz := now();
  v_generator      text;
  v_report_id      uuid;
  v_unmeasurable_total integer := 0;
  v_unreportable_count integer := 0;
begin
  perform private.assert_module_enabled('payer_platform');

  -- An analyst seat is enough to produce a draft; owner covers it implicitly.
  if not private.is_payer_admin_for(p_insurer_id, array['analyst', 'owner']) then
    raise exception 'not authorised to generate reports for this insurer' using errcode = '42501';
  end if;

  if p_period_end < p_period_start then
    raise exception 'the period ends before it starts' using errcode = '23514';
  end if;
  -- A period that has not finished cannot be reported on: half a quarter's
  -- readings would land in the denominator of a measure a reader will take as
  -- covering the whole quarter.
  if p_period_end >= current_date then
    raise exception 'a board report can only cover a period that has already ended — the latest permitted end date is %', (current_date - 1)
      using errcode = '23514';
  end if;

  select * into v_insurer from public.insurers where id = p_insurer_id;
  if v_insurer.id is null then
    raise exception 'no such insurer' using errcode = '42501';
  end if;

  select full_name into v_generator from public.profiles where id = (select auth.uid());

  -- ---------------------------------------------------------------- cohort
  select count(*) into v_any  from private.board_cohort(p_insurer_id, p_period_start, p_period_end, false);
  select count(*) into v_cont from private.board_cohort(p_insurer_id, p_period_start, p_period_end, true);

  select count(distinct ip.patient_id) into v_joiners
  from public.insurance_policies ip
  where ip.insurer_id = p_insurer_id and ip.status = 'active' and ip.verified_at is not null
    and ip.effective_from > p_period_start and ip.effective_from <= p_period_end;

  select count(distinct ip.patient_id) into v_leavers
  from public.insurance_policies ip
  where ip.insurer_id = p_insurer_id and ip.verified_at is not null
    and ip.effective_to is not null
    and ip.effective_to >= p_period_start and ip.effective_to < p_period_end;

  -- --------------------------------------------------------------- measures
  -- The latest non-retired version of every measure in force ON THE DAY THE
  -- REPORT IS PRODUCED — not on the period end date. A report written in
  -- September about the first quarter applies today's definitions to that
  -- quarter's data, which is what a reader assumes and what makes two reports
  -- issued together comparable. Gating on the period end instead would mean a
  -- measure defined after a quarter closed could never be reported for it, and
  -- would have silently produced an EMPTY report here. Which version was used
  -- is recorded per measure in the snapshot, so any two reports can be checked
  -- against each other rather than assumed comparable.
  for v_spec in
    select distinct on (s.code) s.*
    from public.outcome_measure_specs s
    where s.retired_at is null and s.effective_from <= current_date
      and s.compute_key = any (private.board_measure_keys())
    order by s.code, s.spec_version desc
  loop
    v_raw := private.compute_board_measure(v_spec.compute_key, p_insurer_id, p_period_start, p_period_end);
    v_floor := greatest(v_spec.min_denominator, private.min_cell_floor(v_insurer.min_cohort_size));
    -- The rate's own base must clear the floor, not just the eligible
    -- population: a measure with 400 eligible and 6 measurable publishes
    -- nothing, because a rate over 6 people is neither private nor meaningful.
    v_reportable := private.suppress_cell(((v_raw ->> 'measurable')::integer), null, v_floor) is null;

    if not v_reportable then
      v_unreportable_count := v_unreportable_count + 1;
    end if;
    v_unmeasurable_total := v_unmeasurable_total + (v_raw ->> 'unmeasurable')::integer;

    v_measures := v_measures || jsonb_build_array(jsonb_build_object(
      'code', v_spec.code,
      'spec_version', v_spec.spec_version,
      'title', v_spec.title,
      'domain', v_spec.domain,
      'unit', v_spec.unit,
      'direction', v_spec.direction,
      'definitions', jsonb_build_object(
        'rationale', v_spec.rationale,
        'numerator', v_spec.numerator_definition,
        'denominator', v_spec.denominator_definition,
        'exclusions', v_spec.exclusion_definition,
        'limitations', v_spec.limitations,
        'data_sources', to_jsonb(v_spec.data_sources)
      ),
      'suppression_floor', v_floor,
      'reportable', v_reportable,
      'not_reportable_reason', case when v_reportable then null else
        'Fewer than ' || v_floor || ' members had the data this measure needs, so no figure is published.' end,
      -- Below the floor these are NULL, never 0. A zero here would be read as
      -- "nobody achieved it" rather than "we are not telling you".
      'denominator',  case when v_reportable then (v_raw ->> 'denominator')::integer  else null end,
      'measurable',   case when v_reportable then (v_raw ->> 'measurable')::integer   else null end,
      'numerator',    case when v_reportable then (v_raw ->> 'numerator')::integer    else null end,
      'unmeasurable', case when v_reportable then (v_raw ->> 'unmeasurable')::integer else null end,
      'unmeasurable_reason', case when v_reportable then v_raw ->> 'unmeasurable_reason' else null end,
      'rate_pct', case
        when v_reportable and (v_raw ->> 'measurable')::integer > 0
        then round(100.0 * (v_raw ->> 'numerator')::numeric / (v_raw ->> 'measurable')::numeric, 1)
        else null end,
      'data_completeness_pct', case
        when v_reportable and (v_raw ->> 'denominator')::integer > 0
        then round(100.0 * (v_raw ->> 'measurable')::numeric / (v_raw ->> 'denominator')::numeric, 1)
        else null end
    ));
  end loop;

  -- A report with no measures is not a report. This cannot happen with the
  -- shipped measure set, but a future migration that retires every spec, or a
  -- date predicate that quietly matches nothing, would otherwise issue a
  -- beautifully formatted document asserting exactly nothing — and it would
  -- verify, and somebody would put it in front of a board. Refuse instead.
  if jsonb_array_length(v_measures) = 0 then
    raise exception 'no outcome measure specifications are in force, so there is nothing to report — refusing to issue an empty report'
      using errcode = '23514';
  end if;

  -- -------------------------------------------------------------- financial
  -- Reconciliation of what was actually transacted. Reported as fact; nothing
  -- is projected, modelled or annualised from it.
  select count(*) into v_claim_count
  from public.insurance_claims cl
  join public.insurance_policies ip on ip.id = cl.policy_id
  where ip.insurer_id = p_insurer_id
    and cl.submitted_at >= p_period_start::timestamptz
    and cl.submitted_at < (p_period_end + 1)::timestamptz;

  if private.suppress_cell(v_claim_count, null, private.min_cell_floor(v_insurer.min_cohort_size)) is not null then
    v_claims := jsonb_build_object(
      'reportable', false,
      'not_reportable_reason', 'Too few claims in the period to report without risking identification of an individual member.');
  else
    select jsonb_build_object(
      'reportable', true,
      'claims_submitted', count(*),
      'claims_paid', count(*) filter (where cl.status = 'paid'),
      'claims_denied', count(*) filter (where cl.status = 'denied'),
      'claims_open', count(*) filter (where cl.status not in ('paid', 'denied')),
      'billed_kobo', coalesce(sum(cl.billed_amount_kobo), 0),
      'insurer_covered_kobo', coalesce(sum(cl.insurer_covered_kobo), 0),
      'member_copay_kobo', coalesce(sum(cl.patient_copay_kobo), 0))
      into v_claims
    from public.insurance_claims cl
    join public.insurance_policies ip on ip.id = cl.policy_id
    where ip.insurer_id = p_insurer_id
      and cl.submitted_at >= p_period_start::timestamptz
      and cl.submitted_at < (p_period_end + 1)::timestamptz;
  end if;

  -- ------------------------------------------------------------ limitations
  -- Derived from what actually happened in this run, not boilerplate, except
  -- the last two, which are true of every report this platform can produce
  -- and are therefore always stated.
  if v_cont = 0 then
    v_limitations := array_append(v_limitations,
      'No member of this insurer was continuously covered for the whole period, so no clinical or process measure has a population to report on.');
  elsif v_cont < v_any then
    v_limitations := array_append(v_limitations,
      'Of ' || v_any || ' members covered at some point in the period, ' || v_cont ||
      ' were covered throughout it. Clinical and process measures use only the continuously covered group.');
  end if;
  if v_unreportable_count > 0 then
    v_limitations := array_append(v_limitations,
      v_unreportable_count || ' of ' || jsonb_array_length(v_measures) ||
      ' measures are withheld because too few members had the data they need. No figure is shown for those rows.');
  end if;
  if v_unmeasurable_total > 0 then
    v_limitations := array_append(v_limitations,
      'Some eligible members had no qualifying measurement in the period. They are counted in each measure''s "not measurable" column and excluded from its rate, never counted as a failure.');
  end if;
  v_limitations := array_append(v_limitations,
    'These figures describe what happened to the covered population. There is no control group and no counterfactual, so nothing here establishes what would have happened without the programme.');
  v_limitations := array_append(v_limitations,
    'No cost saving, avoided admission or return on investment is asserted anywhere in this report. Financial figures are a reconciliation of claims actually transacted.');

  -- ------------------------------------------------------ number + snapshot
  -- Serialise per insurer so two concurrent generations cannot take the same
  -- sequence number and collide on the unique constraint.
  perform pg_advisory_xact_lock(hashtextextended(p_insurer_id::text, 0));
  select coalesce(max(sequence_no), 0) + 1 into v_seq
  from public.payer_board_reports where insurer_id = p_insurer_id;

  v_prefix := coalesce(nullif(upper(regexp_replace(coalesce(v_insurer.code, ''), '[^A-Za-z0-9]', '', 'g')), ''),
                       upper(substr(replace(p_insurer_id::text, '-', ''), 1, 6)));
  v_number := 'TAR-' || v_prefix || '-' || to_char(p_period_end, 'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  v_snapshot := jsonb_build_object(
    'report', jsonb_build_object(
      'number', v_number,
      'insurer_name', v_insurer.name,
      'insurer_code', v_insurer.code,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'generated_at', v_generated_at,
      'generated_by_name', v_generator,
      'engine_version', c_engine_version
    ),
    'cohort', jsonb_build_object(
      'covered_any_time', v_any,
      'continuously_covered', v_cont,
      'joined_during_period', v_joiners,
      'left_during_period', v_leavers,
      'suppression_floor', private.min_cell_floor(v_insurer.min_cohort_size),
      'definition', 'A member is a patient holding a verified, active policy with this insurer. "Continuously covered" means the policy was in force on the first day of the period and had not ended before the last day. Clinical and process measures use the continuously covered group only.'
    ),
    'measures', v_measures,
    'financial', v_claims,
    'limitations', to_jsonb(v_limitations),
    'lineage', jsonb_build_object(
      'source_tables', to_jsonb(array[
        'insurance_policies', 'patient_conditions', 'vitals_readings',
        'chronic_programme_enrolments', 'chronic_condition_programmes',
        'clinician_alerts', 'screening_results', 'insurance_claims']),
      'computed_at', v_generated_at,
      'timezone', 'Africa/Lagos',
      'engine_version', c_engine_version,
      'measure_definitions_in_force_on', current_date,
      'note', 'Every figure above was computed directly from these tables at the time stated. No figure was entered by hand, imported, or adjusted after computation. Each measure records the exact specification version used to produce it.'
    )
  );

  v_hash := private.board_report_hash(v_number, p_period_start, p_period_end, v_snapshot);

  insert into public.payer_board_reports (
    insurer_id, report_number, sequence_no, period_start, period_end,
    snapshot, content_hash, engine_version, generated_at, generated_by)
  values (
    p_insurer_id, v_number, v_seq, p_period_start, p_period_end,
    v_snapshot, v_hash, c_engine_version, v_generated_at, (select auth.uid()))
  returning id into v_report_id;

  -- A later report for the same insurer and period replaces the earlier one as
  -- the current statement of that period. The earlier one stays readable and
  -- hash-verifiable forever, because copies of it are already in circulation.
  update public.payer_board_reports
     set status = 'superseded', superseded_by = v_report_id
   where insurer_id = p_insurer_id
     and period_start = p_period_start and period_end = p_period_end
     and id <> v_report_id
     and status in ('draft', 'attested');

  perform private.log_audit('payer.board_report.generated', 'payer_board_report', v_report_id,
    jsonb_build_object('insurer_id', p_insurer_id, 'report_number', v_number,
                       'period_start', p_period_start, 'period_end', p_period_end,
                       'content_hash', v_hash));

  return jsonb_build_object('ok', true, 'report_id', v_report_id,
                            'report_number', v_number, 'content_hash', v_hash);
end;
$function$;

create or replace function public.institution_subsidy_summary(p_organisation_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_min_cohort integer;
  v_people integer;
  v_total bigint;
  v_categories jsonb;
begin
  if not private.can_manage_employer(p_organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  v_min_cohort := private.min_cell_floor((select min_cohort_size from public.organisations where id = p_organisation_id));

  -- People, not claims: one beneficiary with many claims is still one person. Test accounts are never counted (INV-13).
  select count(distinct ts.beneficiary_profile_id) into v_people
  from public.transaction_subsidies ts
  join public.profiles bp on bp.id = ts.beneficiary_profile_id and not coalesce(bp.is_test, false)
  where ts.organisation_id = p_organisation_id and ts.status = 'paid'
    and (p_from is null or ts.created_at::date >= p_from)
    and (p_to is null or ts.created_at::date <= p_to);

  if private.suppress_cell(v_people, null, v_min_cohort) is not null then
    return jsonb_build_object(
      'suppressed', true, 'min_cohort_size', v_min_cohort,
      'note', 'Fewer than ' || v_min_cohort || ' distinct sponsored people, so no figures are shown to protect individual privacy.'
    );
  end if;

  select coalesce(sum(ts.sponsor_amount_kobo), 0) into v_total
  from public.transaction_subsidies ts
  join public.profiles bp on bp.id = ts.beneficiary_profile_id and not coalesce(bp.is_test, false)
  where ts.organisation_id = p_organisation_id and ts.status = 'paid'
    and (p_from is null or ts.created_at::date >= p_from)
    and (p_to is null or ts.created_at::date <= p_to);

  -- One row per order type; a type with few people behind it is withheld, and so is the next smallest, so it cannot be worked out from the total.
  select coalesce(jsonb_agg(case when (g ->> 'suppressed')::boolean
           then jsonb_build_object('category_label', initcap(g ->> 'key') || ' order', 'suppressed', true)
           else jsonb_build_object('category_label', initcap(g ->> 'key') || ' order', 'suppressed', false,
                  'sponsor_paid_kobo', (g ->> 'kobo')::bigint, 'claim_count', (g ->> 'claims')::integer) end order by g ->> 'key'), '[]'::jsonb)
    into v_categories
  from jsonb_array_elements(private.suppress_groups((
    select coalesce(jsonb_agg(jsonb_build_object('key', c.order_type, 'n', c.people, 'kobo', c.cat_total, 'claims', c.cat_count)), '[]'::jsonb)
    from (
      select ts.order_type, count(distinct ts.beneficiary_profile_id) as people, sum(ts.sponsor_amount_kobo) as cat_total, count(*) as cat_count
      from public.transaction_subsidies ts
      join public.profiles bp on bp.id = ts.beneficiary_profile_id and not coalesce(bp.is_test, false)
      where ts.organisation_id = p_organisation_id and ts.status = 'paid'
        and (p_from is null or ts.created_at::date >= p_from)
        and (p_to is null or ts.created_at::date <= p_to)
      group by ts.order_type
    ) c), v_min_cohort)) g;

  return jsonb_build_object(
    'suppressed', false, 'min_cohort_size', v_min_cohort,
    'total_sponsor_paid_kobo', v_total, 'claim_count', (select count(*) from public.transaction_subsidies ts
        join public.profiles bp on bp.id = ts.beneficiary_profile_id and not coalesce(bp.is_test, false)
       where ts.organisation_id = p_organisation_id and ts.status = 'paid'
         and (p_from is null or ts.created_at::date >= p_from) and (p_to is null or ts.created_at::date <= p_to)),
    'category_breakdown', v_categories
  );
end;
$function$;

create or replace function public.reproductive_health_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_floor integer := private.min_cell_floor();
  v_profile_count integer;
  v_life_stage_breakdown jsonb;
  v_cycle_tracking_patients integer;
  v_total_cycles_logged integer;
  v_avg_cycle_length numeric;
  v_symptom_freq jsonb;
  v_mood_freq jsonb;
begin
  if not private.is_admin() then
    raise exception 'reproductive_health_analytics: admin only';
  end if;

  -- Test accounts are never counted (INV-13). Every figure below is a number of PEOPLE: a symptom logged many times by one person is one.
  select count(*) into v_profile_count
  from public.reproductive_health_profiles r
  join public.profiles p on p.id = r.patient_id and not coalesce(p.is_test, false);

  select coalesce(jsonb_object_agg(g ->> 'key', (g ->> 'n')::integer) filter (where not (g ->> 'suppressed')::boolean), '{}'::jsonb) into v_life_stage_breakdown
  from jsonb_array_elements(private.suppress_groups((
    select coalesce(jsonb_agg(jsonb_build_object('key', life_stage::text, 'n', cnt)), '[]'::jsonb)
    from (select r.life_stage, count(*) as cnt from public.reproductive_health_profiles r
            join public.profiles p on p.id = r.patient_id and not coalesce(p.is_test, false) group by r.life_stage) s), v_floor)) g;

  select count(distinct c.patient_id), count(*)
    into v_cycle_tracking_patients, v_total_cycles_logged
  from public.menstrual_cycles c
  join public.profiles p on p.id = c.patient_id and not coalesce(p.is_test, false);

  select avg(r.average_cycle_length_days) into v_avg_cycle_length
  from public.reproductive_health_profiles r
  join public.profiles p on p.id = r.patient_id and not coalesce(p.is_test, false)
  where r.average_cycle_length_days is not null;

  select coalesce(jsonb_object_agg(g ->> 'key', (g ->> 'n')::integer) filter (where not (g ->> 'suppressed')::boolean), '{}'::jsonb) into v_symptom_freq
  from jsonb_array_elements(private.suppress_groups((
    select coalesce(jsonb_agg(jsonb_build_object('key', symptom, 'n', cnt)), '[]'::jsonb)
    from (select x.symptom, count(distinct x.patient_id) as cnt
            from (select l.patient_id, unnest(l.symptoms) as symptom from public.menstrual_daily_logs l
                    join public.profiles p on p.id = l.patient_id and not coalesce(p.is_test, false)) x group by x.symptom) s), v_floor)) g;

  select coalesce(jsonb_object_agg(g ->> 'key', (g ->> 'n')::integer) filter (where not (g ->> 'suppressed')::boolean), '{}'::jsonb) into v_mood_freq
  from jsonb_array_elements(private.suppress_groups((
    select coalesce(jsonb_agg(jsonb_build_object('key', mood, 'n', cnt)), '[]'::jsonb)
    from (select x.mood, count(distinct x.patient_id) as cnt
            from (select l.patient_id, unnest(l.moods) as mood from public.menstrual_daily_logs l
                    join public.profiles p on p.id = l.patient_id and not coalesce(p.is_test, false)) x group by x.mood) s), v_floor)) g;

  return jsonb_build_object(
    'generated_at', now(),
    'min_cohort_size', v_floor,
    'reproductive_health_profiles', jsonb_build_object(
      'reportable', private.suppress_cell(v_profile_count, null, v_floor) is null,
      'total', case when private.suppress_cell(v_profile_count, null, v_floor) is null then v_profile_count else null end,
      'by_life_stage', v_life_stage_breakdown
    ),
    'menstrual_cycle_tracking', jsonb_build_object(
      'reportable', private.suppress_cell(v_cycle_tracking_patients, null, v_floor) is null,
      'patients_tracking', case when private.suppress_cell(v_cycle_tracking_patients, null, v_floor) is null then v_cycle_tracking_patients else null end,
      'total_cycles_logged', case when private.suppress_cell(v_cycle_tracking_patients, null, v_floor) is null then v_total_cycles_logged else null end,
      'avg_cycle_length_days', case when private.suppress_cell(v_cycle_tracking_patients, null, v_floor) is null then round(v_avg_cycle_length, 1) else null end
    ),
    'symptom_frequency', v_symptom_freq,
    'mood_frequency', v_mood_freq
  );
end;
$function$;

-- The subsidy summary had a direct EXECUTE grant for anon (it refuses an unauthorised caller inside, but an anonymous role should not reach it at all).
revoke all on function public.institution_subsidy_summary(uuid, date, date) from public, anon;
grant execute on function public.institution_subsidy_summary(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The sponsor report, the held-back month, the fairness report and the triage report onto the same rule.
--    The triage report is renamed: it measures AGREEMENT with the automatic grade, not accuracy (decision S75-3, OQ-316). The new name is
--    public.triage_agreement_report; the old name stays as a thin wrapper only so a web build that has not yet been redeployed keeps working,
--    and is dropped by the next migration after that deploy. No accuracy figure is published anywhere.
-- ---------------------------------------------------------------------------
create or replace function private.sponsor_report_aggregate(p_cohort uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.sponsor_cohorts%rowtype; v_min integer; a record; v_joined integer; v_agreed integer; v_eng integer; v_sponsor text;
  v_cov jsonb; v_eng_json jsonb;
begin
  select * into c from public.sponsor_cohorts where id = p_cohort;
  if not found then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  select name, private.min_cell_floor(min_cohort_size) into v_sponsor, v_min from public.organisations where id = c.sponsor_org_id;
  -- whole calendar months of joining, so two ranges a day apart cannot be subtracted
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;

  drop table if exists pg_temp._s38e_members;
  create temp table _s38e_members on commit drop as
    select pc.patient_id,
           (pc.reporting_consent and exists (select 1 from public.consent_versions v where v.id = pc.consent_version_id and v.is_current)) as agreed
      from public.profile_cohorts pc join public.profiles p on p.id = pc.patient_id
     where pc.cohort_id = p_cohort and pc.left_at is null and not pc.is_test and not coalesce(p.is_test, false) and p.is_active;
  select count(*), count(*) filter (where agreed and private.sponsor_consent_in_force(patient_id)) into v_joined, v_agreed from _s38e_members;

  drop table if exists pg_temp._s38e_cohort;
  create temp table _s38e_cohort on commit drop as
    select k.* from private.v_bp_cohort_90d k
     where k.patient_id in (select patient_id from _s38e_members where agreed and private.sponsor_consent_in_force(patient_id))
       and (p_from is null or k.anchor >= p_from) and (p_to is null or k.anchor <= p_to);
  select count(*) as n, count(*) filter (where s90 = 'controlled') ctrl, count(*) filter (where s90 = 'uncontrolled') unc, count(*) filter (where s90 = 'insufficient_data') ins,
         count(*) filter (where d_sys is not null) n_both, avg(d_sys) filter (where d_sys is not null) mean_d_sys, avg(d_dia) filter (where d_dia is not null) mean_d_dia,
         count(*) filter (where adh is not null) n_adh, avg(adh) filter (where adh is not null) mean_adh
    into a from _s38e_cohort;

  select count(*) into v_eng from _s38e_members m
   where m.agreed and private.sponsor_consent_in_force(m.patient_id)
     and exists (select 1 from public.vitals_readings v where v.patient_id = m.patient_id and v.vital_type = 'blood_pressure' and v.taken_at > now() - interval '30 days');

  -- how many agreed: shown only when both numbers are large enough and the people who did not agree are not a small group either
  v_cov := case when private.suppress_cell(v_joined, null, v_min) is null and private.suppress_cell(v_agreed, null, v_min) is null
                     and not private.suppress_difference(v_joined, v_agreed, v_min)
                then jsonb_build_object('suppressed', false, 'joined', v_joined, 'agreed_to_share', v_agreed, 'agreed_pct', round(100.0 * v_agreed / v_joined, 1))
                else jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'minimum', v_min) end;
  v_eng_json := case when private.suppress_cell(v_agreed, null, v_min) is null then jsonb_build_object('suppressed', false, 'n', v_agreed, 'logged_a_reading_in_30_days_pct', round(100.0 * v_eng / v_agreed, 1))
                     else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end;

  return jsonb_build_object(
    'cohort', jsonb_build_object('name', c.name, 'sponsor', v_sponsor, 'valid_from', c.valid_from, 'valid_to', c.valid_to),
    'minimum_cell', v_min,
    'members', v_cov,
    'bp_control_90d', private.outcome_cohort_json(case when private.suppress_cell(v_agreed, null, v_min) is null then a.n::integer else 0 end, a.ctrl::integer, a.unc::integer, a.ins::integer, v_min),
    'change_among_measured', case when private.suppress_cell(v_agreed, null, v_min) is null and private.suppress_cell(a.n_both, null, v_min) is null then jsonb_build_object('suppressed', false, 'n', a.n_both, 'mean_systolic_change', round(a.mean_d_sys, 1), 'mean_diastolic_change', round(a.mean_d_dia, 1))
                                  else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'adherence_separate', case when private.suppress_cell(v_agreed, null, v_min) is null and private.suppress_cell(a.n_adh, null, v_min) is null then jsonb_build_object('suppressed', false, 'n', a.n_adh, 'mean_pct', round(a.mean_adh, 1))
                               else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'engagement_separate', v_eng_json,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'definition', (select numerator_definition || ' Denominator: ' || denominator_definition from public.outcome_measure_specs where code = 'bp_control_90d' and spec_version = (select max(spec_version) from public.outcome_measure_specs where code = 'bp_control_90d')),
    'limitations', 'Only members who joined with this programme code and agreed to share group figures are counted; members who did not agree are in no figure. A figure for a small group is never shown, and if a group is too small to show, the figures that could reveal it are withheld too. Blood pressure control, medicine adherence and engagement are separate measures and are never combined. This describes the members who agreed, not everyone the programme covers, and it does not show that the programme caused any change. Comparing two reports run on different days can show the effect of one member joining or leaving, so share a figure once for a period rather than re-running it.',
    'not_a_causal_claim', true,
    'generated_at', now());
end $function$;

create or replace function private.generate_sponsor_snapshots(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_grace integer := (private.report_rule('grace_days') #>> '{}')::integer;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_end date := (date_trunc('month', v_today) - interval '1 day')::date;
  c record; n integer := 0; v_failed integer := 0; v_last text; v_set uuid[]; v_prev uuid[]; v_diff integer; v_min integer; v_held boolean; v_payload jsonb;
  v_sid uuid; v_notice_failed integer := 0; v_notice_last text;
begin
  -- Only inside a short catch-up window after the grace days. Later than that the live data no longer describes the month that closed, so a
  -- gap is left rather than a figure that is mislabelled; a failing run opens an incident every day it fails.
  if v_today < (v_end + 1 + v_grace) or v_today > (v_end + 1 + v_grace + 7) then return 0; end if;
  for c in
    select sc.id, sc.organisation_id, sc.sponsor_org_id from public.sponsor_cohorts sc
     where not sc.is_test and sc.valid_from <= v_end and sc.valid_to >= v_month
       and sc.created_at < (v_end + 1)::timestamp at time zone 'Africa/Lagos'   -- the programme existed when the month closed
       and not exists (select 1 from public.sponsor_report_snapshots s where s.cohort_id = sc.id and s.period = v_month)
  loop
    begin
      -- Two published months can be subtracted to expose the few people who changed between them. So when the people behind this month's
      -- figure differ from those behind the last published figure by a small number (not none, not enough to hide among), this month is held
      -- back whole; the comparison stays with the last published figure, so the difference builds up until it is large enough to publish.
      v_set := private.sponsor_agreed_members(c.id);
      select member_set into v_prev from public.sponsor_report_snapshots where cohort_id = c.id and not held_back order by period desc limit 1;
      select private.min_cell_floor(o.min_cohort_size) into v_min from public.organisations o where o.id = c.sponsor_org_id;
      v_diff := case when v_prev is null then 0 else
        (select count(*) from (select unnest(v_set) except select unnest(v_prev)) a)::integer + (select count(*) from (select unnest(v_prev) except select unnest(v_set)) b)::integer end;
      v_held := private.suppress_difference(v_diff, 0, v_min);
      v_payload := case when v_held
        then jsonb_build_object('held_back', true, 'reason', 'small_change', 'minimum', v_min,
               'limitations', 'This month''s figure is held back because it would differ from the last published one by only a few people, which could reveal them. It will appear once enough has changed.')
        else private.sponsor_report_aggregate(c.id, null, v_end) end;
      v_sid := null;
      insert into public.sponsor_report_snapshots (organisation_id, cohort_id, sponsor_org_id, period, payload, member_set, held_back)
      values (c.organisation_id, c.id, c.sponsor_org_id, v_month, v_payload, v_set, v_held)
      on conflict (cohort_id, period) do nothing
      returning id into v_sid;
      n := n + 1;
      -- The notice is best effort and must never lose the figure just written: its own block, its own incident.
      if v_sid is not null and not v_held then
        begin
          perform private.notify_sponsor_staff_figures(c.sponsor_org_id, v_sid, v_month);
        exception when others then
          v_notice_failed := v_notice_failed + 1; v_notice_last := sqlerrm;
        end;
      end if;
    exception when others then
      v_failed := v_failed + 1; v_last := sqlerrm;
    end;
  end loop;
  if v_failed > 0 then
    perform private.open_job_incident('sponsor-snapshots-failing', 'Sponsor monthly figures are failing',
      v_failed || ' sponsor figures could not be written on the last run (' || left(v_last, 200) || '). They are retried every day.');
  end if;
  if v_notice_failed > 0 then
    perform private.open_job_incident('sponsor-notices-failing', 'Sponsor figure notices are failing',
      v_notice_failed || ' notices that sponsor figures are ready could not be queued (' || left(v_notice_last, 200) || '). The figures themselves are on the page and in the app.');
  end if;
  return n;
end $function$;

create or replace function public.risk_distribution_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid()); v_min integer := private.min_cell_floor();
  v_out jsonb := '{}'::jsonb; d text; v_cells jsonb; v_total integer;
begin
  if v_uid is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'risk_not_authorised' using errcode = '42501';
  end if;
  drop table if exists pg_temp._s38c_latest;
  create temp table _s38c_latest on commit drop as
    select distinct on (s.patient_id) s.patient_id, s.level,
           coalesce(p.sex::text, 'unknown') as sex, coalesce(p.state, 'unknown') as state,
           case when p.date_of_birth is null then 'unknown'
                when extract(year from age(s.computed_on, p.date_of_birth)) < 18 then 'under_18'
                else (floor(extract(year from age(s.computed_on, p.date_of_birth)) / 10) * 10)::integer::text || 's' end as age_band
      from public.risk_scores s join public.profiles p on p.id = s.patient_id
     where not s.is_test and not coalesce(p.is_test, false)
     order by s.patient_id, s.computed_on desc;
  select count(*) into v_total from _s38c_latest;
  foreach d in array array['sex', 'age_band', 'state'] loop
    execute format($q$
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n, 'cats', jsonb_build_array(hi, me, lo), 'hi', hi, 'me', me, 'lo', lo)), '[]'::jsonb)
        from (select %1$I as k, count(*) n, count(*) filter (where level = 'high') hi, count(*) filter (where level = 'medium') me, count(*) filter (where level = 'low') lo
                from _s38c_latest group by 1) cells$q$, d) into v_cells;
    select coalesce(jsonb_agg(case when (g ->> 'suppressed')::boolean then jsonb_build_object('key', g ->> 'key', 'suppressed', true)
                                   else jsonb_build_object('key', g ->> 'key', 'n', (g ->> 'n')::integer, 'high', (g ->> 'hi')::integer, 'medium', (g ->> 'me')::integer,
                                                           'low', (g ->> 'lo')::integer, 'high_pct', round(100.0 * (g ->> 'hi')::numeric / (g ->> 'n')::numeric, 1)) end
                             order by g ->> 'key'), '[]'::jsonb)
      into v_cells from jsonb_array_elements(private.suppress_groups(v_cells, v_min)) g;
    v_out := v_out || jsonb_build_object(d, v_cells);
  end loop;
  perform private.log_audit('risk.distribution_report', 'risk_scores', null, '{}'::jsonb);
  return jsonb_build_object('total_scored', case when private.suppress_cell(v_total, null, v_min) is null then v_total else null end, 'minimum_cell', v_min, 'by', v_out,
    'purpose', 'Checks that the ordering does not fall unevenly on one group. A group with few people is withheld, and so is the next smallest so it cannot be recovered by subtraction.',
    'not_a_causal_claim', true);
end $function$;

create or replace function public.triage_agreement_report(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_min integer := private.min_cell_floor();
  v_from date := coalesce(p_from, (now() at time zone 'Africa/Lagos')::date - 90); v_to date := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_total integer; v_reviewed integer; v_right integer; v_higher integer; v_lower integer; v_shadow integer; v_eligible integer;
  v_grades jsonb := '[]'::jsonb; v_out jsonb := '{}'::jsonb; d text; v_cells jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'triage_report_not_authorised' using errcode = '42501'; end if;
  drop table if exists pg_temp._s38e_tr;
  create temp table _s38e_tr on commit drop as
    select r.graded_as, r.agreement, r.shadow, coalesce(p.sex::text, 'unknown') as sex, coalesce(p.state, 'unknown') as state,
           case when p.date_of_birth is null then 'unknown'
                when extract(year from age(tk.completed_at::date, p.date_of_birth)) < 18 then 'under_18'
                else (floor(extract(year from age(tk.completed_at::date, p.date_of_birth)) / 10) * 10)::integer::text || 's' end as age_band
      from public.triage_reviews r join public.profiles p on p.id = r.patient_id join public.clinical_tasks tk on tk.id = r.task_id
     where not r.is_test and not coalesce(p.is_test, false) and (tk.completed_at at time zone 'Africa/Lagos')::date between v_from and v_to;
  select count(*) filter (where not shadow), count(*) filter (where not shadow and agreement = 'right'), count(*) filter (where not shadow and agreement = 'should_have_been_higher'),
         count(*) filter (where not shadow and agreement = 'should_have_been_lower'), count(*) filter (where shadow)
    into v_reviewed, v_right, v_higher, v_lower, v_shadow from _s38e_tr;
  -- how many tasks could have been reviewed: completed in the range, from an approved (not shadow) grade, not a test
  select count(*) into v_eligible from public.clinical_tasks t join public.triage_events e on e.id = t.triage_event_id
    join public.profiles p on p.id = t.patient_id
   where t.state = 'completed' and not e.shadow and not coalesce(t.is_test, false) and not coalesce(p.is_test, false)
     and (t.completed_at at time zone 'Africa/Lagos')::date between v_from and v_to;

  -- the three grades are groups of one whole: a withheld grade is not recoverable from the overall figure or from the others
  select jsonb_agg(jsonb_build_object('key', gr, 'n', n, 'cats', jsonb_build_array(ok, hi, lo), 'ok', ok, 'hi', hi, 'lo', lo)) into v_cells
    from (select gr, count(t.graded_as) filter (where not t.shadow) as n,
                 count(t.graded_as) filter (where not t.shadow and t.agreement = 'right') as ok,
                 count(t.graded_as) filter (where not t.shadow and t.agreement = 'should_have_been_higher') as hi,
                 count(t.graded_as) filter (where not t.shadow and t.agreement = 'should_have_been_lower') as lo
            from unnest(array['green', 'amber', 'red']) gr left join _s38e_tr t on t.graded_as = gr group by gr) gx;
  select coalesce(jsonb_agg(jsonb_build_object('graded_as', g ->> 'key') ||
           case when (g ->> 'suppressed')::boolean then jsonb_build_object('suppressed', true, 'minimum', v_min)
                else jsonb_build_object('suppressed', false, 'reviewed', (g ->> 'n')::integer, 'right', (g ->> 'ok')::integer,
                                        'should_have_been_higher', (g ->> 'hi')::integer, 'should_have_been_lower', (g ->> 'lo')::integer,
                                        'agree_pct', round(100.0 * (g ->> 'ok')::numeric / (g ->> 'n')::numeric, 1)) end
           order by case g ->> 'key' when 'green' then 1 when 'amber' then 2 else 3 end), '[]'::jsonb)
    into v_grades from jsonb_array_elements(private.suppress_groups(v_cells, v_min)) g;
  select count(*) filter (where not shadow and agreement = 'right'), count(*) filter (where not shadow and agreement = 'should_have_been_higher'), count(*) filter (where not shadow and agreement = 'should_have_been_lower')
    into v_right, v_higher, v_lower from _s38e_tr;

  foreach d in array array['sex', 'age_band', 'state'] loop
    execute format($q$
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n, 'cats', jsonb_build_array(ok, hi, lo), 'ok', ok, 'hi', hi, 'lo', lo)), '[]'::jsonb)
        from (select %1$I as k, count(*) n, count(*) filter (where agreement = 'right') ok, count(*) filter (where agreement = 'should_have_been_higher') hi,
                     count(*) filter (where agreement = 'should_have_been_lower') lo from _s38e_tr where not shadow group by 1) cells$q$, d) into v_cells;
    select coalesce(jsonb_agg(case when (g ->> 'suppressed')::boolean then jsonb_build_object('key', g ->> 'key', 'suppressed', true)
                                   else jsonb_build_object('key', g ->> 'key', 'reviewed', (g ->> 'n')::integer, 'agree_pct', round(100.0 * (g ->> 'ok')::numeric / (g ->> 'n')::numeric, 1),
                                                           'should_have_been_higher_pct', round(100.0 * (g ->> 'hi')::numeric / (g ->> 'n')::numeric, 1)) end
                             order by g ->> 'key'), '[]'::jsonb)
      into v_cells from jsonb_array_elements(private.suppress_groups(v_cells, v_min)) g;
    v_out := v_out || jsonb_build_object(d, v_cells);
  end loop;
  perform private.log_audit('triage.agreement_report', 'triage_reviews', null, jsonb_build_object('from', v_from, 'to', v_to));
  v_total := v_right + v_higher + v_lower;
  return jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to), 'minimum_cell', v_min,
    'capture_switched_on', public.platform_switch_is_on('triage_agreement_capture'),
    'coverage', case when private.suppress_cell(v_eligible, null, v_min) is null and private.suppress_cell(v_total, null, v_min) is null then jsonb_build_object('suppressed', false, 'completed_tasks_from_a_grade', v_eligible, 'reviewed', v_total,
                       'reviewed_pct', round(100.0 * v_total / v_eligible, 1), 'low_coverage', (100.0 * v_total / v_eligible) < 50)
                else jsonb_build_object('suppressed', true, 'minimum', v_min) end,
    'overall', case when private.suppress_cell(v_total, array[v_right, v_higher, v_lower]::bigint[], v_min) is null
                    then jsonb_build_object('suppressed', false, 'reviewed', v_total, 'agree_pct', round(100.0 * v_right / v_total, 1),
                                            'should_have_been_higher_pct', round(100.0 * v_higher / v_total, 1), 'should_have_been_lower_pct', round(100.0 * v_lower / v_total, 1))
                    else jsonb_build_object('suppressed', true, 'minimum', v_min) end,
    'by_grade', v_grades, 'by', v_out,
    'draft_rule_set_reviews', case when private.suppress_cell(v_shadow, null, v_min) is null then v_shadow else null end,
    'what_this_is', 'AGREEMENT, not accuracy: how often the clinician who handled the case agreed with the grade the automatic check gave. It is not diagnostic accuracy: nothing here records the final diagnosis. Reviews of grades from a draft (unapproved) rule set are kept out of every figure above.',
    'limitations', 'Only cases a clinician chose to review are counted, so look at coverage first. A group with few reviews is withheld, and so is the next smallest, so it cannot be worked out by subtraction. This is not a measure of any clinician.',
    'not_a_causal_claim', true, 'generated_at', now());
end $function$;

create or replace function public.triage_accuracy_report(p_from date default null, p_to date default null) returns jsonb
language sql security definer set search_path = ''
as $$ select public.triage_agreement_report(p_from, p_to) $$;
revoke all on function public.triage_agreement_report(date, date) from public, anon;
grant execute on function public.triage_agreement_report(date, date) to authenticated, service_role;
comment on function public.triage_accuracy_report(date, date) is 'DEPRECATED name for triage_agreement_report (S75, decision S75-3). Remove after the web deploy that uses the new name.';

-- ---------------------------------------------------------------------------
-- 8. Reconciliation notes (comments only) and self-check
-- ---------------------------------------------------------------------------
comment on column public.organisations.min_cohort_size is
  'An organisation''s own smallest-group number. Since S75a the number actually used is private.min_cell_floor(this): the GREATER of this and the platform minimum (outcome_config min_cell, 20; min_cell_cross, 30, for a cut by two attributes). It can raise an organisation''s floor, never lower it below the platform minimum.';
comment on column public.insurers.min_cohort_size is 'Same rule as organisations.min_cohort_size: used through private.min_cell_floor, never on its own (S75a).';

do $$
begin
  if private.min_cell_floor() <> 20 then raise exception 'S75a: platform floor is not 20 (%)', private.min_cell_floor(); end if;
  if private.min_cell_floor(null, 2) <> 30 then raise exception 'S75a: cross floor is not 30'; end if;
  if private.min_cell_floor(25) <> 25 or private.min_cell_floor(5) <> 20 then raise exception 'S75a: an organisation can raise its floor but not lower it'; end if;
  if private.suppress_cell(19, null, 20) is null or private.suppress_cell(20, null, 20) is not null then raise exception 'S75a: suppress_cell boundary'; end if;
  if private.suppress_cell(50, array[0, 5]::bigint[], 20) <> 'small_cell' or private.suppress_cell(50, array[0, 25]::bigint[], 20) is not null then raise exception 'S75a: category rule'; end if;
  if not private.suppress_difference(25, 20, 20) or private.suppress_difference(40, 20, 20) or private.suppress_difference(20, 20, 20) then raise exception 'S75a: difference rule'; end if;
  if has_function_privilege('anon', 'private.suppress_cell(bigint,bigint[],integer)', 'EXECUTE') then raise exception 'S75a: anon can run suppress_cell'; end if;
  if has_function_privilege('authenticated', 'private.suppress_groups(jsonb,integer)', 'EXECUTE') then raise exception 'S75a: a user can run suppress_groups'; end if;
  if has_function_privilege('anon', 'public.bp_control_report_180d(date,date)', 'EXECUTE') or has_function_privilege('anon', 'public.triage_agreement_report(date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.institution_subsidy_summary(uuid,date,date)', 'EXECUTE') then raise exception 'S75a: anon can run a report'; end if;
end $$;
