-- Tarragon Health — fix a real correctness gap in
-- accept_lab_result_consult_request's double-booking guard: it only checked
-- other lab_result_consult_requests bookings for the accepting clinician,
-- never video_visit_requests bookings for that SAME clinician. A doctor
-- could accept a lab-result consult at a time they already had a video
-- visit booked, or vice versa.
--
-- The real join back to a clinician identity for a video_visit_requests-
-- originated video_consultations row (checked live, not assumed): there is
-- no "assigned clinician" column on video_consultations itself — none of
-- accept_video_visit_request, select_video_visit_alternate_slot, or this
-- feature's own accept_lab_result_consult_request write one. The only path
-- is video_visit_requests.video_consultation_id (which video is this) ->
-- video_visit_requests.slot_id (confirmed live: select_video_visit_alternate_slot
-- updates slot_id to the FINALLY booked slot, so this is accurate even after
-- a doctor offered alternates and the patient picked a different one than
-- originally requested) -> consult_availability_slots.clinician_profile_id
-- (the doctor's own profiles.id).
--
-- Chose this join over adding a clinician_id column to video_consultations:
-- video_consultations is a shared table multiple flows write into (video
-- visits, pre-referral triage, specialist consults, annual reviews), and a
-- new column would need every one of those insert paths updated to stay
-- correct, plus a backfill. The join needs none of that and is exact for
-- every accepted video_visit_requests row today (both direct-accept and
-- alternate-selection paths always leave slot_id pointing at the real
-- booked slot once status = 'accepted').
--
-- Scoping limit, stated plainly (residual, not fixed here): this only
-- protects accept_lab_result_consult_request's OWN new bookings against
-- conflicting with an existing video-visit booking. It does NOT add the
-- mirror check to accept_video_visit_request/select_video_visit_alternate_slot
-- (checking against lab_result_consult_requests bookings) — that would mean
-- modifying the separate, pre-existing, actively-used video-visit RPCs
-- themselves, out of scope for this targeted fix. A doctor could in
-- principle still double-book by accepting a video-visit request at a time
-- that collides with an EXISTING lab-result-consult booking. Also residual:
-- the advisory lock below only serializes concurrent
-- accept/reschedule_lab_result_consult_request calls for the same doctor —
-- it does not (and cannot, without touching the video-visit RPCs) also
-- serialize against a concurrent accept_video_visit_request call for that
-- same doctor. Both flagged here and in the PR description rather than
-- silently assumed away.
create or replace function private.lab_result_consult_slot_conflict(
  p_clinician_profile_id uuid,
  p_staff_id uuid,
  p_scheduled_at timestamptz,
  p_exclude_video_consultation_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lab_result_consult_requests r2
    join public.video_consultations vc on vc.id = r2.video_consultation_id
    where r2.accepted_by = p_staff_id
      and r2.status = 'accepted'
      and vc.status = 'scheduled'
      and (p_exclude_video_consultation_id is null or vc.id <> p_exclude_video_consultation_id)
      and vc.scheduled_at < (p_scheduled_at + interval '15 minutes')
      and p_scheduled_at < (vc.scheduled_at + interval '15 minutes')
  ) or exists (
    select 1
    from public.video_visit_requests vr
    join public.consult_availability_slots s on s.id = vr.slot_id
    join public.video_consultations vc2 on vc2.id = vr.video_consultation_id
    where s.clinician_profile_id = p_clinician_profile_id
      and vr.status = 'accepted'
      and vc2.status = 'scheduled'
      and (p_exclude_video_consultation_id is null or vc2.id <> p_exclude_video_consultation_id)
      and vc2.scheduled_at < (p_scheduled_at + interval '15 minutes')
      and p_scheduled_at < (vc2.scheduled_at + interval '15 minutes')
  );
$$;

-- accept_lab_result_consult_request, re-created to call the shared,
-- cross-system helper above instead of its own narrower inline query.
-- Everything else (authority check, status guard, future-time guard, the
-- advisory lock, the video_consultations insert, the request update) is
-- unchanged from the original 20260830094648 version.
create or replace function public.accept_lab_result_consult_request(
  p_request_id uuid,
  p_scheduled_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_profile_id uuid := (select auth.uid());
  v_req record;
  v_consult uuid;
  v_conflict boolean;
begin
  select r.* into v_req from public.lab_result_consult_requests r where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'request not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = v_profile_id
    and cs.organisation_id = v_req.organisation_id
    and cs.active
    and cs.doctor_tier is not null
    and cs.doctor_tier <> 'care_coordinator';
  if v_staff is null then
    raise exception 'only an active clinician on this organisation''s care team can accept a lab-result consult request'
      using errcode = '42501';
  end if;

  if v_req.status not in ('payment_confirmed', 'document_uploaded') then
    raise exception 'this request is not awaiting acceptance (status: %)', v_req.status
      using errcode = '23514';
  end if;

  if p_scheduled_at is null or p_scheduled_at <= now() then
    raise exception 'pick a date and time in the future' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lab_result_consult_accept:' || v_staff::text, 0));

  select private.lab_result_consult_slot_conflict(v_profile_id, v_staff, p_scheduled_at)
    into v_conflict;
  if v_conflict then
    raise exception 'you already have a consult booked overlapping that time — pick a different slot'
      using errcode = '23514';
  end if;

  insert into public.video_consultations
    (organisation_id, patient_id, context, initiated_by, status, scheduled_at)
  values
    (v_req.organisation_id, v_req.patient_id, 'lab_result_consult', v_req.patient_id, 'scheduled', p_scheduled_at)
  returning id into v_consult;

  update public.lab_result_consult_requests
    set status = 'accepted',
        accepted_by = v_staff,
        accepted_at = now(),
        video_consultation_id = v_consult
    where id = v_req.id;

  return v_consult;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'lab_result_consult_slot_conflict' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'FAIL: private.lab_result_consult_slot_conflict was not created';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc where proname = 'accept_lab_result_consult_request' and pronamespace = 'public'::regnamespace)
     not like '%lab_result_consult_slot_conflict%' then
    raise exception 'FAIL: accept_lab_result_consult_request was not updated to use the shared conflict check';
  end if;
end $$;
