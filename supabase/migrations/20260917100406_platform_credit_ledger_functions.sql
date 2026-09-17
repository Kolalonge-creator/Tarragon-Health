-- Tarragon Health — Platform Credit, part 3: the ledger primitive + top-up.
--
-- private.platform_credit_apply is the ONLY place any balance is ever
-- written. Every other function in this feature (the top-up confirmation
-- trigger, the spend RPC, the admin grant/correction RPCs) calls through it
-- rather than touching platform_credit_balances directly — same discipline as
-- private.finance_post_journal being the sole ledger-writer for the GL.

-- ---------------------------------------------------------------------------
-- private.platform_credit_apply — locks the balance row, applies one
-- movement, appends the ledger row, returns the new total balance.
--
-- Bucket rule (the whole point of this design — see the previous migration's
-- header): a 'spend' draws from promo_balance_kobo first, then
-- paid_balance_kobo, so promotional credit is used up before a patient's own
-- money — the customer's real money sits in the liability account the
-- longest, and a spend is always attributable back to exactly how much of it
-- was "our marketing cost" vs "their money" at the moment it happened.
-- ---------------------------------------------------------------------------

create or replace function private.platform_credit_apply(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_entry_type public.platform_credit_entry_type,
  p_amount_kobo bigint,
  p_correction_bucket public.platform_credit_bucket default null,
  p_correction_direction text default null, -- 'increase' | 'decrease', admin_correction only
  p_service_purchase_id uuid default null,
  p_payment_transaction_id uuid default null,
  p_topup_intent_id uuid default null,
  p_description text default null,
  p_created_by uuid default null
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
    -- Ledger rows always record a positive movement; the sign only ever lives
    -- in entry_type/description for admin_correction, never in the stored
    -- amount, so paid_amount_kobo/promo_amount_kobo stay >= 0 like every
    -- other row.
  else
    raise exception 'unhandled platform_credit_entry_type: %', p_entry_type;
  end if;

  select balance_kobo into v_new_balance from public.platform_credit_balances where patient_id = p_patient_id;

  insert into public.platform_credit_ledger_entries
    (organisation_id, patient_id, entry_type, paid_amount_kobo, promo_amount_kobo,
     balance_after_kobo, service_purchase_id, payment_transaction_id, topup_intent_id,
     description, created_by)
  values
    (p_organisation_id, p_patient_id, p_entry_type, v_paid_amount, v_promo_amount,
     v_new_balance, p_service_purchase_id, p_payment_transaction_id, p_topup_intent_id,
     p_description, p_created_by);

  return v_new_balance;
end;
$$;

revoke all on function private.platform_credit_apply(
  uuid, uuid, public.platform_credit_entry_type, bigint, public.platform_credit_bucket, text,
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_platform_credit_topup_intent — the pending row created before
-- checkout. Self-funding or sponsor-funding (same authority check as
-- purchase_care_voucher's private.can_purchase_voucher_for), any positive
-- amount within the config bounds.
-- ---------------------------------------------------------------------------

create or replace function public.record_platform_credit_topup_intent(
  p_patient_id uuid,
  p_amount_kobo bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_config public.platform_credit_config%rowtype;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  if not private.can_purchase_voucher_for(p_patient_id, v_caller) then
    raise exception 'you can only fund your own platform credit, or someone who has linked you to their care'
      using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient not found';
  end if;

  select * into v_config from public.platform_credit_config where id = true;
  if p_amount_kobo is null or p_amount_kobo < v_config.min_topup_kobo then
    raise exception 'the minimum top-up is % kobo', v_config.min_topup_kobo;
  end if;
  if p_amount_kobo > v_config.max_topup_kobo then
    raise exception 'the maximum top-up is % kobo', v_config.max_topup_kobo;
  end if;

  insert into public.platform_credit_topup_intents
    (organisation_id, patient_id, purchaser_profile_id, amount_kobo, currency, status)
  values
    (v_org, p_patient_id, v_caller, p_amount_kobo, 'NGN', 'pending_payment')
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_platform_credit_topup_intent(uuid, bigint) from public, anon;
grant execute on function public.record_platform_credit_topup_intent(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_stale_platform_credit_topup_intent — lets a patient abandon a
-- pending top-up that never completed (closed the tab, changed their mind),
-- mirroring the self-heal pattern in lib/finance/service-purchase-expiry.ts.
-- Only ever moves 'pending_payment' -> 'cancelled'; never touches a balance,
-- since a cancelled intent by definition never funded one.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_platform_credit_topup_intent(p_intent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  update public.platform_credit_topup_intents
    set status = 'cancelled', cancelled_at = now()
    where id = p_intent_id
      and status = 'pending_payment'
      and (purchaser_profile_id = v_caller or patient_id = v_caller
           or private.is_org_staff(organisation_id));
end;
$$;

revoke execute on function public.cancel_platform_credit_topup_intent(uuid) from public, anon;
grant execute on function public.cancel_platform_credit_topup_intent(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_platform_credit_topup_payment — same deliberate pattern as
-- voucher_payment/service_purchase (see checkout-metadata.ts): read only by
-- this AFTER INSERT trigger on payment_transactions, not by the deployed
-- webhooks, so it ships without redeploying either Edge Function.
-- ---------------------------------------------------------------------------

create or replace function private.apply_platform_credit_topup_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_intent public.platform_credit_topup_intents%rowtype;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'platform_credit_topup' then
    return new;
  end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then
    return new;
  end if;

  select * into v_intent from public.platform_credit_topup_intents
    where pending_payment_provider_ref = v_ref and status = 'pending_payment'
    for update;
  if not found then
    return new;
  end if;

  update public.platform_credit_topup_intents
    set status = 'completed',
        payment_provider = new.provider,
        payment_provider_ref = v_ref,
        pending_payment_provider_ref = null,
        completed_at = now()
    where id = v_intent.id;

  perform private.platform_credit_apply(
    p_patient_id := v_intent.patient_id,
    p_organisation_id := v_intent.organisation_id,
    p_entry_type := 'topup',
    p_amount_kobo := v_intent.amount_kobo,
    p_payment_transaction_id := new.id,
    p_topup_intent_id := v_intent.id,
    p_description := 'Platform credit top-up'
  );

  return new;
end;
$$;

drop trigger if exists payment_transactions_apply_platform_credit_topup on public.payment_transactions;
create trigger payment_transactions_apply_platform_credit_topup
  after insert on public.payment_transactions
  for each row execute function private.apply_platform_credit_topup_payment();

-- ---------------------------------------------------------------------------
-- grant_platform_credit / correct_platform_credit — admin-only. A grant is
-- always promo (nobody paid); a correction moves a specific bucket in a
-- specific direction, for the rare manual-reconciliation case (e.g. a bank
-- transfer top-up settled outside Paystack).
-- ---------------------------------------------------------------------------

create or replace function public.grant_platform_credit(
  p_patient_id uuid,
  p_amount_kobo bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for a platform credit grant';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient not found';
  end if;

  return private.platform_credit_apply(
    p_patient_id := p_patient_id,
    p_organisation_id := v_org,
    p_entry_type := 'admin_grant',
    p_amount_kobo := p_amount_kobo,
    p_description := p_reason,
    p_created_by := auth.uid()
  );
end;
$$;

revoke execute on function public.grant_platform_credit(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.grant_platform_credit(uuid, bigint, text) to authenticated;
-- (RLS-equivalent gate is the private.is_admin() check inside the function
-- body, same shape as every other admin-only RPC in this codebase — the
-- `authenticated` grant is required for ANY signed-in caller to invoke it at
-- all, the function itself is what actually restricts it to admins.)

create or replace function public.correct_platform_credit(
  p_patient_id uuid,
  p_bucket public.platform_credit_bucket,
  p_direction text,
  p_amount_kobo bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for a platform credit correction';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient not found';
  end if;

  return private.platform_credit_apply(
    p_patient_id := p_patient_id,
    p_organisation_id := v_org,
    p_entry_type := 'admin_correction',
    p_amount_kobo := p_amount_kobo,
    p_correction_bucket := p_bucket,
    p_correction_direction := p_direction,
    p_description := p_reason,
    p_created_by := auth.uid()
  );
end;
$$;

revoke execute on function public.correct_platform_credit(uuid, public.platform_credit_bucket, text, bigint, text) from public, anon, authenticated;
grant execute on function public.correct_platform_credit(uuid, public.platform_credit_bucket, text, bigint, text) to authenticated;

do $$
begin
  -- private schema functions are born authenticated-executable by default
  -- (see 20260812003758_revoke_private_schema_execute_from_public.sql) —
  -- platform_credit_apply is a pure internal primitive with no caller-identity
  -- check of its own, so both anon AND authenticated must be revoked, not
  -- just anon (the existing anon-only CI check would not have caught this).
  if has_function_privilege('anon', 'private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.platform_credit_apply';
  end if;
  if has_function_privilege('authenticated', 'private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute private.platform_credit_apply directly';
  end if;
  if has_function_privilege('anon', 'public.grant_platform_credit(uuid,bigint,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute grant_platform_credit';
  end if;
  raise notice 'PASS: platform_credit ledger primitive + top-up + admin grant/correction in place';
end $$;
