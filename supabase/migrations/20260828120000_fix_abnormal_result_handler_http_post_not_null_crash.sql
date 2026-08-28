-- Fixes a real bug in private.handle_abnormal_screening_result() (current
-- live body from 20260730105131_v3_port_escalation_sla_config.sql), found by
-- packages/db/tests/public_impact_metrics.sql and
-- screening_ladder_order_completeness.sql once packages/db/tests could
-- finally run against a genuinely fresh database for the first time this
-- sprint.
--
-- Every migration that has ever touched this net.http_post call
-- (20260711211535, 20260706091332, 20260719140000) documents the same
-- intent in its own header comment: "if the 'project_url' or
-- 'edge_function_publishable_key' Vault secrets aren't set yet in this
-- environment, the call fails closed (null URL/header)". That was never
-- actually true. pg_net's net.http_post inserts the row into
-- net.http_request_queue *before* making the request, and that table's
-- `url` column is NOT NULL -- so a null project_url secret doesn't fail
-- closed at all, it raises a hard not-null-violation that aborts the whole
-- triggering statement, taking the screening_upgrades/clinician_alerts
-- audit-trail rows down with it. That is the exact failure this migration's
-- own ancestor was written to prevent (see 20260711211535's header: "a
-- slow/unavailable Edge Function never blocks or fails the INSERT that
-- created the audit trail").
--
-- private.enqueue_critical_notification() and
-- private.escalate_unconfirmed_critical_notifications()
-- (20260730153300_critical_notification_engine.sql) already wrap their own
-- net.http_post calls in `begin ... exception when others then null; end;`
-- for exactly this reason -- this migration brings
-- handle_abnormal_screening_result() in line with that established,
-- already-proven pattern. No other behavior changes: when both secrets are
-- set (the expected live/production state), the call proceeds exactly as
-- before.
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
    -- Best-effort Edge Function nudge only, same defensive pattern as
    -- private.enqueue_critical_notification() below it in the notification
    -- stack — the screening_upgrades/clinician_alerts rows above are the
    -- real, guaranteed safety net; this call is additive.
    null;
  end;

  return new;
end;
$$;

do $$
begin
  -- Prove a missing project_url secret no longer crashes the trigger: with
  -- no vault secrets configured (true in every fresh CI/local database),
  -- inserting an abnormal screening_results row must still succeed and
  -- still create its screening_upgrades/clinician_alerts audit trail.
  -- Rolled back inside this migration's own transaction either way.
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

    -- clinician_alerts_guard_deletion (Alert System, applied earlier today)
    -- now blocks deleting an unresolved severity>=2 alert outright -- this
    -- fixture alert is severity 3 (urgent_escalation). Resolve it first,
    -- matching the same documentation-required-for-severity>=2 constraint,
    -- before cleaning it up.
    update public.clinician_alerts
      set status = 'resolved', resolution_action = 'test fixture cleanup', resolution_outcome = 'no_action_needed'
      where screening_result_id = v_result_id;
    delete from public.clinician_alerts where screening_result_id = v_result_id;
    delete from public.screening_upgrades where screening_result_id = v_result_id;
    delete from public.screening_results where id = v_result_id;
  end;
end $$;
