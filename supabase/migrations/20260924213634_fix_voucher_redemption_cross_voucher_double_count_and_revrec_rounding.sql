-- Fixes found by /code-review high on 20260924211113/20260924211136 before
-- opening the PR — three independent review angles caught real problems in
-- the amount fix and the new dashboard RPC those migrations shipped.
--
-- BUG 1 — CROSS-VOUCHER DOUBLE-COUNTING. 20260924211113 fixed
-- private.finance_post_voucher_redeemed's overstatement bug by reading the
-- redeemed order's own voucher_covered_kobo instead of the voucher's
-- face_value_kobo. That column is CUMULATIVE across every voucher ever
-- applied to that order (redeem_care_voucher sets it via
-- `voucher_covered_kobo = voucher_covered_kobo + v_covered`) — public.
-- redeem_care_voucher has no "only one discount per order" guard of its own
-- (that check lives in redeem_promo_code, one layer up, and doesn't apply
-- when redeem_care_voucher is called directly), so a partially-covering
-- voucher followed by a second voucher against the same still-pending
-- order is a real, reachable path. On the second redemption the trigger
-- would have read the now-cumulative total instead of what THIS voucher
-- contributed, overstating revenue by double-counting the first voucher's
-- amount — the exact class of bug the previous migration set out to fix,
-- reintroduced by the fix itself.
--
-- FIX. redeem_care_voucher already computes the correct per-voucher amount
-- in its own v_covered local variable; it just never persisted it anywhere
-- the trigger could read without re-deriving it from a shared column. Adds
-- care_vouchers.redeemed_amount_kobo, set once by redeem_care_voucher in
-- the same statement that marks the voucher 'redeemed' (a voucher is
-- single-use, so this column is written exactly once, ever, per voucher —
-- immune to any other voucher's activity on the same order). The trigger
-- now reads new.redeemed_amount_kobo directly instead of re-querying four
-- different order tables through a hand-written case statement.
--
-- BUG 2 — MID-PERIOD MISATTRIBUTION ACROSS MULTIPLE SCHEDULES. A single
-- service_purchase can accumulate more than one revenue_recognition_
-- schedules row: a partial voucher redemption creates one (this trigger),
-- and a later card payment or platform-credit spend for the remainder
-- creates a SEPARATE one (private.finance_post_from_payment /
-- private.finance_post_platform_credit_ledger_entry), each with its own
-- period. 20260924211136's finance_revenue_by_funding_source computed ONE
-- blended cash/promo ratio from the purchase's overall totals and applied
-- it to every schedule tied to that purchase — correct in total over the
-- purchase's full lifetime, but wrong for any single reporting period
-- queried before all of a purchase's schedules have posted revenue (e.g. a
-- voucher-only-funded September elapsed month reported as partly "cash"
-- because the order's lifetime total happens to include a card-paid
-- remainder that hasn't been recognised yet).
--
-- FIX. revenue_recognition_schedules gains promo_minor — the promotional
-- portion of THAT SPECIFIC schedule's total_minor, known precisely by
-- whichever trigger creates it (0 for every card-payment-created schedule,
-- the reward_discount-voucher-covered amount for this trigger's schedules,
-- new.promo_amount_kobo for a platform-credit-spend-created schedule).
-- finance_revenue_by_funding_source now reads promo_minor/total_minor
-- straight off each schedule instead of re-deriving a purchase-level ratio
-- — exact per period, and the purchase-level joins (service_purchases,
-- care_vouchers, platform_credit_ledger_entries, the per-recognition-row
-- lateral) are no longer needed at all, which also resolves two smaller
-- issues the same review pass found: a per-row lateral re-aggregating
-- platform_credit_ledger_entries once per recognition journal row instead
-- of once per purchase, and cash_amt/promo_amt being rounded independently
-- instead of one being the other's exact remainder.

alter table public.care_vouchers
  add column if not exists redeemed_amount_kobo bigint;

comment on column public.care_vouchers.redeemed_amount_kobo is
  'The amount THIS voucher actually covered on its redeeming order (redeem_care_voucher''s own v_covered), set once when status becomes ''redeemed''. NOT the same as face_value_kobo, and deliberately not re-derived from the order''s own voucher_covered_kobo column, which is cumulative across every voucher ever applied to that order.';

alter table public.revenue_recognition_schedules
  add column if not exists promo_minor bigint not null default 0;

alter table public.revenue_recognition_schedules
  add constraint revrec_promo_minor_within_total check (promo_minor >= 0 and promo_minor <= total_minor);

comment on column public.revenue_recognition_schedules.promo_minor is
  'The promotional (never-real-cash) portion of this specific schedule''s total_minor, set once at creation by whichever trigger knows precisely: 0 for a card-payment-funded schedule, the reward_discount-voucher-covered amount for a voucher-funded one, platform_credit_ledger_entries.promo_amount_kobo for a platform-credit-funded one. Deliberately per-schedule, not re-derived from the parent service_purchase''s lifetime totals, since one purchase can accumulate multiple schedules (a partial voucher plus a later card remainder) with different funding.';

-- ---------------------------------------------------------------------------
-- finance_create_recognition_schedule — one new trailing optional param.
-- Every existing positional call site (card payments, subscriptions/add-ons)
-- keeps working unchanged and defaults to promo_minor = 0 (fully cash,
-- correct — none of those paths can be promotional).
-- ---------------------------------------------------------------------------
create or replace function private.finance_create_recognition_schedule(
  p_source_kind text, p_source_id uuid, p_payment_txn uuid, p_org uuid,
  p_revenue_account text, p_currency public.currency, p_total bigint,
  p_period_start date, p_period_end date, p_promo_minor bigint default 0
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_payment_txn is not null then
    select id into v_id from public.revenue_recognition_schedules where payment_transaction_id = p_payment_txn;
    if v_id is not null then return v_id; end if;
  end if;
  if p_total is null or p_total <= 0 or p_period_end <= p_period_start then return null; end if;
  insert into public.revenue_recognition_schedules
    (source_kind, source_id, payment_transaction_id, organisation_id, revenue_account_code,
     currency, total_minor, period_start, period_end, promo_minor)
  values (p_source_kind, p_source_id, p_payment_txn, p_org, p_revenue_account,
          p_currency, p_total, p_period_start, p_period_end, greatest(least(coalesce(p_promo_minor, 0), p_total), 0))
  returning id into v_id;
  return v_id;
end; $$;

-- ---------------------------------------------------------------------------
-- redeem_care_voucher — pulled with pg_get_functiondef from the live
-- definition before writing this (it has been redefined since the
-- 20260901174915/20260902234700/20260902235000 migrations, most recently
-- adding the private.can_act_for()/private.log_care_access() caregiver
-- machinery) — every existing line is preserved verbatim; the only change
-- is the added redeemed_amount_kobo = v_covered in the final update.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_care_voucher(
  p_voucher uuid,
  p_order_type text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_v       public.care_vouchers%rowtype;
  v_patient uuid;
  v_status  text;
  v_payable bigint;
  v_bundle  uuid;
  v_covered bigint;
  v_fully   boolean;
  v_access_duration_days integer;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral', 'service_purchase') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;

  if v_v.beneficiary_profile_id <> v_caller
     and not private.can_act_for(v_v.beneficiary_profile_id, 'manage_payments'::public.caregiver_permission) then
    raise exception 'This voucher is not yours to use' using errcode = '42501';
  end if;

  if v_v.status = 'redeemed' then raise exception 'This voucher has already been used'; end if;
  if v_v.status = 'expired' then raise exception 'This voucher has expired'; end if;
  if v_v.status = 'cancelled' then raise exception 'This voucher was cancelled'; end if;
  if v_v.status = 'reserved' then
    raise exception 'This voucher is not paid for yet — % of % paid',
      (v_v.amount_paid_kobo / 100)::text, (v_v.face_value_kobo / 100)::text;
  end if;
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'This voucher expired on %', to_char(v_v.expires_at, 'DD Mon YYYY');
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, payable_kobo, panel_bundle_id
      into v_patient, v_status, v_payable, v_bundle
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.pharmacy_orders where id = p_order_id for update;
  elsif p_order_type = 'referral' then
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.specialist_referrals where id = p_order_id for update;
  else
    select patient_id, status::text, payable_kobo, service_product_id
      into v_patient, v_status, v_payable, v_bundle
      from public.service_purchases where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;

  if v_patient <> v_v.beneficiary_profile_id then
    raise exception 'This voucher can only be used for %s own care',
      (select coalesce(full_name, 'its beneficiary') from public.profiles where id = v_v.beneficiary_profile_id)
      using errcode = '42501';
  end if;
  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;

  if v_v.kind = 'prepaid_service' then
    if p_order_type <> 'lab' then
      raise exception 'A % voucher can only be used for the service it was bought for', v_v.sku_name;
    end if;
    if v_bundle is distinct from v_v.panel_bundle_id then
      raise exception 'This voucher is for %, so it cannot pay for a different service', v_v.sku_name;
    end if;
    v_covered := v_payable;
  else
    v_covered := least(v_v.face_value_kobo, v_payable);
  end if;

  v_fully := (v_payable - v_covered) <= 0;

  if p_order_type = 'lab' then
    update public.lab_orders
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.lab_order_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  elsif p_order_type = 'pharmacy' then
    update public.pharmacy_orders
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.pharmacy_order_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  elsif p_order_type = 'referral' then
    update public.specialist_referrals
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.referral_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  else
    select access_duration_days into v_access_duration_days
      from public.service_products where id = v_bundle;

    update public.service_purchases
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'active'::public.service_purchase_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end,
           purchased_at = case when v_fully then now() else purchased_at end,
           expires_at = case when v_fully and v_access_duration_days is not null
                             then now() + (v_access_duration_days || ' days')::interval
                             else expires_at end
     where id = p_order_id;
  end if;

  update public.care_vouchers
     set status = 'redeemed', redeemed_at = now(),
         redeemed_order_type = p_order_type::public.commission_type,
         redeemed_order_id = p_order_id,
         redeemed_amount_kobo = v_covered
   where id = v_v.id;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values
    (v_v.organisation_id, v_v.id, 'redeemed', v_caller, v_covered,
     case when v_v.kind = 'prepaid_service'
          then 'Used for ' || coalesce(v_v.sku_name, 'the service it was bought for')
          else 'Applied as a discount' end);

  perform private.log_care_access(
    v_v.beneficiary_profile_id, 'acted_for', 'billing',
    jsonb_build_object('order_type', p_order_type, 'order_id', p_order_id, 'voucher_id', v_v.id, 'covered_kobo', v_covered)
  );

  return jsonb_build_object(
    'ok', true,
    'covered_kobo', v_covered,
    'fully_covered', v_fully,
    'remaining_payable_kobo', greatest(v_payable - v_covered, 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_post_voucher_redeemed — read the per-voucher amount directly
-- instead of re-deriving it from four different order tables, and tag the
-- schedule it creates (if any) with exactly how much of it is promotional.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_voucher_redeemed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_liability text;
  v_covered bigint;
  v_promo bigint;
  v_access_duration_days integer;
  v_pstart date;
  v_pend date;
begin
  if new.status <> 'redeemed' or old.status = 'redeemed' then return new; end if;
  v_liability := case when new.kind = 'prepaid_service' then '2100' else '2600' end;

  v_covered := coalesce(new.redeemed_amount_kobo, new.face_value_kobo);
  if v_covered <= 0 then return new; end if;
  -- A prepaid_service voucher is real customer prepayment; anything else
  -- (a reward_discount voucher, the only other kind redeem_care_voucher
  -- reaches this branch for) is promotional in full.
  v_promo := case when new.kind = 'prepaid_service' then 0 else v_covered end;

  if new.redeemed_order_type::text = 'service_purchase' then
    select sp.access_duration_days into v_access_duration_days
    from public.service_purchases p
    join public.service_products sp on sp.id = p.service_product_id
    where p.id = new.redeemed_order_id;
  end if;

  if v_access_duration_days is not null then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'voucher', 'redeem:' || new.id::text,
      'Voucher redeemed — ' || coalesce(new.sku_name, 'care'),
      jsonb_build_array(
        jsonb_build_object('account_code',v_liability,'debit_minor',v_covered,'credit_minor',0,
                           'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',v_covered,
                           'organisation_id',new.organisation_id)),
      null);

    v_pstart := current_date;
    v_pend := (v_pstart + (v_access_duration_days || ' days')::interval)::date;
    if v_pend > v_pstart then
      perform private.finance_create_recognition_schedule(
        'service_purchase', new.redeemed_order_id, null, new.organisation_id,
        '4020', 'NGN'::public.currency, v_covered, v_pstart, v_pend, v_promo);
    end if;
  else
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'voucher', 'redeem:' || new.id::text,
      'Voucher redeemed — ' || coalesce(new.sku_name, 'care'),
      jsonb_build_array(
        jsonb_build_object('account_code',v_liability,'debit_minor',v_covered,'credit_minor',0,
                           'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_covered,
                           'organisation_id',new.organisation_id,'cost_center_code','PARTNER_NET')),
      null);
  end if;
  return new;
exception when others then
  return new; -- accounting must never block a patient getting their care
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_post_platform_credit_ledger_entry — byte-identical apart from
-- tagging the schedule it creates with new.promo_amount_kobo. Pulled with
-- pg_get_functiondef from the live definition before writing this.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_platform_credit_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_duration_days int;
  v_pstart date;
  v_pend date;
  v_total_kobo bigint;
  v_revenue_account text;
begin
  if new.entry_type = 'topup' then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'platform_credit', 'topup:' || new.id::text,
      'Platform credit top-up',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','2100','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
      null);

  elsif new.entry_type = 'admin_grant' then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'platform_credit', 'grant:' || new.id::text,
      coalesce('Platform credit granted — ' || new.description, 'Platform credit granted'),
      jsonb_build_array(
        jsonb_build_object('account_code','6000','debit_minor',new.promo_amount_kobo,'credit_minor',0,
                           'organisation_id',new.organisation_id,'cost_center_code','MARKETING'),
        jsonb_build_object('account_code','2600','debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
      null);

  elsif new.entry_type = 'spend' then
    v_access_duration_days := null;
    if new.service_purchase_id is not null then
      select sp.access_duration_days into v_access_duration_days
      from public.service_purchases p
      join public.service_products sp on sp.id = p.service_product_id
      where p.id = new.service_purchase_id;
    end if;
    v_revenue_account := case when v_access_duration_days is not null then '2000' else '4100' end;

    if new.paid_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'spend-paid:' || new.id::text,
        'Platform credit spent (customer funds) — ' || coalesce(new.description, 'service purchase'),
        jsonb_build_array(
          jsonb_build_object('account_code','2100','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code',v_revenue_account,'debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
    if new.promo_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'spend-promo:' || new.id::text,
        'Platform credit spent (promotional) — ' || coalesce(new.description, 'service purchase'),
        jsonb_build_array(
          jsonb_build_object('account_code','2600','debit_minor',new.promo_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code',v_revenue_account,'debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;

    if v_access_duration_days is not null then
      v_total_kobo := coalesce(new.paid_amount_kobo,0) + coalesce(new.promo_amount_kobo,0);
      v_pstart := current_date;
      v_pend := (v_pstart + (v_access_duration_days || ' days')::interval)::date;
      if v_total_kobo > 0 and v_pend > v_pstart then
        perform private.finance_create_recognition_schedule(
          'service_purchase', new.service_purchase_id, null, new.organisation_id,
          '4020', 'NGN'::public.currency, v_total_kobo, v_pstart, v_pend,
          coalesce(new.promo_amount_kobo, 0));
      end if;
    end if;

  elsif new.entry_type = 'admin_correction' then
    if new.paid_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'correction-paid:' || new.id::text,
        'Platform credit correction (paid) — ' || coalesce(new.description, 'manual adjustment'),
        jsonb_build_array(
          jsonb_build_object('account_code','2100','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
    if new.promo_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'correction-promo:' || new.id::text,
        'Platform credit correction (promo) — ' || coalesce(new.description, 'manual adjustment'),
        jsonb_build_array(
          jsonb_build_object('account_code','2600','debit_minor',new.promo_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_revenue_by_funding_source — recognised revenue now reads each
-- schedule's own promo_minor/total_minor directly. The per-purchase
-- service_purchases/care_vouchers/platform_credit_ledger_entries joins are
-- gone entirely — no longer needed, and no longer a per-recognition-row
-- lateral subquery. cash_amt/promo_amt are computed once and are exact
-- complements (amt - cash_amt), not two independent roundings.
-- ---------------------------------------------------------------------------
create or replace function public.finance_revenue_by_funding_source(
  p_period_start date default date_trunc('month', current_date)::date,
  p_period_end date default current_date,
  p_currency text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cur public.currency := coalesce(p_currency, 'NGN')::public.currency;
  v_cash bigint := 0;
  v_promo bigint := 0;
  v_unclassified bigint := 0;
  v_recog_cash bigint := 0;
  v_recog_promo bigint := 0;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;

  with immediate as (
    select
      l.credit_minor as amt,
      (select l2.account_code from public.finance_journal_lines l2
        where l2.entry_id = e.id and l2.debit_minor > 0 limit 1) as debit_account
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    join public.finance_accounts a on a.code = l.account_code
    where a.account_type = 'revenue' and l.currency = v_cur
      and e.source in ('payment', 'voucher', 'platform_credit')
      and e.entry_date between p_period_start and p_period_end
      and l.credit_minor > 0
  )
  select
    coalesce(sum(amt) filter (where debit_account in ('1020', '2100')), 0),
    coalesce(sum(amt) filter (where debit_account = '2600'), 0),
    coalesce(sum(amt) filter (where debit_account not in ('1020', '2100', '2600') or debit_account is null), 0)
  into v_cash, v_promo, v_unclassified
  from immediate;

  with recog as (
    select
      l.credit_minor as amt,
      nullif(split_part(e.source_ref, ':', 2), '')::uuid as schedule_id
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    join public.finance_accounts a on a.code = l.account_code
    where a.account_type = 'revenue' and l.currency = v_cur
      and e.source = 'revenue_recognition'
      and e.entry_date between p_period_start and p_period_end
      and l.credit_minor > 0
  ),
  funded as (
    select
      r.amt,
      case when s.total_minor > 0
           then round(r.amt * (s.total_minor - s.promo_minor)::numeric / s.total_minor)
           else r.amt
      end as cash_amt
    from recog r
    left join public.revenue_recognition_schedules s on s.id = r.schedule_id
  )
  select coalesce(sum(cash_amt), 0), coalesce(sum(amt - cash_amt), 0)
  into v_recog_cash, v_recog_promo
  from funded;

  v_cash := v_cash + v_recog_cash;
  v_promo := v_promo + v_recog_promo;

  return jsonb_build_object(
    'currency', p_currency,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'cash_minor', v_cash,
    'promotional_minor', v_promo,
    'unclassified_minor', v_unclassified,
    'total_minor', v_cash + v_promo + v_unclassified
  );
end;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_vouchers' and column_name = 'redeemed_amount_kobo'
  ) then
    raise exception 'redeemed_amount_kobo column was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'revenue_recognition_schedules' and column_name = 'promo_minor'
  ) then
    raise exception 'promo_minor column was not added';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_care_voucher')
      not like '%redeemed_amount_kobo = v_covered%' then
    raise exception 'redeem_care_voucher was not updated to persist the per-voucher covered amount';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'finance_post_voucher_redeemed')
      like '%from public.lab_orders where id = new.redeemed_order_id%' then
    raise exception 'finance_post_voucher_redeemed still re-derives the amount from a cumulative order column';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'finance_post_platform_credit_ledger_entry')
      not like '%coalesce(new.promo_amount_kobo, 0));%' then
    raise exception 'finance_post_platform_credit_ledger_entry was not updated to tag its schedule''s promo_minor';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'finance_revenue_by_funding_source')
      like '%platform_credit_ledger_entries%' then
    raise exception 'finance_revenue_by_funding_source still re-derives funding from purchase-level joins';
  end if;
end $$;
