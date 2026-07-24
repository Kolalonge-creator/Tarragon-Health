-- Tarragon Health — Sensitive-positive result gating
--
-- Annual Health Check pathway TH-CP-AHC-001 §10, §18.3, §23: a positive
-- HIV / hepatitis / cancer screening result must be DOCTOR-DELIVERED — the
-- platform must never break that news to the patient with an automated
-- message. Today private.handle_abnormal_screening_result() → the
-- abnormal-result-handler Edge Function sends the same auto reassurance
-- WhatsApp to the patient for EVERY abnormal/critical result regardless of
-- what was screened.
--
-- The clinician alert, screening_upgrades audit row, and care-plan/referral
-- drafting all still fire unconditionally — this only gates the PATIENT-facing
-- auto message, deferring it to the doctor.
--
-- Chosen structural (not flag-only) design: a positive qualitative HIV/hep
-- result comes back with EMPTY abnormal_flags (the ML flag vocabulary only
-- tags analyte/cancer screens), so a flag-based gate alone would silently
-- miss exactly the highest-stakes results. Sensitivity is therefore a
-- data-driven property of the screen type, joined via the screen result's
-- own screen_type_code, with the flag overlap kept only as a belt-and-braces
-- fallback for the cancer screens that do populate flags.

-- 1. Which screen types are sensitive (admin-editable catalogue property).
alter table public.screen_types
  add column if not exists sensitive boolean not null default false;

update public.screen_types
set sensitive = true
where code in (
  'hiv', 'hep_b', 'hep_c',
  'cervical_smear', 'mammography', 'psa', 'fit', 'colonoscopy', 'clinical_breast_exam'
);

-- 2. Persist WHICH screen produced a result, so the trigger can look up its
--    sensitivity. screen_types.code is unique, so this FKs to it directly.
alter table public.screening_results
  add column if not exists screen_type_code text
    references public.screen_types (code) on delete set null;

-- 3. Redefine the abnormal-result trigger to compute is_sensitive and pass it
--    to the Edge Function. Body is otherwise identical to
--    20260716090000_severity_driven_alert_urgency.sql.
create or replace function private.handle_abnormal_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.upgrade_condition := 'other';
  v_upgrade_id uuid;
  v_level public.alert_level;
  v_escalation_level smallint;
  v_sla interval;
  v_sensitive boolean := false;
begin
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  if new.abnormal_flags && array['bp', 'blood_pressure', 'hypertension'] then
    v_condition := 'hypertension';
  elsif new.abnormal_flags && array['glucose', 'hba1c', 'diabetes'] then
    v_condition := 'diabetes';
  elsif new.abnormal_flags && array['psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_condition := 'cancer_referral';
  end if;

  -- Sensitive = the screened type is flagged sensitive in the catalogue
  -- (authoritative — works even when abnormal_flags is empty, as for a
  -- positive HIV/hep test), OR a cancer-family flag is present (fallback).
  if new.screen_type_code is not null then
    select coalesce(bool_or(st.sensitive), false)
      into v_sensitive
      from public.screen_types st
      where st.code = new.screen_type_code;
  end if;
  if not v_sensitive
     and new.abnormal_flags && array['hiv', 'hep_b', 'hep_c', 'psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_sensitive := true;
  end if;

  if new.result_status = 'critical' then
    v_level := 'emergency';
    v_escalation_level := 4;
    v_sla := interval '2 hours';
  else
    v_level := 'urgent_escalation';
    v_escalation_level := 3;
    v_sla := interval '24 hours';
  end if;

  insert into public.screening_upgrades
    (organisation_id, patient_id, screening_result_id, condition_triggered)
  values
    (new.organisation_id, new.patient_id, new.id, v_condition)
  returning id into v_upgrade_id;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, screening_result_id, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    v_level,
    'open',
    'Priority 1: abnormal screening result',
    format('Screening result %s flagged %s; condition inferred: %s.',
           new.id, coalesce(array_to_string(new.abnormal_flags, ', '), 'none'), v_condition),
    now() + v_sla,
    new.id,
    v_escalation_level
  );

  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/abnormal-result-handler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'screening_result_id', new.id,
      'screening_upgrade_id', v_upgrade_id,
      'organisation_id', new.organisation_id,
      'patient_id', new.patient_id,
      'condition', v_condition,
      'abnormal_flags', to_jsonb(new.abnormal_flags),
      'result_summary', new.result_summary,
      'sensitive', v_sensitive
    ),
    timeout_milliseconds := 8000
  );

  return new;
end;
$$;
