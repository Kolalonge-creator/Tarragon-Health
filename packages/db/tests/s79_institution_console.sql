-- ===========================================================================
-- Proof: 20261027175329_s79_institution_console.sql (v5 S79, Module 24; I8, I9, INV-09, INV-13, D7).
--
--   0. The module ships OFF: every new function refuses while institution_console is off. The proof then switches it on (inside this transaction only).
--   1. Programme configuration: only sponsor staff submit; pathways outside the proposed list (including mental health and reproductive health), unknown
--      services, another organisation's campaign, an over-cap rewards budget and an empty request are refused; versions climb and the older one is
--      superseded; only an admin reviews; a rejection needs a reason; a stored request cannot be edited.
--   2. Usage: the roll-up is idempotent, a later refund writes one adjustment, the tables have no person column, small service lines fold into
--      "other services", a statement is write-once, test reservations never count, only finance or an admin links one to an invoice of the SAME sponsor.
--   3. Pack and ledger: sponsor staff only, audited per programme and once for the pack, built only from frozen snapshots, never another sponsor's data,
--      and nothing in it names or identifies a person.
--   4. Eligibility upload: stage/preview/report, add/remove/replace, leavers end the employer link and leave the person's account and record alone,
--      remove/replace refused with errors, a second approver for ending people, Tarragon only for a large share, another organisation refused,
--      staged personal values blanked after commit and cancel.
--   5. One code entry: employer code and programme code both work; an unknown code gets the same answer; an ambiguous code is refused and audited; ten
--      bad tries stop a good code; the namespace trigger stops a new code equal to one in the other table.
--   6. I9 / RLS: sponsor staff cannot read any new table, and nothing any sponsor function returns names or identifies a fixture person.
--   7. SABOTAGE: namespace trigger dropped; pathway check removed; second-approver check removed; folding removed. Each must flip its check.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temp table s79_results (check_name text, observed text, expected text, verdict text);
grant all on s79_results to public;

create function pg_temp.mkuser(p_role text, p_org uuid default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := coalesce(p_org, (select id from public.organisations order by created_at limit 1));
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's79-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, state, sex, date_of_birth)
  values (v, v_org, p_role::public.user_role, 'S79 Person ' || replace(v::text, '-', ''), '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), 'Lagos', 'female', date '1975-05-05')
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;
  return v;
end $$;

-- Runs one scalar query as a signed-in user and returns its jsonb value, or {"error": message}. The role is restored.
create function pg_temp.call_as(u uuid, q text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute q into v;
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return jsonb_build_object('error', sqlerrm, 'state', sqlstate);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

create function pg_temp.rec(n text, observed text, expected text) returns void language plpgsql as $$
begin
  insert into s79_results values (n, observed, expected, case when observed = expected then 'PASS' else 'FAIL' end);
end $$;

do $$
declare
  v_cons uuid := '00000000-0000-0000-0000-000000000001';
  v_sp uuid; v_sp2 uuid; adm uuid; clin uuid; cs uuid; cs2 uuid; ns uuid; pat uuid; r jsonb; r2 jsonb; v_txt text; v_n integer; v_id uuid; v_id2 uuid;
  v_item uuid; v_price uuid; v_prog uuid; v_prog2 uuid; v_ord uuid; i integer; p uuid; v_month date; v_batch uuid; v_inv uuid; v_inv2 uuid; v_st uuid;
  v_camp uuid; v_camp_other uuid; v_dept uuid; v_codeC text; v_cohort uuid;
  pts uuid[] := '{}'; v_ro1 uuid; v_ro2 uuid; v_ro3 uuid; v_pa uuid; v_pb uuid; v_rost uuid;
begin
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '3') where is_active;
  insert into public.organisations (name, type) values ('S79 Acme Corp', 'corporate') returning id into v_sp;
  insert into public.organisations (name, type) values ('S79 Other NGO', 'ngo') returning id into v_sp2;
  update public.organisations set min_cohort_size = 5 where id in (v_sp, v_sp2);  -- the table's own floor is 5; the platform minimum above is 3, so the working floor is 5
  adm := pg_temp.mkuser('admin'); clin := pg_temp.mkuser('clinician'); pat := pg_temp.mkuser('patient');
  cs := pg_temp.mkuser('corporate_admin', v_sp); cs2 := pg_temp.mkuser('corporate_admin', v_sp); ns := pg_temp.mkuser('ngo_admin', v_sp2);
  v_month := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month')::date;

  -- =============================== 0. OFF by default ===============================
  perform pg_temp.rec('0a the module ships off', (select is_enabled::text from public.platform_modules where key = 'institution_console'), 'false');
  r := pg_temp.call_as(cs, 'select public.institution_config_current()');
  perform pg_temp.rec('0b config is refused while off', (coalesce(r ->> 'error', 'allowed') like '%not yet activated%')::text, 'true');
  r := pg_temp.call_as(cs, 'select to_jsonb(public.sponsor_usage_statements())');
  perform pg_temp.rec('0c usage is refused while off', (coalesce(r ->> 'error', 'allowed') like '%not yet activated%')::text, 'true');
  r := pg_temp.call_as(cs, $q$select public.employer_stage_roster_upload(null, 'add', '[]'::jsonb)$q$);
  perform pg_temp.rec('0d staging is refused while off', (coalesce(r ->> 'error', 'allowed') like '%not yet activated%')::text, 'true');
  -- going live needs an active, signed contract with a billing model
  insert into public.corporate_contracts (organisation_id, name, status, billing_model, billing_rate_kobo, billing_interval, signed_at, signed_by)
    values (v_sp, 'S79 Acme contract', 'active', 'per_employee', 100000, 'monthly', now(), adm);
  insert into public.employer_accounts (organisation_id, verification_status, verified_by, verified_at, onboarding_step, went_live_at, join_code)
    values (v_sp, 'verified', adm, now(), 'live', now(), 'EMPLQY22');
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = adm, activation_note = 'S79 proof only' where key = 'institution_console';

  -- =============================== 1. Programme configuration ===============================
  insert into public.prevention_campaigns (organisation_id, code, name, starts_on, status) values (v_sp, 's79-c-' || substr(md5(random()::text), 1, 8), 'S79 Walk challenge', current_date, 'draft') returning id into v_camp;
  insert into public.prevention_campaigns (organisation_id, code, name, starts_on, status) values (v_sp2, 's79-c-' || substr(md5(random()::text), 1, 8), 'Other org campaign', current_date, 'draft') returning id into v_camp_other;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, active) values (v_cons, 's79_lab_panel', 'lab_panel', 'k.n', 'k.d', false) returning id into v_item;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, active) values (v_cons, 's79_consult', 'consultation', 'k.n', 'k.d', 1, false);

  r := pg_temp.call_as(cs, format($q$select public.institution_config_submit(array['hypertension'], array['s79_lab_panel'], array[%L]::uuid[], 20000000, 'please')$q$, v_camp));
  perform pg_temp.rec('1a sponsor staff submits a request', coalesce(r ->> 'version', r ->> 'error'), '1');
  foreach v_txt in array array['pat', 'clin', 'adm'] loop
    r := pg_temp.call_as(case v_txt when 'pat' then pat when 'clin' then clin else adm end, $q$select public.institution_config_submit(array['hypertension'], '{}', '{}', 0, null)$q$);
    perform pg_temp.rec('1b ' || v_txt || ' cannot submit', coalesce(r ->> 'state', 'allowed'), '42501');
  end loop;
  r := pg_temp.call_as(cs, $q$select public.institution_config_submit(array['mental_health'], '{}', '{}', 0, null)$q$);
  perform pg_temp.rec('1c a mental health pathway is refused', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(cs, $q$select public.institution_config_submit(array['reproductive_health'], '{}', '{}', 0, null)$q$);
  perform pg_temp.rec('1d a reproductive health pathway is refused', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(cs, $q$select public.institution_config_submit('{}', array['no_such_item'], '{}', 0, null)$q$);
  perform pg_temp.rec('1e an unknown service is refused', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(cs, format($q$select public.institution_config_submit('{}', '{}', array[%L]::uuid[], 0, null)$q$, v_camp_other));
  perform pg_temp.rec('1f another organisation''s campaign is refused', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(cs, $q$select public.institution_config_submit(array['diabetes'], '{}', '{}', 5000000001, null)$q$);
  perform pg_temp.rec('1g a rewards request over the cap is refused', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(cs, $q$select public.institution_config_submit('{}', '{}', '{}', 0, null)$q$);
  perform pg_temp.rec('1h an empty request is refused', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(cs2, $q$select public.institution_config_submit(array['diabetes'], '{}', '{}', 0, null)$q$);
  perform pg_temp.rec('1i a second request is version 2', coalesce(r ->> 'version', r ->> 'error'), '2');
  perform pg_temp.rec('1j the older request is superseded', (select status from public.institution_programme_configs where sponsor_org_id = v_sp and version = 1), 'superseded');
  select id into v_id from public.institution_programme_configs where sponsor_org_id = v_sp and version = 2;
  r := pg_temp.call_as(cs, format('select to_jsonb(public.admin_review_institution_config(%L, true, null))', v_id));
  perform pg_temp.rec('1k sponsor staff cannot review their own request', coalesce(r ->> 'state', 'allowed'), '42501');
  r := pg_temp.call_as(adm, format('select to_jsonb(public.admin_review_institution_config(%L, false, null))', v_id));
  perform pg_temp.rec('1l a rejection needs a reason', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(adm, format($q$select to_jsonb(public.admin_review_institution_config(%L, true, 'ok'))$q$, v_id));
  perform pg_temp.rec('1m an admin approves', r::text, 'true');
  begin update public.institution_programme_configs set pathways = array['hypertension'] where id = v_id; perform pg_temp.rec('1n a stored request cannot be edited', 'edited', 'refused');
  exception when sqlstate 'P0001' then perform pg_temp.rec('1n a stored request cannot be edited', 'refused', 'refused'); end;
  r := pg_temp.call_as(cs, 'select public.institution_config_current()');
  perform pg_temp.rec('1o the screen lists the requests and only ACTIVE services on offer (the inactive fixture items are not offered)', (jsonb_array_length(r -> 'requests') = 2 and jsonb_typeof(r -> 'items') = 'array'
      and not exists (select 1 from jsonb_array_elements(r -> 'items') e where e ->> 'code' like 's79\_%'))::text, 'true');

  -- =============================== 2. Usage ===============================
  -- a programme, one lab panel line used by six different people (five after the refund: shown at a floor of 5), one consult used by one person (folded)
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, status)
    values (v_cons, v_sp, 'S79 Acme staff', 'PRQQFAA2', current_date - 100, current_date + 300, 100, 'active') returning id into v_cohort;
  insert into public.sponsor_programmes (organisation_id, sponsor_org_id, name, item_codes, share_percent, budget_kobo, eligibility, cohort_id, valid_from, valid_to, status)
    values (v_cons, v_sp, 'S79 Acme staff cover', array['s79_lab_panel', 's79_consult'], 100, 50000000, 'cohort', v_cohort, current_date - 100, current_date + 300, 'active') returning id into v_prog;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo) values (v_cons, v_item, 1000000) returning id into v_price;
  for i in 1..6 loop
    p := pg_temp.mkuser('patient'); pts := pts || p;
    insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference)
      values (v_cons, p, p, v_item, v_price, 1000000, 's79ref-lab-' || i || substr(md5(random()::text), 1, 6)) returning id into v_ord;
    insert into public.sponsor_reservations (organisation_id, programme_id, order_id, beneficiary_id, amount_kobo, state, settled_at)
      values (v_cons, v_prog, v_ord, p, 1000000, 'committed', (v_month + 10)::timestamp at time zone 'Africa/Lagos');
  end loop;
  select id into v_item from public.catalog_items where code = 's79_consult';
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference)
    values (v_cons, pts[1], pts[1], v_item, v_price, 500000, 's79ref-consult-' || substr(md5(random()::text), 1, 6)) returning id into v_ord;
  insert into public.sponsor_reservations (organisation_id, programme_id, order_id, beneficiary_id, amount_kobo, state, settled_at)
    values (v_cons, v_prog, v_ord, pts[1], 500000, 'committed', (v_month + 11)::timestamp at time zone 'Africa/Lagos');
  -- a test reservation must never count
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test)
    values (v_cons, pts[2], pts[2], v_item, v_price, 700000, 's79ref-test-' || substr(md5(random()::text), 1, 6), true) returning id into v_ord;
  insert into public.sponsor_reservations (organisation_id, programme_id, order_id, beneficiary_id, amount_kobo, state, settled_at, is_test)
    values (v_cons, v_prog, v_ord, pts[2], 700000, 'committed', (v_month + 12)::timestamp at time zone 'Africa/Lagos', true);

  v_n := private.roll_up_usage(v_month);
  perform pg_temp.rec('2a roll-up writes one row per programme, service and test flag', v_n::text, '3');
  perform pg_temp.rec('2b a second run writes nothing', private.roll_up_usage(v_month)::text, '0');
  perform pg_temp.rec('2c no usage table has a person column', (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('usage_records', 'usage_statements', 'usage_statement_invoice_links')
        and column_name in ('patient_id', 'beneficiary_id', 'profile_id', 'user_id', 'person_id'))::text, '0');
  begin update public.usage_records set units = 99; perform pg_temp.rec('2d usage_records are write-once', 'edited', 'refused');
  exception when sqlstate 'P0001' then perform pg_temp.rec('2d usage_records are write-once', 'refused', 'refused'); end;
  -- a refund after the first run: one adjustment of minus the line
  update public.sponsor_reservations set state = 'released', settled_at = now() where order_id = (select id from public.orders where beneficiary_patient_id = pts[5] and catalog_item_id = (select id from public.catalog_items where code = 's79_lab_panel'));
  perform pg_temp.rec('2e a refund after the roll-up writes one adjustment', private.roll_up_usage(v_month)::text, '1');
  perform pg_temp.rec('2f the adjustment is minus one use and minus the amount', (select units || '/' || amount_kobo from public.usage_records where kind = 'adjustment'), '-1/-1000000');

  -- statements: module on, day 3 or later, previous month
  perform pg_temp.rec('2g too early in the month writes nothing', private.generate_usage_statements(((v_month + 31)::date)::timestamp at time zone 'Africa/Lagos')::text, '0');
  v_n := private.generate_usage_statements((date_trunc('month', v_month + 40)::date + 5)::timestamp at time zone 'Africa/Lagos');
  perform pg_temp.rec('2h one statement for the sponsor', v_n::text, '1');
  select id into v_st from public.usage_statements where sponsor_org_id = v_sp and period = v_month;
  perform pg_temp.rec('2i the lab line (5 people left after the refund) is shown', (select (payload -> 'lines' -> 0 ->> 'service_code') || '/' || (payload -> 'lines' -> 0 ->> 'units') from public.usage_statements where id = v_st), 's79_lab_panel/5');
  perform pg_temp.rec('2j the one-person consult is folded into other services, test reservation excluded', (select (payload ->> 'other_services_kobo') || '/' || jsonb_array_length(payload -> 'lines') from public.usage_statements where id = v_st), '500000/1');
  perform pg_temp.rec('2k the total is exact kobo', (select total_kobo::text from public.usage_statements where id = v_st), '5500000');
  perform pg_temp.rec('2l the fold is recorded for the privacy ledger', (select payload -> 'suppressed' -> 0 ->> 'reason' from public.usage_statements where id = v_st), 'under_minimum');
  perform pg_temp.rec('2m a second run writes no second statement', private.generate_usage_statements((date_trunc('month', v_month + 40)::date + 5)::timestamp at time zone 'Africa/Lagos')::text, '0');
  begin delete from public.usage_statements; perform pg_temp.rec('2n a statement is write-once', 'deleted', 'refused');
  exception when sqlstate 'P0001' then perform pg_temp.rec('2n a statement is write-once', 'refused', 'refused'); end;
  r := pg_temp.call_as(cs, 'select public.sponsor_usage_statements()');
  perform pg_temp.rec('2o sponsor staff read their statement', (jsonb_array_length(r) = 1 and r -> 0 ->> 'total_kobo' = '5500000')::text, 'true');
  r := pg_temp.call_as(ns, 'select public.sponsor_usage_statements()');
  perform pg_temp.rec('2p another sponsor reads none of it', jsonb_array_length(r)::text, '0');
  insert into public.employer_invoices (organisation_id, period_start, period_end, billing_model, amount_kobo, status) values (v_sp, v_month, v_month + 27, 'fixed_contract', 4500000, 'draft') returning id into v_inv;
  insert into public.employer_invoices (organisation_id, period_start, period_end, billing_model, amount_kobo, status) values (v_sp2, v_month, v_month + 27, 'fixed_contract', 1, 'draft') returning id into v_inv2;
  r := pg_temp.call_as(cs, format('select to_jsonb(public.admin_link_usage_statement(%L, %L))', v_st, v_inv));
  perform pg_temp.rec('2q sponsor staff cannot link', coalesce(r ->> 'state', 'allowed'), '42501');
  r := pg_temp.call_as(adm, format('select to_jsonb(public.admin_link_usage_statement(%L, %L))', v_st, v_inv2));
  perform pg_temp.rec('2r an invoice of another sponsor is refused', coalesce(r ->> 'state', 'allowed'), '22023');
  r := pg_temp.call_as(adm, format('select to_jsonb(public.admin_link_usage_statement(%L, %L))', v_st, v_inv));
  perform pg_temp.rec('2s an admin links the statement to the sponsor''s invoice', r::text, 'true');
  r := pg_temp.call_as(adm, format('select to_jsonb(public.admin_link_usage_statement(%L, %L))', v_st, v_inv));
  perform pg_temp.rec('2t a second link does nothing', r::text, 'false');
  r := pg_temp.call_as(cs, 'select public.sponsor_usage_statements()');
  perform pg_temp.rec('2u the sponsor now sees the invoice on the statement', (r -> 0 -> 'invoice' ->> 'id'), v_inv::text);

  -- =============================== 3. Pack and ledger ===============================
  insert into public.sponsor_report_snapshots (organisation_id, cohort_id, sponsor_org_id, period, payload, held_back)
    values (v_cons, v_cohort, v_sp, v_month, jsonb_build_object('cohort', jsonb_build_object('name', 'S79 Acme staff'), 'minimum_cell', 3,
      'bp_control_90d', jsonb_build_object('suppressed', true, 'reason', 'small_cell', 'n', 4, 'minimum', 3),
      'adherence_separate', jsonb_build_object('suppressed', false, 'n', 9, 'mean_pct', 80.5)), false);
  insert into public.sponsor_report_snapshots (organisation_id, cohort_id, sponsor_org_id, period, payload, held_back)
    values (v_cons, v_cohort, v_sp, (v_month - 31)::date - (extract(day from v_month - 31)::integer - 1), jsonb_build_object('held_back', true, 'reason', 'small_change', 'minimum', 3), true);
  r := pg_temp.call_as(cs, $q$select public.sponsor_privacy_ledger()$q$);
  perform pg_temp.rec('3a the ledger lists the withheld tile, the held-back month and the folded statement lines', jsonb_array_length(r -> 'entries')::text, '3');
  perform pg_temp.rec('3b the ledger carries reason words only, no count', (r::text !~ '"n"' and r::text !~ '"count": 4')::text, 'true');
  r := pg_temp.call_as(ns, $q$select public.sponsor_privacy_ledger()$q$);
  perform pg_temp.rec('3c another sponsor sees none of it', jsonb_array_length(r -> 'entries')::text, '0');
  r := pg_temp.call_as(pat, $q$select public.sponsor_privacy_ledger()$q$);
  perform pg_temp.rec('3d a patient is refused', coalesce(r ->> 'state', 'allowed'), '42501');

  select count(*) into v_n from public.audit_log where action = 'sponsor.staff_exported';
  r := pg_temp.call_as(cs, $q$select public.sponsor_procurement_pack('csv')$q$);
  perform pg_temp.rec('3e sponsor staff get the pack', (r ->> 'sponsor') || '/' || jsonb_array_length(r -> 'programmes'), 'S79 Acme Corp/1');
  perform pg_temp.rec('3f one audit row per programme and one for the pack', ((select count(*) from public.audit_log where action = 'sponsor.staff_exported') - v_n || '/' ||
      (select count(*) from public.audit_log where action = 'sponsor.pack_exported')), '1/1');
  perform pg_temp.rec('3g the pack uses the frozen figures and keeps the withheld tile withheld', (r -> 'programmes' -> 0 -> 'figures' -> 'bp_control_90d' ->> 'suppressed'), 'true');
  perform pg_temp.rec('3h the pack carries the approved configuration', (r -> 'configuration' ->> 'version'), '2');
  perform pg_temp.rec('3i the pack carries usage with the fold', (r -> 'usage' -> 0 ->> 'other_services_kobo'), '500000');
  r2 := pg_temp.call_as(cs, $q$select public.sponsor_procurement_pack('xml')$q$);
  perform pg_temp.rec('3j a bad format is refused', coalesce(r2 ->> 'state', 'allowed'), '22023');
  r2 := pg_temp.call_as(ns, $q$select public.sponsor_procurement_pack('pdf')$q$);
  perform pg_temp.rec('3k another sponsor''s pack holds none of this programme', jsonb_array_length(r2 -> 'programmes')::text, '0');
  r2 := pg_temp.call_as(clin, $q$select public.sponsor_procurement_pack('pdf')$q$);
  perform pg_temp.rec('3l a clinician is refused', coalesce(r2 ->> 'state', 'allowed'), '42501');

  -- =============================== 4. Eligibility upload ===============================
  insert into public.employer_departments (organisation_id, name) values (v_sp, 'Finance') returning id into v_dept;
  update public.profiles set phone = '+2348090000001' where id = pts[1];   -- a roster row needs a contact route
  insert into public.employer_roster_members (organisation_id, phone, full_name, status, claimed_profile_id, claimed_at) select v_sp, phone, 'Claimed One', 'claimed', id, now() from public.profiles where id = pts[1] returning id into v_ro1;
  update public.profiles set organisation_id = v_sp where id = pts[1];
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source) values (v_sp, pts[1], 'weight', 70, 'device');
  insert into public.employer_roster_members (organisation_id, phone, full_name, status) values (v_sp, '+2348090000002', 'Pending Two', 'pending') returning id into v_ro2;
  insert into public.employer_roster_members (organisation_id, phone, full_name, status) values (v_sp, '+2348090000003', 'Pending Three', 'pending') returning id into v_ro3;
  select phone into v_txt from public.profiles where id = pts[1];

  -- add mode, with problems in some rows
  r := pg_temp.call_as(cs, format($q$select public.employer_stage_roster_upload(%L, 'add', %L::jsonb, 'x.csv')$q$, v_sp, jsonb_build_array(
        jsonb_build_object('phone', '0803 111 2222', 'full_name', 'New Person', 'department', 'Finance'),
        jsonb_build_object('phone', 'not a number'),
        jsonb_build_object('phone', '08031112233', 'department', 'Finnance'),
        jsonb_build_object('phone', '+2348090000002', 'full_name', 'Pending Two Renamed'),
        jsonb_build_object('phone', '+2348090000002'),
        jsonb_build_object('email', 'a@example.invalid', 'employment_status', 'astronaut'))));
  v_batch := (r ->> 'batch_id')::uuid;
  perform pg_temp.rec('4a add staging counts', (r -> 'summary' ->> 'insert') || '/' || (r -> 'summary' ->> 'update') || '/' || (r -> 'summary' ->> 'errors'), '1/1/4');
  perform pg_temp.rec('4b nothing on the roster changed yet', (select count(*)::text from public.employer_roster_members where organisation_id = v_sp), '3');
  r := pg_temp.call_as(cs, format('select public.employer_roster_upload_report(%L)', v_batch));
  perform pg_temp.rec('4c the error report names the row and the reason', (r::text like '%unknown department: Finnance%' and r::text like '%phone is not a valid number%' and r::text like '%more than once%' and r::text like '%employment status%')::text, 'true');
  perform pg_temp.rec('4d the error report never repeats a full phone or email', (r::text !~ '08031112233' and r::text !~ 'a@example.invalid')::text, 'true');
  r := pg_temp.call_as(cs, format('select public.employer_roster_upload_preview(%L)', v_batch));
  perform pg_temp.rec('4e the preview masks contacts and lists errors first', ((r -> 'rows' -> 0 ->> 'status') = 'error' and r::text !~ '0803' and r::text !~ '8031112222')::text, 'true');
  r := pg_temp.call_as(cs, format('select public.employer_commit_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4f commit before approval is refused', r ->> 'reason', 'not_approved');
  r := pg_temp.call_as(cs, format('select public.employer_approve_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4g an add file with problem rows can be approved', r ->> 'ok', 'true');
  r := pg_temp.call_as(cs, format('select public.employer_commit_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4h commit applies the good rows through the existing upsert', (r -> 'applied' ->> 'inserted') || '/' || (r -> 'applied' ->> 'updated'), '1/1');
  perform pg_temp.rec('4i the local number was stored in international form', (select count(*)::text from public.employer_roster_members where organisation_id = v_sp and phone = '+2348031112222'), '1');
  perform pg_temp.rec('4j staged personal values are blanked after commit', (select count(*)::text from public.roster_upload_rows where batch_id = v_batch and norm is not null), '0');

  -- remove mode: ends the claimed person; the person keeps account and record
  r := pg_temp.call_as(cs, format($q$select public.employer_stage_roster_upload(%L, 'remove', %L::jsonb, null)$q$, v_sp, jsonb_build_array(jsonb_build_object('phone', v_txt))));
  v_batch := (r ->> 'batch_id')::uuid;
  perform pg_temp.rec('4k remove plans one ending', (r -> 'summary' ->> 'end'), '1');
  r := pg_temp.call_as(cs, format('select public.employer_approve_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4l the person who staged cannot also approve an ending file', r ->> 'reason', 'second_approver_needed');
  r := pg_temp.call_as(adm, format('select public.employer_approve_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4m a share this large needs Tarragon, and Tarragon can approve', r ->> 'ok', 'true');
  r := pg_temp.call_as(cs, format('select public.employer_commit_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4n commit ends the employer link', (r ->> 'ended') || '/' || (select status from public.employer_roster_members where id = v_ro1), '1/departed');
  perform pg_temp.rec('4o the person''s account and their own record are untouched', (select count(*)::text from public.profiles where id = pts[1]) || '/' || (select count(*)::text from public.vitals_readings where patient_id = pts[1]), '1/1');
  perform pg_temp.rec('4p the person returns to the default organisation', (select (organisation_id = v_cons)::text from public.profiles where id = pts[1]), 'true');

  -- remove with an error row is refused
  r := pg_temp.call_as(cs, format($q$select public.employer_stage_roster_upload(%L, 'remove', %L::jsonb, null)$q$, v_sp, jsonb_build_array(jsonb_build_object('phone', '+2348090000002'), jsonb_build_object('phone', 'bad'))));
  v_batch := (r ->> 'batch_id')::uuid;
  r := pg_temp.call_as(adm, format('select public.employer_approve_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4q a removal file with an error is refused whole', r ->> 'reason', 'has_errors');
  r := pg_temp.call_as(cs, format('select to_jsonb(public.employer_cancel_roster_upload(%L))', v_batch));
  perform pg_temp.rec('4r a staged file can be cancelled', r::text, 'true');

  -- replace mode: anyone not in the file is planned to leave; a person in an erroring row is not treated as absent
  r := pg_temp.call_as(cs2, format($q$select public.employer_stage_roster_upload(%L, 'replace', %L::jsonb, null)$q$, v_sp, jsonb_build_array(jsonb_build_object('phone', '+2348090000002'), jsonb_build_object('phone', '+2348090000003', 'employment_status', 'bad'))));
  v_batch := (r ->> 'batch_id')::uuid;
  perform pg_temp.rec('4s replace plans the absent people only (the new person added in 4h)', (r -> 'summary' ->> 'end') || '/' || (r -> 'summary' ->> 'errors'), '1/1');
  perform pg_temp.rec('4t the person in the erroring row is not planned to leave', (select count(*)::text from public.roster_upload_rows where batch_id = v_batch and kind = 'absent' and roster_member_id = v_ro3), '0');
  r := pg_temp.call_as(cs, format('select to_jsonb(public.employer_cancel_roster_upload(%L))', v_batch));
  perform pg_temp.rec('4u cancel blanks staged personal values', (select count(*)::text from public.roster_upload_rows where batch_id = v_batch and norm is not null), '0');

  -- another organisation, a patient and a clinician cannot use a batch or the table
  r := pg_temp.call_as(ns, format('select public.employer_roster_upload_preview(%L)', v_batch));
  perform pg_temp.rec('4v another organisation cannot read the batch', coalesce(r ->> 'state', 'allowed'), '42501');
  r := pg_temp.call_as(pat, format($q$select public.employer_stage_roster_upload(%L, 'add', '[{"phone":"+2348090000009"}]'::jsonb, null)$q$, v_sp));
  perform pg_temp.rec('4w a patient cannot stage', coalesce(r ->> 'state', 'allowed'), '42501');
  r := pg_temp.call_as(ns, format($q$select public.employer_stage_roster_upload(%L, 'add', '[{"phone":"+2348090000009"}]'::jsonb, null)$q$, v_sp));
  perform pg_temp.rec('4x another sponsor''s admin cannot stage for this organisation', coalesce(r ->> 'state', 'allowed'), '42501');

  -- the file ends a large share but is staged and approved by different people: Tarragon only
  r := pg_temp.call_as(cs, format($q$select public.employer_stage_roster_upload(%L, 'replace', %L::jsonb, null)$q$, v_sp, jsonb_build_array(jsonb_build_object('phone', '+2348090000002'))));
  v_batch := (r ->> 'batch_id')::uuid;
  r := pg_temp.call_as(cs2, format('select public.employer_approve_roster_upload(%L)', v_batch));
  perform pg_temp.rec('4y a different employer admin still cannot approve a large ending', r ->> 'reason', 'tarragon_approval_needed');

  -- =============================== 5. One enrolment-code entry ===============================
  update public.profiles set organisation_id = v_cons where id = pat;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, status)
    values (v_cons, v_sp2, 'S79 NGO programme', 'NGQPRQG2', current_date - 1, current_date + 90, 50, 'active');
  r := pg_temp.call_as(pat, $q$select public.enter_enrolment_code('ngqp-rqg2')$q$);
  perform pg_temp.rec('5a a programme code works, typed in lower case with a dash', (r ->> 'ok') || '/' || (r ->> 'kind'), 'true/programme');
  r := pg_temp.call_as(pat, $q$select public.enter_enrolment_code('EMPLQY22')$q$);
  perform pg_temp.rec('5b an employer code works through the same entry', (r ->> 'ok') || '/' || (r ->> 'kind'), 'true/employer');
  perform pg_temp.rec('5c the employer path really joined the roster', (select count(*)::text from public.employer_roster_members where organisation_id = v_sp and claimed_profile_id = pat and status = 'claimed'), '1');
  p := pg_temp.mkuser('patient');
  r := pg_temp.call_as(p, $q$select public.enter_enrolment_code('NOSUCHCD')$q$);
  r2 := pg_temp.call_as(p, $q$select public.enter_enrolment_code('PRQQFAA2')$q$);   -- a real code, but for a different organisation's cohort? same consumer org here, so it works
  perform pg_temp.rec('5d an unknown code answers only ok false', r::text, '{"ok": false}');
  -- ten bad tries stop even a good code
  for i in 1..10 loop perform pg_temp.call_as(p, $q$select public.enter_enrolment_code('BADCODE9')$q$); end loop;
  r := pg_temp.call_as(p, $q$select public.enter_enrolment_code('NGQPRQG2')$q$);
  perform pg_temp.rec('5e ten bad tries stop a good code', r::text, '{"ok": false}');
  -- a patient already attached to an employer cannot be moved by a code
  r := pg_temp.call_as(adm, $q$select public.enter_enrolment_code('NGQPRQG2')$q$);
  perform pg_temp.rec('5f a non-patient is refused quietly', r::text, '{"ok": false}');

  -- namespace guard
  begin
    insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_cons, v_sp, 'Collides', 'EMPLQY22', current_date, current_date + 5, 5);
    perform pg_temp.rec('5g a programme code equal to an employer code is refused', 'accepted', 'refused');
  exception when unique_violation then perform pg_temp.rec('5g a programme code equal to an employer code is refused', 'refused', 'refused'); end;
  begin
    update public.employer_accounts set join_code = 'NGQPRQG2' where organisation_id = v_sp;
    perform pg_temp.rec('5h an employer code equal to a programme code is refused', 'accepted', 'refused');
  exception when unique_violation then perform pg_temp.rec('5h an employer code equal to a programme code is refused', 'refused', 'refused'); end;

  -- overlap report is admin only and read only
  r := pg_temp.call_as(cs, $q$select public.admin_enrolment_code_overlap()$q$);
  perform pg_temp.rec('5i the overlap report is admin only', coalesce(r ->> 'state', 'allowed'), '42501');
  r := pg_temp.call_as(adm, $q$select public.admin_enrolment_code_overlap()$q$);
  perform pg_temp.rec('5j the overlap report shows no collision and one organisation running both', jsonb_array_length(r -> 'collisions')::text || '/' || (r ->> 'employer_codes'), '0/1');
  r := pg_temp.call_as(cs, $q$select public.sponsor_code_sheet()$q$);
  perform pg_temp.rec('5k the code sheet shows the sponsor''s own codes only', (r ->> 'organisation_code') || '/' || jsonb_array_length(r -> 'programmes'), 'EMPLQY22/1');

  -- =============================== 6. I9 and RLS ===============================
  foreach v_txt in array array['institution_config', 'institution_programme_configs', 'usage_records', 'usage_statements', 'usage_statement_invoice_links', 'roster_upload_batches', 'roster_upload_rows'] loop
    r := pg_temp.call_as(cs, 'select to_jsonb(count(*)) from public.' || v_txt);
    perform pg_temp.rec('6a sponsor staff cannot read ' || v_txt, coalesce(r ->> 'state', 'allowed'), '42501');
    r := pg_temp.call_as(pat, 'select to_jsonb(count(*)) from public.' || v_txt);
    perform pg_temp.rec('6b a patient cannot read ' || v_txt, coalesce(r ->> 'state', 'allowed'), '42501');
  end loop;
  -- everything a sponsor can fetch, as one string, holds no fixture person
  v_txt := '';
  v_txt := v_txt || (pg_temp.call_as(cs, 'select public.institution_config_current()'))::text || (pg_temp.call_as(cs, 'select public.sponsor_usage_statements()'))::text
        || (pg_temp.call_as(cs, 'select public.sponsor_privacy_ledger()'))::text || (pg_temp.call_as(cs, $q$select public.sponsor_procurement_pack('pdf')$q$))::text
        || (pg_temp.call_as(cs, 'select public.sponsor_code_sheet()'))::text || (pg_temp.call_as(ns, 'select public.sponsor_code_sheet()'))::text;
  perform pg_temp.rec('6c sponsor function output holds no patient id, name, phone or email', (not exists (select 1 from public.profiles pr where pr.role = 'patient' and (v_txt like '%' || pr.id::text || '%' or v_txt like '%' || pr.phone || '%' or v_txt like '%' || pr.full_name || '%')))::text, 'true');
  perform pg_temp.rec('6d and none of the roster people either', (v_txt !~ 'Pending Two' and v_txt !~ 'Claimed One' and v_txt !~ '8090000002')::text, 'true');
  perform pg_temp.rec('6e anon cannot execute any new function', (not exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace where n.nspname = 'public'
        and f.proname in ('institution_config_submit','institution_config_current','admin_review_institution_config','sponsor_usage_statements','admin_link_usage_statement','sponsor_privacy_ledger',
        'sponsor_procurement_pack','employer_stage_roster_upload','employer_roster_upload_preview','employer_roster_upload_report','employer_approve_roster_upload','employer_commit_roster_upload',
        'employer_cancel_roster_upload','enter_enrolment_code','admin_enrolment_code_overlap','sponsor_code_sheet','admin_institution_console')
        and has_function_privilege('anon', f.oid, 'EXECUTE')))::text, 'true');
  r := pg_temp.call_as(adm, 'select public.admin_institution_console()');
  perform pg_temp.rec('6f the admin worklist lists the statement and no request is waiting', jsonb_array_length(r -> 'statements')::text || '/' || jsonb_array_length(r -> 'requests'), '1/0');

  -- =============================== 7. SABOTAGE ===============================
  -- (a) the namespace trigger dropped: a colliding programme code must then be accepted (5g would FAIL)
  drop trigger sponsor_cohorts_code_namespace on public.sponsor_cohorts;
  begin
    insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_cons, v_sp, 'Collides', 'EMPLQY22', current_date, current_date + 5, 5);
    perform pg_temp.rec('7a SABOTAGE: without the trigger a colliding code is accepted (5g would FAIL)', 'accepted', 'accepted');
  exception when unique_violation then perform pg_temp.rec('7a SABOTAGE: without the trigger a colliding code is accepted (5g would FAIL)', 'refused', 'accepted'); end;
  -- with the collision now present, the one entry refuses to guess
  p := pg_temp.mkuser('patient');
  r := pg_temp.call_as(p, $q$select public.enter_enrolment_code('EMPLQY22')$q$);
  perform pg_temp.rec('7a2 an ambiguous code is refused and audited, not guessed', r::text || '/' || (select count(*)::text from public.audit_log where action = 'enrolment_code.ambiguous'), '{"ok": false}/1');
  r := pg_temp.call_as(adm, $q$select public.admin_enrolment_code_overlap()$q$);
  perform pg_temp.rec('7a3 the overlap report shows the collision', jsonb_array_length(r -> 'collisions')::text, '1');

  -- (b) the pathway check removed: a mental health pathway must then be accepted (1c would FAIL)
  select pg_get_functiondef('public.institution_config_submit(text[],text[],uuid[],bigint,text)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'if not (c = any (v_allowed)) then raise exception', 'if false then raise exception');
  if v_txt = pg_get_functiondef('public.institution_config_submit(text[],text[],uuid[],bigint,text)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute v_txt;
  r := pg_temp.call_as(cs, $q$select public.institution_config_submit(array['mental_health'], '{}', '{}', 100, null)$q$);
  perform pg_temp.rec('7b SABOTAGE: without the pathway check a mental health pathway is accepted (1c would FAIL)', coalesce(r ->> 'version', r ->> 'error'), '3');

  -- (c) the second-approver check removed: the person who staged an ending file can then approve it (4l would FAIL)
  select pg_get_functiondef('public.employer_approve_roster_upload(uuid)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'if v_ends > 0 and b.staged_by = v_uid and not private.is_admin()', 'if false and b.staged_by = v_uid and not private.is_admin()');
  v_txt := replace(v_txt, 'if v_ends > 0 and v_share >= (v_rules', 'if false and v_share >= (v_rules');
  if v_txt = pg_get_functiondef('public.employer_approve_roster_upload(uuid)'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute v_txt;
  r := pg_temp.call_as(cs, format($q$select public.employer_stage_roster_upload(%L, 'remove', %L::jsonb, null)$q$, v_sp, jsonb_build_array(jsonb_build_object('phone', '+2348090000003'))));
  v_batch := (r ->> 'batch_id')::uuid;
  r := pg_temp.call_as(cs, format('select public.employer_approve_roster_upload(%L)', v_batch));
  perform pg_temp.rec('7c SABOTAGE: without the check the stager approves their own ending file (4l would FAIL)', r ->> 'ok', 'true');

  -- (d) folding removed: the one-person consult line is then shown by name (2j would FAIL)
  select pg_get_functiondef('private.generate_usage_statements(timestamptz)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'if private.suppress_cell(v_people, null, v_min) is null then', 'if true then');
  if v_txt = pg_get_functiondef('private.generate_usage_statements(timestamptz)'::regprocedure) then raise exception 'sabotage (d) did not change the function'; end if;
  execute v_txt;
  alter table public.usage_statement_invoice_links disable trigger usage_links_write_once;
  alter table public.usage_statements disable trigger usage_statements_write_once;
  delete from public.usage_statement_invoice_links where statement_id = v_st;
  delete from public.usage_statements where id = v_st;
  alter table public.usage_statements enable trigger usage_statements_write_once;
  alter table public.usage_statement_invoice_links enable trigger usage_links_write_once;
  perform private.generate_usage_statements((date_trunc('month', v_month + 40)::date + 5)::timestamp at time zone 'Africa/Lagos');
  perform pg_temp.rec('7d SABOTAGE: without the fold the one-person line is shown (2j would FAIL)', (select jsonb_array_length(payload -> 'lines')::text from public.usage_statements where sponsor_org_id = v_sp and period = v_month), '2');
end $$;

select * from s79_results order by check_name;

do $$
begin
  if exists (select 1 from s79_results where verdict = 'FAIL') then
    raise exception 'S79 proof: % check(s) FAILED', (select count(*) from s79_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
