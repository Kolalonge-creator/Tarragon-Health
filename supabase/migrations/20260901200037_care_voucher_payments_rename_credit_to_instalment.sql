-- Care Vouchers compliance hardening: rename credit_kobo -> instalment_kobo.
--
-- Cosmetic, not structural — the column already behaved correctly (capped at
-- face_value_kobo, scoped to one voucher_id, never a cross-voucher balance).
-- But "credit" is a word regulators watching for stored-value/e-money framing
-- specifically flag, even when it never reaches a user. min_instalment_kobo
-- (care_voucher_config) already uses the right word; this makes the payments
-- table consistent with it.

alter table public.care_voucher_payments rename column credit_kobo to instalment_kobo;

comment on column public.care_voucher_payments.instalment_kobo is
  'Kobo amount of this single instalment toward the voucher''s face value. Named "instalment", not "credit" — this is layaway against one named voucher_id, never a spendable balance. See care_vouchers_purchase_and_layaway.sql for the cap enforcement.';

-- A bare CREATE OR REPLACE rejects changing an input parameter's NAME
-- (SQLSTATE 42P13) -- the prior version of this function had p_credit_kobo
-- in this position, matching the pre-rename column. Drop by the type-only
-- signature first (confirmed live on koiplnmbgnqnbywhpjlf, where this exact
-- function/column rename already exists but was applied out-of-band with no
-- migration recorded for it -- see CLAUDE.md's "a live schema object can
-- exist with no migration record at all" standing lesson -- so this
-- migration is not itself live yet and this DROP only matters for a fresh
-- replay reaching the function's original p_credit_kobo-named definition).
drop function if exists public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text);

create or replace function public.record_voucher_payment_intent(
  p_voucher uuid,
  p_amount_minor bigint,
  p_currency text,
  p_instalment_kobo bigint,
  p_provider public.payment_provider,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_voucher public.care_vouchers%rowtype;
  v_outstanding bigint;
  v_min bigint;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_voucher from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_voucher.kind <> 'prepaid_service' then
    raise exception 'reward vouchers are not paid for';
  end if;
  if v_voucher.status <> 'reserved' then
    raise exception 'this voucher is not awaiting payment';
  end if;
  if not private.can_purchase_voucher_for(v_voucher.beneficiary_profile_id, v_caller) then
    raise exception 'You are not authorised to pay toward this voucher' using errcode = '42501';
  end if;

  select min_instalment_kobo into v_min from public.care_voucher_config where id = true;
  v_outstanding := v_voucher.face_value_kobo - v_voucher.amount_paid_kobo
                   - coalesce((select sum(instalment_kobo) from public.care_voucher_payments
                               where voucher_id = p_voucher and status = 'pending'), 0);

  if p_instalment_kobo <= 0 then raise exception 'instalment must be positive'; end if;
  if p_instalment_kobo > v_outstanding then
    raise exception 'that is more than is outstanding on this voucher';
  end if;
  -- The final instalment may be smaller than the minimum; otherwise a
  -- remainder below the floor would be unpayable.
  if p_instalment_kobo < v_min and p_instalment_kobo <> v_outstanding then
    raise exception 'the smallest instalment is %', (v_min / 100)::text;
  end if;

  insert into public.care_voucher_payments (
    organisation_id, voucher_id, payer_profile_id,
    amount_minor, currency, instalment_kobo, provider, pending_provider_ref, status
  ) values (
    v_voucher.organisation_id, p_voucher, v_caller,
    p_amount_minor, p_currency, p_instalment_kobo, p_provider, p_reference, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function private.apply_voucher_payment_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_pay public.care_voucher_payments%rowtype;
  v_voucher public.care_vouchers%rowtype;
  v_new_paid bigint;
  v_months integer;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'voucher_payment' then return new; end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then return new; end if;

  select * into v_pay from public.care_voucher_payments
   where pending_provider_ref = v_ref and status = 'pending' for update;
  if not found then return new; end if;

  select * into v_voucher from public.care_vouchers where id = v_pay.voucher_id for update;
  if not found then return new; end if;

  v_new_paid := least(v_voucher.amount_paid_kobo + v_pay.instalment_kobo, v_voucher.face_value_kobo);
  select validity_months into v_months from public.care_voucher_config where id = true;

  if v_new_paid >= v_voucher.face_value_kobo then
    -- Paid in full: the voucher becomes redeemable, and the expiry clock starts
    -- HERE rather than at reservation, so a long layaway never eats the
    -- validity window the patient was promised.
    update public.care_vouchers
       set amount_paid_kobo = v_new_paid,
           status = 'active',
           activated_at = now(),
           expires_at = now() + make_interval(months => v_months)
     where id = v_voucher.id;
  else
    update public.care_vouchers set amount_paid_kobo = v_new_paid where id = v_voucher.id;
  end if;

  update public.care_voucher_payments
     set status = 'applied', payment_transaction_id = new.id
   where id = v_pay.id;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values
    (v_voucher.organisation_id, v_voucher.id, 'payment_applied', v_pay.payer_profile_id,
     v_pay.instalment_kobo, 'Instalment received');

  if v_new_paid >= v_voucher.face_value_kobo then
    insert into public.care_voucher_events
      (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
    values
      (v_voucher.organisation_id, v_voucher.id, 'activated', v_pay.payer_profile_id,
       v_voucher.face_value_kobo, 'Paid in full and ready to use');
  end if;

  return new;
end;
$$;

revoke all on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from public;
revoke all on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from anon;
grant execute on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) to authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_voucher_payments' and column_name = 'credit_kobo'
  ) then
    raise exception 'credit_kobo should have been renamed to instalment_kobo';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_voucher_payments' and column_name = 'instalment_kobo'
  ) then
    raise exception 'instalment_kobo column is missing';
  end if;
  if has_function_privilege('anon', 'public.record_voucher_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE') then
    raise exception 'anon must not be able to pay for vouchers';
  end if;
  if not has_function_privilege('authenticated', 'public.record_voucher_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE') then
    raise exception 'authenticated must be able to pay for vouchers';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payment_transactions_apply_voucher_payment') then
    raise exception 'the voucher payment trigger is missing after redefinition';
  end if;
end $$;
