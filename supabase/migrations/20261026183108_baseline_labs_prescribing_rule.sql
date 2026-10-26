-- Baseline-labs prescribing rule: the CMO-owned check that a doctor has recent baseline labs on file before STARTING or INCREASING the dose of a
-- blood-pressure-lowering or glucose-lowering medicine.
-- Source of the requirement: docs/DECISIONS.md, 2026-10-21 (three-tier Membership ladder), go-live condition (2): "a CMO-owned baseline-labs
-- prescribing rule (baseline kidney function and potassium, glucose, HbA1c if diabetic, before starting or uptitrating a BP or glucose-lowering
-- drug), signed by the independent CMO and never by an agent". Amended 2026-10-26 (docs/DECISIONS.md): the separate independent-CMO condition was removed; the Chief Medical Officer of record signs, and never an agent.
--
-- WHAT THIS ADDS (it changes no stored patient row and, until the CMO signs, changes no behaviour for anyone):
--   1. baseline_labs_rule_config: versioned, PROPOSED, born UNSIGNED and INACTIVE (same shape as outcome_cascade_config, WP3). Only
--      public.sign_baseline_labs_rule_config(), callable only by the Chief Medical Officer, activates a version. Mirrored in the code registry
--      as `prescribing.baseline_labs_rule` (drift test).
--   2. private.baseline_labs_missing(patient, drug): the lab names still missing. Empty when no signed active rule exists, when the drug is not in
--      the rule's two groups, or when everything required is on file inside the window.
--   3. A BEFORE INSERT / BEFORE UPDATE OF dose trigger on public.medications that refuses (23514) a clinician or specialist start, or a dose
--      increase, when labs are missing. COMPLETE NO-OP while no signed active version exists. Patient self-reported medicines (source = 'patient'),
--      imports (source = 'fhir_import'), stopped rows and dose decreases are never blocked. No bypass flag in v1.
--
-- Counts before this migration (live, koiplnmbgnqnbywhpjlf, 2026-10-26): no baseline_labs_rule_config table, no such trigger; nothing to convert.
-- lab_analyte_readings holds no rows yet live, so the first time the rule is signed every start will be refused until labs exist: the CMO sees this in the panel.

create table public.baseline_labs_rule_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  owner          text not null default 'CMO',
  effective_from date not null,
  config         jsonb not null check (jsonb_typeof(config) = 'object'),
  note           text,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint baseline_labs_rule_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index baseline_labs_rule_config_one_active on public.baseline_labs_rule_config (is_active) where is_active;
create index baseline_labs_rule_config_approved_by_idx on public.baseline_labs_rule_config (approved_by) where approved_by is not null;
alter table public.baseline_labs_rule_config enable row level security;
revoke all on public.baseline_labs_rule_config from public, anon, authenticated;
grant select on public.baseline_labs_rule_config to authenticated;
create policy baseline_labs_rule_config_read on public.baseline_labs_rule_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.baseline_labs_rule_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'baseline_labs_rule_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'a baseline labs rule is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.config is distinct from old.config or new.version is distinct from old.version then
    raise exception 'a baseline labs rule is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed rule keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.baseline_labs_rule_config_guard() from public, anon, authenticated;
create trigger baseline_labs_rule_config_guard before insert or update or delete on public.baseline_labs_rule_config
  for each row execute function private.baseline_labs_rule_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.baseline_labs_rule_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- baseline-labs-rule-v1-begin
insert into public.baseline_labs_rule_config (version, is_active, effective_from, config, note) values (1, false, '2026-10-26', $json$
{
  "applies_to": {
    "start_new_medicine": true,
    "dose_increase": true,
    "sources_checked": ["clinician", "specialist"],
    "sources_never_checked": ["patient", "fhir_import"],
    "note": "Checked when a doctor starts one of these medicines, or increases its dose. A person recording a medicine they already take, an imported record, a stopped medicine and a dose that stays the same or goes down are never checked."
  },
  "drug_classes": {
    "bp_lowering": {
      "label": "Blood-pressure-lowering medicines",
      "name_patterns": ["%losartan%", "%telmisartan%", "%valsartan%", "%irbesartan%", "%candesartan%", "%olmesartan%", "%azilsartan%", "%ramipril%", "%lisinopril%", "%enalapril%", "%perindopril%", "%captopril%", "%benazepril%", "%fosinopril%", "%quinapril%", "%amlodipine%", "%nifedipine%", "%felodipine%", "%lercanidipine%", "%nitrendipine%", "%hydrochlorothiazide%", "%hctz%", "%indapamide%", "%bendroflumethiazide%", "%chlortalidone%", "%chlorthalidone%", "%spironolactone%", "%amiloride%", "%eplerenone%", "%moduretic%"]
    },
    "glucose_lowering": {
      "label": "Glucose-lowering medicines",
      "name_patterns": ["%metformin%", "%gliclazide%", "%glibenclamide%", "%glimepiride%", "%sitagliptin%", "%vildagliptin%", "%linagliptin%", "%empagliflozin%", "%dapagliflozin%", "%pioglitazone%", "%insulin%", "%liraglutide%", "%semaglutide%"]
    },
    "note": "The blood-pressure group uses exactly the medicine names the existing blood-pressure prescribing safety check already recognises (ACE inhibitors, ARBs, calcium channel blockers, thiazide-type and potassium-sparing diuretics). Beta blockers, alpha blockers, methyldopa, hydralazine and loop diuretics are NOT in this version. The glucose group is the glucose-lowering medicines named elsewhere in the platform. To add a medicine, the CMO asks for a new version."
  },
  "required_baseline": {
    "for_every_medicine_in_both_groups": ["kidney_function", "potassium", "glucose"],
    "additionally_if_diabetes_on_record": ["hba1c"],
    "analytes": {
      "kidney_function": { "label": "Kidney function (creatinine or eGFR)", "analyte_codes": ["creatinine"], "note": "Creatinine is the stored kidney-function result; eGFR is calculated from it, so a recent creatinine counts." },
      "potassium": { "label": "Potassium", "analyte_codes": ["potassium"] },
      "glucose": { "label": "Glucose", "analyte_codes": ["fasting_glucose", "random_glucose"], "note": "A laboratory glucose result (fasting or random). A glucose the patient logged at home does not count." },
      "hba1c": { "label": "HbA1c", "analyte_codes": ["hba1c"] }
    },
    "diabetes_on_record": {
      "icd10_prefixes": ["E10", "E11", "E13", "E14"],
      "statuses": ["active", "controlled", "uncontrolled"],
      "note": "Diabetes is taken from the patient's problem list (the same ICD-10 prefixes and statuses the cascade of care uses). A person starting a glucose-lowering medicine with no diabetes entry on the list does not need an HbA1c under this version."
    }
  },
  "recency_window_days": 90,
  "recency_window_note": "PROPOSED: 90 days. A result counts only if the specimen was collected (or the result dated) within this many days before the medicine is started or the dose is raised. The CMO may change this by asking for a new version before signing.",
  "when_labs_are_missing": {
    "action": "refuse",
    "bypass_available": false,
    "message": "The start or dose increase is refused and the doctor sees which labs are missing. The doctor orders them and tries again once the results are on file.",
    "bypass_note": "Version 1 has no bypass or override. If the CMO wants an emergency or clinician-override route, that is a new version."
  },
  "informational": {
    "membership": "Membership includes doctor-ordered baseline labs at the member price, paid separately. This note changes nothing in the check."
  },
  "proposed_note": "Every clinical value here is PROPOSED (the two medicine groups, the required labs, the 90-day window, refuse with no bypass). Nothing applies until the Chief Medical Officer signs. No agent signs."
}
$json$::jsonb, 'PROPOSED, v1, UNSIGNED, INACTIVE. Owner: CMO. Baseline-labs prescribing rule: kidney function, potassium and glucose (plus HbA1c if diabetic), within 90 days, before starting or raising the dose of a blood-pressure-lowering or glucose-lowering medicine. No effect until the CMO signs.');
-- baseline-labs-rule-v1-end

create function public.sign_baseline_labs_rule_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.baseline_labs_rule_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the baseline labs prescribing rule' using errcode = '42501'; end if;
  select * into c from public.baseline_labs_rule_config where version = p_version for update;
  if not found then raise exception 'no such baseline labs rule version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.baseline_labs_rule_config set is_active = false where is_active and version <> p_version;
  update public.baseline_labs_rule_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'baseline_labs_rule_config.signed',
            'baseline_labs_rule_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_baseline_labs_rule_config(integer) from public, anon, authenticated;
grant execute on function public.sign_baseline_labs_rule_config(integer) to authenticated;

-- The active, signed version (null while the CMO has not signed anything).
create function private.baseline_labs_rule() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config || jsonb_build_object('_version', version) from public.baseline_labs_rule_config where is_active and approved_at is not null order by version desc limit 1 $$;
revoke all on function private.baseline_labs_rule() from public, anon, authenticated;

-- Does this drug name belong to either group of the given rule?
create function private.baseline_labs_drug_in_scope(p_cfg jsonb, p_drug text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_cfg is not null and p_drug is not null and exists (
    select 1
      from jsonb_each(p_cfg -> 'drug_classes') g(grp, body)
     cross join lateral jsonb_array_elements_text(case when jsonb_typeof(g.body) = 'object' then g.body -> 'name_patterns' else '[]'::jsonb end) pat(p)
     where p_drug ilike pat.p)
$$;
revoke all on function private.baseline_labs_drug_in_scope(jsonb, text) from public, anon, authenticated;

-- The labs still missing (display labels), in the order they are required. Empty array = nothing missing OR no signed rule OR the drug is out of scope.
create function private.baseline_labs_missing(p_patient uuid, p_drug text) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.baseline_labs_rule();
  v_window integer;
  v_diabetic boolean;
  v_keys text[];
  v_key text;
  v_missing text[] := '{}';
  v_codes text[];
begin
  if v_cfg is null or not private.baseline_labs_drug_in_scope(v_cfg, p_drug) then return '{}'; end if;
  v_window := (v_cfg ->> 'recency_window_days')::integer;
  select array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'for_every_medicine_in_both_groups')) into v_keys;
  v_diabetic := exists (
    select 1 from private.patient_conditions_current pc
     where pc.patient_id = p_patient
       and pc.status::text in (select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'diabetes_on_record' -> 'statuses'))
       and exists (select 1 from jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'diabetes_on_record' -> 'icd10_prefixes') x
                    where upper(coalesce(pc.icd10_code, '')) like x || '%'));
  if v_diabetic then
    v_keys := v_keys || array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'additionally_if_diabetes_on_record'));
  end if;
  foreach v_key in array v_keys loop
    select array(select jsonb_array_elements_text(v_cfg -> 'required_baseline' -> 'analytes' -> v_key -> 'analyte_codes')) into v_codes;
    if not exists (
      select 1 from private.lab_analyte_readings_current l
       where l.patient_id = p_patient and l.code = any (v_codes)
         and coalesce(l.specimen_collected_at, l.taken_at) >= now() - make_interval(days => v_window)
         and coalesce(l.specimen_collected_at, l.taken_at) <= now() + interval '1 day') then
      v_missing := v_missing || coalesce(v_cfg -> 'required_baseline' -> 'analytes' -> v_key ->> 'label', v_key);
    end if;
  end loop;
  return v_missing;
end $$;
revoke all on function private.baseline_labs_missing(uuid, text) from public, anon, authenticated;

-- First number group of each token, compared pairwise with the units. True only when we can SHOW the dose did not go up.
create function private.dose_not_increased(p_old text, p_new text) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  o numeric[]; n numeric[]; i integer;
  ou text; nu text;
begin
  if p_old is null or p_new is null then return false; end if;
  if lower(btrim(p_old)) = lower(btrim(p_new)) then return true; end if;
  select array_agg(m[1]::numeric order by ord) into o from regexp_matches(p_old, '([0-9]+(?:\.[0-9]+)?)', 'g') with ordinality as t(m, ord);
  select array_agg(m[1]::numeric order by ord) into n from regexp_matches(p_new, '([0-9]+(?:\.[0-9]+)?)', 'g') with ordinality as t(m, ord);
  if o is null or n is null or cardinality(o) <> cardinality(n) then return false; end if;
  ou := lower(coalesce((regexp_match(p_old, '[0-9.]\s*([a-zA-Z]+)'))[1], ''));
  nu := lower(coalesce((regexp_match(p_new, '[0-9.]\s*([a-zA-Z]+)'))[1], ''));
  if ou <> nu then return false; end if;
  for i in 1 .. cardinality(o) loop
    if n[i] > o[i] then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.dose_not_increased(text, text) from public, anon, authenticated;

-- Times per day a free-text frequency stands for, or null when it cannot be read. Only used to SHOW a frequency did not go up.
create function private.frequency_per_day(p_text text) returns integer
language sql immutable set search_path = ''
as $$
  select case
    when t ~ '\m(four times|4 times|4x|qds|qid|q6h)\M' then 4
    when t ~ '\m(three times|3 times|3x|tds|tid|q8h)\M' then 3
    when t ~ '\m(twice|two times|2 times|2x|bd|bid|q12h)\M' then 2
    when t ~ '\m(once|daily|od|nocte|mane|every morning|every night)\M' then 1
    else null end
  from (select lower(coalesce(p_text, '')) as t) x
$$;
revoke all on function private.frequency_per_day(text) from public, anon, authenticated;

-- True only when we can SHOW the frequency did not go up (same text, or both readable and not higher).
create function private.frequency_not_increased(p_old text, p_new text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(lower(btrim(p_old)) = lower(btrim(p_new)), p_old is null and p_new is null)
      or (private.frequency_per_day(p_old) is not null and private.frequency_per_day(p_new) is not null
          and private.frequency_per_day(p_new) <= private.frequency_per_day(p_old))
$$;
revoke all on function private.frequency_not_increased(text, text) from public, anon, authenticated;

create function private.enforce_baseline_labs_rule() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.baseline_labs_rule();
  v_prev public.medications%rowtype;
  v_missing text[];
begin
  if v_cfg is null then return new; end if;                                   -- no signed rule: complete no-op
  if new.is_active is not true or new.source::text not in (select jsonb_array_elements_text(v_cfg -> 'applies_to' -> 'sources_checked')) then return new; end if;
  if not private.baseline_labs_drug_in_scope(v_cfg, new.drug_name) then return new; end if;

  if tg_op = 'UPDATE' then
    -- a restart (stopped to active) or a different drug is a START; otherwise only a higher dose or frequency is an uptitration
    if old.is_active is true and old.drug_name is not distinct from new.drug_name then
      if new.dose is not distinct from old.dose and new.frequency is not distinct from old.frequency then return new; end if;
      if private.dose_not_increased(old.dose, new.dose) and private.frequency_not_increased(old.frequency, new.frequency) then return new; end if;
    end if;
  elsif new.previous_version_id is not null then                              -- an amendment inserts a new version of an existing prescription
    select * into v_prev from public.medications where id = new.previous_version_id;
    if v_prev.id is not null and v_prev.drug_name is not distinct from new.drug_name
       and private.dose_not_increased(v_prev.dose, new.dose) and private.frequency_not_increased(v_prev.frequency, new.frequency) then return new; end if;
  end if;

  v_missing := private.baseline_labs_missing(new.patient_id, new.drug_name);
  if cardinality(v_missing) > 0 then
    raise exception 'Baseline labs missing: % (a result from the last % days is needed). Order them, and start or increase this medicine once the results are on file.',
      array_to_string(v_missing, ', '), (v_cfg ->> 'recency_window_days')
      using errcode = '23514', hint = 'baseline_labs_rule';
  end if;
  return new;
end $$;
revoke all on function private.enforce_baseline_labs_rule() from public, anon, authenticated;
create trigger medications_c_baseline_labs_rule before insert or update of dose, frequency, is_active, drug_name on public.medications
  for each row execute function private.enforce_baseline_labs_rule();

-- Self-check
do $$
begin
  if has_function_privilege('anon', 'public.sign_baseline_labs_rule_config(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.baseline_labs_missing(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.baseline_labs_missing(uuid,text)', 'EXECUTE') then
    raise exception 'baseline labs rule: a function is reachable by anon or authenticated';
  end if;
  if has_table_privilege('anon', 'public.baseline_labs_rule_config', 'SELECT') or has_table_privilege('authenticated', 'public.baseline_labs_rule_config', 'INSERT,UPDATE,DELETE') then
    raise exception 'baseline labs rule: baseline_labs_rule_config is reachable';
  end if;
  if exists (select 1 from public.baseline_labs_rule_config where is_active or approved_at is not null) then
    raise exception 'baseline labs rule: a version is signed or active by a migration';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'medications_c_baseline_labs_rule' and tgrelid = 'public.medications'::regclass) then
    raise exception 'baseline labs rule: trigger missing';
  end if;
end $$;
