-- Tarragon Health — Telemedicine Consultation Platform gap closure, part 1.
--
-- Closes the single most important gap found in a full audit of the
-- existing "Appointment Engine" (20260828000528 onward) and "Consultation
-- System" (20260827/28) work: a telemedicine appointment booked through the
-- general-purpose appointments table never got a Zoom meeting.
-- appointments.video_consultation_id existed but nothing ever set it — a
-- patient could confirm a "GP, telemedicine" booking and have nowhere to
-- actually join a call. video_consultations stays the one source of truth
-- for a Zoom meeting (join_url/host_start_url/zoom_meeting_id); this
-- migration only adds the missing bridge from an appointment into it.
--
-- Also adds the small set of genuinely-missing pieces the spec calls for
-- that have no existing equivalent: a consultation-specific identity
-- verification record (68.8 — distinct from the general identity_
-- verifications KYC table, which is optional/additive and not tied to a
-- specific call), a single call-state transition that keeps
-- video_consultations.status and the linked appointment.status in sync
-- (68.5/68.16), and a differentiated no-show reason (68.15 — technical
-- failure is deliberately NOT a third no_show value; it already has its own
-- recovery workflow via cancel_appointment, see the header note on
-- appointments.no_show_reason below).

-- ---------------------------------------------------------------------------
-- 68.8 identity verification, scoped to one consultation — who on the care
-- team actually confirmed this was the right patient before the clinical
-- conversation started. Deliberately separate from identity_verifications
-- (NIN/BVN/document KYC, additive/optional, never a blocker) — this is a
-- lightweight in-call check, not a KYC record.
-- ---------------------------------------------------------------------------
alter table public.video_consultations
  add column identity_verified_at timestamptz,
  add column identity_verified_by uuid references public.profiles (id) on delete set null;

comment on column public.video_consultations.identity_verified_at is
  '68.8 — set by confirm_consultation_identity() when a staff member on the call confirms this is the right patient. Null is a normal, common state (most calls never call this explicitly yet) — never treated as a blocker elsewhere in the schema.';

create or replace function public.confirm_consultation_identity(p_video_consultation_id uuid)
returns public.video_consultations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_consult public.video_consultations;
begin
  select * into v_consult from public.video_consultations where id = p_video_consultation_id for update;
  if v_consult.id is null then
    raise exception 'consultation not found';
  end if;
  if not private.is_org_staff(v_consult.organisation_id) then
    raise exception 'only care-team staff can confirm identity on a consultation'
      using errcode = '42501';
  end if;

  update public.video_consultations
    set identity_verified_at = now(), identity_verified_by = v_uid
    where id = p_video_consultation_id
    returning * into v_consult;

  return v_consult;
end;
$$;

revoke execute on function public.confirm_consultation_identity(uuid) from public, anon;
grant execute on function public.confirm_consultation_identity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 68.15 no-show differentiation. Only patient/clinician no-show live here —
-- a technical failure is not a no-show at all (both parties showed up); it
-- already has a real recovery workflow via cancel_appointment (68.14: end
-- the call, offer the freed slot to the waiting list, notify the patient),
-- so it is recorded there via cancellation_reason, not as a third no_show
-- value.
-- ---------------------------------------------------------------------------
alter table public.appointments
  add column no_show_reason text;

alter table public.appointments
  add constraint appointments_no_show_reason_valid check (
    no_show_reason is null or no_show_reason in ('patient_no_show', 'clinician_no_show')
  );

-- Widening from 2 to 3 params: create-or-replace does not retire the old
-- 2-arg signature (Postgres treats a different parameter list as a
-- different function), which would leave every existing 2-arg RPC call
-- ambiguous against the new one's defaulted 3rd param. Drop it explicitly.
drop function if exists public.advance_appointment_status(uuid, public.appointment_status);

create or replace function public.advance_appointment_status(
  p_appointment_id uuid,
  p_to public.appointment_status,
  p_no_show_reason text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_valid boolean := false;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  if p_to = 'checked_in' then
    v_valid := v_appt.status in ('booked', 'confirmed')
      and (v_appt.patient_id = v_uid or private.is_org_staff(v_appt.organisation_id));
  elsif p_to = 'in_progress' then
    v_valid := v_appt.status in ('checked_in', 'confirmed') and private.is_org_staff(v_appt.organisation_id);
  elsif p_to = 'completed' then
    v_valid := v_appt.status in ('in_progress', 'checked_in', 'confirmed', 'booked') and private.is_org_staff(v_appt.organisation_id);
  elsif p_to = 'no_show' then
    v_valid := v_appt.status in ('booked', 'confirmed', 'checked_in') and private.is_org_staff(v_appt.organisation_id);
    if v_valid and p_no_show_reason is not null and p_no_show_reason not in ('patient_no_show', 'clinician_no_show') then
      raise exception 'no_show_reason must be patient_no_show or clinician_no_show';
    end if;
  else
    raise exception 'unsupported target status: %', p_to;
  end if;

  if not v_valid then
    raise exception 'cannot move appointment from % to %', v_appt.status, p_to;
  end if;

  update public.appointments set
    status = p_to,
    checked_in_at = case when p_to = 'checked_in' then now() else checked_in_at end,
    started_at = case when p_to = 'in_progress' then now() else started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    no_show_marked_at = case when p_to = 'no_show' then now() else no_show_marked_at end,
    no_show_reason = case when p_to = 'no_show' then p_no_show_reason else no_show_reason end
  where id = p_appointment_id
  returning * into v_appt;

  return v_appt;
end;
$$;

comment on function public.advance_appointment_status(uuid, public.appointment_status, text) is
  '10.3 state machine, extended with 68.15 no-show differentiation: booked/confirmed -> checked_in (patient or staff) -> in_progress -> completed (staff only), or -> no_show (staff only, optionally tagged patient_no_show/clinician_no_show). Cancellation/reschedule are separate functions since they have their own side effects (refund flag, waiting-list offer); a technical failure during the call is recorded via cancel_appointment, not here.';

revoke execute on function public.advance_appointment_status(uuid, public.appointment_status, text) from public, anon;
grant execute on function public.advance_appointment_status(uuid, public.appointment_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The bridge: an appointment booked as telemedicine gets a real
-- video_consultations row (context='general_checkin', same context value
-- Consultation System's own general_checkin booking path already uses) the
-- first time either the patient or a clinician needs to join it. Idempotent
-- — safe to call every time "Join call" is clicked. video_consultations
-- stays staff-write-only (its own RLS, untouched); this is the one
-- SECURITY DEFINER door letting the booking patient trigger that write for
-- their own appointment, mirroring submit_consultation_prep's narrow-door
-- pattern.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_appointment_video_consultation(p_appointment_id uuid)
returns public.video_consultations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_consult public.video_consultations;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;
  if v_appt.patient_id <> v_uid and not private.is_org_staff(v_appt.organisation_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_appt.consultation_method <> 'telemedicine' then
    raise exception 'this appointment is not telemedicine';
  end if;
  if v_appt.status not in ('booked', 'confirmed', 'checked_in', 'in_progress') then
    raise exception 'this appointment is not in a joinable state';
  end if;

  if v_appt.video_consultation_id is not null then
    select * into v_consult from public.video_consultations where id = v_appt.video_consultation_id;
    if v_consult.id is not null then
      return v_consult;
    end if;
    -- video_consultation_id pointed at a row that no longer exists — fall
    -- through and create a fresh one rather than erroring.
  end if;

  insert into public.video_consultations (
    organisation_id, patient_id, context, initiated_by, scheduled_at, status
  ) values (
    v_appt.organisation_id, v_appt.patient_id, 'general_checkin', v_uid, v_appt.scheduled_for, 'scheduled'
  )
  returning * into v_consult;

  update public.appointments set video_consultation_id = v_consult.id where id = p_appointment_id;

  return v_consult;
end;
$$;

comment on function public.ensure_appointment_video_consultation(uuid) is
  '68.3/68.5 — bridges a telemedicine appointment (Appointment Engine) to a real video_consultations row (Zoom meeting record). Idempotent. The actual Zoom API call happens app-side afterward (server secrets aren''t available to a SQL function) — see apps/web/src/app/(dashboard)/patient/appointments/video-actions.ts.';

revoke execute on function public.ensure_appointment_video_consultation(uuid) from public, anon;
grant execute on function public.ensure_appointment_video_consultation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 68.5/68.16 — one call keeps video_consultations.status and its linked
-- appointment.status moving together, so a clinician clicking "Start call"/
-- "End call" on the new consultation screen can't leave the two disagreeing
-- (e.g. a call marked 'started' while the appointment is still 'confirmed').
-- Staff-only, same posture as video_consultations' own UPDATE policy and
-- advance_appointment_status's staff-gated transitions.
-- ---------------------------------------------------------------------------
create or replace function public.set_video_consultation_call_state(
  p_video_consultation_id uuid,
  p_status public.video_consultation_status
)
returns public.video_consultations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consult public.video_consultations;
  v_appt_id uuid;
begin
  select * into v_consult from public.video_consultations where id = p_video_consultation_id for update;
  if v_consult.id is null then
    raise exception 'consultation not found';
  end if;
  if not private.is_org_staff(v_consult.organisation_id) then
    raise exception 'only care-team staff can change a consultation''s call state'
      using errcode = '42501';
  end if;
  if p_status not in ('started', 'completed', 'cancelled') then
    raise exception 'unsupported call state: %', p_status;
  end if;

  update public.video_consultations
    set status = p_status,
        started_at = case when p_status = 'started' and started_at is null then now() else started_at end,
        ended_at = case when p_status in ('completed', 'cancelled') then now() else ended_at end
    where id = p_video_consultation_id
    returning * into v_consult;

  select id into v_appt_id from public.appointments where video_consultation_id = p_video_consultation_id;
  if v_appt_id is not null then
    if p_status = 'started' then
      perform public.advance_appointment_status(v_appt_id, 'in_progress');
    elsif p_status = 'completed' then
      perform public.advance_appointment_status(v_appt_id, 'completed');
    end if;
    -- 'cancelled' deliberately does not touch the appointment here — a
    -- technical-failure cancellation goes through cancel_appointment
    -- directly (68.14), which has its own refund/waiting-list side effects
    -- advance_appointment_status doesn't attempt.
  end if;

  return v_consult;
end;
$$;

comment on function public.set_video_consultation_call_state(uuid, public.video_consultation_status) is
  '68.5/68.16 — moves a video_consultations row through started/completed/cancelled and, when it is linked to an Appointment Engine row, advances that appointment''s status to match in the same call.';

revoke execute on function public.set_video_consultation_call_state(uuid, public.video_consultation_status) from public, anon;
grant execute on function public.set_video_consultation_call_state(uuid, public.video_consultation_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 68.4/68.9 — consultation_prep_bundle was missing two waterfall items the
-- spec explicitly lists (conditions, allergies) even though both tables
-- exist. Adding them here rather than a parallel read model.
-- ---------------------------------------------------------------------------
create or replace function public.consultation_prep_bundle(p_consultation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_consult record;
  v_result  jsonb;
begin
  select * into v_consult from public.video_consultations where id = p_consultation_id;
  if v_consult.id is null then
    raise exception 'consultation not found';
  end if;
  if not private.is_org_staff(v_consult.organisation_id) then
    raise exception 'only care-team staff can view a consultation prep bundle'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'reason', jsonb_build_object(
      'patient_prep_notes', v_consult.patient_prep_notes,
      'request_note', (
        select vr.note from public.video_visit_requests vr
        where vr.video_consultation_id = p_consultation_id
        limit 1
      )
    ),
    'active_conditions', (
      select coalesce(jsonb_agg(row_to_json(c) order by c.date_identified desc nulls last), '[]'::jsonb) from (
        select condition_name, status, severity, date_identified
        from public.patient_conditions
        where patient_id = v_consult.patient_id
          and status in ('suspected', 'under_investigation', 'active', 'controlled', 'uncontrolled')
      ) c
    ),
    'allergies', (
      select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) from (
        select allergen, reaction, severity
        from public.patient_allergies
        where patient_id = v_consult.patient_id
      ) a
    ),
    'recent_vitals', (
      select coalesce(jsonb_agg(row_to_json(v) order by v.taken_at desc), '[]'::jsonb) from (
        select vital_type, systolic, diastolic, glucose_mmol_l, weight_kg, pulse_bpm, temperature_c, spo2_pct, taken_at
        from public.vitals_readings
        where patient_id = v_consult.patient_id
        order by taken_at desc
        limit 5
      ) v
    ),
    'active_medications', (
      select coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) from (
        select drug_name, dose, frequency, refill_date
        from public.medications
        where patient_id = v_consult.patient_id and is_active
        order by drug_name
      ) m
    ),
    'recent_results', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.created_at desc), '[]'::jsonb) from (
        select result_status, result_summary, abnormal_flags, created_at
        from public.screening_results
        where patient_id = v_consult.patient_id
        order by created_at desc
        limit 5
      ) r
    ),
    'care_gaps', (
      select coalesce(jsonb_agg(row_to_json(g)), '[]'::jsonb) from (
        select gap_type, condition_or_type, opened_at
        from public.patient_care_gaps
        where patient_id = v_consult.patient_id
      ) g
    ),
    'active_care_plans', (
      select coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) from (
        select condition, status, created_at
        from public.care_plans
        where patient_id = v_consult.patient_id and status = 'active'
      ) c
    ),
    'previous_consultations', (
      select coalesce(jsonb_agg(row_to_json(p) order by p.encounter_date desc), '[]'::jsonb) from (
        select encounter_type, encounter_date, diagnosis, outcome
        from public.clinical_encounter_notes
        where patient_id = v_consult.patient_id
          and status = 'finalized'
          and (video_consultation_id is null or video_consultation_id <> p_consultation_id)
        order by encounter_date desc
        limit 5
      ) p
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.consultation_prep_bundle(uuid) is
  'Consultation System §9.5 provider preparation, extended for 68.4/68.9: reason, active conditions, allergies, recent vitals, active medications, recent results, open care gaps, active care plans, and prior finalized encounters for the patient in one read-only staff-gated call. A deterministic read model, not a new source of truth.';

revoke execute on function public.consultation_prep_bundle(uuid) from public, anon;
grant execute on function public.consultation_prep_bundle(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ensure_appointment_video_consultation(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_video_consultation_call_state(uuid, public.video_consultation_status)', 'EXECUTE')
    or has_function_privilege('anon', 'public.confirm_consultation_identity(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.advance_appointment_status(uuid, public.appointment_status, text)', 'EXECUTE')
  then
    raise exception 'FAIL: anon can execute a telemedicine-consultation RPC';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'video_consultations' and column_name = 'identity_verified_at'
  ) then
    raise exception 'FAIL: video_consultations.identity_verified_at missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'no_show_reason'
  ) then
    raise exception 'FAIL: appointments.no_show_reason missing';
  end if;
  raise notice 'PASS: telemedicine consultation screen RPCs in place, anon denied on all of them';
end $$;
