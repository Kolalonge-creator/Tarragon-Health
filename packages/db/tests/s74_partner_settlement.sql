-- S74 proof: partner settlement (migration *_s74_partner_settlement.sql). Spec 21.6, decision S74-2 / D11 / OQ-326, D-06, INV-09, INV-13, INV-14, INV-15.
-- One rolled-back transaction. Sections:
--   1. Shape: RLS, no direct writes, anon refused, the guard ships OFF, the event and the nightly job exist.
--   2. A laboratory can never be owed anything (D-06): refused by the function and by the table's own CHECK.
--   3. Terms: drafted by an admin, immutable, approved by a SECOND person (four eyes), never twice; other roles refused.
--   4. Guard OFF: the run builds nothing, issue and record-paid are refused, the preview still reads and writes nothing; the guard cannot be switched
--      on while no term is approved and can once one is (the gate opens as well as closes).
--   5. The run: sponsor-paid paid orders in the month only; a self-paid, an old, an unpaid and a test order are left out; basis points round DOWN to the
--      kobo; drafts tie to the orders; the event carries ids and an amount; running again changes nothing.
--   6. Issue, the partner's own statement (own only, never a draft, no patient field), dispute, record paid with a bank reference, void; a settled
--      statement and its payables are frozen.
--   7. NEVER PAID TWICE: an order already reached by a clinician earnings line (S31) is not accrued and cannot be made a payable; the double-payment check
--      finds an overlap in either direction; one statement per partner and month; a settled month is not added to; no column joins the two systems.
--   8. SABOTAGE: the laboratory CHECK dropped, the order-and-term uniqueness dropped, the earnings guard removed, the go-live gate removed; all four flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table txt(k text primary key, v text) on commit drop;
grant all on txt to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.sett(p text, p_v text) returns void language sql as $$ insert into txt values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.t(p text) returns text language sql as $$ select v from txt where k = p $$;
create function pg_temp.r(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.msg_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.do_as(p_uid uuid, p_sql text) returns void language plpgsql as $f$ begin perform pg_temp.q_as(p_uid, p_sql); end $f$;
create function pg_temp.anon_q(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's74s-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S74 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
-- an order paid in the given month (a date inside it), straight into the paid state, as the paid-order trigger would leave it
create function pg_temp.mkorder(p_buyer uuid, p_benef uuid, p_item uuid, p_price uuid, p_amount bigint, p_state text, p_paid timestamptz, p_test boolean) returns uuid language plpgsql as
$f$ declare v uuid; v_org uuid := pg_temp.f('org');
begin
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paystack_reference, paid_at, is_test)
  values (v_org, p_buyer, p_benef, p_item, p_price, p_amount, case when p_state = 'paid' then 150 end, case when p_state = 'paid' then p_amount + 150 end, p_state,
          'S74-' || substr(gen_random_uuid()::text, 1, 12), case when p_state = 'paid' then p_paid end, p_test) returning id into v;
  return v;
end $f$;
create function pg_temp.pays(p_settlement uuid) returns bigint language sql as $$ select coalesce(sum(amount_kobo), 0) from public.partner_payables where settlement_id = p_settlement $$;

-- Fixtures ----------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_a1 uuid; v_a2 uuid; v_spons uuid; v_pat uuid; v_phA uuid; v_phB uuid; v_lab uuid; v_item1 uuid; v_item2 uuid; v_pr1 uuid; v_pr2 uuid;
  v_month date; v_in timestamptz; v_old timestamptz;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_a1 := pg_temp.mkuser(v_org, 'admin1', 'admin'); v_a2 := pg_temp.mkuser(v_org, 'admin2', 'admin');
  perform pg_temp.setf('a1', v_a1); perform pg_temp.setf('a2', v_a2);
  v_spons := pg_temp.mkuser(v_org, 'sponsor', 'patient'); v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  perform pg_temp.setf('spons', v_spons); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('doc', pg_temp.mkuser(v_org, 'doc', 'clinician'));
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status) values ('S74 Settle Pharmacy A', true, now(), now(), 'activated') returning id into v_phA;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status) values ('S74 Settle Pharmacy B', true, now(), now(), 'activated') returning id into v_phB;
  insert into public.lab_providers (name, is_active) values ('S74 Settle Lab', false) returning id into v_lab;
  perform pg_temp.setf('phA', v_phA); perform pg_temp.setf('phB', v_phB); perform pg_temp.setf('lab', v_lab);
  perform pg_temp.setf('phAu', pg_temp.mkuser(v_org, 'phAu', 'pharmacist')); perform pg_temp.setf('phBu', pg_temp.mkuser(v_org, 'phBu', 'pharmacist')); perform pg_temp.setf('labu', pg_temp.mkuser(v_org, 'labu', 'lab_partner'));
  update public.profiles set pharmacy_partner_id = v_phA where id = pg_temp.f('phAu');
  update public.profiles set pharmacy_partner_id = v_phB where id = pg_temp.f('phBu');
  update public.profiles set lab_provider_id = v_lab where id = pg_temp.f('labu');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses) values (v_org, 's74_item_one', 'consultation', 'k.one', 'k.one.d', 1) returning id into v_item1;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses) values (v_org, 's74_item_two', 'consultation', 'k.two', 'k.two.d', 1) returning id into v_item2;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, created_by) values (v_org, v_item1, 100100, v_a1) returning id into v_pr1;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, created_by) values (v_org, v_item2, 20000, v_a1) returning id into v_pr2;
  perform pg_temp.setf('item1', v_item1); perform pg_temp.setf('item2', v_item2); perform pg_temp.setf('pr1', v_pr1); perform pg_temp.setf('pr2', v_pr2);
  -- the month being settled is last month (Lagos); an order "in" it is paid mid-month, "old" is two months before this one
  v_month := private.lagos_month(now() - interval '1 month');
  v_in := (v_month::timestamp + interval '10 days') at time zone 'Africa/Lagos';
  v_old := ((v_month - interval '1 month')::timestamp + interval '10 days') at time zone 'Africa/Lagos';
  perform pg_temp.sett('month', v_month::text);
  perform pg_temp.setf('o1', pg_temp.mkorder(v_spons, v_pat, v_item1, v_pr1, 100100, 'paid', v_in, false));          -- sponsor paid, 100,100 kobo
  perform pg_temp.setf('o2', pg_temp.mkorder(v_pat, v_pat, v_item1, v_pr1, 100100, 'paid', v_in, false));            -- paid by the patient herself
  perform pg_temp.setf('o3', pg_temp.mkorder(v_spons, v_pat, v_item1, v_pr1, 100100, 'paid', v_old, false));         -- sponsor paid, the month before
  perform pg_temp.setf('o4', pg_temp.mkorder(v_spons, v_pat, v_item1, v_pr1, 100100, 'created', null, false));       -- never paid
  perform pg_temp.setf('o5', pg_temp.mkorder(v_spons, v_pat, v_item1, v_pr1, 100100, 'paid', v_in, true));           -- a TEST order
  perform pg_temp.setf('o6', pg_temp.mkorder(v_spons, v_pat, v_item1, v_pr1, 100100, 'paid', v_in, false));          -- will be reached by a clinician earnings line
  perform pg_temp.setf('o7', pg_temp.mkorder(v_spons, v_pat, v_item2, v_pr2, 20000, 'paid', v_in, false));           -- second item, fixed share
  -- o6 is reached by a clinician earnings line (the S31 side) from the start
  perform set_config('tarragon.earnings_write', 'on', true);
  insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, calculation, earned_at, employment_type, note, created_by)
  values (v_org, pg_temp.f('doc'), 'adjustment', 'order', pg_temp.f('o6'), 7000, '{"proof": true}'::jsonb, now(), 'contracted', 'Proof: a clinician share on the same order', v_a1);
  perform set_config('tarragon.earnings_write', 'off', true);
end $$;

-- 1. Shape --------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.r('1.1 RLS on for all four tables', '4', (select count(*)::text from pg_class where oid in ('public.partner_settlement_config'::regclass, 'public.partner_settlement_terms'::regclass, 'public.settlements'::regclass, 'public.partner_payables'::regclass) and relrowsecurity));
  perform pg_temp.r('1.2 no signed-in role can write any of them directly', '0', (select count(*)::text from unnest(array['partner_settlement_config', 'partner_settlement_terms', 'settlements', 'partner_payables']) x
    where has_table_privilege('authenticated', 'public.' || x, 'INSERT') or has_table_privilege('authenticated', 'public.' || x, 'UPDATE') or has_table_privilege('authenticated', 'public.' || x, 'DELETE')));
  perform pg_temp.r('1.3 anon reads none of them', '0', (select count(*)::text from unnest(array['partner_settlement_config', 'partner_settlement_terms', 'settlements', 'partner_payables']) x where has_table_privilege('anon', 'public.' || x, 'SELECT')));
  perform pg_temp.r('1.4 anon cannot execute any settlement function', '0', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('create_partner_settlement_terms', 'approve_partner_settlement_terms', 'end_partner_settlement_terms', 'partner_settlement_preview', 'run_partner_settlement', 'issue_settlement', 'record_settlement_paid', 'void_settlement', 'partner_dispute_settlement', 'partner_my_statements', 'partner_my_statement_lines', 'admin_list_settlements', 'partner_double_payment_check')
    and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.r('1.5 the settlement guard exists and ships OFF', 'false', (select is_on::text from public.go_live_guards where key = 'partner_settlement_enabled'));
  perform pg_temp.r('1.6 the event is registered with five required keys', '5', (select cardinality(required_keys)::text from public.event_type_versions where event_type = 'partner.settlement_due' and version = 1));
  perform pg_temp.r('1.7 the monthly job is scheduled', '1', (select count(*)::text from cron.job where jobname = 'partner-settlement-run'));
  perform pg_temp.r('1.8 amounts are integer kobo (INV-15)', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('settlements', 'partner_payables') and column_name = 'amount_kobo' and data_type = 'bigint'));
end $$;

-- 2. A laboratory is owed nothing -----------------------------------------------------------------------------------------------------
select pg_temp.r('2.1 terms for a laboratory are refused by the function', 'ERR:23514', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.create_partner_settlement_terms('lab', %L, 's74_item_one', 'pharmacy_margin', 'fixed_kobo', 1000, true, 'Trying to pay a laboratory, which is not allowed')::text$q$, pg_temp.f('lab'))));
select pg_temp.r('2.2 ...and by the table''s own check, for the owner too', '23514', pg_temp.try_sql(format($$insert into public.partner_settlement_terms (organisation_id, partner_kind, partner_id, catalog_item_id, source_kind, basis, value, reason, created_by)
  values (%L, 'lab', %L, %L, 'pharmacy_margin', 'fixed_kobo', 1000, 'Trying to pay a laboratory, which is not allowed', %L)$$, pg_temp.f('org'), pg_temp.f('lab'), pg_temp.f('item1'), pg_temp.f('a1'))));
select pg_temp.r('2.3 a settlement for a laboratory cannot exist either', '23514', pg_temp.try_sql(format($$insert into public.settlements (organisation_id, partner_kind, partner_id, period_month, amount_kobo, config_version)
  values (%L, 'lab', %L, date_trunc('month', now())::date, 100, 1)$$, pg_temp.f('org'), pg_temp.f('lab'))));

-- 3. Terms ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_t1 uuid; v_t2 uuid;
begin
  perform pg_temp.r('3.1 a patient cannot draft terms', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.create_partner_settlement_terms('pharmacy', %L, 's74_item_one', 'sponsor_paid_item', 'basis_points', 3333, true, 'A patient trying to write terms for themselves')::text$q$, pg_temp.f('phA'))));
  perform pg_temp.r('3.2 a pharmacist cannot draft terms for their own pharmacy', 'ERR:42501', pg_temp.q_as(pg_temp.f('phAu'), format($q$select public.create_partner_settlement_terms('pharmacy', %L, 's74_item_one', 'sponsor_paid_item', 'basis_points', 3333, true, 'A pharmacist writing their own share in terms')::text$q$, pg_temp.f('phA'))));
  perform pg_temp.r('3.3 anon cannot', 'ERR:42501', pg_temp.anon_q(format($q$select public.create_partner_settlement_terms('pharmacy', %L, 's74_item_one', 'sponsor_paid_item', 'basis_points', 3333, true, 'Anonymous attempt to write terms')::text$q$, pg_temp.f('phA'))));
  perform pg_temp.r('3.4 more than 100 percent is refused', 'ERR:23514', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.create_partner_settlement_terms('pharmacy', %L, 's74_item_one', 'sponsor_paid_item', 'basis_points', 10001, true, 'More than the whole order is not a share')::text$q$, pg_temp.f('phA'))));
  perform pg_temp.r('3.5 a reason shorter than 20 characters is refused', 'ERR:23514', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.create_partner_settlement_terms('pharmacy', %L, 's74_item_one', 'sponsor_paid_item', 'basis_points', 3333, true, 'short')::text$q$, pg_temp.f('phA'))));
  v_t1 := pg_temp.q_as(pg_temp.f('a1'), format($q$select public.create_partner_settlement_terms('pharmacy', %L, 's74_item_one', 'sponsor_paid_item', 'basis_points', 3333, true, 'Agreed with the pharmacy in writing on 1 October')::text$q$, pg_temp.f('phA')))::uuid;
  v_t2 := pg_temp.q_as(pg_temp.f('a1'), format($q$select public.create_partner_settlement_terms('pharmacy', %L, 's74_item_two', 'pharmacy_margin', 'fixed_kobo', 5000, true, 'Agreed fixed margin per item with the pharmacy')::text$q$, pg_temp.f('phA')))::uuid;
  perform pg_temp.setf('t1', v_t1); perform pg_temp.setf('t2', v_t2);
  -- Terms only reach orders paid AFTER they were drafted (valid_from = now(), by design). This proof settles a month that is already closed, so the two terms are backdated
  -- here as a fixture (triggers bypassed, which is the only way to move valid_from); nothing in the migration can do this.
  set local session_replication_role = replica;
  update public.partner_settlement_terms set valid_from = date_trunc('month', now()) - interval '6 months' where id in (v_t1, v_t2);
  set local session_replication_role = origin;
  perform pg_temp.r('3.6 terms are drafted unapproved', 'null', (select coalesce(approved_by::text, 'null') from public.partner_settlement_terms where id = v_t1));
  perform pg_temp.r('3.7 terms cannot be edited, even by the owner', '42501', pg_temp.try_sql(format($u$update public.partner_settlement_terms set value = 9000 where id = %L$u$, v_t1)));
  perform pg_temp.r('3.8 terms cannot be deleted', '42501', pg_temp.try_sql(format($u$delete from public.partner_settlement_terms where id = %L$u$, v_t1)));
  perform pg_temp.r('3.9 four eyes: the person who drafted the terms cannot approve them', 'ERR:42501', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.approve_partner_settlement_terms(%L)::text$q$, v_t1)));
  perform pg_temp.r('3.10 a patient and a pharmacist cannot approve', 'ERR:42501|ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.approve_partner_settlement_terms(%L)::text$q$, v_t1)) || '|' || pg_temp.q_as(pg_temp.f('phAu'), format($q$select public.approve_partner_settlement_terms(%L)::text$q$, v_t1)));
  perform pg_temp.r('3.11 the preview is empty while nothing is approved', '0', pg_temp.q_as(pg_temp.f('a2'), format($q$select count(*)::text from public.partner_settlement_preview(%L)$q$, pg_temp.t('month')::date)));
end $$;

-- 4. Guard OFF, and the gate that opens --------------------------------------------------------------------------------------------
do $$
declare v_t1 uuid := pg_temp.f('t1'); v_t2 uuid := pg_temp.f('t2'); j text;
begin
  perform pg_temp.r('4.1 the guard cannot be switched on while no term is approved (gate refuses)', 'true',
    (pg_temp.msg_as(pg_temp.f('a2'), $q$select public.set_go_live_guard('partner_settlement_enabled', true, 'Trying before any terms are approved')::text$q$) like 'ERR:%')::text);
  perform pg_temp.r('4.2 ...and it stayed off', 'false', (select is_on::text from public.go_live_guards where key = 'partner_settlement_enabled'));
  perform pg_temp.do_as(pg_temp.f('a2'), format($q$select public.approve_partner_settlement_terms(%L)::text$q$, v_t1));
  perform pg_temp.do_as(pg_temp.f('a2'), format($q$select public.approve_partner_settlement_terms(%L)::text$q$, v_t2));
  perform pg_temp.r('4.3 a second person approved both', '2', (select count(*)::text from public.partner_settlement_terms where id in (v_t1, v_t2) and approved_by = pg_temp.f('a2')));
  perform pg_temp.r('4.4 terms are approved once only', 'ERR:22023', pg_temp.q_as(pg_temp.f('a2'), format($q$select public.approve_partner_settlement_terms(%L)::text$q$, v_t1)));
  -- guard still OFF here
  j := private.partner_settlement_run(pg_temp.t('month')::date, pg_temp.f('org'))::text;
  perform pg_temp.r('4.5 guard off: the run builds nothing and says why', 'guard_off|0|0', (j::jsonb ->> 'skipped') || '|' || (select count(*)::text from public.partner_payables) || '|' || (select count(*)::text from public.settlements));
  perform pg_temp.r('4.6 guard off: the admin''s run is refused the same way', 'guard_off', (pg_temp.q_as(pg_temp.f('a2'), format($q$select (public.run_partner_settlement(%L)::jsonb ->> 'skipped')$q$, pg_temp.t('month')::date))));
  perform pg_temp.r('4.7 the preview reads what the month would produce (two terms, 38,363 kobo in all) and writes nothing', '2|38363|0',
    pg_temp.q_as(pg_temp.f('a2'), format($q$select count(*)::text || '|' || sum(amount_kobo)::text from public.partner_settlement_preview(%L)$q$, pg_temp.t('month')::date)) || '|' || (select count(*)::text from public.partner_payables));
  perform pg_temp.r('4.8 a patient and a pharmacist get no preview', '0|0', pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.partner_settlement_preview(%L)$q$, pg_temp.t('month')::date)) || '|' || pg_temp.q_as(pg_temp.f('phAu'), format($q$select count(*)::text from public.partner_settlement_preview(%L)$q$, pg_temp.t('month')::date)));
  -- switch it on the way a person does
  perform pg_temp.do_as(pg_temp.f('a2'), $q$select public.set_go_live_guard('partner_settlement_enabled', true, 'Proof run: terms approved by a second person')::text$q$);
  perform pg_temp.r('4.9 the gate opens once a term is approved', 'true', (select is_on::text from public.go_live_guards where key = 'partner_settlement_enabled'));
end $$;

-- 5. The run ------------------------------------------------------------------------------------------------------------------------
do $$
declare v_month date := pg_temp.t('month')::date; j jsonb; v_set uuid; n integer;
begin
  perform pg_temp.r('5.0 before the run, nothing is accrued', '0', (select count(*)::text from public.partner_payables));
  j := private.partner_settlement_run(v_month, pg_temp.f('org'));
  perform pg_temp.r('5.1 two payables: the sponsor-paid order and the fixed-share order', '2', (select count(*)::text from public.partner_payables));
  perform pg_temp.r('5.2 a self-paid order is not accrued', '0', (select count(*)::text from public.partner_payables where order_id = pg_temp.f('o2')));
  perform pg_temp.r('5.3 an order from an earlier month, an unpaid order and a test order are not accrued', '0', (select count(*)::text from public.partner_payables where order_id in (pg_temp.f('o3'), pg_temp.f('o4'), pg_temp.f('o5'))));
  perform pg_temp.r('5.4 an order a clinician earning already reaches is not accrued (never paid twice)', '0', (select count(*)::text from public.partner_payables where order_id = pg_temp.f('o6')));
  perform pg_temp.r('5.5 33.33 percent of 100,100 kobo rounds DOWN to 33,363', '33363', (select amount_kobo::text from public.partner_payables where order_id = pg_temp.f('o1')));
  perform pg_temp.r('5.6 the fixed share is 5,000 kobo', '5000', (select amount_kobo::text from public.partner_payables where order_id = pg_temp.f('o7')));
  select id into v_set from public.settlements where partner_id = pg_temp.f('phA') and period_month = v_month;
  perform pg_temp.setf('set1', v_set);
  perform pg_temp.r('5.7 one draft statement for the pharmacy: 38,363 kobo from 2 items, tied to its payables', 'draft|38363|2|38363',
    (select state || '|' || amount_kobo || '|' || item_count || '|' || pg_temp.pays(id) from public.settlements where id = v_set));
  perform pg_temp.r('5.8 the statement total equals the shares computed from the orders themselves', 'true',
    ((select amount_kobo from public.settlements where id = v_set) = (select (100100 * 3333) / 10000 + 5000))::text);
  perform pg_temp.r('5.9 the settlement-due event was emitted once with ids and an amount and no patient', '1|38363|null',
    (select count(*)::text || '|' || max((payload ->> 'amount_kobo')) || '|' || coalesce(max(patient_id::text), 'null') from public.domain_events where event_type = 'partner.settlement_due' and aggregate_id = v_set));
  perform private.partner_settlement_run(v_month, pg_temp.f('org'));
  perform pg_temp.r('5.10 running again adds no payable, no statement and no second event', '2|1|1',
    (select count(*)::text from public.partner_payables) || '|' || (select count(*)::text from public.settlements where period_month = v_month) || '|' || (select count(*)::text from public.domain_events where event_type = 'partner.settlement_due' and aggregate_id = v_set));
  -- a test order accrues only when the test flag is asked for, and into its own test statement
  perform private.partner_settlement_run(v_month, pg_temp.f('org'), true);
  perform pg_temp.r('5.11 with test data included, the test order accrues into a separate TEST statement', '3|2|1',
    (select count(*)::text from public.partner_payables) || '|' || (select count(*)::text from public.settlements where period_month = v_month) || '|' || (select count(*)::text from public.settlements where period_month = v_month and is_test));
  perform pg_temp.r('5.12 a test statement can never be issued', 'ERR:22023', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.issue_settlement(%L)::text$q$, (select id from public.settlements where is_test and period_month = v_month))));
  perform pg_temp.r('5.13 the real statement is unchanged by the test run', '38363', (select amount_kobo::text from public.settlements where id = v_set));
end $$;

-- 6. Issue, partner view, dispute, paid, void -----------------------------------------------------------------------------------------
do $$
declare v_set uuid := pg_temp.f('set1'); j text;
begin
  perform pg_temp.r('6.1 before issue the partner sees no statement (drafts are never shown)', '0', pg_temp.q_as(pg_temp.f('phAu'), 'select count(*)::text from public.partner_my_statements()'));
  perform pg_temp.r('6.2 a pharmacist cannot issue', 'ERR:42501', pg_temp.q_as(pg_temp.f('phAu'), format($q$select public.issue_settlement(%L)::text$q$, v_set)));
  perform pg_temp.r('6.3 a patient cannot issue', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.issue_settlement(%L)::text$q$, v_set)));
  perform pg_temp.do_as(pg_temp.f('a1'), format($q$select public.issue_settlement(%L)::text$q$, v_set));
  perform pg_temp.r('6.4 an admin issues it', 'issued', (select state from public.settlements where id = v_set));
  perform pg_temp.r('6.5 the pharmacy was told with a neutral notice that names no amount', 'true', (select (count(*) > 0 and bool_and(payload = '{}'::jsonb))::text from public.notifications where template = 'partner_statement_ready' and recipient_id = pg_temp.f('phAu')));
  perform pg_temp.r('6.6 the pharmacy sees its own statement', '1|38363|issued', pg_temp.q_as(pg_temp.f('phAu'), 'select count(*)::text || ''|'' || max(amount_kobo)::text || ''|'' || max(state) from public.partner_my_statements()'));
  perform pg_temp.r('6.7 another pharmacy sees nothing of it', '0', pg_temp.q_as(pg_temp.f('phBu'), 'select count(*)::text from public.partner_my_statements()'));
  perform pg_temp.r('6.8 a laboratory sees no statement', '0', coalesce(pg_temp.q_as(pg_temp.f('labu'), 'select count(*)::text from public.partner_my_statements()'), '0'));
  perform pg_temp.r('6.9 the lines are the pharmacy''s own and carry no patient field', '2|false',
    pg_temp.q_as(pg_temp.f('phAu'), format($q$select count(*)::text from public.partner_my_statement_lines(%L)$q$, v_set)) || '|' ||
    (select (count(*) > 0)::text from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
      where r.routine_schema = 'public' and r.routine_name = 'partner_my_statement_lines' and p.parameter_mode = 'OUT' and p.parameter_name ~* '(patient|buyer|beneficiary|name|phone)'));
  perform pg_temp.r('6.10 another pharmacy cannot read the lines', '0', pg_temp.q_as(pg_temp.f('phBu'), format($q$select count(*)::text from public.partner_my_statement_lines(%L)$q$, v_set)));
  perform pg_temp.r('6.11 another pharmacy cannot dispute it', 'ERR:42501', pg_temp.q_as(pg_temp.f('phBu'), format($q$select public.partner_dispute_settlement(%L, 'A different pharmacy trying to query this')::text$q$, v_set)));
  perform pg_temp.r('6.12 the pharmacy must say what is wrong', 'ERR:22023', pg_temp.q_as(pg_temp.f('phAu'), format($q$select public.partner_dispute_settlement(%L, 'no')::text$q$, v_set)));
  perform pg_temp.do_as(pg_temp.f('phAu'), format($q$select public.partner_dispute_settlement(%L, 'Two lines on the twelfth look the same')::text$q$, v_set));
  perform pg_temp.r('6.13 the pharmacy raises a question and the statement says so', 'disputed', (select state from public.settlements where id = v_set));
  perform pg_temp.r('6.14 a disputed statement cannot be recorded as paid', 'ERR:22023', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.record_settlement_paid(%L, 'GTB-0001-2026')::text$q$, v_set)));
  perform pg_temp.do_as(pg_temp.f('a1'), format($q$select public.issue_settlement(%L)::text$q$, v_set));
  perform pg_temp.r('6.15 the admin answers and issues it again', 'issued', (select state from public.settlements where id = v_set));
  perform pg_temp.r('6.16 recording a payment needs the bank reference', 'ERR:22023', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.record_settlement_paid(%L, 'x')::text$q$, v_set)));
  perform pg_temp.r('6.17 a pharmacist cannot record it paid', 'ERR:42501', pg_temp.q_as(pg_temp.f('phAu'), format($q$select public.record_settlement_paid(%L, 'GTB-0001-2026')::text$q$, v_set)));
  perform pg_temp.do_as(pg_temp.f('a1'), format($q$select public.record_settlement_paid(%L, 'GTB-0001-2026')::text$q$, v_set));
  perform pg_temp.r('6.18 recorded paid, with the reference and by whom', 'settled|GTB-0001-2026|true', (select state || '|' || external_reference || '|' || (settled_by is not null)::text from public.settlements where id = v_set));
  perform pg_temp.r('6.19 a settled statement is frozen: amount, state and payables', '42501|42501|42501',
    pg_temp.try_sql(format($u$update public.settlements set amount_kobo = 1 where id = %L$u$, v_set)) || '|' ||
    pg_temp.try_sql(format($u$update public.partner_payables set amount_kobo = 1 where settlement_id = %L$u$, v_set)) || '|' ||
    pg_temp.try_sql(format($u$delete from public.partner_payables where settlement_id = %L$u$, v_set)));
  perform pg_temp.r('6.20 a settled statement cannot be voided', 'ERR:22023', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.void_settlement(%L, 'Trying to undo a paid statement')::text$q$, v_set)));
  perform pg_temp.r('6.21 the paid statement shows the pharmacy its reference', 'GTB-0001-2026', pg_temp.q_as(pg_temp.f('phAu'), 'select max(external_reference) from public.partner_my_statements()'));
end $$;

-- 7. Never paid twice ---------------------------------------------------------------------------------------------------------------
do $$
declare v_month date := pg_temp.t('month')::date; v_o8 uuid; v_set2 uuid; v_n integer;
begin
  -- a late order for the settled month: it waits, it never changes the settled statement
  v_o8 := pg_temp.mkorder(pg_temp.f('spons'), pg_temp.f('pat'), pg_temp.f('item2'), pg_temp.f('pr2'), 20000, 'paid', ((v_month::timestamp + interval '20 days') at time zone 'Africa/Lagos'), false);
  perform private.partner_settlement_run(v_month, pg_temp.f('org'));
  perform pg_temp.r('7.1 a late payable for a settled month never joins or changes the settled statement', '38363|2',
    (select amount_kobo || '|' || item_count from public.settlements where id = pg_temp.f('set1')));
  perform pg_temp.r('7.2 one live statement per partner and month: no second real statement appears', '1', (select count(*)::text from public.settlements where partner_id = pg_temp.f('phA') and period_month = v_month and not is_test));
  perform pg_temp.r('7.3 the late payable stays unattached', 'null', (select coalesce(settlement_id::text, 'null') from public.partner_payables where order_id = v_o8));
  -- the earnings side: an order already in the clinician ledger cannot be made a payable by any path
  perform pg_temp.r('7.4 a payable for an order a clinician earning reaches is refused by the table', '23514',
    pg_temp.try_sql(format($u$insert into public.partner_payables (organisation_id, term_id, order_id, partner_kind, partner_id, source_kind, basis_amount_kobo, amount_kobo, period_month, is_test)
      values (%L, %L, %L, 'pharmacy', %L, 'sponsor_paid_item', 100100, 33363, %L, false)$u$, pg_temp.f('org'), pg_temp.f('t1'), pg_temp.f('o6'), pg_temp.f('phA'), v_month)));
  perform pg_temp.r('7.5 a payable for an unpaid order is refused', '23514',
    pg_temp.try_sql(format($u$insert into public.partner_payables (organisation_id, term_id, order_id, partner_kind, partner_id, source_kind, basis_amount_kobo, amount_kobo, period_month, is_test)
      values (%L, %L, %L, 'pharmacy', %L, 'sponsor_paid_item', 100100, 33363, %L, false)$u$, pg_temp.f('org'), pg_temp.f('t1'), pg_temp.f('o4'), pg_temp.f('phA'), v_month)));
  perform pg_temp.r('7.6 the same order and term cannot accrue twice', '23505',
    pg_temp.try_sql(format($u$insert into public.partner_payables (organisation_id, term_id, order_id, partner_kind, partner_id, source_kind, basis_amount_kobo, amount_kobo, period_month, is_test)
      values (%L, %L, %L, 'pharmacy', %L, 'sponsor_paid_item', 100100, 33363, %L, false)$u$, pg_temp.f('org'), pg_temp.f('t1'), pg_temp.f('o1'), pg_temp.f('phA'), v_month)));
  perform pg_temp.r('7.7 the double-payment check is empty while the two systems are clean', '0', (select count(*)::text from private.partner_double_payment_findings()));
  -- an earnings line later added for an order that is already a payable is FOUND
  perform set_config('tarragon.earnings_write', 'on', true);
  insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, calculation, earned_at, employment_type, note, created_by)
  values (pg_temp.f('org'), pg_temp.f('doc'), 'adjustment', 'order', pg_temp.f('o7'), 3000, '{"proof": true}'::jsonb, now(), 'contracted', 'Proof: a later clinician share on an accrued order', pg_temp.f('a1'));
  perform set_config('tarragon.earnings_write', 'off', true);
  perform pg_temp.r('7.8 the check finds the overlap the other way round', 'in_payables_and_clinician_earnings', (select finding from private.partner_double_payment_findings() limit 1));
  perform pg_temp.r('7.9 a person (admin) can read the findings, a pharmacist cannot', '1|0', pg_temp.q_as(pg_temp.f('a1'), 'select count(*)::text from public.partner_double_payment_check()') || '|' || pg_temp.q_as(pg_temp.f('phAu'), 'select count(*)::text from public.partner_double_payment_check()'));
  perform private.partner_settlement_run(v_month, pg_temp.f('org'));
  perform pg_temp.r('7.10 the run opens one incident for the overlap and does not issue anything', '1', (select count(*)::text from public.ops_incidents where external_reference = 'partner_double_payment' and status not in ('resolved', 'closed')));
  -- structural: the two systems share no column
  perform pg_temp.r('7.11 no settlement or payable column points at payouts or the earnings ledger', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('settlements', 'partner_payables', 'partner_settlement_terms') and column_name ~* '(payout|earning|clinician)'));
  perform pg_temp.r('7.12 no payout or earnings column points at a settlement or payable', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('payouts', 'payout_transfers', 'earnings_ledger') and column_name ~* '(settlement|payable)'));
  perform pg_temp.r('7.13 settlement code calls no payment provider (no transfer function is referenced)', '0',
    (select count(*)::text from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and (p.proname ~ 'settlement|payable') and p.proname !~ '^finance_' /* finance_* imports Paystack's own bank settlements, a different thing */ and pg_get_functiondef(p.oid) ~* '(paystack|transfer_code|payout_prepare_send|payout_record_send|payout_transfers)'));
end $$;

-- terms end; a voided statement is final
do $$
declare v_month date := pg_temp.t('month')::date; v_ph uuid := pg_temp.f('phB'); v_set uuid;
begin
    perform pg_temp.do_as(pg_temp.f('a1'), format($q$select public.end_partner_settlement_terms(%L)::text$q$, pg_temp.f('t2')));
  perform pg_temp.r('7.14 ended terms are marked ended and cannot be ended twice', 'ERR:22023', pg_temp.q_as(pg_temp.f('a1'), format($q$select public.end_partner_settlement_terms(%L)::text$q$, pg_temp.f('t2'))));
  -- a fresh draft for another month to prove void
  insert into public.settlements (organisation_id, partner_kind, partner_id, period_month, amount_kobo, item_count, config_version, is_test)
  values (pg_temp.f('org'), 'pharmacy', v_ph, (v_month - interval '2 months')::date, 0, 0, 1, true) returning id into v_set;
  perform pg_temp.do_as(pg_temp.f('a1'), format($q$select public.void_settlement(%L, 'Drafted by mistake in this proof')::text$q$, v_set));
  perform pg_temp.r('7.15 a draft can be voided with a reason and is then final', 'void|42501', (select state from public.settlements where id = v_set) || '|' || pg_temp.try_sql(format($u$update public.settlements set state = 'draft' where id = %L$u$, v_set)));
  perform pg_temp.r('7.16 a statement is never deleted', '42501', pg_temp.try_sql(format($u$delete from public.settlements where id = %L$u$, v_set)));
end $$;

-- 8. SABOTAGE -------------------------------------------------------------------------------------------------------------------------
-- (a) the laboratory CHECK dropped: terms for a laboratory can be written
alter table public.partner_settlement_terms drop constraint partner_settlement_terms_partner_kind_check;
select pg_temp.sab('terms for a laboratory are still refused by the table', '23514', pg_temp.try_sql(format($$insert into public.partner_settlement_terms (organisation_id, partner_kind, partner_id, catalog_item_id, source_kind, basis, value, reason, created_by)
  values (%L, 'lab', %L, %L, 'pharmacy_margin', 'fixed_kobo', 1000, 'Trying to pay a laboratory, which is not allowed', %L)$$, pg_temp.f('org'), pg_temp.f('lab'), pg_temp.f('item1'), pg_temp.f('a1'))));
-- (b) the uniqueness dropped: the same order accrues twice
alter table public.partner_payables drop constraint partner_payables_order_id_term_id_key;
select pg_temp.sab('the same order and term still cannot accrue twice', '23505',
  pg_temp.try_sql(format($$insert into public.partner_payables (organisation_id, term_id, order_id, partner_kind, partner_id, source_kind, basis_amount_kobo, amount_kobo, period_month, is_test)
    values (%L, %L, %L, 'pharmacy', %L, 'sponsor_paid_item', 100100, 33363, %L, false)$$, pg_temp.f('org'), pg_temp.f('t1'), pg_temp.f('o1'), pg_temp.f('phA'), pg_temp.t('month')::date)));
-- (c) the earnings guard removed from the payable trigger: an order a clinician earning reaches becomes a payable
create or replace function private.guard_partner_payable() returns trigger language plpgsql as $$ begin return coalesce(new, old); end $$;
select pg_temp.sab('an order a clinician earning reaches is still refused as a payable', '23514',
  pg_temp.try_sql(format($$insert into public.partner_payables (organisation_id, term_id, order_id, partner_kind, partner_id, source_kind, basis_amount_kobo, amount_kobo, period_month, is_test)
    values (%L, %L, %L, 'pharmacy', %L, 'sponsor_paid_item', 100100, 33363, %L, false)$$, pg_temp.f('org'), pg_temp.f('t1'), pg_temp.f('o6'), pg_temp.f('phA'), pg_temp.t('month')::date)));
-- (d) the go-live gate removed: the run accrues with the guard off
create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.sab('the guard still blocks a run when it is off', 'guard_off', (private.partner_settlement_run(date_trunc('month', now() - interval '3 months')::date, pg_temp.f('org')) ->> 'skipped'));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S74 settlement proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
