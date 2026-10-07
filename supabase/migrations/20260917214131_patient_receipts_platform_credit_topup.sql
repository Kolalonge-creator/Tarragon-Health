-- Tarragon Health — a Platform Credit top-up is a real Paystack charge and
-- must show up as a receipt (and be downloadable as an invoice), same as a
-- care voucher purchase already does.
--
-- Gap found while verifying the founder's platform-credit audit: /patient/
-- receipts (public.patient_receipts()) is a plain six-way UNION over every
-- other payable thing on the platform (membership/service_purchases, lab,
-- pharmacy, referral, video consultation, care voucher) and was never
-- revisited when Platform Credit shipped (20260917100300 onward) — a patient
-- who funds their balance by card has no record of that charge anywhere on
-- their own receipts page, even though the money genuinely left their card.
--
-- Fix follows the exact 'care_voucher' precedent immediately below it in the
-- same function: a top-up "receipt belongs to whoever paid" (a sponsor
-- topping up someone else's balance gets their own receipt, the beneficiary
-- doesn't), so this filters on platform_credit_topup_intents.
-- purchaser_profile_id, not patient_id, matching care_voucher_payments.
-- payer_profile_id's own reasoning exactly.
--
-- get_or_create_invoice() needs no code change to support this — it already
-- falls through to the generic 4100 account-code branch for every
-- service_type but 'membership' (the same simplification care_voucher
-- invoices already live with), and reads every other field generically off
-- whatever patient_receipts() returned. The only other place a new
-- service_type has to be named is the invoices table's own CHECK constraint
-- and the API route's zod allow-list, both updated here/alongside this.

-- ---------------------------------------------------------------------------
-- patient_receipts() — add the platform_credit_topup branch. Every other
-- branch is byte-identical to 20260910231326's definition.
-- ---------------------------------------------------------------------------
create or replace function public.patient_receipts()
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_to_json(r) order by r.occurred_at desc)
      from (
        select
          sp.id,
          coalesce(sp.purchased_at, sp.created_at) as occurred_at,
          'membership'::text as service_type,
          coalesce(p.name, 'Service') as service_label,
          coalesce(sp.payment_provider_ref, sp.id::text) as reference,
          sp.amount_kobo as amount_minor,
          sp.currency,
          case
            when sp.status = 'active' then 'successful'
            when sp.status = 'refunded' then 'refunded'
            when sp.status = 'cancelled' then 'failed'
            else 'pending'
          end as status,
          sp.payment_provider::text as provider,
          sp.organisation_id,
          (
            select pt.amount_minor
            from public.payment_transactions pt
            where pt.raw_payload -> 'data' ->> 'reference' = sp.payment_provider_ref
              and pt.event_type = 'charge.success'
            order by pt.created_at desc
            limit 1
          ) as charged_amount_minor,
          (
            select (pt.raw_payload -> 'data' ->> 'fees')::bigint
            from public.payment_transactions pt
            where pt.raw_payload -> 'data' ->> 'reference' = sp.payment_provider_ref
              and pt.event_type = 'charge.success'
            order by pt.created_at desc
            limit 1
          ) as fee_minor
        from public.service_purchases sp
        left join public.service_products p on p.id = sp.service_product_id
        where sp.patient_id = v_caller
          and sp.amount_kobo > 0

        union all

        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'laboratory',
          coalesce(pb.name, 'Lab order'),
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          lo.organisation_id,
          null::bigint,
          null::bigint
        from public.payment_transactions pt
        join public.lab_orders lo on lo.id = pt.booking_order_id
        left join public.panel_bundles pb on pb.id = lo.panel_bundle_id
        where pt.booking_order_type = 'lab' and lo.patient_id = v_caller

        union all

        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'pharmacy',
          'Pharmacy order (' || jsonb_array_length(coalesce(po.items, '[]'::jsonb)) || ' item'
            || case when jsonb_array_length(coalesce(po.items, '[]'::jsonb)) = 1 then '' else 's' end || ')',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          po.organisation_id,
          null::bigint,
          null::bigint
        from public.payment_transactions pt
        join public.pharmacy_orders po on po.id = pt.booking_order_id
        where pt.booking_order_type = 'pharmacy' and po.patient_id = v_caller

        union all

        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'referral',
          initcap(replace(sr.specialist_type::text, '_', ' ')) || ' referral',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          sr.organisation_id,
          null::bigint,
          null::bigint
        from public.payment_transactions pt
        join public.specialist_referrals sr on sr.id = pt.booking_order_id
        where pt.booking_order_type = 'referral' and sr.patient_id = v_caller

        union all

        select
          vvr.id,
          vvr.created_at,
          'consultation',
          'Video consultation',
          coalesce(vvr.payment_provider_ref, vvr.id::text),
          vvr.amount_minor,
          vvr.currency::public.currency,
          case
            when vvr.refund_status = 'refunded' then 'refunded'
            when vvr.status in ('declined', 'expired') and vvr.refund_status = 'due' then 'pending_refund'
            when vvr.status in ('declined', 'expired') then 'failed'
            when vvr.payment_provider_ref is not null then 'successful'
            else 'pending'
          end,
          vvr.payment_provider,
          vvr.organisation_id,
          null::bigint,
          null::bigint
        from public.video_visit_requests vvr
        where vvr.patient_id = v_caller and vvr.amount_minor > 0

        union all

        select
          cvp.id,
          cvp.created_at,
          'care_voucher',
          coalesce(cv.sku_name, 'Care voucher'),
          coalesce(cvp.pending_provider_ref, cvp.id::text),
          cvp.amount_minor,
          cvp.currency::public.currency,
          case cvp.status
            when 'applied' then 'successful'
            when 'failed' then 'failed'
            else 'pending'
          end,
          cvp.provider::text,
          cvp.organisation_id,
          null::bigint,
          null::bigint
        from public.care_voucher_payments cvp
        join public.care_vouchers cv on cv.id = cvp.voucher_id
        where cvp.payer_profile_id = v_caller

        union all

        -- Platform credit top-ups the caller paid for themselves or funded
        -- for someone they've linked to (e.g. a diaspora sponsor) -- "the
        -- receipt belongs to whoever paid", same reasoning as care_voucher
        -- immediately above.
        select
          pcti.id,
          coalesce(pcti.completed_at, pcti.created_at),
          'platform_credit_topup',
          'Platform credit top-up',
          coalesce(pcti.payment_provider_ref, pcti.id::text),
          pcti.amount_kobo,
          pcti.currency,
          case pcti.status
            when 'completed' then 'successful'
            when 'cancelled' then 'failed'
            else 'pending'
          end,
          coalesce(pcti.payment_provider::text, 'paystack'),
          pcti.organisation_id,
          (
            select pt.amount_minor
            from public.payment_transactions pt
            where pt.raw_payload -> 'data' ->> 'reference' = pcti.payment_provider_ref
              and pt.event_type = 'charge.success'
            order by pt.created_at desc
            limit 1
          ),
          (
            select (pt.raw_payload -> 'data' ->> 'fees')::bigint
            from public.payment_transactions pt
            where pt.raw_payload -> 'data' ->> 'reference' = pcti.payment_provider_ref
              and pt.event_type = 'charge.success'
            order by pt.created_at desc
            limit 1
          )
        from public.platform_credit_topup_intents pcti
        where pcti.purchaser_profile_id = v_caller
      ) r
    ),
    '[]'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- invoices.service_type may now also be 'platform_credit_topup'.
-- get_or_create_invoice() needs no change: it already falls through to the
-- generic 4100 account-code branch for every non-'membership' service_type.
-- ---------------------------------------------------------------------------
alter table public.invoices drop constraint if exists invoices_service_type_check;
alter table public.invoices add constraint invoices_service_type_check
  check (service_type in
    ('membership', 'laboratory', 'pharmacy', 'referral', 'consultation', 'care_voucher', 'platform_credit_topup'));

-- ---------------------------------------------------------------------------
-- Assertions -- structural (branch present, constraint widened, anon still
-- locked out) then a real behavioural round trip: fund a real top-up,
-- confirm it appears in that patient's own receipts with the right shape,
-- confirm it can be turned into an invoice, then clean up completely.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_patient uuid;
  v_org uuid;
  v_pre_existing_balance public.platform_credit_balances%rowtype;
  v_had_pre_existing_balance boolean;
  v_intent_id uuid;
  v_ledger_entry_id uuid;
  v_journal_entry_id uuid;
  v_receipts jsonb;
  v_row jsonb;
  v_invoice jsonb;
begin
  v_def := pg_get_functiondef('public.patient_receipts()'::regprocedure);
  if v_def not like '%platform_credit_topup_intents%' then
    raise exception 'FAIL: patient_receipts does not know about platform_credit_topup_intents';
  end if;
  if v_def not like '%care_voucher_payments%' or v_def not like '%service_purchases%' then
    raise exception 'FAIL: a pre-existing patient_receipts branch was lost';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_service_type_check'
      and pg_get_constraintdef(oid) like '%platform_credit_topup%'
  ) then
    raise exception 'FAIL: invoices.service_type check was not widened to allow platform_credit_topup';
  end if;

  if has_function_privilege('anon', 'public.patient_receipts()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute patient_receipts';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioural proof: no patient row exists to test against';
    return;
  end if;

  select * into v_pre_existing_balance from public.platform_credit_balances where patient_id = v_patient;
  v_had_pre_existing_balance := found;

  -- Real completed top-up: a topup_intents row plus a charge.success
  -- payment_transactions row plus the ledger/GL side-effects the AFTER
  -- INSERT trigger fires -- the same shape a real Paystack webhook produces,
  -- so this proof exercises the exact read path a real receipt would.
  insert into public.platform_credit_topup_intents
    (organisation_id, patient_id, purchaser_profile_id, amount_kobo, currency, status,
     payment_provider, payment_provider_ref, completed_at)
  values
    (v_org, v_patient, v_patient, 654321, 'NGN', 'completed',
     'paystack', 'migration-proof-topup-receipt-ref', now())
  returning id into v_intent_id;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values (
    'paystack', 'evt-migration-proof-topup-receipt', 'charge.success', 654321, 'NGN', v_org,
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'migration-proof-topup-receipt-ref',
      'fees', 12345,
      'metadata', jsonb_build_object('kind', 'platform_credit_topup')
    ))
  );

  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 654321, p_topup_intent_id := v_intent_id,
    p_description := 'migration-proof: patient_receipts platform_credit_topup'
  );
  select id into v_ledger_entry_id from public.platform_credit_ledger_entries
    where patient_id = v_patient and description = 'migration-proof: patient_receipts platform_credit_topup'
    order by created_at desc limit 1;
  select id into v_journal_entry_id from public.finance_journal_entries
    where source = 'platform_credit' and source_ref = 'topup:' || v_ledger_entry_id::text;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    select public.patient_receipts() into v_receipts;
    reset role;
  exception when others then
    reset role;
    raise;
  end;
  perform set_config('request.jwt.claims', null, true);

  select r into v_row from jsonb_array_elements(v_receipts) r where r ->> 'id' = v_intent_id::text;
  if v_row is null then
    raise exception 'FAIL: the platform credit top-up did not appear in the patient''s own receipts at all';
  end if;
  if v_row ->> 'service_type' <> 'platform_credit_topup' then
    raise exception 'FAIL: service_type was % instead of platform_credit_topup', v_row ->> 'service_type';
  end if;
  if v_row ->> 'status' <> 'successful' then
    raise exception 'FAIL: status was % instead of successful', v_row ->> 'status';
  end if;
  if (v_row ->> 'amount_minor')::bigint <> 654321 then
    raise exception 'FAIL: amount_minor was % instead of 654321', v_row ->> 'amount_minor';
  end if;
  if (v_row ->> 'fee_minor')::bigint <> 12345 then
    raise exception 'FAIL: fee_minor was % instead of the real 12345 from the charge.success payload', v_row ->> 'fee_minor';
  end if;

  -- And it can actually be invoiced -- proves get_or_create_invoice's
  -- generic account-code fallback really does handle a brand-new
  -- service_type with no code change of its own.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    select public.get_or_create_invoice('platform_credit_topup', v_intent_id) into v_invoice;
    reset role;
  exception when others then
    reset role;
    raise;
  end;
  perform set_config('request.jwt.claims', null, true);

  if v_invoice is null or (v_invoice ->> 'total_minor')::bigint <> 654321 then
    raise exception 'FAIL: get_or_create_invoice did not produce a correct invoice for the top-up, got %', v_invoice;
  end if;

  -- Clean up everything this proof created.
  delete from public.invoices where service_type = 'platform_credit_topup' and source_id = v_intent_id;
  delete from public.finance_journal_lines where entry_id = v_journal_entry_id;
  delete from public.finance_journal_entries where id = v_journal_entry_id;
  delete from public.platform_credit_ledger_entries where id = v_ledger_entry_id;
  delete from public.payment_transactions where provider_event_id = 'evt-migration-proof-topup-receipt';
  delete from public.platform_credit_topup_intents where id = v_intent_id;

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

  raise notice 'PASS: a platform credit top-up now appears in the patient''s own receipts with the correct fee breakdown, and can be turned into a real invoice';
end $$;
