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
$$;

do $$
begin
  declare
    v_org uuid;
    v_patient uuid;
    v_result_id uuid;
  begin
    select p.organisation_id, p.id into v_org, v_patient
      from public.profiles p
      where p.role = 'patient' and p.organisation_id is not null
      limit 1;

    if v_patient is null then
      raise notice 'no patient fixture available; skipping behavioural assertion';
      return;
    end if;

    insert into public.screening_results
      (organisation_id, patient_id, result_status, abnormal_flags)
    values (v_org, v_patient, 'abnormal', array['blood_pressure'])
    returning id into v_result_id;

    if not exists (select 1 from public.screening_upgrades where screening_result_id = v_result_id) then
      raise exception 'handle_abnormal_screening_result() did not create the screening_upgrades audit row';
    end if;

    update public.clinician_alerts
      set status = 'resolved', resolution_action = 'test fixture cleanup', resolution_outcome = 'no_action_needed'
      where screening_result_id = v_result_id;
    delete from public.clinician_alerts where screening_result_id = v_result_id;
    delete from public.screening_upgrades where screening_result_id = v_result_id;
    delete from public.screening_results where id = v_result_id;
  end;
end $$;
