-- S50b: religious-fasting SAFETY module (spec 6.13, Ramadan and Lent only) and personal glucose-response inputs (spec 6.11).
-- Founder decision S50-2: built end to end, go-live guards born OFF. Part C: this is NOT an intermittent-fasting feature; there is no timer and no
-- fasting programme, only a safety answer and a record that a person started a religious fast with their care team's knowledge.
--
-- LIVE COUNTS BEFORE (2026-10-21): no fasting table exists; care_plan_changes kind 'medication' is the existing signed-change path (S24) and is reused
-- unchanged, so there is no data-conversion step.
--
-- What this adds:
--   1. fasting_safety_config: versioned, PROPOSED, UNSIGNED, born INACTIVE. Unlike the activity gate, this gate can answer "may_fast_with_guidance",
--      which is permissive, so unsigned rules must NOT enforce: no signed config means the single "unavailable" answer.
--   2. private.fasting_gate_for(): the enforcing twin of packages/clinical fasting-safety.ts. It reads medicines, conditions (private.patient_conditions_current),
--      pregnancy/postpartum (the person's OWN record, inside this function only), the eating-disorder screen, age and recent triage events.
--   3. public.my_fasting_gate(): the only door. Every sensitive reason (pregnancy, age, type 1 diabetes, kidney disease, eating-disorder screen) and every
--      "not available yet" state return the SAME {"state":"unavailable"}, so the screen cannot reveal why.
--   4. The medicine timing plan is an ordinary S24 care_plan_changes row (kind 'medication', action 'change') whose proposal carries a "fasting" block.
--      A clinician proposes and signs it (INV-02), the person confirms it, the existing S24 engine applies it. THIS migration changes no medicine and
--      applies nothing; but a confirmed tagged change IS a medicine change in the S24 sense and stays on the record until another signed change reverts it (OQ-S50B-3).
--   5. fasting_plans: the record that a person started a fast. Insert only through start_fasting_plan(), and a BEFORE INSERT trigger re-runs the gate.
--   6. go-live guards fasting_safety and glucose_response_insights, both OFF.
--   7. public.my_glucose_series(): glucose readings (fingerstick now, CGM later) read through private.vitals_readings_current.

-- ---------------------------------------------------------------------------
-- 1. Governed configuration
-- ---------------------------------------------------------------------------
create function private.fasting_config_valid(p_config jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_outcome_names text[] := array['pregnancy', 'under_age', 'type1_diabetes', 'kidney_disease', 'eating_disorder', 'recent_red_event', 'recent_amber_event',
                                  'insulin', 'sulfonylurea', 'diabetes_medicines_unconfirmed'];
  v_match_names text[] := array['type1_diabetes', 'kidney_disease', 'eating_disorder', 'diabetes'];
  v_class_names text[] := array['insulin', 'sulfonylurea', 'other_diabetes'];
  v_name text;
  v_fast text;
  v_row jsonb;
begin
  -- Every test is written so a missing key makes it FALSE, never NULL (a NULL would fall through an IF and let a broken config through).
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return false; end if;
  if coalesce(jsonb_typeof(p_config -> 'safety'), '') <> 'object' or coalesce(jsonb_typeof(p_config -> 'calendar'), '') <> 'object' then return false; end if;
  if coalesce((p_config #>> '{safety,lookback,red_hours}')::numeric, 0) <= 0 or coalesce((p_config #>> '{safety,lookback,amber_hours}')::numeric, 0) <= 0 then return false; end if;
  -- a whole number of years, at least 18 (the gate casts it to an integer, so 18.5 must not be signable)
  if coalesce((p_config #>> '{safety,min_age_years}')::numeric, 0) < 18 or (p_config #>> '{safety,min_age_years}')::numeric <> trunc((p_config #>> '{safety,min_age_years}')::numeric) then return false; end if;
  if (select count(*) from jsonb_object_keys(coalesce(p_config #> '{safety,outcomes}', '{}'::jsonb))) <> array_length(v_outcome_names, 1) then return false; end if;
  foreach v_name in array v_outcome_names loop
    if not coalesce((p_config #>> array['safety', 'outcomes', v_name]) = any (array['not_advised', 'needs_clinician_plan']), false) then return false; end if;
  end loop;
  -- A red event is never softened: a floor the CMO cannot configure away.
  if p_config #>> '{safety,outcomes,recent_red_event}' <> 'not_advised' then return false; end if;
  if (select count(*) from jsonb_object_keys(coalesce(p_config #> '{safety,matches}', '{}'::jsonb))) <> array_length(v_match_names, 1) then return false; end if;
  foreach v_name in array v_match_names loop
    if coalesce(jsonb_typeof(p_config #> array['safety', 'matches', v_name, 'name_patterns']), '') <> 'array'
       or coalesce(jsonb_typeof(p_config #> array['safety', 'matches', v_name, 'icd10_prefixes']), '') <> 'array' then
      return false;
    end if;
    -- a condition match with nothing to match would silently switch its hard stop off
    if jsonb_array_length(p_config #> array['safety', 'matches', v_name, 'name_patterns']) + jsonb_array_length(p_config #> array['safety', 'matches', v_name, 'icd10_prefixes']) < 1 then
      return false;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(coalesce(p_config #> '{safety,medicine_classes}', '{}'::jsonb))) <> array_length(v_class_names, 1) then return false; end if;
  foreach v_name in array v_class_names loop
    v_row := p_config #> array['safety', 'medicine_classes', v_name, 'name_patterns'];
    if coalesce(jsonb_typeof(v_row), '') <> 'array' or jsonb_array_length(v_row) < 1 then return false; end if;
  end loop;
  foreach v_fast in array array['ramadan', 'lent'] loop
    v_row := p_config #> array['calendar', v_fast];
    if coalesce(jsonb_typeof(v_row), '') <> 'array' then return false; end if;
    if exists (select 1 from jsonb_array_elements(v_row) e
                where (e ->> 'start')::date is null or (e ->> 'end')::date is null or (e ->> 'end')::date < (e ->> 'start')::date) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.fasting_config_valid(jsonb) from public, anon, authenticated;

create table public.fasting_safety_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null check (private.fasting_config_valid(config)),
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null)
);
create unique index fasting_safety_config_one_active on public.fasting_safety_config (is_active) where is_active;
alter table public.fasting_safety_config enable row level security;
revoke all on public.fasting_safety_config from public, anon, authenticated;
grant select on public.fasting_safety_config to authenticated;
-- Not readable by a patient: the screen gets an answer from my_fasting_gate(), never the rules. Staff and admin can read them to review and sign.
create policy fasting_safety_config_read on public.fasting_safety_config for select to authenticated
  using (exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
         or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create trigger refuse_superseded_activation before update of is_active on public.fasting_safety_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- fasting-safety-config-begin
insert into public.fasting_safety_config (version, is_active, config, notes)
values (1, false, $json${
 "safety": {
  "lookback": {"red_hours": 72, "amber_hours": 72},
  "min_age_years": 18,
  "outcomes": {
   "pregnancy": "not_advised",
   "under_age": "not_advised",
   "type1_diabetes": "not_advised",
   "kidney_disease": "not_advised",
   "eating_disorder": "not_advised",
   "recent_red_event": "not_advised",
   "recent_amber_event": "needs_clinician_plan",
   "insulin": "needs_clinician_plan",
   "sulfonylurea": "needs_clinician_plan",
   "diabetes_medicines_unconfirmed": "needs_clinician_plan"
  },
  "matches": {
   "type1_diabetes": {"name_patterns": ["type 1", "type i diabetes", "t1dm", "insulin dependent", "insulin-dependent", "juvenile diabetes"], "icd10_prefixes": ["E10"]},
   "kidney_disease": {"name_patterns": ["kidney", "renal", "ckd", "nephro", "dialysis"], "icd10_prefixes": ["N17", "N18", "N19"]},
   "eating_disorder": {"name_patterns": ["anorexia", "bulimia", "eating disorder", "binge eating"], "icd10_prefixes": ["F50"]},
   "diabetes": {"name_patterns": ["diabet"], "icd10_prefixes": ["E10", "E11", "E13", "E14"]}
  },
  "medicine_classes": {
   "insulin": {"name_patterns": ["insulin", "glargine", "detemir", "degludec", "lispro", "aspart", "glulisine", "humulin", "mixtard", "novomix", "lantus", "levemir", "tresiba", "novorapid", "humalog", "toujeo", "novolin", "novolog", "admelog", "lyumjev", "semglee", "actrapid", "insulatard", "protaphane", "insuman", "basaglar", "apidra", "fiasp", "ryzodeg", "xultophy", "soliqua", "isophane", "biphasic"]},
   "sulfonylurea": {"name_patterns": ["glibenclamide", "glyburide", "glimepiride", "gliclazide", "glipizide", "tolbutamide", "chlorpropamide", "daonil", "amaryl", "diamicron", "glucotrol", "euglucon", "glibomet", "glucovance", "gliben", "glyburide", "glimiprid", "glynase", "minidiab", "diabeta", "micronase", "glibenese"]},
   "other_diabetes": {"name_patterns": ["metformin", "glucophage", "pioglitazone", "sitagliptin", "vildagliptin", "saxagliptin", "linagliptin", "gliptin", "empagliflozin", "dapagliflozin", "canagliflozin", "gliflozin", "acarbose", "repaglinide", "nateglinide", "liraglutide", "semaglutide", "dulaglutide", "exenatide", "tirzepatide", "janumet", "galvus", "januvia", "jardiance", "forxiga"]}
  }
 },
 "calendar": {
  "ramadan": [
   {"year": 2027, "start": "2027-02-08", "end": "2027-03-09"},
   {"year": 2028, "start": "2028-01-28", "end": "2028-02-26"}
  ],
  "lent": [
   {"year": 2027, "start": "2027-02-10", "end": "2027-03-27"},
   {"year": 2028, "start": "2028-03-01", "end": "2028-04-15"}
  ]
 }
}$json$::jsonb,
        'PROPOSED, unsigned and INACTIVE. The CMO owns every outcome, medicine name and condition match. Calendar dates are EXPECTED windows only (Ramadan follows the moon, local sighting decides): the person confirms the real dates locally, and any year not listed is "unknown until a person confirms locally". Until signed, no patient sees anything but the single unavailable answer.');
-- fasting-safety-config-end

create function public.sign_fasting_safety_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.fasting_safety_config where id = p_id) then raise exception 'Fasting safety config version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the fasting safety config'; end if;
  update public.fasting_safety_config set is_active = false where is_active and id <> p_id;
  update public.fasting_safety_config set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('fasting_safety_config.signed', 'fasting_safety_config', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_fasting_safety_config(uuid) from public, anon;
grant execute on function public.sign_fasting_safety_config(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Go-live guards (both OFF)
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('fasting_safety', 'Religious fasting safety (Ramadan and Lent)', 'Showing the fasting answer to patients and recording a fasting plan',
   'The Chief Medical Officer has signed the fasting safety rules; the wording on the fasting screen is approved; a doctor is on the rota to write medicine timing plans',
   'cmo', array['public.my_fasting_gate (database)', 'public.start_fasting_plan (database)', 'fasting_plans insert trigger (database)'],
   'The emergency guidance for a dangerous reading is never behind this guard.'),
  ('glucose_response_insights', 'Personal glucose-response insights', 'Showing a patient how their glucose readings sit around the meals they logged',
   'The Chief Medical Officer has confirmed the minimum sample count and the wording; a dietitian has reviewed the food groups',
   'cmo', array['public.my_glucose_series (database)'],
   'The meal log and the glucose log themselves are not behind this guard.')
on conflict (key) do nothing;

-- The conditions each guard needs before it can be switched on, added to the CURRENT private.go_live_conditions (raises if the fall-through anchor is
-- gone, never rewrites blindly), and the two conditions a person records, added to the attestable list.
create function private.s50b_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_key = 'glucose_response_insights' then
    return jsonb_build_array(
      private.go_live_cond('glucose_wording_confirmed', 'The Chief Medical Officer has confirmed the minimum number of paired meals and the wording shown to patients',
        private.go_live_attested(p_key, 'glucose_wording_confirmed'), 'attestation', null),
      private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  end if;
  return jsonb_build_array(
    private.go_live_cond('config_signed', 'The fasting safety rules are signed by the Chief Medical Officer',
      exists (select 1 from public.fasting_safety_config where is_active and approved_by is not null), 'data',
      (select 'version ' || version from public.fasting_safety_config where is_active and approved_by is not null)),
    private.go_live_cond('fasting_wording_approved', 'The Chief Medical Officer has approved the wording on the fasting screen',
      private.go_live_attested(p_key, 'fasting_wording_approved'), 'attestation', null),
    private.go_live_cond('timing_plan_rota', 'A doctor is on the rota to write and sign medicine timing plans before Ramadan or Lent',
      private.go_live_attested(p_key, 'timing_plan_rota'), 'attestation', null),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.s50b_go_live_conditions(text) from public, anon, authenticated, service_role;

do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%s50b_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the S50b branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor,
    E'\n  elsif p_key in (''fasting_safety'', ''glucose_response_insights'') then\n    return private.s50b_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
end $$;

do $patch$
declare
  v_def text := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  v_anchor constant text := $a$('bp_pattern_flag', 'pattern_is_clinician_only')$a$;  -- no trailing comma: the S07x rewrite ends the list here, later rewrites continue it
begin
  if position('fasting_wording_approved' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'attest_go_live_condition: anchor not found, refusing to rewrite' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $b$, ('fasting_safety', 'fasting_wording_approved'), ('fasting_safety', 'timing_plan_rota'), ('glucose_response_insights', 'glucose_wording_confirmed')$b$);
end $patch$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The gate
-- ---------------------------------------------------------------------------
create function private.fasting_gate_for(p_patient uuid, p_fast text, p_starts_on date default null, p_ends_on date default null, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg      jsonb;
  v_version  integer;
  v_today    date := (p_now at time zone 'Africa/Lagos')::date;
  v_starts   date;
  v_ends     date;
  v_dob      date;
  v_out      jsonb;
  v_blocks   text[] := '{}';
  v_covered  text[] := '{}';
  v_change_ids uuid[] := '{}';
  v_order    text[] := array['recent_red_event', 'pregnancy', 'under_age', 'type1_diabetes', 'kidney_disease', 'eating_disorder', 'recent_amber_event',
                             'insulin', 'sulfonylurea', 'diabetes_medicines_unconfirmed'];
  v_class    text;
  v_med      record;
  v_cover_id uuid;
  v_class_uncovered boolean;
  v_class_covered boolean;
  v_any_dm_med boolean;
  v_hard     boolean := false;
  v_plan     boolean := false;
  v_b        text;
  v_reason   text := 'none';
  v_decision text;
begin
  select c.config -> 'safety', c.version into v_cfg, v_version from public.fasting_safety_config c where c.is_active and c.approved_by is not null;
  if v_cfg is null or p_fast is null or p_fast not in ('ramadan', 'lent') then
    return jsonb_build_object('decision', 'not_advised', 'reason', 'rules_unavailable', 'blocks', jsonb_build_array('rules_unavailable'),
                              'covered', '[]'::jsonb, 'config_version', null, 'timing_change_ids', '[]'::jsonb);
  end if;
  v_starts := coalesce(p_starts_on, v_today);
  v_ends := coalesce(p_ends_on, v_starts);
  v_out := v_cfg -> 'outcomes';

  -- Recent triage events (the same table the activity gate reads).
  if exists (select 1 from public.triage_events te where te.patient_id = p_patient and te.grade = 'red'
              and te.created_at <= p_now and te.created_at >= p_now - (v_cfg #>> '{lookback,red_hours}')::numeric * interval '1 hour') then
    v_blocks := array_append(v_blocks, 'recent_red_event');
  end if;
  if exists (select 1 from public.triage_events te where te.patient_id = p_patient and te.grade = 'amber'
              and te.created_at <= p_now and te.created_at >= p_now - (v_cfg #>> '{lookback,amber_hours}')::numeric * interval '1 hour') then
    v_blocks := array_append(v_blocks, 'recent_amber_event');
  end if;

  -- Pregnant or in the postpartum year, from the person's OWN record (the same three places the nutrition-target gate reads). Never exposed by name.
  if coalesce((select p.is_pregnant from public.profiles p where p.id = p_patient), false)
     or exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p_patient and pp.is_pregnant)
     or exists (select 1 from public.reproductive_health_profiles rp where rp.patient_id = p_patient and rp.life_stage in ('pregnant', 'postpartum'))
     or exists (select 1 from public.postnatal_profiles np where np.patient_id = p_patient and np.delivery_date > (v_today - 365)) then
    v_blocks := array_append(v_blocks, 'pregnancy');
  end if;

  -- Age: an unknown date of birth fails closed.
  select p.date_of_birth into v_dob from public.profiles p where p.id = p_patient;
  if v_dob is null or v_dob > (v_today - make_interval(years => (v_cfg ->> 'min_age_years')::integer))::date then
    v_blocks := array_append(v_blocks, 'under_age');
  end if;

  -- Conditions.
  if exists (select 1 from private.patient_conditions_current pc where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
              and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_cfg #> '{matches,type1_diabetes}')) then
    v_blocks := array_append(v_blocks, 'type1_diabetes');
  end if;
  if exists (select 1 from private.patient_conditions_current pc where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
              and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_cfg #> '{matches,kidney_disease}')) then
    v_blocks := array_append(v_blocks, 'kidney_disease');
  end if;
  -- A positive screen, a recorded eating disorder, or a clinician's open nutrition hold (the same hold that withholds calorie targets).
  if exists (select 1 from public.obesity_ed_screens e where e.patient_id = p_patient and e.positive)
     or exists (select 1 from public.nutrition_target_holds h where h.patient_id = p_patient and h.cleared_at is null)
     or exists (select 1 from private.patient_conditions_current pc where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
                 and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_cfg #> '{matches,eating_disorder}')) then
    v_blocks := array_append(v_blocks, 'eating_disorder');
  end if;

  -- Medicines. A class block is cleared only by a CONFIRMED, clinician-signed S24 medicine change tagged for this fast whose applied prescription is
  -- the medicine the person is on now, and whose window covers the whole fast. Nothing else clears it.
  -- Is ANY recognised diabetes medicine recorded (insulin, a sulfonylurea or one of the safer classes)? A diabetes diagnosis with none cannot be told apart from
  -- an unrecorded insulin or sulfonylurea, so it needs a clinician. (An unrelated medicine on the list, such as a blood pressure tablet, proves nothing.)
  select exists (select 1 from public.medications m, jsonb_each(v_cfg -> 'medicine_classes') cls, jsonb_array_elements_text(cls.value -> 'name_patterns') pat
                  where m.patient_id = p_patient and m.is_active and m.superseded_at is null
                    and pat <> '' and position(lower(pat) in lower(coalesce(m.drug_name, ''))) > 0) into v_any_dm_med;
  foreach v_class in array array['insulin', 'sulfonylurea'] loop
    v_class_uncovered := false;
    v_class_covered := false;
    for v_med in
      select m.id, m.prescription_id from public.medications m
       where m.patient_id = p_patient and m.is_active and m.superseded_at is null
         and exists (select 1 from jsonb_array_elements_text(v_cfg #> array['medicine_classes', v_class, 'name_patterns']) pat
                      where pat <> '' and position(lower(pat) in lower(coalesce(m.drug_name, ''))) > 0)
    loop
      select c.id into v_cover_id from public.care_plan_changes c
       where c.patient_id = p_patient and c.kind = 'medication' and c.state = 'confirmed' and c.applied_at is not null
         and c.applied_prescription_id is not null and c.applied_prescription_id = v_med.prescription_id
         and c.proposal #>> '{fasting,fast}' = p_fast
         and (c.proposal #>> '{fasting,valid_from}')::date <= v_starts
         and (c.proposal #>> '{fasting,valid_to}')::date >= v_ends
         and (c.proposal #>> '{fasting,valid_to}')::date >= v_today
       order by c.signed_at desc limit 1;
      if v_cover_id is null then
        v_class_uncovered := true;
      else
        v_class_covered := true;
        v_change_ids := array_append(v_change_ids, v_cover_id);
      end if;
    end loop;
    if v_class_uncovered then
      v_blocks := array_append(v_blocks, v_class);
    elsif v_class_covered then
      v_covered := array_append(v_covered, v_class);
    end if;
  end loop;
  -- A diabetes diagnosis with no medicine recorded at all: we cannot tell whether insulin or a sulfonylurea is taken, so ask a clinician.
  if not v_any_dm_med and exists (select 1 from private.patient_conditions_current pc where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
                                 and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_cfg #> '{matches,diabetes}')) then
    v_blocks := array_append(v_blocks, 'diabetes_medicines_unconfirmed');
  end if;

  -- Order the blocks by priority; decide.
  select coalesce(array_agg(o order by array_position(v_order, o)), '{}') into v_blocks from unnest(v_order) o where o = any (v_blocks);
  foreach v_b in array v_blocks loop
    if v_out ->> v_b = 'not_advised' then v_hard := true; else v_plan := true; end if;
  end loop;
  v_decision := case when v_hard then 'not_advised' when v_plan then 'needs_clinician_plan' else 'may_fast_with_guidance' end;
  if cardinality(v_blocks) > 0 then v_reason := v_blocks[1]; end if;

  return jsonb_build_object('decision', v_decision, 'reason', v_reason, 'blocks', to_jsonb(v_blocks), 'covered', to_jsonb(v_covered),
                            'config_version', v_version, 'timing_change_ids', to_jsonb(v_change_ids));
end;
$$;
revoke all on function private.fasting_gate_for(uuid, text, date, date, timestamptz) from public, anon, authenticated;

-- The public door. The signed-in person about themselves, nobody else. ONE "unavailable" answer for: no signed rules, guard off, a sensitive reason,
-- an unknown fast. A caregiver or staff member calling this gets their own answer, never someone else's.
create function public.my_fasting_gate(p_fast text, p_starts_on date default null, p_ends_on date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v jsonb;
  v_sensitive text[] := array['pregnancy', 'under_age', 'type1_diabetes', 'kidney_disease', 'eating_disorder', 'rules_unavailable'];
  v_pub_blocks jsonb;
  v_win jsonb;
  v_cal jsonb := jsonb_build_object('status', 'unknown');
  v_cfg jsonb;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_s date := p_starts_on;
  v_e date := p_ends_on;
begin
  if v_uid is null or not private.go_live_guard_on('fasting_safety') then return jsonb_build_object('state', 'unavailable'); end if;
  -- Expected dates from config (the person always confirms the real ones locally). With no dates given the gate is asked about the WHOLE expected fast, so a
  -- timing plan that covers only today, or only part of it, is not reported as "covered" and then refused at start.
  select c.config -> 'calendar' into v_cfg from public.fasting_safety_config c where c.is_active and c.approved_by is not null;
  select e into v_win from jsonb_array_elements(coalesce(v_cfg -> p_fast, '[]'::jsonb)) e
   where (e ->> 'end')::date >= v_today order by (e ->> 'start')::date limit 1;
  if v_win is not null then
    v_cal := jsonb_build_object('status', 'expected', 'start', v_win ->> 'start', 'end', v_win ->> 'end');
    if v_s is null and v_e is null then
      v_s := greatest((v_win ->> 'start')::date, v_today);
      v_e := (v_win ->> 'end')::date;
    end if;
  end if;
  v := private.fasting_gate_for(v_uid, p_fast, v_s, v_e, now());
  if exists (select 1 from jsonb_array_elements_text(v -> 'blocks') b where b = any (v_sensitive)) then
    return jsonb_build_object('state', 'unavailable');
  end if;
  -- Public blocks keep the priority order of the private ones (first occurrence wins), so the reason is always the first block.
  select coalesce(jsonb_agg(x order by first_ord), '[]'::jsonb) into v_pub_blocks
    from (select case when t.b in ('insulin', 'sulfonylurea', 'diabetes_medicines_unconfirmed') then 'medicine_timing_plan_needed' else t.b end as x, min(t.ord) as first_ord
            from jsonb_array_elements_text(v -> 'blocks') with ordinality as t(b, ord) group by 1) s;


  return jsonb_build_object(
    'state', 'ok',
    'decision', v ->> 'decision',
    'reason', case when v ->> 'reason' in ('insulin', 'sulfonylurea', 'diabetes_medicines_unconfirmed') then 'medicine_timing_plan_needed' else v ->> 'reason' end,
    'blocks', v_pub_blocks,
    'has_timing_plan', jsonb_array_length(v -> 'covered') > 0,
    'calendar', v_cal,
    'timing_plans', (
      select coalesce(jsonb_agg(jsonb_build_object('summary', c.patient_summary, 'signed_at', c.signed_at, 'signed_by_name', d.full_name,
                                                  'valid_from', c.proposal #>> '{fasting,valid_from}', 'valid_to', c.proposal #>> '{fasting,valid_to}')
                                order by c.signed_at desc), '[]'::jsonb)
        from public.care_plan_changes c
        left join public.clinical_staff_directory d on d.profile_id = c.signed_by
       where c.id in (select (j)::uuid from jsonb_array_elements_text(v -> 'timing_change_ids') j)));
end;
$$;
revoke all on function public.my_fasting_gate(text, date, date) from public, anon;
grant execute on function public.my_fasting_gate(text, date, date) to authenticated;
comment on function public.my_fasting_gate(text, date, date) is
  'S50b / 6.13: the only way a patient receives a fasting answer. state unavailable (rules not signed, guard off, or any sensitive reason: indistinguishable) or ok with a decision. Never names a pregnancy, an age, a screen or a condition.';

-- The "fasting" tag on an S24 medicine change: only a START or a CHANGE of a medicine can carry it, for one of the two fasts, with a sane window.
-- (No existing row has the key, so there is nothing to validate or convert.)
alter table public.care_plan_changes add constraint care_plan_changes_fasting_tag_shape check (
  not (proposal ? 'fasting')
  or (kind = 'medication' and proposal ->> 'action' in ('start', 'change')
      and proposal #>> '{fasting,fast}' in ('ramadan', 'lent')
      and (proposal #>> '{fasting,valid_from}')::date <= (proposal #>> '{fasting,valid_to}')::date
      and (proposal #>> '{fasting,valid_to}')::date - (proposal #>> '{fasting,valid_from}')::date <= 120));

-- ---------------------------------------------------------------------------
-- 4. Fasting plans (the record that a person started a religious fast)
-- ---------------------------------------------------------------------------
create table public.fasting_plans (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  fast               text not null check (fast in ('ramadan', 'lent')),
  starts_on          date not null,
  ends_on            date not null,
  status             text not null default 'active' check (status in ('active', 'ended')),
  config_version     integer not null,
  gate_snapshot      jsonb not null,
  timing_change_ids  uuid[] not null default '{}',
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  ended_reason       text check (ended_reason in ('finished', 'stopped_by_person')),
  check (ends_on >= starts_on and ends_on - starts_on <= 60),
  check ((status = 'ended') = (ended_at is not null))
);
create unique index fasting_plans_one_active on public.fasting_plans (patient_id) where status = 'active';
create index fasting_plans_patient_idx on public.fasting_plans (patient_id, started_at desc);
alter table public.fasting_plans enable row level security;
revoke all on public.fasting_plans from public, anon, authenticated;
grant select on public.fasting_plans to authenticated;
create policy fasting_plans_owner_select on public.fasting_plans for select to authenticated using (patient_id = (select auth.uid()));
create policy fasting_plans_staff_select on public.fasting_plans for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
comment on table public.fasting_plans is
  'S50b / 6.13: a person started a religious fast (Ramadan or Lent). Written only by start_fasting_plan(); a trigger re-runs the safety gate on every insert. There is no timer and no fasting programme here.';

create function private.enforce_fasting_plan_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not private.go_live_guard_on('fasting_safety') then
    raise exception 'Fasting plans are not available yet. Please talk to your care team in the app.' using errcode = '42501';
  end if;
  -- A plan is for now or the near future: never one that has already ended, never more than about a year away.
  if new.ends_on < (now() at time zone 'Africa/Lagos')::date or new.starts_on > (now() at time zone 'Africa/Lagos')::date + 400 then
    raise exception 'We cannot start a fasting plan here. Please talk to your care team in the app first.' using errcode = '42501';
  end if;
  v := private.fasting_gate_for(new.patient_id, new.fast, new.starts_on, new.ends_on, now());
  -- One generic refusal for every reason, so the message cannot reveal a pregnancy, an age or a screen.
  if v ->> 'decision' is distinct from 'may_fast_with_guidance' then
    raise exception 'We cannot start a fasting plan here. Please talk to your care team in the app first.' using errcode = '42501';
  end if;
  new.config_version := (v ->> 'config_version')::integer;
  new.timing_change_ids := coalesce(array(select (j)::uuid from jsonb_array_elements_text(v -> 'timing_change_ids') j), '{}');
  new.gate_snapshot := jsonb_build_object('decision', v ->> 'decision', 'covered', v -> 'covered');
  return new;
end;
$$;
revoke all on function private.enforce_fasting_plan_gate() from public, anon, authenticated;
create trigger fasting_plans_gate before insert on public.fasting_plans for each row execute function private.enforce_fasting_plan_gate();

-- A plan is only ever ended, never re-opened or re-dated: a changed plan is a new insert, which re-runs the gate (the S48a enrolment trigger once missed this).
create function private.freeze_fasting_plan() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id or new.fast is distinct from old.fast
     or new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on or new.timing_change_ids is distinct from old.timing_change_ids
     or new.gate_snapshot is distinct from old.gate_snapshot or new.config_version is distinct from old.config_version or new.started_at is distinct from old.started_at then
    raise exception 'a fasting plan cannot be changed; end it and start a new one' using errcode = '42501';
  end if;
  if old.status = 'ended' then
    raise exception 'an ended fasting plan cannot be reopened' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.freeze_fasting_plan() from public, anon, authenticated;
create trigger fasting_plans_freeze before update on public.fasting_plans for each row execute function private.freeze_fasting_plan();

-- The person's own active plan, whatever the gate now says. It is separate from the gate on purpose: a person who becomes pregnant, or whose gate turns
-- to "unavailable", must still SEE the plan they started and be able to end it. It reveals nothing the person did not enter themselves.
create function public.my_fasting_plan() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when fp.id is null then null
              else jsonb_build_object('id', fp.id, 'fast', fp.fast, 'starts_on', fp.starts_on, 'ends_on', fp.ends_on) end
    from (select 1) one left join public.fasting_plans fp
      on fp.patient_id = (select auth.uid()) and fp.status = 'active' and fp.ends_on >= (now() at time zone 'Africa/Lagos')::date;
$$;
revoke all on function public.my_fasting_plan() from public, anon;
grant execute on function public.my_fasting_plan() to authenticated;

create function public.start_fasting_plan(p_fast text, p_starts_on date, p_ends_on date) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'We cannot start a fasting plan here. Please talk to your care team in the app first.' using errcode = '42501'; end if;
  -- A plan whose last day has passed is over: end it so it neither blocks the next fast nor shows the care team a person still fasting.
  update public.fasting_plans set status = 'ended', ended_at = now(), ended_reason = 'finished'
   where patient_id = v_uid and status = 'active' and ends_on < (now() at time zone 'Africa/Lagos')::date;
  begin
    -- config_version and gate_snapshot are filled by the gate trigger; the placeholders below are overwritten there.
    insert into public.fasting_plans (organisation_id, patient_id, fast, starts_on, ends_on, config_version, gate_snapshot)
    values (v_org, v_uid, p_fast, p_starts_on, p_ends_on, 0, '{}'::jsonb)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have a fasting plan running. End it first.' using errcode = '23505';
  end;
  perform private.log_audit('fasting_plan.started', 'fasting_plan', v_id, jsonb_build_object('fast', p_fast));
  return v_id;
end;
$$;
revoke all on function public.start_fasting_plan(text, date, date) from public, anon;
grant execute on function public.start_fasting_plan(text, date, date) to authenticated;

create function public.end_fasting_plan(p_reason text default 'stopped_by_person') returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_reason not in ('finished', 'stopped_by_person') then raise exception 'unknown reason' using errcode = '22023'; end if;
  update public.fasting_plans set status = 'ended', ended_at = now(), ended_reason = p_reason
   where patient_id = v_uid and status = 'active' returning id into v_id;
  if v_id is not null then perform private.log_audit('fasting_plan.ended', 'fasting_plan', v_id, jsonb_build_object('reason', p_reason)); end if;
end;
$$;
revoke all on function public.end_fasting_plan(text) from public, anon;
grant execute on function public.end_fasting_plan(text) to authenticated;

create function private.sweep_fasting_plans() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.fasting_plans set status = 'ended', ended_at = now(), ended_reason = 'finished'
   where status = 'active' and ends_on < (now() at time zone 'Africa/Lagos')::date;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function private.sweep_fasting_plans() from public, anon, authenticated;
select cron.schedule('fasting-plan-sweep', '31 1 * * *', $c$select private.sweep_fasting_plans()$c$);

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('fasting_plans', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('fasting_plans', 'patient_id', 'clinical_record', 'review', true, 'S50b. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Glucose series for the personal glucose-response insight (6.11)
-- ---------------------------------------------------------------------------
-- The only door to the readings the insight uses. Read through private.vitals_readings_current (corrections and superseded rows excluded). The pairing
-- itself is pure code in packages/clinical (glucose-response.ts) with its numbers in the PROPOSED registry, so the same rules run on web and mobile.
-- A CGM source stays dormant: its rows are labelled 'cgm' and the pairing config lists which sources it accepts (fingerstick only today).
create function public.my_glucose_series(p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_days integer := least(greatest(coalesce(p_days, 90), 1), 180);
begin
  -- The same "withheld" rule as nutrition targets (pregnancy, postpartum year, clinician hold, eating-disorder screen, under 18), same single answer.
  if v_uid is null or not private.go_live_guard_on('glucose_response_insights') or private.nutrition_targets_withheld(v_uid)
     or exists (select 1 from public.profiles p where p.id = v_uid and p.date_of_birth is null) then
    return jsonb_build_object('state', 'unavailable');
  end if;
  return jsonb_build_object('state', 'ok', 'readings', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'at', v.taken_at, 'mmol', v.glucose_mmol_l,
             'source', case v.source::text when 'manual' then 'fingerstick' when 'device' then 'fingerstick' when 'cgm' then 'cgm' else 'other' end,
             'context', v.glucose_context::text) order by v.taken_at), '[]'::jsonb)
      from private.vitals_readings_current v
     where v.patient_id = v_uid and v.vital_type = 'glucose' and v.glucose_mmol_l is not null
       and v.taken_at >= now() - make_interval(days => v_days)));
end;
$$;
revoke all on function public.my_glucose_series(integer) from public, anon;
grant execute on function public.my_glucose_series(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.fasting_safety_config where is_active) <> 0 then raise exception 'S50b: the fasting config must be born inactive'; end if;
  if (select private.fasting_config_valid(config) from public.fasting_safety_config where version = 1) is not true then raise exception 'S50b: the seeded config fails its own validator'; end if;
  if private.go_live_conditions('fasting_safety', null)::text not like '%config_signed%' then raise exception 'S50b: the fasting guard has no conditions'; end if;
  if private.go_live_conditions('glucose_response_insights', null)::text not like '%glucose_wording_confirmed%' then raise exception 'S50b: the glucose guard has no conditions'; end if;
  if (select is_on from public.go_live_guards where key = 'fasting_safety') is distinct from false then raise exception 'S50b: fasting_safety must be born off'; end if;
  if (select is_on from public.go_live_guards where key = 'glucose_response_insights') is distinct from false then raise exception 'S50b: glucose_response_insights must be born off'; end if;
  if has_function_privilege('anon', 'public.my_fasting_gate(text,date,date)', 'EXECUTE') then raise exception 'S50b: anon can call the fasting gate'; end if;
  if has_function_privilege('anon', 'public.start_fasting_plan(text,date,date)', 'EXECUTE') then raise exception 'S50b: anon can start a plan'; end if;
  if has_function_privilege('anon', 'public.my_fasting_plan()', 'EXECUTE') then raise exception 'S50b: anon can read a plan'; end if;
  if has_function_privilege('anon', 'public.end_fasting_plan(text)', 'EXECUTE') then raise exception 'S50b: anon can end a plan'; end if;
  if has_function_privilege('anon', 'public.my_glucose_series(integer)', 'EXECUTE') then raise exception 'S50b: anon can read the glucose series'; end if;
  if has_function_privilege('anon', 'public.sign_fasting_safety_config(uuid)', 'EXECUTE') then raise exception 'S50b: anon can sign'; end if;
  if has_function_privilege('authenticated', 'private.fasting_gate_for(uuid,text,date,date,timestamptz)', 'EXECUTE') then raise exception 'S50b: the unscoped fasting gate is callable by a client'; end if;
  if has_table_privilege('anon', 'public.fasting_plans', 'SELECT') then raise exception 'S50b: anon can read fasting plans'; end if;
  if has_table_privilege('authenticated', 'public.fasting_plans', 'INSERT') or has_table_privilege('authenticated', 'public.fasting_plans', 'UPDATE') then
    raise exception 'S50b: a client can write fasting plans directly';
  end if;
  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'S50b: minor guard gaps: %', (select string_agg(table_name || ' (' || problem || ')', ', ') from private.minor_guard_gaps());
  end if;
end $$;
