-- Tarragon Health — self-serve video-visit slot picker.
--
-- Generalises the annual-review propose/confirm handshake (clinician offers
-- 1-3 slots to one patient) into an open scheduling grid: a clinician
-- publishes availability windows, any patient in the org picks one — the One
-- Medical "book like a restaurant" UX. Booking runs through a security-definer
-- RPC so the patient never needs write access to the staff-owned
-- video_consultations table, and the slot flip + consult creation are atomic
-- (no double-booking under concurrency: the slot row is locked FOR UPDATE).
-- The Zoom meeting itself is created best-effort by the app layer afterwards,
-- exactly like confirmAnnualReviewSlot.

-- Relax the context↔link CHECK for the new self-serve context (the enum value
-- itself landed in 20260723103000): a general check-in links to a slot, not to
-- an escalation/referral/annual review.
alter table public.video_consultations
  drop constraint if exists video_consultations_context_link;
alter table public.video_consultations
  add constraint video_consultations_context_link check (
    (context = 'pre_referral_triage' and escalation_id is not null)
    or (context = 'specialist_consult' and specialist_referral_id is not null)
    or (context = 'annual_review' and annual_review_id is not null)
    or (context = 'general_checkin')
  );

create table public.consult_availability_slots (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  clinician_profile_id    uuid not null references public.profiles (id) on delete cascade,
  slot_start              timestamptz not null,
  slot_end                timestamptz not null,
  booked_consultation_id  uuid references public.video_consultations (id) on delete set null,
  created_at              timestamptz not null default now(),
  constraint consult_availability_slots_valid check (slot_end > slot_start),
  constraint consult_availability_slots_unique unique (clinician_profile_id, slot_start)
);

create index consult_availability_slots_org_open_idx
  on public.consult_availability_slots (organisation_id, slot_start)
  where booked_consultation_id is null;

alter table public.consult_availability_slots enable row level security;

-- Patients see open, future slots in their own org (that's the grid); staff
-- see and manage everything in theirs.
create policy consult_availability_slots_select on public.consult_availability_slots
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (
      organisation_id = private.current_org_id()
      and booked_consultation_id is null
      and slot_start > now()
    )
  );
create policy consult_availability_slots_insert on public.consult_availability_slots
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy consult_availability_slots_update on public.consult_availability_slots
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy consult_availability_slots_delete on public.consult_availability_slots
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.consult_availability_slots to authenticated;

-- Atomic booking. Returns the new consultation id.
create or replace function public.book_video_consult_slot(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_slot record;
  v_consult uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select organisation_id into v_org from public.profiles where id = v_uid;

  select * into v_slot
  from public.consult_availability_slots
  where id = p_slot_id
  for update;

  if v_slot.id is null or v_slot.organisation_id is distinct from v_org then
    raise exception 'slot not found';
  end if;
  if v_slot.booked_consultation_id is not null then
    raise exception 'that time was just taken — pick another slot';
  end if;
  if v_slot.slot_start <= now() then
    raise exception 'that time has passed — pick another slot';
  end if;

  insert into public.video_consultations
    (organisation_id, patient_id, context, initiated_by, status, scheduled_at, patient_confirmed_at)
  values
    (v_slot.organisation_id, v_uid, 'general_checkin', v_uid, 'scheduled', v_slot.slot_start, now())
  returning id into v_consult;

  update public.consult_availability_slots
    set booked_consultation_id = v_consult
    where id = p_slot_id;

  return v_consult;
end;
$$;

revoke execute on function public.book_video_consult_slot(uuid) from public, anon;
grant execute on function public.book_video_consult_slot(uuid) to authenticated;
