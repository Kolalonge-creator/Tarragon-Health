-- Employer seat pilot kit proof (migration *_employer_seat_pilot_kit.sql, docs/design/EMP.md).
-- Proves in one rolled-back transaction:
--   * create: finance only; seat count, window, employer and package guards; the price is a snapshot of the organisation price; one live
--     pilot per employer; terms frozen after creation; the employer cannot write its pilot and another employer cannot read it
--   * before payment nobody gets a seat (waiting_payment); invoice issued once (idempotent); payment confirmed by finance only, with a
--     method and a reference; a replay changes nothing; a different reference is refused; people who claimed while unpaid get their
--     seat on activation; the arrears generator finds nothing to bill (a pilot seat is never billed twice)
--   * the purchased count is a hard cap (the last seat cannot be taken twice), a departed employee's seat is not reusable, an ended
--     pilot and a window that has not opened both grant nothing, and say so on the roster row; cancel voids an unpaid invoice and puts
--     the employer back on arrears billing
--   * the report is AGGREGATE ONLY (I9): closed key set, no person id in the output, a minimum cell, complementary suppression,
--     rounding, test accounts excluded, the employer reads its own report only, and an employer admin cannot read a single
--     encounter, reading or entitlement row (with a control: platform admin can)
-- SABOTAGE: complementary suppression removed, the minimum-group gate removed, the report's employer scope widened, and the seat cap
-- removed. Each must flip.
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
  values (v, 'ep-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'EP ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.claim(p_org uuid, p_pkg uuid, p_patient uuid) returns uuid language plpgsql as
$f$ declare r uuid;
begin
  insert into public.employer_roster_members (organisation_id, phone, full_name, benefit_package_id, status)
  values (p_org, (select phone from public.profiles where id = p_patient), 'EP roster', p_pkg, 'pending') returning id into r;
  update public.employer_roster_members set status = 'claimed', claimed_profile_id = p_patient, claimed_at = now() where id = r;
  return r;
end $f$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
-- every key name anywhere in a jsonb value, in byte order
create function pg_temp.all_keys(j jsonb) returns text language sql as $$
  select string_agg(distinct key, ',' order by key collate "C")
    from (select jsonb_object_keys(v) as key from jsonb_path_query(j, 'strict $.**') v where jsonb_typeof(v) = 'object') s
$$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_item uuid; a uuid; b uuid; c uuid; d uuid; i integer;
begin
  select organisation_id, id into v_org, v_item from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('item', v_item);
  perform pg_temp.setf('admin', pg_temp.mkuser(v_org, 'admin', 'admin'));
  perform pg_temp.setf('clin', pg_temp.mkuser(v_org, 'clin', 'clinician'));
  insert into public.organisations (name, type) values ('EP Employer A', 'corporate') returning id into a;
  insert into public.organisations (name, type) values ('EP Employer B', 'corporate') returning id into b;
  insert into public.organisations (name, type) values ('EP Employer C', 'corporate') returning id into c;
  insert into public.organisations (name, type) values ('EP Not An Employer Account', 'corporate') returning id into d;
  insert into public.employer_accounts (organisation_id) values (a), (b), (c);
  perform pg_temp.setf('orgA', a); perform pg_temp.setf('orgB', b); perform pg_temp.setf('orgC', c); perform pg_temp.setf('orgD', d);
  update public.organisations set min_cohort_size = 5 where id = a;
  -- the platform floor is 20 in production (S75a); the fixtures use 12 members, so the platform number is lowered to 5 for this transaction only
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '5') where is_active;
  perform pg_temp.setf('corpA', pg_temp.mkuser(a, 'corpA', 'corporate_admin'));
  perform pg_temp.setf('corpB', pg_temp.mkuser(b, 'corpB', 'corporate_admin'));
  for i in 1..20 loop
    perform pg_temp.setf('p' || i, pg_temp.mkuser('00000000-0000-0000-0000-000000000001', 'p' || i, 'patient'));
  end loop;
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pg_temp.f('admin'), activation_note = 'seat pilot proof run' where key = 'organisation_membership';
  insert into public.employer_benefit_packages (organisation_id, name, catalog_item_id) values (a, 'Standard', v_item) returning id into d;
  perform pg_temp.setf('pkgA', d);
  insert into public.employer_benefit_packages (organisation_id, name, catalog_item_id) values (b, 'Standard', v_item) returning id into d;
  perform pg_temp.setf('pkgB', d);
  insert into public.employer_benefit_packages (organisation_id, name, catalog_item_id) values (c, 'Standard', v_item) returning id into d;
  perform pg_temp.setf('pkgC', d);
end $$;

-- 1. Creating a pilot ----------------------------------------------------------------------------------------------------
do $$
declare adm uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); pkg uuid := pg_temp.f('pkgA'); r text; v_pilot uuid;
        t date := pg_temp.today();
begin
  perform pg_temp.ck('the module is on for this proof only', 'true', (select is_enabled::text from public.platform_modules where key = 'organisation_membership'));
  perform pg_temp.ck('an employer admin cannot create a pilot for itself', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')::text$q$, a, pkg, t, t + 30)) like '%pilot_not_authorised%')::text);
  perform pg_temp.ck('a patient cannot create a pilot', 'true',
    (pg_temp.q_as(pg_temp.f('p1'), format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')::text$q$, a, pkg, t, t + 30)) like '%pilot_not_authorised%')::text);
  perform pg_temp.ck('anon cannot create a pilot', '42501',
    pg_temp.try_anon(format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')$q$, a, pkg, t, t + 30)));
  perform pg_temp.ck('zero seats is refused', 'true', (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 0, %L, %L, 'terms-v0')::text$q$, a, pkg, t, t + 30)) like '%pilot_seat_count_out_of_range%')::text);
  perform pg_temp.ck('501 seats is refused (the configured maximum is 500)', 'true', (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 501, %L, %L, 'terms-v0')::text$q$, a, pkg, t, t + 30)) like '%pilot_seat_count_out_of_range%')::text);
  perform pg_temp.ck('a window that starts in the past is refused', 'true', (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')::text$q$, a, pkg, t - 1, t + 30)) like '%pilot_window_invalid%')::text);
  perform pg_temp.ck('a window longer than 120 days is refused', 'true', (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')::text$q$, a, pkg, t, t + 121)) like '%pilot_window_invalid%')::text);
  perform pg_temp.ck('an end before the start is refused', 'true', (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')::text$q$, a, pkg, t + 5, t + 2)) like '%pilot_window_invalid%')::text);
  perform pg_temp.ck('blank terms are refused', 'true', (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, '  ')::text$q$, a, pkg, t, t + 30)) like '%pilot_terms_version_needed%')::text);
  perform pg_temp.ck('an organisation with no employer account is refused', 'true',
    (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')::text$q$, pg_temp.f('orgD'), pkg, t, t + 30)) like '%pilot_unknown_employer%')::text);
  perform pg_temp.ck('another employer''s package is refused', 'true',
    (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v0')::text$q$, a, pg_temp.f('pkgB'), t, t + 30)) like '%pilot_needs_membership_package%')::text);

  r := pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 12, %L, %L, 'terms-v1', true)::text$q$, a, pkg, t, t + 30));
  perform pg_temp.ck('finance creates a 12 seat pilot', 'true', (r !~ '^ERR:')::text);
  v_pilot := r::uuid;
  perform pg_temp.setf('pilotA', v_pilot);
  perform pg_temp.ck('it starts as a draft with the organisation price snapshotted: 12 x 10,000,000 = 120,000,000 kobo', 'draft/10000000/120000000',
    (select state || '/' || seat_price_kobo || '/' || total_kobo from public.employer_seat_pilots where id = v_pilot));
  perform pg_temp.ck('creation is audited', '1', (select count(*)::text from public.audit_log where action = 'employer_seat_pilot.created' and entity_id = v_pilot));
  perform pg_temp.ck('a second live pilot for the same employer is refused', 'true',
    (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 5, %L, %L, 'terms-v1')::text$q$, a, pkg, t, t + 30)) like '%employer_seat_pilots_one_live_per_org%')::text);
  perform pg_temp.ck('the seat count is frozen once created', 'pilot_terms_frozen', pg_temp.owner_try(format('update public.employer_seat_pilots set seats_purchased = 99, total_kobo = 990000000 where id = %L', v_pilot)));
  perform pg_temp.ck('the price is frozen once created', 'pilot_terms_frozen', pg_temp.owner_try(format('update public.employer_seat_pilots set seat_price_kobo = 1, total_kobo = 12 where id = %L', v_pilot)));
  perform pg_temp.ck('a pilot cannot jump from draft to active', 'pilot_state_transition_not_allowed', pg_temp.owner_try(format($q$update public.employer_seat_pilots set state = 'active' where id = %L$q$, v_pilot)));
  perform pg_temp.ck('a pilot cannot be deleted', 'true', (pg_temp.owner_try(format('delete from public.employer_seat_pilots where id = %L', v_pilot)) like '%pilot_not_deletable%')::text);
  perform pg_temp.ck('the employer admin can read its own pilot', '1', pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.employer_seat_pilots'));
  perform pg_temp.ck('another employer''s admin reads none', '0', pg_temp.q_as(pg_temp.f('corpB'), 'select count(*)::text from public.employer_seat_pilots'));
  perform pg_temp.ck('a patient reads none', '0', pg_temp.q_as(pg_temp.f('p1'), 'select count(*)::text from public.employer_seat_pilots'));
  perform pg_temp.ck('the employer admin cannot edit its pilot', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), format($q$update public.employer_seat_pilots set state = 'cancelled' where id = %L$q$, v_pilot)) like 'ERR:%permission denied%')::text);
  update public.platform_modules set is_enabled = false where key = 'organisation_membership';
  perform pg_temp.ck('with the module off a pilot cannot be created', 'true',
    (pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 5, %L, %L, 'terms-v9')::text$q$, pg_temp.f('orgB'), pg_temp.f('pkgB'), t, t + 30)) like '%organisation_membership_not_open%')::text);
  perform pg_temp.ck('with the module off the invoice cannot be issued either', 'true',
    (pg_temp.q_as(adm, format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_pilot)) like '%organisation_membership_not_open%')::text);
  update public.platform_modules set is_enabled = true where key = 'organisation_membership';
  perform pg_temp.ck('nobody but the owner reads the config table', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.employer_seat_pilot_config') like 'ERR:%permission denied%')::text);
end $$;

-- 2. Claims before payment, invoice, payment -------------------------------------------------------------------------------
do $$
declare adm uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); pkg uuid := pg_temp.f('pkgA'); v_pilot uuid := pg_temp.f('pilotA');
        v_inv uuid; r text; r1 uuid; r2 uuid; v_contract uuid;
begin
  r1 := pg_temp.claim(a, pkg, pg_temp.f('p1'));
  r2 := pg_temp.claim(a, pkg, pg_temp.f('p2'));
  perform pg_temp.setf('roster1', r1);
  perform pg_temp.ck('before payment a claim gets no seat', '0', (select count(*)::text from public.entitlements where pilot_id = v_pilot or patient_id in (pg_temp.f('p1'), pg_temp.f('p2'))));
  perform pg_temp.ck('and the roster row says it is waiting for payment', 'waiting_payment/waiting_payment',
    (select string_agg(seat_state, '/') from public.employer_roster_members where id in (r1, r2)));
  perform pg_temp.ck('nobody is a Member yet', 'false/false', private.patient_is_member(pg_temp.f('p1'))::text || '/' || private.patient_is_member(pg_temp.f('p2'))::text);

  perform pg_temp.ck('payment cannot be confirmed before an invoice exists', 'true',
    (pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'bank_transfer', 'REF-0001')::text$q$, v_pilot)) like '%pilot_not_awaiting_payment%')::text);
  perform pg_temp.ck('an employer admin cannot issue the invoice', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_pilot)) like '%pilot_not_authorised%')::text);
  r := pg_temp.q_as(adm, format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_pilot));
  perform pg_temp.ck('finance issues the invoice', 'true', (r !~ '^ERR:')::text);
  v_inv := r::uuid;
  perform pg_temp.ck('the invoice is issued for the whole block in integer kobo, fixed contract, 12 seats', 'issued/120000000/fixed_contract/12/10000000',
    (select status::text || '/' || amount_kobo || '/' || billing_model::text || '/' || headcount_basis || '/' || rate_kobo from public.employer_invoices where id = v_inv));
  perform pg_temp.ck('issuing again returns the same invoice and makes no second', v_inv::text || '/1',
    pg_temp.q_as(adm, format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_pilot)) || '/' || (select count(*)::text from public.employer_invoices where organisation_id = a));
  perform pg_temp.ck('the pilot is now invoiced', 'invoiced', (select state from public.employer_seat_pilots where id = v_pilot));
  perform pg_temp.ck('an unpaid pilot invoice cannot be voided on its own either (the pilot would be stranded)', 'true',
    (pg_temp.q_as(adm, format($q$select public.employer_set_invoice_status(%L, 'void', 'Voiding it behind the pilot')::text$q$, v_inv)) like '%pilot_invoice_void_via_pilot_only%')::text);
  perform pg_temp.ck('the employer sees its invoice', '1', pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.employer_invoices'));

  perform pg_temp.ck('an employer admin cannot record a payment', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.confirm_employer_seat_pilot_payment(%L, 'bank_transfer', 'REF-0001')::text$q$, v_pilot)) like '%pilot_not_authorised%')::text);
  perform pg_temp.ck('a payment method that is not allowed is refused', 'true',
    (pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'cash', 'REF-0001')::text$q$, v_pilot)) like '%pilot_payment_method_invalid%')::text);
  perform pg_temp.ck('a one character reference is refused', 'true',
    (pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'bank_transfer', 'x')::text$q$, v_pilot)) like '%pilot_payment_reference_invalid%')::text);
  perform pg_temp.ck('nothing changed after the refusals', 'invoiced/issued',
    (select p.state || '/' || i.status::text from public.employer_seat_pilots p join public.employer_invoices i on i.id = p.invoice_id where p.id = v_pilot));

  r := pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'paystack_link', 'PSK-REF-1001')::text$q$, v_pilot));
  perform pg_temp.ck('finance records the payment: active and two waiting people granted', 'activated/2', (r::jsonb ->> 'result') || '/' || (r::jsonb ->> 'granted'));
  perform pg_temp.ck('the pilot is active and the invoice paid', 'active/paid',
    (select p.state || '/' || i.status::text from public.employer_seat_pilots p join public.employer_invoices i on i.id = p.invoice_id where p.id = v_pilot));
  perform pg_temp.ck('both people are Members through the employer', 'true/true/employer',
    private.patient_is_member(pg_temp.f('p1'))::text || '/' || private.patient_is_member(pg_temp.f('p2'))::text || '/' ||
    (select source from public.patient_memberships where patient_id = pg_temp.f('p1') and state = 'active'));
  perform pg_temp.ck('the seats carry the pilot, its price snapshot and its invoice (no order, no card payment)', '2/10000000/' || v_inv::text,
    (select count(*)::text || '/' || min(seat_price_kobo) || '/' || min(invoice_id::text) from public.entitlements where pilot_id = v_pilot));
  perform pg_temp.ck('and the roster rows say seat', 'seat/seat', (select string_agg(seat_state, '/') from public.employer_roster_members where id in (r1, r2)));

  r := pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'paystack_link', 'PSK-REF-1001')::text$q$, v_pilot));
  perform pg_temp.ck('confirming again with the same reference is a replay that changes nothing', 'replay/0/2',
    (r::jsonb ->> 'result') || '/' || (r::jsonb ->> 'granted') || '/' || (select count(*)::text from public.entitlements where pilot_id = v_pilot));
  perform pg_temp.ck('confirming with a different reference is refused', 'true',
    (pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'bank_transfer', 'OTHER-REF-77')::text$q$, v_pilot)) like '%pilot_already_paid_other_reference%')::text);
  perform pg_temp.ck('a paid pilot invoice cannot be voided on its own (it would let the seats be billed again)', 'true',
    (pg_temp.q_as(adm, format($q$select public.employer_set_invoice_status(%L, 'void', 'Voiding a paid pilot invoice')::text$q$, v_inv)) like '%pilot_invoice_void_via_pilot_only%')::text);
  -- a contract-driven per-head invoice for the same dates would bill the same people twice
  insert into public.corporate_contracts (organisation_id, name) values (a, 'EP contract') returning id into v_contract;
  perform pg_temp.ck('a per-head contract invoice overlapping the pilot is refused', 'pilot_covers_this_period',
    pg_temp.owner_try(format($q$insert into public.employer_invoices (organisation_id, contract_id, period_start, period_end, billing_model, amount_kobo) values (%L, %L, %L, %L, 'per_employee', 1000)$q$, a, v_contract, pg_temp.today(), pg_temp.today() + 10)));
  perform pg_temp.ck('and so is one for a period after it that touches its window', 'pilot_covers_this_period',
    pg_temp.owner_try(format($q$insert into public.employer_invoices (organisation_id, contract_id, period_start, period_end, billing_model, amount_kobo) values (%L, %L, %L, %L, 'per_active_member', 1000)$q$, a, v_contract, pg_temp.today() + 30, pg_temp.today() + 60)));
  perform pg_temp.ck('a per-head contract invoice well after the pilot window is not blocked', 'ok',
    pg_temp.owner_try(format($q$insert into public.employer_invoices (organisation_id, contract_id, period_start, period_end, billing_model, amount_kobo) values (%L, %L, %L, %L, 'per_employee', 1000)$q$, a, v_contract, pg_temp.today() + 200, pg_temp.today() + 230)));
  perform pg_temp.ck('recording a pilot invoice as paid touches no ledger: no trigger on employer_invoices reads a journal or ledger table', '0',
    (select count(*)::text from pg_trigger t join pg_proc f on f.oid = t.tgfoid
      where t.tgrelid = 'public.employer_invoices'::regclass and not t.tgisinternal and f.prosrc ~* '(journal|ledger)'));
  perform pg_temp.ck('and no journal entry mentions the pilot invoice', '0',
    (select count(*)::text from public.audit_log where action ~* 'journal' and entity_id = v_inv));
  perform pg_temp.ck('the confirmation is audited once', '1', (select count(*)::text from public.audit_log where action = 'employer_seat_pilot.payment_confirmed' and entity_id = v_pilot));
end $$;

-- 3. The cap, the arrears generator, departure -----------------------------------------------------------------------------
do $$
declare adm uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); pkg uuid := pg_temp.f('pkgA'); v_pilot uuid := pg_temp.f('pilotA'); i integer; r text;
        r13 uuid;
begin
  for i in 3..12 loop perform pg_temp.claim(a, pkg, pg_temp.f('p' || i)); end loop;
  perform pg_temp.ck('twelve claims make exactly twelve pilot seats', '12', (select count(*)::text from public.entitlements where pilot_id = v_pilot));
  r13 := pg_temp.claim(a, pkg, pg_temp.f('p13'));
  perform pg_temp.setf('roster13', r13);
  perform pg_temp.ck('the thirteenth claim gets no seat', '0', (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p13')));
  perform pg_temp.ck('and the roster row says no seat left', 'no_seat_left', (select seat_state from public.employer_roster_members where id = r13));
  perform pg_temp.ck('one ops incident was raised for the pilot', '1', (select count(*)::text from public.ops_incidents where external_reference = 'pilot-no-seat:' || v_pilot));
  perform pg_temp.ck('the thirteenth person is not a Member', 'false', private.patient_is_member(pg_temp.f('p13'))::text);
  update public.employer_roster_members set eligible_until = null where id = r13;
  perform pg_temp.ck('re-syncing the claim does not sneak a seat in', '0', (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p13')));

  perform pg_temp.ck('the arrears generator finds nothing to bill: a pilot seat is never billed twice', 'true',
    (pg_temp.q_as(adm, format($q$select public.generate_organisation_membership_invoice(%L, %L, %L)::text$q$, a, pg_temp.today() - 30, pg_temp.today())) like '%no_uninvoiced_seats%')::text);
  perform pg_temp.ck('the organisation summary shows 12 active seats and nothing uninvoiced', '12/0',
    pg_temp.q_as(pg_temp.f('corpA'), format($q$select (s ->> 'active_seats') || '/' || (s ->> 'uninvoiced_kobo') from (select public.organisation_seat_summary(%L) s) x$q$, a)));

  update public.employer_roster_members set status = 'departed', departed_at = now() where id = pg_temp.f('roster1');
  perform pg_temp.ck('a departed employee''s seat is revoked', 'revoked', (select state from public.entitlements where roster_member_id = pg_temp.f('roster1')));
  update public.employer_roster_members set eligible_until = null where id = r13;
  perform pg_temp.ck('and the seat is not reused: it was purchased once', '0', (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p13')));
end $$;

-- 4. Closing, a window that has not opened, cancel and arrears -------------------------------------------------------------
do $$
declare adm uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); b uuid := pg_temp.f('orgB'); c uuid := pg_temp.f('orgC'); t date := pg_temp.today();
        v_pb uuid; v_pc uuid; v_inv uuid; r text; r14 uuid;
begin
  perform pg_temp.ck('closing needs a reason', 'true',
    (pg_temp.q_as(adm, format($q$select public.close_employer_seat_pilot(%L, 'short')::text$q$, pg_temp.f('pilotA'))) like '%pilot_reason_needed%')::text);
  perform pg_temp.ck('an employer admin cannot close a pilot', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.close_employer_seat_pilot(%L, 'Employer trying to end it')::text$q$, pg_temp.f('pilotA'))) like '%pilot_not_authorised%')::text);
  perform pg_temp.ck('finance ends a paid pilot', 'ended', pg_temp.q_as(adm, format($q$select public.close_employer_seat_pilot(%L, 'Pilot review completed in the proof run')::text$q$, pg_temp.f('pilotA'))));
  perform pg_temp.ck('closing again is a replay', 'ended', pg_temp.q_as(adm, format($q$select public.close_employer_seat_pilot(%L, 'Pilot review completed in the proof run')::text$q$, pg_temp.f('pilotA'))));
  perform pg_temp.ck('ending a paid pilot leaves members their Membership and the invoice paid', 'true/paid',
    private.patient_is_member(pg_temp.f('p2'))::text || '/' || (select i.status::text from public.employer_seat_pilots p join public.employer_invoices i on i.id = p.invoice_id where p.id = pg_temp.f('pilotA')));
  perform pg_temp.ck('the employer cannot read finance''s closing note', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), 'select close_reason from public.employer_seat_pilots limit 1') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('the employer cannot read who created or activated the pilot', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), 'select created_by::text from public.employer_seat_pilots limit 1') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('but reads its own terms and state', 'ended', pg_temp.q_as(pg_temp.f('corpA'), 'select state from public.employer_seat_pilots limit 1'));
  r14 := pg_temp.claim(a, pg_temp.f('pkgA'), pg_temp.f('p14'));
  perform pg_temp.ck('after the pilot ended a new claim gets no seat', 'pilot_closed/0',
    (select seat_state from public.employer_roster_members where id = r14) || '/' || (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p14')));
  perform pg_temp.claim(a, pg_temp.f('pkgA'), pg_temp.f('p20'));
  perform pg_temp.ck('many late claims after the end raise ONE incident for the pilot, not one per person', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'pilot-closed:' || pg_temp.f('pilotA')));
  perform pg_temp.ck('and they wait with a clear state, no seat', 'pilot_closed/0',
    (select seat_state from public.employer_roster_members where claimed_profile_id = pg_temp.f('p20')) || '/' || (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p20')));
  perform pg_temp.ck('an ended pilot cannot be reopened', 'pilot_state_transition_not_allowed', pg_temp.owner_try(format($q$update public.employer_seat_pilots set state = 'active' where id = %L$q$, pg_temp.f('pilotA'))));

  -- a pilot whose window opens in ten days: paid, but today is before the window
  v_pb := pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 6, %L, %L, 'terms-v1', true)::text$q$, b, pg_temp.f('pkgB'), t + 10, t + 40))::uuid;
  perform pg_temp.q_as(adm, format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_pb));
  perform pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'bank_transfer', 'BANK-REF-2002')::text$q$, v_pb));
  perform pg_temp.ck('a payment reference cannot be reused on another pilot', 'true',
    (pg_temp.owner_try(format($q$update public.employer_seat_pilots set payment_reference = 'BANK-REF-2002' where id = %L$q$, pg_temp.f('pilotA'))) like '%employer_seat_pilots_payment_reference_key%')::text);
  perform pg_temp.claim(b, pg_temp.f('pkgB'), pg_temp.f('p15'));
  perform pg_temp.ck('a paid pilot grants seats from the day payment is confirmed, even before its start date (nobody waits for a date)', 'seat/1',
    (select seat_state from public.employer_roster_members where claimed_profile_id = pg_temp.f('p15')) || '/' || (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p15') and pilot_id = v_pb));

  -- an unpaid pilot that is cancelled: invoice voided, employer back on arrears billing
  v_pc := pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 6, %L, %L, 'terms-v1', true)::text$q$, c, pg_temp.f('pkgC'), t, t + 30))::uuid;
  v_inv := pg_temp.q_as(adm, format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_pc))::uuid;
  perform pg_temp.claim(c, pg_temp.f('pkgC'), pg_temp.f('p16'));
  perform pg_temp.ck('while the block is unpaid the claim waits', 'waiting_payment/0',
    (select seat_state from public.employer_roster_members where claimed_profile_id = pg_temp.f('p16')) || '/' || (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p16')));
  perform pg_temp.ck('finance cancels an unpaid pilot', 'cancelled', pg_temp.q_as(adm, format($q$select public.close_employer_seat_pilot(%L, 'Employer withdrew before paying')::text$q$, v_pc)));
  perform pg_temp.ck('its invoice is voided with the reason', 'void/Employer withdrew before paying',
    (select status::text || '/' || void_reason from public.employer_invoices where id = v_inv));
  perform pg_temp.ck('cancelling gives the person who was waiting the ordinary seat, on normal arrears billing again', '1/0/seat',
    (select count(*)::text || '/' || count(pilot_id)::text from public.entitlements where patient_id = pg_temp.f('p16') and state = 'active') || '/' ||
    (select seat_state from public.employer_roster_members where claimed_profile_id = pg_temp.f('p16')));
  v_pc := pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 1, %L, %L, 'terms-v2', true)::text$q$, c, pg_temp.f('pkgC'), t, t + 30))::uuid;
  perform pg_temp.ck('a cancelled pilot can be followed by a new one', 'true', (v_pc is not null)::text);
  perform pg_temp.setf('pilotC2', v_pc);
  perform pg_temp.q_as(adm, format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_pc));
  perform pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'bank_transfer', 'BANK-REF-3003')::text$q$, v_pc));
  perform pg_temp.q_as(adm, format($q$select public.set_organisation_member_price(%L, 9000000, 'Price moved after the pilot was created', now() - interval '1 hour')::text$q$, c));
  perform pg_temp.claim(c, pg_temp.f('pkgC'), pg_temp.f('p17'));
  perform pg_temp.claim(c, pg_temp.f('pkgC'), pg_temp.f('p18'));
  perform pg_temp.ck('a pilot seat keeps the price the pilot was made at, whatever the organisation price becomes', '10000000',
    (select seat_price_kobo::text from public.entitlements where pilot_id = v_pc));
  perform pg_temp.ck('a one seat pilot gives the first claim the seat and the second none', '1/no_seat_left',
    (select count(*)::text from public.entitlements where pilot_id = v_pc) || '/' || (select seat_state from public.employer_roster_members where claimed_profile_id = pg_temp.f('p18')));
end $$;

-- 5. The aggregate report ------------------------------------------------------------------------------------------------------
-- pilot A (12 seats, minimum cell 5). Seats were made this week, so usage is first withheld; then the seats are moved back two weeks.
do $$
declare adm uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); v_pilot uuid := pg_temp.f('pilotA'); r jsonb; i integer; v_json text;
begin
  r := pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot))::jsonb;
  perform pg_temp.ck('usage reporting ships OFF: seat counts only until counsel and the DPO sign the employee notice', 'true/not_enabled',
    ((r -> 'usage' ->> 'suppressed') = 'true')::text || '/' || (r -> 'usage' ->> 'reason'));
  update public.employer_seat_pilot_config set rules = jsonb_set(rules, '{usage_report_enabled}', 'true') where is_active;
  r := pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot))::jsonb;
  perform pg_temp.ck('seats made this week give no usage figures yet (too few reportable members)', 'true/too_few_members',
    ((r -> 'usage' ->> 'suppressed') = 'true')::text || '/' || (r -> 'usage' ->> 'reason'));
  perform pg_temp.ck('the suppressed usage block carries no figure keys at all', 'reason,suppressed', pg_temp.all_keys(r -> 'usage'));
  perform pg_temp.ck('seat counts are exact: 12 purchased, 12 claimed, 11 active (one departed), 0 unclaimed, 2 claims without a seat', '12/12/11/0/2',
    (r -> 'seats' ->> 'purchased') || '/' || (r -> 'seats' ->> 'claimed') || '/' || (r -> 'seats' ->> 'active') || '/' || (r -> 'seats' ->> 'unclaimed') || '/' || (r -> 'seats' ->> 'claims_without_seat'));

  -- move the seats two weeks back and plant activity two weeks old
  update public.entitlements set starts_at = now() - interval '21 days', ends_at = now() + interval '300 days' where pilot_id = v_pilot;
  -- 6 members have a completed consultation (9 consultations in all), 10 have logged a reading
  for i in 1..6 loop
    insert into public.encounters (organisation_id, patient_id, type, status, started_at, ended_at, policy_version, is_test)
    values ('00000000-0000-0000-0000-000000000001', pg_temp.f('p' || i), 'async', 'completed', now() - interval '12 days', now() - interval '12 days', 1, true);
  end loop;
  for i in 1..3 loop
    insert into public.encounters (organisation_id, patient_id, type, status, started_at, ended_at, policy_version, is_test)
    values ('00000000-0000-0000-0000-000000000001', pg_temp.f('p' || i), 'async', 'completed', now() - interval '11 days', now() - interval '11 days', 1, true);
  end loop;
  -- a consultation this week is not in the figures (cut at the last completed Lagos week)
  insert into public.encounters (organisation_id, patient_id, type, status, started_at, ended_at, policy_version, is_test)
  values ('00000000-0000-0000-0000-000000000001', pg_temp.f('p7'), 'async', 'completed', now(), now(), 1, true);
  for i in 1..10 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at)
    values ('00000000-0000-0000-0000-000000000001', pg_temp.f('p' || i), 'blood_pressure', 120, 80, now() - interval '10 days');
  end loop;

  v_json := pg_temp.q_as(pg_temp.f('corpA'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot));
  r := v_json::jsonb;
  perform pg_temp.ck('with enough members usage is reported', 'false', (r -> 'usage' ->> 'suppressed'));
  perform pg_temp.ck('6 of 12 members had a consultation: shown, rounded to the nearest 5 = 5 (this week''s consultation is not counted)', '5',
    (r -> 'usage' ->> 'members_with_consultation'));
  perform pg_temp.ck('9 consultations are shown rounded to 10', '10', (r -> 'usage' ->> 'consultations_completed'));
  perform pg_temp.ck('10 of 12 members logged a reading: withheld, because the 2 who did not would be identifiable (complementary suppression)', 'null',
    coalesce(r -> 'usage' ->> 'members_with_reading', 'null'));
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '20') where is_active;
  perform pg_temp.ck('with the production platform floor of 20, a 12 member pilot reports no usage at all', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), format($q$select (public.employer_seat_pilot_report(%L) -> 'usage' ->> 'suppressed')$q$, v_pilot)))::text);
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '5') where is_active;
  perform pg_temp.ck('the minimum cell is the organisation''s own 5, and counts are rounded to 5', '5/5', (r ->> 'min_cell') || '/' || (r ->> 'rounded_to'));
  perform pg_temp.ck('the report is cut at the last completed Lagos week (a Sunday)', '0',
    (extract(dow from (r ->> 'usage_through')::date))::text);
  perform pg_temp.ck('the platform cell rule at 12 members and a minimum of 5: 0 and 3 withheld, 5 and 7 shown, 8 withheld (4 would be left out), 12 shown', 'under_minimum/under_minimum/ok/ok/small_cell/ok',
    coalesce(private.suppress_cell(0, array[0, 12]::bigint[], 5), 'ok') || '/' || coalesce(private.suppress_cell(3, array[3, 9]::bigint[], 5), 'ok') || '/' ||
    coalesce(private.suppress_cell(5, array[5, 7]::bigint[], 5), 'ok') || '/' || coalesce(private.suppress_cell(7, array[7, 5]::bigint[], 5), 'ok') || '/' ||
    coalesce(private.suppress_cell(8, array[8, 4]::bigint[], 5), 'ok') || '/' || coalesce(private.suppress_cell(12, array[12, 0]::bigint[], 5), 'ok'));

  perform pg_temp.ck('the whole report has a closed set of keys: no name, no id of a person, no condition, no reading', 'active,claimed,claims_without_seat,consultations_completed,ends_on,generated_at,id,members_with_consultation,members_with_reading,min_cell,pilot,purchased,rounded_to,seat_price_kobo,seats,starts_on,state,suppressed,terms_version,total_kobo,unclaimed,usage,usage_through',
    pg_temp.all_keys(r));
  perform pg_temp.ck('no member id appears anywhere in the output', 'false',
    (select bool_or(v_json like '%' || v::text || '%') from fx where k ~ '^p[0-9]+$')::text);
  perform pg_temp.ck('no member name or phone appears anywhere in the output', 'false',
    (select bool_or(v_json like '%' || pr.full_name || '%' or v_json like '%' || pr.phone || '%') from public.profiles pr where pr.id in (select v from fx where k ~ '^p[0-9]+$'))::text);

  -- who may read it
  perform pg_temp.ck('another employer''s admin cannot read this report', 'true',
    (pg_temp.q_as(pg_temp.f('corpB'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot)) like '%pilot_report_not_authorised%')::text);
  perform pg_temp.ck('a patient cannot read it', 'true',
    (pg_temp.q_as(pg_temp.f('p1'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot)) like '%pilot_report_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot read it', 'true',
    (pg_temp.q_as(pg_temp.f('clin'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot)) like '%pilot_report_not_authorised%')::text);
  perform pg_temp.ck('anon cannot read it', '42501', pg_temp.try_anon(format($q$select public.employer_seat_pilot_report(%L)$q$, v_pilot)));
  perform pg_temp.ck('an unknown pilot id gives the same refusal, not a hint', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), $q$select public.employer_seat_pilot_report('00000000-0000-0000-0000-0000000000aa')::text$q$) like '%pilot_report_not_authorised%')::text);
  perform pg_temp.ck('finance can read it', 'true', (pg_temp.q_as(adm, format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot)) !~ '^ERR:')::text);

  -- the individual rows stay out of reach of an employer admin, with a control that they exist and a platform admin can see them
  perform pg_temp.ck('CONTROL: a platform admin can see the encounters', 'true', (pg_temp.q_as(adm, 'select count(*)::text from public.encounters')::int >= 9)::text);
  perform pg_temp.ck('an employer admin reads zero encounters', '0', pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.encounters'));
  perform pg_temp.ck('CONTROL: a platform admin can see the readings', 'true', (pg_temp.q_as(adm, 'select count(*)::text from public.vitals_readings')::int >= 10)::text);
  perform pg_temp.ck('an employer admin reads zero readings', '0', pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.vitals_readings'));
  perform pg_temp.ck('an employer admin reads zero entitlement rows', '0', pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.entitlements'));
  perform pg_temp.ck('an employer admin reads zero membership rows', 'true',
    (pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.patient_memberships') in ('0') or pg_temp.q_as(pg_temp.f('corpA'), 'select count(*)::text from public.patient_memberships') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('private.is_org_staff still refuses an employer admin', 'false',
    (select (pg_temp.q_as(pg_temp.f('corpA'), format($q$select private.is_org_staff(%L)::text$q$, a))))::text);
end $$;

-- test accounts are excluded from a real pilot's figures (INV-13)
do $$
declare adm uuid := pg_temp.f('admin'); v_pilot uuid := pg_temp.f('pilotA'); r jsonb;
begin
  update public.employer_seat_pilots set is_test = false where id = v_pilot;
  r := pg_temp.q_as(adm, format($q$select public.employer_seat_pilot_report(%L)::text$q$, v_pilot))::jsonb;
  perform pg_temp.ck('a real (not test) pilot counts none of the test-account seats', '0', (r -> 'seats' ->> 'claimed'));
  update public.employer_seat_pilots set is_test = true where id = v_pilot;
end $$;

-- 5b. A new paid pilot re-offers seats to people an earlier pilot could not serve --------------------------------------------
do $$
declare adm uuid := pg_temp.f('admin'); a uuid := pg_temp.f('orgA'); t date := pg_temp.today(); v_p2 uuid; r jsonb;
begin
  v_p2 := pg_temp.q_as(adm, format($q$select public.create_employer_seat_pilot(%L, %L, 6, %L, %L, 'terms-v2', true)::text$q$, a, pg_temp.f('pkgA'), t, t + 30))::uuid;
  perform pg_temp.setf('pilotA2', v_p2);
  perform pg_temp.q_as(adm, format($q$select public.issue_employer_seat_pilot_invoice(%L)::text$q$, v_p2));
  r := pg_temp.q_as(adm, format($q$select public.confirm_employer_seat_pilot_payment(%L, 'bank_transfer', 'BANK-REF-4004')::text$q$, v_p2))::jsonb;
  perform pg_temp.ck('a new paid pilot gives the two people who were refused (no seat left, pilot closed) their seats', '2/seat/seat',
    (r ->> 'granted') || '/' || (select string_agg(seat_state, '/' order by seat_state) from public.employer_roster_members where claimed_profile_id in (pg_temp.f('p13'), pg_temp.f('p14'))));
  perform pg_temp.ck('and no claim is left waiting on the report', '0',
    (pg_temp.q_as(adm, format($q$select public.employer_seat_pilot_report(%L) -> 'seats' ->> 'claims_without_seat'$q$, v_p2))));
end $$;

-- 6. Dormant ---------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  perform pg_temp.ck('checkout stays dormant: v5_checkout off', 'false', (select is_enabled::text from public.platform_modules where key = 'v5_checkout'));
  perform pg_temp.ck('the Membership item is still off', 'false', (select active::text from public.catalog_items where id = pg_temp.f('item')));
  foreach f in array array['public.create_employer_seat_pilot(uuid, uuid, integer, date, date, text, boolean)', 'public.issue_employer_seat_pilot_invoice(uuid)',
    'public.confirm_employer_seat_pilot_payment(uuid, text, text)', 'public.close_employer_seat_pilot(uuid, text)', 'public.employer_seat_pilot_report(uuid)'] loop
    perform pg_temp.ck('anon cannot execute ' || f, 'false', has_function_privilege('anon', f, 'EXECUTE')::text);
  end loop;
  perform pg_temp.ck('the grant function stays internal', 'false/false',
    has_function_privilege('anon', 'private.grant_org_seat(uuid)', 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'private.grant_org_seat(uuid)', 'EXECUTE')::text);
end $$;

-- SABOTAGE 1: the platform cell rule never withholds; the 10-of-12 reading count must now be shown
create temp table orig_defs(k text primary key, d text) on commit drop;
insert into orig_defs values ('suppress_cell', pg_get_functiondef('private.suppress_cell'::regproc));
create or replace function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
language sql stable security definer set search_path = '' as $$ select null::text $$;
do $$
declare r jsonb := pg_temp.q_as(pg_temp.f('admin'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, pg_temp.f('pilotA')))::jsonb;
begin
  insert into results values ('sabotaged', 'a count whose complement is 2 people is withheld', 'null', coalesce(r -> 'usage' ->> 'members_with_reading', 'null'));
end $$;
do $$ begin execute (select d from orig_defs where k = 'suppress_cell'); end $$;

-- SABOTAGE 2: the minimum-group gate removed; with a handful of members usage must now be shown
do $$
declare d text; r jsonb;
begin
  d := replace(pg_get_functiondef('public.employer_seat_pilot_report'::regproc), 'if private.suppress_cell(v_denom, null, v_min) is not null then', 'if false then');
  if d = pg_get_functiondef('public.employer_seat_pilot_report'::regproc) then raise exception 'VACUOUS TEST: sabotage text not found (gate)'; end if;
  execute d;
  update public.entitlements set starts_at = now() - interval '21 days' where pilot_id = pg_temp.f('pilotA') and patient_id not in (pg_temp.f('p1'), pg_temp.f('p2'), pg_temp.f('p3'));
  update public.entitlements set starts_at = now() where pilot_id = pg_temp.f('pilotA') and patient_id in (pg_temp.f('p1'), pg_temp.f('p2'), pg_temp.f('p3'));
  -- only 9 members are old enough: still above 5. Push all but two to this week so fewer than 5 remain.
  update public.entitlements set starts_at = now() where pilot_id = pg_temp.f('pilotA') and patient_id not in (pg_temp.f('p4'), pg_temp.f('p5'));
  r := pg_temp.q_as(pg_temp.f('admin'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, pg_temp.f('pilotA')))::jsonb;
  insert into results values ('sabotaged', 'with fewer than the minimum members usage is withheld', 'true', coalesce(r -> 'usage' ->> 'suppressed', 'null'));
end $$;

-- SABOTAGE 3: widen the report's employer scope; another employer's admin must now be able to read it
do $$
declare d text; r text;
begin
  d := replace(pg_get_functiondef('public.employer_seat_pilot_report'::regproc),
    '(private.is_institution_admin() and v_p.organisation_id = private.current_org_id())', 'private.is_institution_admin()');
  if d = pg_get_functiondef('public.employer_seat_pilot_report'::regproc) then raise exception 'VACUOUS TEST: sabotage text not found (scope)'; end if;
  execute d;
  r := pg_temp.q_as(pg_temp.f('corpB'), format($q$select public.employer_seat_pilot_report(%L)::text$q$, pg_temp.f('pilotA')));
  insert into results values ('sabotaged', 'another employer''s admin is refused', 'true', (r like '%pilot_report_not_authorised%')::text);
end $$;

-- SABOTAGE 4: the seat cap removed; the one seat pilot must now hand out a second seat
do $$
declare d text;
begin
  d := replace(pg_get_functiondef('private.grant_org_seat'::regproc), 'if v_used >= v_pilot.seats_purchased then', 'if false then');
  if d = pg_get_functiondef('private.grant_org_seat'::regproc) then raise exception 'VACUOUS TEST: sabotage text not found (cap)'; end if;
  execute d;
  perform pg_temp.claim(pg_temp.f('orgC'), pg_temp.f('pkgC'), pg_temp.f('p19'));
  insert into results values ('sabotaged', 'a one seat pilot never has more than one seat', '1',
    (select count(*)::text from public.entitlements where pilot_id = pg_temp.f('pilotC2')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'employer seat pilot proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
