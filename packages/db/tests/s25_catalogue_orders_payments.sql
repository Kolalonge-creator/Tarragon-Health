-- S25 proof: catalogue, prices, orders, payments, entitlements (migration *_s25_catalogue_prices_orders_payments.sql).
-- Proves in one rolled-back transaction: sales are dormant until the module is on and the item is on; an order snapshots the price;
-- a retry of one tap returns the first order; only the service role can record a payment; a wrong amount, currency or fee never marks
-- an order paid and opens an incident; a right payment makes exactly one payment, one entitlement and one order.paid event, and
-- replaying it any number of times changes nothing (safety case 24); a paid membership makes the patient a Member; a late payment on a
-- closed order is honoured and flagged; prices are immutable and versioned; RLS keeps one patient's orders from another; no direct writes.
-- SABOTAGE: the amount check removed, and the replay guard removed; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
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
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- run a statement as the service role; returns the text of the result or 'ERR:' || message
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's25-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S25 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, is_test)
  values (p_org, v, 'S25 ' || p_label, 'MDCN', 'S25-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, 'employed'::public.staff_employment_type, 2, false, true)
  returning id into s;
  foreach c in array array['adult_general', 'hypertension', 'lead_clinician'] loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
-- pay an order as the service role. p_amount/p_fee/p_total default to the order's own price and a 150 kobo fee.
create function pg_temp.pay(p_ref text, p_amount bigint, p_fee bigint, p_total bigint, p_cur text default 'NGN', p_src text default 'webhook') returns text language sql as
$$ select pg_temp.svc(format($q$select public.record_order_payment(%L, %s, %s, %s, %L, 'success', %L, 'evt-1', now(), '{}'::jsonb)::text$q$,
                              p_ref, p_amount, p_fee, p_total, p_cur, p_src)) $$;
create function pg_temp.res(p text) returns text language sql as $$ select (p::jsonb) ->> 'result' $$;
create function pg_temp.order_ref(p_uid uuid, p_code text, p_key uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select (public.create_order(%L, %L))->>'reference'$q$, p_code, p_key)) $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_item uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('pat3', pg_temp.mkuser(v_org, 'pat3', 'patient'));
  -- a consultation item that does not need a lead, priced 5,000 naira, split into a partner part and a Tarragon part
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_consult', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 2, false, false) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason)
  values (v_org, v_item, 500000, '{"partner_fee_kobo":300000,"tarragon_fee_kobo":200000}', 'proof');
end $$;

-- 1. Dormant by default ------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_admin uuid := pg_temp.f('admin');
begin
  perform pg_temp.ck('checkout is closed while the module is off', 'ERR:checkout_not_open',
    pg_temp.q_as(v_pat, $q$select public.create_order('proof_consult', gen_random_uuid())::text$q$));
  perform pg_temp.ck('the catalogue is empty while the module is off', '[]', pg_temp.q_as(v_pat, 'select public.catalogue()::text'));
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pg_temp.f('admin'), activation_note = 'S25 proof run' where key = 'v5_checkout';
  perform pg_temp.ck('an item that is off cannot be bought', 'ERR:item_not_available',
    pg_temp.q_as(v_pat, $q$select public.create_order('proof_consult', gen_random_uuid())::text$q$));
  perform pg_temp.ck('a patient cannot switch an item on', 'true',
    (pg_temp.try_as(v_pat, $q$select public.set_catalog_item_active('proof_consult', true, 'Patient trying to turn it on')$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('staff need a reason to switch an item on', 'catalogue_reason_needed',
    pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('proof_consult', true, 'short')$q$));
  perform pg_temp.ck('staff switch an item on', 'ok',
    pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('proof_consult', true, 'Proof run, item on for testing')$q$));
  perform pg_temp.ck('the catalogue shows the item with its price', '500000',
    pg_temp.q_as(v_pat, $q$select (select (e->>'amount_kobo') from jsonb_array_elements(public.catalogue()) e where e->>'code' = 'proof_consult')$q$));
  perform pg_temp.ck('the seeded membership starts off', 'false', (select active::text from public.catalog_items where code = 'membership_annual' and organisation_id = pg_temp.f('org')));
  perform pg_temp.ck('the seeded membership price is 100,000 naira in kobo', '10000000',
    (select amount_kobo::text from public.prices p join public.catalog_items i on i.id = p.catalog_item_id where i.code = 'membership_annual' and i.organisation_id = pg_temp.f('org') and p.valid_to is null));
  perform pg_temp.ck('anon cannot create an order', '42501', pg_temp.try_anon($q$select public.create_order('proof_consult')$q$));
end $$;

-- 2. Creating an order ---------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_k uuid := gen_random_uuid(); r1 text; r2 text; v_o jsonb;
begin
  r1 := pg_temp.order_ref(v_pat, 'proof_consult', v_k);
  r2 := pg_temp.order_ref(v_pat, 'proof_consult', v_k);
  perform pg_temp.ck('a reference looks right', 'true', (r1 ~ '^tho_[0-9a-f]{32}$')::text);
  perform pg_temp.ck('a retry of the same tap returns the same order', 'true', (r1 = r2)::text);
  perform pg_temp.ck('only one order exists for that tap', '1', (select count(*)::text from public.orders where buyer_profile_id = v_pat and client_key = v_k));
  perform pg_temp.setf('ord1', (select id from public.orders where paystack_reference = r1));
  perform pg_temp.ck('the order snapshots the price', '500000', (select amount_kobo::text from public.orders where id = pg_temp.f('ord1')));
  perform pg_temp.ck('the order snapshots the itemised split', '300000', (select components ->> 'partner_fee_kobo' from public.orders where id = pg_temp.f('ord1')));
  perform pg_temp.ck('the order is flagged test (INV-13)', 'true', (select is_test::text from public.orders where id = pg_temp.f('ord1')));
  perform pg_temp.ck('a patient cannot order for someone else yet', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.create_order('proof_consult', gen_random_uuid(), %L)::text$q$, pg_temp.f('pat2'))) like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('a staff account cannot create an order', 'true',
    (pg_temp.q_as(pg_temp.f('admin'), $q$select public.create_order('proof_consult', gen_random_uuid())::text$q$) like '%order_not_authorised%')::text);
  perform pg_temp.ck('a patient cannot write an order directly', 'true',
    (pg_temp.try_as(v_pat, format($q$update public.orders set amount_kobo = 1 where id = %L$q$, pg_temp.f('ord1'))) like '%permission denied%')::text);
  perform pg_temp.ck('a patient cannot insert an order directly', 'true',
    (pg_temp.try_as(v_pat, format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference) select organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, 1, 'tho_forged000000000000000000000000' from public.orders where id = %L$q$, pg_temp.f('ord1'))) like '%permission denied%')::text);
  -- the 5 open orders per hour limit
  perform pg_temp.q_as(v_pat, 'select public.create_order(''proof_consult'', gen_random_uuid())::text');
  perform pg_temp.q_as(v_pat, 'select public.create_order(''proof_consult'', gen_random_uuid())::text');
  perform pg_temp.q_as(v_pat, 'select public.create_order(''proof_consult'', gen_random_uuid())::text');
  perform pg_temp.q_as(v_pat, 'select public.create_order(''proof_consult'', gen_random_uuid())::text');
  perform pg_temp.ck('a sixth open order in an hour is refused', 'true',
    (pg_temp.q_as(v_pat, 'select public.create_order(''proof_consult'', gen_random_uuid())::text') like '%too_many_open_orders%')::text);
end $$;

-- 3. Recording a payment -------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); ref text := (select paystack_reference from public.orders where id = pg_temp.f('ord1')); a text;
begin
  perform pg_temp.ck('a patient cannot record a payment', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.record_order_payment(%L, 500000, 150, 500150, 'NGN', 'success', 'return')::text$q$, ref)) like '%permission denied%')::text);
  perform pg_temp.ck('anon cannot record a payment', '42501',
    pg_temp.try_anon(format($q$select public.record_order_payment(%L, 500000, 150, 500150, 'NGN', 'success', 'return')$q$, ref)));
  perform pg_temp.ck('an unknown reference is reported, nothing is created', 'not_found',
    pg_temp.res(pg_temp.pay('tho_doesnotexist0000000000000000000', 500000, 150, 500150)));
  perform pg_temp.ck('a payment short of the price is a mismatch', 'mismatch', pg_temp.res(pg_temp.pay(ref, 400000, 150, 400150)));
  perform pg_temp.ck('a payment over the price is a mismatch', 'mismatch', pg_temp.res(pg_temp.pay(ref, 600000, 150, 600150)));
  perform pg_temp.ck('a foreign currency is a mismatch', 'mismatch', pg_temp.res(pg_temp.pay(ref, 500000, 150, 500150, 'USD')));
  perform pg_temp.ck('a total that is not price plus fee is a mismatch', 'mismatch', pg_temp.res(pg_temp.pay(ref, 500000, 150, 500000)));
  perform pg_temp.ck('a mismatch never marks the order paid', 'created', (select state from public.orders where id = pg_temp.f('ord1')));
  perform pg_temp.ck('a mismatch makes no entitlement', '0', (select count(*)::text from public.entitlements where order_id = pg_temp.f('ord1')));
  perform pg_temp.ck('a mismatch opens one incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'order-mismatch:' || pg_temp.f('ord1') and status not in ('resolved', 'closed')));
  perform pg_temp.pay(ref, 400000, 150, 400150);
  perform pg_temp.pay(ref, 400000, 150, 400150);
  perform pg_temp.ck('the same mismatch seen again (a sweep, a retry) adds no new row', '4',
    (select count(*)::text from public.payments where order_id = pg_temp.f('ord1') and status = 'mismatch'));
  perform pg_temp.ck('a mismatch keeps a record of what was seen', '4', (select count(*)::text from public.payments where order_id = pg_temp.f('ord1') and status = 'mismatch'));
  perform pg_temp.ck('a payment for a status that is not success changes nothing', 'not_paid',
    pg_temp.res(pg_temp.svc(format($q$select public.record_order_payment(%L, 500000, 150, 500150, 'NGN', 'failed', 'webhook')::text$q$, ref))));

  a := pg_temp.pay(ref, 500000, 150, 500150);
  perform pg_temp.ck('the right payment marks the order paid', 'paid', pg_temp.res(a));
  perform pg_temp.ck('the order is paid with the fee recorded', '150/500150/paid',
    (select fee_kobo || '/' || total_kobo || '/' || state from public.orders where id = pg_temp.f('ord1')));
  perform pg_temp.ck('one success payment', '1', (select count(*)::text from public.payments where order_id = pg_temp.f('ord1') and status = 'success'));
  perform pg_temp.ck('one entitlement with two uses', '1/2/consultation_credit',
    (select count(*) || '/' || max(remaining_uses) || '/' || max(kind) from public.entitlements where order_id = pg_temp.f('ord1')));
  perform pg_temp.ck('one order.paid event with no clinical content', '1',
    (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = pg_temp.f('ord1') and payload ?& array['order_id'] and not payload ? 'amount_kobo'));
  perform pg_temp.ck('the event is not a care pack for a consultation', 'false',
    (select payload ->> 'care_pack' from public.domain_events where event_type = 'order.paid' and aggregate_id = pg_temp.f('ord1')));

  -- safety case 24: the same payment replayed
  perform pg_temp.ck('replay 1 is a replay', 'replay', pg_temp.res(pg_temp.pay(ref, 500000, 150, 500150)));
  perform pg_temp.ck('replay 2 from another source is a replay', 'replay', pg_temp.res(pg_temp.pay(ref, 500000, 150, 500150, 'NGN', 'sweep')));
  perform pg_temp.ck('replay 3 from the return page is a replay', 'replay', pg_temp.res(pg_temp.pay(ref, 500000, 150, 500150, 'NGN', 'return')));
  perform pg_temp.ck('SAFETY CASE 24: still one entitlement', '1', (select count(*)::text from public.entitlements where order_id = pg_temp.f('ord1')));
  perform pg_temp.ck('SAFETY CASE 24: still one success payment', '1', (select count(*)::text from public.payments where order_id = pg_temp.f('ord1') and status = 'success'));
  perform pg_temp.ck('SAFETY CASE 24: still one order.paid event', '1', (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = pg_temp.f('ord1')));
  perform pg_temp.ck('a paid order cannot be cancelled by the buyer', 'false', pg_temp.q_as(v_pat, format($q$select public.cancel_order(%L)::text$q$, pg_temp.f('ord1'))));
  perform pg_temp.ck('a paid order cannot be closed as unpaid', 'false', pg_temp.svc(format($q$select public.close_unpaid_order(%L, 'expired')::text$q$, ref)));
  perform pg_temp.ck('a paid order cannot go back to created', 'true',
    (pg_temp.try_sql_owner(format($q$update public.orders set state = 'created', paid_at = null where id = %L$q$, pg_temp.f('ord1'))) like '%order_bad_transition%')::text);
  perform pg_temp.ck('a paid order cannot change its amount', 'true',
    (pg_temp.try_sql_owner(format($q$update public.orders set amount_kobo = 1 where id = %L$q$, pg_temp.f('ord1'))) like '%order_immutable%')::text);
  perform pg_temp.ck('an order cannot be deleted', 'true',
    (pg_temp.try_sql_owner(format($q$delete from public.orders where id = %L$q$, pg_temp.f('ord1'))) like '%order_immutable%')::text);
end $$;

-- 4. A late payment on a closed order, and closing an unpaid one ------------------------------------------------------
do $$
declare v_p2 uuid := pg_temp.f('pat2'); ref text; ref2 text; o uuid;
begin
  ref := pg_temp.order_ref(v_p2, 'proof_consult', gen_random_uuid());
  o := (select id from public.orders where paystack_reference = ref);
  perform pg_temp.setf('ord2', o);
  perform pg_temp.ck('the buyer can cancel an unpaid order', 'true', pg_temp.q_as(v_p2, format($q$select public.cancel_order(%L)::text$q$, o)));
  perform pg_temp.ck('the order is cancelled', 'cancelled', (select state from public.orders where id = o));
  perform pg_temp.ck('a verified late payment on a cancelled order is honoured', 'paid', pg_temp.res(pg_temp.pay(ref, 500000, 150, 500150)));
  perform pg_temp.ck('the late payment gets one entitlement', '1', (select count(*)::text from public.entitlements where order_id = o));
  perform pg_temp.ck('the late payment is flagged to a person', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'order-late-payment:' || o));
  ref2 := pg_temp.order_ref(v_p2, 'proof_consult', gen_random_uuid());
  perform pg_temp.ck('the sweeper can close an abandoned order', 'true', pg_temp.svc(format($q$select public.close_unpaid_order(%L, 'abandoned')::text$q$, ref2)));
  perform pg_temp.ck('an abandoned order is failed', 'failed', (select state from public.orders where paystack_reference = ref2));
  perform pg_temp.ck('a user cannot close an order through the sweeper function', 'true',
    (pg_temp.q_as(v_p2, format($q$select public.close_unpaid_order(%L, 'expired')::text$q$, ref2)) like '%permission denied%')::text);
  perform pg_temp.ck('the sweeper lists nothing younger than two minutes', '0',
    pg_temp.svc($q$select count(*)::text from public.orders_needing_reconcile(200) r join public.orders o on o.id = r.order_id where o.created_at > now() - interval '2 minutes'$q$));
end $$;

-- 5. Membership ----------------------------------------------------------------------------------------------------------
do $$
declare v_p3 uuid := pg_temp.f('pat3'); v_admin uuid := pg_temp.f('admin'); ref text; o uuid; v_doc uuid;
begin
  perform pg_temp.ck('staff switch the membership on', 'ok',
    pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('membership_annual', true, 'Proof run, membership on for testing')$q$));
  perform pg_temp.ck('a membership needs a free lead slot', 'true',
    (pg_temp.q_as(v_p3, $q$select public.create_order('membership_annual', gen_random_uuid())::text$q$) like '%no_capacity%')::text);
  v_doc := pg_temp.mkdoc(pg_temp.f('org'), 'lead', v_admin);
  ref := pg_temp.order_ref(v_p3, 'membership_annual', gen_random_uuid());
  perform pg_temp.ck('with a lead slot the membership order is created', 'true', (ref like 'tho_%')::text);
  o := (select id from public.orders where paystack_reference = ref);
  perform pg_temp.ck('not a member before paying', 'false', (select private.patient_is_member(v_p3)::text));
  perform pg_temp.ck('the membership order holds 100,000 naira', '10000000', (select amount_kobo::text from public.orders where id = o));
  perform pg_temp.ck('paying the membership', 'paid', pg_temp.res(pg_temp.pay(ref, 10000000, 15000, 10015000)));
  perform pg_temp.ck('a paid membership makes the patient a Member', 'true', (select private.patient_is_member(v_p3)::text));
  perform pg_temp.ck('my_membership tells the member so', 'true/purchase', pg_temp.q_as(v_p3, $q$select (public.my_membership()->>'is_member') || '/' || (public.my_membership()->>'source')$q$));
  perform pg_temp.ck('my_membership tells a non-member so', 'false', pg_temp.q_as(pg_temp.f('pat'), $q$select (public.my_membership()->>'is_member')$q$));
  perform pg_temp.ck('anon cannot ask my_membership', '42501', pg_temp.try_anon($q$select public.my_membership()$q$));
  perform pg_temp.ck('the membership row says purchase and runs a year', 'purchase/365',
    (select source || '/' || extract(day from (ends_at - starts_at))::int from public.patient_memberships where patient_id = v_p3 and state = 'active'));
  perform pg_temp.ck('the entitlement is a membership', 'membership', (select kind from public.entitlements where order_id = o));
  perform pg_temp.ck('the event asks for a lead clinician', 'true', (select payload ->> 'care_pack' from public.domain_events where event_type = 'order.paid' and aggregate_id = o));
  perform pg_temp.ck('a replay does not add a second membership', '1',
    (pg_temp.res(pg_temp.pay(ref, 10000000, 15000, 10015000)) = 'replay' and (select count(*) from public.patient_memberships where patient_id = v_p3) = 1)::int::text);
  perform pg_temp.ck('a Member cannot buy a second membership', 'true',
    (pg_temp.q_as(v_p3, $q$select public.create_order('membership_annual', gen_random_uuid())::text$q$) like '%already_member%')::text);
end $$;

-- 5b. A second payment for a membership, and a paid order with no lead slot --------------------------------------------------
do $$
declare v_p3 uuid := pg_temp.f('pat3'); v_pat uuid := pg_temp.f('pat'); ref text; o uuid; v_end0 timestamptz; v_end1 timestamptz;
begin
  -- pat3 is already a Member. A second order made before the first was paid (simulated by inserting it directly) is paid later.
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test)
  select o2.organisation_id, v_p3, v_p3, o2.catalog_item_id, o2.price_id, o2.amount_kobo, 'tho_overlap0000000000000000000000', true
    from public.orders o2 where o2.buyer_profile_id = v_p3 and o2.amount_kobo = 10000000 limit 1 returning id into o;
  select ends_at into v_end0 from public.patient_memberships where patient_id = v_p3 and state = 'active';
  perform pg_temp.ck('a second membership payment is honoured, not rolled back', 'paid', pg_temp.res(pg_temp.pay('tho_overlap0000000000000000000000', 10000000, 15000, 10015000)));
  select ends_at into v_end1 from public.patient_memberships where patient_id = v_p3 and state = 'active';
  perform pg_temp.ck('the dated membership is extended by the paid year', '365', extract(day from (v_end1 - v_end0))::int::text);
  perform pg_temp.ck('there is still exactly one active membership row', '1', (select count(*)::text from public.patient_memberships where patient_id = v_p3 and state = 'active'));
  perform pg_temp.ck('the overlap is told to a person', '1', (select count(*)::text from public.ops_incidents where external_reference = 'order-membership-overlap:' || o));
  perform pg_temp.ck('the second payment still has its own entitlement', '1', (select count(*)::text from public.entitlements where order_id = o));
end $$;

-- 5c. The general ledger (OQ-170) -----------------------------------------------------------------------------------------
do $$
declare
  v_mem uuid := (select id from public.orders where buyer_profile_id = pg_temp.f('pat3') and amount_kobo = 10000000 and paystack_reference <> 'tho_overlap0000000000000000000000' limit 1);
  v_cons uuid := pg_temp.f('ord1'); v_late uuid := pg_temp.f('ord2'); v_e uuid; v_month date := date_trunc('month', (now() at time zone 'Africa/Lagos')::date)::date; n integer;
begin
  perform pg_temp.ck('a test order is never posted to the ledger on its own (INV-13)', '0',
    (select count(*)::text from public.finance_journal_entries where source = 'payment' and source_ref in ('order:' || v_mem, 'order:' || v_cons)));
  v_e := private.post_order_to_ledger(v_mem, true);
  perform pg_temp.ck('a Membership posts Dr clearing, Cr deferred revenue, for the price only', '1020/10000000/2000/10000000',
    (select max(case when debit_minor > 0 then account_code || '/' || debit_minor end) || '/' || max(case when credit_minor > 0 then account_code || '/' || credit_minor end)
       from public.finance_journal_lines where entry_id = v_e));
  perform private.post_order_to_ledger(v_mem, true);
  perform private.post_order_to_ledger(v_mem, true);
  perform pg_temp.ck('posting again changes nothing: one entry', '1', (select count(*)::text from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || v_mem));
  perform pg_temp.ck('and one recognition schedule over the 365 day window into service pack revenue', '1/10000000/365/4020',
    (select count(*) || '/' || max(total_minor) || '/' || max(period_end - period_start) || '/' || max(revenue_account_code)
       from public.revenue_recognition_schedules where source_kind = 'order' and source_id = v_mem));
  perform private.post_order_to_ledger(v_cons, true);
  perform pg_temp.ck('an item with no window is recognised at the sale into 4100, price only (the fee is not income)', '500000/4100',
    (select sum(l.credit_minor) || '/' || max(l.account_code) from public.finance_journal_lines l join public.finance_journal_entries e on e.id = l.entry_id
      where e.source = 'payment' and e.source_ref = 'order:' || v_cons and l.credit_minor > 0));
  perform pg_temp.ck('an unpaid order is never posted', 'null', coalesce(private.post_order_to_ledger((select id from public.orders where state = 'created' limit 1), true)::text, 'null'));

  -- a closed accounting period must not undo a payment: it opens an incident, and the retry job posts it once the period is open
  update public.finance_periods set status = 'closed' where period_month = v_month;
  insert into public.finance_periods (period_month, status) values (v_month, 'closed') on conflict (period_month) do update set status = 'closed';
  perform pg_temp.ck('a posting failure returns false and does not raise', 'false', private.post_order_safely(v_late, true)::text);
  perform pg_temp.ck('and opens one financial incident', '1', (select count(*)::text from public.ops_incidents where external_reference = 'order-ledger:' || v_late and status not in ('resolved', 'closed')));
  perform pg_temp.ck('the order is still paid', 'paid', (select state from public.orders where id = v_late));
  update public.finance_periods set status = 'open' where period_month = v_month;
  n := private.post_unposted_orders(true);
  perform pg_temp.ck('the retry job posts what was missed', 'true', (n >= 1)::text);
  perform pg_temp.ck('so the late order now has its entry', '1', (select count(*)::text from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || v_late));
  perform pg_temp.ck('and running the retry again posts nothing more', '0', private.post_unposted_orders(true)::text);
  perform pg_temp.ck('a user cannot post to the ledger', 'true', (pg_temp.q_as(pg_temp.f('pat3'), format('select private.post_order_to_ledger(%L)::text', v_mem)) like '%permission denied%')::text);
  perform pg_temp.ck('the ledger retry is scheduled', '1', (select count(*)::text from cron.job where jobname = 'order-ledger-retry'));
end $$;

-- 5d. Period fallback, refund cancels the schedule, and the automatic post for a real order ---------------------------------
do $$
declare
  v_p2 uuid := pg_temp.f('pat2'); v_mem uuid := (select id from public.orders where buyer_profile_id = pg_temp.f('pat3') and amount_kobo = 10000000 and paystack_reference <> 'tho_overlap0000000000000000000000' limit 1);
  ref text; o uuid; v_month date := date_trunc('month', (now() at time zone 'Africa/Lagos')::date)::date; v_old uuid; v_ok boolean;
begin
  -- the automatic path: a REAL (not test) order is posted by the payment itself, with no direct call
  ref := pg_temp.order_ref(v_p2, 'proof_consult', gen_random_uuid());
  o := (select id from public.orders where paystack_reference = ref);
  update public.orders set is_test = false where id = o;
  perform pg_temp.pay(ref, 500000, 150, 500150);
  perform pg_temp.ck('a real order is posted to the ledger by the payment itself', '1',
    (select count(*)::text from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || o));
  update public.orders set is_test = true where id = o;

  -- a paid date inside a closed month posts today instead of failing for ever
  v_old := pg_temp.f('ord2');
  update public.orders set paid_at = (date_trunc('month', now()) - interval '10 days') where id = v_mem;
  delete from public.revenue_recognition_schedules where source_kind = 'order' and source_id = v_mem;
  delete from public.finance_journal_lines where entry_id in (select id from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || v_mem);
  delete from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || v_mem;
  insert into public.finance_periods (period_month, status) values (date_trunc('month', now() - interval '10 days')::date, 'closed') on conflict (period_month) do update set status = 'closed';
  v_ok := private.post_order_safely(v_mem, true);
  perform pg_temp.ck('an order paid in a closed month posts into the current month', 'true/1/paid',
    v_ok::text || '/' || (select count(*) filter (where entry_date >= v_month)::text from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || v_mem) || '/' || (select state from public.orders where id = v_mem));

  -- a refund cancels the recognition schedule
  perform pg_temp.ck('the schedule is active before a refund', 'active', (select status from public.revenue_recognition_schedules where source_kind = 'order' and source_id = v_mem));
  update public.orders set state = 'refunded' where id = v_mem;
  perform pg_temp.ck('moving the order to refunded cancels its schedule', 'cancelled', (select status from public.revenue_recognition_schedules where source_kind = 'order' and source_id = v_mem));
end $$;

-- 6. Prices are versioned and immutable ----------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat'); v_item uuid := (select id from public.catalog_items where code = 'proof_consult' and organisation_id = pg_temp.f('org'));
begin
  perform pg_temp.ck('a patient cannot set a price', 'true',
    (pg_temp.try_as(v_pat, $q$select public.set_item_price('proof_consult', 100, '{}', 'Patient setting a price', now() + interval '1 second')$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('a price change needs a reason', 'catalogue_reason_needed',
    pg_temp.try_as(v_admin, $q$select public.set_item_price('proof_consult', 600000, '{}', 'short', now() + interval '1 second')$q$));
  perform pg_temp.ck('a split that does not add up is refused', 'price_components_must_sum',
    pg_temp.try_as(v_admin, $q$select public.set_item_price('proof_consult', 600000, '{"partner_fee_kobo":1,"tarragon_fee_kobo":1}', 'A split that does not add up', now() + interval '1 second')$q$));
  perform pg_temp.ck('staff set a new price from a later time', 'ok',
    pg_temp.try_as(v_admin, $q$select public.set_item_price('proof_consult', 600000, '{"partner_fee_kobo":400000,"tarragon_fee_kobo":200000}', 'Proof run price change', now() + interval '1 second')$q$));
  perform pg_temp.ck('the old price is closed and a new one opened', '2/1',
    (select count(*) || '/' || count(*) filter (where valid_to is null) from public.prices where catalog_item_id = v_item));
  perform pg_temp.ck('the shop still shows the current price until the new one starts', '500000',
    pg_temp.q_as(v_pat, $q$select (select (e->>'amount_kobo') from jsonb_array_elements(public.catalogue()) e where e->>'code' = 'proof_consult')$q$));
  perform pg_temp.ck('a paid order keeps its own price', '500000', (select amount_kobo::text from public.orders where id = pg_temp.f('ord1')));
  perform pg_temp.ck('a price amount cannot be edited', 'price_immutable',
    pg_temp.try_sql_owner(format($q$update public.prices set amount_kobo = 1 where catalog_item_id = %L$q$, v_item)));
  perform pg_temp.ck('a price cannot be deleted', 'price_immutable', pg_temp.try_sql_owner(format($q$delete from public.prices where catalog_item_id = %L$q$, v_item)));
  perform pg_temp.ck('two prices cannot overlap', '23P01',
    (select case when pg_temp.try_sql_owner(format($q$insert into public.prices (organisation_id, catalog_item_id, amount_kobo, valid_from) values (%L, %L, 700000, now() + interval '2 seconds')$q$, pg_temp.f('org'), v_item)) like '%exclusion%' then '23P01' else 'allowed' end));
  perform pg_temp.ck('a price cannot start at or before the current one', 'price_start_before_current',
    pg_temp.try_as(v_admin, $q$select public.set_item_price('proof_consult', 650000, '{}', 'Proof run backdated price', now() - interval '1 day')$q$));
  perform pg_temp.ck('price changes are audited', 'true',
    (exists (select 1 from public.audit_log where action = 'catalogue.price_set' and entity_id = v_item))::text);
end $$;

-- 7. Who can see what ----------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_p2 uuid := pg_temp.f('pat2'); v_admin uuid := pg_temp.f('admin'); ref text := (select paystack_reference from public.orders where id = pg_temp.f('ord1'));
begin
  perform pg_temp.ck('a patient sees their own orders', 'true', (pg_temp.q_as(v_pat, 'select count(*)::text from public.orders') :: int >= 5)::text);
  perform pg_temp.ck('a patient does not see another patient''s orders', '0',
    pg_temp.q_as(v_p2, format($q$select count(*)::text from public.orders where buyer_profile_id = %L$q$, v_pat)));
  perform pg_temp.ck('a patient does not see another patient''s payments', '0',
    pg_temp.q_as(v_p2, format($q$select count(*)::text from public.payments where order_id = %L$q$, pg_temp.f('ord1'))));
  perform pg_temp.ck('a patient does not see another patient''s entitlements', '0',
    pg_temp.q_as(v_p2, format($q$select count(*)::text from public.entitlements where patient_id = %L$q$, v_pat)));
  perform pg_temp.ck('the owner sees their payment', '1',
    pg_temp.q_as(v_pat, format($q$select count(*)::text from public.payments where order_id = %L and status = 'success'$q$, pg_temp.f('ord1'))));
  perform pg_temp.ck('another patient cannot open the checkout record', 'NULL', coalesce(pg_temp.q_as(v_p2, format($q$select public.order_for_checkout(%L)::text$q$, ref)), 'NULL'));
  perform pg_temp.ck('the owner can open the checkout record', 'paid', pg_temp.q_as(v_pat, format($q$select public.order_for_checkout(%L)->>'state'$q$, ref)));
  perform pg_temp.ck('my_orders lists only the caller''s orders', 'true',
    (pg_temp.q_as(v_p2, 'select jsonb_array_length(public.my_orders())::text')::int = (select count(*) from public.orders where buyer_profile_id = v_p2))::text);
  perform pg_temp.ck('staff in the same organisation can read orders', 'true', (pg_temp.q_as(v_admin, 'select count(*)::text from public.orders')::int > 0)::text);
  perform pg_temp.ck('anon reads nothing', '42501', pg_temp.try_anon('select count(*) from public.orders'));
  perform pg_temp.ck('a patient cannot read the catalogue table directly (internal notes)', 'true',
    (pg_temp.q_as(v_pat, 'select count(*)::text from public.catalog_items') like '%permission denied%')::text);
  perform pg_temp.ck('a patient cannot read the price table directly (reasons, staff ids)', 'true',
    (pg_temp.q_as(v_pat, 'select count(*)::text from public.prices') like '%permission denied%')::text);
  perform pg_temp.ck('a patient cannot write the catalogue directly', 'true',
    (pg_temp.try_as(v_pat, $q$update public.catalog_items set active = true$q$) like '%permission denied%')::text);
  perform pg_temp.ck('a patient cannot write entitlements directly', 'true',
    (pg_temp.try_as(v_pat, $q$update public.entitlements set remaining_uses = 99$q$) like '%permission denied%')::text);
end $$;

-- 7b. Checkout link and the adapter-side mismatch flag --------------------------------------------------------------------
do $$
declare v_p2 uuid := pg_temp.f('pat2'); ref text; r2 jsonb;
begin
  ref := pg_temp.order_ref(v_p2, 'proof_consult', gen_random_uuid());
  perform pg_temp.ck('a user cannot set a checkout link', 'true',
    (pg_temp.q_as(v_p2, format($q$select public.set_order_checkout_url(%L, 'https://checkout.example/abc')::text$q$, ref)) like '%permission denied%')::text);
  perform pg_temp.ck('the service role sets the checkout link', 'true', pg_temp.svc(format($q$select public.set_order_checkout_url(%L, 'https://checkout.example/abc')::text$q$, ref)));
  perform pg_temp.ck('a link must be https', 'true',
    (pg_temp.svc(format($q$select public.set_order_checkout_url(%L, 'http://insecure.example')::text$q$, ref)) like 'ERR:%')::text);
  perform pg_temp.ck('a retry of the order gets the same link back', 'https://checkout.example/abc',
    pg_temp.q_as(v_p2, format($q$select public.create_order('proof_consult', %L)->>'checkout_url'$q$, (select client_key from public.orders where paystack_reference = ref))));
  perform pg_temp.ck('the adapter-side mismatch is recorded', 'mismatch',
    pg_temp.res(pg_temp.svc(format($q$select public.flag_order_payment_mismatch(%L, 'fee', 500000, 900000, 'webhook')::text$q$, ref))));
  perform pg_temp.ck('and the order stays unpaid', 'created', (select state from public.orders where paystack_reference = ref));
  perform pg_temp.ck('a user cannot flag a mismatch', 'true',
    (pg_temp.q_as(v_p2, format($q$select public.flag_order_payment_mismatch(%L, 'fee', 1, 1, 'webhook')::text$q$, ref)) like '%permission denied%')::text);
  perform pg_temp.ck('flagging a paid order is a replay, not a mismatch', 'replay',
    pg_temp.res(pg_temp.svc(format($q$select public.flag_order_payment_mismatch(%L, 'fee', 1, 1, 'webhook')::text$q$, (select paystack_reference from public.orders where id = pg_temp.f('ord1'))))));
end $$;

-- 7c. Housekeeping --------------------------------------------------------------------------------------------------------
do $$
declare v_p2 uuid := pg_temp.f('pat2'); ref text; o uuid;
begin
  ref := pg_temp.order_ref(v_p2, 'proof_consult', gen_random_uuid());
  o := (select id from public.orders where paystack_reference = ref);
  update public.orders set created_at = now() - interval '4 days' where id = o;
  perform pg_temp.ck('a three day old unpaid order is cancelled by the housekeeping job', 'true', (private.expire_stale_orders() >= 1)::text);
  perform pg_temp.ck('and its state is cancelled', 'cancelled', (select state from public.orders where id = o));
  perform pg_temp.ck('the housekeeping job never touches a paid order', 'paid', (select state from public.orders where id = pg_temp.f('ord1')));
  perform pg_temp.ck('both jobs are scheduled', '2', (select count(*)::text from cron.job where jobname in ('order-expire-stale', 'order-reconcile')));
  perform pg_temp.ck('a user cannot run the housekeeping job', 'true',
    (pg_temp.q_as(v_p2, 'select private.expire_stale_orders()::text') like '%permission denied%')::text);
end $$;

-- 7d. The admin catalogue view ---------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat');
begin
  perform pg_temp.ck('a patient cannot read the admin catalogue', 'true',
    (pg_temp.q_as(v_pat, 'select public.admin_catalogue()::text') like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('staff see every item with its price history', '2',
    pg_temp.q_as(v_admin, $q$select jsonb_array_length((select e->'prices' from jsonb_array_elements(public.admin_catalogue()->'items') e where e->>'code' = 'proof_consult'))::text$q$));
  perform pg_temp.ck('the admin view says whether checkout is open', 'true', pg_temp.q_as(v_admin, $q$select (public.admin_catalogue()->>'checkout_open')$q$));
  perform pg_temp.ck('test orders are not counted as paid orders (INV-13)', '0',
    pg_temp.q_as(v_admin, $q$select (select e->>'paid_orders' from jsonb_array_elements(public.admin_catalogue()->'items') e where e->>'code' = 'proof_consult')$q$));
end $$;

-- 8. SABOTAGE: the amount check and the replay guards removed; both checks must flip ---------------------------------------
create or replace function public.record_order_payment(
  p_reference text, p_amount_kobo bigint, p_fee_kobo bigint, p_total_kobo bigint, p_currency text, p_status text,
  p_source text, p_event_key text default null, p_paid_at timestamptz default null, p_raw jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where paystack_reference = p_reference for update;
  if o.state = 'created' then
    update public.orders set state = 'paid', paid_at = now(), fee_kobo = p_fee_kobo, total_kobo = o.amount_kobo + p_fee_kobo where id = o.id;
  end if;
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, is_test)
  values (o.organisation_id, o.beneficiary_patient_id, o.id, 'consultation_credit', o.is_test);
  return jsonb_build_object('result', 'paid');
end $$;
alter table public.entitlements drop constraint entitlements_order_id_key;
update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pg_temp.f('admin'), activation_note = 'S25 proof run' where key = 'v5_checkout';

do $$
declare v_p2 uuid := pg_temp.f('pat2'); ref text; ref3 text; o uuid; n integer;
begin
  perform set_config('request.jwt.claims', '', true);
  ref := pg_temp.order_ref(v_p2, 'proof_consult', gen_random_uuid());
  o := (select id from public.orders where paystack_reference = ref);
  perform pg_temp.pay(ref, 1, 0, 1);
  insert into results values ('sabotaged', 'a payment short of the price is a mismatch and the order stays created', 'created', (select state from public.orders where id = o));
  ref3 := (select paystack_reference from public.orders where buyer_profile_id = pg_temp.f('pat3') and state = 'paid' and amount_kobo = 10000000 and paystack_reference <> 'tho_overlap0000000000000000000000' limit 1);
  perform pg_temp.pay(ref3, 10000000, 15000, 10015000);
  perform pg_temp.pay(ref3, 10000000, 15000, 10015000);
  select count(*) into n from public.entitlements where order_id = (select id from public.orders where paystack_reference = ref3);
  insert into results values ('sabotaged', 'SAFETY CASE 24: a replay still leaves one entitlement', '1', n::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S25 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
