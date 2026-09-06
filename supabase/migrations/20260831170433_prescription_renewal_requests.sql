-- Tarragon Health — Pay-per-service item: E-Prescription Renewal.
--
-- "The clinical act of a doctor reviewing and signing off, separate from any
-- physical dispensing" (already true architecture-wise — pharmacy dispensing
-- routing was deliberately dropped platform-wide, 20260803132008; a
-- medications row IS the signed order the moment it exists,
-- 20260828183440's own comment). What's missing is a patient-INITIATED entry
-- point: today, medication review only happens on a scheduled cadence
-- (medication_reviews, 20260716172000) or ad hoc inside the doctor's own
-- chart workflow — a patient can't ask for a renewal on demand.
--
-- This table is the request/decision record only — it does NOT write to
-- medications itself. Approving a request is the doctor's clinical
-- judgement call ("yes, this can be renewed"); actually issuing the renewed
-- prescription still goes through the existing medications insert/update
-- path (its own has_prescribing_authority/confirm-only tiering, untouched
-- here) in the doctor's normal chart tools. Keeping these separate avoids
-- duplicating that authority logic for a second time in a new table.
--
-- Gate: EITHER the patient's plan already includes 'medication_refills'
-- (refill-date tracking already promises exactly this kind of touchpoint per
-- pricing.ts's own copy), or they spend one prescription_renewal_credit —
-- same OR-gate shape as async_consults, not the stricter no-bypass gate used
-- for second_opinion_requests.

create type public.prescription_renewal_status as enum (
  'submitted', 'in_review', 'approved', 'declined'
);

create table public.prescription_renewal_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  patient_note      text,
  status            public.prescription_renewal_status not null default 'submitted',
  doctor_note       text,
  reviewed_by       uuid references public.clinical_staff (id) on delete set null,
  reviewed_at       timestamptz,
  sla_due_at        timestamptz not null default now() + interval '72 hours',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index prescription_renewal_requests_org_status_idx
  on public.prescription_renewal_requests (organisation_id, status, sla_due_at);
create index prescription_renewal_requests_patient_idx
  on public.prescription_renewal_requests (patient_id, created_at desc);
-- A patient shouldn't stack duplicate open requests for the same medication.
create unique index prescription_renewal_requests_one_open_per_medication
  on public.prescription_renewal_requests (medication_id)
  where status in ('submitted', 'in_review');

create trigger prescription_renewal_requests_set_updated_at
  before update on public.prescription_renewal_requests
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Plan-or-credit gate, same OR shape as private.enforce_async_consult_
-- entitlement_or_credit (20260831164640).
-- ---------------------------------------------------------------------------

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, is_active)
values (
  'prescription_renewal_credit',
  'Prescription Renewal Review',
  'A doctor reviews and signs off on renewing one of your existing prescriptions.',
  350000, -- PLACEHOLDER (₦3,500) — not founder-confirmed
  'NGN', 90, true
)
on conflict (code) do nothing;

create or replace function private.enforce_prescription_renewal_entitlement_or_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := coalesce(new.id, gen_random_uuid());

  if not exists (
    select 1 from public.medications m
    where m.id = new.medication_id and m.patient_id = new.patient_id and m.is_active
  ) then
    raise exception 'that medication is not one of this patient''s active prescriptions';
  end if;

  if private.patient_has_feature_access(new.patient_id, 'medication_refills') then
    return new;
  end if;

  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, 'prescription_renewal_credit', 'prescription_renewal_request', new.id
    );
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Buy a prescription renewal credit, or upgrade your plan, to request this.'
        using errcode = 'P0001', detail = 'PRESCRIPTION_RENEWAL_CREDIT_REQUIRED';
    end if;
    raise;
  end;

  return new;
end;
$$;

create trigger prescription_renewal_requests_enforce_credit
  before insert on public.prescription_renewal_requests
  for each row execute function private.enforce_prescription_renewal_entitlement_or_credit();

-- ---------------------------------------------------------------------------
-- Forge-proof review attribution — same shape as
-- private.stamp_second_opinion_answer, gated on any active non-coordinator
-- doctor tier (Tier 1 already has authority to confirm/continue an existing
-- stable prescription per the tier ladder — this is a review decision, not
-- the prescribing act itself, so it does not need has_prescribing_authority's
-- stricter tier_2+ bar).
-- ---------------------------------------------------------------------------

create or replace function private.stamp_prescription_renewal_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if new.status in ('approved', 'declined') and old.status not in ('approved', 'declined') then
    select cs.id into v_staff
    from public.clinical_staff cs
    where cs.profile_id = (select auth.uid())
      and cs.organisation_id = new.organisation_id
      and cs.active
      and cs.doctor_tier is not null
      and cs.doctor_tier <> 'care_coordinator';
    if v_staff is null then
      raise exception 'only an active doctor on this organisation''s care team can review a renewal request'
        using errcode = '42501';
    end if;
    new.reviewed_by := v_staff;
    new.reviewed_at := now();
  elsif new.status not in ('approved', 'declined') and old.status not in ('approved', 'declined') then
    new.reviewed_by := null;
    new.reviewed_at := null;
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;

create trigger prescription_renewal_requests_stamp_review
  before update on public.prescription_renewal_requests
  for each row execute function private.stamp_prescription_renewal_review();

alter table public.prescription_renewal_requests enable row level security;

create policy prescription_renewal_requests_select on public.prescription_renewal_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy prescription_renewal_requests_insert on public.prescription_renewal_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
create policy prescription_renewal_requests_update on public.prescription_renewal_requests
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.prescription_renewal_requests to authenticated;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_medication_id uuid;
  v_staff_profile uuid;
  v_product_id uuid;
  v_purchase_id uuid;
  v_request_id uuid;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active)
  values (v_org, v_patient, 'Repoint-proof test drug', '10mg', 'daily', true)
  returning id into v_medication_id;

  if private.patient_has_feature_access(v_patient, 'medication_refills') then
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.prescription_renewal_requests (organisation_id, patient_id, medication_id)
    values (v_org, v_patient, v_medication_id)
    returning id into v_request_id;
    reset role;
    delete from public.prescription_renewal_requests where id = v_request_id;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.prescription_renewal_requests (organisation_id, patient_id, medication_id)
      values (v_org, v_patient, v_medication_id);
      reset role;
      raise exception 'FAIL: prescription_renewal_requests insert succeeded with no plan access and no credit';
    exception when others then
      reset role;
      if sqlerrm not like '%Buy a prescription renewal credit%' then
        raise;
      end if;
    end;

    select id into v_product_id from public.service_products where code = 'prescription_renewal_credit';
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, purchased_at, expires_at)
    values
      (v_org, v_patient, v_patient, v_product_id, 'active', 350000, 'NGN', now(), now() + interval '90 days')
    returning id into v_purchase_id;

    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.prescription_renewal_requests (organisation_id, patient_id, medication_id)
    values (v_org, v_patient, v_medication_id)
    returning id into v_request_id;
    reset role;

    if not exists (select 1 from public.service_purchases where id = v_purchase_id and redeemed_at is not null and redeemed_entity_id = v_request_id) then
      raise exception 'FAIL: prescription renewal credit was not redeemed against the new request row';
    end if;

    select cs.profile_id into v_staff_profile
    from public.clinical_staff cs
    where cs.organisation_id = v_org and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
    limit 1;

    if v_staff_profile is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.prescription_renewal_requests set status = 'approved', doctor_note = 'proof approval' where id = v_request_id;
      reset role;

      if not exists (select 1 from public.prescription_renewal_requests where id = v_request_id and reviewed_by is not null and reviewed_at is not null) then
        raise exception 'FAIL: approving did not stamp reviewed_by/reviewed_at';
      end if;
    else
      raise notice 'SKIPPED review-attribution proof: no active non-coordinator doctor fixture in org';
    end if;

    delete from public.prescription_renewal_requests where id = v_request_id;
    delete from public.service_purchases where id = v_purchase_id;
  end if;

  delete from public.medications where id = v_medication_id;

  raise notice 'PASS: prescription_renewal_requests plan-or-credit gate + forge-proof review attribution both work';
end $$;
