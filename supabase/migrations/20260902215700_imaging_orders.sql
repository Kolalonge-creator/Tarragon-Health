-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 3/9:
-- imaging orders (spec §59.4 order, §59.5 scheduling, §59.7 workflow,
-- §59.14 turnaround).
--
-- Ordering authority: mirrors private.has_prescribing_authority()
-- (20260715181500) exactly, but scoped to the Clinical Tier Ladder's actual
-- floor for this action -- any real doctor tier (Tier 1-5) may order an
-- imaging investigation (this is routine clinical decision-making, unlike
-- new medication initiation which the Ladder reserves for Tier 2+), never a
-- Care Coordinator (logistics-only, per CLAUDE.md's Clinical Tier Ladder).
-- Implemented as a real DB-level gate on the INSERT policy itself, not an
-- app-layer-only guard -- ordering an investigation is exactly the kind of
-- clinical action private.has_prescribing_authority already treats this way
-- for medications.
--
-- Scheduling (§59.5) deliberately does NOT build a real slot-lock grid.
-- Confirmed in research: the appointment engine (20260828 six-part build)
-- is keyed entirely on an EMPLOYED clinician (clinician_id), not an external
-- partner organisation's capacity -- there is no fit for "book an MRI slot
-- at a partner Diagnostic Organisation" without extending it, and no signed
-- imaging partner exists to extend it FOR yet. Instead this mirrors the
-- lab_orders precedent (20260820055147_lab_order_partner_visit_scheduling):
-- a coarse scheduled_date + preferred_time_of_day preference, confirmed
-- manually by staff -- "no fabricated real-time slot grid... nothing backs
-- a specific facility's actual capacity today."
--
-- No payment_confirmed_at (unlike lab_orders): this is a self-arranged-only
-- fulfilment model for now (see part 1's header) -- the patient pays the
-- imaging facility directly, Tarragon collects nothing, so there is no
-- Tarragon-side payment event to stamp. total_kobo is an informational
-- estimate copied from the catalogue at order time, not a charge.
--
-- Turnaround tracking (§59.14) uses the workflow timestamps directly:
-- appointment waiting time = booked_at -> attended_at; scan completion =
-- attended_at -> performed_at; report turnaround = performed_at ->
-- reported_at; clinical acknowledgement = result_returned_at -> reviewed_at.
-- See part 9 (imaging_provider_turnaround_stats) for the aggregate view.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.imaging_order_status as enum (
  'ordered', 'booked', 'attended', 'performed', 'reported', 'result_returned', 'reviewed', 'cancelled'
);

create type public.imaging_order_urgency as enum ('routine', 'urgent', 'emergency');

create type public.imaging_order_fulfilment as enum ('partner', 'self_arranged');

create type public.imaging_order_time_of_day as enum ('morning', 'afternoon', 'evening');

-- ---------------------------------------------------------------------------
-- 2. Ordering-authority helper (mirrors private.has_prescribing_authority)
-- ---------------------------------------------------------------------------
create or replace function private.has_imaging_ordering_authority(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
  );
$$;

comment on function private.has_imaging_ordering_authority(uuid) is
  'True for an active clinical_staff record at any real doctor tier (Tier 1-5) or Clinical Director, for the given organisation. Excludes care_coordinator (logistics-only, never orders an investigation) and any non-clinical_staff org-staff account. Mirrors private.has_prescribing_authority() (20260715181500) but at Tier 1, since ordering an investigation is routine clinical decision-making, unlike new-medication initiation which the Clinical Tier Ladder reserves for Tier 2+.';

-- ---------------------------------------------------------------------------
-- 3. Table
-- ---------------------------------------------------------------------------
create table public.imaging_orders (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  patient_id                uuid not null references public.profiles (id) on delete cascade,
  -- Server-derived from the caller's own active clinical_staff record --
  -- never client-trusted. ON DELETE RESTRICT per the provenance-hardening
  -- convention (20260730120000): who ordered a scan is never erased.
  ordering_clinician_id     uuid not null references public.clinical_staff (id) on delete restrict,
  study_id                  uuid not null references public.imaging_studies (id) on delete restrict,
  -- Derived from study_id at insert (a study belongs to one provider);
  -- location_id is filled in later, once staff has picked a specific branch
  -- ("Find appropriate facility", §59.5).
  provider_id               uuid references public.imaging_providers (id) on delete set null,
  location_id               uuid references public.imaging_provider_locations (id) on delete set null,
  fulfilment                public.imaging_order_fulfilment not null default 'self_arranged',
  status                    public.imaging_order_status not null default 'ordered',
  urgency                   public.imaging_order_urgency not null default 'routine',
  indication                text not null,
  clinical_information      text,
  contraindication_information text,
  total_kobo                bigint not null default 0,
  scheduled_date            date,
  preferred_time_of_day     public.imaging_order_time_of_day,
  booked_at                 timestamptz,
  attended_at               timestamptz,
  performed_at              timestamptz,
  images_generated_at       timestamptz,
  reported_at               timestamptz,
  result_returned_at        timestamptz,
  reviewed_by               uuid references public.profiles (id) on delete restrict,
  reviewed_at               timestamptz,
  cancelled_by              uuid references public.profiles (id) on delete restrict,
  cancelled_at              timestamptz,
  cancellation_reason       text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint imaging_orders_cancellation_requires_reason
    check (status <> 'cancelled' or cancellation_reason is not null),
  constraint imaging_orders_indication_not_blank check (length(btrim(indication)) > 0)
);

create index imaging_orders_patient_idx on public.imaging_orders (patient_id, created_at desc);
create index imaging_orders_org_idx on public.imaging_orders (organisation_id, created_at desc);
create index imaging_orders_status_idx on public.imaging_orders (organisation_id, status)
  where status not in ('reviewed', 'cancelled');
create index imaging_orders_provider_idx on public.imaging_orders (provider_id);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.imaging_orders enable row level security;

create policy imaging_orders_select on public.imaging_orders
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Clinician-initiated only (§59.4: "Clinician selects"). A patient never
-- inserts their own imaging order (unlike lab_orders' patient-initiated
-- screening path) -- ordering an investigation is a clinical decision.
create policy imaging_orders_insert on public.imaging_orders
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    and private.has_imaging_ordering_authority(organisation_id)
  );

-- Only org staff progress the workflow; patients never update their own order.
create policy imaging_orders_update on public.imaging_orders
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.imaging_orders to authenticated;

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT: derive attribution + provider, snapshot price, audit
-- ---------------------------------------------------------------------------
create or replace function private.handle_imaging_order_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid;
  v_price_kobo  bigint;
begin
  if new.ordering_clinician_id is null then
    select id into new.ordering_clinician_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
    limit 1;
  end if;

  if new.ordering_clinician_id is null then
    raise exception 'An imaging order requires an active ordering clinician (Tier 1-5 or Clinical Director)';
  end if;

  select provider_id, price_kobo into v_provider_id, v_price_kobo
  from public.imaging_studies where id = new.study_id;

  new.provider_id := coalesce(new.provider_id, v_provider_id);
  if new.total_kobo = 0 then
    new.total_kobo := coalesce(v_price_kobo, 0);
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, (select auth.uid()), 'imaging_order.created', 'imaging_orders', new.id,
    jsonb_build_object('study_id', new.study_id, 'urgency', new.urgency::text)
  );

  return new;
end;
$$;

create trigger imaging_orders_on_insert
  before insert on public.imaging_orders
  for each row execute function private.handle_imaging_order_insert();

-- ---------------------------------------------------------------------------
-- 6. BEFORE UPDATE: guard immutable facts, stamp workflow timestamps,
--    freeze terminal states
-- ---------------------------------------------------------------------------
create or replace function private.stamp_imaging_order_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id       := old.organisation_id;
  new.patient_id            := old.patient_id;
  new.ordering_clinician_id := old.ordering_clinician_id;
  new.study_id              := old.study_id;
  new.created_at            := old.created_at;

  if old.status in ('cancelled', 'reviewed') and new.status is distinct from old.status then
    raise exception 'Cannot change the status of a cancelled or reviewed imaging order';
  end if;

  if new.status = 'booked' and old.booked_at is null then
    new.booked_at := now();
  elsif old.booked_at is not null then
    new.booked_at := old.booked_at;
  end if;

  if new.status = 'attended' and old.attended_at is null then
    new.attended_at := now();
  elsif old.attended_at is not null then
    new.attended_at := old.attended_at;
  end if;

  -- No distinct 'images_generated' status exists (see migration header):
  -- with no direct PACS/equipment feed today, image generation is stamped
  -- together with scan completion rather than left permanently null.
  if new.status = 'performed' and old.performed_at is null then
    new.performed_at := now();
    new.images_generated_at := now();
  elsif old.performed_at is not null then
    new.performed_at := old.performed_at;
    new.images_generated_at := old.images_generated_at;
  end if;

  if new.status = 'reported' and old.reported_at is null then
    new.reported_at := now();
  elsif old.reported_at is not null then
    new.reported_at := old.reported_at;
  end if;

  if new.status = 'result_returned' and old.result_returned_at is null then
    new.result_returned_at := now();
  elsif old.result_returned_at is not null then
    new.result_returned_at := old.result_returned_at;
  end if;

  if new.status = 'reviewed' and old.reviewed_at is null then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  elsif old.reviewed_at is not null then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  if new.status = 'cancelled' and old.cancelled_at is null then
    new.cancelled_by := (select auth.uid());
    new.cancelled_at := now();
  elsif old.cancelled_at is not null then
    new.cancelled_by := old.cancelled_by;
    new.cancelled_at := old.cancelled_at;
  end if;

  return new;
end;
$$;

create trigger imaging_orders_stamp_lifecycle
  before update on public.imaging_orders
  for each row execute function private.stamp_imaging_order_lifecycle();

revoke all on function private.has_imaging_ordering_authority(uuid) from public;
grant execute on function private.has_imaging_ordering_authority(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.imaging_orders', 'SELECT') then
    raise exception 'imaging_orders: authenticated SELECT grant did not take';
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.imaging_orders'::regclass
      and con.contype = 'f'
      and a.attname in ('ordering_clinician_id', 'reviewed_by', 'cancelled_by')
      and con.confdeltype <> 'r'
  ) then
    raise exception 'imaging_orders: ordering_clinician_id/reviewed_by/cancelled_by must be ON DELETE RESTRICT';
  end if;

  if has_function_privilege('anon', 'private.has_imaging_ordering_authority(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.has_imaging_ordering_authority';
  end if;

  raise notice 'PASS: imaging_orders workflow table in place';
end $$;
