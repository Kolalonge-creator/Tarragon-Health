-- Two-tier pricing proof (migration *_two_tier_membership_pricing.sql).
-- Proves in one rolled-back transaction:
--   * the individual 120,000 naira price is a NEW row in force from the apply instant, the 100,000 row closed (never in force again);
--     an effective price cannot be deleted, edited or reopened
--   * the organisation price defaults to 100,000 naira flat for every organisation, has no volume tiers, can be set per organisation
--     by an admin only (reason, audit row, old row closed), and a floor and ceiling refuse 1 naira and an absurd amount, in the RPC and
--     at the table
--   * module off: a benefit package cannot grant Membership and a claim creates no seat; module on: a claim makes one seat (no order,
--     no payment), billed to the organisation at the price of that day, snapshotted, plus a Member row; a replay makes no second seat;
--     an employee who is already a Member is not billed; leaving the roster ends the seat
--   * seats are invoiced once by finance, a void releases them; an employer admin sees counts and money, never a person (I9)
--   * checkout stays dormant: v5_checkout off, the Membership item off
-- SABOTAGE: the floor/ceiling check removed, and the module gate removed from the claim trigger; both checks must flip.
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
create function pg_temp.owner_try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'tt-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'TT ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- claim a roster row for a patient the way the platform does: the row is created pending, then claimed
create function pg_temp.claim(p_org uuid, p_pkg uuid, p_patient uuid) returns uuid language plpgsql as
$f$ declare r uuid;
begin
  insert into public.employer_roster_members (organisation_id, phone, full_name, benefit_package_id, status)
  values (p_org, (select phone from public.profiles where id = p_patient), 'TT roster', p_pkg, 'pending') returning id into r;
  update public.employer_roster_members set status = 'claimed', claimed_profile_id = p_patient, claimed_at = now() where id = r;
  return r;
end $f$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_item uuid; v_a uuid; v_b uuid;
begin
  select organisation_id, id into v_org, v_item from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('item', v_item);
  perform pg_temp.setf('admin', pg_temp.mkuser(v_org, 'admin', 'admin'));
  insert into public.organisations (name, type) values ('TT Employer A', 'corporate') returning id into v_a;
  insert into public.organisations (name, type) values ('TT Employer B', 'corporate') returning id into v_b;
  perform pg_temp.setf('orgA', v_a);
  perform pg_temp.setf('orgB', v_b);
  perform pg_temp.setf('corpA', pg_temp.mkuser(v_a, 'corpA', 'corporate_admin'));
  perform pg_temp.setf('p1', pg_temp.mkuser('00000000-0000-0000-0000-000000000001', 'p1', 'patient'));
  perform pg_temp.setf('p2', pg_temp.mkuser('00000000-0000-0000-0000-000000000001', 'p2', 'patient'));
  perform pg_temp.setf('p3', pg_temp.mkuser('00000000-0000-0000-0000-000000000001', 'p3', 'patient'));
  perform pg_temp.setf('p4', pg_temp.mkuser('00000000-0000-0000-0000-000000000001', 'p4', 'patient'));
end $$;

-- 1. The individual price: 120,000 in force, the 100,000 row closed and never in force again ------------------------------
do $$
declare v_item uuid := pg_temp.f('item'); v_p1 uuid := pg_temp.f('p1'); r_new public.prices%rowtype; r_old public.prices%rowtype;
begin
  select * into r_new from public.prices where catalog_item_id = v_item and amount_kobo = 12000000;
  select * into r_old from public.prices where catalog_item_id = v_item and amount_kobo = 10000000;
  perform pg_temp.ck('the price in force today is 120,000 naira (12,000,000 kobo)', '12000000', (select amount_kobo::text from private.current_price(v_item)));
  perform pg_temp.ck('the 100,000 row is closed, not edited, and still reads 10,000,000', 'closed', case when r_old.valid_to is not null then 'closed' else 'open' end);
  perform pg_temp.ck('the 120,000 row starts the instant the 100,000 row stops (no gap, no overlap)', 'true', (r_old.valid_to = r_new.valid_from)::text);
  perform pg_temp.ck('the 120,000 row is open-ended and starts in the past, not parked', 'true', (r_new.valid_to is null and r_new.valid_from <= now())::text);
  perform pg_temp.ck('the 100,000 price is in force at no moment from now on', '0',
    (select count(*)::text from public.prices where catalog_item_id = v_item and amount_kobo = 10000000 and (valid_to is null or valid_to > now())));
  perform pg_temp.ck('an effective price cannot be deleted', 'price_immutable', pg_temp.owner_try(format('delete from public.prices where catalog_item_id = %L and valid_from <= now()', v_item)));
  perform pg_temp.ck('an effective price cannot be edited', 'price_immutable', pg_temp.owner_try(format('update public.prices set amount_kobo = 1 where catalog_item_id = %L and valid_from <= now()', v_item)));
  perform pg_temp.ck('and the old row cannot be reopened', 'price_immutable', pg_temp.owner_try(format('update public.prices set valid_to = null where catalog_item_id = %L and amount_kobo = 10000000', v_item)));
  perform pg_temp.ck('the catalogue shop window stays closed (module off)', '[]', pg_temp.q_as(v_p1, 'select public.catalogue()::text'));
  perform pg_temp.ck('checkout stays dormant: module off', 'false', (select is_enabled::text from public.platform_modules where key = 'v5_checkout'));
  perform pg_temp.ck('checkout stays dormant: the Membership item is off', 'false', (select active::text from public.catalog_items where id = v_item));
end $$;

-- 2. The organisation price ------------------------------------------------------------------------------------------------
do $$
declare v_item uuid := pg_temp.f('item'); v_admin uuid := pg_temp.f('admin'); v_p1 uuid := pg_temp.f('p1'); v_corp uuid := pg_temp.f('corpA');
        a uuid := pg_temp.f('orgA'); b uuid := pg_temp.f('orgB'); r text;
begin
  perform pg_temp.ck('every organisation pays 100,000 naira by default', '10000000/10000000',
    (select amount_kobo::text from private.organisation_member_price(a, v_item)) || '/' || (select amount_kobo::text from private.organisation_member_price(b, v_item)));
  perform pg_temp.ck('there is exactly one default row and no volume tiers', '1/1',
    (select count(*)::text from public.organisation_member_prices where catalog_item_id = v_item) || '/' ||
    (select count(*)::text from public.organisation_member_prices where catalog_item_id = v_item and employer_organisation_id is null));
  perform pg_temp.ck('the limits are 50,000 to 200,000 naira', '5000000/20000000',
    (select (rules ->> 'min_kobo') || '/' || (rules ->> 'max_kobo') from public.organisation_price_limits where is_active));
  perform pg_temp.ck('a patient cannot set an organisation price', 'true',
    (pg_temp.q_as(v_p1, format($q$select public.set_organisation_member_price(%L, 11000000, 'Patient trying to set a price')::text$q$, a)) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('an employer admin cannot set its own price', 'true',
    (pg_temp.q_as(v_corp, format($q$select public.set_organisation_member_price(%L, 5000000, 'Employer trying a discount here')::text$q$, a)) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('anon cannot set an organisation price', '42501', pg_temp.try_anon(format($q$select public.set_organisation_member_price(%L, 11000000, 'Anonymous attempt here')$q$, a)));
  perform pg_temp.ck('a reason is needed', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 11000000, 'short')::text$q$, a)) like '%catalogue_reason_needed%')::text);
  perform pg_temp.ck('1 naira (100 kobo) is refused', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 100, 'A typo that must not land')::text$q$, a)) like '%organisation_price_out_of_range%')::text);
  perform pg_temp.ck('10,000,000 naira is refused', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 1000000000, 'A typo that must not land')::text$q$, a)) like '%organisation_price_out_of_range%')::text);
  perform pg_temp.ck('just under the floor is refused', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 4999999, 'Just under the floor')::text$q$, a)) like '%organisation_price_out_of_range%')::text);
  perform pg_temp.ck('just over the ceiling is refused', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 20000001, 'Just over the ceiling')::text$q$, a)) like '%organisation_price_out_of_range%')::text);
  perform pg_temp.ck('the table refuses an out-of-range price from any writer', 'organisation_price_out_of_range',
    pg_temp.owner_try(format('insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, reason) values (%L, %L, %L, 100, now() + interval ''1 year'', ''direct insert attempt'')', pg_temp.f('org'), b, v_item)));
  perform pg_temp.ck('a price for something that is not an employer is refused', 'organisation_price_unknown_organisation',
    pg_temp.owner_try(format('insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, reason) values (%L, %L, %L, 9000000, now() + interval ''1 year'', ''direct insert attempt'')', pg_temp.f('org'), pg_temp.f('org'), v_item)));
  perform pg_temp.ck('the admin sets 90,000 naira for employer A', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 9000000, 'Negotiated for a large employer', now() - interval '3 hours')::text$q$, a)) !~ '^ERR:')::text);
  perform pg_temp.ck('employer A now pays 90,000', '9000000', (select amount_kobo::text from private.organisation_member_price(a, v_item)));
  perform pg_temp.ck('employer B is unchanged at 100,000', '10000000', (select amount_kobo::text from private.organisation_member_price(b, v_item)));
  perform pg_temp.ck('the change was audited with a reason', '1', (select count(*)::text from public.audit_log where action = 'catalogue.organisation_price_set' and event ->> 'reason' = 'Negotiated for a large employer'));
  perform pg_temp.ck('the row records who set it', v_admin::text, (select created_by::text from public.organisation_member_prices where employer_organisation_id = a and valid_to is null));
  perform pg_temp.ck('a price row cannot be edited', 'price_immutable', pg_temp.owner_try(format('update public.organisation_member_prices set amount_kobo = 5000000 where employer_organisation_id = %L', a)));
  perform pg_temp.ck('a price row cannot be deleted', 'price_immutable', pg_temp.owner_try('delete from public.organisation_member_prices'));
  perform pg_temp.ck('a backdated change is refused', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 9500000, 'Backdated by mistake here', now() - interval '1 day')::text$q$, a)) like '%price_start_before_current%')::text);
  perform pg_temp.ck('the admin page data lists both organisations with the price each pays', '9000000/override|10000000/default',
    (select string_agg((o ->> 'amount_kobo') || '/' || (o ->> 'source'), '|' order by o ->> 'name') from jsonb_array_elements(
       (pg_temp.q_as(v_admin, 'select public.admin_organisation_prices()::text')::jsonb) -> 'organisations') o where o ->> 'name' like 'TT Employer %'));
  perform pg_temp.ck('only an admin can read the admin page data', 'true',
    (pg_temp.q_as(v_corp, 'select public.admin_organisation_prices()::text') like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('employer A staff can see its own price and counts', '9000000/override/0',
    pg_temp.q_as(v_corp, format($q$select (s ->> 'price_kobo') || '/' || (s ->> 'price_source') || '/' || (s ->> 'active_seats') from (select public.organisation_seat_summary(%L) s) x$q$, a)));
  perform pg_temp.ck('employer A staff cannot ask about employer B', 'true',
    (pg_temp.q_as(v_corp, format($q$select public.organisation_seat_summary(%L)::text$q$, b)) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('clearing the override returns employer A to the default', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.clear_organisation_member_price(%L, 'Back to the flat price now', now() - interval '2 hours')::text$q$, a)) !~ '^ERR:')::text);
  perform pg_temp.ck('employer A pays 100,000 again', '10000000', (select amount_kobo::text from private.organisation_member_price(a, v_item)));
end $$;

-- 3. Seats: module off, then on -----------------------------------------------------------------------------------------
do $$
declare v_item uuid := pg_temp.f('item'); v_admin uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); b uuid := pg_temp.f('orgB');
        p1 uuid := pg_temp.f('p1'); p2 uuid := pg_temp.f('p2'); p3 uuid := pg_temp.f('p3'); v_pkg uuid; v_roster uuid; v_roster2 uuid; v_ent uuid;
begin
  perform pg_temp.ck('the organisation module starts off', 'false', (select is_enabled::text from public.platform_modules where key = 'organisation_membership'));
  perform pg_temp.ck('a Membership benefit package cannot be created while the module is off', 'true',
    (pg_temp.owner_try(format('insert into public.employer_benefit_packages (organisation_id, name, catalog_item_id) values (%L, ''Standard'', %L)', a, v_item)) like '%organisation_membership_not_open%')::text);
  perform pg_temp.ck('a package with no grant at all is refused', 'true',
    (pg_temp.owner_try(format('insert into public.employer_benefit_packages (organisation_id, name) values (%L, ''Nothing'')', a)) <> 'ok')::text);

  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'two-tier proof run' where key = 'organisation_membership';
  insert into public.employer_benefit_packages (organisation_id, name, catalog_item_id) values (a, 'Standard', v_item) returning id into v_pkg;
  perform pg_temp.setf('pkg', v_pkg);

  v_roster := pg_temp.claim(a, v_pkg, p1);
  perform pg_temp.setf('roster1', v_roster);
  perform pg_temp.ck('a claimed employee gets exactly one seat', '1', (select count(*)::text from public.entitlements where roster_member_id = v_roster and state = 'active'));
  select id into v_ent from public.entitlements where roster_member_id = v_roster;
  perform pg_temp.setf('ent1', v_ent);
  perform pg_temp.ck('the seat has no order and no payment: nobody paid by card', '0/0',
    (select count(*)::text from public.orders where beneficiary_patient_id = p1) || '/' || (select count(*)::text from public.payments pm join public.orders o on o.id = pm.order_id where o.beneficiary_patient_id = p1));
  perform pg_temp.ck('the seat is billed to the organisation at 100,000 naira', a::text || '/10000000',
    (select billed_to_organisation_id::text || '/' || seat_price_kobo::text from public.entitlements where id = v_ent));
  perform pg_temp.ck('the seat is a 365 day Membership', '365/membership',
    (select round(extract(epoch from ends_at - starts_at) / 86400)::int::text || '/' || kind from public.entitlements where id = v_ent));
  perform pg_temp.ck('the employee is a Member through the employer', 'true/employer',
    private.patient_is_member(p1)::text || '/' || (select source from public.patient_memberships where patient_id = p1 and state = 'active'));
  update public.employer_roster_members set eligible_until = null, benefit_package_id = v_pkg where id = v_roster;
  perform pg_temp.ck('a replay of the claim makes no second seat', '1', (select count(*)::text from public.entitlements where roster_member_id = v_roster));

  perform pg_temp.ck('admin sets employer A to 95,000 naira', 'true',
    (pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 9500000, 'Mid-year change in the proof run', now() - interval '1 hour')::text$q$, a)) !~ '^ERR:')::text);
  perform pg_temp.ck('the existing seat keeps the price it was made at', '10000000', (select seat_price_kobo::text from public.entitlements where id = v_ent));
  v_roster2 := pg_temp.claim(a, v_pkg, p2);
  perform pg_temp.ck('the next seat pays the new price', '9500000', (select seat_price_kobo::text from public.entitlements where roster_member_id = v_roster2));

  insert into public.patient_memberships (organisation_id, patient_id, source, ends_at, granted_by, grant_reason, is_test)
  values ('00000000-0000-0000-0000-000000000001', p3, 'granted', now() + interval '30 days', v_admin, 'Already a Member in the proof run', true);
  insert into public.employer_benefit_packages (organisation_id, name, catalog_item_id) values (b, 'Standard', v_item) returning id into v_pkg;
  perform pg_temp.claim(b, v_pkg, p3);
  perform pg_temp.ck('an employee who is already a Member is not billed to the organisation', '0',
    (select count(*)::text from public.entitlements where patient_id = p3 and billed_to_organisation_id is not null));
  perform pg_temp.ck('and they keep their own Membership', 'granted', (select source from public.patient_memberships where patient_id = p3 and state = 'active'));
  perform pg_temp.ck('the roster row is marked already_member', 'already_member',
    (select seat_state from public.employer_roster_members where claimed_profile_id = p3));
  perform pg_temp.ck('the employer is told a count only: 1 employee already has their own Membership', '1',
    pg_temp.q_as(v_admin, format($q$select (public.organisation_seat_summary(%L)) ->> 'already_member_count'$q$, b)));
  perform pg_temp.ck('the sweep does not bill the organisation while the person still holds their own', '0',
    private.activate_pending_org_seats()::text);
  -- their own Membership ends: the organisation's seat starts, once
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Ended in the proof run' where patient_id = p3 and state = 'active';
  perform pg_temp.ck('once their own Membership has ended the sweep starts the organisation seat', '1', private.activate_pending_org_seats()::text);
  perform pg_temp.ck('the sweep is idempotent', '0', private.activate_pending_org_seats()::text);
  perform pg_temp.ck('and the roster row now says seat, billed to employer B', 'seat/' || b::text,
    (select r.seat_state || '/' || e.billed_to_organisation_id::text from public.employer_roster_members r join public.entitlements e on e.roster_member_id = r.id where r.claimed_profile_id = p3));

  -- an employee sees their entitlement but never what the organisation pays
  perform pg_temp.ck('an employee reads their own seat state', 'active', pg_temp.q_as(p1, 'select state from public.entitlements where roster_member_id is not null limit 1'));
  perform pg_temp.ck('an employee cannot read the seat price', 'true', (pg_temp.q_as(p1, 'select seat_price_kobo::text from public.entitlements limit 1') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('an employee cannot read who is billed', 'true', (pg_temp.q_as(p1, 'select billed_to_organisation_id::text from public.entitlements limit 1') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('an employee cannot read the invoice link', 'true', (pg_temp.q_as(p1, 'select invoice_id::text from public.entitlements limit 1') like 'ERR:%permission denied%')::text);

  -- the 7 day "buy a new one" reminder never goes to a seat or a Membership
  update public.entitlements set ends_at = now() + interval '3 days', starts_at = now() - interval '1 day' where id = v_ent;
  perform pg_temp.ck('no purchase reminder is queued for an employer-paid seat ending in 3 days', '0', private.queue_entitlement_expiry_reminders()::text);

  perform pg_temp.ck('seats of test accounts are never billed or counted (INV-13)', '0/0',
    pg_temp.q_as(pg_temp.f('corpA'), format($q$select (s ->> 'active_seats') || '/' || (s ->> 'uninvoiced_kobo') from (select public.organisation_seat_summary(%L) s) x$q$, a)));
  update public.entitlements set is_test = false where billed_to_organisation_id = a;
  perform pg_temp.ck('employer A sees 2 active seats and 19,500,000 kobo uninvoiced', '2/19500000',
    pg_temp.q_as(pg_temp.f('corpA'), format($q$select (s ->> 'active_seats') || '/' || (s ->> 'uninvoiced_kobo') from (select public.organisation_seat_summary(%L) s) x$q$, a)));
  perform pg_temp.ck('the employer admin cannot read a single entitlement row', '0',
    pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.entitlements'));
  perform pg_temp.ck('the employer admin cannot read the price table directly', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.organisation_member_prices') like 'ERR:%permission denied%')::text);
end $$;

-- 4. Invoices ------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); v_inv uuid; r text;
begin
  perform pg_temp.ck('the employer admin cannot generate an invoice', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.generate_organisation_membership_invoice(%L, current_date - 30, current_date)::text$q$, a)) like '%not authorised%')::text);
  r := pg_temp.q_as(v_admin, format($q$select public.generate_organisation_membership_invoice(%L, current_date - 30, current_date)::text$q$, a));
  perform pg_temp.ck('the invoice call itself succeeds', 'true', (r !~ '^ERR:')::text);
  perform pg_temp.ck('finance generates one invoice for the two seats', '2/19500000/per_active_member',
    (select headcount_basis::text || '/' || amount_kobo::text || '/' || billing_model::text from public.employer_invoices where organisation_id = a));
  select id into v_inv from public.employer_invoices where organisation_id = a;
  perform pg_temp.ck('a mixed-price invoice records no single rate', 'null', coalesce((select rate_kobo::text from public.employer_invoices where id = v_inv), 'null'));
  perform pg_temp.ck('both seats are tied to the invoice', '2', (select count(*)::text from public.entitlements where invoice_id = v_inv));
  perform pg_temp.ck('invoicing twice bills nothing again', 'true', (pg_temp.q_as(v_admin, format($q$select public.generate_organisation_membership_invoice(%L, current_date - 30, current_date)::text$q$, a)) like '%no_uninvoiced_seats%')::text);
  update public.employer_invoices set status = 'void', void_reason = 'proof run' where id = v_inv;
  perform pg_temp.ck('voiding the invoice frees the seats to be billed again', '2/0',
    (select count(*) filter (where invoice_id is null)::text || '/' || count(*) filter (where invoice_id is not null)::text from public.entitlements where billed_to_organisation_id = a));
end $$;

-- 5. Leaving the roster --------------------------------------------------------------------------------------------------
do $$
declare p1 uuid := pg_temp.f('p1');
begin
  update public.employer_roster_members set status = 'departed', departed_at = now() where id = pg_temp.f('roster1');
  perform pg_temp.ck('a departed employee loses the seat', 'revoked', (select state from public.entitlements where id = pg_temp.f('ent1')));
  perform pg_temp.ck('and is no longer a Member through the employer', 'false', private.patient_is_member(p1)::text);
end $$;

-- 6. Checkout still dormant at the end ----------------------------------------------------------------------------------
do $$ begin
  perform pg_temp.ck('v5_checkout is still off', 'false', (select is_enabled::text from public.platform_modules where key = 'v5_checkout'));
  perform pg_temp.ck('the Membership item is still off', 'false', (select active::text from public.catalog_items where id = pg_temp.f('item')));
end $$;

-- 7. The default price moves for everyone without their own, by an admin only, inside the band ------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); b uuid := pg_temp.f('orgB'); v_item uuid := pg_temp.f('item');
begin
  perform pg_temp.ck('a patient cannot change the default organisation price', 'true',
    (pg_temp.q_as(pg_temp.f('p1'), $q$select public.set_default_organisation_member_price(10500000, 'Patient trying the default')::text$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('the default cannot be set to 1 naira either', 'true',
    (pg_temp.q_as(v_admin, $q$select public.set_default_organisation_member_price(100, 'A typo that must not land')::text$q$) like '%organisation_price_out_of_range%')::text);
  perform pg_temp.ck('an admin moves the default to 105,000 naira', 'true',
    (pg_temp.q_as(v_admin, $q$select public.set_default_organisation_member_price(10500000, 'Founder changed the flat price in the proof')::text$q$) !~ '^ERR:')::text);
  perform pg_temp.ck('employer B, with no price of its own, now pays 105,000', '10500000', (select amount_kobo::text from private.organisation_member_price(b, v_item)));
  perform pg_temp.ck('and exactly one default row is open', '1',
    (select count(*)::text from public.organisation_member_prices where catalog_item_id = v_item and employer_organisation_id is null and valid_to is null));
end $$;

-- SABOTAGE 1: remove the floor and ceiling from the table guard; a 1 naira price must now be accepted
create or replace function private.organisation_member_prices_guard() returns trigger language plpgsql set search_path = '' as $$
begin return new; end $$;
do $$
declare r text;
begin
  r := pg_temp.owner_try(format('insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, reason) values (%L, %L, %L, 100, now() + interval ''2 years'', ''sabotage insert here'')', pg_temp.f('org'), pg_temp.f('orgB'), pg_temp.f('item')));
  insert into results values ('sabotaged', 'a 1 naira price is refused at the table', 'organisation_price_out_of_range', r);
end $$;

-- SABOTAGE 2: remove the module gate from the seat function; a claim with the module off must now create a seat
do $$
declare d text;
begin
  d := replace(pg_get_functiondef('private.grant_org_seat'::regproc),
    $s$if not coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false) then$s$, 'if false then');
  if d = pg_get_functiondef('private.grant_org_seat'::regproc) then raise exception 'VACUOUS TEST: sabotage text not found'; end if;
  execute d;
  update public.platform_modules set is_enabled = false where key = 'organisation_membership';
  perform pg_temp.claim(pg_temp.f('orgA'), pg_temp.f('pkg'), pg_temp.f('p4'));
  insert into results values ('sabotaged', 'with the module off a claim creates no seat', '0',
    (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p4') and state = 'active' and roster_member_id is not null));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'two-tier pricing proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
