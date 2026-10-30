-- The abnormal-result Edge Function was open to anyone: it is deployed with verify_jwt off, the trigger called it with the project's
-- publishable key (public by design, it ships in the web and mobile apps), and the function checked nothing. With the project URL and an
-- organisation id, anyone could POST to it and page every clinician in that organisation, draft care plans, and write clinical-looking
-- in-app notices. Found in the events harness sweep; the function itself now refuses a caller without the shared jobs secret.
--
-- This migration is the trigger half and must be applied BEFORE the function change is deployed: it sends the same secret header
-- (x-notification-jobs-secret, from Vault notification_jobs_secret) that expo-push-receipts' cron already sends, which the current
-- function simply ignores. Once the function is deployed, a call without the header gets a 401 and no page; this makes sure the trigger
-- always sends it. The secret exists in Vault and in the function's environment (expo-push-receipts is answering 200 with it).
--
-- The body is the live body (checksum 31cddf5c compared with production on 2026-10-30) with only the one extra header added; the
-- coalesce keeps a missing secret as an empty string (the function then answers 503/401) rather than a null header that pg_net could
-- reject and the exception handler below would swallow. The exception handler itself is unchanged.
-- Proof: packages/db/tests/abnormal_result_trigger_sends_jobs_secret.sql.

create or replace function private.handle_abnormal_screening_result()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    v_sla := private.escalation_sla_minutes('screening_abnormal_result', 'emergency') * interval '1 minute';
  else
    v_level := 'urgent_escalation';
    v_escalation_level := 3;
    v_sla := private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation') * interval '1 minute';
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

  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/abnormal-result-handler',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
        'x-notification-jobs-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notification_jobs_secret'), ''),
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
  exception when others then
    null;
  end;

  return new;
end;
$function$;

do $$
begin
  if position('x-notification-jobs-secret' in pg_get_functiondef('private.handle_abnormal_screening_result()'::regprocedure)) = 0 then
    raise exception 'handle_abnormal_screening_result was not updated';
  end if;
end $$;
