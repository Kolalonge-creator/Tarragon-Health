-- Tarragon Health — reschedule/cancel for the lab-result consultation fee
-- feature. Precedent check first (2026-08-30 founder follow-up): neither
-- video_visit_requests nor video_consultations has a real, live cancel/
-- reschedule mechanism to mirror. video_visit_requests only has
-- cancel_video_visit_request (patient withdraws BEFORE payment,
-- requested/pending_payment only — a raw RLS DELETE, dead code, never
-- called from any UI) and decline_video_visit_request (doctor declines
-- BEFORE acceptance). Neither covers an ALREADY-ACCEPTED, booked consult.
-- video_consultations' own migration (20260828000220) explicitly dropped a
-- planned cancel/no-show RPC because a separate, concurrent "Appointment
-- Engine" build (`appointments`, `provider_availability_rules`,
-- `reschedule_appointment`, 2026-08-28) was meant to own that. Checked live:
-- the Appointment Engine is entirely dormant (0 rows in `appointments`,
-- confirmed via execute_sql) and is explicitly off-limits for this feature
-- (PR #321/Appointment Engine guardrail) — so there is no real, active
-- system whose state this could disagree with. Building a narrow mechanism
-- scoped only to rows this feature's own accept flow creates is safe.
--
-- Three RPCs, matching the founder's own three cases:
--   1. reschedule_lab_result_consult_request — doctor moves an accepted
--      request's scheduled_at. Re-runs the SAME cross-system conflict check
--      accept uses (private.lab_result_consult_slot_conflict), excluding the
--      request's own current booking from that check. Clears the Zoom
--      fields so the app layer knows to mint a fresh meeting at the new time
--      (this codebase has no "update an existing Zoom meeting" call
--      anywhere yet — creating a new one matches the only pattern that
--      exists, rather than inventing an unused Zoom API integration).
--   2. release_lab_result_consult_request — doctor gives up an accepted
--      request without a replacement time. Returns it to the unclaimed
--      queue (status reverts to document_uploaded if a result was already
--      uploaded, else payment_confirmed — derived from
--      lab_result_document_id, no new column needed), cancels the booked
--      video_consultations row, does NOT touch the patient's paid fee (they
--      paid for the review/upload entitlement, not a specific doctor or
--      time — same principle as claim/settle never refunding on release).
--   3. cancel_lab_result_consult_request — PATIENT cancels their own
--      request outright, at any point before a terminal status. No refund
--      (matches this platform's existing non-refundable-mid-period posture
--      — e.g. subscription.disable/customer.subscription.updated in the
--      payment webhooks never refund, they just stop the NEXT renewal).
--      Moves straight to the existing terminal 'cancelled' status (already
--      in the enum from the very first migration in this feature — no enum
--      change needed here) and cancels the booked video_consultations row
--      if one existed. This is genuinely new capability, not mirrored from
--      video_visit_requests (whose own patient-cancel is delete-only and
--      pre-payment-only) — designed fresh but consistent with the
--      no-refund convention above.

create or replace function public.reschedule_lab_result_consult_request(
  p_request_id uuid,
  p_new_scheduled_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_profile_id uuid := (select auth.uid());
  v_req record;
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
    raise exception 'only an active clinician on this organisation''s care team can reschedule a lab-result consult request'
      using errcode = '42501';
  end if;

  if v_req.status <> 'accepted' or v_req.video_consultation_id is null then
    raise exception 'this request has no booked consult to reschedule (status: %)', v_req.status
      using errcode = '23514';
  end if;

  if p_new_scheduled_at is null or p_new_scheduled_at <= now() then
    raise exception 'pick a date and time in the future' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('lab_result_consult_accept:' || v_staff::text, 0));

  select private.lab_result_consult_slot_conflict(
    v_profile_id, v_staff, p_new_scheduled_at, v_req.video_consultation_id
  ) into v_conflict;
  if v_conflict then
    raise exception 'you already have a consult booked overlapping that time — pick a different slot'
      using errcode = '23514';
  end if;

  update public.video_consultations
    set scheduled_at = p_new_scheduled_at,
        zoom_meeting_id = null,
        join_url = null,
        host_start_url = null
    where id = v_req.video_consultation_id
      and status = 'scheduled';
  if not found then
    raise exception 'the booked consult is no longer scheduled (it may already be completed or cancelled)'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.release_lab_result_consult_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_req record;
  v_revert_status public.lab_result_consult_request_status;
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
    raise exception 'only an active clinician on this organisation''s care team can release a lab-result consult request'
      using errcode = '42501';
  end if;

  if v_req.status <> 'accepted' then
    raise exception 'this request is not currently accepted (status: %)', v_req.status
      using errcode = '23514';
  end if;

  v_revert_status := case when v_req.lab_result_document_id is not null then 'document_uploaded' else 'payment_confirmed' end;

  if v_req.video_consultation_id is not null then
    update public.video_consultations
      set status = 'cancelled'
      where id = v_req.video_consultation_id
        and status = 'scheduled';
  end if;

  update public.lab_result_consult_requests
    set status = v_revert_status,
        accepted_by = null,
        accepted_at = null,
        video_consultation_id = null
    where id = v_req.id;
end;
$$;

create or replace function public.cancel_lab_result_consult_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  select r.* into v_req from public.lab_result_consult_requests r
    where r.id = p_request_id and r.patient_id = (select auth.uid())
    for update;
  if v_req.id is null then
    raise exception 'request not found' using errcode = '42501';
  end if;

  if v_req.status in ('cancelled', 'refunded', 'expired') then
    raise exception 'this request is already %', v_req.status using errcode = '23514';
  end if;

  if v_req.video_consultation_id is not null then
    update public.video_consultations
      set status = 'cancelled'
      where id = v_req.video_consultation_id
        and status = 'scheduled';
  end if;

  update public.lab_result_consult_requests
    set status = 'cancelled'
    where id = v_req.id;
end;
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant —
-- must revoke from public, not merely omit a grant to anon (recurring
-- gotcha in this codebase, see CLAUDE.md).
revoke execute on function public.reschedule_lab_result_consult_request(uuid, timestamptz) from public, anon;
revoke execute on function public.release_lab_result_consult_request(uuid) from public, anon;
revoke execute on function public.cancel_lab_result_consult_request(uuid) from public, anon;
grant execute on function public.reschedule_lab_result_consult_request(uuid, timestamptz) to authenticated;
grant execute on function public.release_lab_result_consult_request(uuid) to authenticated;
grant execute on function public.cancel_lab_result_consult_request(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.reschedule_lab_result_consult_request(uuid, timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.release_lab_result_consult_request(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cancel_lab_result_consult_request(uuid)', 'EXECUTE')
  then
    raise exception 'FAIL: anon can execute one of the reschedule/release/cancel RPCs';
  end if;
end $$;
