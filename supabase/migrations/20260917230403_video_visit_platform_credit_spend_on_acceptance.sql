-- Tarragon Health — Platform Credit pays for Video Visit bookings, part 3:
-- the actual spend, wired into the moment a doctor turns a HELD request
-- into a real booking.
--
-- private.pay_video_visit_request_on_platform_credit is the platform-credit
-- twin of public.pay_service_purchase_on_platform_credit: lock the row,
-- verify it's in the right pre-acceptance state, read the pinned price,
-- call private.platform_credit_apply(..., p_entry_type := 'spend', ...),
-- then stamp payment_provider_ref with the resulting ledger entry id (same
-- role that column plays for the Paystack path, and the same "stamp the
-- ledger row's own id as the ref" idiom pay_service_purchase_on_platform_credit
-- already uses).
--
-- Deliberately `private`, NOT exposed to `authenticated` directly (unlike
-- pay_service_purchase_on_platform_credit, which a patient calls themselves
-- from the Buy dialog). A video visit's activation event is a DOCTOR
-- accepting it, not the patient triggering their own charge — so this is
-- called only from inside accept_video_visit_request/
-- select_video_visit_alternate_slot below, in the same transaction as the
-- rest of what "accepting" does (creating video_consultations, flipping the
-- slot, stamping accepted_by/accepted_at). If the spend fails (TH001,
-- balance moved between request time and acceptance — request time only
-- ever checked the balance, see the first migration in this set), the whole
-- acceptance rolls back: no consultation is created, no slot is flipped,
-- and the request stays 'payment_confirmed' for the doctor to retry or
-- decline (a decline of an UNSPENT platform-credit request needs no refund
-- — payment_provider_ref is still null at that point, exactly like an
-- unaccepted request that expires).
create or replace function private.pay_video_visit_request_on_platform_credit(
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.video_visit_requests%rowtype;
  v_ledger_entry_id uuid;
begin
  -- Already locked FOR UPDATE by the caller (accept_video_visit_request /
  -- select_video_visit_alternate_slot) in the same transaction — re-taking
  -- the same row lock here is a no-op, never a deadlock.
  select * into v_req from public.video_visit_requests where id = p_request_id for update;
  if not found then
    raise exception 'video visit request not found';
  end if;
  if v_req.payment_provider is distinct from 'platform_credit' then
    raise exception 'this request is not funded by platform credit';
  end if;
  if v_req.status not in ('payment_confirmed', 'alternate_proposed') then
    raise exception 'this request is not awaiting acceptance (status: %)', v_req.status;
  end if;
  if v_req.payment_provider_ref is not null then
    -- Idempotent: a request already spent (e.g. a retried acceptance after
    -- a transient failure downstream of the spend) is never spent twice.
    return v_req.payment_provider_ref::uuid;
  end if;

  perform private.platform_credit_apply(
    p_patient_id := v_req.patient_id,
    p_organisation_id := v_req.organisation_id,
    p_entry_type := 'spend',
    p_amount_kobo := v_req.amount_minor,
    p_booking_order_id := v_req.id,
    p_booking_order_type := 'video_visit',
    p_description := 'Video visit'
  );

  select id into v_ledger_entry_id from public.platform_credit_ledger_entries
    where booking_order_id = v_req.id and booking_order_type = 'video_visit'
    order by created_at desc limit 1;

  update public.video_visit_requests
    set payment_provider_ref = v_ledger_entry_id::text
    where id = v_req.id;

  return v_ledger_entry_id;
end;
$$;

revoke all on function private.pay_video_visit_request_on_platform_credit(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- accept_video_visit_request — unchanged doctor-tier/status/slot checks;
-- the only addition is the platform-credit spend, inserted after those
-- checks pass and before the video_consultations row is created, so an
-- insufficient-balance failure aborts the whole acceptance atomically
-- rather than leaving a booked-but-unpaid visit or a spent-but-unbooked
-- charge.
-- ---------------------------------------------------------------------------
create or replace function public.accept_video_visit_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_req record;
  v_slot record;
  v_consult uuid;
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
    raise exception 'only an active doctor on this organisation''s care team can accept a video visit'
      using errcode = '42501';
  end if;

  if v_req.status <> 'payment_confirmed' then
    raise exception 'this request is not awaiting acceptance (status: %)', v_req.status;
  end if;
  if v_req.slot_id is null then
    raise exception 'this request has no slot attached — decline it with a note instead';
  end if;

  select * into v_slot from public.consult_availability_slots where id = v_req.slot_id for update;
  if v_slot.id is null or v_slot.booked_consultation_id is not null then
    raise exception 'that slot is no longer available — decline and ask the patient to pick another time';
  end if;
  if v_slot.slot_start <= now() then
    raise exception 'that time has already passed — decline so the patient is refunded';
  end if;

  -- Platform-credit-funded requests are spent HERE, at acceptance — not at
  -- request time (see this migration set's first file). A Paystack-funded
  -- request already had its money captured at checkout, so there is
  -- nothing further to charge on this path for it.
  if v_req.payment_provider = 'platform_credit' then
    perform private.pay_video_visit_request_on_platform_credit(v_req.id);
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
        accepted_by = v_staff,
        accepted_at = now(),
        video_consultation_id = v_consult
    where id = v_req.id;

  return v_consult;
end;
$$;

revoke execute on function public.accept_video_visit_request(uuid) from public, anon;
grant execute on function public.accept_video_visit_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- select_video_visit_alternate_slot — the other path that turns a HELD
-- request into a real booking (a doctor already engaged by proposing
-- alternate times; the PATIENT picking one of them is the activation
-- moment here, not a separate doctor action). Needs the exact same spend
-- addition, for the exact same reason: this is a second, independent
-- "acceptance" code path that creates video_consultations/flips a slot
-- without ever going through accept_video_visit_request.
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

  if v_req.payment_provider = 'platform_credit' then
    perform private.pay_video_visit_request_on_platform_credit(v_req.id);
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

revoke execute on function public.select_video_visit_alternate_slot(uuid, uuid) from public, anon;
grant execute on function public.select_video_visit_alternate_slot(uuid, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.pay_video_visit_request_on_platform_credit(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.pay_video_visit_request_on_platform_credit';
  end if;
  if has_function_privilege('authenticated', 'private.pay_video_visit_request_on_platform_credit(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute private.pay_video_visit_request_on_platform_credit directly -- the spend must only ever happen through doctor acceptance';
  end if;
  raise notice 'PASS: video visit acceptance (both paths) now spends platform credit atomically with booking';
end $$;
