-- Tarragon Health — Platform Credit pays for Video Visit bookings, part 2:
-- give a ledger entry a generic booking-order link.
--
-- private.platform_credit_apply's ledger insert can already attribute a
-- spend to a service_purchases row (service_purchase_id) — that covers the
-- general-purpose paid-service catalogue this feature launched against
-- (20260917100605_platform_credit_spend_on_service_purchase.sql). A video
-- visit booking is NOT a service_purchases row — it's its own
-- video_visit_requests table (pre-dating service_products, and HELD until a
-- doctor accepts, per 20260723120000) — so its spend needs its own
-- correlator rather than overloading service_purchase_id for something it
-- doesn't reference.
--
-- Reuses the exact polymorphic shape payment_transactions already uses for
-- the same problem (booking_order_id/booking_order_type, see
-- 20260715001642_booking_payment_columns.sql) instead of inventing a new
-- one: a bare uuid with no FK (the source table varies by type) plus a
-- discriminator. Deliberately `text` here, not `public.commission_type` —
-- that enum is lab/pharmacy/referral/home_visit/delivery/service_purchase
-- only and has no 'video_visit' member (confirmed live), so borrowing it
-- would need an ALTER TYPE ... ADD VALUE this migration set has no reason
-- to take on. A plain text discriminator lets 'video_visit' (this PR) and
-- whatever a parallel pharmacy-orders Platform Credit effort needs stand on
-- their own, with no shared-enum coupling between two independently
-- shipping features.
--
-- RECONCILIATION NOTE: as of this migration, a live schema check
-- (information_schema.columns for platform_credit_ledger_entries) and a
-- repo-wide grep found no prior migration adding these two columns — a
-- parallel "Platform Credit for pharmacy orders" effort may add the exact
-- same pair independently. `add column if not exists` below makes a second,
-- differently-named migration attempting the same columns a safe no-op
-- rather than a conflict; if both land, fold the two migrations' comments
-- together rather than leaving two competing headers describing the same
-- two columns.

alter table public.platform_credit_ledger_entries
  add column if not exists booking_order_id   uuid,
  add column if not exists booking_order_type  text;

create index if not exists platform_credit_ledger_entries_booking_order_idx
  on public.platform_credit_ledger_entries (booking_order_id)
  where booking_order_id is not null;

comment on column public.platform_credit_ledger_entries.booking_order_id is
  'Generic polymorphic link (no FK -- source table varies by booking_order_type), same pattern as payment_transactions.booking_order_id. Set for a video-visit spend (booking_order_type = ''video_visit''); null for a service_purchases-linked spend, which keeps using service_purchase_id instead.';
comment on column public.platform_credit_ledger_entries.booking_order_type is
  'Discriminator for booking_order_id. Deliberately text, not public.commission_type (that enum is lab/pharmacy/referral/home_visit/delivery/service_purchase only, no video_visit member) -- video_visit is the first value written here; other booking-order Platform Credit spends can add their own without a shared enum dependency.';

-- ---------------------------------------------------------------------------
-- Extend private.platform_credit_apply with two new optional trailing
-- params so a 'spend' entry can carry the booking-order link above. Every
-- existing call site uses named arguments (p_patient_id := ..., etc — see
-- pay_service_purchase_on_platform_credit, grant/correct_platform_credit,
-- the topup-confirmation trigger), so adding params at the end with
-- defaults changes nothing for any of them.
--
-- Postgres note (same root cause CLAUDE.md's migration-timestamp lesson
-- warns about — two things identical to a human are not identical to
-- Postgres): CREATE OR REPLACE FUNCTION cannot add a parameter to an
-- existing function, because the argument-type list is part of a
-- function's identity — attempting it silently creates a second, OVERLOADED
-- function alongside the original rather than replacing it. DROP the exact
-- old signature first, then CREATE the new one, in this same migration/
-- transaction, so nothing is ever missing in between and there is never a
-- moment with two co-existing overloads.
-- ---------------------------------------------------------------------------

drop function if exists private.platform_credit_apply(
  uuid, uuid, public.platform_credit_entry_type, bigint, public.platform_credit_bucket, text,
  uuid, uuid, uuid, text, uuid
);

create or replace function private.platform_credit_apply(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_entry_type public.platform_credit_entry_type,
  p_amount_kobo bigint,
  p_correction_bucket public.platform_credit_bucket default null,
  p_correction_direction text default null,
  p_service_purchase_id uuid default null,
  p_payment_transaction_id uuid default null,
  p_topup_intent_id uuid default null,
  p_description text default null,
  p_created_by uuid default null,
  p_booking_order_id uuid default null,
  p_booking_order_type text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance public.platform_credit_balances%rowtype;
  v_paid_amount bigint := 0;
  v_promo_amount bigint := 0;
  v_from_promo bigint;
  v_from_paid bigint;
  v_new_balance bigint;
begin
  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'platform credit movement amount must be positive';
  end if;

  insert into public.platform_credit_balances (patient_id, organisation_id)
    values (p_patient_id, p_organisation_id)
    on conflict (patient_id) do nothing;

  select * into v_balance from public.platform_credit_balances
    where patient_id = p_patient_id for update;

  if p_entry_type = 'topup' then
    v_paid_amount := p_amount_kobo;
    update public.platform_credit_balances
      set paid_balance_kobo = paid_balance_kobo + v_paid_amount,
          lifetime_funded_kobo = lifetime_funded_kobo + v_paid_amount
      where patient_id = p_patient_id;

  elsif p_entry_type = 'admin_grant' then
    v_promo_amount := p_amount_kobo;
    update public.platform_credit_balances
      set promo_balance_kobo = promo_balance_kobo + v_promo_amount,
          lifetime_granted_kobo = lifetime_granted_kobo + v_promo_amount
      where patient_id = p_patient_id;

  elsif p_entry_type = 'spend' then
    v_from_promo := least(v_balance.promo_balance_kobo, p_amount_kobo);
    v_from_paid := p_amount_kobo - v_from_promo;
    if v_from_paid > v_balance.paid_balance_kobo then
      raise exception 'insufficient platform credit balance: have % kobo, need % kobo',
        v_balance.balance_kobo, p_amount_kobo
        using errcode = 'TH001';
    end if;
    v_promo_amount := v_from_promo;
    v_paid_amount := v_from_paid;
    update public.platform_credit_balances
      set promo_balance_kobo = promo_balance_kobo - v_from_promo,
          paid_balance_kobo = paid_balance_kobo - v_from_paid,
          lifetime_spent_kobo = lifetime_spent_kobo + p_amount_kobo
      where patient_id = p_patient_id;

  elsif p_entry_type = 'admin_correction' then
    if p_correction_bucket is null or p_correction_direction not in ('increase', 'decrease') then
      raise exception 'admin_correction requires a bucket and a direction of increase/decrease';
    end if;
    if p_correction_direction = 'decrease' then
      if p_correction_bucket = 'paid' and p_amount_kobo > v_balance.paid_balance_kobo then
        raise exception 'insufficient paid balance for this correction: have % kobo, need % kobo',
          v_balance.paid_balance_kobo, p_amount_kobo using errcode = 'TH001';
      end if;
      if p_correction_bucket = 'promo' and p_amount_kobo > v_balance.promo_balance_kobo then
        raise exception 'insufficient promo balance for this correction: have % kobo, need % kobo',
          v_balance.promo_balance_kobo, p_amount_kobo using errcode = 'TH001';
      end if;
    end if;
    if p_correction_bucket = 'paid' then
      v_paid_amount := p_amount_kobo;
      update public.platform_credit_balances
        set paid_balance_kobo = paid_balance_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else -p_amount_kobo end),
            lifetime_funded_kobo = lifetime_funded_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else 0 end)
        where patient_id = p_patient_id;
    else
      v_promo_amount := p_amount_kobo;
      update public.platform_credit_balances
        set promo_balance_kobo = promo_balance_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else -p_amount_kobo end),
            lifetime_granted_kobo = lifetime_granted_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else 0 end)
        where patient_id = p_patient_id;
    end if;
  else
    raise exception 'unhandled platform_credit_entry_type: %', p_entry_type;
  end if;

  select balance_kobo into v_new_balance from public.platform_credit_balances where patient_id = p_patient_id;

  insert into public.platform_credit_ledger_entries
    (organisation_id, patient_id, entry_type, paid_amount_kobo, promo_amount_kobo,
     balance_after_kobo, service_purchase_id, payment_transaction_id, topup_intent_id,
     description, created_by, booking_order_id, booking_order_type)
  values
    (p_organisation_id, p_patient_id, p_entry_type, v_paid_amount, v_promo_amount,
     v_new_balance, p_service_purchase_id, p_payment_transaction_id, p_topup_intent_id,
     p_description, p_created_by, p_booking_order_id, p_booking_order_type);

  -- Tell the patient when an admin moved money they didn't touch themselves.
  -- Their own topup/spend already gets immediate on-screen feedback from the
  -- page that triggered it, so this is deliberately scoped to the two
  -- admin-initiated entry types only.
  if p_entry_type in ('admin_grant', 'admin_correction') then
    begin
      insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
      values (
        p_organisation_id, p_patient_id, 'in_app', 'platform_credit_balance_adjusted',
        jsonb_build_object(
          'direction', case when p_entry_type = 'admin_grant' then 'increase' else p_correction_direction end,
          'amount_naira', (p_amount_kobo / 100)::text,
          'reason', p_description
        )
      );
    exception when others then
      -- A notification must never block the balance write it is reporting on.
      null;
    end;
  end if;

  return v_new_balance;
end;
$$;

revoke all on function private.platform_credit_apply(
  uuid, uuid, public.platform_credit_entry_type, bigint, public.platform_credit_bucket, text,
  uuid, uuid, uuid, text, uuid, uuid, text
) from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_credit_ledger_entries'
      and column_name = 'booking_order_id'
  ) then
    raise exception 'FAIL: platform_credit_ledger_entries.booking_order_id was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_credit_ledger_entries'
      and column_name = 'booking_order_type'
  ) then
    raise exception 'FAIL: platform_credit_ledger_entries.booking_order_type was not added';
  end if;
  if to_regprocedure(
    'private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid)'
  ) is not null then
    raise exception 'FAIL: the old 11-arg platform_credit_apply signature still exists as a separate overload';
  end if;
  if has_function_privilege('anon', 'private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid,uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.platform_credit_apply';
  end if;
  if has_function_privilege('authenticated', 'private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid,uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute private.platform_credit_apply directly';
  end if;
  raise notice 'PASS: platform_credit_ledger_entries booking-order link + platform_credit_apply extension in place, exactly one overload exists';
end $$;
