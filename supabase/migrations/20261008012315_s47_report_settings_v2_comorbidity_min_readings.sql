-- S47 (decisions applied, CMO and founder choices recorded in chat 2026-10-07, docs/plans/S41-S46-cmo-decisions-2026-10-07.md decisions 1 to 6).
-- NOT signatures: the new report settings are version 2, UNSIGNED, and the S46 settings v1 stays as it was. Nothing is switched on.
--
-- What this does:
--   1. health_report_config_versions v2 (unsigned): blood pressure target below 140/90, below 130/80 when the patient has diabetes, kidney disease,
--      known cardiovascular disease or a high cardiovascular risk band (a care-plan target still overrides); at least 12 home readings on at least 3
--      days; the 5 mmHg and 5 percent borderline margins are gone (borderline is the high-normal band 130-139 / 80-89 only, and a lab value is flagged
--      only outside the laboratory's own range); the other numbers are recorded as Tarragon PRODUCT RULES (productRules), not guideline facts.
--   2. private.hr_has_condition + private.health_report_collect restated: the collector returns the number of distinct reading days and four
--      booleans for the higher-risk group (no condition name leaves the function).
--   3. private.health_report_assert_honest restated: a blood pressure verdict needs the minimum readings and days that the composed report states.
--
-- Timestamp: hand-picked later than every file on the integration branch (newest 20261007233237) and the newest live version read on
-- 2026-10-07 (20261007231528).

create or replace function private.hr_has_condition(p_patient uuid, p_prefixes jsonb, p_names jsonb, p_exclude jsonb default '[]'::jsonb) returns boolean
language sql stable security definer set search_path = ''
as $$
  -- S47 review fix: a code matches by ICD-10 prefix (the code, not a word), a name matches only an ANCHORED pattern from the unsigned settings, and an
  -- exclusion pattern always wins (pre-diabetes, family history, gestational, heatstroke are not the condition). No bare substring match any more.
  select exists (
    select 1 from public.patient_conditions pc
     where pc.patient_id = p_patient
       and pc.status in ('active', 'controlled', 'uncontrolled')
       and not (jsonb_typeof(p_exclude) = 'array' and exists (select 1 from jsonb_array_elements_text(p_exclude) e where lower(btrim(pc.condition_name)) ~* e))
       and (
         (jsonb_typeof(p_prefixes) = 'array' and exists (select 1 from jsonb_array_elements_text(p_prefixes) x where upper(coalesce(pc.icd10_code, '')) like upper(x) || '%'))
         or (jsonb_typeof(p_names) = 'array' and exists (select 1 from jsonb_array_elements_text(p_names) y where lower(btrim(pc.condition_name)) ~* y))
       ))
$$;
revoke all on function private.hr_has_condition(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- health-report-config-v2-begin
insert into public.health_report_config_versions (version, notes, config) values (2,
  'PROPOSED, UNSIGNED. Chat selections 2026-10-07 (not signatures). Guideline-based: BP target, higher-risk target, high-normal band, minimum readings and days (Nigeria Hypertension Guideline 2023-2028, WHO 2021). Tarragon product rules, NOT guideline facts: maxPriorities, changeTolerancePct, recheckWeeks, priorityWindows, trendMinPoints, trendYears. The CMO signs this version, or changes it, before any report is built for a real patient.',
  $json${
 "maxPriorities": 3,
 "minBpReadings": 12,
 "minBpDays": 3,
 "bpTarget": { "systolicBelow": 140, "diastolicBelow": 90 },
 "bpTargetHigherRisk": { "systolicBelow": 130, "diastolicBelow": 80 },
 "bpHighNormalBand": { "systolicFrom": 130, "systolicBelow": 140, "diastolicFrom": 80, "diastolicBelow": 90 },
 "higherRiskCriteria": {
  "icd10Prefixes": {
   "diabetes": ["E10", "E11", "E12", "E13", "E14"],
   "ckd": ["N18"],
   "cvd": ["I20", "I21", "I22", "I23", "I24", "I25", "I50", "I63", "I64", "I65", "I66", "I69", "I70", "I73"]
  },
  "namePatterns": {
   "diabetes": ["^(type [12] )?diabetes( mellitus)?( type [12])?$"],
   "ckd": ["^(chronic kidney disease|ckd)( stage [1-5][ab]?)?$"],
   "cvd": ["^(coronary (artery|heart) disease|ischaemic heart disease|ischemic heart disease|myocardial infarction|angina( pectoris)?|stroke|heart failure|peripheral arter(y|ial) disease)$"]
  },
  "excludePatterns": ["pre.?diabet", "family history", "gestational", "history of family", "risk of", "heat.?stroke", "sunstroke", "suspected"],
  "elevatedRiskTiers": ["high", "very_high"]
 },
 "changeTolerancePct": 3,
 "recheckWeeks": 4,
 "priorityWindows": { "bp": "within 4 weeks", "lab": "within 4 weeks", "screening": "within 3 months", "risk": "within 4 weeks" },
 "trendMinPoints": 2,
 "trendYears": 3,
 "productRules": ["maxPriorities", "changeTolerancePct", "recheckWeeks", "priorityWindows", "trendMinPoints", "trendYears"],
 "guidelineBasis": ["bpTarget", "bpTargetHigherRisk", "bpHighNormalBand", "minBpReadings", "minBpDays"],
 "statementKey": "report.statement.not_rule_out",
 "statementApprovedByCmo": false,
 "shareExcludedSections": ["screening_reproductive", "risk", "questionnaires"]
}$json$);
-- health-report-config-v2-end

create or replace function private.health_report_collect(p_patient uuid, p_year integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_from timestamptz := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Africa/Lagos');
  v_to   timestamptz := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Africa/Lagos');
  v_pfrom timestamptz := make_timestamptz(p_year - 1, 1, 1, 0, 0, 0, 'Africa/Lagos');
  v_bp jsonb; v_prior jsonb; v_labs jsonb; v_trends jsonb; v_screen jsonb; v_risk jsonb; v_dev jsonb; v_weight jsonb; v_quest jsonb; v_target jsonb;
  v_ra public.risk_assessments%rowtype;
  v_cfg jsonb; v_flags jsonb;
begin
  select jsonb_build_object('count', count(*), 'firstAt', min(taken_at), 'lastAt', max(taken_at),
           'avgSystolic', round(avg(systolic), 1), 'avgDiastolic', round(avg(diastolic), 1),
           'days', count(distinct (taken_at at time zone 'Africa/Lagos')::date))
    into v_bp from public.vitals_readings
   where patient_id = p_patient and vital_type = 'blood_pressure' and taken_at >= v_from and taken_at < v_to and systolic is not null and diastolic is not null
     and coalesce(validation_status::text, '') <> 'rejected';
  select jsonb_build_object('count', count(*), 'avgSystolic', round(avg(systolic), 1), 'avgDiastolic', round(avg(diastolic), 1),
           'days', count(distinct (taken_at at time zone 'Africa/Lagos')::date))
    into v_prior from public.vitals_readings
   where patient_id = p_patient and vital_type = 'blood_pressure' and taken_at >= v_pfrom and taken_at < v_from and systolic is not null and diastolic is not null
     and coalesce(validation_status::text, '') <> 'rejected';
  if (v_prior ->> 'count')::integer = 0 then v_prior := null; end if;

  select jsonb_build_object('manual', count(*) filter (where source = 'manual'), 'device', count(*) filter (where source = 'device'),
           'wearable', count(*) filter (where source = 'wearable'))
    into v_dev from public.vitals_readings where patient_id = p_patient and taken_at >= v_from and taken_at < v_to;

  select jsonb_build_object('latestKg', (array_agg(weight_kg order by taken_at desc))[1], 'latestAt', max(taken_at), 'count', count(*))
    into v_weight from public.vitals_readings
   where patient_id = p_patient and vital_type = 'weight' and weight_kg is not null and taken_at >= v_from and taken_at < v_to;

  -- the care team's own BP target, if an active care plan carries one (never invented here)
  select jsonb_build_object('systolicBelow', (cp.target_ranges -> 'systolic' ->> 'max')::numeric, 'diastolicBelow', (cp.target_ranges -> 'diastolic' ->> 'max')::numeric, 'setBy', 'care_team')
    into v_target from public.care_plans cp
   where cp.patient_id = p_patient and cp.status = 'active' and (cp.target_ranges -> 'systolic' ->> 'max') is not null and (cp.target_ranges -> 'diastolic' ->> 'max') is not null
   order by cp.updated_at desc limit 1;

  -- labs: every analyte with a released numeric reading this year, latest and the latest from before this year
  select coalesce(jsonb_agg(x order by x ->> 'code'), '[]'::jsonb) into v_labs from (
    select jsonb_build_object('code', c.code,
        'unit', (array_agg(p.unit order by p.taken_at desc))[1],
        'readingsThisYear', count(*) filter (where p.taken_at >= v_from and p.taken_at < v_to),
        'latest', (select jsonb_build_object('at', q.taken_at, 'value', q.value, 'refLow', q.ref_low, 'refHigh', q.ref_high, 'flag', q.flag, 'unit', q.unit)
                     from private.hr_biomarker_points(p_patient, c.code) q where q.taken_at >= v_from and q.taken_at < v_to order by q.taken_at desc limit 1),
        'previous', (select jsonb_build_object('at', q.taken_at, 'value', q.value, 'refLow', q.ref_low, 'refHigh', q.ref_high, 'flag', q.flag, 'unit', q.unit)
                     from private.hr_biomarker_points(p_patient, c.code) q where q.taken_at < v_from order by q.taken_at desc limit 1)) as x
      from (select distinct lower(i.analyte_code) as code from public.lab_result_items i where i.patient_id = p_patient and i.value_numeric is not null
            union select distinct lower(l.code) from public.lab_analyte_readings l where l.patient_id = p_patient and l.value is not null) c
      cross join lateral private.hr_biomarker_points(p_patient, c.code) p
     where not private.report_excluded_code(c.code)
     group by c.code
    having count(*) filter (where p.taken_at >= v_from and p.taken_at < v_to) > 0) s;

  -- trends: the last few points per analyte (own history only, units never converted)
  select coalesce(jsonb_agg(t order by t ->> 'code'), '[]'::jsonb) into v_trends from (
    select jsonb_build_object('code', c.code,
        'unitMixed', (select count(distinct nullif(lower(btrim(q.unit)), '')) > 1 from private.hr_biomarker_points(p_patient, c.code) q),
        'points', (select coalesce(jsonb_agg(jsonb_build_object('at', z.taken_at, 'value', z.value, 'unit', z.unit, 'refLow', z.ref_low, 'refHigh', z.ref_high) order by z.taken_at), '[]'::jsonb)
                     from (select * from private.hr_biomarker_points(p_patient, c.code) q where q.taken_at >= make_timestamptz(p_year - 2, 1, 1, 0, 0, 0, 'Africa/Lagos') and q.taken_at < v_to
                            order by q.taken_at desc limit 6) z)) as t
      from (select distinct lower(i.analyte_code) as code from public.lab_result_items i where i.patient_id = p_patient and i.value_numeric is not null
            union select distinct lower(l.code) from public.lab_analyte_readings l where l.patient_id = p_patient and l.value is not null) c
     where not private.report_excluded_code(c.code)) s2
   where jsonb_array_length(t -> 'points') >= 2;

  -- screening done and due. Blood-borne and sexual-health items are never listed. Reproductive items are flagged so a shared copy can drop them.
  select jsonb_build_object(
    'done', (select coalesce(jsonb_agg(jsonb_build_object('code', st.code, 'on', sc.performed_date, 'reproductive', st.code in ('cervical_smear', 'breast_imaging', 'mammography', 'clinical_breast_exam', 'antenatal_booking', 'pcos_panel')) order by sc.performed_date), '[]'::jsonb)
               from public.screening_completions sc join public.screen_types st on st.id = sc.screen_type_id
              where sc.patient_id = p_patient and sc.performed_date >= v_from::date and sc.performed_date < v_to::date
                and st.code not in ('hiv', 'hep_b', 'hep_c', 'syphilis', 'chlamydia_gonorrhoea')),
    'due', (select coalesce(jsonb_agg(jsonb_build_object('code', st.code, 'dueOn', ss.due_date, 'status', ss.status::text, 'reproductive', st.code in ('cervical_smear', 'breast_imaging', 'mammography', 'clinical_breast_exam', 'antenatal_booking', 'pcos_panel')) order by ss.due_date), '[]'::jsonb)
               from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id
              where ss.patient_id = p_patient and ss.status in ('pending', 'booked', 'overdue')
                and st.code not in ('hiv', 'hep_b', 'hep_c', 'syphilis', 'chlamydia_gonorrhoea'))) into v_screen;

  -- the S45 risk band, only when the instrument is signed and its guard is on; otherwise "not assessed" (never an estimate)
  select ra.* into v_ra from public.risk_assessments ra
    join public.risk_instrument_versions iv on iv.id = ra.instrument_version_id
   where ra.patient_id = p_patient and ra.status = 'scored' and iv.is_active and iv.approved_by is not null
     and private.go_live_open_patient('risk_instrument_who2019_enabled', p_patient)
   order by ra.assessed_at desc limit 1;
  if v_ra.id is null then
    v_risk := jsonb_build_object('state', 'not_assessed');
  else
    v_risk := jsonb_build_object('state', 'assessed', 'bandCode', v_ra.band_code, 'tier', v_ra.tier, 'lowPct', v_ra.band_low_pct, 'highPct', v_ra.band_high_pct,
                                 'model', v_ra.model, 'assessedAt', v_ra.assessed_at, 'instrumentVersionId', v_ra.instrument_version_id,
                                 'basedOn', coalesce(v_ra.inputs, '{}'::jsonb));
  end if;

  -- questionnaire results (risk scores), never a mental-health instrument
  select coalesce(jsonb_agg(jsonb_build_object('type', s.score_type, 'level', s.risk_level::text, 'at', s.computed_at) order by s.computed_at desc), '[]'::jsonb) into v_quest
    from (select distinct on (score_type) * from public.patient_risk_scores
           where patient_id = p_patient and computed_at >= v_from and computed_at < v_to
             and score_type !~* '(phq|gad|mental|depress|anxiety|suicid|audit|substance)'
           order by score_type, computed_at desc) s;

  -- S47 (decision 1): is the patient in a higher-risk group for the lower blood pressure target? Booleans only (no condition name leaves this
  -- function, so a shared copy cannot reveal one). The criteria are the report settings' own (versioned, unsigned), read the way the writer reads
  -- them: the signed active version, else the latest.
  select h.config into v_cfg from public.health_report_config_versions h order by (h.is_active and h.approved_by is not null) desc, h.version desc limit 1;
  select jsonb_build_object(
      'diabetes', private.hr_has_condition(p_patient, v_cfg -> 'higherRiskCriteria' -> 'icd10Prefixes' -> 'diabetes', v_cfg -> 'higherRiskCriteria' -> 'namePatterns' -> 'diabetes', v_cfg -> 'higherRiskCriteria' -> 'excludePatterns'),
      'ckd',      private.hr_has_condition(p_patient, v_cfg -> 'higherRiskCriteria' -> 'icd10Prefixes' -> 'ckd',      v_cfg -> 'higherRiskCriteria' -> 'namePatterns' -> 'ckd', v_cfg -> 'higherRiskCriteria' -> 'excludePatterns'),
      'cvd',      private.hr_has_condition(p_patient, v_cfg -> 'higherRiskCriteria' -> 'icd10Prefixes' -> 'cvd',      v_cfg -> 'higherRiskCriteria' -> 'namePatterns' -> 'cvd', v_cfg -> 'higherRiskCriteria' -> 'excludePatterns'),
      'elevatedRisk', coalesce((v_risk ->> 'state') = 'assessed' and (v_risk ->> 'tier') in (
          select jsonb_array_elements_text(coalesce(v_cfg -> 'higherRiskCriteria' -> 'elevatedRiskTiers', '[]'::jsonb))), false))
    into v_flags;

  return jsonb_build_object('year', p_year, 'collectedAt', now(), 'bp', v_bp, 'bpPrior', v_prior, 'bpCareTeamTarget', v_target, 'weight', v_weight, 'devices', v_dev,
                            'labs', v_labs, 'trends', v_trends, 'screening', v_screen, 'risk', v_risk, 'questionnaires', v_quest, 'bpHigherRisk', v_flags);
end $$;
revoke all on function private.health_report_collect(uuid, integer) from public, anon, authenticated;

create or replace function private.health_report_assert_honest(p_inputs jsonb, p_composed jsonb, p_priorities jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
declare v_item jsonb; v_pri jsonb; v_txt text;
begin
  if jsonb_typeof(p_priorities) <> 'array' or jsonb_array_length(p_priorities) > 3 then
    raise exception 'health_report_honesty: at most three priorities' using errcode = '23514';
  end if;
  for v_pri in select * from jsonb_array_elements(p_priorities) loop
    if v_pri ->> 'action' is null or v_pri ->> 'why' is null or v_pri ->> 'whoHelps' is null or v_pri ->> 'when' is null then
      raise exception 'health_report_honesty: a priority needs an action, a reason, who helps and when' using errcode = '23514';
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_composed -> 'items', '[]'::jsonb)) loop
    if v_item ->> 'state' not in ('on_target', 'needs_attention', 'not_checked', 'not_measured', 'no_target') then
      raise exception 'health_report_honesty: unknown state %', v_item ->> 'state' using errcode = '23514';
    end if;
    if v_item ->> 'state' = 'on_target' and (
         v_item -> 'value' is null or jsonb_typeof(v_item -> 'value') <> 'number'
         or coalesce((v_item ->> 'readingCount')::integer, 0) < 1
         or coalesce((v_item ->> 'tooFewReadings')::boolean, false)) then
      raise exception 'health_report_honesty: "on target" needs a recorded value and enough readings' using errcode = '23514';
    end if;
    -- S47 (decisions 1 and 2): a blood pressure verdict (on target or needs attention) needs at least the minimum number of readings AND the minimum number
    -- of distinct days, both taken from the composed report's own settings, and must say how many of each it rests on ("based on N readings over D days").
    if v_item ->> 'id' = 'bp' and v_item ->> 'state' in ('on_target', 'needs_attention') and (p_composed ->> 'minBpReadings') is not null then
      if coalesce((v_item ->> 'readingCount')::integer, 0) < (p_composed ->> 'minBpReadings')::integer
         or coalesce((v_item ->> 'readingDays')::integer, 0) < coalesce((p_composed ->> 'minBpDays')::integer, 1) then
        raise exception 'health_report_honesty: a blood pressure verdict needs the minimum readings and days' using errcode = '23514';
      end if;
    end if;
    if v_item ->> 'state' = 'on_target' and coalesce((v_item ->> 'borderline')::boolean, false) then
      raise exception 'health_report_honesty: a borderline value is never "on target"' using errcode = '23514';
    end if;
  end loop;
  v_txt := lower(coalesce(p_inputs::text, '') || ' ' || coalesce(p_composed::text, '') || ' ' || coalesce(p_priorities::text, ''));
  if v_txt ~ '(^|[^a-z])(optimal|biological_age|biological age|healthspan|health_span|percentile)' then
    raise exception 'health_report_honesty: no optimal range, biological age, healthspan or percentile' using errcode = '23514';
  end if;
  if v_txt ~ '(^|[^a-z])(hiv|hbsag|hbs_ag|hcv|hep_b|hep_c|hepatitis|syphilis|chlamydia|gonorrh|anti_hbs)' then
    raise exception 'health_report_honesty: sensitive blood-borne or sexual-health results never appear in a report (INV-04)' using errcode = '23514';
  end if;
end $$;
revoke all on function private.health_report_assert_honest(jsonb, jsonb, jsonb) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from public.health_report_config_versions where version = 2 and (is_active or approved_by is not null)) then raise exception 'S47 self-check: report settings v2 must be unsigned'; end if;
  if exists (select 1 from public.health_report_config_versions where config ? 'bpBorderlineMarginMmHg' and version = 2) then raise exception 'S47 self-check: the borderline margin must not exist in v2'; end if;
  if has_function_privilege('anon', 'private.hr_has_condition(uuid,jsonb,jsonb,jsonb)', 'EXECUTE') then raise exception 'S47 self-check: hr_has_condition reachable by anon'; end if;
end $$;
