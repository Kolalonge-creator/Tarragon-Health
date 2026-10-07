-- Tarragon Health — fix finance_unified_ledger's blind spot for Platform
-- Credit (20260917100300 onward).
--
-- Found in a founder-requested audit of the new feature: the General Ledger
-- browser (source='platform_credit') shows every posted entry correctly, but
-- finance's "look up a patient's transactions" tool
-- (finance_unified_ledger(p_profile_id => ...), also what a patient's own
-- Receipts-style lookup would use) returns nothing for a patient with real,
-- GL-posted platform credit activity.
--
-- Root cause: `finance_unified_ledger`'s `rows` CTE resolves a journal
-- entry's payer by `left join public.payment_transactions pt on pt.id::text
-- = je.source_ref`, then `private.resolve_payment_payer(pt)`. Every other
-- source this join was built for (payment/refund/voucher/service_purchase)
-- posts with `source_ref = <payment_transactions.id>::text` — see this
-- file's sibling fix, 20260902200003, for the exact precedent. Platform
-- credit's finance-posting trigger
-- (private.finance_post_platform_credit_ledger_entry, part 5 of the feature)
-- instead posts with `source_ref = '<kind>:' || platform_credit_ledger_
-- entries.id`, e.g. 'topup:<uuid>' or 'spend-promo:<uuid>' — that never
-- matches any payment_transactions.id, so `pt` is always null for a
-- platform_credit row and `resolve_payment_payer(null)` silently returns
-- null. The row still surfaces (the LEFT JOIN keeps it), which is why
-- finance's org-wide GL view looked correct — it fell back to a
-- finance_journal_lines join for organisation_id — but `payer_profile_id`
-- was never set, so any lookup filtered to one patient dropped it.
--
-- Fix: read-side only, no schema change (same discipline as 20260902200003)
-- — resolve a platform_credit row's payer/organisation straight from the
-- ledger entry the source_ref already names, via a small helper that safely
-- extracts the uuid suffix (returns null rather than erroring on anything
-- that isn't actually a platform_credit source_ref, so it can be evaluated
-- unconditionally in a LEFT JOIN across every source without risking an
-- invalid-uuid cast blowing up the whole query for unrelated rows).
--
-- Also extends private.resolve_payment_payer/payment_transaction_service_
-- label with a platform_credit_topup branch, exactly mirroring the
-- service_purchase branch 20260902200003 added — this covers the CTE's
-- second arm (a failed payment_transactions row with no journal entry
-- behind it yet, resolved directly from `pt`, not through the ledger-entry
-- join above).

-- ---------------------------------------------------------------------------
-- private.parse_platform_credit_source_ref — extracts the
-- platform_credit_ledger_entries.id embedded in a platform_credit journal
-- entry's source_ref ('topup:<uuid>', 'grant:<uuid>', 'spend-paid:<uuid>',
-- 'spend-promo:<uuid>', 'correction-paid:<uuid>', 'correction-promo:<uuid>'
-- — see private.finance_post_platform_credit_ledger_entry). Returns null for
-- anything that doesn't match rather than raising, so it is safe to call on
-- every row of a UNION regardless of that row's actual source.
-- ---------------------------------------------------------------------------
create or replace function private.parse_platform_credit_source_ref(p_source_ref text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return substring(
    p_source_ref from
    '^(?:topup|grant|spend-paid|spend-promo|correction-paid|correction-promo):([0-9a-fA-F-]{36})$'
  )::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function private.parse_platform_credit_source_ref(text) from public, anon;

-- ---------------------------------------------------------------------------
-- resolve_payment_payer / payment_transaction_service_label — add the
-- platform_credit_topup branch, byte-identical shape to the service_purchase
-- branch these already carry. Covers a raw payment_transactions row (the
-- CTE's failed-attempt arm) that hasn't posted a journal entry at all.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_payment_payer(p_txn public.payment_transactions)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select subscriber_id from public.subscriptions where id = p_txn.subscription_id),
    (select s.subscriber_id from public.subscription_add_ons a
       join public.subscriptions s on s.id = a.subscription_id
      where a.id = p_txn.subscription_add_on_id),
    (select payer_profile_id from public.care_voucher_payments
      where payment_transaction_id = p_txn.id limit 1),
    (
      select sp.patient_id
      from public.service_purchases sp
      where coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'service_purchase'
        and (
          sp.pending_payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
          or sp.payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
        )
      order by sp.updated_at desc
      limit 1
    ),
    (
      select pcti.patient_id
      from public.platform_credit_topup_intents pcti
      where coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'platform_credit_topup'
        and (
          pcti.pending_payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
          or pcti.payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
        )
      order by pcti.created_at desc
      limit 1
    ),
    case p_txn.booking_order_type::text
      when 'lab' then (select patient_id from public.lab_orders where id = p_txn.booking_order_id)
      when 'pharmacy' then (select patient_id from public.pharmacy_orders where id = p_txn.booking_order_id)
      when 'referral' then (select patient_id from public.specialist_referrals where id = p_txn.booking_order_id)
      else null
    end
  );
$$;

revoke all on function private.resolve_payment_payer(public.payment_transactions) from public, anon;

create or replace function private.payment_transaction_service_label(p_txn public.payment_transactions)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_txn.id is null then null
    when p_txn.booking_order_type is not null then initcap(p_txn.booking_order_type::text) || ' order'
    when p_txn.subscription_id is not null then 'Subscription'
    when p_txn.subscription_add_on_id is not null then 'Add-on'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'voucher_payment'
      then 'Care voucher payment'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'sponsored_subscription'
      then 'Sponsored subscription'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'service_purchase'
      then 'Service purchase'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'platform_credit_topup'
      then 'Platform credit top-up'
    else 'Payment'
  end;
$$;

revoke all on function private.payment_transaction_service_label(public.payment_transactions) from public, anon;

-- ---------------------------------------------------------------------------
-- finance_unified_ledger — add the platform_credit_ledger_entries join for
-- the journal-entry arm of the CTE. Everything else is byte-identical to
-- 20260830101217's definition.
-- ---------------------------------------------------------------------------
create or replace function public.finance_unified_ledger(
  p_profile_id uuid default null,
  p_organisation_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  entry_id uuid,
  payment_transaction_id uuid,
  entry_date date,
  posted_at timestamptz,
  source text,
  service_label text,
  payer_profile_id uuid,
  payer_label text,
  recipient_label text,
  direction text,
  amount_minor bigint,
  currency public.currency,
  status text,
  method text,
  memo text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile_id is null and p_organisation_id is null then
    raise exception 'finance_unified_ledger requires p_profile_id or p_organisation_id'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_profile_id is not null
     and p_profile_id is distinct from (select auth.uid())
     and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_organisation_id is not null and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      je.id as entry_id,
      pt.id as payment_transaction_id,
      je.entry_date,
      je.created_at as posted_at,
      je.source,
      coalesce(
        private.payment_transaction_service_label(pt),
        case when je.source = 'platform_credit' then
          case pce.entry_type
            when 'topup' then 'Platform credit top-up'
            when 'admin_grant' then 'Platform credit granted'
            when 'spend' then 'Platform credit spend'
            when 'admin_correction' then 'Platform credit correction'
            else 'Platform credit'
          end
        else initcap(je.source) end
      ) as service_label,
      coalesce(private.resolve_payment_payer(pt), pce.patient_id) as payer_profile_id,
      (case when je.source = 'refund' then 'money_out' else 'money_in' end) as direction,
      coalesce(
        pt.amount_minor,
        -- pt is always null for a platform_credit row (its source_ref never
        -- matches a payment_transactions.id — see the header). A 'spend' can
        -- post TWO journal entries off one ledger row, one per bucket
        -- touched (spend-paid/spend-promo) — each must show only its own
        -- bucket's amount, not pce.amount_kobo's paid+promo total, or a
        -- dual-bucket spend would double-count. topup/grant/correction-* are
        -- single-bucket by construction (see private.platform_credit_apply),
        -- so amount_kobo already equals the right bucket there.
        case
          when je.source_ref like 'spend-paid:%' then pce.paid_amount_kobo
          when je.source_ref like 'spend-promo:%' then pce.promo_amount_kobo
          when je.source_ref like 'correction-paid:%' then pce.paid_amount_kobo
          when je.source_ref like 'correction-promo:%' then pce.promo_amount_kobo
          when pce.id is not null then pce.amount_kobo
          else null
        end,
        0
      ) as amount_minor,
      je.currency,
      'completed'::text as status,
      pt.provider::text as method,
      je.memo,
      coalesce(pt.organisation_id, pce.organisation_id,
        (select l.organisation_id from public.finance_journal_lines l
          where l.entry_id = je.id and l.organisation_id is not null limit 1)) as organisation_id
    from public.finance_journal_entries je
    left join public.payment_transactions pt on pt.id::text = je.source_ref
    left join public.platform_credit_ledger_entries pce
      on je.source = 'platform_credit'
      and pce.id = private.parse_platform_credit_source_ref(je.source_ref)
    where je.entry_date >= coalesce(p_from, '1900-01-01'::date)
      and je.entry_date <= coalesce(p_to, '9999-12-31'::date)

    union all

    select
      null::uuid as entry_id,
      pt.id as payment_transaction_id,
      pt.created_at::date as entry_date,
      pt.created_at as posted_at,
      'payment'::text as source,
      coalesce(private.payment_transaction_service_label(pt), 'Payment attempt') as service_label,
      private.resolve_payment_payer(pt) as payer_profile_id,
      'money_in'::text as direction,
      coalesce(pt.amount_minor, 0) as amount_minor,
      pt.currency,
      'failed'::text as status,
      pt.provider::text as method,
      pt.error as memo,
      pt.organisation_id
    from public.payment_transactions pt
    where pt.error is not null
      and not exists (select 1 from public.finance_journal_entries je2 where je2.source_ref = pt.id::text)
      and pt.created_at::date >= coalesce(p_from, '1900-01-01'::date)
      and pt.created_at::date <= coalesce(p_to, '9999-12-31'::date)
  )
  select
    r.entry_id, r.payment_transaction_id, r.entry_date, r.posted_at, r.source,
    r.service_label, r.payer_profile_id,
    case when r.direction = 'money_in'
      then coalesce(nullif(trim(pr.full_name), ''), 'Patient')
      else 'Tarragon Health' end as payer_label,
    case when r.direction = 'money_in'
      then 'Tarragon Health'
      else coalesce(nullif(trim(pr.full_name), ''), 'Patient') end as recipient_label,
    r.direction, r.amount_minor, r.currency, r.status, r.method, r.memo
  from rows r
  left join public.profiles pr on pr.id = r.payer_profile_id
  where (p_profile_id is null or r.payer_profile_id = p_profile_id)
    and (p_organisation_id is null or r.organisation_id = p_organisation_id)
  order by r.posted_at desc
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.finance_unified_ledger(uuid, uuid, date, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — structural (every pre-existing branch survives, anon still
-- locked out, the helper parses correctly and fails safe) then a real
-- behavioural round trip proving a platform_credit top-up now resolves to
-- its actual patient payer in their own transaction lookup.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_patient uuid;
  v_org uuid;
  v_pre_existing_balance public.platform_credit_balances%rowtype;
  v_had_pre_existing_balance boolean;
  v_ledger_entry_id uuid;
  v_journal_entry_id uuid;
  v_result record;
  v_grant_ledger_entry_id uuid;
  v_spend_ledger_entry_id uuid;
  v_spend_paid_journal_id uuid;
  v_spend_promo_journal_id uuid;
  v_sabotage_refused boolean := false;
begin
  if private.parse_platform_credit_source_ref('topup:11111111-1111-1111-1111-111111111111')
     is distinct from '11111111-1111-1111-1111-111111111111'::uuid then
    raise exception 'FAIL: parse_platform_credit_source_ref did not parse a topup ref';
  end if;
  if private.parse_platform_credit_source_ref('spend-promo:22222222-2222-2222-2222-222222222222')
     is distinct from '22222222-2222-2222-2222-222222222222'::uuid then
    raise exception 'FAIL: parse_platform_credit_source_ref did not parse a spend-promo ref';
  end if;
  if private.parse_platform_credit_source_ref('payment-ref-unrelated') is not null then
    raise exception 'FAIL: parse_platform_credit_source_ref must return null for an unrelated source_ref, not guess or error';
  end if;
  if private.parse_platform_credit_source_ref(null) is not null then
    raise exception 'FAIL: parse_platform_credit_source_ref must return null for a null source_ref';
  end if;

  v_def := pg_get_functiondef('private.resolve_payment_payer(public.payment_transactions)'::regprocedure);
  if v_def not like '%platform_credit_topup_intents%' then
    raise exception 'FAIL: resolve_payment_payer does not know about platform_credit_topup_intents';
  end if;
  if v_def not like '%service_purchases%' or v_def not like '%care_voucher_payments%' then
    raise exception 'FAIL: a pre-existing resolve_payment_payer branch was lost';
  end if;

  v_def := pg_get_functiondef('public.finance_unified_ledger(uuid,uuid,date,date,integer,integer)'::regprocedure);
  if v_def not like '%platform_credit_ledger_entries%' then
    raise exception 'FAIL: finance_unified_ledger does not join platform_credit_ledger_entries';
  end if;

  if has_function_privilege('anon', 'public.finance_unified_ledger(uuid, uuid, date, date, integer, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon must never execute finance_unified_ledger';
  end if;
  if has_function_privilege('anon', 'private.parse_platform_credit_source_ref(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute parse_platform_credit_source_ref';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioural proof: no patient row exists to test against';
    return;
  end if;

  select * into v_pre_existing_balance from public.platform_credit_balances where patient_id = v_patient;
  v_had_pre_existing_balance := found;

  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 123456, p_description := 'migration-proof: finance_unified_ledger payer resolution'
  );

  select id into v_ledger_entry_id from public.platform_credit_ledger_entries
    where patient_id = v_patient and description = 'migration-proof: finance_unified_ledger payer resolution'
    order by created_at desc limit 1;
  if v_ledger_entry_id is null then
    raise exception 'FAIL: the proof top-up did not create a ledger entry';
  end if;

  select id into v_journal_entry_id from public.finance_journal_entries
    where source = 'platform_credit' and source_ref = 'topup:' || v_ledger_entry_id::text;
  if v_journal_entry_id is null then
    raise exception 'FAIL: the proof top-up did not post to the GL -- cannot prove the read-side fix against a real row';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    select * into v_result from public.finance_unified_ledger(
      p_profile_id := v_patient, p_from := current_date, p_to := current_date
    ) where entry_id = v_journal_entry_id limit 1;
    reset role;
  exception when others then
    reset role;
    raise;
  end;
  perform set_config('request.jwt.claims', null, true);

  if v_result.entry_id is null then
    raise exception 'FAIL: the patient''s own platform credit top-up did not appear in their finance_unified_ledger lookup -- the exact gap this migration fixes';
  end if;
  if v_result.payer_profile_id is distinct from v_patient then
    raise exception 'FAIL: payer_profile_id was % instead of the patient %', v_result.payer_profile_id, v_patient;
  end if;
  if v_result.amount_minor <> 123456 then
    raise exception 'FAIL: amount_minor was % instead of 123456', v_result.amount_minor;
  end if;
  if v_result.service_label <> 'Platform credit top-up' then
    raise exception 'FAIL: service_label was % instead of ''Platform credit top-up''', v_result.service_label;
  end if;

  -- Sabotage: a non-finance patient must not be able to query an arbitrary
  -- profile id at all -- not even to get an empty result back. (A patient
  -- passing their OWN id already works, proven above; the function's own
  -- authorisation check is what stands between that and reading someone
  -- else's platform credit history, so prove it actually refuses rather
  -- than trusting that it does.)
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform * from public.finance_unified_ledger(
      p_profile_id := gen_random_uuid(), p_from := current_date, p_to := current_date
    );
    reset role;
  exception when sqlstate '42501' then
    reset role;
    v_sabotage_refused := true;
  end;
  perform set_config('request.jwt.claims', null, true);
  if not v_sabotage_refused then
    raise exception 'FAIL: a patient was able to query an arbitrary profile id instead of being refused -- the discrimination check does not actually discriminate';
  end if;

  -- Dual-bucket spend: exactly the case the initial version of this
  -- migration got wrong (fixed before ever shipping, but worth proving
  -- explicitly rather than trusting the fix by inspection) -- one spend
  -- split across BOTH buckets posts TWO journal entries off the SAME ledger
  -- row (spend-paid/spend-promo), and each must report only its own
  -- bucket's amount, not the combined total.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'admin_grant',
    p_amount_kobo := 50000, p_description := 'migration-proof: finance_unified_ledger dual-bucket spend (grant half)'
  );
  select id into v_grant_ledger_entry_id from public.platform_credit_ledger_entries
    where patient_id = v_patient and description = 'migration-proof: finance_unified_ledger dual-bucket spend (grant half)'
    order by created_at desc limit 1;

  -- Draws 50,000 from the promo balance just granted, then 50,000 more from
  -- the 123,456 paid balance the top-up above left behind -- a genuine
  -- split spend, not a single-bucket one.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'spend',
    p_amount_kobo := 100000, p_description := 'migration-proof: finance_unified_ledger dual-bucket spend'
  );
  select id into v_spend_ledger_entry_id from public.platform_credit_ledger_entries
    where patient_id = v_patient and description = 'migration-proof: finance_unified_ledger dual-bucket spend'
    order by created_at desc limit 1;
  if v_spend_ledger_entry_id is null then
    raise exception 'FAIL: the proof dual-bucket spend did not create a ledger entry';
  end if;

  select id into v_spend_paid_journal_id from public.finance_journal_entries
    where source = 'platform_credit' and source_ref = 'spend-paid:' || v_spend_ledger_entry_id::text;
  select id into v_spend_promo_journal_id from public.finance_journal_entries
    where source = 'platform_credit' and source_ref = 'spend-promo:' || v_spend_ledger_entry_id::text;
  if v_spend_paid_journal_id is null or v_spend_promo_journal_id is null then
    raise exception 'FAIL: the dual-bucket spend did not post both a spend-paid and a spend-promo journal entry';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    select * into v_result from public.finance_unified_ledger(
      p_profile_id := v_patient, p_from := current_date, p_to := current_date
    ) where entry_id = v_spend_paid_journal_id limit 1;
    reset role;
  exception when others then
    reset role;
    raise;
  end;
  perform set_config('request.jwt.claims', null, true);
  if v_result.amount_minor <> 50000 then
    raise exception 'FAIL: the spend-paid journal entry showed % instead of its own 50000 -- likely showing the combined paid+promo total instead of just its bucket', v_result.amount_minor;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    select * into v_result from public.finance_unified_ledger(
      p_profile_id := v_patient, p_from := current_date, p_to := current_date
    ) where entry_id = v_spend_promo_journal_id limit 1;
    reset role;
  exception when others then
    reset role;
    raise;
  end;
  perform set_config('request.jwt.claims', null, true);
  if v_result.amount_minor <> 50000 then
    raise exception 'FAIL: the spend-promo journal entry showed % instead of its own 50000 -- likely showing the combined paid+promo total instead of just its bucket', v_result.amount_minor;
  end if;

  -- Clean up everything this proof created, ledger and GL rows included.
  delete from public.finance_journal_lines where entry_id in (v_journal_entry_id, v_spend_paid_journal_id, v_spend_promo_journal_id);
  delete from public.finance_journal_entries where id in (v_journal_entry_id, v_spend_paid_journal_id, v_spend_promo_journal_id);
  delete from public.platform_credit_ledger_entries where id in (v_ledger_entry_id, v_grant_ledger_entry_id, v_spend_ledger_entry_id);

  if v_had_pre_existing_balance then
    update public.platform_credit_balances
      set paid_balance_kobo = v_pre_existing_balance.paid_balance_kobo,
          promo_balance_kobo = v_pre_existing_balance.promo_balance_kobo,
          lifetime_funded_kobo = v_pre_existing_balance.lifetime_funded_kobo,
          lifetime_granted_kobo = v_pre_existing_balance.lifetime_granted_kobo,
          lifetime_spent_kobo = v_pre_existing_balance.lifetime_spent_kobo
      where patient_id = v_patient;
  else
    delete from public.platform_credit_balances where patient_id = v_patient;
  end if;

  raise notice 'PASS: finance_unified_ledger now attributes a platform_credit journal entry to its real patient payer, with a correct label and amount, and still refuses to leak it to an unrelated profile lookup';
end $$;
