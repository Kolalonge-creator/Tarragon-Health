-- Tarragon Health — Chronic Disease Case Management (Module 74), part 4/5:
-- 74.8 hospital discharge pathway + 74.9 post-discharge contact + the
-- "new admission" leg of 74.15 reopening.
--
-- "One directory, not two" — extends patient_hospital_admissions' own
-- existing trigger chain (20260717181320/214814) rather than adding a
-- second listener. Two hooks:
--
--   * BEFORE INSERT (private.handle_hospital_admission, already raises a
--     clinician_review alert on every admission): now ALSO reopens the
--     patient's most recently closed case, if one exists and none is
--     currently active — 74.15's "new admission" reopening trigger. A case
--     is NOT opened fresh at admission time; the existing admission alert
--     already gives a doctor early context, and 74.8's own diagram starts
--     the discharge pathway at discharge, not admission — same reasoning
--     the 20260717214814 migration's own header already gives for why ITS
--     second, discharge-time trigger exists ("discharge... is when a
--     care-plan review actually makes sense — the acute episode is over").
--
--   * AFTER UPDATE, discharged_on null -> non-null (private.
--     handle_hospital_discharge, already raises a second clinician_review
--     alert): now ALSO opens-or-reuses a care_management_case
--     (entry_reason='hospital_discharge') and creates the 74.9 post-
--     discharge-contact case plan item with a 3-day deadline. Medication
--     reconciliation (74.10) is deliberately NOT a new step here — it
--     "connects directly" (74.10's own words) to this codebase's existing
--     medication_reviews engine and the medications table's own change
--     history; the case plan item created below explicitly calls out
--     reconciling medications as part of the contact, rather than
--     forking a second reconciliation record.

create or replace function private.open_or_reuse_care_management_case(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_entry_reason public.care_management_entry_reason,
  p_entry_detail text,
  p_hospital_admission_id uuid default null,
  p_risk_score_id uuid default null,
  p_referring_alert_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case_id uuid;
begin
  select id into v_case_id
  from public.care_management_cases
  where patient_id = p_patient_id and status = 'active'
  limit 1;

  if v_case_id is not null then
    -- Already in an active episode — backfill link columns that were still
    -- null (e.g. this admission is new context for an already-open case)
    -- rather than opening a second, competing case.
    update public.care_management_cases
      set hospital_admission_id = coalesce(hospital_admission_id, p_hospital_admission_id),
          risk_score_id = coalesce(risk_score_id, p_risk_score_id),
          referring_alert_id = coalesce(referring_alert_id, p_referring_alert_id)
      where id = v_case_id;
    return v_case_id;
  end if;

  insert into public.care_management_cases
    (organisation_id, patient_id, entry_reason, entry_detail, hospital_admission_id, risk_score_id, referring_alert_id)
  values
    (p_organisation_id, p_patient_id, p_entry_reason, p_entry_detail, p_hospital_admission_id, p_risk_score_id, p_referring_alert_id)
  returning id into v_case_id;

  insert into public.care_management_case_events
    (case_id, organisation_id, patient_id, event_type, reason)
  values
    (v_case_id, p_organisation_id, p_patient_id, 'opened', p_entry_detail);

  return v_case_id;
end;
$$;

comment on function private.open_or_reuse_care_management_case(uuid, uuid, public.care_management_entry_reason, text, uuid, uuid, uuid) is
  'Idempotent case-open helper for system/trigger callers (74.7): reuses the patient''s existing active case (backfilling any still-null link columns) rather than opening a second one, respecting the one-active-case-per-patient invariant. Manual staff-initiated opens go through a plain insert (RLS is_org_staff) from the app instead — this helper is for trigger call sites only.';

revoke all on function private.open_or_reuse_care_management_case(uuid, uuid, public.care_management_entry_reason, text, uuid, uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Admission-time: reopen a recently-closed case (74.15).
-- ---------------------------------------------------------------------------
create or replace function private.handle_hospital_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_dx_line  text := '';
  v_closed_case_id uuid;
begin
  if new.self_reported_diagnosis is not null
     and length(btrim(new.self_reported_diagnosis)) > 0 then
    v_dx_line := format(' Patient-reported reason: %s.', new.self_reported_diagnosis);
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Care plan review: patient reported a hospital admission',
    format('Patient logged a hospital admission dated %s.%s Review whether the care plan needs updating. (Self-reported by the patient — not a clinician diagnosis.)',
           new.admitted_on, v_dx_line),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  -- 74.15: a new admission reopens the patient's most recently closed case,
  -- if one exists and none is currently active. Only ever reopens the
  -- single most recent closed case — an older, already-superseded case
  -- stays closed.
  if not exists (select 1 from public.care_management_cases where patient_id = new.patient_id and status = 'active') then
    select id into v_closed_case_id
    from public.care_management_cases
    where patient_id = new.patient_id and status = 'closed'
    order by closed_at desc
    limit 1;

    if v_closed_case_id is not null then
      update public.care_management_cases
        set status = 'active', hospital_admission_id = new.id
        where id = v_closed_case_id;

      insert into public.care_management_case_events
        (case_id, organisation_id, patient_id, event_type, reason)
      values
        (v_closed_case_id, new.organisation_id, new.patient_id, 'reopened', 'New hospital admission dated ' || new.admitted_on);
    end if;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.patient_id,
    'hospital_admission.created',
    'patient_hospital_admissions',
    new.id,
    jsonb_build_object('admitted_on', new.admitted_on, 'clinician_alert_id', new.clinician_alert_id, 'reopened_case_id', v_closed_case_id)
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Discharge-time: open-or-reuse the case + 74.9 post-discharge contact task.
-- ---------------------------------------------------------------------------
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
  v_case_id  uuid;
  v_case_manager_id uuid;
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

  -- 74.8: hospital discharge is a major case-management entry point.
  v_case_id := private.open_or_reuse_care_management_case(
    new.organisation_id, new.patient_id, 'hospital_discharge',
    format('Discharged %s after a %s-day admission.', new.discharged_on, v_days),
    new.id
  );

  -- 74.9: "system creates: contact patient within a defined timeframe" —
  -- 3 days, the same order of magnitude as this codebase's other
  -- post-event contact windows. Medication reconciliation (74.10) rides
  -- along in the task description rather than a separate record — it
  -- "connects directly" to the existing medication_reviews engine/
  -- medications history, which the case manager reviews as part of this
  -- same contact.
  select case_manager_id into v_case_manager_id
  from public.care_management_cases where id = v_case_id;

  insert into public.care_plan_interventions
    (organisation_id, patient_id, case_id, problem, description, owner_id, deadline, status)
  values (
    new.organisation_id, new.patient_id, v_case_id,
    'Post-discharge follow-up',
    'Contact the patient to confirm safe transition home, reconcile medications against the discharge summary (new/discontinued/dose changes/duplication), and review symptoms.',
    v_case_manager_id,
    new.discharged_on + 3,
    'active'
  );

  -- AFTER triggers can't mutate NEW in place — stamp the link with an
  -- explicit UPDATE, same pattern as private.notify_unacknowledged_emergencies.
  update public.patient_hospital_admissions
    set discharge_review_alert_id = v_alert_id
    where id = new.id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    coalesce((select auth.uid()), new.patient_id),
    'hospital_admission.discharged',
    'patient_hospital_admissions',
    new.id,
    jsonb_build_object('discharged_on', new.discharged_on, 'clinician_alert_id', v_alert_id, 'case_id', v_case_id)
  );

  return null;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'open_or_reuse_care_management_case'
  ) then
    raise exception 'private.open_or_reuse_care_management_case was not created';
  end if;
  if has_function_privilege('anon', 'private.open_or_reuse_care_management_case(uuid, uuid, public.care_management_entry_reason, text, uuid, uuid, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.open_or_reuse_care_management_case';
  end if;
  raise notice 'PASS: hospital admission/discharge triggers extended for Module 74 case open/reopen + post-discharge contact task';
end $$;
