-- S75 (exclusions and severity bands): who is NOT counted in the outcome measures, and the PHQ-9 / GAD-7 baseline severity breakdown.
--
-- Two builds of the S75 outcome measures existed. S75 track D (#1094) is the one that ships (founder decision 2026-10-13); this adds the two things the other
-- build (#1087) had that #1094 did not, in #1094's own style (no row written for a person who is out of scope; no single answer ever read):
--   1. outcome_config v4 = v3 plus `exclusions` and `bands` on each measure. PROPOSED, UNSIGNED, INACTIVE. v3 is not touched (a sign-off binds to a version),
--      so a snapshot computed with v3 behaves exactly as before; the CMO activates v4 instead of v3 to get the exclusions.
--      Excluded: under 18 or no date of birth (all measures); pregnant (HbA1c, weight); a PHQ-9 total of 20 or more (PHQ-9, GAD-7).
--      Only the TOTAL score is read, to REMOVE a person. Item 9 and the crisis flag are still never read (the S75 proof scans for it), so a person who answered
--      item 9 above zero but scored under 20 is NOT excluded by this rule: an open question for the CMO (see OQ in docs/design/S75.md).
--   2. private.s75_in_scope() applies them. The two aggregates (HbA1c / weight and mental health) also apply them at report time, so a person who BECOMES excluded
--      after a snapshot was written drops out of the figures.
--   3. mental_health_outcome_report gains `baseline_severity`: how many started in each severity band, withheld as a whole unless every band clears the minimum.
--   4. private.outcome_measure_cohort (the sponsor pack's per-cohort figure): HbA1c and weight, and PHQ-9 and GAD-7 as SUPPRESSED GROUP figures (CMO decision 2026-10-14).
--   5. private.outcome_measures_signed() = "the CMO has activated a config that lists the measures".
--   6. Every function that still read the platform minimum directly now reads it through private.min_cell_floor() (the s75a rule, proof check 3d):
--      the two reports above, bp_control_aggregate_180, clinical_response_report, and main-dev's suppress_small and employer_visit_summary. Same value; an unconfigured
--      minimum now fails closed instead of defaulting to 20.
-- Changes no live behaviour until the CMO activates v4. Nothing is signed here.

-- outcome-rules-v4-begin
insert into public.outcome_config (version, is_active, config, note)
select 4, false, $json$
{
  "days": [
    0,
    30,
    90,
    180
  ],
  "window_days": 7,
  "grace_days": 3,
  "min_readings": 3,
  "default_target": {
    "systolic": 140,
    "diastolic": 90
  },
  "min_cell": 20,
  "min_cell_cross": 30,
  "report_spec": "bp_control_90d",
  "bp_report_days": [
    90,
    180
  ],
  "measures": {
    "hba1c": {
      "days": [
        0,
        90,
        180
      ],
      "goal_below_percent": 7.0,
      "use_care_plan_target": true,
      "valid_min": 3.0,
      "valid_max": 20.0,
      "baseline_before_days": 90,
      "baseline_after_days": 14,
      "followup_tolerance_days": 30,
      "definition": "HbA1c, as a percentage. Change is the value near the day minus the baseline value near joining. A person reached the goal when the value near the day is under 7.0 percent or at their own care-plan HbA1c target. The result nearest the day inside the window is used.",
      "limitations": "Only people with an HbA1c result are counted in the measure; a person with no result near a day is shown as no result, never as not improved. Results come from the lab results recorded on the platform, not from every lab a person may have used. A before and after view without a comparison group says nothing about cause. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
      "exclusions": {
        "min_age_years": 18,
        "age_required": true,
        "pregnancy": true
      }
    },
    "weight": {
      "days": [
        0,
        30,
        90,
        180
      ],
      "goal_loss_percent": 5.0,
      "valid_min": 20,
      "valid_max": 400,
      "min_age_years": 18,
      "baseline_before_days": 14,
      "baseline_after_days": 7,
      "followup_tolerance_days": 14,
      "definition": "Weight in kilograms. Change is the percent difference between the weight near the day and the baseline weight near joining. A person reached the goal when weight fell by 5 percent or more. The weight nearest the day inside the window is used. Adults only.",
      "limitations": "Only people who logged a weight are counted; a person with no weight near a day is shown as no result, never as not improved. Weight changes for many reasons, including pregnancy, illness and fluid; the measure is not a judgement of any person. A before and after view without a comparison group says nothing about cause. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
      "exclusions": {
        "min_age_years": 18,
        "age_required": true,
        "pregnancy": true
      }
    },
    "phq9": {
      "days": [
        0,
        30,
        90,
        180
      ],
      "max_score": 27,
      "response_fall_percent": 50,
      "remission_below": 5,
      "min_baseline_for_outcome": 5,
      "baseline_before_days": 14,
      "baseline_after_days": 14,
      "followup_tolerance_days": 21,
      "definition": "PHQ-9 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
      "limitations": "Only total scores are used; no answer to any single question is read. A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
      "exclusions": {
        "min_age_years": 18,
        "age_required": true,
        "safeguarding": {
          "score_from": 20
        }
      },
      "bands": [
        [
          "minimal",
          0,
          4
        ],
        [
          "mild",
          5,
          9
        ],
        [
          "moderate",
          10,
          14
        ],
        [
          "moderately_severe",
          15,
          19
        ],
        [
          "severe",
          20,
          27
        ]
      ]
    },
    "gad7": {
      "days": [
        0,
        30,
        90,
        180
      ],
      "max_score": 21,
      "response_fall_percent": 50,
      "remission_below": 5,
      "min_baseline_for_outcome": 5,
      "baseline_before_days": 14,
      "baseline_after_days": 14,
      "followup_tolerance_days": 21,
      "definition": "GAD-7 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
      "limitations": "A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
      "exclusions": {
        "min_age_years": 18,
        "age_required": true,
        "safeguarding": {
          "score_from": 20
        }
      },
      "bands": [
        [
          "minimal",
          0,
          4
        ],
        [
          "mild",
          5,
          9
        ],
        [
          "moderate",
          10,
          14
        ],
        [
          "severe",
          15,
          21
        ]
      ]
    }
  }
}
$json$::jsonb, 'PROPOSED, v4, UNSIGNED, INACTIVE (S75 exclusions and severity bands). Owner: CMO. v3 plus: who is not counted (under 18 or age unknown; pregnant for HbA1c and weight; a PHQ-9 total of 20 or more for PHQ-9 and GAD-7) and the PHQ-9 / GAD-7 severity bands. Activating it, not v3, is what brings the exclusions in.'
 where exists (select 1 from public.outcome_config where version = 3)
on conflict (version) do nothing;
-- outcome-rules-v4-end

create or replace function private.s75_in_scope(p_patient uuid, p_measure text, p_rule jsonb, p_anchor date) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_dob date; v_ex jsonb := p_rule -> 'exclusions';
begin
  -- Exclusions (config v4 and later; v3 has none, so a snapshot computed with v3 behaves exactly as before). A person excluded is not measured at all:
  -- no row, no value stored. Nothing here reads an answer to a single question or the crisis flag (the S75 proof forbids it): only the TOTAL score, to REMOVE a person.
  if v_ex is not null then
    select date_of_birth into v_dob from public.profiles where id = p_patient;
    if v_dob is null and coalesce((v_ex ->> 'age_required')::boolean, false) then return false; end if;                                   -- age unknown
    if v_dob is not null and v_ex ? 'min_age_years'
       and v_dob > (p_anchor - make_interval(years => (v_ex ->> 'min_age_years')::integer))::date then return false; end if;               -- under 18
    if coalesce((v_ex ->> 'pregnancy')::boolean, false)
       and exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p_patient and pp.is_pregnant) then return false; end if; -- pregnant
    if v_ex ? 'safeguarding'
       and exists (select 1 from public.mental_health_screens s
                    where s.patient_id = p_patient and s.instrument = 'phq9'
                      and s.total_score >= (v_ex #>> '{safeguarding,score_from}')::integer) then return false; end if;                              -- safeguarding
  end if;
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

create or replace function private.outcome_measure_aggregate(p_measure text, p_day integer, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver integer := private.s75_measures_version();
  v_rule jsonb;
  v_min integer := private.min_cell_floor();
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
     and (not (v_rule ? 'exclusions') or private.s75_in_scope(s.patient_id, s.measure_code, v_rule, s.anchor_date))
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
    'data_quality', case when a.n >= v_min then jsonb_build_object('baseline_missing_pct', round(100.0 * a.base_missing / nullif(a.n, 0), 1),
                         'care_plan_target_used_pct', case when p_measure = 'hba1c' then round(100.0 * a.n_target / nullif(a.n, 0), 1) end)
                    else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'definition', v_rule ->> 'definition',
    'limitations', v_rule ->> 'limitations',
    'comparison_group', 'none',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.outcome_measure_aggregate(text, integer, date, date) from public, anon, authenticated;

create or replace function public.mental_health_outcome_report(p_instrument text, p_day integer, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ver integer := private.s75_measures_version();
  v_rule jsonb;
  v_min integer := private.min_cell_floor();
  a record; v_r jsonb; v_bands jsonb := null; v_band_n bigint[]; v_total bigint; v_reason text;
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
     and (not (v_rule ? 'exclusions') or private.s75_in_scope(s.patient_id, s.instrument, v_rule, s.anchor_date))
     and (p_from is null or s.anchor_date >= p_from) and (p_to is null or s.anchor_date <= p_to);
  -- Severity bands of the BASELINE score (config v4 and later): who started where. Withheld as a whole unless every band clears the minimum, so a
  -- small band cannot be worked out by subtracting from the total.
  if v_rule ? 'bands' then
    select array_agg(x.n order by x.ord), sum(x.n)::bigint into v_band_n, v_total
      from (select b.ord, count(s.id) as n
              from jsonb_array_elements(v_rule -> 'bands') with ordinality as b(band, ord)
              left join public.outcome_mh_snapshots s
                on s.instrument = p_instrument and s.day = p_day and s.response_status <> 'not_applicable' and not s.is_test
               and s.baseline_score between (b.band ->> 1)::integer and (b.band ->> 2)::integer
               and (p_from is null or s.anchor_date >= p_from) and (p_to is null or s.anchor_date <= p_to)
               and exists (select 1 from public.profiles pr where pr.id = s.patient_id and not coalesce(pr.is_test, false))
               and private.s75_in_scope(s.patient_id, s.instrument, v_rule, s.anchor_date)
             group by b.ord) x;
    v_reason := private.suppress_cell(v_total, v_band_n, v_min);
    if v_reason is not null then
      v_bands := jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', v_min);
    else
      select jsonb_build_object('suppressed', false, 'by_baseline_band', jsonb_agg(jsonb_build_object('band', b.band ->> 0, 'from', (b.band ->> 1)::integer, 'to', (b.band ->> 2)::integer, 'n', c.n) order by b.ord))
        into v_bands
        from jsonb_array_elements(v_rule -> 'bands') with ordinality as b(band, ord)
        join unnest(v_band_n) with ordinality as c(n, ord) on c.ord = b.ord;
    end if;
  end if;
  v_r := jsonb_build_object(
    'measure', p_instrument, 'day', p_day, 'config_version', v_ver, 'minimum_cell', v_min,
    'response', private.s75_cohort_json(a.n::integer, a.r_yes::integer, a.r_no::integer, a.ins::integer, v_min),
    'remission', private.s75_cohort_json(a.n::integer, a.m_yes::integer, a.m_no::integer, a.ins::integer, v_min),
    'baseline_severity', v_bands,
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'definition', v_rule ->> 'definition', 'limitations', v_rule ->> 'limitations',
    'comparison_group', 'none', 'not_a_causal_claim', true, 'generated_at', now());
  perform private.log_audit('outcomes.mental_health_report', 'outcome_report', null, jsonb_build_object('measure', p_instrument, 'day', p_day, 'from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.mental_health_outcome_report(text, integer, date, date) from public, anon;
grant execute on function public.mental_health_outcome_report(text, integer, date, date) to authenticated;

-- The per-cohort figure the sponsor pack carries (S75c): HbA1c and weight from outcome_measure_snapshots, PHQ-9 and GAD-7 from outcome_mh_snapshots. The CMO decided on 2026-10-14
-- that the pack carries PHQ-9 and GAD-7 as SUPPRESSED GROUP figures (response and remission rates, never a person, never below the minimum cohort size, withheld as a whole when any
-- cell is small). This is the only sponsor-side path to the mental-health table, and it is a private function nobody but the system can run. A person who is excluded (config v4)
-- is not counted.
create or replace function private.outcome_measure_cohort(p_measure text, p_day integer, p_from date, p_to date, p_patients uuid[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver integer := private.s75_measures_version();
  v_rule jsonb;
  v_min integer := private.min_cell_floor();
  a record;
begin
  if v_ver is null then return jsonb_build_object('withheld', true, 'reason', 'measures_not_active'); end if;
  v_rule := private.s75_measure_rule(v_ver, p_measure);
  if p_measure not in ('hba1c', 'weight', 'phq9', 'gad7') or v_rule is null or not (v_rule -> 'days') @> to_jsonb(p_day) or (p_measure in ('phq9', 'gad7') and p_day = 0) then
    return jsonb_build_object('withheld', true, 'reason', 'measure_not_enabled');
  end if;
  if p_measure in ('phq9', 'gad7') then
    select count(*) as n,
           count(*) filter (where s.response_status = 'response') as r_yes,
           count(*) filter (where s.response_status = 'no_response') as r_no,
           count(*) filter (where s.response_status = 'insufficient_data') as ins,
           count(*) filter (where s.remission_status = 'remitted') as m_yes,
           count(*) filter (where s.remission_status = 'not_remitted') as m_no
      into a
      from public.outcome_mh_snapshots s join public.profiles pr on pr.id = s.patient_id
     where s.patient_id = any (p_patients) and s.instrument = p_measure and s.day = p_day and s.response_status <> 'not_applicable'
       and not s.is_test and not coalesce(pr.is_test, false)
       and (p_from is null or s.anchor_date >= p_from) and (p_to is null or s.anchor_date <= p_to)
       and (not (v_rule ? 'exclusions') or private.s75_in_scope(s.patient_id, s.instrument, v_rule, s.anchor_date));
    return jsonb_build_object('response', private.s75_cohort_json(a.n::integer, a.r_yes::integer, a.r_no::integer, a.ins::integer, v_min),
                              'remission', private.s75_cohort_json(a.n::integer, a.m_yes::integer, a.m_no::integer, a.ins::integer, v_min));
  end if;
  select count(*) as n,
         count(*) filter (where s.goal_status = 'reached') as yes_n,
         count(*) filter (where s.goal_status = 'not_reached') as no_n,
         count(*) filter (where s.goal_status = 'insufficient_data') as ins
    into a
    from public.outcome_measure_snapshots s join public.profiles pr on pr.id = s.patient_id
   where s.patient_id = any (p_patients) and s.measure_code = p_measure and s.day = p_day and not s.is_test and not coalesce(pr.is_test, false)
     and (p_from is null or s.anchor_date >= p_from) and (p_to is null or s.anchor_date <= p_to)
     and (not (v_rule ? 'exclusions') or private.s75_in_scope(s.patient_id, s.measure_code, v_rule, s.anchor_date));
  return private.s75_cohort_json(a.n::integer, a.yes_n::integer, a.no_n::integer, a.ins::integer, v_min);
end $$;
revoke all on function private.outcome_measure_cohort(text, integer, date, date, uuid[]) from public, anon, authenticated;

-- True once the CMO has activated an outcome_config version that lists the measures (activation IS the sign-off, see S75): the pack shows measure figures only then.
create or replace function private.outcome_measures_signed() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.s75_measures_version() is not null $$;
revoke all on function private.outcome_measures_signed() from public, anon, authenticated;

-- private.bp_control_aggregate_180: read the platform minimum through the shared floor (s75a rule: only min_cell_floor reads it from configuration)
create or replace function private.bp_control_aggregate_180(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := private.min_cell_floor();
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
        'baseline_missing_pct', round(100.0 * a.base_missing / nullif(a.n, 0), 1), 'day_no_reading_pct', round(100.0 * a.i / nullif(a.n, 0), 1),
        'default_target_used_pct', round(100.0 * a.n_def / nullif(a.n, 0), 1))
      else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min, 'enrolled_total', v_enrolled, 'not_yet_due', v_notdue) end,
    'definition', 'People whose 7-day average home blood pressure in the window ending on day 180 is under their own target (or under 140/90 when none is set), from at least the minimum number of valid readings. Denominator: every person who joined and whose day-180 window has closed, including people with too few or no readings.',
    'limitations', 'Home readings on shared or unvalidated devices; readings that sync after the grace period are not added to a past snapshot; a before and after view without a comparison group says nothing about cause; small numbers are withheld; not a ranking of clinicians and never a reason to deny care.',
    'comparison_group', 'none',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;

-- public.clinical_response_report: read the platform minimum through the shared floor (s75a rule: only min_cell_floor reads it from configuration)
create or replace function public.clinical_response_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_min integer := private.min_cell_floor();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date := coalesce(p_from, v_today - 90);
  v_to date := coalesce(p_to, v_today);
  v_t_from timestamptz; v_t_to timestamptz;
  v_tasks jsonb; v_pages jsonb; v_withheld_t integer; v_withheld_p integer;
  v_members integer; v_members_bp integer; v_snap integer; v_snap_insuff integer; v_dq jsonb;
begin
  if v_uid is null or not (private.is_admin() or private.is_analyst()) then
    raise exception 'outcomes_not_authorised' using errcode = '42501';
  end if;
  if v_min is null then raise exception 'outcome_config_missing'; end if;
  if v_to < v_from then raise exception 'range_invalid' using errcode = '22023'; end if;
  v_t_from := v_from::timestamp at time zone 'Africa/Lagos';
  v_t_to := (v_to + 1)::timestamp at time zone 'Africa/Lagos';

  -- ---- tasks
  with t as (
    select ct.id, ct.type, ct.priority_class, ct.state, ct.due_at, ct.created_at, ct.completed_at,
           (select min(c.claimed_at) from public.task_claims c where c.task_id = ct.id and not c.is_test) as first_claim
      from public.clinical_tasks ct
      join public.profiles p on p.id = ct.patient_id
     where not ct.is_test and not coalesce(p.is_test, false)
       and ct.created_at >= v_t_from and ct.created_at < v_t_to
  ), g as (
    select type, priority_class, count(*) n,
           count(*) filter (where first_claim is not null) n_claim,
           percentile_cont(0.5) within group (order by extract(epoch from first_claim - created_at) / 60.0) filter (where first_claim is not null) claim_p50,
           percentile_cont(0.9) within group (order by extract(epoch from first_claim - created_at) / 60.0) filter (where first_claim is not null) claim_p90,
           count(*) filter (where state = 'completed' and completed_at is not null) n_done,
           percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at) / 60.0) filter (where state = 'completed' and completed_at is not null) done_p50,
           percentile_cont(0.9) within group (order by extract(epoch from completed_at - created_at) / 60.0) filter (where state = 'completed' and completed_at is not null) done_p90,
           count(*) filter (where state not in ('completed', 'cancelled') and due_at < now()) overdue_open,
           count(*) filter (where state = 'completed' and completed_at > due_at) completed_late
      from t group by type, priority_class
  )
  select coalesce(jsonb_agg(case when n < v_min
            then jsonb_build_object('task_type', type, 'priority_class', priority_class, 'suppressed', true, 'reason', 'under_minimum')
            else jsonb_build_object('task_type', type, 'priority_class', priority_class, 'suppressed', false,
              'time_to_claim_minutes', case when n_claim >= v_min then jsonb_build_object('median', round(claim_p50::numeric, 1), 'p90', round(claim_p90::numeric, 1))
                                            else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'time_to_complete_minutes', case when n_done >= v_min then jsonb_build_object('median', round(done_p50::numeric, 1), 'p90', round(done_p90::numeric, 1))
                                               else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'overdue_open_now', overdue_open, 'completed_after_due', completed_late) end
            order by type, priority_class), '[]'::jsonb),
         count(*) filter (where n < v_min)
    into v_tasks, v_withheld_t from g;

  -- ---- pages
  with pg as (
    select role, sent_at, acknowledged_at, closed_at
      from public.pages
     where not is_test and sent_at >= v_t_from and sent_at < v_t_to
  ), g as (
    select role, count(*) n,
           count(*) filter (where acknowledged_at is not null) n_ack,
           percentile_cont(0.5) within group (order by extract(epoch from acknowledged_at - sent_at) / 60.0) filter (where acknowledged_at is not null) ack_p50,
           percentile_cont(0.9) within group (order by extract(epoch from acknowledged_at - sent_at) / 60.0) filter (where acknowledged_at is not null) ack_p90,
           count(*) filter (where closed_at is not null) n_closed,
           percentile_cont(0.5) within group (order by extract(epoch from closed_at - sent_at) / 60.0) filter (where closed_at is not null) close_p50,
           percentile_cont(0.9) within group (order by extract(epoch from closed_at - sent_at) / 60.0) filter (where closed_at is not null) close_p90,
           count(*) filter (where acknowledged_at is null and closed_at is null) unacknowledged_open
      from pg group by role
  )
  select coalesce(jsonb_agg(case when n < v_min
            then jsonb_build_object('page_role', role::text, 'suppressed', true, 'reason', 'under_minimum')
            else jsonb_build_object('page_role', role::text, 'suppressed', false,
              'time_to_acknowledge_minutes', case when n_ack >= v_min then jsonb_build_object('median', round(ack_p50::numeric, 1), 'p90', round(ack_p90::numeric, 1))
                                                  else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'time_to_close_minutes', case when n_closed >= v_min then jsonb_build_object('median', round(close_p50::numeric, 1), 'p90', round(close_p90::numeric, 1))
                                            else jsonb_build_object('suppressed', true, 'reason', 'under_minimum') end,
              'unacknowledged_open_now', unacknowledged_open) end
            order by role), '[]'::jsonb),
         count(*) filter (where n < v_min)
    into v_pages, v_withheld_p from g;

  -- ---- data quality
  select count(distinct m.patient_id),
         count(distinct m.patient_id) filter (where exists (
           select 1 from public.vitals_readings r
            where r.patient_id = m.patient_id and r.vital_type = 'blood_pressure' and r.systolic is not null and r.diastolic is not null
              and coalesce(r.validation_status::text, '') <> 'rejected' and r.taken_at >= now() - interval '30 days'))
    into v_members, v_members_bp
    from public.patient_memberships m join public.profiles p on p.id = m.patient_id
   where m.state = 'active' and not coalesce(p.is_test, false);
  select count(*), count(*) filter (where s.bp_status = 'insufficient_data')
    into v_snap, v_snap_insuff
    from public.outcome_snapshots s join public.profiles p on p.id = s.patient_id
   where not s.is_test and not coalesce(p.is_test, false) and s.day = 90 and s.anchor_date between v_from and v_to;
  v_dq := jsonb_build_object(
    'members_with_a_bp_reading_last_30_days_pct', case when v_members >= v_min then round(100.0 * v_members_bp / v_members, 1) end,
    'members_with_a_bp_reading_suppressed', v_members < v_min,
    'day90_snapshots_insufficient_data_pct', case when v_snap >= v_min then round(100.0 * v_snap_insuff / v_snap, 1) end,
    'day90_snapshots_suppressed', v_snap < v_min);

  perform private.log_audit('outcomes.clinical_response_report', 'outcome_report', null, jsonb_build_object('from', v_from, 'to', v_to));

  return jsonb_build_object(
    'minimum_cell', v_min,
    'config_version', (select version from public.outcome_config where is_active),
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'tasks', v_tasks, 'task_groups_withheld', v_withheld_t,
    'pages', v_pages, 'page_groups_withheld', v_withheld_p,
    'data_quality', v_dq,
    'descriptive_only', true,
    'not_for_publication', true,
    'generated_at', now());
end $$;

-- private.suppress_small: read the platform minimum through the shared floor (s75a rule: only min_cell_floor reads it from configuration)
create or replace function private.suppress_small(p_n bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select case when p_n >= private.min_cell_floor()::bigint then p_n else null end; $$;

-- public.employer_visit_summary: read the platform minimum through the shared floor (s75a rule: only min_cell_floor reads it from configuration)
create or replace function public.employer_visit_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.employer_admin_org();
begin
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'status', e.status, 'event_date', e.event_date, 'city', e.city, 'address', e.address,
      'headcount_requested', e.headcount_requested,
      'registered', private.suppress_small(c.registered), 'checked_in', private.suppress_small(c.checked_in),
      'suppressed', (c.registered < private.min_cell_floor()::bigint
                     or c.checked_in < private.min_cell_floor()::bigint))
      order by e.event_date desc)
    from public.testing_events e
    cross join lateral (select count(*) filter (where b.state in ('confirmed', 'checked_in', 'no_show')) as registered,
                               count(*) filter (where b.state = 'checked_in') as checked_in
                          from public.testing_event_bookings b where b.event_id = e.id) c
    where e.kind = 'employer_visit' and e.employer_org_id = v_org), '[]'::jsonb);
end;
$$;

do $$
begin
  if (select is_active from public.outcome_config where version = 4) then raise exception 'S75x: config v4 must be inactive'; end if;
  if (select count(*) from public.outcome_config where is_active) <> 1 then raise exception 'S75x: exactly one active outcome_config expected'; end if;
  if not ((select config -> 'measures' -> 'phq9' from public.outcome_config where version = 4) ? 'exclusions') then raise exception 'S75x: v4 has no exclusions'; end if;
  if (select config -> 'measures' from public.outcome_config where version = 3) #> '{phq9,exclusions}' is not null then raise exception 'S75x: v3 must not change'; end if;
  if has_function_privilege('anon', 'public.mental_health_outcome_report(text,integer,date,date)', 'EXECUTE') then raise exception 'S75x: anon can run a report'; end if;
  if has_function_privilege('authenticated', 'private.outcome_measure_cohort(text,integer,date,date,uuid[])', 'EXECUTE') then raise exception 'S75x: a user can run the cohort figure'; end if;
end $$;
