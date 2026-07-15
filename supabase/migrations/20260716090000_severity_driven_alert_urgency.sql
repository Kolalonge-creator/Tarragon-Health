-- Tarragon Health
-- Severity-driven alert urgency
--
-- The abnormal-result trigger (private.handle_abnormal_screening_result,
-- most recently redefined in 20260711211535_abnormal_result_handler_trigger.sql)
-- has always hardcoded level='urgent_escalation' and a flat 4-hour SLA for
-- every abnormal/critical screening result, ignoring screening_results'
-- own result_status distinction between 'abnormal' and 'critical'. Per the
-- documented SLA targets (docs/CLINICAL_TRUST_MODEL_SPEC.md §6,
-- docs/Tarragon_Health_Master_Operating_Plan_v4.md §6), critical results
-- need a 2-hour SLA and top urgency; abnormal results stay at 24 hours.
-- This migration makes the already-captured severity actually drive the
-- alert instead of being silently ignored downstream.
--
-- It also starts writing clinician_alerts.escalation_level (added nullable
-- in 20260715172825_clinician_alerts_escalation_level.sql but never written
-- by anything besides that migration's one-time backfill), using the same
-- linear mapping that backfill established, and adds a direct FK from
-- clinician_alerts to the triggering screening_results row so the doctor
-- worklist can show the same Green/Amber/Amber/Red badge patients already
-- see on their own lab results, instead of a fuzzy nearest-timestamp join.

alter table public.clinician_alerts
  add column screening_result_id uuid references public.screening_results (id) on delete set null;

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
      'result_summary', new.result_summary
    ),
    timeout_milliseconds := 8000
  );

  return new;
end;
$$;
