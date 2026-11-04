-- Outreach health checks on group screening days (founder decisions OD-01 to OD-04, 2026-11-03).
--
-- What the founder decided (docs/DECISIONS.md, "Outreach health checks"):
--   OD-01 Two outreach kinds ride on the existing group screening day: a FREE community check (vitals taken on the day, a
--         Tarragon account, and a lab form for the yearly panel) and a PAID outreach place (the same, plus one results
--         consultation with a doctor). Built on screening_days because it already carries one payer, a discount and Paystack.
--   OD-02 The paid place is 15,000 naira (1,500,000 kobo) a head, kept here as a versioned operational price (outreach_day_prices),
--         not as a literal in code. Changing it is a new version with a change note, not a signature.
--   OD-03 Tests start as SELF-ARRANGED: the attendee takes the lab form to any laboratory and pays that laboratory. No partner
--         lab, no Tarragon lab; nothing here names a provider, so the lab_booking_enabled master switch is not involved.
--         A Tarragon-run or partner lab on the day is phase 2 and is not built here.
--   OD-04 A paid place includes exactly ONE results consultation: an extra online meeting credit (video_visit_credit), active on
--         enrolment, used once, expiring after 60 days. This is a narrow exception to CON-07 (a Free patient cannot BUY a
--         consultation): the attendee does not buy it, the group's bulk payment covers it, and the Members-only purchase trigger
--         (which fires only on pending_payment) is untouched. hold_appointment_slot already lets a patient holding an unspent
--         credit book without Membership.
--
-- Shape of the change
--   1. screening_days.kind ('bundle' | 'outreach_free' | 'outreach_paid'). Every existing row is 'bundle' (live count before:
--      0 screening days of any kind, so nothing converts). panel_bundle_id is required for 'bundle' only.
--   2. The confirmed-has-pricing rule now lets a FREE day be confirmed with no price, no total and no payer.
--   3. outreach_day_prices: versioned per-head price, staff-readable, written only through set_outreach_day_price (admin).
--   4. create_outreach_day (staff), confirm_screening_day and add_screening_day_slot redefined from their LIVE bodies with an
--      outreach branch; the bundle branch is unchanged byte for byte in behaviour.
--   5. outreach_enrolments: one row per enrolled attendee holding the clinical links (lab order, consultation credit, vitals).
--      Kept OFF screening_day_slots on purpose: the slot is readable by the payer (often an employer), and I9 says an institution
--      sees aggregate counts only, never an individual's care. The enrolment is readable by the patient and by org staff only.
--   6. enrol_outreach_attendee: links a slot to the attendee's own account, creates (or reuses) a self-arranged yearly-panel lab
--      order, and on a paid day grants the consultation credit.
--   7. record_outreach_vitals: event staff record BP / glucose / weight / pulse / SpO2 into vitals_readings, the same way a testing
--      day does (taken_at = now(), so nothing is backdated, and every red-flag trigger fires exactly as for any other reading).
--   8. private.enforce_lab_order_origin redefined from its LIVE body: the yearly-panel exception also admits the outreach enrolment
--      path (session flag tarragon.outreach_enrol), exactly like the testing-day and annual-bundle paths already do.
--   9. Permission screening_days.run: run an outreach day on site (enrol attendees, record vitals) without the commercial
--      screening_days.manage permission that sets prices.
--
-- Not changed, deliberately: the bundle screening day, care vouchers, the lab booking master switch, the Members-only purchase
-- triggers, the CMO-signed result ranges, and how an uploaded result is reviewed or released.

-- ---------------------------------------------------------------------------
-- 0. Permission
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description)
values ('screening_days.run', 'Run an outreach health check', 'Operations',
        'On the day of an outreach check: register attendees, link them to their own Tarragon account, and record their vitals')
on conflict (key) do nothing;

create function private.can_run_outreach_day() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_admin() or private.has_permission('screening_days.manage') or private.has_permission('screening_days.run'); $$;
revoke all on function private.can_run_outreach_day() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1-2. Kind, and pricing rules that allow a free day
-- ---------------------------------------------------------------------------
alter table public.screening_days
  add column kind text not null default 'bundle' check (kind in ('bundle', 'outreach_free', 'outreach_paid'));

alter table public.screening_days alter column panel_bundle_id drop not null;
alter table public.screening_days add constraint screening_days_bundle_kind_has_bundle
  check ((kind = 'bundle') = (panel_bundle_id is not null));

alter table public.screening_days drop constraint screening_days_confirmed_has_pricing;
alter table public.screening_days add constraint screening_days_confirmed_has_pricing check (
  status = 'requested'
  or (kind = 'outreach_free'
      and slots_confirmed is not null
      and discount_percent is null and price_per_head_kobo is null and total_kobo is null)
  or (kind <> 'outreach_free'
      and slots_confirmed is not null and discount_percent is not null
      and price_per_head_kobo is not null and total_kobo is not null
      and payer_profile_id is not null)
);

comment on column public.screening_days.kind is
  'bundle = the original discounted test bundle with vouchers; outreach_free = free community check (vitals + lab form); outreach_paid = the same plus one results consultation, priced from outreach_day_prices (OD-01..OD-04, 2026-11-03).';

-- An enrolled outreach slot carries no voucher; its care links live in outreach_enrolments (below).
alter table public.screening_day_slots add column outreach_enrolled boolean not null default false;
alter table public.screening_day_slots drop constraint screening_day_slots_issued_has_voucher;
alter table public.screening_day_slots add constraint screening_day_slots_issued_has_voucher check (
  status <> 'issued' or (beneficiary_profile_id is not null and (voucher_id is not null or outreach_enrolled))
);

-- ---------------------------------------------------------------------------
-- 3. Versioned per-head price for a paid outreach place
-- ---------------------------------------------------------------------------
create table public.outreach_day_prices (
  version              integer primary key check (version > 0),
  price_per_head_kobo  bigint not null check (price_per_head_kobo > 0),
  is_active            boolean not null default false,
  change_note          text not null check (length(btrim(change_note)) >= 20),
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now()
);
create unique index outreach_day_prices_one_active on public.outreach_day_prices (is_active) where is_active;

alter table public.outreach_day_prices enable row level security;
create policy outreach_day_prices_select on public.outreach_day_prices
  for select to authenticated
  using (private.is_admin() or private.has_permission('screening_days.manage'));
grant select on public.outreach_day_prices to authenticated;

insert into public.outreach_day_prices (version, price_per_head_kobo, is_active, change_note)
values (1, 1500000, true,
        'Founder decision OD-02 (2026-11-03): a paid outreach place is 15,000 naira a head, covering the vitals check, the lab form and one results consultation. The attendee pays the laboratory separately.');

create function public.set_outreach_day_price(p_price_kobo bigint, p_change_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_version integer;
begin
  if v_caller is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_price_kobo is null or p_price_kobo <= 0 then raise exception 'the price must be more than zero' using errcode = '22023'; end if;
  if p_change_note is null or length(btrim(p_change_note)) < 20 then
    raise exception 'say why the price is changing (at least 20 characters)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('outreach_day_prices', 0));
  select coalesce(max(version), 0) + 1 into v_version from public.outreach_day_prices;
  update public.outreach_day_prices set is_active = false where is_active;
  insert into public.outreach_day_prices (version, price_per_head_kobo, is_active, change_note, created_by)
  values (v_version, p_price_kobo, true, btrim(p_change_note), v_caller);

  perform private.log_audit('outreach_day_price.set', 'outreach_day_prices', null,
    jsonb_build_object('version', v_version, 'price_per_head_kobo', p_price_kobo));
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4a. Create an outreach day (staff). A bundle day is still requested through request_screening_day.
-- ---------------------------------------------------------------------------
create function public.create_outreach_day(
  p_kind text,
  p_host_name text,
  p_contact_phone text,
  p_location text,
  p_event_date date,
  p_slots_requested integer,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_org uuid;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (private.is_admin() or private.has_permission('screening_days.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('outreach_free', 'outreach_paid') then
    raise exception 'choose a free community check or a paid outreach check' using errcode = '22023';
  end if;
  if p_slots_requested is null or p_slots_requested <= 0 then
    raise exception 'how many people are coming?' using errcode = '22023';
  end if;
  if p_event_date is null or p_event_date < private.lagos_today() then
    raise exception 'the event date cannot be in the past' using errcode = '22023';
  end if;
  if p_host_name is null or length(trim(p_host_name)) = 0 then
    raise exception 'who is this check for?' using errcode = '22023';
  end if;
  if p_location is null or length(trim(p_location)) = 0 then
    raise exception 'where will this happen?' using errcode = '22023';
  end if;

  select organisation_id into v_org from public.profiles where id = v_caller;

  insert into public.screening_days (
    organisation_id, requested_by, kind, host_name, contact_phone, location,
    event_date, panel_bundle_id, slots_requested, notes
  ) values (
    coalesce(v_org, '00000000-0000-0000-0000-000000000001'), v_caller, p_kind,
    trim(p_host_name), nullif(trim(coalesce(p_contact_phone, '')), ''), trim(p_location),
    p_event_date, null, p_slots_requested, nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'screening_day_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4b. Confirm (redefined from the LIVE body; the bundle branch is unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_screening_day(
  p_screening_day_id uuid,
  p_slots_confirmed integer,
  p_discount_percent numeric,
  p_payer_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_day public.screening_days%rowtype;
  v_bundle public.panel_bundles%rowtype;
  v_base_price bigint;
  v_price_per_head bigint;
  v_total bigint;
  v_payer uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('screening_days.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_day from public.screening_days where id = p_screening_day_id for update;
  if not found then raise exception 'screening day not found'; end if;
  if v_day.status <> 'requested' then
    raise exception 'only a requested screening day can be confirmed';
  end if;
  if p_slots_confirmed is null or p_slots_confirmed <= 0 then
    raise exception 'confirm at least one slot';
  end if;

  -- A free community check has nothing to price and nobody to pay.
  if v_day.kind = 'outreach_free' then
    update public.screening_days
       set slots_confirmed = p_slots_confirmed,
           status          = 'confirmed',
           confirmed_by    = v_caller,
           confirmed_at    = now(),
           updated_at      = now()
     where id = p_screening_day_id;
    return jsonb_build_object('ok', true, 'price_per_head_kobo', null, 'total_kobo', null);
  end if;

  if p_discount_percent is null or p_discount_percent < 0 or p_discount_percent >= 100 then
    raise exception 'discount must be between 0 and 100';
  end if;

  if v_day.kind = 'outreach_paid' then
    -- The payer pays from their own patient account in the app; never default to the staff member who created the day.
    if p_payer_profile_id is null
       or not exists (select 1 from public.profiles where id = p_payer_profile_id and role = 'patient' and is_active) then
      raise exception 'name the person who will pay: their own Tarragon account' using errcode = '22023';
    end if;
    select price_per_head_kobo into v_base_price from public.outreach_day_prices where is_active;
    if v_base_price is null then
      raise exception 'no price is set for a paid outreach check' using errcode = '22023';
    end if;
  else
    select * into v_bundle from public.panel_bundles where id = v_day.panel_bundle_id;
    if not found or not v_bundle.self_bookable or not v_bundle.is_active or v_bundle.price_kobo is null then
      raise exception 'that screening package is no longer available to book';
    end if;
    v_base_price := v_bundle.price_kobo;
  end if;

  v_price_per_head := round(v_base_price * (1 - p_discount_percent / 100.0));
  v_total := v_price_per_head * p_slots_confirmed;
  v_payer := coalesce(p_payer_profile_id, v_day.requested_by);

  update public.screening_days
     set slots_confirmed     = p_slots_confirmed,
         discount_percent    = p_discount_percent,
         price_per_head_kobo = v_price_per_head,
         total_kobo          = v_total,
         payer_profile_id    = v_payer,
         status              = 'confirmed',
         confirmed_by        = v_caller,
         confirmed_at        = now(),
         updated_at          = now()
   where id = p_screening_day_id;

  return jsonb_build_object('ok', true, 'price_per_head_kobo', v_price_per_head, 'total_kobo', v_total);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4c. Register an attendee (redefined from the LIVE body). A free day needs no payment; on-site staff may register too.
-- ---------------------------------------------------------------------------
create or replace function public.add_screening_day_slot(
  p_screening_day_id uuid,
  p_full_name text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_day public.screening_days%rowtype;
  v_count integer;
  v_phone text;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_day from public.screening_days where id = p_screening_day_id for update;
  if not found then raise exception 'screening day not found'; end if;
  if v_day.status <> 'confirmed' then
    raise exception 'this screening day is not confirmed yet';
  end if;
  if v_day.kind <> 'outreach_free'
     and (v_day.total_kobo is null or v_day.amount_paid_kobo < v_day.total_kobo) then
    raise exception 'this screening day has not been paid for in full yet';
  end if;
  if v_caller <> v_day.requested_by and v_caller is distinct from v_day.payer_profile_id
     and not private.is_org_staff(v_day.organisation_id)
     and not (v_day.kind <> 'bundle' and private.can_run_outreach_day()) then
    raise exception 'not authorised for this screening day' using errcode = '42501';
  end if;

  select count(*) into v_count from public.screening_day_slots
   where screening_day_id = p_screening_day_id and status <> 'removed';
  if v_count >= v_day.slots_confirmed then
    raise exception 'every paid slot for this screening day is already taken';
  end if;

  v_phone := case
    when p_phone is null or trim(p_phone) = '' then null
    when p_phone ~ '^\+' then trim(p_phone)
    else '+' || trim(p_phone)
  end;

  insert into public.screening_day_slots (
    screening_day_id, organisation_id, full_name, phone, added_by
  ) values (
    p_screening_day_id, v_day.organisation_id,
    nullif(trim(coalesce(p_full_name, '')), ''), v_phone, v_caller
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- A voucher belongs to a bundle day only; an outreach slot is enrolled instead.
create or replace function public.issue_screening_day_voucher(
  p_slot_id uuid,
  p_beneficiary_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_slot public.screening_day_slots%rowtype;
  v_day public.screening_days%rowtype;
  v_bundle public.panel_bundles%rowtype;
  v_beneficiary_org uuid;
  v_months integer;
  v_number text;
  v_voucher_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_slot from public.screening_day_slots where id = p_slot_id for update;
  if not found then raise exception 'slot not found'; end if;
  if v_slot.status <> 'unclaimed' then
    raise exception 'this slot has already been issued';
  end if;

  select * into v_day from public.screening_days where id = v_slot.screening_day_id for update;
  if not found then raise exception 'screening day not found'; end if;
  if not (private.is_admin() or private.has_permission('screening_days.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_day.kind <> 'bundle' then
    raise exception 'an outreach check has no voucher: enrol the attendee instead' using errcode = '22023';
  end if;
  if v_day.total_kobo is null or v_day.amount_paid_kobo < v_day.total_kobo then
    raise exception 'this screening day has not been paid for in full yet';
  end if;

  select organisation_id into v_beneficiary_org from public.profiles where id = p_beneficiary_profile_id;
  if v_beneficiary_org is null then raise exception 'that person has no Tarragon account yet'; end if;

  select * into v_bundle from public.panel_bundles where id = v_day.panel_bundle_id;
  if not found then raise exception 'that screening package no longer exists'; end if;

  select validity_months into v_months from public.care_voucher_config where id = true;
  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    panel_bundle_id, sku_code, sku_name,
    face_value_kobo, amount_paid_kobo, status, activated_at, expires_at, gift_message
  ) values (
    v_beneficiary_org, v_number, 'prepaid_service',
    p_beneficiary_profile_id, v_day.payer_profile_id,
    v_bundle.id, v_bundle.code, v_bundle.name,
    v_day.price_per_head_kobo, v_day.price_per_head_kobo, 'active', now(),
    now() + make_interval(months => v_months),
    'Screening day: ' || v_day.host_name
  )
  returning id into v_voucher_id;

  insert into public.care_voucher_events (organisation_id, voucher_id, event_type, actor_profile_id, note)
  values (v_beneficiary_org, v_voucher_id, 'created', v_caller,
          'Issued from the ' || v_day.host_name || ' screening day');

  update public.screening_day_slots
     set status = 'issued', beneficiary_profile_id = p_beneficiary_profile_id, voucher_id = v_voucher_id
   where id = p_slot_id;

  return jsonb_build_object('ok', true, 'voucher_id', v_voucher_id, 'voucher_number', v_number);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Enrolments: the attendee's care links, readable by the attendee and org staff only (I9)
-- ---------------------------------------------------------------------------
create table public.outreach_enrolments (
  slot_id               uuid primary key references public.screening_day_slots (id) on delete restrict,
  screening_day_id      uuid not null references public.screening_days (id) on delete restrict,
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete restrict,
  kind                  text not null check (kind in ('outreach_free', 'outreach_paid')),
  lab_order_id          uuid not null references public.lab_orders (id) on delete cascade,
  consult_purchase_id   uuid references public.service_purchases (id) on delete cascade,
  vitals_reading_ids    uuid[] not null default '{}',
  vitals_recorded_at    timestamptz,
  vitals_recorded_by    uuid references public.profiles (id) on delete restrict,
  enrolled_by           uuid not null references public.profiles (id) on delete restrict,
  enrolled_at           timestamptz not null default now(),
  constraint outreach_enrolments_paid_has_consult check ((kind = 'outreach_paid') = (consult_purchase_id is not null)),
  constraint outreach_enrolments_vitals_together check ((vitals_recorded_at is null) = (vitals_recorded_by is null))
);
create unique index outreach_enrolments_day_patient on public.outreach_enrolments (screening_day_id, patient_id);
create index outreach_enrolments_patient_idx on public.outreach_enrolments (patient_id);

alter table public.outreach_enrolments enable row level security;
create policy outreach_enrolments_select on public.outreach_enrolments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
grant select on public.outreach_enrolments to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Lab order origin (redefined from the LIVE body): the yearly-panel exception admits the outreach enrolment path too
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_lab_order_origin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_schedule public.screening_schedules%rowtype;
  v_screen_type_code text;
begin
  -- Fulfilment guard, deliberately ORTHOGONAL to origin and evaluated before
  -- the origin branching below (which early-returns for self-bookable bundles).
  -- Both a patient self-serving a Screen and a clinician ordering a test are
  -- legitimately self_arranged: what makes it self-arranged is that the patient
  -- takes it to a lab of their own choosing, not who decided it was needed.
  if new.fulfilment = 'self_arranged' then
    if new.provider_id is not null or new.facility_id is not null then
      raise exception 'A self-arranged lab order cannot name a partner provider or facility — the patient chooses their own lab'
        using errcode = '23514';
    end if;
    if coalesce(new.total_kobo, 0) <> 0 then
      raise exception 'A self-arranged lab order is not billed by Tarragon — the patient pays the lab directly (total_kobo must be 0)'
        using errcode = '23514';
    end if;
    if new.status = 'pending_payment' then
      raise exception 'A self-arranged lab order is never pending_payment — there is nothing for Tarragon to collect'
        using errcode = '23514';
    end if;
  end if;

  if new.origin = 'patient_initiated' then
    if new.ordered_by is not null then
      raise exception 'patient_initiated lab_orders cannot set ordered_by' using errcode = '23514';
    end if;

    -- Prevention front-door exception: an explicitly self-bookable bundle
    -- needs no schedule and must not carry one — the due-screening path below
    -- stays the only schedule-linked route.
    if exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.self_bookable
    ) then
      if new.screening_schedule_id is null then
        return new;
      end if;
      if coalesce(current_setting('tarragon.screening_request_job', true), '') <> 'on' or (select auth.uid()) is not null then
        raise exception 'Self-bookable bundles are ordered without a screening_schedule link' using errcode = '23514';
      end if;
    end if;

    if new.panel_code = 'membership_annual' and (coalesce(current_setting('tarragon.testing_day_checkin', true), '') = 'on' or coalesce(current_setting('tarragon.annual_bundle_start', true), '') = 'on') then
      return new;
    end if;

    -- OD-03: an outreach enrolment's yearly-panel lab form (self-arranged only). Kept as its own check so the line above stays
    -- byte-identical to its live text (plus_collection_states_and_annual_bundle.sql matches it exactly).
    if new.panel_code = 'membership_annual' and new.fulfilment = 'self_arranged'
       and coalesce(current_setting('tarragon.outreach_enrol', true), '') = 'on' then
      return new;
    end if;

    if new.screening_schedule_id is null then
      raise exception 'Self-service lab orders must be linked to a due screening_schedule — ad hoc tests require a clinician order'
        using errcode = '23514';
    end if;

    select * into v_schedule
    from public.screening_schedules
    where id = new.screening_schedule_id;

    if v_schedule.id is null or v_schedule.patient_id is distinct from new.patient_id then
      raise exception 'screening_schedule_id does not belong to this patient' using errcode = '23514';
    end if;

    if v_schedule.status not in ('pending', 'overdue') or v_schedule.due_date > current_date then
      raise exception 'This screening is not currently due for self-service booking' using errcode = '23514';
    end if;

    select code into v_screen_type_code
    from public.screen_types
    where id = v_schedule.screen_type_id;

    if not exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.test_codes = array[v_screen_type_code]
    ) then
      raise exception 'panel_bundle_id must be the single-test bundle matching the due screening' using errcode = '23514';
    end if;
  else
    if new.ordered_by is null then
      raise exception 'Non-self-service lab_orders must set ordered_by to the clinician who generated the order'
        using errcode = '23514';
    end if;

    if not exists (
      select 1 from public.clinical_staff cs
      where cs.id = new.ordered_by
        and cs.organisation_id = new.organisation_id
        and cs.active
    ) then
      raise exception 'ordered_by must reference an active clinical_staff member of the same organisation' using errcode = '23514';
    end if;

    -- New: module 57.3 — a clinician-generated order must record why. The
    -- self-service branch above never reaches here, so the due-screening path
    -- is untouched by this requirement.
    if new.clinical_indication is null or length(btrim(new.clinical_indication)) = 0 then
      raise exception 'Clinician-generated lab_orders must record a clinical_indication' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Enrol an attendee: their own account, a lab form, and (paid) one consultation credit
-- ---------------------------------------------------------------------------
create function public.enrol_outreach_attendee(p_slot_id uuid, p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_slot public.screening_day_slots%rowtype;
  v_day public.screening_days%rowtype;
  v_org uuid;
  v_role text;
  v_phone text;
  v_order uuid;
  v_product uuid;
  v_purchase uuid;
  v_reused boolean := false;
begin
  if v_caller is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.can_run_outreach_day() then raise exception 'not authorised' using errcode = '42501'; end if;

  select * into v_slot from public.screening_day_slots where id = p_slot_id for update;
  if not found then raise exception 'slot not found' using errcode = '22023'; end if;
  if v_slot.status <> 'unclaimed' then raise exception 'this attendee is already enrolled' using errcode = '22023'; end if;

  select * into v_day from public.screening_days where id = v_slot.screening_day_id for update;
  if v_day.kind not in ('outreach_free', 'outreach_paid') then
    raise exception 'only an outreach check enrols attendees' using errcode = '22023';
  end if;
  if v_day.status <> 'confirmed' then raise exception 'this outreach check is not confirmed' using errcode = '22023'; end if;
  if v_day.kind = 'outreach_paid' and (v_day.total_kobo is null or v_day.amount_paid_kobo < v_day.total_kobo) then
    raise exception 'this outreach check has not been paid for in full yet' using errcode = '22023';
  end if;

  select organisation_id, role::text, phone into v_org, v_role, v_phone from public.profiles where id = p_patient_id;
  if v_org is null or v_role <> 'patient' then
    raise exception 'that person needs their own Tarragon account first' using errcode = '22023';
  end if;
  -- Wrong-patient guard: readings and a lab order are about to land in this record, so a slot registered with a phone number
  -- may only be linked to the account holding that number.
  if v_slot.phone is not null and v_phone is distinct from v_slot.phone then
    raise exception 'that account''s phone number does not match the one this attendee registered with' using errcode = '22023';
  end if;
  if exists (select 1 from public.outreach_enrolments where screening_day_id = v_day.id and patient_id = p_patient_id) then
    raise exception 'that person is already enrolled at this check' using errcode = '22023';
  end if;

  -- The lab form: one self-arranged yearly panel. If they already hold an open one that nobody has acted on yet (an earlier
  -- outreach check), reuse it rather than give them a second form for the same tests. A panel already taken or resulted is not
  -- reused: they get a fresh form for this check.
  perform pg_advisory_xact_lock(hashtextextended('annual_bundle:' || p_patient_id::text, 0));
  select o.id into v_order from public.lab_orders o
   where o.patient_id = p_patient_id and o.panel_code = 'membership_annual'
     and o.fulfilment = 'self_arranged' and o.status = 'ordered' and o.ordered_at > now() - interval '330 days'
   order by o.ordered_at desc limit 1;
  if v_order is null then
    perform set_config('tarragon.outreach_enrol', 'on', true);
    insert into public.lab_orders (organisation_id, patient_id, status, panel_code, fulfilment, origin, total_kobo)
    values (v_org, p_patient_id, 'ordered', 'membership_annual', 'self_arranged', 'patient_initiated', 0)
    returning id into v_order;
    perform set_config('tarragon.outreach_enrol', 'off', true);
  else
    v_reused := true;
  end if;

  -- Paid place: one results consultation, already paid for by the group (OD-04). Active on grant, so the Members-only
  -- purchase trigger (pending_payment only) does not apply; it is used once and lapses after 60 days. amount_kobo is 0: the
  -- money was the group's payment, so the attendee's purchase history must not show a charge they never made, and nothing
  -- may count the same naira twice.
  if v_day.kind = 'outreach_paid' then
    select id into v_product from public.service_products where code = 'video_visit_credit';
    if v_product is null then raise exception 'the consultation product is missing' using errcode = '22023'; end if;
    insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
                                          amount_kobo, currency, voucher_covered_kobo, purchased_at, expires_at,
                                          scoped_entity_type, scoped_entity_id)
    values (v_org, p_patient_id, v_day.payer_profile_id, v_product, 'active',
            0, 'NGN', 0, now(), now() + interval '60 days',
            'screening_day_slot', p_slot_id)
    returning id into v_purchase;
  end if;

  insert into public.outreach_enrolments (slot_id, screening_day_id, organisation_id, patient_id, kind, lab_order_id,
                                          consult_purchase_id, enrolled_by)
  -- The day's organisation, so the staff who run the day can see who they enrolled (the patient reads it by patient_id).
  values (p_slot_id, v_day.id, v_day.organisation_id, p_patient_id, v_day.kind, v_order, v_purchase, v_caller);

  update public.screening_day_slots
     set status = 'issued', beneficiary_profile_id = p_patient_id, outreach_enrolled = true
   where id = p_slot_id;

  perform private.log_audit('outreach.attendee_enrolled', 'screening_day_slots', p_slot_id,
    jsonb_build_object('screening_day_id', v_day.id, 'kind', v_day.kind, 'lab_order_id', v_order,
                       'lab_order_reused', v_reused, 'consult_purchase_id', v_purchase));

  return jsonb_build_object('ok', true, 'lab_order_id', v_order, 'lab_order_reused', v_reused,
                            'consult_purchase_id', v_purchase);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Vitals on the day (same inserts as record_poc_measurements; every red-flag trigger applies)
-- ---------------------------------------------------------------------------
create function public.record_outreach_vitals(p_slot_id uuid, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := (select auth.uid());
  e public.outreach_enrolments%rowtype;
  v_w numeric := nullif(p_data ->> 'weight_kg', '')::numeric;
  v_pulse integer := nullif(p_data ->> 'pulse_bpm', '')::integer;
  v_spo2 integer := nullif(p_data ->> 'spo2_pct', '')::integer;
  v_glu numeric := nullif(p_data ->> 'glucose_mmol_l', '')::numeric;
  v_ctx public.glucose_context := coalesce(nullif(p_data ->> 'glucose_context', '')::public.glucose_context, 'random');
  v_bp jsonb := coalesce(p_data -> 'bp_readings', '[]'::jsonb);
  v_note constant text := 'Taken at an outreach health check';
  r jsonb; v_ids uuid[] := '{}'; v_id uuid;
begin
  if v is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.can_run_outreach_day() then raise exception 'not authorised' using errcode = '42501'; end if;

  select * into e from public.outreach_enrolments where slot_id = p_slot_id for update;
  if not found then raise exception 'enrol the attendee before recording their vitals' using errcode = '22023'; end if;
  if e.vitals_recorded_at is not null then raise exception 'vitals_already_recorded' using errcode = '22023'; end if;
  if jsonb_typeof(v_bp) <> 'array' or jsonb_array_length(v_bp) > 5 then
    raise exception 'bp_readings must be a list of at most 5' using errcode = '22023';
  end if;
  -- Plausibility only (a typo like 54 for 5.4), never a clinical band: the red-flag rules on vitals_readings judge the value.
  if (v_glu is not null and v_glu not between 0.5 and 50) or (v_w is not null and v_w not between 2 and 400)
     or (v_pulse is not null and v_pulse not between 20 and 300) or (v_spo2 is not null and v_spo2 not between 50 and 100) then
    raise exception 'reading_out_of_range' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(v_bp) loop
    if (r ->> 'systolic')::integer not between 50 and 300 or (r ->> 'diastolic')::integer not between 20 and 200
       or (r ->> 'diastolic')::integer >= (r ->> 'systolic')::integer then
      raise exception 'bp_reading_out_of_range' using errcode = '22023';
    end if;
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, note,
                                        logged_by_profile_id, position, arm, cuff_type)
    values (e.organisation_id, e.patient_id, 'blood_pressure', (r ->> 'systolic')::integer, (r ->> 'diastolic')::integer, 'device', now(),
            v_note, v, coalesce(nullif(r ->> 'position', ''), 'seated'), nullif(r ->> 'arm', ''), 'upper_arm')
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  if v_glu is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at, note, logged_by_profile_id)
    values (e.organisation_id, e.patient_id, 'glucose', v_glu, v_ctx, 'device', now(), v_note, v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_w is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source, taken_at, note, logged_by_profile_id)
    values (e.organisation_id, e.patient_id, 'weight', v_w, 'device', now(), v_note, v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_pulse is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at, note, logged_by_profile_id)
    values (e.organisation_id, e.patient_id, 'pulse', v_pulse, 'device', now(), v_note, v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_spo2 is not null then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at, note, logged_by_profile_id)
    values (e.organisation_id, e.patient_id, 'spo2', v_spo2, 'device', now(), v_note, v) returning id into v_id;
    v_ids := v_ids || v_id;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'enter at least one reading' using errcode = '22023';
  end if;

  update public.outreach_enrolments
     set vitals_reading_ids = v_ids, vitals_recorded_at = now(), vitals_recorded_by = v
   where slot_id = p_slot_id;

  perform private.log_audit('outreach.vitals_recorded', 'screening_day_slots', p_slot_id,
    jsonb_build_object('vitals_rows', array_length(v_ids, 1)));
  return jsonb_build_object('vitals_rows', array_length(v_ids, 1));
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. An outreach lab form nobody has acted on must not block a Member's own yearly panel
-- ---------------------------------------------------------------------------
-- start_annual_bundle and check_in_testing_booking each refuse a patient who already has a yearly-panel order in the last
-- 330 days. Without this, an attendee who took the outreach lab form home and later bought Membership Plus could not start
-- the panel their Membership pays for. An outreach order still at 'ordered' with no result uploaded is skipped by that check;
-- one the patient has acted on (a result uploaded, or any later status) still counts, so a real yearly panel is never repeated.
create function private.is_untouched_outreach_panel_order(p_order uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.outreach_enrolments e
      join public.lab_orders o on o.id = e.lab_order_id
     where e.lab_order_id = p_order and o.status = 'ordered' and o.fulfilment = 'self_arranged'
       and not exists (select 1 from public.lab_result_documents d where d.lab_order_id = o.id)
  );
$$;
revoke all on function private.is_untouched_outreach_panel_order(uuid) from public, anon, authenticated;

-- Both functions are rewritten from their LIVE bodies by an exact, counted text replacement (the pattern
-- 20261102090647_finance_dates_use_lagos_not_utc.sql uses): the window line gains one clause and nothing else changes.
do $$
declare
  v_fn text;
  v_def text;
  v_old constant text := $o$o.ordered_at > now() - interval '330 days'$o$;
  v_new constant text := $o$o.ordered_at > now() - interval '330 days' and not private.is_untouched_outreach_panel_order(o.id)$o$;
begin
  foreach v_fn in array array['public.start_annual_bundle(uuid,uuid)', 'public.check_in_testing_booking(uuid)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'outreach: % expected exactly 1 match of the 330-day window', v_fn;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.set_outreach_day_price(bigint, text) from public, anon;
revoke all on function public.create_outreach_day(text, text, text, text, date, integer, text) from public, anon;
revoke all on function public.confirm_screening_day(uuid, integer, numeric, uuid) from public, anon;
revoke all on function public.add_screening_day_slot(uuid, text, text) from public, anon;
revoke all on function public.issue_screening_day_voucher(uuid, uuid) from public, anon;
revoke all on function public.enrol_outreach_attendee(uuid, uuid) from public, anon;
revoke all on function public.record_outreach_vitals(uuid, jsonb) from public, anon;

grant execute on function public.set_outreach_day_price(bigint, text) to authenticated;
grant execute on function public.create_outreach_day(text, text, text, text, date, integer, text) to authenticated;
grant execute on function public.confirm_screening_day(uuid, integer, numeric, uuid) to authenticated;
grant execute on function public.add_screening_day_slot(uuid, text, text) to authenticated;
grant execute on function public.issue_screening_day_voucher(uuid, uuid) to authenticated;
grant execute on function public.enrol_outreach_attendee(uuid, uuid) to authenticated;
grant execute on function public.record_outreach_vitals(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
              and tablename in ('outreach_enrolments', 'outreach_day_prices') and cmd <> 'SELECT') then
    raise exception 'outreach tables must have no write policy: writes go through definer RPCs only';
  end if;
  if has_table_privilege('anon', 'public.outreach_enrolments', 'SELECT')
     or has_table_privilege('anon', 'public.outreach_day_prices', 'SELECT') then
    raise exception 'anon must not read outreach tables';
  end if;
  if not has_table_privilege('authenticated', 'public.outreach_enrolments', 'SELECT')
     or not has_table_privilege('authenticated', 'public.outreach_day_prices', 'SELECT') then
    raise exception 'authenticated needs the base SELECT grant, RLS alone is not enough';
  end if;
  if has_function_privilege('anon', 'public.enrol_outreach_attendee(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_outreach_vitals(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_outreach_day(text,text,text,text,date,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_outreach_day_price(bigint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_screening_day(uuid,integer,numeric,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.add_screening_day_slot(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.issue_screening_day_voucher(uuid,uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to run any screening day or outreach function';
  end if;
  if (select count(*) from public.outreach_day_prices where is_active) <> 1
     or (select price_per_head_kobo from public.outreach_day_prices where is_active) <> 1500000 then
    raise exception 'exactly one active outreach price of 1,500,000 kobo must exist (OD-02)';
  end if;
  if exists (select 1 from public.screening_days where kind <> 'bundle') then
    raise exception 'no existing screening day may change kind';
  end if;
end $$;
