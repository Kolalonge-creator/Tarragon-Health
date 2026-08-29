-- Paystack Dedicated Virtual Accounts (revenue-architecture spec §4.1: "the
-- single most under-appreciated build item on the list... if you build one
-- payment method first, build this one").
--
-- A patient is assigned their own permanent NUBAN (via Paystack's Dedicated
-- Virtual Account product — requires that product enabled on the real
-- merchant account, confirmed available 2026-08-29). They transfer to it
-- from their own bank app; Paystack fires charge.success the same way it
-- does for a card charge, tagged authorization.channel = 'dedicated_nuban'.
--
-- The reconciliation problem this creates and how it's solved: every other
-- payment path in this codebase pre-creates a `pending_provider_ref` for one
-- specific obligation BEFORE the charge happens (record_voucher_payment_intent,
-- the booking-checkout flow, subscription checkout), so the webhook always
-- knows exactly what a charge.success is for. A dedicated-account transfer
-- has no such reference — the patient just opened their bank app — so it can
-- only be resolved AFTER the fact, by customer identity (Paystack's
-- customer_code, captured at account-assignment time) plus what that patient
-- currently owes.
--
-- The rule this migration enforces, deliberately conservative: auto-apply
-- ONLY when the patient has EXACTLY ONE outstanding payable thing (one
-- reserved voucher in layaway, or one pending_payment booking order) —
-- because that is the only case where "which one did they mean" has a single
-- honest answer. Zero or more than one candidate goes to a staff-reviewed
-- queue (unmatched_bank_transfers) with the payer already identified, never
-- guessed. A booking order (no partial-payment concept anywhere in this
-- schema) is only auto-settled on an exact amount match; a voucher (which
-- already supports "pay small small") accepts a partial instalment, capped
-- at what's actually outstanding — an overpayment is credited up to that cap
-- and the excess is logged for a human, never silently absorbed.
--
-- No Edge Function change needed: paystack-webhook already writes every
-- verified charge.success into payment_transactions before branching on
-- metadata.kind (see apply_voucher_payment_from_transaction's own comment on
-- this pattern) — the trigger here rides that same insert.

create table public.patient_dedicated_accounts (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  profile_id                  uuid not null references public.profiles (id) on delete cascade unique,
  paystack_customer_code      text not null unique,
  paystack_dedicated_account_id text not null,
  account_number              text not null,
  bank_name                   text not null,
  bank_slug                   text not null,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now()
);

create index patient_dedicated_accounts_org_idx on public.patient_dedicated_accounts (organisation_id);

alter table public.patient_dedicated_accounts enable row level security;

create policy patient_dedicated_accounts_select on public.patient_dedicated_accounts
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- A patient provisions their own account directly (the Paystack customer +
-- dedicated-account API calls happen server-side in the Next.js action
-- before this insert; this table only ever records the result) — no
-- definer RPC needed, same shape as video_visit_prices' plain RLS-gated
-- writes.
create policy patient_dedicated_accounts_insert on public.patient_dedicated_accounts
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

grant select, insert on public.patient_dedicated_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Staff reconciliation queue for anything that couldn't be auto-matched.
-- organisation_id is nullable — same posture as payment_transactions.
-- organisation_id itself (references organisations on delete set null): a
-- transfer whose customer_code doesn't even resolve to a known account
-- genuinely has no organisation yet, and inventing one would misattribute it.
-- ---------------------------------------------------------------------------

create type public.bank_transfer_match_status as enum ('unmatched', 'matched', 'ignored');

create table public.unmatched_bank_transfers (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid references public.organisations (id) on delete set null,
  payment_transaction_id  uuid not null references public.payment_transactions (id) on delete cascade,
  profile_id              uuid references public.profiles (id) on delete set null,
  amount_kobo             bigint not null,
  status                  public.bank_transfer_match_status not null default 'unmatched',
  matched_source_type     text,
  matched_source_id       uuid,
  resolved_by             uuid references public.profiles (id) on delete set null,
  resolved_at             timestamptz,
  note                    text,
  created_at              timestamptz not null default now()
);

create index unmatched_bank_transfers_status_idx
  on public.unmatched_bank_transfers (status, created_at desc);
create unique index unmatched_bank_transfers_one_per_transaction
  on public.unmatched_bank_transfers (payment_transaction_id);

alter table public.unmatched_bank_transfers enable row level security;

create policy unmatched_bank_transfers_select on public.unmatched_bank_transfers
  for select to authenticated
  using (
    private.is_admin()
    or private.has_permission('finance.reconcile')
    or (organisation_id is not null and private.is_org_staff(organisation_id))
  );

grant select on public.unmatched_bank_transfers to authenticated;

insert into public.permissions (key, label, category, description)
values ('finance.reconcile', 'Reconcile unmatched bank transfers', 'Commercial',
        'Resolve a dedicated-account transfer that could not be auto-matched to what it was paying for')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Reconciliation: patient identity + amount, applied only when unambiguous.
-- ---------------------------------------------------------------------------

create or replace function private.reconcile_dedicated_account_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel        text;
  v_customer_code  text;
  v_amount         bigint;
  v_account        public.patient_dedicated_accounts%rowtype;
  v_voucher_count  int;
  v_booking_count  int;
  v_voucher        public.care_vouchers%rowtype;
  v_booking_id     uuid;
  v_booking_table  text;
  v_booking_payable bigint;
  v_new_paid       bigint;
  v_months         integer;
  v_credit         bigint;
begin
  if new.event_type <> 'charge.success' then return new; end if;

  v_channel := new.raw_payload #>> '{data,authorization,channel}';
  if v_channel is distinct from 'dedicated_nuban' then return new; end if;

  v_customer_code := new.raw_payload #>> '{data,customer,customer_code}';
  v_amount := new.amount_minor;
  if v_customer_code is null or v_amount is null or v_amount <= 0 then return new; end if;

  select * into v_account from public.patient_dedicated_accounts
    where paystack_customer_code = v_customer_code;

  if not found then
    insert into public.unmatched_bank_transfers
      (organisation_id, payment_transaction_id, profile_id, amount_kobo, note)
    values
      (null, new.id, null, v_amount,
       'No dedicated account on file for Paystack customer ' || v_customer_code);
    return new;
  end if;

  -- Candidate count: exactly one reserved voucher, or exactly one
  -- pending_payment booking order — never both at once counted as "one".
  select count(*) into v_voucher_count
    from public.care_vouchers
    where beneficiary_profile_id = v_account.profile_id
      and kind = 'prepaid_service' and status = 'reserved';

  select count(*) into v_booking_count from (
    select id from public.lab_orders where patient_id = v_account.profile_id and status = 'pending_payment'
    union all
    select id from public.pharmacy_orders where patient_id = v_account.profile_id and status = 'pending_payment'
    union all
    select id from public.specialist_referrals where patient_id = v_account.profile_id and status = 'pending_payment'
    union all
    select id from public.video_visit_requests where patient_id = v_account.profile_id and status = 'pending_payment'
  ) x;

  if v_voucher_count + v_booking_count <> 1 then
    insert into public.unmatched_bank_transfers
      (organisation_id, payment_transaction_id, profile_id, amount_kobo, note)
    values
      (v_account.organisation_id, new.id, v_account.profile_id, v_amount,
       format('%s candidate(s) outstanding (%s voucher, %s booking) — not unambiguous',
              v_voucher_count + v_booking_count, v_voucher_count, v_booking_count));
    return new;
  end if;

  if v_voucher_count = 1 then
    select * into v_voucher from public.care_vouchers
      where beneficiary_profile_id = v_account.profile_id
        and kind = 'prepaid_service' and status = 'reserved'
      for update;

    v_credit := least(v_amount, v_voucher.face_value_kobo - v_voucher.amount_paid_kobo);
    v_new_paid := v_voucher.amount_paid_kobo + v_credit;
    select validity_months into v_months from public.care_voucher_config where id = true;

    insert into public.care_voucher_payments
      (organisation_id, voucher_id, payer_profile_id, amount_minor, currency,
       credit_kobo, provider, status, payment_transaction_id)
    values
      (v_voucher.organisation_id, v_voucher.id, v_account.profile_id, v_amount, 'NGN',
       v_credit, 'paystack', 'applied', new.id);

    if v_new_paid >= v_voucher.face_value_kobo then
      update public.care_vouchers
         set amount_paid_kobo = v_new_paid, status = 'active', activated_at = now(),
             expires_at = now() + make_interval(months => v_months)
       where id = v_voucher.id;
    else
      update public.care_vouchers set amount_paid_kobo = v_new_paid where id = v_voucher.id;
    end if;

    insert into public.care_voucher_events
      (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
    values
      (v_voucher.organisation_id, v_voucher.id, 'payment_applied', v_account.profile_id, v_credit,
       'Bank transfer received via dedicated account');

    if v_amount > v_credit then
      insert into public.unmatched_bank_transfers
        (organisation_id, payment_transaction_id, profile_id, amount_kobo, status,
         matched_source_type, matched_source_id, note)
      values
        (v_account.organisation_id, new.id, v_account.profile_id, v_amount - v_credit, 'unmatched',
         'care_voucher', v_voucher.id,
         format('Transfer of %s exceeded the %s still owed on this voucher by %s — excess needs a human decision (refund or credit toward something else)',
                v_amount, v_voucher.face_value_kobo - v_voucher.amount_paid_kobo, v_amount - v_credit));
    end if;
    return new;
  end if;

  -- Exactly one booking order outstanding — only settle it on an exact
  -- amount match (bookings have no partial-payment concept anywhere else in
  -- this schema; a short transfer goes to the queue rather than silently
  -- leaving the order half-paid with no record of why).
  select id, 'lab_orders', payable_kobo into v_booking_id, v_booking_table, v_booking_payable
    from public.lab_orders where patient_id = v_account.profile_id and status = 'pending_payment';
  if v_booking_id is null then
    select id, 'pharmacy_orders', payable_kobo into v_booking_id, v_booking_table, v_booking_payable
      from public.pharmacy_orders where patient_id = v_account.profile_id and status = 'pending_payment';
  end if;
  if v_booking_id is null then
    select id, 'specialist_referrals', payable_kobo into v_booking_id, v_booking_table, v_booking_payable
      from public.specialist_referrals where patient_id = v_account.profile_id and status = 'pending_payment';
  end if;
  if v_booking_id is null then
    select id, 'video_visit_requests', amount_minor into v_booking_id, v_booking_table, v_booking_payable
      from public.video_visit_requests where patient_id = v_account.profile_id and status = 'pending_payment';
  end if;

  if v_booking_id is null or v_booking_payable is distinct from v_amount then
    insert into public.unmatched_bank_transfers
      (organisation_id, payment_transaction_id, profile_id, amount_kobo, note)
    values
      (v_account.organisation_id, new.id, v_account.profile_id, v_amount,
       case when v_booking_id is null then 'Expected one booking candidate but found none at apply time (raced?)'
            else format('Transfer of %s does not exactly match the %s owed on the outstanding order', v_amount, v_booking_payable) end);
    return new;
  end if;

  execute format(
    'update public.%I set status = %L, payment_provider = %L, payment_provider_ref = %L, pending_payment_provider_ref = null where id = %L',
    v_booking_table, 'payment_confirmed', 'paystack', new.provider_event_id, v_booking_id
  );

  return new;
exception when others then
  -- A reconciliation bug must never crash the webhook's own audit insert —
  -- the transfer stays visible in payment_transactions either way, and the
  -- error is captured for a human rather than lost.
  insert into public.unmatched_bank_transfers
    (organisation_id, payment_transaction_id, profile_id, amount_kobo, note)
  values
    (null, new.id, null, coalesce(v_amount, 0), 'Reconciliation error: ' || sqlerrm)
  on conflict (payment_transaction_id) do nothing;
  return new;
end;
$$;

drop trigger if exists payment_transactions_reconcile_dedicated_account on public.payment_transactions;
create trigger payment_transactions_reconcile_dedicated_account
  after insert on public.payment_transactions
  for each row execute function private.reconcile_dedicated_account_transfer();

-- ---------------------------------------------------------------------------
-- Staff resolution of a queued transfer.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_unmatched_bank_transfer(
  p_transfer_id uuid,
  p_action text, -- 'apply_to_voucher' | 'apply_to_booking' | 'ignore'
  p_source_id uuid default null,
  p_note text default null,
  p_booking_type text default null -- required, one of 'lab'|'pharmacy'|'referral'|'video_visit', when p_action = 'apply_to_booking'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_row public.unmatched_bank_transfers%rowtype;
  v_voucher public.care_vouchers%rowtype;
  v_new_paid bigint;
  v_months integer;
  v_credit bigint;
  v_booking_table text;
  v_patient_id uuid;
  v_status text;
  v_payable bigint;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('finance.reconcile')) then
    raise exception 'not authorised to reconcile bank transfers' using errcode = '42501';
  end if;

  select * into v_row from public.unmatched_bank_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer not found'; end if;
  if v_row.status <> 'unmatched' then
    return jsonb_build_object('ok', false, 'error', 'This transfer has already been resolved.');
  end if;

  if p_action = 'ignore' then
    update public.unmatched_bank_transfers
       set status = 'ignored', resolved_by = v_caller, resolved_at = now(), note = coalesce(p_note, note)
     where id = p_transfer_id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'apply_to_voucher' then
    if p_source_id is null then raise exception 'p_source_id is required'; end if;
    select * into v_voucher from public.care_vouchers where id = p_source_id for update;
    if not found or v_voucher.beneficiary_profile_id <> v_row.profile_id then
      return jsonb_build_object('ok', false, 'error', 'That voucher does not belong to this transfer''s payer.');
    end if;
    v_credit := least(v_row.amount_kobo, greatest(v_voucher.face_value_kobo - v_voucher.amount_paid_kobo, 0));
    if v_credit <= 0 then
      return jsonb_build_object('ok', false, 'error', 'That voucher has nothing outstanding.');
    end if;
    v_new_paid := v_voucher.amount_paid_kobo + v_credit;
    select validity_months into v_months from public.care_voucher_config where id = true;

    insert into public.care_voucher_payments
      (organisation_id, voucher_id, payer_profile_id, amount_minor, currency,
       credit_kobo, provider, status, payment_transaction_id)
    values
      (v_voucher.organisation_id, v_voucher.id, v_row.profile_id, v_row.amount_kobo, 'NGN',
       v_credit, 'paystack', 'applied', v_row.payment_transaction_id);

    if v_new_paid >= v_voucher.face_value_kobo then
      update public.care_vouchers
         set amount_paid_kobo = v_new_paid, status = 'active', activated_at = now(),
             expires_at = now() + make_interval(months => v_months)
       where id = v_voucher.id;
    else
      update public.care_vouchers set amount_paid_kobo = v_new_paid where id = v_voucher.id;
    end if;

    insert into public.care_voucher_events
      (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
    values
      (v_voucher.organisation_id, v_voucher.id, 'payment_applied', v_caller, v_credit,
       'Bank transfer reconciled by staff');

    update public.unmatched_bank_transfers
       set status = 'matched', resolved_by = v_caller, resolved_at = now(),
           matched_source_type = 'care_voucher', matched_source_id = v_voucher.id, note = coalesce(p_note, note)
     where id = p_transfer_id;
    return jsonb_build_object('ok', true, 'credited_kobo', v_credit);
  end if;

  if p_action = 'apply_to_booking' then
    if p_source_id is null or p_booking_type is null then
      raise exception 'p_source_id and p_booking_type are required';
    end if;
    v_booking_table := case p_booking_type
      when 'lab' then 'lab_orders'
      when 'pharmacy' then 'pharmacy_orders'
      when 'referral' then 'specialist_referrals'
      when 'video_visit' then 'video_visit_requests'
      else null
    end;
    if v_booking_table is null then
      raise exception 'unknown booking type %', p_booking_type;
    end if;

    execute format(
      'select patient_id, status::text, %s from public.%I where id = $1',
      case v_booking_table when 'video_visit_requests' then 'amount_minor' else 'payable_kobo' end,
      v_booking_table
    ) into v_patient_id, v_status, v_payable using p_source_id;

    if v_patient_id is null then
      return jsonb_build_object('ok', false, 'error', 'That order was not found.');
    end if;
    if v_patient_id <> v_row.profile_id then
      return jsonb_build_object('ok', false, 'error', 'That order does not belong to this transfer''s payer.');
    end if;
    if v_status <> 'pending_payment' then
      return jsonb_build_object('ok', false, 'error', 'That order is not awaiting payment.');
    end if;
    if v_payable is distinct from v_row.amount_kobo then
      return jsonb_build_object('ok', false, 'error',
        format('The transfer (%s) does not match what is owed (%s) — apply a partial amount toward a voucher instead, or leave this queued.', v_row.amount_kobo, v_payable));
    end if;

    execute format(
      'update public.%I set status = %L, payment_provider = %L, payment_provider_ref = %L, pending_payment_provider_ref = null where id = $1',
      v_booking_table, 'payment_confirmed', 'paystack', 'staff-reconciled:' || v_row.id::text
    ) using p_source_id;

    update public.unmatched_bank_transfers
       set status = 'matched', resolved_by = v_caller, resolved_at = now(),
           matched_source_type = p_booking_type, matched_source_id = p_source_id, note = coalesce(p_note, note)
     where id = p_transfer_id;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'Unknown action.');
end;
$$;

revoke all on function public.resolve_unmatched_bank_transfer(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.resolve_unmatched_bank_transfer(uuid, text, uuid, text, text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'unmatched_bank_transfers' and cmd <> 'SELECT'
  ) then
    raise exception 'unmatched_bank_transfers must have no direct write policy: writes go through the trigger/definer RPC only';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payment_transactions_reconcile_dedicated_account') then
    raise exception 'the dedicated-account reconciliation trigger was not attached';
  end if;
end $$;;
