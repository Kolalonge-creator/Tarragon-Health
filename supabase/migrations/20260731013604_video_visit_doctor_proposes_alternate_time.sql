-- Founder ask 2026-07-31: "a doctor will accept within 24 hours and arrange
-- a convenient time to do a video call with the patient." Two changes:
--   1. The doctor-acceptance window tightens to 24h (cron + copy, app-layer,
--      not this migration).
--   2. A doctor no longer has to choose between booking the patient's exact
--      requested slot or declining outright -- they can propose up to 3
--      alternative published times instead, and the patient picks one. The
--      original accept/decline paths are untouched; this is a genuinely
--      additive third option living alongside them, same "tighten, never
--      remove" discipline as every prior narrowing pass in this file.
--
-- Money-safety note: proposing alternates does NOT touch the held payment --
-- it only exists while status is 'payment_confirmed'/'alternate_proposed',
-- so the refund cron's existing "declined/expired -> refund" logic is
-- completely unaffected by this addition.

alter table public.video_visit_requests
  add column if not exists proposed_slot_ids uuid[],
  add column if not exists proposed_by uuid references public.clinical_staff (id) on delete set null,
  add column if not exists proposed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Doctor proposes 1-3 alternate times instead of accepting the patient's
-- original request outright. Same forge-proof doctor-tier gate as
-- accept/decline. Callable again from 'alternate_proposed' too (a doctor can
-- refresh the offer if the first set of times has gone stale), which resets
-- proposed_at and gives the patient a fresh selection window.
-- ---------------------------------------------------------------------------
create or replace function public.propose_video_visit_alternate_slots(p_request_id uuid, p_slot_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_req record;
  v_bad_count int;
begin
  if p_slot_ids is null or array_length(p_slot_ids, 1) is null then
    raise exception 'propose at least one alternate time';
  end if;
  if array_length(p_slot_ids, 1) > 3 then
    raise exception 'propose at most 3 alternate times';
  end if;

  select r.* into v_req from public.video_visit_requests r where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'request not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_req.organisation_id
    and cs.active
    and cs.doctor_tier is not null;
  if v_staff is null then
    raise exception 'only an active doctor on this organisation''s care team can propose alternate times'
      using errcode = '42501';
  end if;

  if v_req.status not in ('payment_confirmed', 'alternate_proposed') then
    raise exception 'this request is not awaiting a time (status: %)', v_req.status;
  end if;

  select count(*) into v_bad_count
  from unnest(p_slot_ids) as s(slot_id)
  where not exists (
    select 1 from public.consult_availability_slots cas
    where cas.id = s.slot_id
      and cas.organisation_id = v_req.organisation_id
      and cas.booked_consultation_id is null
      and cas.slot_start > now()
  );
  if v_bad_count > 0 then
    raise exception 'one or more proposed times are no longer available';
  end if;

  update public.video_visit_requests
    set status = 'alternate_proposed',
        proposed_slot_ids = p_slot_ids,
        proposed_by = v_staff,
        proposed_at = now()
    where id = v_req.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Patient picks one of the doctor's proposed alternate times. Ownership is
-- enforced structurally (r.patient_id = auth.uid() in the row lookup itself,
-- not a bolt-on check), and the chosen slot is re-validated + row-locked
-- before booking, same atomicity as accept_video_visit_request.
-- ---------------------------------------------------------------------------
create or replace function public.select_video_visit_alternate_slot(p_request_id uuid, p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_slot record;
  v_consult uuid;
begin
  select r.* into v_req
  from public.video_visit_requests r
  where r.id = p_request_id and r.patient_id = (select auth.uid())
  for update;
  if v_req.id is null then
    raise exception 'request not found' using errcode = '42501';
  end if;

  if v_req.status <> 'alternate_proposed' then
    raise exception 'this request has no offered times to pick from (status: %)', v_req.status;
  end if;
  if v_req.proposed_slot_ids is null or not (p_slot_id = any(v_req.proposed_slot_ids)) then
    raise exception 'that time was not one of the offered options';
  end if;

  select * into v_slot from public.consult_availability_slots where id = p_slot_id for update;
  if v_slot.id is null or v_slot.booked_consultation_id is not null then
    raise exception 'that time is no longer available -- ask your doctor to offer another time';
  end if;
  if v_slot.slot_start <= now() then
    raise exception 'that time has already passed -- ask your doctor to offer another time';
  end if;

  insert into public.video_consultations
    (organisation_id, patient_id, context, initiated_by, status, scheduled_at, patient_confirmed_at)
  values
    (v_req.organisation_id, v_req.patient_id, 'general_checkin', v_req.patient_id, 'scheduled', v_slot.slot_start, now())
  returning id into v_consult;

  update public.consult_availability_slots
    set booked_consultation_id = v_consult
    where id = v_slot.id;

  update public.video_visit_requests
    set status = 'accepted',
        slot_id = p_slot_id,
        accepted_by = v_req.proposed_by,
        accepted_at = now(),
        video_consultation_id = v_consult
    where id = v_req.id;

  return v_consult;
end;
$$;

-- decline_video_visit_request widened to also work from 'alternate_proposed'
-- (a doctor can still withdraw the offer outright -- e.g. no longer
-- available -- rather than leaving it to time out). Every other line is
-- byte-identical to the live definition pulled via pg_get_functiondef before
-- this migration was written.
create or replace function public.decline_video_visit_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_req record;
begin
  select r.* into v_req from public.video_visit_requests r where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'request not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_req.organisation_id
    and cs.active
    and cs.doctor_tier is not null;
  if v_staff is null then
    raise exception 'only an active doctor on this organisation''s care team can decline a video visit'
      using errcode = '42501';
  end if;

  if v_req.status not in ('payment_confirmed', 'alternate_proposed') then
    raise exception 'this request is not awaiting acceptance (status: %)', v_req.status;
  end if;

  update public.video_visit_requests
    set status = 'declined',
        declined_reason = nullif(btrim(coalesce(p_reason, '')), ''),
        -- Only a real captured payment has anything to reverse.
        refund_status = case when v_req.payment_provider_ref is not null then 'due' else null end
    where id = v_req.id;
end;
$$;

revoke execute on function public.propose_video_visit_alternate_slots(uuid, uuid[]) from public, anon;
revoke execute on function public.select_video_visit_alternate_slot(uuid, uuid) from public, anon;
grant execute on function public.propose_video_visit_alternate_slots(uuid, uuid[]) to authenticated;
grant execute on function public.select_video_visit_alternate_slot(uuid, uuid) to authenticated;

-- Assertion: anon must be denied on both new RPCs (the corrected form --
-- revoke ... from public is what actually strips anon's inherited EXECUTE,
-- per the anon-execute gotcha this codebase has re-learned more than once).
do $$
begin
  if has_function_privilege('anon', 'public.propose_video_visit_alternate_slots(uuid, uuid[])', 'EXECUTE') then
    raise exception 'anon must not execute propose_video_visit_alternate_slots';
  end if;
  if has_function_privilege('anon', 'public.select_video_visit_alternate_slot(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon must not execute select_video_visit_alternate_slot';
  end if;
end $$;
