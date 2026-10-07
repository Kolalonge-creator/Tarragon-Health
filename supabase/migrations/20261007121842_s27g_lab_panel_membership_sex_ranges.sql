-- S27g: one Membership lab panel, sex-specific reference ranges, standards-checked limits (founder decision 2026-10-07).
--
-- What this does, and why:
--  1. The two package-era panels (`essential`, `annual_health_check`) are replaced by one panel, `membership_annual`: the Membership
--     includes one annual blood test and review, so there is nothing to choose between. Counted first (live, 2026-10-07): 0 lab_orders
--     and 0 lab_results carry a panel code, so there is no data to convert; the two old panel versions were unsigned seed rows that
--     no result ever used, and they are deleted. The three panel_code CHECKs now allow only the new code.
--  2. Reference ranges can differ by sex (`bySex` on an analyte): haemoglobin (WHO anaemia thresholds 13 g/dL men, 12 g/dL non-pregnant
--     women), creatinine and HDL. Critical limits never differ. A patient whose sex is not recorded is judged by the NARROWEST of the
--     two ranges, so an uncertain case is held for a clinician and never released early (INV-03). The TS mirror in packages/clinical
--     (`effectiveRange`) applies the same rule and a test pins both to the same cases.
--  3. `private.classify_lab_result` takes the patient (to read profiles.sex). The one caller, `private.submit_lab_result`, is patched
--     in place (its live text is read and one call rewritten, so nothing else in it can drift) and the old two-argument function is
--     dropped in the same transaction, so no overload is left behind.
--  4. Limits re-checked against published standards (docs/clinical-signoff/STANDARDS-CROSS-CHECK-2026-10-07.md): glucose critical
--     <45 and >360 mg/dL (2.5 and 20 mmol/L, Royal College of Pathologists telephone limits), potassium critical <3.0 and >6.0 mmol/L,
--     sodium critical <=120 and >150 mmol/L, ALT upper limit 40 U/L, white cell lower limit 3.0 x10^9/L (Duffy-null associated
--     neutrophil counts are common in people of African ancestry; ANC below 1.5 alone is not treated as disease).
--  5. A new unsigned draft sign-off (lab_panel_signoffs v2) is created for the CMO to sign with `sign_lab_panels()`. Until a signed
--     version is active no result auto-releases (INV-14), exactly as before.
--
-- Units: values are stored and judged in the unit Nigerian laboratories most often print (mg/dL for glucose, creatinine and lipids,
-- mmol/L for electrolytes, g/dL haemoglobin, 10^9/L counts, % HbA1c). Entry in another unit is converted before it reaches this
-- function (packages/clinical `toCanonicalUnit`); this function still refuses a unit other than the panel's, so a wrong unit can
-- never be silently accepted here.
begin;

-- 1. ------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.lab_results where panel_code is not null) or exists (select 1 from public.lab_orders where panel_code is not null)
     or exists (select 1 from public.lab_results where panel_version_id is not null) then
    raise exception 'S27g: a lab result or order already carries a panel code; this migration only renames panels with no data behind them';
  end if;
end $$;

alter table public.lab_orders drop constraint lab_orders_panel_code_check;
alter table public.lab_results drop constraint lab_results_panel_code_check;
alter table public.lab_panel_versions drop constraint lab_panel_versions_panel_code_check;
delete from public.lab_panel_versions where panel_code in ('essential', 'annual_health_check');
alter table public.lab_orders add constraint lab_orders_panel_code_check check (panel_code = 'membership_annual');
alter table public.lab_results add constraint lab_results_panel_code_check check (panel_code = 'membership_annual');
alter table public.lab_panel_versions add constraint lab_panel_versions_panel_code_check check (panel_code = 'membership_annual');

-- lab-panels-v2-begin
insert into public.lab_panel_versions (panel_code, version, is_active, analytes, note)
select 'membership_annual', 1, true, $json${
 "panels": {
  "membership_annual": {
   "analytes": [
    {
     "code": "fasting_glucose",
     "label": "Fasting glucose",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 70,
     "refHigh": 99,
     "criticalLow": 45,
     "criticalHigh": 360
    },
    {
     "code": "hba1c",
     "label": "HbA1c",
     "kind": "numeric",
     "unit": "%",
     "refLow": 4,
     "refHigh": 5.6,
     "criticalHigh": 14
    },
    {
     "code": "creatinine",
     "label": "Creatinine",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 0.6,
     "refHigh": 1.3,
     "criticalHigh": 4,
     "bySex": {
      "male": {
       "refLow": 0.7,
       "refHigh": 1.3
      },
      "female": {
       "refLow": 0.6,
       "refHigh": 1.1
      }
     }
    },
    {
     "code": "potassium",
     "label": "Potassium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 3.5,
     "refHigh": 5.1,
     "criticalLow": 3,
     "criticalHigh": 6
    },
    {
     "code": "sodium",
     "label": "Sodium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 135,
     "refHigh": 145,
     "criticalLow": 121,
     "criticalHigh": 150
    },
    {
     "code": "total_cholesterol",
     "label": "Total cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 200
    },
    {
     "code": "ldl_cholesterol",
     "label": "LDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 130
    },
    {
     "code": "hdl_cholesterol",
     "label": "HDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 40,
     "bySex": {
      "male": {
       "refLow": 40
      },
      "female": {
       "refLow": 50
      }
     }
    },
    {
     "code": "triglycerides",
     "label": "Triglycerides",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 150
    },
    {
     "code": "alt",
     "label": "ALT",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 7,
     "refHigh": 40
    },
    {
     "code": "ast",
     "label": "AST",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 10,
     "refHigh": 40
    },
    {
     "code": "haemoglobin",
     "label": "Haemoglobin",
     "kind": "numeric",
     "unit": "g/dL",
     "refLow": 12,
     "refHigh": 17.5,
     "criticalLow": 7,
     "criticalHigh": 20,
     "bySex": {
      "male": {
       "refLow": 13,
       "refHigh": 17.5
      },
      "female": {
       "refLow": 12,
       "refHigh": 15.5
      }
     }
    },
    {
     "code": "wbc",
     "label": "White cell count",
     "kind": "numeric",
     "unit": "10^9/L",
     "refLow": 3,
     "refHigh": 11,
     "criticalLow": 1,
     "criticalHigh": 30
    },
    {
     "code": "platelets",
     "label": "Platelets",
     "kind": "numeric",
     "unit": "10^9/L",
     "refLow": 150,
     "refHigh": 450,
     "criticalLow": 20,
     "criticalHigh": 1000
    },
    {
     "code": "tsh",
     "label": "TSH",
     "kind": "numeric",
     "unit": "mIU/L",
     "refLow": 0.4,
     "refHigh": 4
    },
    {
     "code": "hiv_screen",
     "label": "HIV screen",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    },
    {
     "code": "hbsag",
     "label": "Hepatitis B surface antigen",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    },
    {
     "code": "hcv_ab",
     "label": "Hepatitis C antibody",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    }
   ]
  }
 }
}$json$::jsonb -> 'panels' -> 'membership_annual' -> 'analytes',
       'The Membership annual blood test. PROPOSED, signed through lab_panel_signoffs (CMO). Adult limits; sex-specific haemoglobin, creatinine and HDL.';
-- lab-panels-v2-end

-- 2. and 3. -----------------------------------------------------------------------------------------------------------------------
create function private.classify_lab_result(p_panel_version uuid, p_items jsonb, p_patient uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_analytes jsonb;
  v_def jsonb;
  v_it jsonb;
  v_code text;
  v_unit text;
  v_num numeric;
  v_txt text;
  v_flag text;
  v_sens boolean;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_missing text[];
  v_state text;
  v_reason text;
  v_task text;
  v_any_sens boolean := false;
  v_any_crit boolean := false;
  v_any_abn boolean := false;
  v_sex text;
  v_rl numeric;
  v_rh numeric;
  v_m jsonb;
  v_f jsonb;
begin
  select analytes into v_analytes from public.lab_panel_versions where id = p_panel_version;
  if v_analytes is null then raise exception 'lab_unknown_panel' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'lab_value_missing' using errcode = '22023'; end if;
  if p_patient is not null then select sex::text into v_sex from public.profiles where id = p_patient; end if;

  for v_it in select * from jsonb_array_elements(p_items) loop
    v_code := v_it ->> 'analyte_code';
    select a into v_def from jsonb_array_elements(v_analytes) a where a ->> 'code' = v_code;
    if v_def is null then raise exception 'lab_unknown_analyte' using errcode = '22023'; end if;
    if v_code = any(v_seen) then raise exception 'lab_duplicate_analyte' using errcode = '22023'; end if;
    v_seen := v_seen || v_code;
    v_unit := coalesce(v_def ->> 'unit', '');
    if coalesce(v_it ->> 'unit', '') <> '' and (v_it ->> 'unit') <> v_unit then raise exception 'lab_unit_mismatch' using errcode = '22023'; end if;

    if v_def ->> 'kind' = 'numeric' then
      if v_it ->> 'value_numeric' is null then raise exception 'lab_value_missing' using errcode = '22023'; end if;
      v_num := (v_it ->> 'value_numeric')::numeric;
      if v_num < 0 or v_num > 1000000 then raise exception 'lab_value_out_of_bounds' using errcode = '22023'; end if;

      -- the reference limits for this patient: a sex-specific range where the panel has one; a missing or other sex gets the
      -- narrowest of the two (greatest low, least high; GREATEST and LEAST ignore a limit that is not given)
      v_rl := (v_def ->> 'refLow')::numeric;
      v_rh := (v_def ->> 'refHigh')::numeric;
      if v_def ? 'bySex' then
        v_m := v_def #> '{bySex,male}';
        v_f := v_def #> '{bySex,female}';
        if v_sex = 'male' then
          v_rl := coalesce((v_m ->> 'refLow')::numeric, v_rl);
          v_rh := coalesce((v_m ->> 'refHigh')::numeric, v_rh);
        elsif v_sex = 'female' then
          v_rl := coalesce((v_f ->> 'refLow')::numeric, v_rl);
          v_rh := coalesce((v_f ->> 'refHigh')::numeric, v_rh);
        else
          v_rl := greatest(coalesce((v_m ->> 'refLow')::numeric, v_rl), coalesce((v_f ->> 'refLow')::numeric, v_rl));
          v_rh := least(coalesce((v_m ->> 'refHigh')::numeric, v_rh), coalesce((v_f ->> 'refHigh')::numeric, v_rh));
        end if;
      end if;

      v_flag := case
        when (v_def ? 'criticalLow') and v_num < (v_def ->> 'criticalLow')::numeric then 'critical'
        when (v_def ? 'criticalHigh') and v_num > (v_def ->> 'criticalHigh')::numeric then 'critical'
        when v_rl is not null and v_num < v_rl then 'low'
        when v_rh is not null and v_num > v_rh then 'high'
        else 'normal' end;
      v_out := v_out || jsonb_build_object('analyte_code', v_code, 'value_numeric', v_num, 'unit', v_unit, 'flag', v_flag, 'sensitive_positive', false,
        'ref_low', v_rl, 'ref_high', v_rh);
    else
      v_txt := lower(btrim(coalesce(v_it ->> 'value_text', '')));
      if v_txt = '' then raise exception 'lab_value_missing' using errcode = '22023'; end if;
      if v_txt not in ('positive', 'negative') then raise exception 'lab_value_not_recognised' using errcode = '22023'; end if;
      v_sens := v_txt = 'positive' and coalesce((v_def ->> 'sensitive')::boolean, false);
      v_flag := v_txt;
      v_out := v_out || jsonb_build_object('analyte_code', v_code, 'value_text', v_txt, 'unit', v_unit, 'flag', v_flag, 'sensitive_positive', v_sens,
        'ref_low', null, 'ref_high', null);
    end if;
    if v_sens then v_any_sens := true; end if;
    if v_flag = 'critical' then v_any_crit := true; end if;
    if v_flag not in ('normal', 'negative') then v_any_abn := true; end if;
    v_sens := false;
  end loop;

  select coalesce(array_agg(a ->> 'code'), '{}') into v_missing
    from jsonb_array_elements(v_analytes) a
   where not coalesce((a ->> 'optional')::boolean, false) and not ((a ->> 'code') = any(v_seen));

  if v_any_sens then v_state := 'clinician_disclosure_required'; v_reason := 'sensitive_positive'; v_task := 'sensitive_result_disclosure';
  elsif v_any_crit then v_state := 'awaiting_review'; v_reason := 'critical'; v_task := 'critical_result_review';
  elsif v_any_abn then v_state := 'awaiting_review'; v_reason := 'abnormal'; v_task := 'routine_result_review';
  elsif coalesce(array_length(v_missing, 1), 0) > 0 or jsonb_array_length(v_out) = 0 then v_state := 'awaiting_review'; v_reason := 'incomplete'; v_task := 'routine_result_review';
  else v_state := 'released'; v_reason := 'RES-001'; v_task := null;
  end if;

  return jsonb_build_object('release_state', v_state, 'reason', v_reason, 'task', v_task, 'items', v_out, 'missing', to_jsonb(v_missing));
end;
$$;
revoke all on function private.classify_lab_result(uuid, jsonb, uuid) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_old constant text := 'private.classify_lab_result(v_ver.id, p_items)';
  v_new constant text := 'private.classify_lab_result(v_ver.id, p_items, p_patient)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'submit_lab_result';
  if v_def is null then raise exception 'S27g: private.submit_lab_result not found'; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'S27g: expected exactly one call to the two-argument classifier in private.submit_lab_result';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
drop function private.classify_lab_result(uuid, jsonb);

-- 5. ------------------------------------------------------------------------------------------------------------------------------
insert into public.lab_panel_signoffs (version, is_active, config, notes)
select 2, false, s.config,
       'DRAFT for the CMO. Covers lab_panel_versions membership_annual v1 (one Membership panel, sex-specific haemoglobin, creatinine and HDL, standards-checked critical limits) and the disclosure policy. Sign with sign_lab_panels().'
  from public.lab_panel_signoffs s where s.version = 1;

do $$
begin
  if (select count(*) from public.lab_panel_versions where is_active) <> 1 then raise exception 'S27g self-check: expected exactly one active panel version'; end if;
  if not exists (select 1 from public.lab_panel_versions where panel_code = 'membership_annual' and is_active and jsonb_array_length(analytes) = 18) then
    raise exception 'S27g self-check: membership_annual is missing or has the wrong analyte count';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'classify_lab_result' and p.pronargs = 2) then
    raise exception 'S27g self-check: the two-argument classifier is still there';
  end if;
  if (select count(*) from public.lab_panel_signoffs where version = 2 and approved_at is null and not is_active) <> 1 then
    raise exception 'S27g self-check: the v2 sign-off draft is missing or not unsigned';
  end if;
  if private.lab_panels_signed() then raise exception 'S27g self-check: panels must still be unsigned after this migration'; end if;
end $$;

commit;
