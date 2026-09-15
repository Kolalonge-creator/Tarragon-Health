-- Tarragon Health — the doctor-side accept flow: turns a paid
-- lab_result_consult_requests row into an actual booked video_consultations
-- row for the 15-minute doctor walkthrough. Founder's own words: "doctors
-- should be able to get queue of the request pending, then they can select
-- time and date that they are free for the consult and the video link can
-- then be generated."
--
-- Deliberately NOT the consult_availability_slots pre-published-slot model
-- video_visit_requests uses — that model exists because a PATIENT picks from
-- a doctor's pre-published slots at request time. Here the patient never
-- picks a slot (they just pay); the doctor supplies an arbitrary future
-- timestamp directly when they get to the request in their queue. Simpler,
-- and a direct match for the founder's own description — no slot-negotiation
-- model to route through.
--
-- public.*, not private.*, for the same PostgREST-exposed-schema reason as
-- claim_lab_result_consult_credit/settle_lab_result_consult_claim (see
-- 20260830085517's header) — a clinician session calling
-- supabase.rpc('accept_lab_result_consult_request', ...) can only ever reach
-- a public.* function.
--
-- Authority: any ACTIVE clinical_staff member of the same organisation whose
-- doctor_tier is set and is not 'care_coordinator' — a floor, not a fence
-- (matches the tier-ladder monotonicity precedent: gates are "tier N+" never
-- a specific required tier, and care_coordinator is excluded by name, not by
-- tier level, since it sits in the same enum). This is routine first-line
-- review/scheduling, not prescribing or emergency-escalation authority, so
-- neither private.has_prescribing_authority nor
-- private.can_handle_emergency_escalation applies — same authority shape as
-- markResultDocumentReviewed's existing clinical_staff-active check.
--
-- Double-booking: an advisory transaction lock keyed on the accepting
-- clinical_staff id serializes concurrent accept calls by the SAME doctor
-- (two different doctors accepting different requests never block each
-- other), then a plain overlap check against that doctor's OTHER accepted
-- lab_result_consult_requests rejects a second booking whose
-- [scheduled_at, scheduled_at + 15 minutes) window overlaps an existing one.
-- Scoped to this feature's own bookings only — video_visit_requests is a
-- separate, pre-existing booking system with no shared "doctor's calendar"
-- abstraction to check against, and building one is out of scope here (see
-- PR description).
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
  where cs.profile_id = (select auth.uid())
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

  -- Serialize concurrent accepts by the SAME doctor before checking for a
  -- clash, so two simultaneous accept calls can't both pass the check
  -- against a stale view of "what I already have booked."
  perform pg_advisory_xact_lock(hashtextextended('lab_result_consult_accept:' || v_staff::text, 0));

  select exists (
    select 1
    from public.lab_result_consult_requests r2
    join public.video_consultations vc on vc.id = r2.video_consultation_id
    where r2.accepted_by = v_staff
      and r2.status = 'accepted'
      and vc.status = 'scheduled'
      and vc.scheduled_at < (p_scheduled_at + interval '15 minutes')
      and p_scheduled_at < (vc.scheduled_at + interval '15 minutes')
  ) into v_conflict;

  if v_conflict then
    raise exception 'you already have a lab-result consult booked overlapping that time — pick a different slot'
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

-- anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant —
-- must revoke from public, not merely omit a grant to anon (recurring
-- gotcha in this codebase, see CLAUDE.md).
revoke execute on function public.accept_lab_result_consult_request(uuid, timestamptz) from public, anon;
grant execute on function public.accept_lab_result_consult_request(uuid, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.accept_lab_result_consult_request(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute accept_lab_result_consult_request';
  end if;
end $$;
