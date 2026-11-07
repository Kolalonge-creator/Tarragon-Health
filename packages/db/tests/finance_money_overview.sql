-- ===========================================================================
-- Proof: 20261107015736_finance_v2_money_events_and_overview.sql
--
-- WHAT IT PROVES. public.finance_money_overview() (Finance dashboard v2) counts
-- money correctly and keeps the four money measures apart:
--   * gross payment volume = paid orders (fee included) + confirmed Paystack
--     charges (including one whose processing failed on our side) + paid
--     employer invoices;
--   * a failed order is never gross volume; a requested/approved refund is
--     never a refund; wallet-provider rows and test accounts never count;
--   * net collections = gross - completed refunds; success rate = paid /
--     (paid + failed);
--   * the payer is split into member / family sponsor / employer;
--   * recognised revenue comes from the general ledger, not from payments;
--   * a non-finance caller is refused (42501) and cannot read the private view;
--     anon cannot execute the RPC.
-- SABOTAGE. The totals helper is replaced with one that sums every event
-- kind into gross volume (the "all money received is revenue" conflation the
-- brief warns about); the gross-volume check must then fail.
--
-- Fixtures are dated January 2020 (comparison December 2019) so nothing in
-- seed data or other proofs overlaps. Triggers are switched off while the
-- fixtures are written (session_replication_role) because this proves the
-- read path, not the checkout state machines; they are switched back on
-- before anything is asserted. BEGIN/ROLLBACK: nothing persists.
--
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/finance_money_overview.sql
-- ===========================================================================

begin;
create temporary table fmo_checks(msg text) on commit drop;
create temporary table fmo_fix(k text primary key, v uuid) on commit drop;
create temporary table fmo_out(k text primary key, v jsonb) on commit drop;
grant all on fmo_checks, fmo_fix, fmo_out to authenticated;

do $$
declare
  c_org constant uuid := (select id from public.organisations order by created_at limit 1);
  c_item constant uuid := (select id from public.catalog_items where kind = 'membership' order by created_at limit 1);
  c_price constant uuid := (select id from public.prices order by created_at limit 1);
  v_fin uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_s uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_t uuid := gen_random_uuid();
  v_o1 uuid := gen_random_uuid();
  v_o2 uuid := gen_random_uuid();
begin
  if c_org is null or c_item is null or c_price is null then
    raise exception 'fixture prerequisites missing (organisation, membership catalogue item, price)';
  end if;

  set local session_replication_role = replica;

  insert into auth.users (id, email, aud, role)
  select x, x::text || '@fmo.test', 'authenticated', 'authenticated' from unnest(array[v_fin, v_a, v_s, v_b, v_t]) x;
  insert into public.profiles (id, organisation_id, role, full_name, is_active, is_test) values
    (v_fin, c_org, 'finance', 'FMO Finance', true, false),
    (v_a,   c_org, 'patient', 'FMO Member',  true, false),
    (v_s,   c_org, 'patient', 'FMO Sponsor', true, false),
    (v_b,   c_org, 'patient', 'FMO Beneficiary', true, false),
    (v_t,   c_org, 'patient', 'FMO Test', true, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name,
    is_active = excluded.is_active, is_test = excluded.is_test, organisation_id = excluded.organisation_id;

  -- order 1: member pays for themself, with a card fee
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                             amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (v_o1, c_org, v_a, v_a, c_item, c_price, 10000000, 150000, 10150000, 'paid', '2020-01-10 10:00+01', 'FMOREF0001', false);
  -- order 2: sponsor pays for someone else
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                             amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (v_o2, c_org, v_s, v_b, c_item, c_price, 10000000, 0, 10000000, 'paid', '2020-01-12 10:00+01', 'FMOREF0002', false);
  -- order 3: failed
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                             amount_kobo, state, paystack_reference, is_test, updated_at)
  values (c_org, v_a, v_a, c_item, c_price, 10000000, 'failed', 'FMOREF0003', false, '2020-01-15 10:00+01');
  -- order 4: paid by a test account (excluded)
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                             amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (c_org, v_t, v_t, c_item, c_price, 7777700, 0, 7777700, 'paid', '2020-01-11 10:00+01', 'FMOREF0004', false);
  -- order 5: the comparison window
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                             amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (c_org, v_a, v_a, c_item, c_price, 5000000, 0, 5000000, 'paid', '2019-12-20 10:00+01', 'FMOREF0005', false);

  -- a completed refund on order 1, and an approved (not yet confirmed) one on order 2
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, state, provider, completed_at, is_test, decided_by, decided_at)
  values (c_org, v_o1, 3000000, 'fixture refund', 'completed', 'paystack', '2020-01-20 10:00+01', false, v_fin, '2020-01-19 10:00+01');
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, state, provider, is_test, decided_by, decided_at)
  values (c_org, v_o2, 4000000, 'fixture refund pending', 'approved', 'paystack', false, v_fin, '2020-01-21 10:00+01');

  -- an employer invoice paid
  insert into public.employer_invoices (organisation_id, period_start, period_end, billing_model, amount_kobo, status, issued_at, paid_at)
  values (c_org, '2020-01-01', '2020-12-31', 'per_employee', 9000000, 'paid', '2020-01-02 10:00+01', '2020-01-25 10:00+01');

  -- a legacy Paystack charge whose processing failed on our side (money still taken), and a wallet row (excluded)
  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type, amount_minor, currency,
                                           raw_payload, error, created_at, is_test)
  values (c_org, 'paystack', 'fmo-evt-1', 'charge.success', 2500000, 'NGN',
          '{"data":{"reference":"FMOPTX1","metadata":{"kind":"service_purchase"}}}', 'fixture processing failure',
          '2020-01-05 10:00+01', false),
         (c_org, 'wallet', 'fmo-evt-2', 'charge.success', 99900, 'NGN', '{}', null, '2020-01-06 10:00+01', false);

  set local session_replication_role = origin;

  -- recognised revenue: one GL posting in the window
  perform private.finance_post_journal('2020-01-10', 'NGN', 'adjustment', 'fmo-gl-1', 'FMO recognised revenue fixture',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', 400000, 'credit_minor', 0),
      jsonb_build_object('account_code', '4000', 'debit_minor', 0, 'credit_minor', 400000)),
    null, false);

  insert into fmo_fix values ('fin', v_fin), ('patient', v_a);
end $$;

-- ---- call as finance --------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from fmo_fix where k = 'fin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into fmo_out select 'ov', public.finance_money_overview('2020-01-01', '2020-01-31', '2019-12-01', '2019-12-31', 'NGN', 'week');
insert into fmo_out select 'counts', public.finance_open_item_counts();
-- Wednesday 8 Jan to Monday 20 Jan, weekly: the completed refund sits on the final Monday.
insert into fmo_out select 'weekly_edge', public.finance_money_overview('2020-01-08', '2020-01-20', null, null, 'NGN', 'week');
reset role;

-- ---- call as a patient: refused, and the view is unreadable ---------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from fmo_fix where k = 'patient'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.finance_money_overview('2020-01-01', '2020-01-31');
  raise exception 'FAIL: a patient was allowed to read finance_money_overview';
exception when insufficient_privilege then
  insert into fmo_checks values ('PASS: a patient is refused (42501)');
end $$;
do $$
begin
  perform public.finance_open_item_counts();
  raise exception 'FAIL: a patient was allowed to read finance_open_item_counts';
exception when insufficient_privilege then
  insert into fmo_checks values ('PASS: a patient is refused the sidebar counts (42501)');
end $$;
do $$
begin
  perform 1 from private.finance_money_events;
  raise exception 'FAIL: a patient could read private.finance_money_events';
exception when insufficient_privilege then
  insert into fmo_checks values ('PASS: a patient cannot read the money-events view');
end $$;
reset role;

-- ---- assertions (as the owner) ---------------------------------------------
create or replace function pg_temp.fmo_assert(p jsonb) returns void language plpgsql as $$
declare
  c jsonb := p -> 'current';
  pv jsonb := p -> 'previous';
  comp jsonb := p -> 'composition';
begin
  if (c ->> 'gross_payment_volume_minor')::bigint <> 31650000 then
    raise exception 'FAIL gross volume: % (expected 31650000 = 10150000 + 10000000 + 9000000 + 2500000)', c ->> 'gross_payment_volume_minor';
  end if;
  if (c ->> 'successful_payments')::int <> 4 then raise exception 'FAIL successful payments: %', c ->> 'successful_payments'; end if;
  if (c ->> 'refunds_minor')::bigint <> 3000000 or (c ->> 'refund_count')::int <> 1 then
    raise exception 'FAIL refunds: % / % (only the completed refund counts)', c ->> 'refunds_minor', c ->> 'refund_count';
  end if;
  if (c ->> 'net_collections_minor')::bigint <> 28650000 then raise exception 'FAIL net collections: %', c ->> 'net_collections_minor'; end if;
  if (c ->> 'failed_payments')::int <> 1 then raise exception 'FAIL failed payments: %', c ->> 'failed_payments'; end if;
  if (c ->> 'success_rate')::numeric <> 0.8 then raise exception 'FAIL success rate: %', c ->> 'success_rate'; end if;
  if (c ->> 'processing_errors')::int <> 1 then raise exception 'FAIL processing errors: %', c ->> 'processing_errors'; end if;
  if (c ->> 'customer_fees_minor')::bigint <> 150000 then raise exception 'FAIL fees: %', c ->> 'customer_fees_minor'; end if;
  if (c ->> 'recognised_revenue_minor')::bigint <> 400000 then
    raise exception 'FAIL recognised revenue: % (must come from the ledger, not payments)', c ->> 'recognised_revenue_minor';
  end if;
  if (pv ->> 'gross_payment_volume_minor')::bigint <> 5000000 then raise exception 'FAIL previous gross: %', pv ->> 'gross_payment_volume_minor'; end if;
  if (select (e ->> 'amount_minor')::bigint from jsonb_array_elements(comp) e where e ->> 'payer_type' = 'individual') <> 12650000
     or (select (e ->> 'amount_minor')::bigint from jsonb_array_elements(comp) e where e ->> 'payer_type' = 'family_sponsor') <> 10000000
     or (select (e ->> 'amount_minor')::bigint from jsonb_array_elements(comp) e where e ->> 'payer_type' = 'employer') <> 9000000 then
    raise exception 'FAIL composition: %', comp;
  end if;
  if (select sum((e ->> 'gross_minor')::bigint) from jsonb_array_elements(p -> 'series') e) <> 31650000 then
    raise exception 'FAIL series does not add up to the gross total';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'providers') e where e ->> 'provider' = 'wallet') then
    raise exception 'FAIL a wallet row was counted as a provider payment';
  end if;
end $$;

select pg_temp.fmo_assert(v) from fmo_out where k = 'ov';
do $$
declare c jsonb := (select v from fmo_out where k = 'counts');
begin
  if (c ->> 'reconciliation')::bigint <> (select count(*) from public.payment_reconciliation_flags where status = 'open')
     or (c ->> 'approvals')::bigint <> (select count(*) from public.finance_approval_requests where status = 'pending')
     or (c ->> 'fraud')::bigint <> (select count(*) from public.payment_fraud_signals where status = 'open') then
    raise exception 'FAIL: sidebar counts do not match the tables: %', c;
  end if;
  insert into fmo_checks values ('PASS: sidebar counts are exact');
end $$;
do $$
declare w jsonb := (select v from fmo_out where k = 'weekly_edge');
begin
  if (select coalesce(sum((e ->> 'refunds_minor')::bigint), 0) from jsonb_array_elements(w -> 'series') e) <> 3000000
     or (select coalesce(sum((e ->> 'gross_minor')::bigint), 0) from jsonb_array_elements(w -> 'series') e)
        <> ((w -> 'current') ->> 'gross_payment_volume_minor')::bigint then
    raise exception 'FAIL: weekly series lost the events in the final partial week: %', w -> 'series';
  end if;
  insert into fmo_checks values ('PASS: a week range starting mid-week keeps its final week in the series');
end $$;
insert into fmo_checks values ('PASS: totals, refunds, failures, composition, series and recognised revenue are correct');

do $$
begin
  if has_function_privilege('anon', 'public.finance_money_overview(date, date, date, date, text, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute finance_money_overview';
  end if;
  insert into fmo_checks values ('PASS: anon cannot execute the RPC');
end $$;

-- ---- SABOTAGE: conflate every event kind into gross volume ------------------
create or replace function private.finance_money_totals(p_from date, p_to date, p_currency text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('gross_payment_volume_minor', coalesce(sum(amount_minor), 0),
                            'successful_payments', count(*), 'refunds_minor', 0, 'refund_count', 0,
                            'net_collections_minor', coalesce(sum(amount_minor), 0), 'failed_payments', 0,
                            'success_rate', 1, 'processing_errors', 0, 'customer_fees_minor', 0, 'recognised_revenue_minor', 0)
    from private.finance_money_events e
   where e.currency = p_currency and (e.occurred_at at time zone 'Africa/Lagos')::date between p_from and p_to;
$$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from fmo_fix where k = 'fin'), 'role', 'authenticated')::text, true);
set local role authenticated;
update fmo_out set v = public.finance_money_overview('2020-01-01', '2020-01-31', '2019-12-01', '2019-12-31', 'NGN', 'week') where k = 'ov';
reset role;

do $$
begin
  perform pg_temp.fmo_assert(v) from fmo_out where k = 'ov';
  raise exception 'FAIL: the sabotaged totals passed the assertions, so they do not discriminate';
exception when raise_exception then
  if sqlerrm like 'FAIL: the sabotaged%' then raise; end if;
  insert into fmo_checks values ('PASS: sabotage (failed payments and refunds counted as gross volume) is caught: ' || sqlerrm);
end $$;

select msg from fmo_checks;
rollback;
