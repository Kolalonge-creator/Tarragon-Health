-- Baseline labs before starting or increasing a blood pressure or glucose-lowering medicine (CMO rule, docs/design/baseline-labs-rule-proposal.md).
-- Answers recorded 2026-10-27/28: thresholds as drafted; the prescribing doctor may start before results and records why (the existing safety
-- override reason); fasting glucose replaces HbA1c when the doctor marks the patient's HbA1c as unreliable; a calcium channel blocker alone needs no blood test.
--
--   1. baseline_labs_config: the rule as VERSIONED configuration, born UNSIGNED and INACTIVE. Only the Chief Medical Officer's
--      sign_baseline_labs_config() activates a version. Until then the check is OFF (it adds no finding). An agent never signs it.
--   2. The check: private.baseline_labs_findings() adds findings to the existing prescribing safety check (private.prescription_safety_findings),
--      so prescribe_medication, amend_medication and sign_care_plan_change all get it. A missing test needs the doctor's reason to go ahead
--      (same override as an allergy finding); a metformin start with eGFR under 30 is BLOCKED with no override. An amendment is checked only when
--      the dose or the medicine changes. A result counts only if it is a numeric value filed in lab_results within the freshness window and not
--      withdrawn or superseded; a picture or an unfilled draft counts as MISSING.
--   3. hba1c_exceptions + mark/clear RPCs: the doctor marks a patient whose HbA1c is unreliable (sickle cell trait or disease, recent transfusion,
--      anaemia); the rule then accepts fasting glucose in its place.
--   4. check_prescription_safety: a blocking finding other than a controlled medicine gets its own message, and a signed prescription records the date
--      the missing tests are due (7 days) in its checks.
-- Not built here: the repeat creatinine and potassium 1 to 2 weeks after starting an ACE inhibitor or ARB is part of the signed wording but is
-- not enforced or scheduled by this migration.
-- ROLLBACK: restore prescription_safety_findings / check_prescription_safety / amend_medication from their previous definitions (the patches are
-- small additions), drop the functions and tables created below.

-- 1. Configuration ----------------------------------------------------------------------------------------------------------------
create table public.baseline_labs_config (
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
  constraint baseline_labs_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index baseline_labs_config_one_active on public.baseline_labs_config (is_active) where is_active;
create index baseline_labs_config_approved_by_idx on public.baseline_labs_config (approved_by) where approved_by is not null;
alter table public.baseline_labs_config enable row level security;
revoke all on public.baseline_labs_config from public, anon, authenticated;
grant select on public.baseline_labs_config to authenticated;
create policy baseline_labs_config_read on public.baseline_labs_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.baseline_labs_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'baseline_labs_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'a baseline labs config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.config is distinct from old.config or new.version is distinct from old.version then
    raise exception 'a baseline labs config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.baseline_labs_config_guard() from public, anon, authenticated;
create trigger baseline_labs_config_guard before insert or update or delete on public.baseline_labs_config
  for each row execute function private.baseline_labs_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.baseline_labs_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- baseline-labs-v1-begin
insert into public.baseline_labs_config (version, is_active, effective_from, config, note) values (1, false, '2026-10-28', $json$
{
  "freshness_months": 12,
  "tests_due_days": 7,
  "repeat_after_start_days": { "from": 7, "to": 14, "tests": ["creatinine", "potassium"], "applies_to": ["acei", "arb"], "enforced": false },
  "egfr": { "metformin_do_not_start_below": 30, "metformin_review_dose_below": 45 },
  "pregnancy": { "classes": ["acei", "arb", "statin"], "age_from": 12, "age_to": 50, "negative_test_valid_days": 30 },
  "classes": {
    "acei": { "label": "ACE inhibitor", "requires": ["creatinine", "potassium", "sodium"] },
    "arb": { "label": "ARB", "requires": ["creatinine", "potassium", "sodium"] },
    "thiazide": { "label": "Thiazide-type diuretic", "requires": ["creatinine", "potassium", "sodium", "glucose_or_hba1c"] },
    "ccb": { "label": "Calcium channel blocker", "requires": [] },
    "beta_blocker": { "label": "Beta blocker", "requires": [] },
    "metformin": { "label": "Metformin", "requires": ["creatinine", "glucose_or_hba1c"] },
    "sulfonylurea": { "label": "Sulfonylurea", "requires": ["creatinine", "hba1c", "fasting_glucose"] },
    "insulin": { "label": "Insulin", "requires": ["creatinine", "hba1c", "fasting_glucose"] },
    "statin": { "label": "Statin", "requires": [] }
  },
  "hba1c_unreliable_conditions": ["sickle cell trait or disease", "recent transfusion", "anaemia"],
  "notes": {
    "unreadable": "A result that cannot be read (a picture, or a draft a doctor has not filed) counts as missing, never as passed.",
    "emergency": "The check never blocks emergency care and never applies to the Free-tier safety guidance.",
    "ccb_alone": "A calcium channel blocker alone needs no blood test; blood pressure and pulse checks as usual."
  }
}
$json$, 'PROPOSED. CMO answers 2026-10-27: thresholds as drafted; doctor may start before results and records why; fasting glucose replaces HbA1c when the doctor marks it unreliable; calcium channel blocker alone needs no baseline.');
-- baseline-labs-v1-end

create function public.sign_baseline_labs_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.baseline_labs_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the baseline labs rule' using errcode = '42501'; end if;
  select * into c from public.baseline_labs_config where version = p_version for update;
  if not found then raise exception 'no such baseline labs configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.baseline_labs_config set is_active = false where is_active and version <> p_version;
  update public.baseline_labs_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'baseline_labs_config.signed',
            'baseline_labs_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_baseline_labs_config(integer) from public, anon, authenticated;
grant execute on function public.sign_baseline_labs_config(integer) to authenticated;

-- The active, signed version (null while the CMO has not signed anything: the check is then off).
create function private.baseline_labs_config() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config || jsonb_build_object('_version', version) from public.baseline_labs_config where is_active and approved_at is not null order by version desc limit 1 $$;
revoke all on function private.baseline_labs_config() from public, anon, authenticated;

-- 2. HbA1c exceptions -------------------------------------------------------------------------------------------------------------
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
  using (private.is_org_staff(organisation_id) and private.clinician_has_patient_access(patient_id));

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

-- 3. The check --------------------------------------------------------------------------------------------------------------------
create function private.baseline_drug_class(p_name text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_name is null then null
    when private.bp_drug_class(p_name) in ('acei', 'arb', 'ccb', 'thiazide') then private.bp_drug_class(p_name)
    when lower(p_name) ~ '(atenolol|bisoprolol|metoprolol|propranolol|carvedilol|nebivolol|labetalol)' then 'beta_blocker'
    when lower(p_name) ~ 'metformin' then 'metformin'
    when lower(p_name) ~ '(gliclazide|glimepiride|glibenclamide|glyburide|glipizide)' then 'sulfonylurea'
    when lower(p_name) ~ 'insulin' then 'insulin'
    when lower(p_name) ~ '(atorvastatin|simvastatin|rosuvastatin|pravastatin|lovastatin)' then 'statin'
    else null
  end;
$$;
revoke all on function private.baseline_drug_class(text) from public, anon, authenticated;

-- The most recent usable numeric value of one analyte inside the freshness window. Filed results only: withdrawn or superseded results do not count.
create function private.baseline_lab_latest(p_patient uuid, p_analyte text, p_months integer)
returns table (value_numeric numeric, unit text)
language sql stable security definer set search_path = ''
as $$
  select i.value_numeric, i.unit
    from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_analyte) and i.value_numeric is not null
     and r.withdrawn_at is null and r.superseded_by is null
     and r.received_at >= now() - make_interval(months => p_months)
   order by r.received_at desc, i.created_at desc limit 1
$$;
revoke all on function private.baseline_lab_latest(uuid, text, integer) from public, anon, authenticated;

create function private.baseline_labs_findings(p_patient uuid, p_drug text, p_replacing uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg jsonb := private.baseline_labs_config();
  v_cls text := private.baseline_drug_class(p_drug);
  v_months integer; v_r text; v_missing text[] := '{}'; v_f jsonb := '[]'::jsonb;
  v_unreliable boolean; v_sex text; v_dob date; v_age integer;
  v_creat record; v_fg numeric; v_a1c numeric; v_scr numeric; v_female boolean; v_kappa numeric; v_alpha numeric; v_egfr numeric;
begin
  if v_cfg is null or v_cls is null then return v_f; end if;
  -- an amendment is checked only when the dose or the medicine changed (amend_medication says so); other callers are checked
  if p_replacing is not null and current_setting('tarragon.rx_dose_changed', true) = 'off' then return v_f; end if;
  v_months := coalesce((v_cfg ->> 'freshness_months')::integer, 12);
  v_unreliable := exists (select 1 from public.hba1c_exceptions where patient_id = p_patient);
  select p.sex, p.date_of_birth into v_sex, v_dob from public.profiles p where p.id = p_patient;
  v_age := case when v_dob is null then null else extract(year from age(v_dob))::integer end;
  v_female := lower(coalesce(v_sex, '')) = 'female';
  select value_numeric into v_fg from private.baseline_lab_latest(p_patient, 'fasting_glucose', v_months);
  select value_numeric into v_a1c from private.baseline_lab_latest(p_patient, 'hba1c', v_months);

  for v_r in select jsonb_array_elements_text(coalesce(v_cfg -> 'classes' -> v_cls -> 'requires', '[]'::jsonb)) loop
    if v_r = 'glucose_or_hba1c' then
      if not (v_fg is not null or (not v_unreliable and v_a1c is not null)) then v_missing := array_append(v_missing, case when v_unreliable then 'fasting_glucose' else 'fasting_glucose_or_hba1c' end); end if;
    elsif v_r = 'hba1c' then
      if v_unreliable then
        if v_fg is null then v_missing := array_append(v_missing, 'fasting_glucose'); end if;   -- HbA1c is unreliable for this patient: fasting glucose stands in
      elsif v_a1c is null then v_missing := array_append(v_missing, 'hba1c');
      end if;
    elsif v_r = 'fasting_glucose' then
      if v_fg is null and not (v_unreliable and 'fasting_glucose' = any (v_missing)) then v_missing := array_append(v_missing, 'fasting_glucose'); end if;
    else
      if not exists (select 1 from private.baseline_lab_latest(p_patient, v_r, v_months)) then v_missing := array_append(v_missing, v_r); end if;
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'baseline_labs_missing', 'drug_class', v_cls, 'missing', to_jsonb(v_missing)));
  end if;

  -- metformin: eGFR from the creatinine (CKD-EPI 2021)
  if v_cls = 'metformin' and not ('creatinine' = any (v_missing)) then
    select value_numeric, unit into v_creat from private.baseline_lab_latest(p_patient, 'creatinine', v_months);
    if v_age is null or v_sex is null or v_creat.unit is null or v_creat.value_numeric <= 0 then
      v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'metformin_egfr_unknown'));
    else
      v_scr := case when v_creat.unit ilike '%mol%' then v_creat.value_numeric / 88.4 else v_creat.value_numeric end;   -- mg/dL
      v_kappa := case when v_female then 0.7 else 0.9 end;
      v_alpha := case when v_female then -0.241 else -0.302 end;
      v_egfr := 142 * power(least(v_scr / v_kappa, 1), v_alpha) * power(greatest(v_scr / v_kappa, 1), -1.200) * power(0.9938, v_age) * case when v_female then 1.012 else 1 end;
      if v_egfr < coalesce((v_cfg #>> '{egfr,metformin_do_not_start_below}')::numeric, 30) then
        v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'metformin_egfr_below_30', 'blocking', true, 'egfr', round(v_egfr, 0)));
      elsif v_egfr < coalesce((v_cfg #>> '{egfr,metformin_review_dose_below}')::numeric, 45) then
        v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'metformin_egfr_review_dose', 'egfr', round(v_egfr, 0)));
      end if;
    end if;
  end if;

  -- a woman who could be pregnant: a recent negative pregnancy test, or the doctor records the answer as the reason for going ahead
  if v_cls in (select jsonb_array_elements_text(coalesce(v_cfg #> '{pregnancy,classes}', '[]'::jsonb)))
     and (v_female or v_sex is null)   -- an unrecorded sex or date of birth cannot rule pregnancy out, so the answer is asked for
     and (v_age is null or v_age between coalesce((v_cfg #>> '{pregnancy,age_from}')::integer, 12) and coalesce((v_cfg #>> '{pregnancy,age_to}')::integer, 50))
     and not exists (select 1 from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
                      where i.patient_id = p_patient and lower(i.analyte_code) = 'pregnancy_test' and lower(coalesce(i.value_text, '')) like 'neg%'
                        and r.withdrawn_at is null and r.superseded_by is null
                        and r.received_at >= now() - make_interval(days => coalesce((v_cfg #>> '{pregnancy,negative_test_valid_days}')::integer, 30))) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'pregnancy_not_excluded'));
  end if;
  return v_f;
end $$;
revoke all on function private.baseline_labs_findings(uuid, text, uuid) from public, anon, authenticated;

-- 4. Plug it into the prescribing safety check ------------------------------------------------------------------------------------
do $$
declare
  v_def text; v_old text; v_new text;
begin
  -- prescription_safety_findings: append the baseline findings
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = 'private.prescription_safety_findings(uuid,text,uuid)'::regprocedure;
  v_old := E'  return v_f;\nend;';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'baseline labs: expected one return in prescription_safety_findings'; end if;
  execute replace(v_def, v_old, E'  v_f := v_f || private.baseline_labs_findings(p_patient, p_drug, p_replacing);\n  return v_f;\nend;');

  -- check_prescription_safety: its own message for a blocking finding that is not a controlled medicine, and the due date of missing tests
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = 'private.check_prescription_safety(uuid,text,uuid,boolean,text)'::regprocedure;
  v_old := 'raise exception ''TarragonHealth does not prescribe controlled medicines, so this cannot be signed here.''';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'baseline labs: expected one blocked message in check_prescription_safety'; end if;
  v_new := 'raise exception ''%'', case when exists (select 1 from jsonb_array_elements(v_findings) f where f ->> ''code'' = ''controlled_medicine'') then ''TarragonHealth does not prescribe controlled medicines, so this cannot be signed here.'' else ''A baseline safety rule blocks this medicine for this patient, so it cannot be signed here.'' end';
  v_def := replace(v_def, v_old, v_new);
  v_old := '''checked_at'', now());';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'baseline labs: expected one checked_at in check_prescription_safety'; end if;
  v_new := '''checked_at'', now(), ''baseline_labs_due_by'', (select to_char(now() + make_interval(days => coalesce((private.baseline_labs_config() ->> ''tests_due_days'')::integer, 7)), ''YYYY-MM-DD'') where exists (select 1 from jsonb_array_elements(v_findings) f where f ->> ''code'' = ''baseline_labs_missing'')));';
  execute replace(v_def, v_old, v_new);

  -- amend_medication: say whether the dose or the medicine changed, so a plain refill amendment is not asked for blood tests
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.oid = 'public.amend_medication(uuid,text,text,text,text,text,integer,text,integer,text,text,jsonb,date,boolean,text)'::regprocedure;
  v_old := 'v_checks := private.check_prescription_safety(v_old.patient_id, v_drug, v_old.id, p_allergies_confirmed, p_safety_override_reason);';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then raise exception 'baseline labs: expected one safety call in amend_medication'; end if;
  v_new := 'perform set_config(''tarragon.rx_dose_changed'', case when v_dose is distinct from v_old.dose or v_drug is distinct from v_old.drug_name then ''on'' else ''off'' end, true);' || E'\n  ' || v_old
        || E'\n  perform set_config(''tarragon.rx_dose_changed'', '''', true);';
  execute replace(v_def, v_old, v_new);
end $$;

do $$
begin
  if exists (select 1 from public.baseline_labs_config where is_active or approved_at is not null) then raise exception 'self-check: the rule must be born unsigned and inactive'; end if;
  if private.baseline_labs_config() is not null then raise exception 'self-check: an unsigned rule must be off'; end if;
  if pg_get_functiondef('private.prescription_safety_findings(uuid,text,uuid)'::regprocedure) not ilike '%baseline_labs_findings%'
     or pg_get_functiondef('public.amend_medication(uuid,text,text,text,text,text,integer,text,integer,text,text,jsonb,date,boolean,text)'::regprocedure) not ilike '%rx_dose_changed%'
     or pg_get_functiondef('private.check_prescription_safety(uuid,text,uuid,boolean,text)'::regprocedure) not ilike '%baseline_labs_due_by%' then
    raise exception 'self-check: a patched function lost its baseline labs line';
  end if;
  if has_function_privilege('anon', 'public.mark_hba1c_unreliable(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.clear_hba1c_unreliable(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_baseline_labs_config(integer)', 'EXECUTE') then raise exception 'self-check: anon can execute'; end if;
  if has_function_privilege('authenticated', 'private.baseline_labs_findings(uuid,text,uuid)', 'EXECUTE') then raise exception 'self-check: the findings function is callable'; end if;
end $$;
