-- Tarragon Health
-- 11 · Wire the AbnormalResultHandler Edge Function into the trigger
--
-- Migration 03 installed the DB-level safety net (screening_upgrades +
-- clinician_alerts rows, so the event can never be silently dropped even
-- without an Edge Function). That safety net stays exactly as-is — this
-- migration only adds the missing second half: the trigger now also fires
-- net.http_post at the new abnormal-result-handler Edge Function so a
-- clinician WhatsApp alert actually goes out, a draft care_plan/
-- specialist_referral gets created, and the patient gets a WhatsApp
-- follow-up message (docs/ARCHITECTURE.md §7).
--
-- Same fire-and-forget pattern as
-- 20260706110002_schedule_notification_sender.sql: net.http_post is async
-- and returns immediately, so a slow/unavailable Edge Function never blocks
-- or fails the INSERT that created the audit trail. If the 'project_url' or
-- 'edge_function_publishable_key' Vault secrets aren't set yet in this
-- environment, the call fails closed (null URL/header) — the
-- screening_upgrades/clinician_alerts rows and the 4-hour SLA still land,
-- exactly as they did before this migration.

create or replace function private.handle_abnormal_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.upgrade_condition := 'other';
  v_upgrade_id uuid;
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

  insert into public.screening_upgrades
    (organisation_id, patient_id, screening_result_id, condition_triggered)
  values
    (new.organisation_id, new.patient_id, new.id, v_condition)
  returning id into v_upgrade_id;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (
    new.organisation_id,
    new.patient_id,
    'urgent_escalation',
    'open',
    'Priority 1: abnormal screening result',
    format('Screening result %s flagged %s; condition inferred: %s.',
           new.id, coalesce(array_to_string(new.abnormal_flags, ', '), 'none'), v_condition),
    now() + interval '4 hours'
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
