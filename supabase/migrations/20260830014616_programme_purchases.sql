-- Episodic-fee rebuild, step 3/6.
--
-- programme_purchases is the commercial wrapper around chronic-disease care: a
-- patient pays a flat, one-time fee for a bounded window (e.g. 12 weeks of
-- Hypertension care) instead of an open-ended subscription. It is deliberately
-- a NEW, separate table from chronic_programme_enrolments, not a repurposing
-- of it: chronic_programme_enrolments is staff-inserted only (a clinician
-- stands behind every clinical enrolment, enforced by its own insert RLS —
-- 20260716223642_chronic_programme_enrolments.sql), and that invariant must
-- not be broken to let a patient buy their own enrolment. Instead, a patient
-- inserts a programme_purchases row under their own RLS'd client (mirroring
-- createAndPayForPartnerLabOrder), and paying it activates the clinical
-- enrolment automatically via a SECURITY DEFINER function, which bypasses that
-- RLS the same principled way a staff-driven flow would.
--
-- price_kobo/duration_weeks are snapshotted from the catalogue at insert time
-- (same discipline as lab_orders.total_kobo / care_vouchers.face_value_kobo)
-- so an admin later changing a programme's fee, length, or content can never
-- alter an already-sold purchase.
--
-- Activation deliberately does NOT extend paystack-webhook/index.ts's
-- BOOKING_TABLE — that Edge Function is a separately deployed artifact this
-- codebase has already been bitten by redeploy-drift on more than once (see
-- CLAUDE.md's standing follow-ups). Instead this follows the established
-- redeploy-free pattern used for voucher instalments and sponsored
-- subscriptions: the deployed webhook writes every verified charge into
-- payment_transactions before it ever branches on metadata.kind, so an AFTER
-- INSERT trigger here (see migration 4's companion file — deferred to keep
-- this migration's own DO block focused on the table itself) can activate a
-- purchase purely by matching on its own metadata.kind, regardless of which
-- webhook version happens to be deployed.

create type public.programme_purchase_status as enum (
  'pending_payment', 'active', 'completed', 'expired', 'cancelled', 'refunded'
);

create table public.programme_purchases (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  programme_id                  uuid not null references public.chronic_condition_programmes (id) on delete restrict,
  enrolment_id                  uuid references public.chronic_programme_enrolments (id) on delete set null,
  care_plan_id                  uuid references public.care_plans (id) on delete set null,
  status                        public.programme_purchase_status not null default 'pending_payment',
  -- Snapshot at insert (see header) — never re-read from the catalogue later.
  price_kobo                    bigint not null,
  duration_weeks                integer not null check (duration_weeks > 0),
  starts_at                     date,
  ends_at                       date,
  payment_provider              public.payment_provider,
  payment_provider_ref          text,
  pending_payment_provider_ref  text,
  purchased_at                  timestamptz,
  cancelled_at                  timestamptz,
  cancelled_reason              text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index programme_purchases_patient_idx on public.programme_purchases (patient_id, created_at desc);
create index programme_purchases_org_idx on public.programme_purchases (organisation_id, status);
-- Liveness for every entitlement check is computed directly against this
-- index (status + ends_at), never via a cron sweep — a missed sweep can
-- never leave a lapsed purchase looking entitled.
create index programme_purchases_active_idx on public.programme_purchases (patient_id, ends_at) where status = 'active';
-- One in-flight (unpaid or currently active) purchase per patient+programme —
-- blocks double-buying an overlapping window; a renewal is only possible once
-- the prior purchase has left this set (expired/completed/cancelled/refunded).
create unique index programme_purchases_one_open on public.programme_purchases (patient_id, programme_id)
  where status in ('pending_payment', 'active');

drop trigger if exists programme_purchases_set_updated_at on public.programme_purchases;
create trigger programme_purchases_set_updated_at
  before update on public.programme_purchases
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: price/duration are server-derived from the catalogue, never
-- client-trusted — a patient's insert supplies only patient_id/programme_id.
-- Fails closed on a dormant or unpriced programme rather than guessing.
-- ---------------------------------------------------------------------------
create or replace function private.set_programme_purchase_computed_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.chronic_condition_programmes%rowtype;
begin
  select * into v_programme
    from public.chronic_condition_programmes
   where id = new.programme_id;

  if v_programme.id is null then
    raise exception 'that programme does not exist' using errcode = '23514';
  end if;
  if not v_programme.is_active then
    raise exception 'this programme is not currently available for purchase' using errcode = '23514';
  end if;
  if v_programme.price_kobo is null or v_programme.price_kobo <= 0 then
    raise exception 'this programme''s pricing is not yet configured' using errcode = '23514';
  end if;
  if v_programme.default_duration_weeks is null then
    raise exception 'this programme''s duration is not yet configured' using errcode = '23514';
  end if;

  new.organisation_id := (select organisation_id from public.profiles where id = new.patient_id);
  if new.organisation_id is null then
    raise exception 'patient has no organisation on file' using errcode = '23514';
  end if;

  new.price_kobo := v_programme.price_kobo;
  new.duration_weeks := v_programme.default_duration_weeks;
  new.status := 'pending_payment';
  new.enrolment_id := null;
  new.care_plan_id := null;
  new.starts_at := null;
  new.ends_at := null;
  new.purchased_at := null;

  return new;
end;
$$;

drop trigger if exists programme_purchases_compute_price on public.programme_purchases;
create trigger programme_purchases_compute_price
  before insert on public.programme_purchases
  for each row execute function private.set_programme_purchase_computed_price();

-- ---------------------------------------------------------------------------
-- Enrolment side-effect of a confirmed purchase (called by the
-- payment_transactions trigger in the companion migration, never a trigger
-- itself — see that file for why). Bypasses chronic_programme_enrolments'
-- staff-only insert RLS deliberately: SECURITY DEFINER, invoked only from a
-- context that has already verified real money was received. Reuses an
-- existing 'enrolled' row for the same patient+programme where one exists (a
-- renewal), otherwise creates one with source='patient_purchase'. Creates a
-- draft care_plan if the patient has none for this condition yet — clinical
-- targets are then a Tier 1/2 review task, same as any other new enrolment;
-- commercial entitlement is live immediately regardless.
-- ---------------------------------------------------------------------------
create or replace function private.enrol_patient_in_purchased_programme(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.programme_purchases%rowtype;
  v_programme public.chronic_condition_programmes%rowtype;
  v_enrolment_id uuid;
  v_care_plan_id uuid;
begin
  select * into v_purchase from public.programme_purchases where id = p_purchase_id;
  if v_purchase.id is null then return; end if;

  select * into v_programme from public.chronic_condition_programmes where id = v_purchase.programme_id;
  if v_programme.id is null then return; end if;

  select id into v_enrolment_id
    from public.chronic_programme_enrolments
   where patient_id = v_purchase.patient_id
     and programme_id = v_purchase.programme_id
     and status = 'enrolled'
   limit 1;

  if v_enrolment_id is null then
    insert into public.chronic_programme_enrolments
      (organisation_id, patient_id, programme_id, source, notes)
    values
      (v_purchase.organisation_id, v_purchase.patient_id, v_purchase.programme_id,
       'patient_purchase', 'Created automatically by a paid programme purchase.')
    returning id into v_enrolment_id;
  end if;

  select id into v_care_plan_id
    from public.care_plans
   where patient_id = v_purchase.patient_id
     and condition = v_programme.condition
     and status = 'active'
   limit 1;

  if v_care_plan_id is null then
    insert into public.care_plans (organisation_id, patient_id, condition, status)
    values (v_purchase.organisation_id, v_purchase.patient_id, v_programme.condition, 'draft')
    returning id into v_care_plan_id;
  end if;

  update public.programme_purchases
     set enrolment_id = v_enrolment_id,
         care_plan_id = v_care_plan_id
   where id = p_purchase_id;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    v_purchase.organisation_id,
    v_purchase.patient_id,
    'clinician_review',
    'open',
    'New paid programme enrolment — set clinical targets',
    format(
      'Patient has purchased the %s programme (%s weeks, ends %s). Set clinical targets and activate the care plan.',
      v_programme.name, v_purchase.duration_weeks, v_purchase.ends_at
    ),
    2
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Patient reads/inserts own rows only, no patient UPDATE (status
-- transitions are service-role/trigger-driven only, same as lab_orders'
-- payment fields). Staff read/update within their org (e.g. to cancel/refund).
-- ---------------------------------------------------------------------------
alter table public.programme_purchases enable row level security;

create policy programme_purchases_select on public.programme_purchases
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy programme_purchases_insert on public.programme_purchases
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy programme_purchases_update on public.programme_purchases
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.programme_purchases to authenticated;
-- `revoke ... from public` is what actually removes the PUBLIC pseudo-grant
-- anon inherits through on this project; a bare `revoke ... from anon` alone
-- is a no-op when anon never held a direct grant — same standing gotcha as
-- every anon-EXECUTE revoke elsewhere in this codebase, applied here to a
-- table grant instead of a function. (Kept the broader `from public, anon`
-- form over a concurrently-landed narrower `from anon`-only fix for this
-- same table — verified live via has_table_privilege that this form
-- actually closes the gap; strictly a superset, never a regression.)
revoke all on public.programme_purchases from public, anon;

-- ---------------------------------------------------------------------------
-- Assert.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.programme_purchases', 'SELECT')
     or has_table_privilege('anon', 'public.programme_purchases', 'INSERT') then
    raise exception 'FAIL: anon must have no access to programme_purchases';
  end if;
  if not has_table_privilege('authenticated', 'public.programme_purchases', 'INSERT') then
    raise exception 'FAIL: authenticated must be able to insert programme_purchases (RLS carries the restriction)';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'programme_purchases_compute_price') then
    raise exception 'FAIL: price-computation trigger missing';
  end if;
  if pg_get_functiondef('private.set_programme_purchase_computed_price()'::regprocedure) !~ 'is_active' then
    raise exception 'FAIL: price trigger does not check programme is_active';
  end if;
end $$;
