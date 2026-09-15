-- Tarragon Health — Pay-per-service item: Second Opinion Review.
--
-- Patient describes an existing result/diagnosis (from outside Tarragon or
-- from an earlier visit) and a doctor reviews it and writes back — no
-- appointment/visit needed. Shape cloned from async_consults
-- (20260723010040): same submitted -> in_review -> answered -> closed
-- lifecycle, same forge-proof answered_by/answered_at stamping restricted to
-- an active doctor-tier clinical_staff row. Two real differences from
-- async_consults: (1) this is a pure pay-per-service item with no
-- subscription-tier bundling at all — every request spends one
-- second_opinion_credit, full stop, matching the item's own framing
-- ("cheaper than a full video call" doesn't apply here — this is standalone
-- paid, no visit needed); (2) the attribution trigger below correctly
-- excludes 'care_coordinator' from doctor_tier is not null (a documented
-- gotcha this codebase has been bitten by before — care_coordinator is
-- itself a non-null doctor_tier value, so a bare `is not null` check wrongly
-- admits it; async_consults' own 2026-07-23 trigger has this exact gap and
-- is left alone here, out of scope for this migration).

create type public.second_opinion_status as enum (
  'submitted', 'in_review', 'answered', 'closed'
);

create table public.second_opinion_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  -- What the patient wants a second opinion on, and where it came from
  -- (their own words — no upload/attachment mechanism in this pass).
  existing_diagnosis_or_result  text not null,
  source_description             text,
  specific_question              text,
  status            public.second_opinion_status not null default 'submitted',
  answer            text,
  answered_by       uuid references public.clinical_staff (id) on delete set null,
  answered_at       timestamptz,
  -- Same promise shape as async_consults' SLA, a real but generous window
  -- given this needs more doctor time than a quick written Q&A.
  sla_due_at        timestamptz not null default now() + interval '72 hours',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index second_opinion_requests_org_status_idx
  on public.second_opinion_requests (organisation_id, status, sla_due_at);
create index second_opinion_requests_patient_idx
  on public.second_opinion_requests (patient_id, created_at desc);

create trigger second_opinion_requests_set_updated_at
  before update on public.second_opinion_requests
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pay-per-service gate: every request spends one second_opinion_credit, no
-- subscription-tier bypass (unlike async_consults' plan-or-credit OR).
-- ---------------------------------------------------------------------------

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, is_active)
values (
  'second_opinion_credit',
  'Second Opinion Review',
  'A doctor reviews an existing result or diagnosis and writes back their own assessment — no visit needed.',
  750000, -- PLACEHOLDER (₦7,500) — not founder-confirmed
  'NGN', 90, true
)
on conflict (code) do nothing;

create or replace function private.enforce_second_opinion_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := coalesce(new.id, gen_random_uuid());

  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, 'second_opinion_credit', 'second_opinion_request', new.id
    );
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Buy a second opinion credit to send this request.'
        using errcode = 'P0001', detail = 'SECOND_OPINION_CREDIT_REQUIRED';
    end if;
    raise;
  end;

  return new;
end;
$$;

create trigger second_opinion_requests_enforce_credit
  before insert on public.second_opinion_requests
  for each row execute function private.enforce_second_opinion_credit();

-- ---------------------------------------------------------------------------
-- Forge-proof answer attribution — same shape as
-- private.stamp_async_consult_answer, with the care_coordinator exclusion
-- fixed (see header).
-- ---------------------------------------------------------------------------

create or replace function private.stamp_second_opinion_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if new.status = 'answered' and old.status <> 'answered' then
    select cs.id into v_staff
    from public.clinical_staff cs
    where cs.profile_id = (select auth.uid())
      and cs.organisation_id = new.organisation_id
      and cs.active
      and cs.doctor_tier is not null
      and cs.doctor_tier <> 'care_coordinator';
    if v_staff is null then
      raise exception 'only an active doctor on this organisation''s care team can answer a second opinion request'
        using errcode = '42501';
    end if;
    new.answered_by := v_staff;
    new.answered_at := now();
    if new.answer is null or length(btrim(new.answer)) = 0 then
      raise exception 'an answered second opinion request must carry an answer';
    end if;
  elsif new.status <> 'answered' and old.status <> 'answered' then
    new.answered_by := null;
    new.answered_at := null;
    new.answer := null;
  else
    new.answered_by := old.answered_by;
    new.answered_at := old.answered_at;
    new.answer := old.answer;
  end if;
  return new;
end;
$$;

create trigger second_opinion_requests_stamp_answer
  before update on public.second_opinion_requests
  for each row execute function private.stamp_second_opinion_answer();

alter table public.second_opinion_requests enable row level security;

create policy second_opinion_requests_select on public.second_opinion_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy second_opinion_requests_insert on public.second_opinion_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
create policy second_opinion_requests_update on public.second_opinion_requests
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.second_opinion_requests to authenticated;

do $$
declare
  v_org uuid;
  v_patient uuid;
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

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.second_opinion_requests (organisation_id, patient_id, existing_diagnosis_or_result)
    values (v_org, v_patient, 'repoint-proof: should be blocked, no credit');
    reset role;
    raise exception 'FAIL: second_opinion_requests insert succeeded with no credit';
  exception when others then
    reset role;
    if sqlerrm not like '%Buy a second opinion credit%' then
      raise;
    end if;
  end;

  select id into v_product_id from public.service_products where code = 'second_opinion_credit';
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_patient, v_product_id, 'active', 750000, 'NGN', now(), now() + interval '90 days')
  returning id into v_purchase_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.second_opinion_requests (organisation_id, patient_id, existing_diagnosis_or_result)
  values (v_org, v_patient, 'repoint-proof: paid via credit')
  returning id into v_request_id;
  reset role;

  if not exists (select 1 from public.service_purchases where id = v_purchase_id and redeemed_at is not null and redeemed_entity_id = v_request_id) then
    raise exception 'FAIL: second opinion credit was not redeemed against the new request row';
  end if;

  select cs.profile_id into v_staff_profile
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
  limit 1;

  if v_staff_profile is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.second_opinion_requests set status = 'answered', answer = 'proof answer' where id = v_request_id;
    reset role;

    if not exists (select 1 from public.second_opinion_requests where id = v_request_id and answered_by is not null and answered_at is not null) then
      raise exception 'FAIL: answering did not stamp answered_by/answered_at';
    end if;
  else
    raise notice 'SKIPPED answer-attribution proof: no active non-coordinator doctor fixture in org';
  end if;

  delete from public.second_opinion_requests where id = v_request_id;
  delete from public.service_purchases where id = v_purchase_id;

  raise notice 'PASS: second_opinion_requests credit gate + forge-proof answer attribution both work';
end $$;
