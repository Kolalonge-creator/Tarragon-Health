-- The remaining three things a supporter could not do for someone whose
-- account they have open: report a danger symptom, log a hospital admission,
-- and fill in the health questions.
--
-- Founder confirmed 2026-08-01 that a family member SHOULD be able to raise a
-- danger-symptom alert on someone's behalf. That is the case this whole
-- feature exists for — an elderly parent having chest pain is very often not
-- the person holding the phone.
--
-- Which makes attribution load-bearing rather than tidy. Both alert bodies
-- currently assert the patient said it:
--
--     'Priority 1: emergency reported ... (source: %s)'
--     'Care plan review: patient reported a hospital admission'
--     '(Self-reported by the patient — not a clinician diagnosis.)'
--
-- If a son files either of those, that text is simply false, and a doctor
-- ringing about a Priority-1 emergency needs to know whether the patient
-- described their own chest pain or somebody else described it for them. Those
-- are different clinical pictures and they lead to different first questions.
-- So both alerts now name the reporter, and stop claiming the patient spoke.
--
-- The audit_log rows were writing actor_id = patient_id for the same reason,
-- which recorded the wrong person as having acted. Also fixed.

-- 1. Who actually entered it ---------------------------------------------------
alter table public.risk_assessment_responses
  add column if not exists logged_by_profile_id uuid references public.profiles(id);
alter table public.emergency_events
  add column if not exists logged_by_profile_id uuid references public.profiles(id);
alter table public.patient_hospital_admissions
  add column if not exists logged_by_profile_id uuid references public.profiles(id);

comment on column public.emergency_events.logged_by_profile_id is
  'Who reported this, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid(), never client-supplied. A doctor answering a Priority-1 alert needs to know whether the patient described their own symptom or somebody else described it for them.';

-- 2. Stamping, generalised ------------------------------------------------------
-- risk_assessment_responses keys on profile_id rather than patient_id, so the
-- subject column is now a trigger argument. Only the READ is dynamic: the
-- column being written is logged_by_profile_id on every table, so the
-- assignment stays static and checked.
create or replace function private.stamp_acting_supporter()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_subject uuid;
begin
  v_subject := (to_jsonb(new) ->> coalesce(tg_argv[0], 'patient_id'))::uuid;
  if v_subject is distinct from (select auth.uid()) then
    new.logged_by_profile_id := (select auth.uid());
  else
    new.logged_by_profile_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_acting_supporter on public.risk_assessment_responses;
create trigger stamp_acting_supporter
  before insert on public.risk_assessment_responses
  for each row execute function private.stamp_acting_supporter('profile_id');

drop trigger if exists stamp_acting_supporter on public.emergency_events;
create trigger stamp_acting_supporter
  before insert on public.emergency_events
  for each row execute function private.stamp_acting_supporter('patient_id');

drop trigger if exists stamp_acting_supporter on public.patient_hospital_admissions;
create trigger stamp_acting_supporter
  before insert on public.patient_hospital_admissions
  for each row execute function private.stamp_acting_supporter('patient_id');

-- 3. Let them write --------------------------------------------------------------
drop policy if exists risk_assessment_responses_insert_acting on public.risk_assessment_responses;
create policy risk_assessment_responses_insert_acting on public.risk_assessment_responses
  for insert to authenticated with check (private.can_act_for(profile_id));

drop policy if exists emergency_events_insert_acting on public.emergency_events;
create policy emergency_events_insert_acting on public.emergency_events
  for insert to authenticated with check (private.can_act_for(patient_id));

drop policy if exists patient_hospital_admissions_insert_acting on public.patient_hospital_admissions;
create policy patient_hospital_admissions_insert_acting on public.patient_hospital_admissions
  for insert to authenticated with check (private.can_act_for(patient_id));

-- Still no UPDATE or DELETE anywhere: a supporter adds to the record and can
-- never revise or remove it.

-- 4. Say who reported it -----------------------------------------------------------
-- The reporter is resolved from auth.uid() directly rather than from
-- new.logged_by_profile_id, so this does not depend on BEFORE-trigger firing
-- order (which is alphabetical by trigger name, and would put
-- emergency_events_raise_alert ahead of stamp_acting_supporter).
create or replace function private.handle_emergency_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_alert_id uuid;
  v_c_name  text;
  v_c_rel   text;
  v_c_phone text;
  v_contact_line text := '';
  v_actor uuid := (select auth.uid());
  v_reporter_line text := '';
begin
  -- Surface WHO the patient's emergency contact is (and their relationship) to
  -- the care team, so a doctor reviewing the Priority-1 alert knows who to
  -- expect / who was messaged. Read here (SECURITY DEFINER) from the patient's
  -- profile; omitted cleanly if no contact is on file.
  select emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
    into v_c_name, v_c_rel, v_c_phone
  from public.profiles where id = new.patient_id;
  if v_c_phone is not null then
    v_contact_line := format(' Emergency contact: %s%s — %s.',
      coalesce(v_c_name, 'on file'),
      case when v_c_rel is not null then ' (' || v_c_rel || ')' else '' end,
      v_c_phone);
  end if;

  -- Somebody reported this FOR the patient. The doctor must not assume they are
  -- about to speak to the person who described the symptom.
  if v_actor is not null and v_actor <> new.patient_id then
    v_reporter_line := format(' Reported by %s on the patient''s behalf, not by the patient themselves.',
      coalesce((select nullif(trim(full_name), '') from public.profiles where id = v_actor),
               'someone acting for them'));
  end if;

  if new.clinician_alert_id is null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'emergency',
      'open',
      'Priority 1: emergency reported',
      format('Emergency event (source: %s).%s%s%s',
             new.source,
             case when new.trigger_detail is not null then ' ' || new.trigger_detail else '' end,
             v_reporter_line,
             v_contact_line),
      now() + (private.escalation_sla_minutes('emergency_event', 'emergency') * interval '1 minute'),
      4
    )
    returning id into v_alert_id;

    -- id is already populated (column default fires before BEFORE triggers).
    new.clinician_alert_id := v_alert_id;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    -- Who actually did it, which is not always the patient.
    coalesce(v_actor, new.patient_id),
    'emergency_event.created',
    'emergency_events',
    new.id,
    jsonb_build_object('source', new.source, 'clinician_alert_id', new.clinician_alert_id,
                       'patient_id', new.patient_id)
  );

  return new;
end;
$$;

create or replace function private.handle_hospital_admission()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_alert_id uuid;
  v_dx_line  text := '';
  v_actor uuid := (select auth.uid());
  v_who text := 'Patient';
  v_source_note text := '(Self-reported by the patient — not a clinician diagnosis.)';
begin
  if v_actor is not null and v_actor <> new.patient_id then
    v_who := coalesce((select nullif(trim(full_name), '') from public.profiles where id = v_actor),
                      'Someone acting for the patient');
    v_source_note := format('(Reported by %s on the patient''s behalf — not a clinician diagnosis.)', v_who);
  end if;

  if new.self_reported_diagnosis is not null
     and length(btrim(new.self_reported_diagnosis)) > 0 then
    -- Always framed as reported, never presented as a clinical finding.
    v_dx_line := format(' Reported reason: %s.', new.self_reported_diagnosis);
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Care plan review: a hospital admission was reported',
    format('%s logged a hospital admission dated %s.%s Review whether the care plan needs updating. %s',
           v_who, new.admitted_on, v_dx_line, v_source_note),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    coalesce(v_actor, new.patient_id),
    'hospital_admission.created',
    'patient_hospital_admissions',
    new.id,
    jsonb_build_object('admitted_on', new.admitted_on, 'clinician_alert_id', new.clinician_alert_id,
                       'patient_id', new.patient_id)
  );

  return new;
end;
$$;

-- 5. Assert ------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('risk_assessment_responses','emergency_events',
                         'patient_hospital_admissions','vitals_readings','symptoms')
       and cmd in ('UPDATE','DELETE')
       and qual::text like '%can_act_for%'
  ) then
    raise exception 'a supporter must never be able to revise or delete the record';
  end if;

  -- The alerts must no longer state that the patient reported it as a fact.
  if pg_get_functiondef('private.handle_hospital_admission()'::regprocedure)
       like '%Self-reported by the patient — not a clinician diagnosis.)''%'
     and pg_get_functiondef('private.handle_hospital_admission()'::regprocedure) !~ 'v_source_note' then
    raise exception 'the admission alert still hard-codes the patient as the reporter';
  end if;
end $$;
