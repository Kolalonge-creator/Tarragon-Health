-- ===========================================================================
-- Proof: 20261103023236_test_data_hidden_from_staff_and_finance_and_auto_purged.sql
-- PROVES
--   1. A service purchase paid by a TEST patient lands in the ledger as is_test = true (payment_transactions, the posted entry
--      and the revenue-recognition schedule all stamped by trigger, no caller changed); the same purchase by a REAL patient
--      lands as is_test = false (non-vacuity).
--   2. The finance console does not see the test money: finance_ledger_entries lists the real entry and not the test one, and
--      finance_trial_balance moves by the real amount only.
--   3. A reversal of a test entry is itself a test entry.
--   4. SABOTAGE: with the analytics_clean.finance_journal_entries filter removed, the test entry shows up in
--      finance_ledger_entries, so check 2 discriminates. The view is rebuilt afterwards.
--   5. Nightly purge: a disposable test account older than the grace is removed; a test account with a keep reason, a fresh
--      one, a real one and the canary organisation's person all stay. A failed purge does not stop the others.
--   6. Only an admin or a service context may set test_keep_reason; it cannot be set on a real account.
-- Wrapped in BEGIN/ROLLBACK; mints its own people, purchases and payments.
-- ===========================================================================
begin;
create temp table td_results (check_name text, observed text, expected text, verdict text);
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin
  insert into td_results values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;

create function pg_temp.mint(p_email text, p_role text, p_org uuid, p_is_test boolean, p_created timestamptz) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (u, p_email, 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test, created_at)
  values (u, p_org, p_role::public.user_role, 'Test-data proof ' || p_role, p_is_test, p_created)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, created_at = excluded.created_at;
  return u;
end $$;

-- a purchase paid through the real webhook path: intent -> provider reference -> charge.success payment_transactions row
create function pg_temp.pay_for(p_patient uuid, p_org uuid, p_tag text) returns uuid language plpgsql as $$
declare v_product public.service_products%rowtype; v_purchase uuid; v_ref text; v_txn uuid;
begin
  select * into v_product from public.service_products
    where is_active and code <> 'second_opinion_credit' and currency = 'NGN' and price_kobo > 0 and access_duration_days is not null
    order by (code = 'video_visit_credit') desc, code limit 1;   -- second_opinion_credit needs a Membership; video_visit_credit does not
  if v_product.id is null then raise exception 'fixture: no bounded-duration NGN service product'; end if;
  -- every doctor-time extra on sale today is a Member's: give the buyer a Membership first
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test)
  values (p_org, p_patient, 'purchase', 'active', (select is_test from public.profiles where id = p_patient));
  perform set_config('request.jwt.claims', json_build_object('sub', p_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_purchase := public.record_service_purchase_intent(p_patient, v_product.code);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  v_ref := 'td-proof-' || p_tag || '-' || v_purchase::text;
  update public.service_purchases set pending_payment_provider_ref = v_ref where id = v_purchase;
  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload, processed_at)
  values (p_org, 'paystack', 'td-proof-evt-' || p_tag || '-' || v_purchase::text, 'charge.success', v_product.price_kobo, 'NGN',
          jsonb_build_object('data', jsonb_build_object('reference', v_ref, 'metadata', jsonb_build_object('kind', 'service_purchase'))), now())
  returning id into v_txn;
  return v_txn;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_canary_org uuid;
  v_test uuid; v_real uuid; v_fin uuid; v_keep uuid; v_fresh uuid; v_canary uuid; v_stuck uuid; v_staff uuid;
  v_txn_t uuid; v_txn_r uuid; v_entry_t uuid; v_entry_r uuid; v_rev uuid;
  v_amount bigint; v_before bigint; v_after bigint; v_list jsonb; v_res jsonb; v_ok boolean; v_def text;
begin
  -- the canary organisation may not exist on a fresh replay: mint one that looks exactly like it
  select id into v_canary_org from public.organisations where coalesce(metadata->>'canary', 'false') = 'true' limit 1;
  if v_canary_org is null then
    insert into public.organisations (name, type, metadata) values ('Test-data proof canary org', 'direct_consumer', '{"canary": true}'::jsonb) returning id into v_canary_org;
  end if;

  v_test  := pg_temp.mint('td-proof-test-'  || gen_random_uuid() || '@example.invalid', 'patient', v_org, true,  now() - interval '30 days');
  v_real  := pg_temp.mint('td-proof-real-'  || gen_random_uuid() || '@example.invalid', 'patient', v_org, false, now() - interval '30 days');
  v_fin   := pg_temp.mint('td-proof-fin-'   || gen_random_uuid() || '@example.invalid', 'finance', v_org, false, now());
  v_keep  := pg_temp.mint('td-proof-keep-'  || gen_random_uuid() || '@example.invalid', 'patient', v_org, true,  now() - interval '30 days');
  v_fresh := pg_temp.mint('td-proof-fresh-' || gen_random_uuid() || '@example.invalid', 'patient', v_org, true,  now() - interval '1 day');
  v_canary := pg_temp.mint('td-proof-canary-' || gen_random_uuid() || '@example.invalid', 'patient', v_canary_org, true, now() - interval '30 days');
  update public.profiles set test_keep_reason = 'proof: keep me' where id = v_keep;

  -- baseline for check 2c: deferred revenue (account 2000) as the finance console shows it before either purchase
  perform set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  select coalesce((select (x->>'credit_minor')::bigint - (x->>'debit_minor')::bigint
    from jsonb_array_elements(public.finance_trial_balance(private.lagos_today(), 'NGN')) x where x->>'code' = '2000'), 0) into v_before;
  perform set_config('request.jwt.claims', '', true);

  -- 1. the same purchase, paid by a test patient and by a real patient
  v_txn_t := pg_temp.pay_for(v_test, v_org, 'test');
  v_txn_r := pg_temp.pay_for(v_real, v_org, 'real');
  perform pg_temp.chk('1a payment_transactions row for the test patient is stamped is_test', 'true',  (select is_test::text from public.payment_transactions where id = v_txn_t));
  perform pg_temp.chk('1b payment_transactions row for the real patient is not',          'false', (select is_test::text from public.payment_transactions where id = v_txn_r));
  select id into v_entry_t from public.finance_journal_entries where source = 'payment' and source_ref = v_txn_t::text;
  select id into v_entry_r from public.finance_journal_entries where source = 'payment' and source_ref = v_txn_r::text;
  perform pg_temp.chk('1c the webhook posted both entries (fixture sanity)', 'true', (v_entry_t is not null and v_entry_r is not null)::text);
  perform pg_temp.chk('1d the test patient''s ledger entry is is_test', 'true',  (select is_test::text from public.finance_journal_entries where id = v_entry_t));
  perform pg_temp.chk('1e the real patient''s ledger entry is not',      'false', (select is_test::text from public.finance_journal_entries where id = v_entry_r));
  perform pg_temp.chk('1f the test purchase''s revenue-recognition schedule is is_test', 'true',
    (select bool_and(s.is_test)::text from public.revenue_recognition_schedules s where s.payment_transaction_id = v_txn_t));
  perform pg_temp.chk('1g the real purchase''s schedule is not', 'false',
    (select bool_or(s.is_test)::text from public.revenue_recognition_schedules s where s.payment_transaction_id = v_txn_r));
  -- 1h. the webhook's later UPDATE: a bare charge nobody can attribute at insert, whose card-holder e-mail arrives afterwards
  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (v_org, 'paystack', 'td-proof-late-' || v_test::text, 'charge.success', 1000, 'NGN', '{}'::jsonb) returning id into v_rev;
  perform pg_temp.chk('1h a bare charge with no payer is not marked at insert', 'false', (select is_test::text from public.payment_transactions where id = v_rev));
  update public.payment_transactions set raw_payload = jsonb_build_object('data', jsonb_build_object('customer', jsonb_build_object('email', (select email from auth.users where id = v_test)))) where id = v_rev;
  perform pg_temp.chk('1i the enrichment UPDATE marks it once the payer is a test account', 'true', (select is_test::text from public.payment_transactions where id = v_rev));

  -- 2. the finance console sees the real money only
  select amount_minor into v_amount from public.payment_transactions where id = v_txn_r;
  perform set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  v_list := public.finance_ledger_entries(private.lagos_today() - 1, private.lagos_today() + 1, null, 'payment', 500, 0);
  perform pg_temp.chk('2a finance_ledger_entries lists the real entry', 'true',  (v_list @> jsonb_build_array(jsonb_build_object('id', v_entry_r)))::text);
  perform pg_temp.chk('2b finance_ledger_entries does not list the test entry', 'false', (v_list @> jsonb_build_array(jsonb_build_object('id', v_entry_t)))::text);
  -- trial balance: deferred revenue (2000) moved by exactly ONE purchase (the real one), measured against the pre-purchase
  -- baseline taken above, not against a sum computed with the same predicate the view uses. Both purchases are the same
  -- product, so a leaking test entry would double the movement.
  select (x->>'credit_minor')::bigint - (x->>'debit_minor')::bigint into v_after
    from jsonb_array_elements(public.finance_trial_balance(private.lagos_today(), 'NGN')) x where x->>'code' = '2000';
  perform pg_temp.chk('2c finance_trial_balance deferred revenue moved by the real purchase only', v_amount::text, (v_after - v_before)::text);
  perform set_config('request.jwt.claims', '', true);

  -- 3. a reversal of a test entry is a test entry
  v_rev := private.finance_reverse_entry(v_entry_t, 'test-data proof reversal', null);
  perform pg_temp.chk('3 reversal of a test entry is is_test', 'true', (select is_test::text from public.finance_journal_entries where id = v_rev));

  -- 4. SABOTAGE: an unfiltered view lets the test entry through
  execute 'create or replace view analytics_clean.finance_journal_entries with (security_invoker = true) as select t.* from public.finance_journal_entries t';
  perform set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  v_list := public.finance_ledger_entries(private.lagos_today() - 1, private.lagos_today() + 1, null, 'payment', 500, 0);
  perform pg_temp.chk('4 SABOTAGE unfiltered view shows the test entry (check 2b discriminates)', 'true', (v_list @> jsonb_build_array(jsonb_build_object('id', v_entry_t)))::text);
  perform set_config('request.jwt.claims', '', true);
  perform private.rebuild_analytics_clean_views();
  v_def := pg_get_viewdef('analytics_clean.finance_journal_entries'::regclass);
  perform pg_temp.chk('4b view rebuilt with its filter', 'true', (v_def ~ 'is_test')::text);

  -- 5. nightly purge. v_test owns a paid purchase and ledger entries: the purge walks the foreign keys, the ledger keeps its
  --    (is_test) history.
  v_res := private.purge_stale_test_accounts(interval '7 days');
  perform pg_temp.chk('5a stale disposable test account purged',     'false', exists (select 1 from public.profiles where id = v_test)::text);
  perform pg_temp.chk('5a2 its auth user is gone too',               'false', exists (select 1 from auth.users where id = v_test)::text);
  perform pg_temp.chk('5b test account with a keep reason stays',    'true',  exists (select 1 from public.profiles where id = v_keep)::text);
  perform pg_temp.chk('5c fresh test account stays (grace)',         'true',  exists (select 1 from public.profiles where id = v_fresh)::text);
  perform pg_temp.chk('5d real account stays',                       'true',  exists (select 1 from public.profiles where id = v_real)::text);
  perform pg_temp.chk('5e canary organisation person stays',         'true',  exists (select 1 from public.profiles where id = v_canary)::text);
  perform pg_temp.chk('5f ledger history of the purged account stays, marked test', 'true', (select is_test::text from public.finance_journal_entries where id = v_entry_t));
  perform pg_temp.chk('5g purge result names the purged account', 'true', (v_res->'purged' @> to_jsonb(array[v_test]))::text);
  -- 5h/5i: a purge that fails (here: purge_test_account made to raise) is reported and opens an ops incident; the run finishes.
  v_stuck := pg_temp.mint('td-proof-stuck-' || gen_random_uuid() || '@example.invalid', 'patient', v_org, true, now() - interval '30 days');
  v_def := pg_get_functiondef('public.purge_test_account(uuid)'::regprocedure);
  execute $sab$ create or replace function public.purge_test_account(p_profile uuid) returns jsonb language plpgsql security definer set search_path to '' as $f$
    begin raise exception 'proof: a real patient row still references this account' using errcode = '23503'; end $f$; $sab$;
  v_res := private.purge_stale_test_accounts(interval '7 days');
  execute v_def;
  perform pg_temp.chk('5h a purge that fails is reported, not fatal', 'true', ((v_res->'failed') @> jsonb_build_array(jsonb_build_object('profile', v_stuck)))::text);
  perform pg_temp.chk('5h2 the account the purge could not remove is still there', 'true', exists (select 1 from public.profiles where id = v_stuck)::text);
  perform pg_temp.chk('5i a failed night opens one ops incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'test_account_purge:failed' and status not in ('resolved', 'closed')));

  -- 6. keep reason is admin/service only, and only for a test account
  perform set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set test_keep_reason = 'sneaky' where id = v_fresh; v_ok := true;
  exception when sqlstate '42501' then v_ok := false;
  end;
  perform pg_temp.chk('6a a non-admin cannot set test_keep_reason', 'false', v_ok::text);
  perform set_config('request.jwt.claims', '', true);
  begin
    update public.profiles set test_keep_reason = 'real person' where id = v_real; v_ok := true;
  exception when sqlstate '23514' then v_ok := false;
  end;
  perform pg_temp.chk('6b test_keep_reason cannot be set on a real account', 'false', v_ok::text);

  perform pg_temp.chk('7 the nightly job is scheduled', '25 4 * * *', (select schedule from cron.job where jobname = 'purge-stale-test-accounts'));
end $$;

select * from td_results order by check_name;
do $$
declare v_fail integer;
begin
  select count(*) into v_fail from td_results where verdict = 'FAIL';
  if v_fail > 0 then raise exception 'test-data hidden/auto-purged proof: % check(s) FAILED', v_fail; end if;
end $$;
rollback;
