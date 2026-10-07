-- S73 proof: the pricing engine (migration *_s73_pricing_engine.sql). Module 20, functions 20.1 to 20.7.
-- Proves in one rolled-back transaction:
--   * price_quote and create_order agree: for 12 seeded scenarios the amount quoted equals the amount on the order and the amount a payment must match;
--     a client that sends the total it was shown is refused if the database now computes another (quote_changed)
--   * the rule order, never below zero, never below the clinician/partner cost, never under the minimum payable, rounding down, one code per order
--   * discount codes: total cap, per-person cap, expiry, pause, item restriction, cohort restriction, released when an order is cancelled,
--     redeemed when it is paid (even late), a failed try is kept and guessing is rate limited, an unusable code never says why
--   * price books: effective-dated, immutable, one rate per item per moment, a rate cannot be above list or below cost, admin only
--   * points: OFF by default; when on, fee-only, whole steps, reserved across open orders, spent once on payment, never converted to a balance
--   * price.changed is registered and emitted by set_item_price and price book entries
--   * order immutability (INV-16), the arithmetic check, integer kobo (INV-15), test flags (INV-13)
--   * RLS per role: patient, clinician, admin, anon and service role are each refused what they must be; admin works through audited functions
--   * the Membership toggle (S73-1, OQ-324): admin only, needs the go-live guard, audited; no subscription table, no renewal column anywhere
--   * the institutional kinds (20.7) exist, are off, are never patient-visible and cannot be sold through checkout
-- SABOTAGE: the order trigger dropped, the guess limit removed, and the arithmetic check removed; each check must flip.
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
create function pg_temp.owner_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's73-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S73 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- quote as a patient: the amount due, or the error
create function pg_temp.qa(p_uid uuid, p_code text, p_disc text default null, p_pts boolean default false, p_ben uuid default null) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select (public.price_quote(%L, %L, %L, %L))->>'amount_due_kobo'$q$, p_code, p_ben, p_disc, p_pts)) $$;
-- the whole quote as jsonb text
create function pg_temp.qj(p_uid uuid, p_code text, p_disc text default null, p_pts boolean default false) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_uid, format($q$select (public.price_quote(%L, null, %L, %L))::text$q$, p_code, p_disc, p_pts));
  if r like 'ERR:%' then return jsonb_build_object('error', r); end if;
  return r::jsonb;
end $f$;
-- create an order as a patient and return the result json (or the error)
create function pg_temp.mk(p_uid uuid, p_code text, p_disc text default null, p_pts boolean default false, p_expected bigint default null) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.create_order(%L, gen_random_uuid(), null, %L, %L, %L)::text$q$, p_code, p_disc, p_pts, p_expected)) $$;
create function pg_temp.pay(p_ref text, p_amount bigint) returns text language sql as
$$ select pg_temp.svc(format($q$select (public.record_order_payment(%L, %s, 150, %s, 'NGN', 'success', 'webhook', 'evt-1', now(), '{}'::jsonb))->>'result'$q$, p_ref, p_amount, p_amount + 150)) $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_item uuid; v_sp uuid; v_coh uuid; v_book uuid; v_member uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('clin', pg_temp.mkuser(v_org, 'clin', 'clinician'));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('pat3', pg_temp.mkuser(v_org, 'pat3', 'patient'));
  perform pg_temp.setf('pts', pg_temp.mkuser(v_org, 'pts', 'patient'));
  perform pg_temp.setf('rate', pg_temp.mkuser(v_org, 'rate', 'patient'));
  v_member := pg_temp.mkuser(v_org, 'member', 'patient');
  perform pg_temp.setf('member', v_member);
  -- an item priced 5,000 naira: 3,000 owed to a partner, 2,000 Tarragon's own service fee
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_consult', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 2, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason)
  values (v_org, v_item, 500000, '{"partner_fee":300000,"tarragon_service_fee":200000}', 'proof');
  -- an item whose partner part is 6,000 naira of 8,000, for the floor test
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_floor', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason)
  values (v_org, v_item, 800000, '{"partner_fee":600000,"tarragon_service_fee":200000}', 'proof');
  -- a second item with no itemised split (like the Membership): no floor, no points
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_plain', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 800000, '{}', 'proof');
  -- a sponsor (hmo), one cohort, the member inside it, and an active price book with a rate for proof_consult
  insert into public.organisations (name, type) values ('S73 proof HMO', 'hmo') returning id into v_sp;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
  values (v_org, v_sp, 'S73 proof cohort', 'PRQFSX73', current_date - 1, current_date + 100, 50, true) returning id into v_coh;
  perform pg_temp.setf('sponsor', v_sp); perform pg_temp.setf('cohort', v_coh);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (v_org, v_member, v_coh, true);
  -- a third sponsor with a cohort and NO price book: a cohort-restricted discount code is tested against it
  declare v_sp3 uuid; v_coh3 uuid;
  begin
    insert into public.organisations (name, type) values ('S73 proof NGO', 'ngo') returning id into v_sp3;
    insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
    values (v_org, v_sp3, 'S73 NGO cohort', 'PRQFNG73', current_date - 1, current_date + 100, 50, true) returning id into v_coh3;
    perform pg_temp.setf('cohort3', v_coh3);
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (v_org, pg_temp.mkuser(v_org, 'cmember', 'patient'), v_coh3, true);
    perform pg_temp.setf('cmember', (select patient_id from public.profile_cohorts where cohort_id = v_coh3));
  end;
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S73 proof run' where key = 'v5_checkout';
end $$;

-- 1. The rule order and the floors, with no code, no book, no points ------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); q jsonb;
begin
  q := pg_temp.qj(v_pat, 'proof_consult');
  perform pg_temp.ck('a plain quote is the list price', '500000', q ->> 'amount_due_kobo');
  perform pg_temp.ck('the explanation starts with the list line', 'list', q -> 'lines' -> 0 ->> 'rule');
  perform pg_temp.ck('the quote names its third-party floor', '300000', q ->> 'floor_kobo');
  perform pg_temp.ck('the quote carries the price version and rules version', '1', q ->> 'pricing_rules_version');
  perform pg_temp.ck('a quote for an unknown item is refused', 'ERR:item_not_available', pg_temp.qa(v_pat, 'nope_nothing'));
  perform pg_temp.ck('a quote for an institutional item is refused to a patient', 'ERR:item_not_available', pg_temp.qa(v_pat, 'institutional_protocol_per_life'));
  perform pg_temp.ck('a staff account cannot ask for a patient quote', 'true', (pg_temp.qa(pg_temp.f('clin'), 'proof_consult') like '%order_not_authorised%')::text);
  perform pg_temp.ck('anon cannot ask for a quote', '42501', pg_temp.try_anon($q$select public.price_quote('proof_consult')$q$));
  perform pg_temp.ck('a quote while checkout is closed is refused', 'ERR:checkout_not_open',
    (select case when pg_temp.owner_sql($q$update public.platform_modules set is_enabled = false where key = 'v5_checkout'$q$) = 'ok'
                 then pg_temp.qa(v_pat, 'proof_consult') end));
  perform pg_temp.owner_sql($q$update public.platform_modules set is_enabled = true where key = 'v5_checkout'$q$);
end $$;

-- 2. Discount codes: the quote and the charge agree ---------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat'); r text;
begin
  -- a staff member creates codes (admin only, audited)
  perform pg_temp.ck('a patient cannot create a discount code', 'true',
    (pg_temp.q_as(v_pat, $q$select public.admin_create_discount_code('PAT10', 'percent', 10, null, null, '{}', null, 5, 1, now() - interval '1 day', now() + interval '30 days', 'x')::text$q$) like '%pricing_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot create a discount code', 'true',
    (pg_temp.q_as(pg_temp.f('clin'), $q$select public.admin_create_discount_code('CLIN10', 'percent', 10, null, null, '{}', null, 5, 1, now() - interval '1 day', now() + interval '30 days', 'x')::text$q$) like '%pricing_not_authorised%')::text);
  perform pg_temp.ck('anon cannot create a discount code', '42501',
    pg_temp.try_anon($q$select public.admin_create_discount_code('ANON10', 'percent', 10, null, null, '{}', null, 5, 1, now() - interval '1 day', now() + interval '30 days', 'x')$q$));
  perform pg_temp.ck('admin creates a 10 percent code', 'ok',
    pg_temp.try_as(v_admin, $q$select public.admin_create_discount_code('TEN-PERCENT', 'percent', 10, null, null, '{}', null, 100, 5, now() - interval '1 day', now() + interval '30 days', 'S73 proof')$q$));
  perform pg_temp.ck('the code is stored normalised', 'TENPERCENT', (select code from public.discount_codes where code = 'TENPERCENT'));
  perform pg_temp.ck('admin creates a fixed 1,000 naira code', 'ok',
    pg_temp.try_as(v_admin, $q$select public.admin_create_discount_code('FIXED1000', 'fixed', null, 100000, null, '{}', null, 100, 5, now() - interval '1 day', now() + interval '30 days', 'S73 proof')$q$));
  perform pg_temp.ck('admin creates a code that would take everything off', 'ok',
    pg_temp.try_as(v_admin, $q$select public.admin_create_discount_code('EVERYTHING', 'percent', 100, null, null, '{}', null, 100, 5, now() - interval '1 day', now() + interval '30 days', 'S73 proof')$q$));
  perform pg_temp.ck('creating a code is audited', 'true', (select (count(*) >= 3)::text from public.audit_log where action = 'pricing.discount_code_created' and actor_id = v_admin));
  perform pg_temp.ck('a code that is too short is refused with a clear reason', 'true',
    (pg_temp.try_as(v_admin, $q$select public.admin_create_discount_code('AB', 'percent', 10, null, null, '{}', null, 5, 1, now(), now() + interval '1 day', 'x')$q$) like '%discount_code_invalid%')::text);
  perform pg_temp.ck('a taken code name is refused', 'true',
    (pg_temp.try_as(v_admin, $q$select public.admin_create_discount_code('TENPERCENT', 'percent', 5, null, null, '{}', null, 5, 1, now(), now() + interval '1 day', 'x')$q$) like '%discount_code_taken%')::text);
  perform pg_temp.ck('a code naming an unknown item is refused', 'true',
    (pg_temp.try_as(v_admin, $q$select public.admin_create_discount_code('GHOSTITEM', 'percent', 5, null, null, '{ghost_item}', null, 5, 1, now(), now() + interval '1 day', 'x')$q$) like '%unknown_item%')::text);
end $$;

-- The twelve seeded quote == charge scenarios. Each: quote, create the order, compare the three numbers, cancel (so the 5-open-orders limit and the caps stay free).
create function pg_temp.scenario(p_name text, p_uid uuid, p_code text, p_disc text, p_pts boolean, p_expected_due bigint) returns void language plpgsql as
$f$
declare v_quote text; v_ord text; v_id uuid; v_amount text; v_stored text; v_ref text;
begin
  v_quote := pg_temp.qa(p_uid, p_code, p_disc, p_pts);
  perform pg_temp.ck('scenario ' || p_name || ': the quote is as designed', p_expected_due::text, v_quote);
  v_ord := pg_temp.mk(p_uid, p_code, p_disc, p_pts, p_expected_due);
  v_id := nullif((v_ord::jsonb) ->> 'order_id', '')::uuid;
  select o.amount_kobo::text, o.quote ->> 'amount_due_kobo', o.paystack_reference into v_amount, v_stored, v_ref from public.orders o where o.id = v_id;
  perform pg_temp.ck('scenario ' || p_name || ': the order charges what the quote said', v_quote, v_amount);
  perform pg_temp.ck('scenario ' || p_name || ': the order stored the explanation it was priced by', v_quote, v_stored);
  perform pg_temp.ck('scenario ' || p_name || ': a payment of the quoted amount is accepted by the payment function', 'paid',
    (select case when v_id is null then 'no order' else pg_temp.pay(v_ref, v_amount::bigint) end));
end $f$;

do $$
declare v_pat uuid; v_i integer := 0; v_u uuid;
begin
  -- a fresh buyer for each scenario: each pays, so it consumes one use of any code and one open-order slot
  perform pg_temp.scenario('1 list price', pg_temp.mkuser(pg_temp.f('org'), 'sc1', 'patient'), 'proof_consult', null, false, 500000);
  perform pg_temp.scenario('2 ten percent code', pg_temp.mkuser(pg_temp.f('org'), 'sc2', 'patient'), 'proof_consult', 'ten percent', false, 450000);
  perform pg_temp.scenario('3 fixed code', pg_temp.mkuser(pg_temp.f('org'), 'sc3', 'patient'), 'proof_consult', 'FIXED1000', false, 400000);
  -- 100 percent of 5,000 would be 5,000, but 3,000 is owed to a partner: the code takes at most the 2,000 above that, so 3,000 is paid
  perform pg_temp.scenario('4 a 100 percent code stops at the partner cost', pg_temp.mkuser(pg_temp.f('org'), 'sc4', 'patient'), 'proof_consult', 'everything', false, 300000);
  -- no itemised split means no known third-party cost: the same code is limited only by the minimum payable (100 naira)
  perform pg_temp.scenario('5 a 100 percent code on an item with no split leaves the minimum', pg_temp.mkuser(pg_temp.f('org'), 'sc5', 'patient'), 'proof_plain', 'everything', false, 10000);
  perform pg_temp.scenario('6 list price with no split', pg_temp.mkuser(pg_temp.f('org'), 'sc6', 'patient'), 'proof_plain', null, false, 800000);
  perform pg_temp.scenario('11 fixed code on an item with no split', pg_temp.mkuser(pg_temp.f('org'), 'sc11', 'patient'), 'proof_plain', 'FIXED1000', false, 700000);
  perform pg_temp.scenario('12 ten percent on an item with no split', pg_temp.mkuser(pg_temp.f('org'), 'sc12', 'patient'), 'proof_plain', 'TENPERCENT', false, 720000);
end $$;

-- 3. Price books -------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat'); v_book uuid; v_e uuid; n integer;
begin
  perform pg_temp.ck('a patient cannot create a price book', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.admin_create_price_book(%L, 'Nope')::text$q$, pg_temp.f('sponsor'))) like '%pricing_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot create a price book', 'true',
    (pg_temp.q_as(pg_temp.f('clin'), format($q$select public.admin_create_price_book(%L, 'Nope')::text$q$, pg_temp.f('sponsor'))) like '%pricing_not_authorised%')::text);
  perform pg_temp.ck('anon cannot create a price book', '42501', pg_temp.try_anon(format($q$select public.admin_create_price_book(%L, 'Nope')$q$, pg_temp.f('sponsor'))));
  perform pg_temp.ck('a price book needs a real sponsor organisation', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.admin_create_price_book(%L, 'Own organisation')$q$, pg_temp.f('org'))) like '%sponsor_org_invalid%')::text);
  v_book := (pg_temp.q_as(v_admin, format($q$select public.admin_create_price_book(%L, 'S73 proof book')::text$q$, pg_temp.f('sponsor'))))::uuid;
  perform pg_temp.setf('book', v_book);
  perform pg_temp.ck('a new book is a draft', 'draft', (select status from public.price_books where id = v_book));
  perform pg_temp.ck('a book cannot be activated while empty', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_status(%L, 'active', 'Proof run, activating an empty book')$q$, v_book)) like '%price_book_empty%')::text);
  perform pg_temp.ck('a rate above the list price is refused', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 600000, 0, 'Proof run, too high a rate')$q$, v_book)) like '%price_book_rate_above_list%')::text);
  perform pg_temp.ck('a rate below what a partner is owed is refused', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 250000, 0, 'Proof run, too low a rate')$q$, v_book)) like '%price_book_rate_below_cost%')::text);
  perform pg_temp.ck('a rate needs a reason', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 400000, 0, 'short')$q$, v_book)) like '%catalogue_reason_needed%')::text);
  perform pg_temp.ck('a patient cannot set a rate', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 400000, 0, 'A patient trying to set a rate')$q$, v_book)) like '%pricing_not_authorised%')::text);
  perform pg_temp.ck('admin sets a 4,000 naira member rate', 'ok',
    pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 400000, 0, 'Proof run, member rate')$q$, v_book)));
  -- a draft book prices nobody
  perform pg_temp.ck('a draft book changes nothing for its member', '500000', pg_temp.qa(pg_temp.f('member'), 'proof_consult'));
  perform pg_temp.ck('admin activates the book', 'ok', pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_status(%L, 'active', 'Proof run, contract signed')$q$, v_book)));
  perform pg_temp.ck('the member now sees the book rate', '400000', pg_temp.qa(pg_temp.f('member'), 'proof_consult'));
  perform pg_temp.ck('a patient outside the cohort still sees the list price', '500000', pg_temp.qa(v_pat, 'proof_consult'));
  perform pg_temp.ck('the explanation names the book line', 'price_book', pg_temp.qj(pg_temp.f('member'), 'proof_consult') -> 'lines' -> 1 ->> 'rule');
  perform pg_temp.ck('the buyer is never shown the book id', 'null', coalesce((pg_temp.qj(pg_temp.f('member'), 'proof_consult') -> 'price_book_entry_id')::text, 'null'));
  -- a second rate for the same item from the same moment overlaps: refused. A later start closes the first.
  perform pg_temp.ck('a rate that starts before the current one is refused', 'true',
    (pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 380000, 0, 'Proof run, backdated rate', now() - interval '1 day')$q$, v_book)) like '%price_start_before_current%')::text);
  perform pg_temp.ck('a direct overlapping entry is refused by the database', 'true',
    (pg_temp.owner_sql(format($q$insert into public.price_book_entries (organisation_id, price_book_id, catalog_item_id, rate_kobo, valid_from, reason) select organisation_id, price_book_id, catalog_item_id, 390000, now(), 'Proof run, overlapping' from public.price_book_entries where price_book_id = %L limit 1$q$, v_book)) like '%conflicting key value violates exclusion constraint%')::text);
  select id into v_e from public.price_book_entries where price_book_id = v_book limit 1;
  perform pg_temp.ck('a rate cannot be edited (INV-16)', 'price_book_entry_immutable', pg_temp.owner_sql(format($q$update public.price_book_entries set rate_kobo = 1 where id = %L$q$, v_e)));
  perform pg_temp.ck('a rate cannot be deleted', 'price_book_entry_immutable', pg_temp.owner_sql(format($q$delete from public.price_book_entries where id = %L$q$, v_e)));
  perform pg_temp.ck('a book cannot be deleted', 'price_book_immutable', pg_temp.owner_sql(format($q$delete from public.price_books where id = %L$q$, v_book)));
  perform pg_temp.ck('a book cannot go back to draft', 'true', (pg_temp.owner_sql(format($q$update public.price_books set status = 'draft' where id = %L$q$, v_book)) like '%price_book_bad_transition%')::text);

  perform pg_temp.scenario('7 member with a book rate', pg_temp.f('member'), 'proof_consult', null, false, 400000);
end $$;

-- A second member for the book-and-code scenario (the first already has an order)
do $$
declare v_m2 uuid := pg_temp.mkuser(pg_temp.f('org'), 'member2', 'patient');
begin
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (pg_temp.f('org'), v_m2, pg_temp.f('cohort'), true);
  perform pg_temp.scenario('9 book rate and a ten percent code', v_m2, 'proof_consult', 'tenpercent', false, 360000);
end $$;

-- a book rate below cost written around the function is floored at quote time (defence in depth)
do $$
declare v_m uuid := pg_temp.mkuser(pg_temp.f('org'), 'member3', 'patient'); v_book uuid := pg_temp.f('book'); v_item uuid; q jsonb;
begin
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (pg_temp.f('org'), v_m, pg_temp.f('cohort'), true);
  -- an item with no itemised split has no known floor, so a low rate stands
  select id into v_item from public.catalog_items where code = 'proof_plain' and organisation_id = pg_temp.f('org');
  insert into public.price_book_entries (organisation_id, price_book_id, catalog_item_id, rate_kobo, reason) values (pg_temp.f('org'), v_book, v_item, 100000, 'Proof run, no split so no floor');
  q := pg_temp.qj(v_m, 'proof_plain');
  perform pg_temp.ck('with no itemised split, a low book rate stands', '100000', q ->> 'amount_due_kobo');
  -- an item whose partner part is 600,000: a book rate of 100,000 written around the function is floored at 600,000
  select id into v_item from public.catalog_items where code = 'proof_floor' and organisation_id = pg_temp.f('org');
  insert into public.price_book_entries (organisation_id, price_book_id, catalog_item_id, rate_kobo, reason) values (pg_temp.f('org'), v_book, v_item, 100000, 'Proof run, below any floor');
  q := pg_temp.qj(v_m, 'proof_floor');
  perform pg_temp.ck('a book rate written below the partner cost is floored at the partner cost', '600000', q ->> 'amount_due_kobo');
  perform pg_temp.ck('and the quote says it was floored', 'price_book_floored_at_third_party_cost', q -> 'flags' ->> 0);
  perform pg_temp.ck('and the sum of the lines still equals the amount due', '600000',
    (select sum((l ->> 'amount_kobo')::bigint)::text from jsonb_array_elements(q -> 'lines') l));
end $$;

-- 4. Sponsor coverage: computed by the quote, refused by the order until S71 can bill the sponsor ---------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_book uuid; v_m uuid := pg_temp.mkuser(pg_temp.f('org'), 'member4', 'patient'); q jsonb; v_sp2 uuid; v_item uuid;
begin
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (pg_temp.f('org'), v_m, pg_temp.f('cohort'), true);
  -- a second sponsor, a second book with a 50 percent share on the consult
  insert into public.organisations (name, type) values ('S73 proof corporate', 'corporate') returning id into v_sp2;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
  values (pg_temp.f('org'), v_sp2, 'S73 corporate cohort', 'PRQFCY73', current_date - 1, current_date + 100, 50, true);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test)
  select pg_temp.f('org'), pg_temp.mkuser(pg_temp.f('org'), 'sponsored', 'patient'), id, true from public.sponsor_cohorts where code = 'PRQFCY73';
  v_book := (pg_temp.q_as(v_admin, format($q$select public.admin_create_price_book(%L, 'S73 corporate book')::text$q$, v_sp2)))::uuid;
  perform pg_temp.ck('admin sets a 50 percent sponsor share', 'ok',
    pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 500000, 50, 'Proof run, employer pays half')$q$, v_book)));
  perform pg_temp.ck('admin activates the corporate book', 'ok', pg_temp.try_as(v_admin, format($q$select public.admin_set_price_book_status(%L, 'active', 'Proof run, contract signed')$q$, v_book)));
  select pc.patient_id into v_m from public.profile_cohorts pc join public.sponsor_cohorts sc on sc.id = pc.cohort_id where sc.code = 'PRQFCY73';
  q := pg_temp.qj(v_m, 'proof_consult');
  perform pg_temp.ck('the quote shows what the buyer would pay after the sponsor share', '250000', q ->> 'amount_due_kobo');
  perform pg_temp.ck('the quote shows the sponsor share', '250000', q ->> 'sponsor_share_kobo');
  perform pg_temp.ck('the sponsor line is a negative line, so the lines add up', '250000',
    (select (sum((l ->> 'amount_kobo')::bigint))::text from jsonb_array_elements(q -> 'lines') l));
  perform pg_temp.ck('create_order refuses a sponsor-covered order until sponsor billing exists', 'ERR:sponsor_billing_not_open', pg_temp.mk(v_m, 'proof_consult'));
  perform pg_temp.ck('no order was created by the refusal', '0', (select count(*)::text from public.orders where buyer_profile_id = v_m));
end $$;

-- 5. Discount code rules ---------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_p1 uuid := pg_temp.mkuser(pg_temp.f('org'), 'cap1', 'patient'); v_p2 uuid := pg_temp.mkuser(pg_temp.f('org'), 'cap2', 'patient');
        v_o jsonb; v_id uuid; v_ref text; v_code uuid;
begin
  perform pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('ONCEONLY', 'percent', 10, null, null, '{}', null, 1, 1, now() - interval '1 day', now() + interval '30 days', 'S73 proof cap')::text$q$);
  perform pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('EXPIRED1', 'percent', 10, null, null, '{}', null, 5, 1, now() - interval '3 days', now() - interval '1 day', 'S73 proof expiry')::text$q$);
  perform pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('PAUSEME1', 'percent', 10, null, null, '{}', null, 5, 1, now() - interval '1 day', now() + interval '3 days', 'S73 proof pause')::text$q$);
  perform pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('ONLYPLAIN', 'percent', 10, null, null, '{proof_plain}', null, 5, 1, now() - interval '1 day', now() + interval '3 days', 'S73 proof item')::text$q$);
  perform pg_temp.q_as(v_admin, format($q$select public.admin_create_discount_code('COHORTONLY', 'percent', 10, null, null, '{}', %L, 5, 1, now() - interval '1 day', now() + interval '3 days', 'S73 proof cohort')::text$q$, pg_temp.f('cohort3')));
  perform pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('TWICE2', 'percent', 5, null, null, '{}', null, 10, 2, now() - interval '1 day', now() + interval '3 days', 'S73 proof per person')::text$q$);
  perform pg_temp.ck('admin pauses a code', 'ok', pg_temp.try_as(v_admin, format($q$select public.admin_set_discount_code_status(%L, 'paused', 'Proof run, pausing the code')$q$, (select id from public.discount_codes where code = 'PAUSEME1'))));

  -- total cap: one use in all
  v_o := pg_temp.mk(v_p1, 'proof_consult', 'ONCEONLY')::jsonb;
  perform pg_temp.ck('a code with one use works the first time', '450000', v_o ->> 'amount_kobo');
  v_id := (v_o ->> 'order_id')::uuid; v_ref := v_o ->> 'reference';
  select id into v_code from public.discount_codes where code = 'ONCEONLY';
  perform pg_temp.ck('an unpaid order RESERVES the use', 'reserved', (select state from public.discount_redemptions where order_id = v_id));
  perform pg_temp.ck('a second person is refused while the first order is open', 'discount_code_invalid',
    (pg_temp.mk(v_p2, 'proof_consult', 'ONCEONLY')::jsonb) ->> 'error');
  perform pg_temp.ck('a refusal creates no order', '0', (select count(*)::text from public.orders where buyer_profile_id = v_p2));
  perform pg_temp.ck('cancel_order returns true for its buyer', 'true', pg_temp.q_as(v_p1, format($q$select public.cancel_order(%L)::text$q$, v_id)));
  perform pg_temp.ck('cancelling the order releases the use', 'released', (select state from public.discount_redemptions where order_id = v_id));
  perform pg_temp.ck('the released use can be taken by another person', '450000', (pg_temp.mk(v_p2, 'proof_consult', 'ONCEONLY')::jsonb) ->> 'amount_kobo');
  -- the cancelled order is paid late (money received is never ignored): the use is redeemed, not left released
  perform pg_temp.ck('a late payment on the cancelled order is honoured', 'paid', pg_temp.pay(v_ref, 450000));
  perform pg_temp.ck('and its code use is redeemed', 'redeemed', (select state from public.discount_redemptions where order_id = v_id));
  perform pg_temp.ck('a paid order keeps its code use for good', 'redeemed', (select state from public.discount_redemptions where order_id = v_id));
  perform pg_temp.ck('a test code and its redemptions never show as real use (INV-13)', 'null', coalesce((select (e ->> 'used') from jsonb_array_elements(pg_temp.q_as(v_admin, 'select (public.admin_pricing_overview() -> ''codes'')::text')::jsonb) e where e ->> 'code' = 'ONCEONLY'), 'null'));
  -- an unusable code never says why: expired, paused, wrong item, wrong cohort and unknown all read the same
  perform pg_temp.ck('an expired code reads as invalid', 'discount_code_invalid', (pg_temp.mk(v_p1, 'proof_consult', 'EXPIRED1')::jsonb) ->> 'error');
  perform pg_temp.ck('a paused code reads as invalid', 'discount_code_invalid', (pg_temp.mk(v_p1, 'proof_consult', 'PAUSEME1')::jsonb) ->> 'error');
  perform pg_temp.ck('a code for another item reads as invalid', 'discount_code_invalid', (pg_temp.mk(v_p1, 'proof_consult', 'ONLYPLAIN')::jsonb) ->> 'error');
  perform pg_temp.ck('a cohort code reads as invalid to someone outside the cohort', 'discount_code_invalid', (pg_temp.mk(v_p1, 'proof_consult', 'COHORTONLY')::jsonb) ->> 'error');
  perform pg_temp.ck('an unknown code reads as invalid', 'discount_code_invalid', (pg_temp.mk(v_p1, 'proof_consult', 'NOSUCHCODE')::jsonb) ->> 'error');
  perform pg_temp.ck('the quote for an unusable code is still a quote, flagged', 'false', (pg_temp.qj(v_p1, 'proof_consult', 'EXPIRED1') ->> 'discount_code_ok'));
  perform pg_temp.ck('an unusable code changes nothing in the amount', '500000', pg_temp.qa(v_p1, 'proof_consult', 'EXPIRED1'));
  perform pg_temp.ck('the unusable code line says so without a reason that helps guessing', 'quote.reason.code_unusable',
    pg_temp.qj(v_p1, 'proof_consult', 'EXPIRED1') -> 'lines' -> 1 ->> 'reason_key');
  perform pg_temp.ck('an item-restricted code works on its item', '720000', pg_temp.qa(pg_temp.f('pat2'), 'proof_plain', 'ONLYPLAIN'));
  perform pg_temp.ck('a cohort code works for a cohort member', '450000', pg_temp.qa(pg_temp.f('cmember'), 'proof_consult', 'COHORTONLY'));
  -- the code's own value can never be edited
  perform pg_temp.ck('a code cannot be edited after creation', 'discount_code_immutable', pg_temp.owner_sql($q$update public.discount_codes set percent = 99 where code = 'TWICE2'$q$));
  perform pg_temp.ck('a code cannot be deleted', 'discount_code_immutable', pg_temp.owner_sql($q$delete from public.discount_codes where code = 'TWICE2'$q$));
  perform pg_temp.ck('a code cannot be extended', 'discount_code_immutable', pg_temp.owner_sql($q$update public.discount_codes set valid_to = valid_to + interval '1 day' where code = 'TWICE2'$q$));
  perform pg_temp.ck('a patient cannot pause a code', 'true',
    (pg_temp.try_as(v_p1, format($q$select public.admin_set_discount_code_status(%L, 'ended', 'A patient ending a code')$q$, (select id from public.discount_codes where code = 'TWICE2'))) like '%pricing_not_authorised%')::text);
  -- per person limit 2: the third order by one beneficiary is refused. Pay each so the buyer's open-order slots stay free.
  declare v_p3 uuid := pg_temp.mkuser(pg_temp.f('org'), 'cap3', 'patient'); v_a jsonb; v_b jsonb; v_c jsonb;
  begin
    v_a := pg_temp.mk(v_p3, 'proof_consult', 'TWICE2')::jsonb;
    v_b := pg_temp.mk(v_p3, 'proof_consult', 'TWICE2')::jsonb;
    v_c := pg_temp.mk(v_p3, 'proof_consult', 'TWICE2')::jsonb;
    perform pg_temp.ck('a code with a limit of two works twice for one person', '475000', v_a ->> 'amount_kobo');
    perform pg_temp.ck('the second use works', '475000', v_b ->> 'amount_kobo');
    perform pg_temp.ck('the third use by the same person is refused', 'discount_code_invalid', v_c ->> 'error');
  end;
end $$;

-- 6. Guessing is slow, and a failed try is kept ---------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'guesser', 'patient'); i integer; r text;
begin
  for i in 1..10 loop
    r := (pg_temp.mk(v_p, 'proof_consult', 'GUESS' || lpad(i::text, 3, '0'))::jsonb) ->> 'error';
  end loop;
  perform pg_temp.ck('ten wrong tries are each reported as invalid', 'discount_code_invalid', r);
  perform pg_temp.ck('ten failed tries are kept', '10', (select count(*)::text from public.discount_code_attempts where patient_id = v_p));
  perform pg_temp.ck('the eleventh try is turned away without checking', 'discount_code_rate_limited', (pg_temp.mk(v_p, 'proof_consult', 'GUESS999')::jsonb) ->> 'error');
  perform pg_temp.ck('even a correct code is refused while limited', 'discount_code_rate_limited', (pg_temp.mk(v_p, 'proof_consult', 'FIXED1000')::jsonb) ->> 'error');
  perform pg_temp.ck('a limited quote still prices the item without the code', '500000', pg_temp.qa(v_p, 'proof_consult', 'FIXED1000'));
  perform pg_temp.ck('and says it was rate limited', 'rate_limited', pg_temp.qj(v_p, 'proof_consult', 'FIXED1000') ->> 'discount_error');
  perform pg_temp.ck('a person with no failed tries is not limited', '400000', pg_temp.qa(pg_temp.f('pat3'), 'proof_consult', 'FIXED1000'));
  perform pg_temp.ck('no attempt is recorded for a person who gave no code', '0', (select count(*)::text from public.discount_code_attempts where patient_id = pg_temp.f('pat3')));
end $$;

-- 7. The shown total is the charged total ----------------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'expect', 'patient'); r text;
begin
  perform pg_temp.ck('an order is refused when the total the person was shown is not what the database computes', 'ERR:quote_changed',
    pg_temp.mk(v_p, 'proof_consult', null, false, 450000));
  perform pg_temp.ck('and no order was made', '0', (select count(*)::text from public.orders where buyer_profile_id = v_p));
  perform pg_temp.ck('an order for the right total goes through', '500000', (pg_temp.mk(v_p, 'proof_consult', null, false, 500000)::jsonb) ->> 'amount_kobo');
  perform pg_temp.ck('the order records the list price', '500000', (select list_amount_kobo::text from public.orders where buyer_profile_id = v_p));
  perform pg_temp.ck('the order records the price row it used (INV-16)', 'true',
    (select (o.price_id is not null and o.price_id::text = o.quote ->> 'price_id')::text from public.orders o where o.buyer_profile_id = v_p));
  perform pg_temp.ck('an order that charges more than the list price is refused by the database', 'refused',
    case when pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, list_amount_kobo, discount_kobo)
        select organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, 500000, 'tho_sabotage00000000000000000001', 500000, 100000 from public.orders where buyer_profile_id = %L$q$, v_p)) like '%orders_pricing_adds_up%' then 'refused' else 'accepted' end);
  perform pg_temp.ck('the order records the rules version it was priced under (INV-16)', '1', (select pricing_rules_version::text from public.orders where buyer_profile_id = v_p));
  perform pg_temp.ck('the order is flagged test (INV-13)', 'true', (select is_test::text from public.orders where buyer_profile_id = v_p));
  -- the order is the decision: nothing about it can be changed afterwards
  perform pg_temp.ck('an order cannot have its discount edited', 'order_immutable',
    pg_temp.owner_sql(format($q$update public.orders set discount_kobo = 1 where buyer_profile_id = %L$q$, v_p)));
  perform pg_temp.ck('an order cannot have its stored explanation edited', 'order_immutable',
    pg_temp.owner_sql(format($q$update public.orders set quote = '{}'::jsonb where buyer_profile_id = %L$q$, v_p)));
  perform pg_temp.ck('an order cannot have its rules version edited', 'order_immutable',
    pg_temp.owner_sql(format($q$update public.orders set pricing_rules_version = 9 where buyer_profile_id = %L$q$, v_p)));
  perform pg_temp.ck('a retry of the same tap is not priced again', 'true',
    (select (count(*) = 1)::text from public.orders where buyer_profile_id = v_p));
end $$;

-- the 3-argument call that every older caller makes is still unambiguous, and there is exactly one create_order
do $$
declare v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'threearg', 'patient');
begin
  perform pg_temp.ck('there is exactly one create_order signature', '1',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_order'));
  perform pg_temp.ck('a three-argument call with literals is not ambiguous', '500000',
    (pg_temp.q_as(v_p, $q$select (public.create_order('proof_consult', gen_random_uuid(), null))->>'amount_kobo'$q$)));
  perform pg_temp.ck('a one-argument call still works', '500000',
    (pg_temp.q_as(v_p, $q$select (public.create_order('proof_consult'))->>'amount_kobo'$q$)));
end $$;

-- 8. Points: off by default, fee only, whole steps, reserved, spent once, never a balance ------------------------------------------
do $$
declare v_p uuid := pg_temp.f('pts'); v_o jsonb; v_o2 jsonb; v_id uuid; v_ref text;
begin
  insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned) values (v_p, pg_temp.f('org'), 700, 700)
  on conflict (patient_id) do update set balance = 700, lifetime_earned = 700;
  perform pg_temp.ck('points are OFF by default: asking to use them changes nothing', '500000', pg_temp.qa(v_p, 'proof_consult', null, true));
  perform pg_temp.ck('and the line says points are off', 'quote.reason.points_off', pg_temp.qj(v_p, 'proof_consult', null, true) -> 'lines' -> 1 ->> 'reason_key');
  update public.pricing_config set rules = jsonb_set(rules, '{points,enabled}', 'true') where is_active;
  perform pg_temp.ck('with points on, 700 points buy at most 5 steps of 50 naira off the fee', '475000', pg_temp.qa(v_p, 'proof_consult', null, true));
  perform pg_temp.ck('the quote says how many points it would use', '500', pg_temp.qj(v_p, 'proof_consult', null, true) ->> 'points_applied');
  perform pg_temp.ck('points never touch an item with no Tarragon service fee component', 'quote.reason.points_not_for_item',
    pg_temp.qj(v_p, 'proof_plain', null, true) -> 'lines' -> 1 ->> 'reason_key');
  perform pg_temp.ck('points do not touch the partner part: the floor still holds with a code and points together', '425000',
    pg_temp.qa(v_p, 'proof_consult', 'tenpercent', true));
  perform pg_temp.ck('a person with no points gets no reduction and a clear line', 'quote.reason.points_none_available',
    pg_temp.qj(pg_temp.f('pat'), 'proof_consult', null, true) -> 'lines' -> 1 ->> 'reason_key');
  -- an order that uses points records them but spends nothing until it is paid
  v_o := pg_temp.mk(v_p, 'proof_consult', null, true, 475000)::jsonb;
  v_id := (v_o ->> 'order_id')::uuid; v_ref := v_o ->> 'reference';
  perform pg_temp.ck('the order records the points it will use', '500', (select points_applied::text from public.orders where id = v_id));
  perform pg_temp.ck('the order records the reduction in kobo', '25000', (select points_reduction_kobo::text from public.orders where id = v_id));
  perform pg_temp.ck('nothing is spent yet', '700', (select balance::text from public.wellness_points_balances where patient_id = v_p));
  -- an open order RESERVES its points: a second order sees only the 200 points left, two steps
  perform pg_temp.ck('a second order sees only the points not already reserved', '10000',
    pg_temp.qj(v_p, 'proof_consult', null, true) ->> 'points_reduction_kobo');
  perform pg_temp.ck('an order for the wrong total is refused', 'ERR:quote_changed', pg_temp.mk(v_p, 'proof_consult', null, true, 475000));
  perform pg_temp.ck('paying the order accepts only the discounted amount', 'mismatch', pg_temp.pay(v_ref, 500000));
  perform pg_temp.ck('paying the discounted amount works', 'paid', pg_temp.pay(v_ref, 475000));
  perform pg_temp.ck('payment spends the points once', '200', (select balance::text from public.wellness_points_balances where patient_id = v_p));
  perform pg_temp.ck('a replayed payment spends nothing more', 'replay', pg_temp.pay(v_ref, 475000));
  perform pg_temp.ck('the balance is unchanged by a replay', '200', (select balance::text from public.wellness_points_balances where patient_id = v_p));
  perform pg_temp.ck('the spend is in the ledger with the order as its source', '-500',
    (select points::text from public.wellness_points_ledger where patient_id = v_p and reason = 'applied_to_order' and source_id = v_id));
  perform pg_temp.ck('points are never turned into money: spending them on an order creates no redemption or voucher row', '0',
    (select count(*)::text from public.wellness_points_redemptions where patient_id = v_p));
  -- two more seeded quote == charge scenarios with points on
  insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned)
  select u, pg_temp.f('org'), 700, 700 from (select pg_temp.mkuser(pg_temp.f('org'), 'pts2', 'patient') as u) x;
  perform pg_temp.scenario('8 points', (select patient_id from public.wellness_points_balances where patient_id <> v_p and balance = 700 order by patient_id limit 1), 'proof_consult', null, true, 475000);
  insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned)
  select u, pg_temp.f('org'), 700, 700 from (select pg_temp.mkuser(pg_temp.f('org'), 'pts3', 'patient') as u) x;
  perform pg_temp.scenario('10 points and a code', (select patient_id from public.wellness_points_balances where patient_id <> v_p and balance = 700 order by patient_id limit 1), 'proof_consult', 'tenpercent', true, 425000);
  update public.pricing_config set rules = jsonb_set(rules, '{points,enabled}', 'false') where is_active;
end $$;

-- 9. price.changed ----------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); n0 integer; n1 integer; v_item uuid;
begin
  perform pg_temp.ck('price.changed is registered at version 1 with required keys', 'scope,catalog_item_code,price_id',
    (select array_to_string(required_keys, ',') from public.event_type_versions where event_type = 'price.changed' and version = 1));
  select count(*) into n0 from public.domain_events where event_type = 'price.changed';
  perform pg_temp.ck('a patient cannot set a price', 'true',
    (pg_temp.try_as(pg_temp.f('pat'), $q$select public.set_item_price('proof_consult', 520000, '{"partner_fee":300000,"tarragon_service_fee":220000}', 'A patient trying to change a price')$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('admin sets a new price', 'ok',
    pg_temp.try_as(v_admin, $q$select public.set_item_price('proof_consult', 520000, '{"partner_fee":300000,"tarragon_service_fee":220000}', 'Proof run, price rise', now() + interval '1 second')$q$));
  select count(*) into n1 from public.domain_events where event_type = 'price.changed';
  perform pg_temp.ck('set_item_price emits one price.changed', '1', (n1 - n0)::text);
  perform pg_temp.ck('the event is scoped to the list price and names the item', 'list:proof_consult',
    (select payload ->> 'scope' || ':' || (payload ->> 'catalog_item_code') from public.domain_events where event_type = 'price.changed' and payload ->> 'amount_kobo' = '520000'));
  perform pg_temp.ck('the event carries the new amount in integer kobo', '520000', (select payload ->> 'amount_kobo' from public.domain_events where event_type = 'price.changed' and payload ->> 'scope' = 'list'));
  perform pg_temp.ck('the event is version 1', '1', (select event_version::text from public.domain_events where event_type = 'price.changed' and payload ->> 'scope' = 'list'));
  perform pg_temp.ck('the event names no person', 'null', (select coalesce(patient_id::text, 'null') from public.domain_events where event_type = 'price.changed' and payload ->> 'scope' = 'list'));
  perform pg_temp.ck('a price book entry emits its own price.changed', 'true',
    (select (count(*) >= 2)::text from public.domain_events where event_type = 'price.changed' and payload ->> 'scope' = 'price_book'));
  perform pg_temp.ck('an institutional item cannot be given a list price', 'true',
    (pg_temp.try_as(v_admin, $q$select public.set_item_price('institutional_protocol_per_life', 100000, '{}', 'Proof run, trying a list price')$q$) like '%institutional_item_priced_by_book%')::text);
end $$;

-- 10. Hardship is a seam: a grant function that returns something is shown and floored; the stub returns nothing ----------------
do $$
declare v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'hard', 'patient'); q jsonb;
begin
  perform pg_temp.ck('with no Access Fund grants (S72) hardship takes nothing off', '500000', pg_temp.qa(v_p, 'proof_consult'));
  perform pg_temp.ck('no quote line pretends otherwise', '1', (select count(*)::text from jsonb_array_elements(pg_temp.qj(v_p, 'proof_consult') -> 'lines')));
  create or replace function private.hardship_reduction(p_beneficiary uuid, p_item uuid, p_due bigint) returns bigint language sql stable security definer set search_path = '' as $f$ select 999999999::bigint $f$;
  q := pg_temp.qj(v_p, 'proof_consult');
  perform pg_temp.ck('even a huge grant cannot take the buyer below the partner cost', '300000', q ->> 'amount_due_kobo');
  perform pg_temp.ck('the hardship line sits third, between the price book and the sponsor', 'hardship', (select l ->> 'rule' from jsonb_array_elements(q -> 'lines') l where l ->> 'rule' = 'hardship'));
  create or replace function private.hardship_reduction(p_beneficiary uuid, p_item uuid, p_due bigint) returns bigint language sql stable security definer set search_path = '' as $f$ select 0::bigint $f$;
  perform pg_temp.ck('the stub is restored', '500000', pg_temp.qa(v_p, 'proof_consult'));
end $$;

-- 11. Membership toggle (S73-1, OQ-324) ---------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat'); v_real uuid; q text;
begin
  perform pg_temp.ck('the Membership is off when the migration lands', 'false', (select active::text from public.catalog_items where code = 'membership_annual' and organisation_id = pg_temp.f('org')));
  perform pg_temp.ck('the two new guards exist and are off', '2',
    (select count(*)::text from public.go_live_guards where key in ('membership_billing_enabled', 'concierge_coordinator_enabled') and not is_on));
  perform pg_temp.ck('a patient cannot switch the Membership on', 'true',
    (pg_temp.try_as(v_pat, $q$select public.set_catalog_item_active('membership_annual', true, 'A patient trying to switch it on')$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot switch the Membership on', 'true',
    (pg_temp.try_as(pg_temp.f('clin'), $q$select public.set_catalog_item_active('membership_annual', true, 'A clinician trying to switch it on')$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('anon cannot switch the Membership on', '42501', pg_temp.try_anon($q$select public.set_catalog_item_active('membership_annual', true, 'Anon trying to switch it on')$q$));
  perform pg_temp.ck('an admin cannot switch it on while its go-live guard is off', 'true',
    (pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('membership_annual', true, 'Proof run, guard still off')$q$) like '%go_live_guard_closed%')::text);
  perform pg_temp.ck('and it stays off', 'false', (select active::text from public.catalog_items where code = 'membership_annual' and organisation_id = pg_temp.f('org')));
  perform pg_temp.ck('the guard cannot be switched on with its conditions unmet', 'true',
    (pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('membership_billing_enabled', true, 'Proof run, too early')$q$) like '%not yet met%')::text);
  perform pg_temp.ck('a patient cannot attest a condition', 'true',
    (pg_temp.try_as(v_pat, $q$select public.attest_go_live_condition('membership_billing_enabled', 'paystack_plan_codes_disabled', true, 'A patient trying to attest this')$q$) like '%only an admin%')::text);
  perform pg_temp.ck('admin records that the Paystack plan codes are disabled', 'ok',
    pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('membership_billing_enabled', 'paystack_plan_codes_disabled', true, 'Proof run: founder disabled the six plan codes in the dashboard')$q$));
  perform pg_temp.ck('admin records the refund test', 'ok',
    pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('membership_billing_enabled', 'refund_path_tested', true, 'Proof run: refund of a test Membership tested end to end')$q$));
  perform pg_temp.ck('a condition read from data cannot be attested', 'true',
    (pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('membership_billing_enabled', 'membership_price_set', true, 'Proof run: trying to attest a data condition')$q$) like '%cannot be attested%')::text);
  perform pg_temp.ck('admin switches the guard on', 'ok', pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('membership_billing_enabled', true, 'Proof run: conditions met')$q$));
  perform pg_temp.ck('now an admin can switch the Membership on', 'ok',
    pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('membership_annual', true, 'Proof run, launch approved by the founder')$q$));
  perform pg_temp.ck('and it is on', 'true', (select active::text from public.catalog_items where code = 'membership_annual' and organisation_id = pg_temp.f('org')));
  perform pg_temp.ck('the toggle is audited with who and why', 'Proof run, launch approved by the founder',
    (select event ->> 'reason' from public.audit_log where action = 'catalogue.item_active' and actor_id = v_admin and event ->> 'code' = 'membership_annual' and (event ->> 'active')::boolean order by created_at desc limit 1));
  perform pg_temp.ck('the guard change is in the guard log', '1', (select count(*)::text from public.go_live_guard_log where guard_key = 'membership_billing_enabled' and action = 'switched_on' and actor_id = v_admin));
  -- the guard also stops a REAL (non-test) patient from buying while it is off, even if the item is on
  v_real := pg_temp.mkuser(pg_temp.f('org'), 'real', 'patient');
  perform pg_temp.owner_sql(format($q$update public.profiles set is_test = false where id = %L$q$, v_real));
  -- S71 (OQ-184): a real patient also needs the catalogue checkout guard; open it here (its own proof is s71_checkout_core.sql)
  perform pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('checkout_enabled', 'paystack_channels_verified', true, 'Proof run: channels tried with the test key')$q$);
  perform pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('checkout_enabled', 'refund_path_tested', true, 'Proof run: refund tested end to end')$q$);
  perform pg_temp.ck('admin opens the catalogue checkout guard', 'ok', pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('checkout_enabled', true, 'Proof run: conditions met')$q$));
  perform pg_temp.ck('with the guard on a real patient can be quoted for the Membership', '10000000', pg_temp.qa(v_real, 'membership_annual'));
  perform pg_temp.ck('a Membership quote has no itemised split, so no floor and no points', '0', (pg_temp.qj(v_real, 'membership_annual') ->> 'floor_kobo'));
  perform pg_temp.ck('switching the guard off needs only an admin and no paperwork', 'ok', pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('membership_billing_enabled', false, 'Proof run: stopping sales')$q$));
  perform pg_temp.ck('with the guard off a real patient cannot be quoted for the Membership', 'ERR:membership_not_open', pg_temp.qa(v_real, 'membership_annual'));
  perform pg_temp.ck('a test patient is not blocked (the S37 test pair rule), so existing proofs and rehearsals still work', '10000000', pg_temp.qa(v_pat, 'membership_annual'));
  perform pg_temp.ck('an admin can always switch the item off', 'ok', pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('membership_annual', false, 'Proof run, switching it off again')$q$));
end $$;

-- 12. No subscription machinery anywhere (S73-1), integer kobo (INV-15) -----------------------------------------------------------
do $$
begin
  perform pg_temp.ck('S73 added no subscription table: only the four older ones exist', 'push_subscriptions,subscription_add_ons,subscription_plans,subscriptions',
    (select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema = 'public' and table_name like '%subscription%'));
  perform pg_temp.ck('the retired subscription plans stay retired: none is active', '0', (select count(*)::text from public.subscription_plans where is_active));
  perform pg_temp.ck('no pricing or order column is about renewal or recurrence', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public'
       and table_name in ('orders', 'catalog_items', 'prices', 'price_books', 'price_book_entries', 'discount_codes', 'discount_redemptions', 'pricing_config')
       and column_name ~* '(auto_?renew|recurr|renew|subscri|interval_count|billing_cycle)'));
  perform pg_temp.ck('every kobo column in the new tables is a bigint (INV-15)', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public'
       and table_name in ('price_book_entries', 'discount_codes', 'discount_redemptions') and column_name like '%kobo%' and data_type <> 'bigint'));
  perform pg_temp.ck('every kobo column added to orders is a bigint (INV-15)', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name like '%kobo%' and data_type <> 'bigint'));
end $$;

-- 13. Institutional products (20.7) ---------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_pat uuid := pg_temp.f('pat');
begin
  perform pg_temp.ck('both institutional items exist', '2', (select count(*)::text from public.catalog_items where kind in ('institutional_protocol', 'concierge_coordinator') and organisation_id = pg_temp.f('org')));
  perform pg_temp.ck('both are off', '0', (select count(*)::text from public.catalog_items where kind in ('institutional_protocol', 'concierge_coordinator') and active));
  perform pg_temp.ck('both are institution audience', '2', (select count(*)::text from public.catalog_items where kind in ('institutional_protocol', 'concierge_coordinator') and audience = 'institution'));
  perform pg_temp.ck('a patient item cannot be given an institutional kind', 'true',
    (pg_temp.owner_sql($q$update public.catalog_items set kind = 'concierge_coordinator' where code = 'proof_consult'$q$) like '%catalog_items_audience_matches_kind%')::text);
  perform pg_temp.ck('an institutional item cannot be given the patient audience', 'true',
    (pg_temp.owner_sql($q$update public.catalog_items set audience = 'patient' where code = 'institutional_protocol_per_life'$q$) like '%catalog_items_audience_matches_kind%')::text);
  perform pg_temp.ck('a patient never sees an institutional item in the catalogue', '0',
    pg_temp.q_as(v_pat, $q$select count(*)::text from jsonb_array_elements(public.catalogue()) e where e->>'kind' in ('institutional_protocol','concierge_coordinator')$q$));
  perform pg_temp.ck('a patient cannot read one by code', 'null', coalesce(pg_temp.q_as(v_pat, $q$select public.catalogue_item('institutional_protocol_per_life')::text$q$), 'null'));
  perform pg_temp.ck('checkout refuses an institutional item', 'ERR:item_not_available', pg_temp.mk(v_pat, 'institutional_protocol_per_life'));
  perform pg_temp.ck('an institutional item cannot be switched on without a price book rate', 'true',
    (pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('institutional_protocol_per_life', true, 'Proof run, no rate yet')$q$) like '%item_has_no_price%')::text);
  perform pg_temp.ck('the concierge service cannot be switched on while its guard is off', 'true',
    (pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('concierge_coordinator_per_life', true, 'Proof run, guard still off')$q$) like '%item_has_no_price%' or
     pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('concierge_coordinator_per_life', true, 'Proof run, guard still off')$q$) like '%go_live_guard_closed%')::text);
  -- with a price book rate in place the concierge item still needs its own guard
  declare v_book uuid; v_it uuid;
  begin
    v_book := pg_temp.f('book');
    select id into v_it from public.catalog_items where code = 'concierge_coordinator_per_life' and organisation_id = pg_temp.f('org');
    insert into public.price_book_entries (organisation_id, price_book_id, catalog_item_id, rate_kobo, reason) values (pg_temp.f('org'), v_book, v_it, 150000, 'Proof run, a concierge rate');
    perform pg_temp.ck('with a rate but no guard the concierge item is still refused, for the guard', 'true',
      (pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('concierge_coordinator_per_life', true, 'Proof run, rate set, guard off')$q$) like '%go_live_guard_closed%')::text);
    perform pg_temp.ck('the concierge item stays off', 'false', (select active::text from public.catalog_items where id = v_it));
    perform pg_temp.ck('the concierge guard is read from the data and one attestation, switched by the CMO', 'cmo', (select switch_role from public.go_live_guards where key = 'concierge_coordinator_enabled'));
  end;
  perform pg_temp.ck('the admin catalogue shows the audience', 'institution',
    pg_temp.q_as(v_admin, $q$select (select e->>'audience' from jsonb_array_elements(public.admin_catalogue()->'items') e where e->>'code' = 'concierge_coordinator_per_life')$q$));
end $$;

-- 14. RLS per role: each table is closed to every role that must not read or write it ----------------------------------------------
do $$
declare t text; v_pat uuid := pg_temp.f('pat'); v_clin uuid := pg_temp.f('clin'); v_admin uuid := pg_temp.f('admin'); v_bad integer := 0; r text; who text; u uuid;
begin
  foreach t in array array['pricing_config', 'price_books', 'price_book_entries', 'discount_codes', 'discount_redemptions', 'discount_code_attempts'] loop
    foreach who in array array['patient', 'clinician', 'admin'] loop
      u := case who when 'patient' then v_pat when 'clinician' then v_clin else v_admin end;
      r := pg_temp.try_as(u, format('select count(*) from public.%I', t));
      perform pg_temp.ck(format('%s cannot read %s directly', who, t), 'true', (r like '%permission denied%')::text);
      r := pg_temp.try_as(u, format('delete from public.%I', t));
      perform pg_temp.ck(format('%s cannot delete from %s directly', who, t), 'true', (r like '%permission denied%')::text);
    end loop;
    perform pg_temp.ck(format('anon cannot read %s', t), '42501', pg_temp.try_anon(format('select count(*) from public.%I', t)));
    perform pg_temp.ck(format('RLS is on for %s', t), 'true', (select relrowsecurity::text from pg_class where oid = ('public.' || t)::regclass));
  end loop;
  perform pg_temp.ck('a patient cannot read the pricing overview', 'true', (pg_temp.q_as(v_pat, 'select public.admin_pricing_overview()::text') like '%pricing_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot read the pricing overview', 'true', (pg_temp.q_as(v_clin, 'select public.admin_pricing_overview()::text') like '%pricing_not_authorised%')::text);
  perform pg_temp.ck('anon cannot call the pricing overview', '42501', pg_temp.try_anon('select public.admin_pricing_overview()'));
  perform pg_temp.ck('an admin reads the overview through the audited function', 'true',
    (pg_temp.q_as(v_admin, 'select public.admin_pricing_overview()::text') like '%"rules_version": 1%')::text);
  perform pg_temp.ck('the overview never counts test redemptions as real use', '0',
    (select coalesce(sum((e ->> 'used')::int), 0)::text from jsonb_array_elements(pg_temp.q_as(v_admin, 'select (public.admin_pricing_overview() -> ''codes'')::text')::jsonb) e));
  perform pg_temp.ck('and sees none of another buyer''s orders', '0',
    pg_temp.q_as(v_pat, $q$select count(*)::text from public.orders where buyer_profile_id <> auth.uid() and beneficiary_patient_id <> auth.uid()$q$));
  perform pg_temp.ck('no function from this migration is executable by anon', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('price_quote', 'create_order', 'catalogue_item', 'admin_create_price_book', 'admin_set_price_book_entry', 'admin_set_price_book_status',
                                                   'admin_create_discount_code', 'admin_set_discount_code_status', 'admin_pricing_overview', 'set_item_price', 'set_catalog_item_active', 'admin_catalogue', 'catalogue')
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.ck('the private quote function is not executable by a signed-in patient directly', 'false', has_function_privilege('authenticated', 'private.price_quote_calc(uuid,uuid,text,text,boolean)', 'EXECUTE')::text);
end $$;

-- 15. SABOTAGE: three protections removed; each check must flip -------------------------------------------------------------------
-- (a) the trigger that redeems a code and spends points when an order is paid
drop trigger orders_pricing_effects on public.orders;
-- (b) the guess limit
create or replace function private.discount_tries_left(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
-- (c) the arithmetic check on an order
alter table public.orders drop constraint orders_pricing_adds_up;

do $$
declare v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'sabot', 'patient'); v_o jsonb; v_id uuid; v_ref text; v_g uuid := pg_temp.mkuser(pg_temp.f('org'), 'sabotg', 'patient'); i integer; r text;
        v_bal integer; v_state text;
begin
  -- (a) pay an order that uses a code: with the trigger gone the use stays 'reserved'
  v_o := pg_temp.mk(v_p, 'proof_consult', 'fixed1000')::jsonb;
  v_id := (v_o ->> 'order_id')::uuid; v_ref := v_o ->> 'reference';
  perform pg_temp.pay(v_ref, 400000);
  select state into v_state from public.discount_redemptions where order_id = v_id;
  insert into results values ('sabotaged', 'a paid order makes its code use redeemed', 'redeemed', v_state);
  -- (b) the eleventh wrong try is still checked instead of being turned away
  for i in 1..11 loop r := (pg_temp.mk(v_g, 'proof_consult', 'SABOT' || lpad(i::text, 3, '0'))::jsonb) ->> 'error'; end loop;
  insert into results values ('sabotaged', 'the eleventh wrong try is rate limited', 'discount_code_rate_limited', r);
  -- (c) an order that adds up to more than its list price can now be written
  insert into results values ('sabotaged', 'an order that charges more than the list price is refused by the database', 'refused',
    case when pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, list_amount_kobo, discount_kobo)
        select organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, 500000, 'tho_sabotage00000000000000000001', 500000, 100000 from public.orders where id = %L$q$, v_id)) like '%orders_pricing_adds_up%' then 'refused' else 'accepted' end);
end $$;

do $$
declare v_bad integer; v_caught integer; v_real integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S73 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_real from results where phase = 'real';
  if v_real < 150 then raise exception 'VACUOUS TEST: only % checks ran', v_real; end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
