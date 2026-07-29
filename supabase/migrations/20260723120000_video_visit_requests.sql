-- Tarragon Health — paid, doctor-accepted video visits (founder rework of the
-- self-serve slot picker, 2026-07-23).
--
-- The instant-book model is replaced by request → pay → HOLD → doctor accepts
-- → booked:
--   * A patient requests a published slot and pays up front (same generic
--     booking-checkout machinery as lab/pharmacy/referral orders — the table
--     deliberately carries the exact column set that machinery drives:
--     status/'pending_payment'→'payment_confirmed', origin,
--     payment_provider(_ref), pending_payment_provider_ref).
--   * 'payment_confirmed' means the money is HELD on the platform — nothing
--     is booked yet, and the UI says so. Only a doctor's explicit acceptance
--     (accept_video_visit_request, forge-proof doctor-tier gate) creates the
--     video_consultations row, flips the slot, and lets the payment stand.
--   * Decline or 48h non-acceptance → the payment is refunded
--     (refund_status='due' drives the refund cron; Paystack refund API).
--   * This is VIDEO ONLY and explicitly not an emergency channel — the
--     patient UI carries the "depends on doctor availability" and "go to the
--     nearest emergency department" copy; nothing here touches the
--     abnormal-result or emergency pipelines.
--
-- The old public.book_video_consult_slot RPC (instant, unpaid booking) is
-- DROPPED — leaving it callable would let any patient bypass payment and
-- acceptance entirely.

drop function if exists public.book_video_consult_slot(uuid);

create type public.video_visit_request_status as enum (
  'requested',
  'pending_payment',
  'payment_confirmed',
  'accepted',
  'declined',
  'expired',
  'cancelled',
  'refunded'
);

-- Price book: platform default row (organisation_id null) with optional
-- per-org overrides — the same override shape as cohort_cost_model_constants.
-- Patients read it to see the price before paying; only admins write.
create table public.video_visit_prices (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references public.organisations (id) on delete cascade,
  amount_minor     bigint not null check (amount_minor > 0),
  currency         text not null default 'NGN' check (currency in ('NGN', 'GBP', 'USD')),
  is_enabled       boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  constraint video_visit_prices_org_unique unique (organisation_id)
);
create unique index video_visit_prices_default_idx
  on public.video_visit_prices ((organisation_id is null))
  where organisation_id is null;

alter table public.video_visit_prices enable row level security;
create policy video_visit_prices_select on public.video_visit_prices
  for select to authenticated using (true);
create policy video_visit_prices_write on public.video_visit_prices
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
grant select, insert, update, delete on public.video_visit_prices to authenticated;

-- PLACEHOLDER launch price (₦5,000) — founder to confirm/adjust via SQL or a
-- future admin control before real launch.
insert into public.video_visit_prices (organisation_id, amount_minor, currency)
values (null, 500000, 'NGN');

create table public.video_visit_requests (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  slot_id                       uuid references public.consult_availability_slots (id) on delete set null,
  note                          text,
  status                        public.video_visit_request_status not null default 'requested',
  origin                        text not null default 'patient_initiated',
  amount_minor                  bigint not null default 0,
  currency                      text not null default 'NGN',
  payment_provider              text,
  payment_provider_ref          text,
  pending_payment_provider_ref  text,
  refund_status                 text check (refund_status in ('due', 'refunded')),
  refund_ref                    text,
  accepted_by                   uuid references public.clinical_staff (id) on delete set null,
  accepted_at                   timestamptz,
  declined_reason               text,
  video_consultation_id         uuid references public.video_consultations (id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index video_visit_requests_org_status_idx
  on public.video_visit_requests (organisation_id, status, created_at);
create index video_visit_requests_patient_idx
  on public.video_visit_requests (patient_id, created_at desc);
create index video_visit_requests_pending_ref_idx
  on public.video_visit_requests (pending_payment_provider_ref)
  where pending_payment_provider_ref is not null;

create trigger video_visit_requests_set_updated_at
  before update on public.video_visit_requests
  for each row execute function private.set_updated_at();

-- The charge amount is ALWAYS server-derived from the price book — a patient
-- session inserting a doctored amount_minor is silently overwritten, and a
-- disabled/missing price book rejects the request outright.
create or replace function private.pin_video_visit_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
begin
  select p.amount_minor, p.currency, p.is_enabled into v_price
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.video_visit_prices where organisation_id = new.organisation_id
    union all
    select amount_minor, currency, is_enabled, 1
    from public.video_visit_prices where organisation_id is null
  ) p
  order by p.pri
  limit 1;

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'video visits are not available right now';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.refund_status := null;
  new.accepted_by := null;
  new.accepted_at := null;
  new.video_consultation_id := null;
  return new;
end;
$$;

create trigger video_visit_requests_pin_amount
  before insert on public.video_visit_requests
  for each row execute function private.pin_video_visit_amount();

alter table public.video_visit_requests enable row level security;

create policy video_visit_requests_select on public.video_visit_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy video_visit_requests_insert on public.video_visit_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
-- A patient may withdraw an unpaid request; everything after payment moves
-- through the RPCs/webhook/service-role paths, never a raw patient UPDATE.
create policy video_visit_requests_patient_cancel on public.video_visit_requests
  for delete to authenticated
  using (patient_id = (select auth.uid()) and status in ('requested', 'pending_payment'));
create policy video_visit_requests_staff_update on public.video_visit_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.video_visit_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Doctor acceptance — the ONLY path that turns a paid request into a booked
-- consultation. Forge-proof: the acting clinical_staff row is derived from
-- the caller's own session (doctor tier required — a Care Coordinator or
-- patient session gets 42501), the slot flip + consult creation are atomic,
-- and a taken/past slot fails cleanly so the doctor declines with a reason
-- instead.
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

  if v_req.status <> 'payment_confirmed' then
    raise exception 'this request is not awaiting acceptance (status: %)', v_req.status;
  end if;

  update public.video_visit_requests
    set status = 'declined',
        declined_reason = nullif(btrim(coalesce(p_reason, '')), ''),
        -- A real captured payment gets refunded; a capitated request has no
        -- payment event to reverse.
        refund_status = case when v_req.payment_provider_ref is not null then 'due' else null end
    where id = v_req.id;
end;
$$;

revoke execute on function public.accept_video_visit_request(uuid) from public, anon;
revoke execute on function public.decline_video_visit_request(uuid, text) from public, anon;
grant execute on function public.accept_video_visit_request(uuid) to authenticated;
grant execute on function public.decline_video_visit_request(uuid, text) to authenticated;
