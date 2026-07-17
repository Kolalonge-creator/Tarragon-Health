-- Tarragon Health — fix: discharge_review_alert_id never got stamped
--
-- Bug found via a rolled-back live-SQL test of 20260717214814: the update
-- guard's blanket "new.discharge_review_alert_id := old.discharge_review_alert_id"
-- (meant to make the field immutable to client sessions) also fired for the
-- discharge trigger's OWN internal stamping UPDATE — since that nested UPDATE
-- re-triggers the same BEFORE UPDATE guard, and at that point OLD is still the
-- pre-stamp row (discharge_review_alert_id null), the guard let it through
-- unmodified... except it runs unconditionally for EVERY update afterwards too,
-- so a legitimate value never survives. Root cause: the guard couldn't tell "the
-- system's own one-time stamp" from "a client trying to spoof it".
--
-- Fix: a session-local GUC flag the discharge handler sets immediately before
-- its nested UPDATE. The guard only lets discharge_review_alert_id through
-- while that flag is on — otherwise it's frozen at whatever it already was
-- (still fully client-proof; source/recorded_by are untouched, they never had
-- this problem since nothing else ever writes them after insert).

create or replace function private.enforce_hospital_admission_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not private.is_org_staff(new.organisation_id) then
    new.organisation_id    := old.organisation_id;
    new.patient_id         := old.patient_id;
    new.clinician_alert_id := old.clinician_alert_id;
    new.created_at         := old.created_at;
  end if;
  -- Authorship is set once at insert time and never rewritten by any session.
  new.source      := old.source;
  new.recorded_by := old.recorded_by;
  -- discharge_review_alert_id is set exactly once, by
  -- private.handle_hospital_discharge()'s own internal UPDATE (flagged via this
  -- GUC so it can pass through) — any other write, from any session, is a no-op.
  if coalesce(current_setting('private.hospital_discharge_stamping', true), 'off') <> 'on' then
    new.discharge_review_alert_id := old.discharge_review_alert_id;
  end if;
  return new;
end;
$$;

create or replace function private.handle_hospital_discharge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_days     integer;
  v_summary_line text := '';
begin
  v_days := greatest(0, new.discharged_on - new.admitted_on);

  if new.discharge_summary is not null and length(btrim(new.discharge_summary)) > 0 then
    v_summary_line := format(' Discharge notes: %s.', new.discharge_summary);
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Review care plan after hospital discharge',
    format('Patient was discharged on %s (admitted %s, %s day%s). Review whether the care plan needs updating — this does not change the plan automatically.%s',
           new.discharged_on, new.admitted_on, v_days, case when v_days = 1 then '' else 's' end,
           v_summary_line),
    2
  )
  returning id into v_alert_id;

  perform set_config('private.hospital_discharge_stamping', 'on', true);
  update public.patient_hospital_admissions
    set discharge_review_alert_id = v_alert_id
    where id = new.id;
  perform set_config('private.hospital_discharge_stamping', 'off', true);

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    coalesce((select auth.uid()), new.patient_id),
    'hospital_admission.discharged',
    'patient_hospital_admissions',
    new.id,
    jsonb_build_object('discharged_on', new.discharged_on, 'clinician_alert_id', v_alert_id)
  );

  return null;
end;
$$;
