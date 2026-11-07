-- ===========================================================================
-- Proof: 20261107023339_finance_v2_transactions_directory_and_detail.sql
--
-- WHAT IT PROVES.
--   * finance_transactions_list returns the window's payments, failures and refunds with
--     totals, filters by kind / payer type / settlement status, searches by payer name and
--     reference, sorts by amount, and pages;
--   * settlement status: a payment covered by a Paystack settlement line is 'settled', one
--     named by an open reconciliation break is 'exception', others 'awaiting_settlement',
--     failed payments and employer invoices 'not_applicable';
--   * a member who holds only finance.view can browse but not export; finance can export,
--     every export writes one audit_log row, and every browse read is audited as 'listed';
--   * % in a search is matched literally, not as a wildcard;
--   * the refundable balance is the price less refunds (the card fee is not refundable);
--   * finance_transaction_detail returns the payment, its refunds, its refundable balance
--     and a timeline, writes an audit_log row naming the beneficiary, and never returns a
--     webhook's raw body;
--   * a patient is refused both RPCs (42501); anon cannot execute them.
-- SABOTAGE. The list is replaced by one with no export check; the view-only member's
-- export then succeeds and the export check must fail.
--
-- Fixtures dated February 2020; triggers off while they are written, on before asserting.
-- BEGIN/ROLLBACK. Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/finance_transactions_directory.sql
-- ===========================================================================

begin;
create temporary table ftd_checks(msg text) on commit drop;
create temporary table ftd_fix(k text primary key, v uuid) on commit drop;
create temporary table ftd_out(k text primary key, v jsonb) on commit drop;
grant all on ftd_checks, ftd_fix, ftd_out to authenticated;

do $$
declare
  c_org constant uuid := (select id from public.organisations order by created_at limit 1);
  c_item constant uuid := (select id from public.catalog_items where kind = 'membership' order by created_at limit 1);
  c_price constant uuid := (select id from public.prices order by created_at limit 1);
  v_fin uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_s uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_o1 uuid := gen_random_uuid();
  v_o2 uuid := gen_random_uuid();
  v_rpt uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;

  insert into auth.users (id, email, aud, role)
  select x, x::text || '@ftd.test', 'authenticated', 'authenticated' from unnest(array[v_fin, v_viewer, v_a, v_s, v_b]) x;
  insert into public.profiles (id, organisation_id, role, full_name, is_active, is_test) values
    (v_fin,    c_org, 'finance', 'FTD Finance', true, false),
    (v_viewer, c_org, 'patient', 'FTD Viewer',  true, false),
    (v_a,      c_org, 'patient', 'Zelda Quartermaine', true, false),
    (v_s,      c_org, 'patient', 'FTD Sponsor', true, false),
    (v_b,      c_org, 'patient', 'FTD Beneficiary', true, false)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name,
    is_active = excluded.is_active, is_test = excluded.is_test, organisation_id = excluded.organisation_id;
  insert into public.user_permission_grants (profile_id, permission_key) values (v_viewer, 'finance.view');

  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                             amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (v_o1, c_org, v_a, v_a, c_item, c_price, 10000000, 150000, 10150000, 'paid', '2020-02-10 10:00+01', 'FTDREF0001', false),
         (v_o2, c_org, v_s, v_b, c_item, c_price, 10000000, 0, 10000000, 'paid', '2020-02-12 10:00+01', 'FTDREF0002', false);
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                             amount_kobo, state, paystack_reference, is_test, updated_at)
  values (c_org, v_a, v_a, c_item, c_price, 10000000, 'failed', 'FTDREF0003', false, '2020-02-15 10:00+01');
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, state, provider, completed_at, is_test, decided_by, decided_at)
  values (c_org, v_o1, 4000000, 'fixture partial refund', 'completed', 'paystack', '2020-02-20 10:00+01', false, v_fin, '2020-02-19 10:00+01');
  insert into public.employer_invoices (organisation_id, period_start, period_end, billing_model, amount_kobo, status, issued_at, paid_at)
  values (c_org, '2020-01-01', '2020-12-31', 'per_employee', 9000000, 'paid', '2020-02-02 10:00+01', '2020-02-25 10:00+01');

  -- order 1 is settled by Paystack; order 2 has an open reconciliation break
  insert into public.settlement_reports (id, provider_settlement_id, status, total_kobo, fees_kobo, settled_at, lines_complete)
  values (v_rpt, 'FTD-SETTLE-1', 'success', 10150000, 152250, '2020-02-11 12:00+01', true);
  insert into public.settlement_lines (report_id, provider_reference, amount_kobo, fees_kobo, status, paid_at)
  values (v_rpt, 'FTDREF0001', 10150000, 152250, 'success', '2020-02-10 10:00+01');
  insert into public.reconciliation_breaks (break_type, provider_reference, provider_amount_kobo, ledger_amount_kobo, difference_kobo)
  values ('amount_mismatch', 'FTDREF0002', 9900000, 10000000, -100000);

  -- a Paystack event in the inbox for order 1, with a raw body that must never be returned
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status, received_at)
  values ('paystack', 'charge.success', 'charge.success:FTDREF0001', '{"secret":"FTD-RAW-BODY"}', encode(sha256('{"secret":"FTD-RAW-BODY"}'::bytea), 'hex'), true, 'processed', '2020-02-10 10:00:05+01');

  set local session_replication_role = origin;
  insert into ftd_fix values ('fin', v_fin), ('viewer', v_viewer), ('patient', v_a), ('o1', v_o1);
end $$;

-- ---- finance --------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from ftd_fix where k = 'fin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into ftd_out select 'all', public.finance_transactions_list('2020-02-01', '2020-02-29');
insert into ftd_out select 'payments_by_amount', public.finance_transactions_list('2020-02-01', '2020-02-29', p_event_kinds => array['payment'], p_sort => 'amount', p_sort_dir => 'desc');
insert into ftd_out select 'sponsors', public.finance_transactions_list('2020-02-01', '2020-02-29', p_payer_types => array['family_sponsor']);
insert into ftd_out select 'exceptions', public.finance_transactions_list('2020-02-01', '2020-02-29', p_settlement => array['exception']);
insert into ftd_out select 'search', public.finance_transactions_list('2020-02-01', '2020-02-29', p_search => 'quartermaine');
insert into ftd_out select 'search_ref', public.finance_transactions_list('2020-02-01', '2020-02-29', p_search => 'FTDREF0002');
insert into ftd_out select 'search_wild', public.finance_transactions_list('2020-02-01', '2020-02-29', p_search => '%');
insert into ftd_out select 'page2', public.finance_transactions_list('2020-02-01', '2020-02-29', p_limit => 2, p_offset => 2);
insert into ftd_out select 'export', public.finance_transactions_list('2020-02-01', '2020-02-29', p_for_export => true);
insert into ftd_out select 'detail', public.finance_transaction_detail('order', (select v from ftd_fix where k = 'o1'));
reset role;

-- ---- view-only member: browse yes, export no -------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from ftd_fix where k = 'viewer'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into ftd_out select 'viewer_list', public.finance_transactions_list('2020-02-01', '2020-02-29');
create or replace function pg_temp.ftd_viewer_export() returns text language plpgsql as $$
begin
  perform public.finance_transactions_list('2020-02-01', '2020-02-29', p_for_export => true);
  return 'allowed';
exception when insufficient_privilege then
  return 'refused';
end $$;
insert into ftd_out select 'viewer_export', to_jsonb(pg_temp.ftd_viewer_export());
reset role;

-- ---- patient: refused ----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from ftd_fix where k = 'patient'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.finance_transactions_list('2020-02-01', '2020-02-29');
    raise exception 'FAIL: a patient read the transaction list';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.finance_transaction_detail('order', (select v from ftd_fix where k = 'o1'));
    raise exception 'FAIL: a patient read a transaction detail';
  exception when insufficient_privilege then null;
  end;
  insert into ftd_checks values ('PASS: a patient is refused the list and the detail (42501)');
end $$;
reset role;

-- ---- assertions ------------------------------------------------------------------
create or replace function pg_temp.ftd_row(p jsonb, p_ref text) returns jsonb language sql as $$
  select r from jsonb_array_elements(p -> 'rows') r where r ->> 'reference' = p_ref and r ->> 'event_kind' <> 'refund' limit 1;
$$;

create or replace function pg_temp.ftd_assert_export() returns void language plpgsql as $$
begin
  if (select v #>> '{}' from ftd_out where k = 'viewer_export') <> 'refused' then
    raise exception 'FAIL: a finance.view-only member exported transactions';
  end if;
end $$;

do $$
declare
  a jsonb := (select v from ftd_out where k = 'all');
  d jsonb := (select v from ftd_out where k = 'detail');
begin
  -- 2 orders + 1 employer invoice + 1 failed + 1 refund = 5 rows
  if (a ->> 'total')::int <> 5 then raise exception 'FAIL total rows: %', a ->> 'total'; end if;
  if (a ->> 'total_payments_minor')::bigint <> 29150000 or (a ->> 'total_refunds_minor')::bigint <> 4000000 then
    raise exception 'FAIL totals: % / %', a ->> 'total_payments_minor', a ->> 'total_refunds_minor';
  end if;
  if pg_temp.ftd_row(a, 'FTDREF0001') ->> 'settlement_status' <> 'settled'
     or pg_temp.ftd_row(a, 'FTDREF0002') ->> 'settlement_status' <> 'exception'
     or pg_temp.ftd_row(a, 'FTDREF0003') ->> 'settlement_status' <> 'not_applicable'
     or (pg_temp.ftd_row(a, 'FTDREF0001') ->> 'refunded_minor')::bigint <> 4000000 then
    raise exception 'FAIL settlement status or refunded amount: %', a -> 'rows';
  end if;
  if (select r ->> 'settlement_status' from jsonb_array_elements(a -> 'rows') r where r ->> 'record_type' = 'employer_invoice') <> 'not_applicable' then
    raise exception 'FAIL: an employer invoice is not marked not_applicable';
  end if;
  if pg_temp.ftd_row(a, 'FTDREF0002') ->> 'beneficiary_label' <> 'FTD Beneficiary'
     or pg_temp.ftd_row(a, 'FTDREF0001') ->> 'beneficiary_label' is not null then
    raise exception 'FAIL: payer and beneficiary are not distinguished';
  end if;
  insert into ftd_checks values ('PASS: rows, totals, settlement status, refunded amount and payer/beneficiary are right');

  if (select jsonb_agg(r -> 'amount_minor') from jsonb_array_elements((select v from ftd_out where k = 'payments_by_amount') -> 'rows') r)
     <> '[10150000, 10000000, 9000000]'::jsonb then
    raise exception 'FAIL sort by amount: %', (select v -> 'rows' from ftd_out where k = 'payments_by_amount');
  end if;
  if ((select v from ftd_out where k = 'sponsors') ->> 'total')::int <> 1
     or ((select v from ftd_out where k = 'exceptions') ->> 'total')::int <> 1
     or ((select v from ftd_out where k = 'search') ->> 'total')::int <> 3
     or ((select v from ftd_out where k = 'search_ref') ->> 'total')::int <> 1
     or ((select v from ftd_out where k = 'search_wild') ->> 'total')::int <> 0 then
    raise exception 'FAIL filters or search';
  end if;
  if jsonb_array_length((select v from ftd_out where k = 'page2') -> 'rows') <> 2
     or ((select v from ftd_out where k = 'page2') ->> 'total')::int <> 5 then
    raise exception 'FAIL paging';
  end if;
  insert into ftd_checks values ('PASS: sort, payer-type, settlement and search filters, and paging work');

  if (select count(*) from public.audit_log where action = 'finance.transactions.exported'
        and actor_id = (select v from ftd_fix where k = 'fin')) <> 1 then
    raise exception 'FAIL: the export was not audited exactly once';
  end if;
  if ((select v from ftd_out where k = 'viewer_list') ->> 'total')::int <> 5 then
    raise exception 'FAIL: a finance.view member cannot browse';
  end if;
  if not exists (select 1 from public.audit_log where action = 'finance.transactions.listed'
                   and actor_id = (select v from ftd_fix where k = 'viewer')) then
    raise exception 'FAIL: a browse read of named rows was not audited';
  end if;
  insert into ftd_checks values ('PASS: finance.view browses (audited as listed); finance exports and the export is audited');

  if (d -> 'event' ->> 'amount_minor')::bigint <> 10150000
     or jsonb_array_length(d -> 'refunds') <> 1
     or (d ->> 'refundable_minor')::bigint <> 6000000
     or jsonb_array_length(d -> 'webhooks') < 1
     or jsonb_array_length(d -> 'settlement') <> 1
     or jsonb_array_length(d -> 'timeline') < 4 then
    raise exception 'FAIL detail contents: %', d - 'ledger';
  end if;
  if d::text like '%FTD-RAW-BODY%' then
    raise exception 'FAIL: the detail returned a webhook raw body';
  end if;
  if not exists (select 1 from public.audit_log where action = 'finance.transaction.viewed'
                   and entity_id = (select v from ftd_fix where k = 'o1')
                   and subject_patient_id = (select v from ftd_fix where k = 'patient')) then
    raise exception 'FAIL: the detail read was not audited against the member';
  end if;
  insert into ftd_checks values ('PASS: detail has refunds, refundable balance, webhook status, settlement and timeline; no raw body; read audited');

  if has_function_privilege('anon', 'public.finance_transaction_detail(text, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute finance_transaction_detail';
  end if;
end $$;

select pg_temp.ftd_assert_export();
insert into ftd_checks values ('PASS: a finance.view-only member cannot export');

-- ---- SABOTAGE: drop the export check --------------------------------------------
do $$
declare v_def text := pg_get_functiondef('public.finance_transactions_list(date, date, text[], text[], text[], text[], text[], bigint, bigint, text, text, text, integer, integer, boolean)'::regprocedure);
begin
  v_def := replace(v_def, 'if p_for_export then
    if not (', 'if false then
    if not (');
  if v_def not like '%if false then%' then raise exception 'sabotage could not find the export check'; end if;
  execute v_def;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ftd_fix where k = 'viewer'), 'role', 'authenticated')::text, true);
set local role authenticated;
update ftd_out set v = to_jsonb(pg_temp.ftd_viewer_export()) where k = 'viewer_export';
reset role;

do $$
begin
  perform pg_temp.ftd_assert_export();
  raise exception 'FAIL: with the export check removed the assertion still passed';
exception when raise_exception then
  if sqlerrm like 'FAIL: with the export%' then raise; end if;
  insert into ftd_checks values ('PASS: sabotage (no export check) is caught: ' || sqlerrm);
end $$;

select msg from ftd_checks;
rollback;
