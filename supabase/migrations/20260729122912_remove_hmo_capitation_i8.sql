-- ---------------------------------------------------------------------------
-- I8 — no capitation, ever.
--
-- Founder decision 2026-07-29: capitation is removed from the platform as a
-- product, not merely disabled. Every surface goes: the finance register, the
-- ledger account, the dead b2b contract table, and — most importantly — the
-- two enum VALUES that let a capitated state be expressed at all. Leaving
-- 'capitation'/'capitated' behind as unreachable enum members is exactly the
-- loophole that lets the feature grow back; after this migration a future
-- capitation feature cannot be written without a new migration that visibly
-- re-adds the value, which is the point.
--
-- Verified before writing: all six affected tables hold ZERO rows, so nothing
-- here converts or discards real data.
--   hmo_contracts 0 · finance_capitation_contracts 0 · finance_capitation_receipts 0
--   outcomes_contracts 0 · journal lines on account 4300: 0 · all order tables 0
-- ---------------------------------------------------------------------------

-- 1. Finance capitation register (2026-07-26 finance dashboard v2) --------------

drop function if exists public.finance_record_capitation_receipt(uuid, date, integer, bigint, date, text, bigint, text);
drop function if exists public.finance_upsert_capitation_contract(uuid, uuid, text, bigint, text, date, date, boolean, text);
drop function if exists public.finance_capitation_register();

-- Existed only to populate the capitation contract form's HMO picker; no other
-- finance surface calls it.
drop function if exists public.finance_hmo_organisations_list();

drop table if exists public.finance_capitation_receipts;
drop table if exists public.finance_capitation_contracts;

-- 4300 was seeded by the capitation migration purely to keep capitation income
-- distinct from fee-for-service revenue. With no capitation there is nothing to
-- keep distinct. Guarded on zero postings so this can never silently orphan a
-- real journal line.
do $$
begin
  if exists (select 1 from public.finance_journal_lines where account_code = '4300') then
    raise exception 'account 4300 still carries journal lines; refusing to delete it';
  end if;
  delete from public.finance_accounts where code = '4300';
end $$;

-- 2. hmo_contracts (2026-07-05 b2b_billing) ------------------------------------
-- Created in the very first B2B migration with a capitation_rate_kobo column and
-- never read by a single line of application code since. Dead on arrival.

drop table if exists public.hmo_contracts;

-- 3. outcomes_contract_type loses 'capitation' ---------------------------------

alter type public.outcomes_contract_type rename to outcomes_contract_type_old;

create type public.outcomes_contract_type as enum ('fee_at_risk', 'flat');

alter table public.outcomes_contracts
  alter column contract_type type public.outcomes_contract_type
  using contract_type::text::public.outcomes_contract_type;

drop type public.outcomes_contract_type_old;

-- 4. booking_origin loses 'capitated' ------------------------------------------
-- Three tables carry this column, each defaulting to 'patient_initiated'. Two
-- things reference the column and block a type swap: those defaults, and the
-- patient-self-insert RLS policies on lab_orders/pharmacy_orders. Both come off
-- and go back on completely unchanged — this step must not alter who can insert
-- what, only the type behind the column.

drop policy lab_orders_insert      on public.lab_orders;
drop policy pharmacy_orders_insert on public.pharmacy_orders;

alter table public.lab_orders           alter column origin drop default;
alter table public.pharmacy_orders      alter column origin drop default;
alter table public.specialist_referrals alter column origin drop default;

alter type public.booking_origin rename to booking_origin_old;

create type public.booking_origin as enum ('patient_initiated', 'clinically_triggered');

alter table public.lab_orders
  alter column origin type public.booking_origin using origin::text::public.booking_origin;
alter table public.pharmacy_orders
  alter column origin type public.booking_origin using origin::text::public.booking_origin;
alter table public.specialist_referrals
  alter column origin type public.booking_origin using origin::text::public.booking_origin;

alter table public.lab_orders
  alter column origin set default 'patient_initiated'::public.booking_origin;
alter table public.pharmacy_orders
  alter column origin set default 'patient_initiated'::public.booking_origin;
alter table public.specialist_referrals
  alter column origin set default 'patient_initiated'::public.booking_origin;

drop type public.booking_origin_old;

-- Restored verbatim: org staff may insert freely; a patient may only insert
-- their own, patient-initiated, not-clinician-ordered row.
create policy lab_orders_insert on public.lab_orders
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or (patient_id = (select auth.uid())
        and origin = 'patient_initiated'::public.booking_origin
        and ordered_by is null)
  );

create policy pharmacy_orders_insert on public.pharmacy_orders
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or (patient_id = (select auth.uid())
        and origin = 'patient_initiated'::public.booking_origin
        and ordered_by is null)
  );

-- 5. set_referral_specialist_provider loses its capitated bypass ---------------
-- Previously: a capitated organisation's referral skipped straight to
-- 'payment_confirmed' with origin 'capitated', i.e. the patient never paid
-- because the HMO's per-member fee was deemed to cover it. Without capitation
-- every referral takes the ordinary pending_payment path. Body is otherwise
-- unchanged from 20260724020810. CREATE OR REPLACE preserves the existing
-- grants (revoked from public, granted to authenticated).

create or replace function public.set_referral_specialist_provider(
  p_referral_id uuid,
  p_specialist_provider_id uuid
) returns public.specialist_referrals
language plpgsql security definer set search_path = '' as $$
declare
  v_referral public.specialist_referrals;
  v_provider public.specialist_providers;
begin
  select * into v_referral from public.specialist_referrals
    where id = p_referral_id and patient_id = (select auth.uid());
  if v_referral.id is null then
    raise exception 'Referral not found' using errcode = '42501';
  end if;

  if v_referral.specialist_provider_id is not null then
    raise exception 'This referral already has a specialist assigned' using errcode = '23514';
  end if;

  if v_referral.status <> 'pending' then
    raise exception 'This referral is not awaiting a specialist choice' using errcode = '23514';
  end if;

  select * into v_provider from public.specialist_providers
    where id = p_specialist_provider_id and is_active and specialist_type = v_referral.specialist_type;
  if v_provider.id is null then
    raise exception 'Specialist provider not found or does not match this referral' using errcode = '23514';
  end if;

  update public.specialist_referrals
    set specialist_provider_id = p_specialist_provider_id,
        referral_fee_kobo = v_provider.consultation_fee_kobo,
        status = 'pending_payment'::public.referral_status
    where id = p_referral_id
    returning * into v_referral;

  return v_referral;
end;
$$;

-- 6. decline_video_visit_request — stale comment only --------------------------
-- Logic is unchanged and was already correct (it branches on whether a real
-- payment ref exists). Only the comment mentioning a capitated request is
-- rewritten, so the deployed function keeps matching migration history.

create or replace function public.decline_video_visit_request(
  p_request_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
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
        -- Only a real captured payment has anything to reverse.
        refund_status = case when v_req.payment_provider_ref is not null then 'due' else null end
    where id = v_req.id;
end;
$$;

-- 7. Assertions ----------------------------------------------------------------
-- The removal is only real if it is provable. This block is what makes the
-- migration a test as well as a change.

do $$
declare
  v_problem text;
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outcomes_contract_type' and e.enumlabel = 'capitation'
  ) then
    raise exception 'outcomes_contract_type still offers a capitation value';
  end if;

  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'booking_origin' and e.enumlabel = 'capitated'
  ) then
    raise exception 'booking_origin still offers a capitated value';
  end if;

  select string_agg(c.relname, ', ') into v_problem
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname in
    ('hmo_contracts', 'finance_capitation_contracts', 'finance_capitation_receipts');
  if v_problem is not null then
    raise exception 'capitation tables still present: %', v_problem;
  end if;

  select string_agg(p.proname, ', ') into v_problem
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ilike '%capitat%';
  if v_problem is not null then
    raise exception 'functions still referencing capitation: %', v_problem;
  end if;

  if exists (select 1 from public.finance_accounts where code = '4300') then
    raise exception 'capitation revenue account 4300 still present';
  end if;

  -- The enum swap had to drop and recreate these; prove they came back, so a
  -- refactor can never quietly leave a booking table insertable by anyone.
  if (select count(*) from pg_policies
      where schemaname = 'public'
        and policyname in ('lab_orders_insert', 'pharmacy_orders_insert')) <> 2 then
    raise exception 'the patient-insert policies were not restored';
  end if;
end $$;
