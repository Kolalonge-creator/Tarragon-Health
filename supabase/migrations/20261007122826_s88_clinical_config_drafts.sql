-- S88: six founder-approved clinical config items as versioned, UNSIGNED, governed config rows.
--
-- Source of every value: docs/plans/S88-S100-decisions-and-cmo-signoff-pack.md section 4 (items 4.1 to 4.6),
-- copied as written. Status of all six: the founder's recorded position, "CMO-approved 2026-10-07, pending
-- independent review; not signed". NOTHING here is signed or active, and nothing in this migration calls a
-- sign function. Every numeric value carries verify_against_source = true until the CMO confirms the source
-- document was opened. Anything the pack leaves to the CMO is an explicit JSON null plus a "cmo_to_supply" note.
--
-- Why ONE table (clinical_config_versions) and not six: the six items share one lifecycle (draft -> signed ->
-- retired), one sign RPC, one independent-review gate and one panel. The older governed tables each hold ONE
-- document with ONE live row; here there is one live row PER KIND (unique partial index), so these rows are
-- deliberately not walked by the generic single-live-row queue (which treats two live rows as corruption);
-- the sign-off queue reads this table through its own source. No organisation_id: like result_release_policies
-- and escalation_slas these are platform-wide governance ledgers, not tenant data.
--
-- Access: closed to the API for writes. No INSERT/UPDATE/DELETE grant, no write policy; rows enter by migration
-- and change only through the two SECURITY DEFINER RPCs below. SELECT: admin or the active Chief Medical Officer.
-- Guards live in small private helpers (stale, review-ok) so the proof script can sabotage each one on its own.
-- private.credential_is_cmo / private.is_admin live definitions were read with pg_get_functiondef on 2026-10-07,
-- not trusted from migration files.
--
-- anon: EXECUTE is revoked from PUBLIC (anon inherits through PUBLIC), then granted to authenticated only.

create table public.clinical_config_versions (
  id                    uuid primary key default gen_random_uuid(),
  config_kind           text not null check (config_kind in (
    'ai_copilot_acceptable_use',
    'hypertension_care_gap_rules',
    'glp1_readiness_protocol',
    'field_nurse_visit_scope',
    'diabetes_targets_and_triggers',
    'aggregate_reporting_small_cell'
  )),
  version               integer not null check (version >= 1),
  content               jsonb not null,
  sources               jsonb not null,
  verify_against_source boolean not null default true,
  founder_position      text not null default 'CMO-approved 2026-10-07, pending independent review; not signed',
  founder_position_date date not null default date '2026-10-07',
  notes                 text,
  status                text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  is_active             boolean generated always as (status = 'active') stored,
  approved_by           uuid references public.clinical_staff (id),
  approved_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (config_kind, version),
  check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) > 0),
  check (jsonb_typeof(content) = 'object'),
  -- A draft is never signed; anything else always carries a signature.
  check ((status = 'draft' and approved_by is null and approved_at is null)
      or (status <> 'draft' and approved_by is not null and approved_at is not null))
);

create unique index clinical_config_versions_one_active_per_kind
  on public.clinical_config_versions (config_kind) where status = 'active';

comment on table public.clinical_config_versions is
  'S88 governed clinical config ledger: one row per (kind, version). Rows enter by migration; sign_clinical_config_version is the only way to activate one. High-risk kinds need an approved independent review for the exact version.';

-- Per-kind content validation: required top-level keys. Immutable so it can sit in a CHECK.
create or replace function private.clinical_config_content_ok(p_kind text, p_content jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'ai_copilot_acceptable_use'      then p_content ?& array['may_draft','may_not','labelling','controls','shadow_mode']
    when 'hypertension_care_gap_rules'    then p_content ?& array['control_target','outreach_trigger','cadence','annual_labs','overdue_after_days','risk_score','notifications']
    when 'glp1_readiness_protocol'        then p_content ?& array['entry','hard_stops','refer_to_doctor_first','monitoring','authority','guard']
    when 'field_nurse_visit_scope'        then p_content ?& array['in_scope','excluded','safeguards','activation']
    when 'diabetes_targets_and_triggers'  then p_content ?& array['hba1c_target','triggers','measurement']
    when 'aggregate_reporting_small_cell' then p_content ?& array['min_cell','employer_min_enrolled','rules']
    else false
  end;
$$;

alter table public.clinical_config_versions
  add constraint clinical_config_versions_content_shape
  check (private.clinical_config_content_ok(config_kind, content));

create or replace function private.clinical_config_kind_is_high_risk(p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('ai_copilot_acceptable_use','hypertension_care_gap_rules','glp1_readiness_protocol','diabetes_targets_and_triggers');
$$;

-- Content, kind, version and sources never change after insert (a review is of THIS text).
create or replace function private.clinical_config_versions_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content or new.sources is distinct from old.sources
     or new.config_kind <> old.config_kind or new.version <> old.version then
    raise exception 'clinical_config_versions content is immutable; draft a new version instead' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger clinical_config_versions_freeze
  before update on public.clinical_config_versions
  for each row execute function private.clinical_config_versions_freeze();

create table public.independent_clinical_reviews (
  id                uuid primary key default gen_random_uuid(),
  config_version_id uuid not null references public.clinical_config_versions (id),
  reviewer_name     text not null check (length(btrim(reviewer_name)) > 0),
  mdcn_number       text not null check (length(btrim(mdcn_number)) > 0),
  reviewed_at       timestamptz not null,
  outcome           text not null check (outcome in ('approved', 'changes_requested')),
  note              text,
  recorded_by       uuid not null references auth.users (id),
  created_at        timestamptz not null default now()
);
create index independent_clinical_reviews_version_idx on public.independent_clinical_reviews (config_version_id);

comment on table public.independent_clinical_reviews is
  'S88 gate G1: an independent clinician''s review of one exact config version. Append-only; written only by record_independent_clinical_review.';

alter table public.clinical_config_versions enable row level security;
alter table public.independent_clinical_reviews enable row level security;

create policy clinical_config_versions_select on public.clinical_config_versions
  for select to authenticated using (private.is_admin() or private.credential_is_cmo());
create policy independent_clinical_reviews_select on public.independent_clinical_reviews
  for select to authenticated using (private.is_admin() or private.credential_is_cmo());

revoke all on public.clinical_config_versions from public, anon, authenticated;
revoke all on public.independent_clinical_reviews from public, anon, authenticated;
grant select on public.clinical_config_versions to authenticated;
grant select on public.independent_clinical_reviews to authenticated;

-- Guard helpers (separately replaceable so the proof can sabotage each alone).
create or replace function private.clinical_config_is_stale(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_config_versions t
    join public.clinical_config_versions o on o.config_kind = t.config_kind and o.id <> t.id
    where t.id = p_id and o.approved_at is not null and o.version > t.version
  );
$$;

create or replace function private.clinical_config_review_ok(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.independent_clinical_reviews r
    where r.config_version_id = p_id and r.outcome = 'approved'
  );
$$;

revoke all on function private.clinical_config_is_stale(uuid) from public;
revoke all on function private.clinical_config_review_ok(uuid) from public;
revoke all on function private.clinical_config_content_ok(text, jsonb) from public;
revoke all on function private.clinical_config_kind_is_high_risk(text) from public;
revoke all on function private.clinical_config_versions_freeze() from public;

create or replace function public.record_independent_clinical_review(
  p_config_version_id uuid,
  p_reviewer_name text,
  p_mdcn_number text,
  p_reviewed_at timestamptz,
  p_outcome text,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'not authorised: only an admin or the Chief Medical Officer can record an independent review' using errcode = '42501';
  end if;
  select status into v_status from public.clinical_config_versions where id = p_config_version_id;
  if v_status is null then
    raise exception 'Config version not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'A review can only be recorded against a draft version (this one is %)', v_status using errcode = '55000';
  end if;
  insert into public.independent_clinical_reviews
    (config_version_id, reviewer_name, mdcn_number, reviewed_at, outcome, note, recorded_by)
  values (p_config_version_id, p_reviewer_name, p_mdcn_number, p_reviewed_at, p_outcome, p_note, (select auth.uid()))
  returning id into v_id;
  perform private.log_audit('clinical_config_versions.review_recorded', 'clinical_config_versions', p_config_version_id,
    jsonb_build_object('review_id', v_id, 'outcome', p_outcome, 'reviewer_name', p_reviewer_name));
  return v_id;
end;
$$;

create or replace function public.sign_clinical_config_version(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_row public.clinical_config_versions%rowtype;
begin
  if not private.credential_is_cmo() then
    raise exception 'not authorised: only the active Chief Medical Officer can sign a clinical config version' using errcode = '42501';
  end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active'
     and cs.doctor_tier = 'chief_medical_officer' limit 1;

  select * into v_row from public.clinical_config_versions where id = p_id for update;
  if not found then
    raise exception 'Clinical config version not found';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Only a draft can be signed (this version is %)', v_row.status using errcode = '55000';
  end if;
  if private.clinical_config_is_stale(p_id) then
    raise exception 'Version % of % is older than a signed version. Draft a new version instead.', v_row.version, v_row.config_kind
      using errcode = '23514';
  end if;
  if private.clinical_config_kind_is_high_risk(v_row.config_kind) and not private.clinical_config_review_ok(p_id) then
    raise exception 'High-risk config % version % needs an approved independent clinical review for this exact version before it can be signed', v_row.config_kind, v_row.version
      using errcode = '55000';
  end if;

  update public.clinical_config_versions set status = 'retired'
   where config_kind = v_row.config_kind and status = 'active';
  update public.clinical_config_versions
     set status = 'active', approved_by = v_staff, approved_at = now()
   where id = p_id;

  perform private.log_audit('clinical_config_versions.signed', 'clinical_config_versions', p_id,
    jsonb_build_object('config_kind', v_row.config_kind, 'version', v_row.version, 'signed_by_clinical_staff', v_staff));
  return p_id;
end;
$$;

revoke all on function public.record_independent_clinical_review(uuid, text, text, timestamptz, text, text) from public;
revoke all on function public.sign_clinical_config_version(uuid) from public;
grant execute on function public.record_independent_clinical_review(uuid, text, text, timestamptz, text, text) to authenticated;
grant execute on function public.sign_clinical_config_version(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Six drafts, version 1, unsigned. Text and values from the pack, section 4.
-- ---------------------------------------------------------------------------
insert into public.clinical_config_versions (config_kind, version, content, sources, notes) values
('ai_copilot_acceptable_use', 1, $json$
{
  "may_draft": ["pre-visit brief", "task or order proposal", "reply to a patient message", "documentation-completeness check", "handoff summary"],
  "may_not": ["triage", "set or change a dose", "write to the record without the clinician's edit and signature", "send anything about symptoms, results or medicines", "act autonomously", "auto-send any message (founder decision)"],
  "labelling": "Every output is labelled AI-drafted until signed.",
  "controls": {
    "deterministic_red_flag_rules_before_any_model_call": true,
    "red_flag_invariant": "INV-01",
    "register_each_call_site_in_ai_systems": true,
    "route_through": "runGovernedAi()",
    "runtime_governed_default": false,
    "runtime_governed_until": "a real, human-run evaluation exists",
    "seed_evaluation_prompt_approval_or_knowledge_source_approval": false
  },
  "shadow_mode": {
    "min_weeks": 8,
    "min_reviewed_drafts": 200,
    "rule": "at least min_weeks AND at least min_reviewed_drafts, whichever is later",
    "cmo_reviews_before_go_live": ["edit rate", "every unsafe-draft report"],
    "unsafe_if_signed_is_logged_as": "AI safety incident",
    "unsafe_draft_pauses_go_live": true,
    "quote_only_own_measured_minutes_saved": true
  }
}
$json$, $json$[
 {"name": "WHO Ethics and Governance of AI for Health (2021)", "verification": "background_cmo_to_verify"},
 {"name": "WHO guidance on large multimodal models (2024)", "verification": "background_cmo_to_verify"},
 {"name": "EU AI Act post-market monitoring (international benchmark only)", "verification": "background_cmo_to_verify"},
 {"name": "ISO 14971 (medical-device risk management)", "verification": "background_cmo_to_verify"},
 {"name": "NDPA 2023 automated-decision safeguards", "verification": "register_title_only"},
 {"name": "MDCN: responsibility stays with the registered practitioner", "verification": "register_title_only"}
]$json$, 'Pack 4.1. High risk: needs an approved independent clinical review before signature.'),

('hypertension_care_gap_rules', 1, $json$
{
  "control_target": {
    "adult_on_treatment": {"clinic_below": {"systolic": 140, "diastolic": 90}, "home_average_below": {"systolic": 135, "diastolic": 85}},
    "stricter_individual_target_allowed": true,
    "stricter_example": {"systolic": 130, "diastolic": 80, "for": ["diabetes", "CKD", "prior stroke or coronary disease", "high risk"]},
    "stricter_target_must_record": ["clinician name", "reason"]
  },
  "outreach_trigger": {
    "creates": ["outreach task", "clinician medicine-review task"],
    "consecutive_readings_above_target": 3,
    "on_at_least_distinct_days": 2,
    "or_home_average_days": 7,
    "or_home_average_above_target": true,
    "severe_readings": "never handled here; existing deterministic red-flag and emergency rules handle them",
    "rules_change_medicines": false
  },
  "cadence": {
    "uncontrolled_or_newly_started": {"reading_every_days": 7, "review": "monthly until controlled"},
    "controlled": {"reading_every_days": 14, "review": "every 3 months"}
  },
  "annual_labs": ["creatinine/eGFR", "urine albumin-to-creatinine ratio", "lipids", "glucose or HbA1c", "electrolytes"],
  "overdue_after_days": {"reading": 7, "review": 14, "labs": 30},
  "risk_score": {
    "prevent_calculator": false,
    "total_risk": "clinician judgement recorded on the patient",
    "who_2019_cvd_chart_guard": "OFF until the coefficients are supplied and signed",
    "who_2019_cvd_chart_coefficients": null,
    "who_2019_cvd_chart_coefficients_note": "cmo_to_supply"
  },
  "notifications": {"name_the_condition": false, "name_any_reading": false, "invariant": "INV-07"}
}
$json$, $json$[
 {"name": "Nigeria national hypertension guidelines (2023-2028 edition)", "verification": "register_title_only"},
 {"name": "Nigerian Hypertension Society guidelines 2020", "verification": "register_title_only"},
 {"name": "ISH 2020 Global Hypertension Practice Guidelines", "verification": "background_cmo_to_verify"},
 {"name": "WHO 2021 guideline for pharmacological treatment of hypertension", "verification": "background_cmo_to_verify"},
 {"name": "WHO HEARTS technical package", "verification": "background_cmo_to_verify"},
 {"name": "2025 ACC/AHA high blood pressure guideline (noted, deliberately not adopted as the default)", "verification": "register_title_only"}
]$json$, 'Pack 4.2. High risk: needs an approved independent clinical review before signature.'),

('glp1_readiness_protocol', 1, $json$
{
  "entry": {
    "bmi_min": 30,
    "bmi_min_with_weight_related_complication": 27,
    "min_months_behavioural_programme": 3,
    "not_pregnant": true,
    "ancestry_specific_lower_bmi_cutoffs": null,
    "ancestry_specific_lower_bmi_cutoffs_note": "cmo_to_supply (left to the CMO in the pack)"
  },
  "hard_stops": ["pregnancy or planning pregnancy", "personal or family history of medullary thyroid cancer or MEN2", "known hypersensitivity"],
  "refer_to_doctor_first": ["prior pancreatitis", "gallbladder disease", "diabetic retinopathy", "eating disorder", "kidney disease", "insulin or sulfonylurea use", "age under 18 or over 75"],
  "monitoring": {
    "weight_and_bp": "monthly",
    "gi_tolerability": true,
    "hypoglycaemia_checks_with": ["insulin", "sulfonylureas"],
    "review_at_months": 3,
    "stop_and_review_rule": null,
    "stop_and_review_rule_note": "cmo_to_supply (named in the pack, text not given)",
    "contraception_counselling": true
  },
  "authority": {
    "initiation_dose_or_stop": "a signed clinician decision by a tier with initiating authority",
    "tarragon_sources_prices_compounds_or_delivers_the_drug": false,
    "supply": "only NAFDAC-registered product collected from a partner pharmacy",
    "suspected_falsified_product": "reported to NAFDAC"
  },
  "guard": {"name": "weight_programme_glp1_enabled", "ships": "OFF", "until": "a prescriber rota and partner-pharmacy supply route exist", "signing_does_not_flip_guards": true}
}
$json$, $json$[
 {"name": "WHO guideline on GLP-1 therapies for obesity in adults (1 Dec 2025, conditional recommendation)", "verification": "register_title_only"},
 {"name": "ADA Standards of Care in Diabetes 2026", "verification": "register_title_only"}
]$json$, 'Pack 4.3. High risk: needs an approved independent clinical review before signature.'),

('field_nurse_visit_scope', 1, $json$
{
  "in_scope": ["BP", "pulse", "SpO2", "temperature", "weight", "capillary glucose", "sample collection", "post-discharge checklist set by a clinician", "signed education content", "medicines only on a signed order from a registered prescriber for that patient and visit"],
  "excluded": ["injections", "wound care", "dressings", "any invasive procedure", "medicine delivery", "virtual ward"],
  "amendment_rule": "Injections can be added only by a separate signed amendment once indemnity, sharps handling and adverse-event capture exist.",
  "safeguards": {
    "red_readings": "deterministic triage and the page ladder",
    "patient_consent_recorded_before_each_visit": true,
    "nurse_verified_identity_shown_to_patient": true,
    "clinical_advice_beyond_signed_checklist": false
  },
  "activation": "Off until a contracted nurse partner and SLA exist."
}
$json$, $json$[
 {"name": "WHO task-shifting recommendations (2012)", "verification": "background_cmo_to_verify"},
 {"name": "WHO transitional-care guidance", "verification": "background_cmo_to_verify"},
 {"name": "NMCN scope of practice", "verification": "background_cmo_to_verify"},
 {"name": "MDCN duty of care", "verification": "register_title_only"},
 {"name": "NDPA 2023 consent", "verification": "register_title_only"}
]$json$, 'Pack 4.4. Medium risk.'),

('diabetes_targets_and_triggers', 1, $json$
{
  "hba1c_target": {
    "default_below_percent": 7.0,
    "relaxed_range_percent": [7.0, 8.0],
    "relaxed_for": ["older", "frail", "hypoglycaemia-prone", "limited life expectancy"],
    "set_per_patient_by": "a named clinician with a reason"
  },
  "triggers": {
    "creates": "a medicines-review task, never a dose change",
    "hba1c_above_individual_target_at_months": 3,
    "home_fasting_glucose_above": {"mmol_l": 7.2, "mg_dl": 130, "readings": 3, "within_days": 7},
    "reading_below_same_day_review": {"mmol_l": 3.9, "mg_dl": 70},
    "reading_below_urgent_triage": {"mmol_l": 3.0, "mg_dl": 54, "via": "existing deterministic glucose rules"}
  },
  "measurement": {"fingerstick_and_laboratory_hba1c_only": true, "cgm": "dormant"}
}
$json$, $json$[
 {"name": "ADA Standards of Care in Diabetes 2026", "verification": "register_title_only"},
 {"name": "IDF Clinical Practice Recommendations", "verification": "background_cmo_to_verify"},
 {"name": "WHO PEN essential NCD package", "verification": "background_cmo_to_verify"}
]$json$, 'Pack 4.5. High risk: needs an approved independent clinical review before signature.'),

('aggregate_reporting_small_cell', 1, $json$
{
  "min_cell": 10,
  "applies_to": ["HMO", "NGO", "other partners"],
  "employer_min_enrolled": 50,
  "rules": {
    "no_aggregate_for_group_under_min_cell": true,
    "cells_cannot_be_derived_by_subtraction": true,
    "employers_never_see": ["reproductive", "pregnancy", "mental-health data"],
    "individual_drill_down": "superadmin only (I9)",
    "every_partner_report_is_logged": true
  }
}
$json$, $json$[
 {"name": "NDPA 2023 minimisation and sensitive-data rules", "verification": "register_title_only"},
 {"name": "Statistical-disclosure practice", "verification": "background_cmo_to_verify"},
 {"name": "WHO data-sharing principles", "verification": "background_cmo_to_verify"}
]$json$, 'Pack 4.6. Medium risk.');

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.clinical_config_versions where version = 1 and status = 'draft'
     and approved_by is null and approved_at is null and verify_against_source;
  if v_n <> 6 then raise exception 'FAIL: expected 6 unsigned v1 drafts, found %', v_n; end if;
  if exists (select 1 from public.clinical_config_versions where status <> 'draft' or approved_at is not null) then
    raise exception 'FAIL: a seeded row is signed or active';
  end if;
  if exists (select 1 from public.clinical_config_versions where is_active) then
    raise exception 'FAIL: a seeded row is active';
  end if;
  if has_function_privilege('anon', 'public.sign_clinical_config_version(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_independent_clinical_review(uuid,text,text,timestamptz,text,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute a S88 RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.sign_clinical_config_version(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute the sign RPC';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_config_versions', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_config_versions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_config_versions', 'DELETE')
     or has_table_privilege('authenticated', 'public.independent_clinical_reviews', 'INSERT')
     or has_table_privilege('authenticated', 'public.independent_clinical_reviews', 'UPDATE')
     or has_table_privilege('authenticated', 'public.independent_clinical_reviews', 'DELETE')
     or has_table_privilege('anon', 'public.clinical_config_versions', 'SELECT') then
    raise exception 'FAIL: the API can write (or anon can read) a S88 table';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.clinical_config_versions'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.independent_clinical_reviews'::regclass) then
    raise exception 'FAIL: RLS not enabled';
  end if;
end $$;
