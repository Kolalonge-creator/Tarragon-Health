-- Baseline labs prescribing rule, VERSION 2: the CMO's answers of 2026-10-27 carried into the merged rule (migration 20261026183108, PR #1334).
--
-- v1 (unsigned, inactive, left untouched) asks kidney function, potassium and glucose for EVERY blood pressure and glucose-lowering medicine, within 90 days,
-- with no kidney block for metformin, no HbA1c exception and no pregnancy question. The CMO's answers (docs/design/baseline-labs-rule-proposal.md, recorded in
-- docs/DECISIONS.md): thresholds as drafted; the prescribing doctor may start before results are back and records why; fasting glucose replaces HbA1c when the doctor
-- marks it unreliable; a calcium channel blocker alone (and a beta blocker) needs no blood test.
--
--   1. baseline_labs_rule_config v2: inserted UNSIGNED and INACTIVE. Only the CMO's sign_baseline_labs_rule_config(2) activates it. Differences from v1:
--      calcium channel blockers and beta blockers are out of scope; each class has its own tests (class_requirements); 12-month window; documented override
--      follow-up of 7 days; metformin kidney rule (egfr_rules); pregnancy question for ACE inhibitor / ARB / statin; HbA1c exception.
--   2. private.baseline_labs_missing() reads class_requirements, the HbA1c exception and the pregnancy rule when the signed version has them; a version without
--      class_requirements (v1) behaves exactly as before.
--   3. private.enforce_baseline_labs_rule(): a start or increase of metformin is refused with NO override when the eGFR (CKD-EPI 2021, from the latest creatinine in
--      the window) is under the rule's limit. A decrease or an unchanged dose is never touched.
--   4. hba1c_exceptions + mark_hba1c_unreliable / clear_hba1c_unreliable (prescriber with a tie to the patient).
-- Not enforced: the repeat creatinine and potassium 1 to 2 weeks after starting an ACE inhibitor or ARB; "review the dose" for eGFR 30 to 44.
-- Counts before this migration (live, 2026-10-28): v1 exists, unsigned and inactive; no hba1c_exceptions table.
-- ROLLBACK: restore private.baseline_labs_missing and private.enforce_baseline_labs_rule from 20261026183108, drop the exception table and functions, delete version 2.

-- 1. v2 configuration ------------------------------------------------------------------------------------------------------------------
-- baseline-labs-rule-v2-begin
insert into public.baseline_labs_rule_config (version, is_active, effective_from, config, note) values (2, false, '2026-10-28', $json$
{
  "applies_to": {
    "start_new_medicine": true,
    "dose_increase": true,
    "sources_checked": [
      "clinician",
      "specialist"
    ],
    "sources_never_checked": [
      "patient",
      "fhir_import"
    ],
    "note": "Checked when a doctor starts one of these medicines, restarts a stopped one, changes a prescription to one of them, or raises its dose or how often it is taken. A person recording a medicine they already take, an imported record, a stopped medicine, and a dose or frequency that stays the same or goes down are never checked. Doses are compared by their amounts and units, so 1 g to 500 mg is a decrease."
  },
  "drug_classes": {
    "bp_lowering": {
      "label": "Blood-pressure-lowering medicines",
      "name_patterns": [
        "%losartan%",
        "%telmisartan%",
        "%valsartan%",
        "%irbesartan%",
        "%candesartan%",
        "%olmesartan%",
        "%azilsartan%",
        "%sacubitril%",
        "%ramipril%",
        "%lisinopril%",
        "%enalapril%",
        "%perindopril%",
        "%captopril%",
        "%benazepril%",
        "%fosinopril%",
        "%quinapril%",
        "%aliskiren%",
        "%hydrochlorothiazide%",
        "%hctz%",
        "%indapamide%",
        "%bendroflumethiazide%",
        "%chlortalidone%",
        "%chlorthalidone%",
        "%spironolactone%",
        "%amiloride%",
        "%eplerenone%",
        "%moduretic%",
        "%furosemide%",
        "%frusemide%",
        "%bumetanide%",
        "%torsemide%",
        "%hydralazine%",
        "%methyldopa%",
        "%doxazosin%",
        "%prazosin%",
        "%terazosin%",
        "%clonidine%"
      ]
    },
    "glucose_lowering": {
      "label": "Glucose-lowering medicines",
      "name_patterns": [
        "%metformin%",
        "%gliclazide%",
        "%glibenclamide%",
        "%glimepiride%",
        "%glipizide%",
        "%tolbutamide%",
        "%sitagliptin%",
        "%vildagliptin%",
        "%linagliptin%",
        "%saxagliptin%",
        "%alogliptin%",
        "%empagliflozin%",
        "%dapagliflozin%",
        "%canagliflozin%",
        "%ertugliflozin%",
        "%pioglitazone%",
        "%acarbose%",
        "%repaglinide%",
        "%nateglinide%",
        "%insulin%",
        "%liraglutide%",
        "%semaglutide%",
        "%dulaglutide%",
        "%exenatide%",
        "%tirzepatide%"
      ]
    },
    "note": "CMO answers 2026-10-27: a calcium channel blocker or a beta blocker alone needs no blood test, so those medicines are NOT covered (amlodipine, nifedipine, felodipine, lercanidipine, nitrendipine, diltiazem, verapamil, atenolol, bisoprolol, metoprolol, propranolol, carvedilol, nebivolol, labetalol). Every other class of blood-pressure and glucose-lowering medicine is covered. Statins are covered only for the pregnancy question.",
    "statins": {
      "label": "Statins (checked only for pregnancy)",
      "name_patterns": [
        "%atorvastatin%",
        "%simvastatin%",
        "%rosuvastatin%",
        "%pravastatin%",
        "%lovastatin%"
      ]
    }
  },
  "required_baseline": {
    "for_every_medicine_in_both_groups": [],
    "additionally_for_every_glucose_lowering_medicine": [],
    "additionally_if_diabetes_on_record": [],
    "analytes": {
      "kidney_function": {
        "label": "Kidney function (creatinine or eGFR)",
        "analyte_codes": [
          "creatinine"
        ],
        "note": "Creatinine is the stored kidney-function result; eGFR is calculated from it, so a recent creatinine counts."
      },
      "potassium": {
        "label": "Potassium",
        "analyte_codes": [
          "potassium"
        ]
      },
      "glucose": {
        "label": "Glucose",
        "analyte_codes": [
          "fasting_glucose",
          "random_glucose"
        ],
        "note": "A laboratory glucose result (fasting or random). A glucose the patient logged at home does not count."
      },
      "hba1c": {
        "label": "HbA1c",
        "analyte_codes": [
          "hba1c"
        ]
      },
      "sodium": {
        "label": "Sodium",
        "analyte_codes": [
          "sodium"
        ]
      },
      "glucose_or_hba1c": {
        "label": "Fasting glucose or HbA1c",
        "analyte_codes": [
          "fasting_glucose",
          "random_glucose",
          "hba1c"
        ],
        "note": "Either result counts. Where the doctor has marked HbA1c as unreliable for the patient, only a glucose result counts."
      }
    },
    "diabetes_on_record": {
      "icd10_prefixes": [
        "E10",
        "E11",
        "E13",
        "E14"
      ],
      "statuses": [
        "active",
        "controlled",
        "uncontrolled"
      ],
      "note": "Version 2 sets the tests for each medicine class in class_requirements, so this version does not ask for extra tests because diabetes is on the problem list."
    }
  },
  "recency_window_days": 365,
  "recency_window_note": "CMO answer 2026-10-27: 12 months. A result counts only if the specimen was collected (or the result dated) within 365 days before the medicine is started or the dose is raised. A result dated in the future does not count.",
  "when_labs_are_missing": {
    "action": "refuse_unless_documented_override",
    "bypass_available": true,
    "message": "The start or increase is refused and the doctor sees which labs are missing. The doctor orders them and tries again once the results are on file, or records a documented override.",
    "override": {
      "categories": [
        {
          "key": "emergency_treatment",
          "label": "Emergency treatment: waiting for labs would put the patient at risk"
        },
        {
          "key": "labs_ordered_results_pending",
          "label": "Labs have been ordered and the results are pending"
        },
        {
          "key": "labs_not_obtainable_documented",
          "label": "Labs cannot be obtained now, and the reason is written down"
        }
      ],
      "min_reason_length": 20,
      "valid_minutes": 30,
      "followup_hours": 168,
      "who": "A doctor with prescribing authority, for one patient and one medicine, used once by the same doctor."
    },
    "bypass_note": "A doctor can record a documented override: one of three reasons plus a written reason of at least 20 characters. It is valid for 30 minutes, for that doctor, that patient and that medicine, and is used once. The missing tests are then put on the patient's lab list due in 7 days (CMO answer 2026-10-27: the doctor may start before results and records why)."
  },
  "informational": {
    "membership": "Membership includes doctor-ordered baseline labs at the member price, paid separately. This note changes nothing in the check."
  },
  "proposed_note": "Every clinical value here is PROPOSED (the medicines, the tests for each class, the 12-month window, the kidney and pregnancy rules, the documented override). Nothing applies until the Chief Medical Officer signs. No agent signs. Version 2 carries the CMO's answers of 2026-10-27 into the merged baseline labs rule.",
  "class_requirements": [
    {
      "key": "acei_arb",
      "label": "ACE inhibitor or ARB",
      "name_patterns": [
        "%losartan%",
        "%telmisartan%",
        "%valsartan%",
        "%irbesartan%",
        "%candesartan%",
        "%olmesartan%",
        "%azilsartan%",
        "%sacubitril%",
        "%ramipril%",
        "%lisinopril%",
        "%enalapril%",
        "%perindopril%",
        "%captopril%",
        "%benazepril%",
        "%fosinopril%",
        "%quinapril%",
        "%aliskiren%"
      ],
      "requires": [
        "kidney_function",
        "potassium",
        "sodium"
      ],
      "note": "Repeat creatinine and potassium 1 to 2 weeks after starting or raising the dose. That repeat is part of the rule's wording but is not enforced or scheduled by the system."
    },
    {
      "key": "thiazide",
      "label": "Thiazide-type diuretic",
      "name_patterns": [
        "%hydrochlorothiazide%",
        "%hctz%",
        "%indapamide%",
        "%bendroflumethiazide%",
        "%chlortalidone%",
        "%chlorthalidone%"
      ],
      "requires": [
        "kidney_function",
        "potassium",
        "sodium",
        "glucose_or_hba1c"
      ]
    },
    {
      "key": "other_bp",
      "label": "Other blood-pressure medicines (not in the CMO's table: same tests as an ACE inhibitor)",
      "name_patterns": [
        "%spironolactone%",
        "%amiloride%",
        "%eplerenone%",
        "%moduretic%",
        "%furosemide%",
        "%frusemide%",
        "%bumetanide%",
        "%torsemide%",
        "%hydralazine%",
        "%methyldopa%",
        "%doxazosin%",
        "%prazosin%",
        "%terazosin%",
        "%clonidine%"
      ],
      "requires": [
        "kidney_function",
        "potassium",
        "sodium"
      ]
    },
    {
      "key": "metformin",
      "label": "Metformin",
      "name_patterns": [
        "%metformin%"
      ],
      "requires": [
        "kidney_function",
        "glucose_or_hba1c"
      ]
    },
    {
      "key": "sulfonylurea_insulin",
      "label": "Sulfonylurea or insulin",
      "name_patterns": [
        "%gliclazide%",
        "%glibenclamide%",
        "%glimepiride%",
        "%glipizide%",
        "%tolbutamide%",
        "%insulin%"
      ],
      "requires": [
        "kidney_function",
        "hba1c",
        "glucose"
      ]
    },
    {
      "key": "other_glucose_lowering",
      "label": "Other glucose-lowering medicines (not in the CMO's table: same tests as a sulfonylurea)",
      "name_patterns": [
        "%sitagliptin%",
        "%vildagliptin%",
        "%linagliptin%",
        "%saxagliptin%",
        "%alogliptin%",
        "%empagliflozin%",
        "%dapagliflozin%",
        "%canagliflozin%",
        "%ertugliflozin%",
        "%pioglitazone%",
        "%acarbose%",
        "%repaglinide%",
        "%nateglinide%",
        "%liraglutide%",
        "%semaglutide%",
        "%dulaglutide%",
        "%exenatide%",
        "%tirzepatide%"
      ],
      "requires": [
        "kidney_function",
        "hba1c",
        "glucose"
      ]
    },
    {
      "key": "statin",
      "label": "Statin",
      "name_patterns": [
        "%atorvastatin%",
        "%simvastatin%",
        "%rosuvastatin%",
        "%pravastatin%",
        "%lovastatin%"
      ],
      "requires": []
    }
  ],
  "required_baseline_note": "Each medicine class lists its own tests in class_requirements (the CMO's table of 2026-10-27). The three lists above are empty in this version.",
  "egfr_rules": {
    "name_patterns": [
      "%metformin%"
    ],
    "do_not_start_below": 30,
    "review_dose_below": 45,
    "formula": "CKD-EPI 2021 from the latest creatinine inside the window",
    "note": "Metformin is refused, with no override, when the eGFR worked out from the latest creatinine is under 30. Between 30 and 44 the doctor should review the dose; the system does not enforce that."
  },
  "pregnancy": {
    "classes": [
      "acei_arb",
      "statin"
    ],
    "age_from": 12,
    "age_to": 50,
    "negative_test_valid_days": 30,
    "analyte_code": "pregnancy_test",
    "label": "Pregnancy excluded (a negative pregnancy test in the last 30 days)",
    "note": "For a woman aged 12 to 50, or with sex or date of birth not on record, starting or raising an ACE inhibitor, ARB or statin needs a negative pregnancy test on file. Without it the start is refused unless the doctor records a documented override."
  },
  "hba1c_exception": {
    "conditions": [
      "sickle cell trait or disease",
      "recent transfusion",
      "anaemia"
    ],
    "note": "A doctor with prescribing authority can mark a patient's HbA1c as unreliable. Fasting or random glucose then stands in for HbA1c for that patient."
  }
}
$json$::jsonb, 'PROPOSED, v2, UNSIGNED, INACTIVE. Owner: CMO. The CMO answers of 2026-10-27 on top of v1: calcium channel and beta blockers out of scope, per-class tests, 12 months, metformin eGFR rule, pregnancy question, HbA1c exception.');
-- baseline-labs-rule-v2-end

-- 2. HbA1c exceptions -----------------------------------------------------------------------------------------------------------------
create table public.hba1c_exceptions (
  patient_id      uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  reason          text not null check (length(btrim(reason)) >= 10),
  marked_by       uuid not null references public.profiles (id),
  marked_at       timestamptz not null default now()
);
create index hba1c_exceptions_org_idx on public.hba1c_exceptions (organisation_id);
create index hba1c_exceptions_marked_by_idx on public.hba1c_exceptions (marked_by);
alter table public.hba1c_exceptions enable row level security;
revoke all on public.hba1c_exceptions from public, anon, authenticated;
grant select on public.hba1c_exceptions to authenticated;
create policy hba1c_exceptions_read on public.hba1c_exceptions for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('hba1c_exceptions', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when the baseline labs HbA1c exception was added; a doctor note on a patient; awaiting review.'
  from unnest(array['hba1c_exceptions']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;

create function public.mark_hba1c_unreliable(p_patient uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null or not private.is_org_staff(v_org) or not private.has_prescribing_authority(v_org) or not private.clinician_has_patient_access(p_patient) then
    raise exception 'Not authorised for this patient' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Say why HbA1c is unreliable for this patient (10 characters or more)' using errcode = '22023'; end if;
  insert into public.hba1c_exceptions (patient_id, organisation_id, reason, marked_by) values (p_patient, v_org, btrim(p_reason), v_uid)
  on conflict (patient_id) do update set reason = excluded.reason, marked_by = excluded.marked_by, marked_at = now();
  perform private.log_audit('baseline_labs.hba1c_unreliable_marked', 'profiles', p_patient, jsonb_build_object('reason', btrim(p_reason)));
end $$;
revoke all on function public.mark_hba1c_unreliable(uuid, text) from public, anon;
grant execute on function public.mark_hba1c_unreliable(uuid, text) to authenticated;

create function public.clear_hba1c_unreliable(p_patient uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null or not private.is_org_staff(v_org) or not private.has_prescribing_authority(v_org) or not private.clinician_has_patient_access(p_patient) then
    raise exception 'Not authorised for this patient' using errcode = '42501';
  end if;
  delete from public.hba1c_exceptions where patient_id = p_patient;
  perform private.log_audit('baseline_labs.hba1c_unreliable_cleared', 'profiles', p_patient, '{}'::jsonb);
end $$;
revoke all on function public.clear_hba1c_unreliable(uuid) from public, anon;
grant execute on function public.clear_hba1c_unreliable(uuid) to authenticated;

-- 3. The missing-labs function, class-aware -------------------------------------------------------------------------------------------
-- Same name and signature as v1, so the trigger and everything else keep working. A signed version WITHOUT class_requirements (v1) takes the old path unchanged.
create or replace function private.baseline_labs_missing(p_patient uuid, p_drug text) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.baseline_labs_rule();
  v_window integer;
  v_diabetic boolean;
  v_keys text[] := '{}';
  v_key text;
  v_missing text[] := '{}';
  v_codes text[];
  c jsonb; k text;
  v_classes text[] := '{}';
  v_unreliable boolean := false;
  v_sex text; v_dob date; v_age integer; v_female_or_unknown boolean;
begin
  if v_cfg is null or not private.baseline_labs_drug_in_scope(v_cfg, p_drug) then return '{}'; end if;
  v_window := (v_cfg ->> 'recency_window_days')::integer;

  if jsonb_typeof(v_cfg -> 'class_requirements') = 'array' then
    -- version 2 shape: each matching class lists its own tests
    for c in select * from jsonb_array_elements(v_cfg -> 'class_requirements') loop
      if exists (select 1 from jsonb_array_elements_text(c -> 'name_patterns') pat(p) where p_drug ilike pat.p) then
        v_classes := array_append(v_classes, c ->> 'key');
        for k in select jsonb_array_elements_text(c -> 'requires') loop
          if not (k = any (v_keys)) then v_keys := array_append(v_keys, k); end if;
        end loop;
      end if;
    end loop;
    v_unreliable := exists (select 1 from public.hba1c_exceptions where patient_id = p_patient);
  else
    -- version 1 shape, unchanged
    select array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'for_every_medicine_in_both_groups')) into v_keys;
    v_diabetic := exists (
      select 1 from private.patient_conditions_current pc
       where pc.patient_id = p_patient
         and pc.status::text in (select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'diabetes_on_record' -> 'statuses'))
         and exists (select 1 from jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'diabetes_on_record' -> 'icd10_prefixes') x
                      where upper(coalesce(pc.icd10_code, '')) like x || '%'));
    if private.baseline_labs_drug_in_group(v_cfg, 'glucose_lowering', p_drug) then
      v_keys := v_keys || array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'additionally_for_every_glucose_lowering_medicine'));
    elsif v_diabetic then
      v_keys := v_keys || array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'additionally_if_diabetes_on_record'));
    end if;
  end if;

  foreach v_key in array v_keys loop
    select array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'analytes' -> v_key -> 'analyte_codes')) into v_codes;
    if v_unreliable then
      -- HbA1c is unreliable for this patient: a glucose result stands in for it, and a combined test no longer accepts it
      if v_key = 'hba1c' then
        select array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'analytes' -> 'glucose' -> 'analyte_codes')) into v_codes;
      else
        v_codes := array_remove(v_codes, 'hba1c');
      end if;
    end if;
    if not exists (
      select 1 from private.lab_analyte_readings_current l
       where l.patient_id = p_patient and l.code = any (v_codes)
         and coalesce(l.specimen_collected_at, l.taken_at) >= now() - make_interval(days => v_window)
         and coalesce(l.specimen_collected_at, l.taken_at) <= now() + interval '1 day') then
      v_missing := v_missing || coalesce(v_cfg -> 'required_baseline' -> 'analytes' -> v_key ->> 'label', v_key);
    end if;
  end loop;

  -- pregnancy: a woman who could be pregnant (or whose sex or age is not on record) needs a recent negative pregnancy test for the listed classes
  if v_cfg ? 'pregnancy' and v_classes && array(select jsonb_array_elements_text(v_cfg -> 'pregnancy' -> 'classes')) then
    select p.sex::text, p.date_of_birth into v_sex, v_dob from public.profiles p where p.id = p_patient;
    v_age := case when v_dob is null then null else extract(year from age(v_dob))::integer end;
    v_female_or_unknown := v_sex is null or lower(v_sex) = 'female';
    if v_female_or_unknown
       and (v_age is null or v_age between coalesce((v_cfg #>> '{pregnancy,age_from}')::integer, 12) and coalesce((v_cfg #>> '{pregnancy,age_to}')::integer, 50))
       and not exists (
         select 1 from private.lab_analyte_readings_current l
          where l.patient_id = p_patient and l.code = coalesce(v_cfg #>> '{pregnancy,analyte_code}', 'pregnancy_test') and lower(coalesce(l.value_text, '')) like 'neg%'
            and coalesce(l.specimen_collected_at, l.taken_at) >= now() - make_interval(days => coalesce((v_cfg #>> '{pregnancy,negative_test_valid_days}')::integer, 30))
            and coalesce(l.specimen_collected_at, l.taken_at) <= now() + interval '1 day') then
      v_missing := v_missing || coalesce(v_cfg #>> '{pregnancy,label}', 'Pregnancy excluded');
    end if;
  end if;
  return v_missing;
end $$;
revoke all on function private.baseline_labs_missing(uuid, text) from public, anon, authenticated;

-- 4. The metformin kidney rule ----------------------------------------------------------------------------------------------------------
-- eGFR (CKD-EPI 2021) from the latest creatinine inside the window; null when it cannot be worked out (no result, no sex or age, or an unreadable unit).
create function private.baseline_labs_egfr(p_patient uuid, p_window_days integer) returns numeric
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_value numeric; v_unit text; v_sex text; v_dob date; v_age integer; v_scr numeric; v_female boolean; v_kappa numeric; v_alpha numeric;
begin
  select l.value, l.unit into v_value, v_unit from private.lab_analyte_readings_current l
   where l.patient_id = p_patient and l.code = 'creatinine' and l.value is not null
     and coalesce(l.specimen_collected_at, l.taken_at) >= now() - make_interval(days => p_window_days)
     and coalesce(l.specimen_collected_at, l.taken_at) <= now() + interval '1 day'
   order by coalesce(l.specimen_collected_at, l.taken_at) desc limit 1;
  if v_value is null or v_value <= 0 or v_unit is null then return null; end if;
  select p.sex::text, p.date_of_birth into v_sex, v_dob from public.profiles p where p.id = p_patient;
  if v_sex is null or v_dob is null then return null; end if;
  v_age := extract(year from age(v_dob))::integer;
  v_scr := case when v_unit ilike '%mol%' then v_value / 88.4 when v_unit ilike '%mg%' then v_value else null end;   -- mg/dL
  if v_scr is null then return null; end if;
  v_female := lower(v_sex) = 'female';
  v_kappa := case when v_female then 0.7 else 0.9 end;
  v_alpha := case when v_female then -0.241 else -0.302 end;
  return 142 * power(least(v_scr / v_kappa, 1), v_alpha) * power(greatest(v_scr / v_kappa, 1), -1.200) * power(0.9938, v_age) * case when v_female then 1.012 else 1 end;
end $$;
revoke all on function private.baseline_labs_egfr(uuid, integer) from public, anon, authenticated;

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = 'private.enforce_baseline_labs_rule()'::regprocedure;
  v_old := E'  v_ovr uuid;\nbegin';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'baseline labs v2: expected one declare block in enforce_baseline_labs_rule'; end if;
  v_def := replace(v_def, v_old, E'  v_ovr uuid;\n  v_egfr numeric;\nbegin');
  v_old := E'  v_missing := private.baseline_labs_missing(new.patient_id, new.drug_name);';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'baseline labs v2: expected one missing-labs call in enforce_baseline_labs_rule'; end if;
  v_new := E'  -- version 2: metformin is not started or raised when the kidney function is too low. No override: the CMO answered "do not start".\n'
        || E'  if jsonb_typeof(v_cfg -> ''egfr_rules'') = ''object'' and exists (select 1 from jsonb_array_elements_text(v_cfg -> ''egfr_rules'' -> ''name_patterns'') pat(p) where new.drug_name ilike pat.p) then\n'
        || E'    v_egfr := private.baseline_labs_egfr(new.patient_id, (v_cfg ->> ''recency_window_days'')::integer);\n'
        || E'    if v_egfr is not null and v_egfr < (v_cfg -> ''egfr_rules'' ->> ''do_not_start_below'')::numeric then\n'
        || E'      raise exception ''Metformin must not be started or raised: this patient''''s kidney function (eGFR about %) is under %. There is no override for this.'', round(v_egfr, 0), (v_cfg -> ''egfr_rules'' ->> ''do_not_start_below'')\n'
        || E'        using errcode = ''23514'', hint = ''baseline_labs_egfr'';\n'
        || E'    end if;\n'
        || E'  end if;\n' || v_old;
  execute replace(v_def, v_old, v_new);
end $$;

-- Self-check
do $$
begin
  if exists (select 1 from public.baseline_labs_rule_config where is_active or approved_at is not null) then raise exception 'baseline labs v2: a version is signed or active by a migration'; end if;
  if (select count(*) from public.baseline_labs_rule_config where version = 2) <> 1 then raise exception 'baseline labs v2: version 2 missing'; end if;
  if pg_get_functiondef('private.enforce_baseline_labs_rule()'::regprocedure) not ilike '%baseline_labs_egfr%' then raise exception 'baseline labs v2: the kidney rule is not in the trigger'; end if;
  if has_function_privilege('anon', 'public.mark_hba1c_unreliable(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.clear_hba1c_unreliable(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.baseline_labs_egfr(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.baseline_labs_missing(uuid,text)', 'EXECUTE') then raise exception 'baseline labs v2: a function is reachable by the wrong role'; end if;
end $$;
