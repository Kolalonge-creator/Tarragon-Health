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
  values (v, 's71-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S71 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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

-- extra helpers ---------------------------------------------------------------------------------------------------------------
create function pg_temp.mkc(p_uid uuid, p_code text, p_ben uuid default null, p_expected bigint default null) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_uid, format($q$select public.create_order(%L, gen_random_uuid(), %L, null, false, %L)::text$q$, p_code, p_ben, p_expected));
  if r like 'ERR:%' then return jsonb_build_object('error', r); end if;
  return r::jsonb;
end $f$;
-- a quote with an optional beneficiary, whole
create function pg_temp.qb(p_uid uuid, p_code text, p_ben uuid default null) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_uid, format($q$select (public.price_quote(%L, %L, null, false))::text$q$, p_code, p_ben));
  if r like 'ERR:%' then return jsonb_build_object('error', r); end if;
  return r::jsonb;
end $f$;
create function pg_temp.cnt(p_uid uuid, p_sql text) returns text language sql as $$ select pg_temp.q_as(p_uid, p_sql) $$;
create function pg_temp.try_as_state(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a SQL text that returns one uuid as an admin (admin functions read auth.uid())
create function pg_temp.as_admin_uuid(p_sql text) returns uuid language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('admin'), p_sql);
  if r like 'ERR:%' then raise exception 'admin call failed: %', r; end if;
  return r::uuid;
end $f$;
create function pg_temp.mkprog(p_sponsor uuid, p_name text, p_items text[], p_share int, p_budget bigint, p_cap bigint, p_elig text, p_cohort uuid, p_days int, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.as_admin_uuid(format($q$select public.admin_create_sponsor_programme(%L, %L, %L::text[], %s, %s, %L, %L, %L, %L, current_date - 1, current_date + 60, 'Proof run: programme created for the proof', %L)::text$q$,
        p_sponsor, p_name, p_items, p_share, p_budget, p_cap, p_elig, p_cohort, p_days, p_test));
  perform pg_temp.try_as(pg_temp.f('admin'), format($q$select public.admin_set_sponsor_programme_status(%L, 'active', 'Proof run: programme approved for the proof')$q$, v));
  return v;
end $f$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_item uuid; v_sp uuid; v_hmo uuid; v_coh uuid; v_prog uuid; v_progh uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('clin', pg_temp.mkuser(v_org, 'clin', 'clinician'));
    perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat_m', pg_temp.mkuser(v_org, 'member1', 'patient'));
  perform pg_temp.setf('pat_m2', pg_temp.mkuser(v_org, 'member2', 'patient'));
  perform pg_temp.setf('pat_m3', pg_temp.mkuser(v_org, 'member3', 'patient'));
  perform pg_temp.setf('pat_o', pg_temp.mkuser(v_org, 'outsider', 'patient'));
  perform pg_temp.setf('pat_h', pg_temp.mkuser(v_org, 'hmo1', 'patient'));
  perform pg_temp.setf('pat_h2', pg_temp.mkuser(v_org, 'hmo2', 'patient'));
  perform pg_temp.setf('g_view', pg_temp.mkuser(v_org, 'gview', 'patient'));
  perform pg_temp.setf('g_mgr', pg_temp.mkuser(v_org, 'gmgr', 'patient'));
  perform pg_temp.setf('g_pay', pg_temp.mkuser(v_org, 'gpay', 'patient'));
  perform pg_temp.setf('g_full', pg_temp.mkuser(v_org, 'gfull', 'patient'));
  perform pg_temp.setf('g_exp', pg_temp.mkuser(v_org, 'gexp', 'patient'));
  perform pg_temp.setf('g_circle', pg_temp.mkuser(v_org, 'gcircle', 'patient'));
  perform pg_temp.setf('g_empty', pg_temp.mkuser(v_org, 'gempty', 'patient'));
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient'));
  -- an item priced 5,000 naira: 3,000 owed to a partner, 2,000 Tarragon's own service fee
  -- main-dev's two-tier rule (catalog_items_only_membership_sellable) allows only the Membership to be active in the real catalog. This proof exercises the generic
  -- checkout and pricing machinery with consultation items, so the rule is lifted for this rolled-back transaction only.
  alter table public.catalog_items drop constraint if exists catalog_items_only_membership_sellable;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_consult', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 2, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason)
  values (v_org, v_item, 500000, '{"partner_fee":300000,"tarragon_service_fee":200000}', 'proof');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_plain', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 800000, '{}', 'proof');
  -- a bounded item for a sponsor-paid membership-like entitlement
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
  values (v_org, 'proof_pack', 'lab_panel', 'catalog.proof.name', 'catalog.proof.description', 60, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 300000, '{}', 'proof');
  -- sponsors
  insert into public.organisations (name, type) values ('S71 Acme Ltd', 'corporate') returning id into v_sp;
  insert into public.organisations (name, type) values ('S71 Proof HMO', 'hmo') returning id into v_hmo;
  perform pg_temp.setf('sponsor', v_sp); perform pg_temp.setf('hmo', v_hmo);
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
  values (v_org, v_sp, 'S71 proof cohort', 'PRQFSX72', current_date - 1, current_date + 100, 50, true) returning id into v_coh;
  perform pg_temp.setf('cohort', v_coh);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test)
  select v_org, pg_temp.f(k), v_coh, true from (values ('pat_m'), ('pat_m2'), ('pat_m3')) as t(k);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S71 proof run' where key = 'v5_checkout';
end $$;

-- 1. What the migration left behind ---------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('the two new guards exist and are off', '2', (select count(*)::text from public.go_live_guards where key in ('checkout_enabled', 'sponsor_payment_enabled') and not is_on));
  perform pg_temp.ck('the three placeholders exist, are off, and have no price row', '3,0,0',
    (select count(*)::text || ',' || count(*) filter (where active)::text || ',' || count(*) filter (where (private.current_price(id)).id is not null)::text
       from public.catalog_items where code in ('consultation_single', 'lab_panel_standard', 'home_kit_sample') and organisation_id = pg_temp.f('org')));
  perform pg_temp.ck('a placeholder cannot be switched on without a price', 'true',
    (pg_temp.try_as(pg_temp.f('admin'), $q$select public.set_catalog_item_active('home_kit_sample', true, 'Proof run: trying to switch on a placeholder')$q$) like '%item_has_no_price%')::text);
  perform pg_temp.ck('the home_kit kind is allowed and an entitlement of that kind is allowed', 'ok',
    pg_temp.owner_sql($q$select 1 where exists (select 1 from pg_constraint where conrelid = 'public.entitlements'::regclass and pg_get_constraintdef(oid) like '%home_kit%')$q$));
  perform pg_temp.ck('sponsor_entitlement.granted is registered with ids only', 'order_id,programme_id',
    (select array_to_string(required_keys, ',') from public.event_type_versions where event_type = 'sponsor_entitlement.granted' and version = 1));
  perform pg_temp.ck('the sponsor rules v1 are the active row', '5',
    (select (rules ->> 'hmo_checks_per_day') from public.sponsor_config where is_active and version = 1));
  perform pg_temp.ck('the wrapped go-live conditions still answer for the older guards', 'true',
    (jsonb_array_length(private.go_live_conditions('membership_billing_enabled', null)) >= 4 and jsonb_array_length(private.go_live_conditions('clinical_operations_enabled', null)) >= 4
     and jsonb_array_length(private.go_live_conditions('checkout_enabled', null)) >= 4 and jsonb_array_length(private.go_live_conditions('sponsor_payment_enabled', null)) >= 3)::text);
  perform pg_temp.ck('an unknown guard still fails closed through the wrapper', 'false',
    (private.go_live_conditions('no_such_guard', null) -> 0 ->> 'met'));
  perform pg_temp.ck('create_order has exactly one signature', '1',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_order'));
  perform pg_temp.ck('the ledger has a sponsor receivable account', '1210', (select code from public.finance_accounts where code = '1210'));
end $$;

-- 2. OQ-192: who may pay for another person -------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); r text;
begin
  -- grants on the patient 'pat'
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level) values (v_pat, pg_temp.f('g_view'), v_pat, 'view');
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level, permissions)
    values (v_pat, pg_temp.f('g_mgr'), v_pat, 'manage', array['view_results']::public.caregiver_permission[]);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level, permissions)
    values (v_pat, pg_temp.f('g_pay'), v_pat, 'manage', array['manage_payments']::public.caregiver_permission[]);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level)
    values (v_pat, pg_temp.f('g_full'), v_pat, 'manage');
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level, permissions, expires_at)
    values (v_pat, pg_temp.f('g_exp'), v_pat, 'manage', array['manage_payments']::public.caregiver_permission[], now() + interval '1 hour');
  update public.profile_access set created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where grantee_user_id = pg_temp.f('g_exp');
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level, permissions)
    values (v_pat, pg_temp.f('g_empty'), v_pat, 'manage', array[]::public.caregiver_permission[]);
  -- a Care Circle supporter holding pay_for_care (the S29 path)
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, v_pat, pg_temp.f('g_circle'), 'sibling', array['pay_for_care'], now() + interval '30 days', true);

  perform pg_temp.ck('a bare view grantee cannot pay for the patient (OQ-192)', 'true', (pg_temp.qb(pg_temp.f('g_view'), 'proof_consult', v_pat) ->> 'error' like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('a manage grantee without manage_payments cannot pay', 'true', (pg_temp.qb(pg_temp.f('g_mgr'), 'proof_consult', v_pat) ->> 'error' like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('a manage grantee with an EMPTY permission list cannot pay', 'true', (pg_temp.qb(pg_temp.f('g_empty'), 'proof_consult', v_pat) ->> 'error' like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('an expired manage grant cannot pay', 'true', (pg_temp.qb(pg_temp.f('g_exp'), 'proof_consult', v_pat) ->> 'error' like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('a stranger cannot pay', 'true', (pg_temp.qb(pg_temp.f('stranger'), 'proof_consult', v_pat) ->> 'error' like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('CONTROL: a manage grantee holding manage_payments can be quoted for the patient', '500000', pg_temp.qb(pg_temp.f('g_pay'), 'proof_consult', v_pat) ->> 'amount_due_kobo');
  perform pg_temp.ck('CONTROL: a full manage grantee (no permission list) can be quoted for the patient', '500000', pg_temp.qb(pg_temp.f('g_full'), 'proof_consult', v_pat) ->> 'amount_due_kobo');
  perform pg_temp.ck('CONTROL: a Care Circle member with pay_for_care can be quoted for the patient', '500000', pg_temp.qb(pg_temp.f('g_circle'), 'proof_consult', v_pat) ->> 'amount_due_kobo');
  perform pg_temp.ck('CONTROL: the patient can be quoted for themselves', '500000', pg_temp.qb(v_pat, 'proof_consult') ->> 'amount_due_kobo');
  -- create_order for someone else goes through the same check (only the full yearly Membership may be a gift, so the refusal that matters is the payer check first)
  r := pg_temp.q_as(pg_temp.f('g_view'), format($q$select public.create_order('proof_consult', gen_random_uuid(), %L)::text$q$, v_pat));
  perform pg_temp.ck('create_order refuses a bare view grantee as well', 'true', (r like '%order_beneficiary_not_allowed%')::text);
  r := pg_temp.q_as(pg_temp.f('g_pay'), format($q$select public.create_order('proof_consult', gen_random_uuid(), %L)::text$q$, v_pat));
  perform pg_temp.ck('CONTROL: create_order passes the payer check for a manage_payments grantee (then stops at the gift-item rule)', 'true', (r like '%gift_item_not_allowed%')::text);
end $$;

-- 2b. OQ-192: the older read paths --------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); v_fac uuid; v_ex uuid; v_acc uuid;
begin
  perform pg_temp.ck('profiles_select no longer carries the bare EXISTS clause', 'false',
    (select (qual ~ 'EXISTS \( SELECT 1\s+FROM profile_access pa\s+WHERE \(\(pa\.profile_id = profiles\.id\) AND \(pa\.grantee_user_id = \( SELECT auth\.uid\(\) AS uid\)\)\)\)')::text from pg_policies where tablename = 'profiles' and policyname = 'profiles_select'));
  perform pg_temp.ck('the four older SELECT policies no longer contain a bare grantee clause', '0',
    (select count(*)::text from pg_policies where schemaname = 'public' and policyname in ('profiles_select', 'booking_requests_select', 'vaccination_adverse_events_select', 'vaccination_card_extractions_select')
        and qual ~ 'grantee_user_id = \( SELECT auth\.uid\(\) AS uid\)\)\)\)'));
  perform pg_temp.ck('the owner reads their own profile row', '1', pg_temp.cnt(v_pat, format($q$select count(*)::text from public.profiles where id = %L$q$, v_pat)));
  perform pg_temp.ck('a full grantee (no permission list) still reads the profile row they follow', '1', pg_temp.cnt(pg_temp.f('g_full'), format($q$select count(*)::text from public.profiles where id = %L$q$, v_pat)));
  perform pg_temp.ck('a grantee with an EMPTY permission list does not read the profile row', '0', pg_temp.cnt(pg_temp.f('g_empty'), format($q$select count(*)::text from public.profiles where id = %L$q$, v_pat)));
  perform pg_temp.ck('an expired grantee does not read the profile row', '0', pg_temp.cnt(pg_temp.f('g_exp'), format($q$select count(*)::text from public.profiles where id = %L$q$, v_pat)));
  perform pg_temp.ck('a stranger does not read the profile row', '0', pg_temp.cnt(pg_temp.f('stranger'), format($q$select count(*)::text from public.profiles where id = %L$q$, v_pat)));

  insert into public.facilities (name, type, state, city) values ('S71 proof clinic', 'hospital', 'Lagos', 'Lagos') returning id into v_fac;
  insert into public.booking_requests (organisation_id, profile_id, facility_id, service_type, requested_date) values (v_org, v_pat, v_fac, 'consultation', current_date + 3);
  perform set_config('request.jwt.claim.sub', v_pat::text, true);   -- only the patient may change who sees their record
  update public.profile_access set clinical_access = true where grantee_user_id = pg_temp.f('g_pay');          -- manage_payments only
  update public.profile_access set clinical_access = true, permissions = array['view_appointments']::public.caregiver_permission[] where grantee_user_id = pg_temp.f('g_full');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.ck('booking requests: the owner reads them', '1', pg_temp.cnt(v_pat, format($q$select count(*)::text from public.booking_requests where profile_id = %L$q$, v_pat)));
  perform pg_temp.ck('booking requests: a bare view grantee is refused', '0', pg_temp.cnt(pg_temp.f('g_view'), format($q$select count(*)::text from public.booking_requests where profile_id = %L$q$, v_pat)));
  perform pg_temp.ck('booking requests: a grantee with only manage_payments (clinical access on) is refused', '0', pg_temp.cnt(pg_temp.f('g_pay'), format($q$select count(*)::text from public.booking_requests where profile_id = %L$q$, v_pat)));
  perform pg_temp.ck('booking requests: CONTROL: a grantee with view_appointments and clinical access reads them', '1', pg_temp.cnt(pg_temp.f('g_full'), format($q$select count(*)::text from public.booking_requests where profile_id = %L$q$, v_pat)));

  insert into public.vaccination_card_extractions (organisation_id, patient_id, source_path) values (v_org, v_pat, 'proof/card.png');
  perform pg_temp.ck('vaccination card extractions: the owner reads them', '1', pg_temp.cnt(v_pat, format($q$select count(*)::text from public.vaccination_card_extractions where patient_id = %L$q$, v_pat)));
  perform pg_temp.ck('vaccination card extractions: a bare view grantee is refused', '0', pg_temp.cnt(pg_temp.f('g_view'), format($q$select count(*)::text from public.vaccination_card_extractions where patient_id = %L$q$, v_pat)));
  select id into v_acc from public.profile_access where grantee_user_id = pg_temp.f('g_full');
  -- the patient grants the vaccinations category (the owner-only trigger reads auth.uid())
  perform set_config('request.jwt.claim.sub', v_pat::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_acc, 'vaccinations');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.ck('vaccination card extractions: CONTROL: a grantee holding the vaccinations category reads them', '1', pg_temp.cnt(pg_temp.f('g_full'), format($q$select count(*)::text from public.vaccination_card_extractions where patient_id = %L$q$, v_pat)));
end $$;

-- 3. Sponsor programmes: creation, immutability, RLS ----------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_org uuid := pg_temp.f('org'); v_sp uuid := pg_temp.f('sponsor'); v_hmo uuid := pg_temp.f('hmo'); v_p uuid; r text;
begin
  perform pg_temp.ck('a patient cannot create a programme', 'true', (pg_temp.try_as(pg_temp.f('pat'), format($q$select public.admin_create_sponsor_programme(%L, 'Nope programme', array['proof_consult'], 100, 1000000, null, 'cohort', %L, null, current_date, current_date + 30, 'A patient trying this', true)$q$, v_sp, pg_temp.f('cohort'))) like '%sponsor_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot create a programme', 'true', (pg_temp.try_as(pg_temp.f('clin'), format($q$select public.admin_create_sponsor_programme(%L, 'Nope programme', array['proof_consult'], 100, 1000000, null, 'cohort', %L, null, current_date, current_date + 30, 'A clinician trying this', true)$q$, v_sp, pg_temp.f('cohort'))) like '%sponsor_not_authorised%')::text);
  perform pg_temp.ck('anon cannot create a programme', '42501', pg_temp.try_anon(format($q$select public.admin_create_sponsor_programme(%L, 'Nope programme', array['proof_consult'], 100, 1000000, null, 'cohort', %L, null, current_date, current_date + 30, 'Anon trying this', true)$q$, v_sp, pg_temp.f('cohort'))));
  perform pg_temp.ck('a reason is needed', 'true', (pg_temp.try_as(v_admin, format($q$select public.admin_create_sponsor_programme(%L, 'Short reason', array['proof_consult'], 100, 1000000, null, 'cohort', %L, null, current_date, current_date + 30, 'short', true)$q$, v_sp, pg_temp.f('cohort'))) like '%sponsor_reason_needed%')::text);
  perform pg_temp.ck('an unknown item is refused', 'true', (pg_temp.try_as(v_admin, format($q$select public.admin_create_sponsor_programme(%L, 'Unknown item', array['no_such_item'], 100, 1000000, null, 'cohort', %L, null, current_date, current_date + 30, 'Proof run: unknown item', true)$q$, v_sp, pg_temp.f('cohort'))) like '%unknown_item%')::text);
  perform pg_temp.ck('a share above 100 percent is refused by the database', 'true', (pg_temp.try_as(v_admin, format($q$select public.admin_create_sponsor_programme(%L, 'Too generous', array['proof_consult'], 101, 1000000, null, 'cohort', %L, null, current_date, current_date + 30, 'Proof run: bad share', true)$q$, v_sp, pg_temp.f('cohort'))) like '%share_percent%')::text);
  perform pg_temp.ck('an HMO programme needs a check validity in days', 'true', (pg_temp.try_as(v_admin, format($q$select public.admin_create_sponsor_programme(%L, 'No validity', array['proof_plain'], 50, 1000000, null, 'hmo_eligibility', null, null, current_date, current_date + 30, 'Proof run: no validity', true)$q$, v_hmo)) like '%violates check constraint%')::text);

  -- the two proof programmes (test programmes: a test patient passes the guard, as in S37)
  v_p := pg_temp.as_admin_uuid(format($q$select public.admin_create_sponsor_programme(%L, 'S71 Acme employee cover', array['proof_consult', 'proof_pack'], 100, 1000000, null, 'cohort', %L, null, current_date - 1, current_date + 60, 'Proof run: employer cover', true)::text$q$, v_sp, pg_temp.f('cohort')));
  perform pg_temp.setf('prog_c', v_p);
  perform pg_temp.ck('programmes are created as drafts', 'draft', (select status from public.sponsor_programmes where id = v_p));
  perform pg_temp.ck('a draft covers nothing: the member is quoted the full price', '500000', pg_temp.qb(pg_temp.f('pat_m'), 'proof_consult') ->> 'amount_due_kobo');
  perform pg_temp.ck('the admin activates it', 'ok', pg_temp.try_as(v_admin, format($q$select public.admin_set_sponsor_programme_status(%L, 'active', 'Proof run: employer cover approved')$q$, v_p)));
  v_p := pg_temp.mkprog(v_hmo, 'S71 HMO member cover', array['proof_plain'], 50, 2000000, 300000, 'hmo_eligibility', null, 30);
  perform pg_temp.setf('prog_h', v_p);

  -- what a programme IS cannot change
  perform pg_temp.ck('a programme cannot be deleted', 'sponsor_programme_immutable', pg_temp.owner_sql(format($q$delete from public.sponsor_programmes where id = %L$q$, pg_temp.f('prog_c'))));
  perform pg_temp.ck('its items cannot be changed', 'sponsor_programme_immutable', pg_temp.owner_sql(format($q$update public.sponsor_programmes set item_codes = array['proof_plain'] where id = %L$q$, pg_temp.f('prog_c'))));
  perform pg_temp.ck('its share cannot be changed', 'sponsor_programme_immutable', pg_temp.owner_sql(format($q$update public.sponsor_programmes set share_percent = 50 where id = %L$q$, pg_temp.f('prog_c'))));
  perform pg_temp.ck('its budget cannot be changed by a plain update', 'sponsor_programme_immutable', pg_temp.owner_sql(format($q$update public.sponsor_programmes set budget_kobo = 99999999 where id = %L$q$, pg_temp.f('prog_c'))));
  perform pg_temp.ck('its end date cannot be pushed out', 'sponsor_programme_immutable', pg_temp.owner_sql(format($q$update public.sponsor_programmes set valid_to = valid_to + 30 where id = %L$q$, pg_temp.f('prog_c'))));

  -- RLS per role: nobody reads the tables directly
  foreach r in array array['sponsor_programmes', 'sponsor_reservations', 'hmo_eligibility_checks', 'sponsor_config'] loop
    perform pg_temp.ck('patient is refused direct select on ' || r, '42501', pg_temp.try_as_state(pg_temp.f('pat'), 'select * from public.' || r || ' limit 1'));
    perform pg_temp.ck('clinician is refused direct select on ' || r, '42501', pg_temp.try_as_state(pg_temp.f('clin'), 'select * from public.' || r || ' limit 1'));
    perform pg_temp.ck('admin is refused direct select on ' || r || ' (functions only)', '42501', pg_temp.try_as_state(v_admin, 'select * from public.' || r || ' limit 1'));
    perform pg_temp.ck('anon is refused direct select on ' || r, '42501', pg_temp.try_anon('select * from public.' || r || ' limit 1'));
  end loop;
  perform pg_temp.ck('admin reads the programmes through the audited function', '2', pg_temp.q_as(v_admin, $q$select jsonb_array_length(public.admin_sponsor_programmes())::text$q$));
  perform pg_temp.ck('a patient is refused the programme list', 'true', (pg_temp.try_as(pg_temp.f('pat'), $q$select public.admin_sponsor_programmes()$q$) like '%sponsor_not_authorised%')::text);
  perform pg_temp.ck('a clinician is refused the programme list', 'true', (pg_temp.try_as(pg_temp.f('clin'), $q$select public.admin_sponsor_programmes()$q$) like '%sponsor_not_authorised%')::text);
  perform pg_temp.ck('anon is refused the programme list', '42501', pg_temp.try_anon($q$select public.admin_sponsor_programmes()$q$));
end $$;

-- 4. A sponsor-paid item has no payment step -----------------------------------------------------------------------------------
do $$
declare v_m uuid := pg_temp.f('pat_m'); q jsonb; o jsonb; v_oid uuid; v_ent record; v_sum bigint; v_n integer;
begin
  q := pg_temp.qb(v_m, 'proof_consult');
  perform pg_temp.ck('the member is quoted nothing to pay', '0', q ->> 'amount_due_kobo');
  perform pg_temp.ck('the quote says it is covered in full', 'true', q ->> 'covered_in_full');
  perform pg_temp.ck('the quote names the sponsor', 'S71 Acme Ltd', q ->> 'sponsor_name');
  perform pg_temp.ck('the quote carries no programme id to the buyer', 'null', coalesce(q ->> 'sponsor_programme_id', 'null'));
  select coalesce(sum((l ->> 'amount_kobo')::bigint), 0) into v_sum from jsonb_array_elements(q -> 'lines') l;
  perform pg_temp.ck('the quote lines add up to the amount due (list plus the sponsor line)', '0', v_sum::text);
  -- a supporter paying for the member neither gets the cover nor learns the member has one (OQ-223)
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level, permissions)
    values (v_m, pg_temp.f('g_pay'), v_m, 'manage', array['manage_payments']::public.caregiver_permission[]);
  q := pg_temp.qb(pg_temp.f('g_pay'), 'proof_consult', v_m);
  perform pg_temp.ck('a supporter paying for the member is quoted the full price with no sponsor named', '500000,0,null', (q ->> 'amount_due_kobo') || ',' || (q ->> 'sponsor_share_kobo') || ',' || coalesce(q ->> 'sponsor_name', 'null'));
  perform pg_temp.ck('a non-member is quoted the full price, no sponsor', '500000,0', (pg_temp.qb(pg_temp.f('pat_o'), 'proof_consult') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(pg_temp.f('pat_o'), 'proof_consult') ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('an item the programme does not list is full price for the member', '800000', pg_temp.qb(v_m, 'proof_plain') ->> 'amount_due_kobo');
  perform pg_temp.ck('the total shown (0) is accepted as the expected amount', 'true', (pg_temp.mkc(v_m, 'proof_consult', null, 0) ->> 'covered')::text);

  o := pg_temp.mkc(pg_temp.f('pat_m2'), 'proof_consult');
  perform pg_temp.ck('a second member: the order is covered', 'true', o ->> 'covered');
  perform pg_temp.ck('...and paid at once', 'paid', o ->> 'state');
  perform pg_temp.ck('...with amount 0, no checkout link', '0,null', (o ->> 'amount_kobo') || ',' || coalesce(o ->> 'checkout_url', 'null'));
  perform pg_temp.ck('...a sponsor-only reference that is never sent to Paystack', 'true', (o ->> 'reference' like 'spo_%')::text);
  v_oid := (o ->> 'order_id')::uuid;
  select * into v_ent from public.entitlements where order_id = v_oid;
  perform pg_temp.ck('the entitlement exists, is active and carries the item uses', 'active,2', v_ent.state || ',' || v_ent.remaining_uses);
  perform pg_temp.ck('it belongs to the member', 'true', (v_ent.patient_id = pg_temp.f('pat_m2'))::text);
  perform pg_temp.ck('no payment row exists for it (no payment step)', '0', (select count(*)::text from public.payments where order_id = v_oid));
  perform pg_temp.ck('the order is paid with fee 0 and total 0', 'paid,0,0', (select state || ',' || fee_kobo || ',' || total_kobo from public.orders where id = v_oid));
  perform pg_temp.ck('the reservation is committed for the full price', 'committed,500000', (select state || ',' || amount_kobo from public.sponsor_reservations where order_id = v_oid));
  perform pg_temp.ck('order.paid was emitted once', '1', (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = v_oid));
  perform pg_temp.ck('sponsor_entitlement.granted was emitted once', '1', (select count(*)::text from public.domain_events where event_type = 'sponsor_entitlement.granted' and aggregate_id = v_oid));
  perform pg_temp.ck('the event carries ids and codes only', 'code,kind,order_id,programme_id',
    (select string_agg(k, ',' order by k) from public.domain_events e, jsonb_object_keys(e.payload) k where e.event_type = 'sponsor_entitlement.granted' and e.aggregate_id = v_oid));
  perform pg_temp.ck('the buyer sees the sponsor in their order list', 'S71 Acme Ltd,500000',
    pg_temp.q_as(pg_temp.f('pat_m2'), $q$select (select (j ->> 'sponsor_name') || ',' || (j ->> 'sponsor_share_kobo') from jsonb_array_elements(public.my_orders()) j limit 1)$q$));
  perform pg_temp.ck('a repeat of the same tap is the same order', 'true',
    (pg_temp.q_as(pg_temp.f('pat_m2'), format($q$select public.create_order('proof_consult', %L, null)::text$q$, (select client_key from public.orders where id = v_oid))) like '%"replay": true%')::text);
  perform pg_temp.ck('...and a repeat of a covered order still says it is covered, naming the sponsor', 'true,S71 Acme Ltd',
    (select (r ->> 'covered') || ',' || (r ->> 'sponsor_name') from (select pg_temp.q_as(pg_temp.f('pat_m2'), format($q$select public.create_order('proof_consult', %L, null)::text$q$, (select client_key from public.orders where id = v_oid)))::jsonb as r) x));
  perform pg_temp.ck('...and takes no more budget', '2', (select count(*)::text from public.sponsor_reservations where programme_id = pg_temp.f('prog_c')));
  perform pg_temp.ck('a refund request on a covered order says the sponsor paid', 'covered_by_sponsor',
    pg_temp.q_as(pg_temp.f('pat_m2'), format($q$select public.request_order_refund(%L, 'Proof run: asking for a refund')->>'result'$q$, v_oid)));
  perform pg_temp.ck('a payment webhook for the sponsor-only reference is a mismatch, never a second payment', 'mismatch',
    pg_temp.pay(o ->> 'reference', 500000));
  perform pg_temp.ck('and it did not change the order', 'paid', (select state from public.orders where id = v_oid));
  perform pg_temp.ck('the buyer cannot read other people''s reservations (no direct table access)', '42501', pg_temp.try_as_state(pg_temp.f('pat_m2'), 'select * from public.sponsor_reservations'));

  -- the ledger: the sponsor owes the whole price, nothing was paid by the buyer (a test order is not posted unless asked, so ask)
  perform pg_temp.owner_sql(format($q$select private.post_order_to_ledger(%L, true)$q$, v_oid));
  perform pg_temp.ck('ledger: the covered order debits the sponsor receivable, credits revenue, balanced, with no clearing line', '1210:500000:0|4100:0:500000',
    (select string_agg(l.account_code || ':' || l.debit_minor || ':' || l.credit_minor, '|' order by l.account_code)
       from public.finance_journal_entries e join public.finance_journal_lines l on l.entry_id = e.id where e.source = 'payment' and e.source_ref = 'order:' || v_oid));

  -- the budget is a ceiling: 1,000,000 with two covered orders of 500,000 is full
  select count(*) into v_n from public.sponsor_reservations where programme_id = pg_temp.f('prog_c') and state = 'committed';
  perform pg_temp.ck('two covered orders are committed', '2', v_n::text);
  perform pg_temp.ck('the budget left is 0', '0', (select private.sponsor_budget_left(pg_temp.f('prog_c')))::text);
  q := pg_temp.qb(pg_temp.f('pat_m3'), 'proof_consult');
  perform pg_temp.ck('with the budget used up the third member is quoted the full price (no silent promise)', '500000,0', (q ->> 'amount_due_kobo') || ',' || (q ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('...the quote flags the exhausted budget', 'true', q ->> 'sponsor_budget_short');
  o := pg_temp.mkc(pg_temp.f('pat_m3'), 'proof_consult');
  perform pg_temp.ck('...and the order is an ordinary Paystack order', 'false,tho_,500000', coalesce(o ->> 'covered', 'false') || ',' || substr(o ->> 'reference', 1, 4) || ',' || (o ->> 'amount_kobo'));
  perform pg_temp.setf('o3', (o ->> 'order_id')::uuid);
  perform pg_temp.ck('reserving more than is left is refused by the database', 'true',
    (pg_temp.owner_sql(format($q$select private.sponsor_reserve(%L, %L, 1)$q$, pg_temp.f('o3'), pg_temp.f('prog_c'))) like '%sponsor_budget_exhausted%')::text);
  perform pg_temp.ck('the reserved plus committed total never exceeds the budget', 'true',
    (select (coalesce(sum(r.amount_kobo), 0) <= max(p.budget_kobo))::text from public.sponsor_reservations r join public.sponsor_programmes p on p.id = r.programme_id where r.programme_id = pg_temp.f('prog_c') and r.state in ('reserved', 'committed')));
end $$;

-- 5. A part-paid order: reservation, release on cancel, commit on pay, release on refund, per-person cap --------------------------
create function pg_temp.hmo_pass(p_uid uuid, p_number text) returns uuid language plpgsql as
$f$ declare r text; v_id uuid;
begin
  r := pg_temp.q_as(p_uid, format($q$select (public.request_hmo_eligibility(%L, %L))->>'check_id'$q$, pg_temp.f('hmo'), p_number));
  if r like 'ERR:%' then raise exception 'hmo request failed: %', r; end if;
  v_id := r::uuid;
  perform pg_temp.svc(format($q$select (public.record_hmo_eligibility_result(%L, 'eligible', 'proof_adapter'))->>'result'$q$, v_id));
  return v_id;
end $f$;

do $$
declare v_h uuid := pg_temp.f('pat_h'); q jsonb; o jsonb; v_oid uuid; v_prog uuid := pg_temp.f('prog_h'); v_id uuid; r text;
begin
  -- 6a: before any eligibility there is no cover
  perform pg_temp.ck('the health plans offered are only those with an active programme', 'S71 Proof HMO', pg_temp.q_as(v_h, $q$select (public.available_hmos() -> 0 ->> 'name')$q$));
  perform pg_temp.ck('anon cannot list health plans', '42501', pg_temp.try_anon($q$select public.available_hmos()$q$));
  perform pg_temp.ck('a plan with no programme is not offered', '1', pg_temp.q_as(v_h, $q$select jsonb_array_length(public.available_hmos())::text$q$));
  perform pg_temp.ck('HMO: without a passing check there is no cover', '800000,0', (pg_temp.qb(v_h, 'proof_plain') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(v_h, 'proof_plain') ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('HMO: a request for an HMO with no programme is refused', 'true',
    (pg_temp.q_as(v_h, format($q$select public.request_hmo_eligibility(%L, 'REL/12345/67')$q$, pg_temp.f('sponsor'))) like '%hmo_not_available%')::text);
  perform pg_temp.ck('HMO: a malformed member number is refused', 'true', (pg_temp.q_as(v_h, format($q$select public.request_hmo_eligibility(%L, 'a b')$q$, pg_temp.f('hmo'))) like '%member_number_invalid%')::text);
  perform pg_temp.ck('HMO: anon cannot request a check', '42501', pg_temp.try_anon(format($q$select public.request_hmo_eligibility(%L, 'REL/12345/67')$q$, pg_temp.f('hmo'))));
  perform pg_temp.ck('HMO: a clinician cannot request a check', 'true', (pg_temp.q_as(pg_temp.f('clin'), format($q$select public.request_hmo_eligibility(%L, 'REL/12345/67')$q$, pg_temp.f('hmo'))) like '%order_not_authorised%')::text);
  r := pg_temp.q_as(v_h, format($q$select (public.request_hmo_eligibility(%L, ' rel/12345/67 '))::text$q$, pg_temp.f('hmo')));
  v_id := ((r::jsonb) ->> 'check_id')::uuid;
  perform pg_temp.setf('chk', v_id);
  perform pg_temp.ck('HMO: a request is stored as pending for operations', 'pending_manual', (select result from public.hmo_eligibility_checks where id = v_id));
  perform pg_temp.ck('HMO: only a 64-character keyed hash is stored, never the number', 'true',
    (select (member_number_hash ~ '^[0-9a-f]{64}$' and member_number_hash not ilike '%12345%')::text from public.hmo_eligibility_checks where id = v_id));
  perform pg_temp.ck('HMO: the hash is an HMAC under the Vault pepper, not a plain SHA-256 (a guessed number does not match)', 'true',
    (select (member_number_hash <> encode(sha256('REL/12345/67'::bytea), 'hex'))::text from public.hmo_eligibility_checks where id = v_id));
  perform pg_temp.ck('HMO: no table stores the number in clear', '0',
    (select count(*)::text from public.hmo_eligibility_checks h where to_jsonb(h)::text ilike '%12345/67%'));
  perform pg_temp.ck('HMO: spacing and case do not matter: the same number is the same pending check', 'true',
    ((pg_temp.q_as(v_h, format($q$select (public.request_hmo_eligibility(%L, 'REL/12345/67'))::text$q$, pg_temp.f('hmo')))::jsonb ->> 'check_id')::uuid = v_id)::text);
  perform pg_temp.ck('HMO: a pending check gives no cover', '800000', pg_temp.qb(v_h, 'proof_plain') ->> 'amount_due_kobo');
  perform pg_temp.ck('HMO: the patient sees their own check without the hash', 'pending_manual,false',
    pg_temp.q_as(v_h, $q$select (j ->> 'result') || ',' || (j ? 'member_number_hash')::text from jsonb_array_elements(public.my_hmo_eligibility()) j limit 1$q$));
  perform pg_temp.ck('HMO: another patient sees none of it', '0', pg_temp.q_as(pg_temp.f('pat_o'), $q$select jsonb_array_length(public.my_hmo_eligibility())::text$q$));
  -- operations
  perform pg_temp.ck('HMO: the pending list is for admins only (patient refused)', 'true', (pg_temp.try_as(v_h, $q$select public.admin_hmo_checks_pending()$q$) like '%hmo_not_authorised%')::text);
  perform pg_temp.ck('HMO: the pending list is for admins only (clinician refused)', 'true', (pg_temp.try_as(pg_temp.f('clin'), $q$select public.admin_hmo_checks_pending()$q$) like '%hmo_not_authorised%')::text);
  perform pg_temp.ck('HMO: an admin sees the waiting check', '1', pg_temp.q_as(pg_temp.f('admin'), $q$select jsonb_array_length(public.admin_hmo_checks_pending())::text$q$));
  perform pg_temp.ck('HMO: a patient cannot verify', 'true', (pg_temp.try_as(v_h, format($q$select public.ops_verify_hmo_eligibility(%L, 'REL/12345/67', true)$q$, v_id)) like '%hmo_not_authorised%')::text);
  perform pg_temp.ck('HMO: operations cannot confirm a DIFFERENT number', 'true', (pg_temp.try_as(pg_temp.f('admin'), format($q$select public.ops_verify_hmo_eligibility(%L, 'REL/99999/99', true, 'wrong one')$q$, v_id)) like '%member_number_mismatch%')::text);
  perform pg_temp.ck('HMO: the adapter result function is not callable by a patient', 'true', (pg_temp.try_as(v_h, format($q$select public.record_hmo_eligibility_result(%L, 'eligible', 'x')$q$, v_id)) like '%permission denied%')::text);
  perform pg_temp.ck('HMO: nor by anon', '42501', pg_temp.try_anon(format($q$select public.record_hmo_eligibility_result(%L, 'eligible', 'x')$q$, v_id)));
  perform pg_temp.ck('HMO: an adapter that is unavailable leaves the check for operations', 'left_for_operations',
    pg_temp.svc(format($q$select (public.record_hmo_eligibility_result(%L, 'unavailable', 'stub'))->>'result'$q$, v_id)));
  perform pg_temp.ck('HMO: ...still pending', 'pending_manual', (select result from public.hmo_eligibility_checks where id = v_id));
  perform pg_temp.ck('HMO: operations confirm by typing the number again', 'ok', pg_temp.try_as(pg_temp.f('admin'), format($q$select public.ops_verify_hmo_eligibility(%L, 'REL/12345/67', true, 'Phoned the HMO desk, member is active')$q$, v_id)));
  perform pg_temp.ck('HMO: it is recorded as a manual decision by that admin', 'eligible,manual,true',
    (select result || ',' || decided_via || ',' || (verified_by = pg_temp.f('admin'))::text from public.hmo_eligibility_checks where id = v_id));
  perform pg_temp.ck('HMO: a decided check cannot be decided again', 'true', (pg_temp.try_as(pg_temp.f('admin'), format($q$select public.ops_verify_hmo_eligibility(%L, 'REL/12345/67', false)$q$, v_id)) like '%hmo_check_decided%')::text);
  perform pg_temp.ck('HMO: nor changed by the owner', 'hmo_check_decided', pg_temp.owner_sql(format($q$update public.hmo_eligibility_checks set result = 'not_eligible' where id = %L$q$, v_id)));
  perform pg_temp.ck('HMO: nor re-pointed at another number', 'hmo_check_immutable', pg_temp.owner_sql(format($q$update public.hmo_eligibility_checks set member_number_hash = repeat('a', 64) where id = %L$q$, v_id)));
  perform pg_temp.ck('HMO: nor deleted', 'hmo_check_immutable', pg_temp.owner_sql(format($q$delete from public.hmo_eligibility_checks where id = %L$q$, v_id)));

  -- a pass grants cover through the sponsor programme: 50 percent of 800,000, capped by the 300,000 per-person allowance
  q := pg_temp.qb(v_h, 'proof_plain');
  perform pg_temp.ck('HMO: a pass gives cover through the programme, limited by the per-person allowance', '500000,300000', (q ->> 'amount_due_kobo') || ',' || (q ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('HMO: the quote is not "covered in full"', 'false', q ->> 'covered_in_full');
  perform pg_temp.ck('HMO: the quote names the HMO', 'S71 Proof HMO', q ->> 'sponsor_name');
  perform pg_temp.ck('HMO: another patient without a pass is not covered', '800000', pg_temp.qb(pg_temp.f('pat_h2'), 'proof_plain') ->> 'amount_due_kobo');
  o := pg_temp.mkc(v_h, 'proof_plain', null, 500000);
  v_oid := (o ->> 'order_id')::uuid;
  perform pg_temp.ck('the part-paid order is an ordinary Paystack order for the remainder', 'false,tho_,500000', coalesce(o ->> 'covered', 'false') || ',' || substr(o ->> 'reference', 1, 4) || ',' || (o ->> 'amount_kobo'));
  perform pg_temp.ck('...with the sponsor share reserved', 'reserved,300000', (select state || ',' || amount_kobo from public.sponsor_reservations where order_id = v_oid));
  perform pg_temp.ck('...and the sponsor share stored on the order', '300000,800000', (select sponsor_share_kobo || ',' || list_amount_kobo from public.orders where id = v_oid));
  perform pg_temp.ck('the per-person allowance now counts the reservation: the next quote has no cover left', '800000,0', (pg_temp.qb(v_h, 'proof_plain') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(v_h, 'proof_plain') ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('a stale total is refused (the person saw 500,000 before, now cover is used)', 'true', (pg_temp.mkc(v_h, 'proof_plain', null, 500000) ->> 'error' like '%quote_changed%')::text);
  -- cancel: the share goes back
  perform pg_temp.q_as(v_h, format($q$select public.cancel_order(%L)::text$q$, v_oid));
  perform pg_temp.ck('cancelling the unpaid order frees the reservation', 'released', (select state from public.sponsor_reservations where order_id = v_oid));
  perform pg_temp.ck('...and the person''s allowance is back', '500000,300000', (pg_temp.qb(v_h, 'proof_plain') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(v_h, 'proof_plain') ->> 'sponsor_share_kobo'));
  -- pay: commit, event once
  o := pg_temp.mkc(v_h, 'proof_plain', null, 500000);
  v_oid := (o ->> 'order_id')::uuid;
  perform pg_temp.ck('payment of the remainder is recorded', 'paid', pg_temp.pay(o ->> 'reference', 500000));
  perform pg_temp.ck('...the reservation is committed', 'committed', (select state from public.sponsor_reservations where order_id = v_oid));
  perform pg_temp.ck('...a replay of the payment is a replay', 'replay', pg_temp.pay(o ->> 'reference', 500000));
  perform pg_temp.ck('...sponsor_entitlement.granted exactly once', '1', (select count(*)::text from public.domain_events e where e.event_type = 'sponsor_entitlement.granted' and e.aggregate_id = v_oid));
  perform pg_temp.owner_sql(format($q$select private.post_order_to_ledger(%L, true)$q$, v_oid));
  perform pg_temp.ck('ledger: buyer part to clearing and sponsor part to receivable, one credit for the whole price', '1020:500000:0|1210:300000:0|4100:0:800000',
    (select string_agg(l.account_code || ':' || l.debit_minor || ':' || l.credit_minor, '|' order by l.account_code)
       from public.finance_journal_entries e join public.finance_journal_lines l on l.entry_id = e.id where e.source = 'payment' and e.source_ref = 'order:' || v_oid));
  -- refund: the share goes back and the receivable is reversed
  perform pg_temp.owner_sql(format($q$update public.orders set state = 'refunded' where id = %L$q$, v_oid));
  perform pg_temp.ck('a refunded order releases the sponsor share', 'released', (select state from public.sponsor_reservations where order_id = v_oid));
  perform pg_temp.ck('the person''s allowance is back after the refund', '300000', pg_temp.qb(v_h, 'proof_plain') ->> 'sponsor_share_kobo');
  -- validity: a pass older than the programme's window gives no cover
  perform pg_temp.owner_sql(format($q$alter table public.hmo_eligibility_checks disable trigger hmo_checks_guard$q$));
  perform pg_temp.owner_sql(format($q$update public.hmo_eligibility_checks set decided_at = now() - interval '31 days' where id = %L$q$, pg_temp.f('chk')));
  perform pg_temp.owner_sql(format($q$alter table public.hmo_eligibility_checks enable trigger hmo_checks_guard$q$));
  perform pg_temp.ck('HMO: a pass older than the programme''s validity gives no cover', '800000', pg_temp.qb(v_h, 'proof_plain') ->> 'amount_due_kobo');
  -- the adapter path, and a 'not eligible' answer
  perform pg_temp.hmo_pass(pg_temp.f('pat_h2'), 'AVN-5550001');
  perform pg_temp.ck('HMO: an adapter pass gives cover too', '300000', pg_temp.qb(pg_temp.f('pat_h2'), 'proof_plain') ->> 'sponsor_share_kobo');
  perform pg_temp.ck('HMO: it is recorded as an adapter decision', 'adapter,proof_adapter', (select decided_via || ',' || adapter from public.hmo_eligibility_checks where patient_id = pg_temp.f('pat_h2')));
end $$;

-- 6. Rate limit, fail-closed pepper, the not-eligible answer --------------------------------------------------------------------
do $$
declare v_u uuid := pg_temp.mkuser(pg_temp.f('org'), 'ratelim', 'patient'); i integer; r text; v_id uuid;
begin
  for i in 1..5 loop r := pg_temp.q_as(v_u, format($q$select public.request_hmo_eligibility(%L, %L)::text$q$, pg_temp.f('hmo'), 'RATE' || lpad(i::text, 6, '0'))); end loop;
  perform pg_temp.ck('HMO: the sixth request in a day is rate limited', 'true', (pg_temp.q_as(v_u, format($q$select public.request_hmo_eligibility(%L, 'RATE000099')::text$q$, pg_temp.f('hmo'))) like '%hmo_check_rate_limited%')::text);
  -- fail closed without the pepper
  perform pg_temp.owner_sql($q$delete from vault.secrets where name = 'hmo_member_pepper'$q$);
  perform pg_temp.ck('HMO: with no pepper the hash fails closed', 'true',
    (pg_temp.q_as(pg_temp.f('pat_o'), format($q$select public.request_hmo_eligibility(%L, 'REL/00000/01')::text$q$, pg_temp.f('hmo'))) like '%hmo_not_configured%')::text);
  perform pg_temp.owner_sql($q$select vault.create_secret('proof-run-pepper-not-the-real-one', 'hmo_member_pepper', 'S71 proof run')$q$);
  -- a not-eligible answer
  v_id := ((pg_temp.q_as(pg_temp.f('pat_o'), format($q$select public.request_hmo_eligibility(%L, 'NOPE-777001')::text$q$, pg_temp.f('hmo')))::jsonb) ->> 'check_id')::uuid;
  perform pg_temp.svc(format($q$select (public.record_hmo_eligibility_result(%L, 'not_eligible', 'proof_adapter'))->>'result'$q$, v_id));
  perform pg_temp.ck('HMO: a not-eligible answer shows how to pay normally: full price, no cover', '800000,0', (pg_temp.qb(pg_temp.f('pat_o'), 'proof_plain') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(pg_temp.f('pat_o'), 'proof_plain') ->> 'sponsor_share_kobo'));
end $$;

-- 7. Cancelling a covered entitlement (operations) -----------------------------------------------------------------------------
do $$
declare v_u uuid := pg_temp.mkuser(pg_temp.f('org'), 'cancelme', 'patient'); o jsonb; v_oid uuid; v_before bigint; v_prog uuid;
begin
  -- a fresh programme with room, so this section does not depend on the first one's budget
  v_prog := pg_temp.mkprog(pg_temp.f('sponsor'), 'S71 Acme packs', array['proof_pack'], 100, 900000, null, 'cohort', pg_temp.f('cohort'), null);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (pg_temp.f('org'), v_u, pg_temp.f('cohort'), true);
  o := pg_temp.mkc(v_u, 'proof_pack');
  perform pg_temp.ck('a covered bounded item is paid at once with a dated entitlement', 'true,paid,true', (o ->> 'covered') || ',' || (o ->> 'state') || ',' || (select (ends_at is not null)::text from public.entitlements where order_id = (o ->> 'order_id')::uuid));
  v_oid := (o ->> 'order_id')::uuid;
  v_before := private.sponsor_budget_left(v_prog);
  perform pg_temp.ck('a patient cannot cancel sponsor cover', 'true', (pg_temp.try_as(v_u, format($q$select public.cancel_sponsor_entitlement(%L, 'Proof run: patient trying this')$q$, v_oid)) like '%sponsor_not_authorised%')::text);
  perform pg_temp.ck('a reason is needed', 'true', (pg_temp.try_as(pg_temp.f('admin'), format($q$select public.cancel_sponsor_entitlement(%L, 'short')$q$, v_oid)) like '%sponsor_reason_needed%')::text);
  perform pg_temp.ck('an admin cancels an unused covered entitlement', 'cancelled', pg_temp.q_as(pg_temp.f('admin'), format($q$select public.cancel_sponsor_entitlement(%L, 'Proof run: employee left the company')->>'result'$q$, v_oid)));
  perform pg_temp.ck('...the entitlement is revoked', 'revoked', (select state from public.entitlements where order_id = v_oid));
  perform pg_temp.ck('...the sponsor budget is freed', (v_before + 300000)::text, private.sponsor_budget_left(v_prog)::text);
  perform pg_temp.ck('...the order is refunded, the reservation released', 'refunded,released', (select o2.state || ',' || r.state from public.orders o2 join public.sponsor_reservations r on r.order_id = o2.id where o2.id = v_oid));
  perform pg_temp.ck('cancelling twice is refused', 'true', (pg_temp.try_as(pg_temp.f('admin'), format($q$select public.cancel_sponsor_entitlement(%L, 'Proof run: second try')$q$, v_oid)) like '%not_a_sponsor_covered_order%')::text);
  perform pg_temp.ck('the cancellation is audited', '1', (select count(*)::text from public.audit_log where action = 'sponsor.entitlement_cancelled' and actor_id = pg_temp.f('admin')));
  -- budget changes
  perform pg_temp.ck('the budget cannot be set below what is committed', 'true', (pg_temp.try_as(pg_temp.f('admin'), format($q$select public.admin_set_sponsor_programme_budget(%L, 1000, 'Proof run: too low')$q$, pg_temp.f('prog_c'))) like '%budget_below_committed%')::text);
  perform pg_temp.ck('the budget can be raised, with a reason and an audit row', 'ok', pg_temp.try_as(pg_temp.f('admin'), format($q$select public.admin_set_sponsor_programme_budget(%L, 1500000, 'Proof run: sponsor topped up')$q$, pg_temp.f('prog_c'))));
  perform pg_temp.ck('...the budget is now 1,500,000 and the audit row says from and to', '1500000,1000000,1500000',
    (select p.budget_kobo || ',' || (a.event ->> 'from') || ',' || (a.event ->> 'to') from public.sponsor_programmes p, public.audit_log a where p.id = pg_temp.f('prog_c') and a.action = 'sponsor.programme_budget' order by a.created_at desc limit 1));
  perform pg_temp.ck('a patient cannot change a budget', 'true', (pg_temp.try_as(pg_temp.f('pat'), format($q$select public.admin_set_sponsor_programme_budget(%L, 2000000, 'Proof run: patient trying')$q$, pg_temp.f('prog_c'))) like '%sponsor_not_authorised%')::text);
  perform pg_temp.ck('a closed programme covers nothing (the member is quoted the full price)', '500000',
    (select case when pg_temp.try_as(pg_temp.f('admin'), format($q$select public.admin_set_sponsor_programme_status(%L, 'closed', 'Proof run: closing the cover')$q$, pg_temp.f('prog_c'))) = 'ok'
                 then pg_temp.qb(pg_temp.f('pat_m3'), 'proof_consult') ->> 'amount_due_kobo' end));
  perform pg_temp.ck('a closed programme cannot be reopened', 'true', (pg_temp.try_as(pg_temp.f('admin'), format($q$select public.admin_set_sponsor_programme_status(%L, 'active', 'Proof run: reopening')$q$, pg_temp.f('prog_c'))) like '%sponsor_programme_closed%')::text);
end $$;

-- 8. The go-live guards ----------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_real uuid; v_realm uuid; v_org uuid := pg_temp.f('org'); v_prog uuid; o jsonb;
begin
  v_real := pg_temp.mkuser(v_org, 'real', 'patient');
  perform pg_temp.owner_sql(format($q$update public.profiles set is_test = false where id = %L$q$, v_real));
  perform pg_temp.ck('checkout guard OFF: a real patient cannot be quoted', 'ERR:checkout_not_open', pg_temp.qa(v_real, 'proof_consult'));
  perform pg_temp.ck('checkout guard OFF: a real patient cannot create an order', 'true', (pg_temp.mk(v_real, 'proof_consult') like '%checkout_not_open%')::text);
  perform pg_temp.ck('checkout guard OFF: a test patient still passes (the S37 pair rule)', '500000', pg_temp.qa(pg_temp.f('pat_o'), 'proof_consult'));
  perform pg_temp.ck('the checkout guard cannot be switched on with conditions unmet', 'true', (pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('checkout_enabled', true, 'Proof run, too early')$q$) like '%not yet met%')::text);
  perform pg_temp.ck('a patient cannot attest a checkout condition', 'true', (pg_temp.try_as(pg_temp.f('pat'), $q$select public.attest_go_live_condition('checkout_enabled', 'paystack_channels_verified', true, 'A patient trying to attest this')$q$) like '%only an admin%')::text);
  perform pg_temp.ck('a data condition cannot be attested', 'true', (pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('checkout_enabled', 'checkout_module_open', true, 'Proof run: trying to attest a data condition')$q$) like '%cannot be attested%')::text);
  perform pg_temp.ck('an attestation needs a sentence', 'true', (pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('checkout_enabled', 'paystack_channels_verified', true, 'ok')$q$) like '%say what was checked%')::text);
  perform pg_temp.ck('admin records the channel test', 'ok', pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('checkout_enabled', 'paystack_channels_verified', true, 'Proof run: card, transfer and USSD tried with the test key')$q$));
  perform pg_temp.ck('admin records the refund test', 'ok', pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('checkout_enabled', 'refund_path_tested', true, 'Proof run: refund of a test order tested end to end')$q$));
  perform pg_temp.ck('admin switches the checkout guard on', 'ok', pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('checkout_enabled', true, 'Proof run: conditions met')$q$));
  perform pg_temp.ck('checkout guard ON: a real patient can be quoted', '500000', pg_temp.qa(v_real, 'proof_consult'));
  perform pg_temp.ck('the older Membership attestation still works through the wrapper', 'ok', pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('membership_billing_enabled', 'refund_path_tested', true, 'Proof run: refund of a test Membership tested end to end')$q$));
  perform pg_temp.ck('and an unlisted pair is still refused by the base function', 'true', (pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('checkout_enabled', 'made_up', true, 'Proof run: a made up condition here')$q$) like '%cannot be attested%')::text);

  -- sponsor guard: a REAL programme and a real member exist, but cover is off until the guard is on
  v_realm := pg_temp.mkuser(v_org, 'realmember', 'patient');
  perform pg_temp.owner_sql(format($q$update public.profiles set is_test = false where id = %L$q$, v_realm));
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
  values (v_org, pg_temp.f('sponsor'), 'S71 real cohort', 'PRQFSX74', current_date - 1, current_date + 100, 50, false) returning id into v_prog;
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (v_org, v_realm, v_prog, false);
  v_prog := pg_temp.mkprog(pg_temp.f('sponsor'), 'S71 real cover', array['proof_consult'], 100, 5000000, null, 'cohort', v_prog, null, false);
  perform pg_temp.setf('prog_real', v_prog);
  perform pg_temp.ck('sponsor guard OFF: a real member is quoted the full price', '500000,0', (pg_temp.qb(v_realm, 'proof_consult') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(v_realm, 'proof_consult') ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('sponsor guard OFF: an HMO request by a real patient is refused', 'true', (pg_temp.q_as(v_realm, format($q$select public.request_hmo_eligibility(%L, 'REL/12345/67')$q$, pg_temp.f('hmo'))) like '%sponsor_payment_not_open%')::text);
  perform pg_temp.ck('the sponsor guard cannot be switched on with its attestations missing', 'true', (pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('sponsor_payment_enabled', true, 'Proof run, too early')$q$) like '%not yet met%')::text);
  perform pg_temp.ck('counsel opinion recorded', 'ok', pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('sponsor_payment_enabled', 'counsel_opinion_recorded', true, 'Proof run: counsel opinion received on order-linked sponsor payment')$q$));
  perform pg_temp.ck('finance confirmation recorded', 'ok', pg_temp.try_as(v_admin, $q$select public.attest_go_live_condition('sponsor_payment_enabled', 'sponsor_receivable_confirmed', true, 'Proof run: finance confirmed account 1210 for the sponsor receivable')$q$));
  perform pg_temp.ck('admin switches the sponsor guard on', 'ok', pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('sponsor_payment_enabled', true, 'Proof run: conditions met')$q$));
  perform pg_temp.ck('sponsor guard ON: the real member is covered in full', '0,500000', (pg_temp.qb(v_realm, 'proof_consult') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(v_realm, 'proof_consult') ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('a real programme never covers a test patient', '500000', pg_temp.qb(pg_temp.f('pat_o'), 'proof_consult') ->> 'amount_due_kobo');
  o := pg_temp.mkc(v_realm, 'proof_consult');
  perform pg_temp.ck('the real member''s covered order is paid with no payment step', 'true,paid', coalesce(o ->> 'covered', o::text) || ',' || (select state from public.orders where beneficiary_patient_id = v_realm limit 1));
  perform pg_temp.ck('a real order is posted to the ledger (the receivable)', '1',
    (select count(*)::text from public.finance_journal_entries e join public.orders o2 on e.source_ref = 'order:' || o2.id where o2.beneficiary_patient_id = v_realm and e.source = 'payment'));
  perform pg_temp.ck('switching the sponsor guard off needs only an admin', 'ok', pg_temp.try_as(v_admin, $q$select public.set_go_live_guard('sponsor_payment_enabled', false, 'Proof run: stopping sponsor cover')$q$));
end $$;

-- 9. Sponsor share with no programme behind it is refused (OQ-328) ------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_sp uuid; v_coh uuid; v_book uuid; v_u uuid := pg_temp.mkuser(pg_temp.f('org'), 'bookmember', 'patient'); v_item uuid; v_admin uuid := pg_temp.f('admin'); v_prog uuid; o jsonb;
begin
  insert into public.organisations (name, type) values ('S71 Book HMO', 'hmo') returning id into v_sp;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
  values (v_org, v_sp, 'S71 book cohort', 'PRQFSX75', current_date - 1, current_date + 100, 50, true) returning id into v_coh;
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (v_org, v_u, v_coh, true);
  v_book := pg_temp.as_admin_uuid(format($q$select public.admin_create_price_book(%L, 'S71 book')::text$q$, v_sp));
  perform pg_temp.q_as(v_admin, format($q$select public.admin_set_price_book_entry(%L, 'proof_consult', 400000, 50, 'Proof run: a rate with a 50 percent sponsor share')::text$q$, v_book));
  perform pg_temp.q_as(v_admin, format($q$select public.admin_set_price_book_status(%L, 'active', 'Proof run: activating the book')::text$q$, v_book));
  perform pg_temp.ck('a price-book share is quoted', '200000,200000', (pg_temp.qb(v_u, 'proof_consult') ->> 'amount_due_kobo') || ',' || (pg_temp.qb(v_u, 'proof_consult') ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('...but with no sponsor programme behind it the order is refused (nothing to bill)', 'true', (pg_temp.mkc(v_u, 'proof_consult') ->> 'error' like '%sponsor_billing_not_open%')::text);
  v_prog := pg_temp.mkprog(v_sp, 'S71 book cover', array['proof_consult'], 50, 100000, null, 'cohort', v_coh, null);
  perform pg_temp.ck('...with a programme whose budget is too small, the order is refused as over budget', 'true', (pg_temp.mkc(v_u, 'proof_consult') ->> 'error' like '%sponsor_budget_exhausted%')::text);
  perform pg_temp.ck('...and nothing was reserved or created by the refused attempt', '0', (select count(*)::text from public.orders where buyer_profile_id = v_u));
  perform pg_temp.try_as(v_admin, format($q$select public.admin_set_sponsor_programme_budget(%L, 1000000, 'Proof run: topping up the book programme')$q$, v_prog));
  o := pg_temp.mkc(v_u, 'proof_consult');
  perform pg_temp.ck('...with enough budget the order is made for the remainder, the share reserved', 'tho_,200000,reserved,200000',
    (select substr(o2.paystack_reference, 1, 4) || ',' || o2.amount_kobo || ',' || r.state || ',' || r.amount_kobo
       from public.orders o2 join public.sponsor_reservations r on r.order_id = o2.id where o2.id = (o ->> 'order_id')::uuid));
end $$;

-- 10. Sums and money types --------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('INV-15: the new money columns are bigint', 'bigint,bigint,bigint',
    (select string_agg(data_type, ',' order by table_name, column_name) from information_schema.columns
       where table_schema = 'public' and ((table_name = 'sponsor_programmes' and column_name in ('budget_kobo', 'per_person_cap_kobo')) or (table_name = 'sponsor_reservations' and column_name = 'amount_kobo'))));
  perform pg_temp.ck('an order cannot be written at 0 without a sponsor share', 'true',
    (pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference)
        select organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, 0, 'tho_zero0000000000000000000000001' from public.orders limit 1$q$)) like '%orders_amount_kobo_check%')::text);
  perform pg_temp.ck('INV-13: every row made by this proof is a test row, except the real-programme ones', '0',
    (select count(*)::text from public.sponsor_reservations r join public.sponsor_programmes p on p.id = r.programme_id where p.id <> pg_temp.f('prog_real') and not r.is_test));
end $$;

-- 11. SABOTAGE: three protections removed; each check must flip --------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); r text; v_h uuid; o jsonb; v_oid uuid; v_state text;
begin
  -- (a) the OQ-192 payer fix reverted: a bare view grantee can pay again
  create or replace function private.order_beneficiary_check(p_buyer uuid, p_beneficiary uuid) returns void language plpgsql stable security definer set search_path = '' as $f$
  declare v_ben uuid := coalesce(p_beneficiary, p_buyer);
  begin
    if v_ben <> p_buyer and not (private.circle_can_pay_for(v_ben) or exists (select 1 from public.profile_access pa where pa.grantee_user_id = p_buyer and pa.profile_id = v_ben)) then
      raise exception 'order_beneficiary_not_allowed' using errcode = '42501';
    end if;
  end $f$;
  insert into results values ('sabotaged', 'a bare view grantee cannot pay for the patient (OQ-192)', 'refused',
    case when (pg_temp.qb(pg_temp.f('g_view'), 'proof_consult', v_pat) ->> 'error') like '%order_beneficiary_not_allowed%' then 'refused' else 'allowed' end);

  -- (b) the budget check removed: an order that does not fit the budget can still be reserved
  create or replace function private.sponsor_reserve(p_order uuid, p_programme uuid, p_amount bigint) returns void language plpgsql security definer set search_path = '' as $f$
  declare o public.orders%rowtype;
  begin
    select * into o from public.orders where id = p_order;
    insert into public.sponsor_reservations (organisation_id, programme_id, order_id, beneficiary_id, amount_kobo, is_test) values (o.organisation_id, p_programme, o.id, o.beneficiary_patient_id, p_amount, o.is_test);
  end $f$;
  insert into results values ('sabotaged', 'reserving more than is left is refused by the database', 'refused',
    case when pg_temp.owner_sql(format($q$select private.sponsor_reserve(%L, %L, 1)$q$, pg_temp.f('o3'), pg_temp.f('prog_c'))) like '%sponsor_budget_exhausted%' then 'refused' else 'accepted' end);

  -- (c) the effects trigger removed: cancelling an unpaid part-paid order keeps the sponsor's budget reserved
  drop trigger orders_sponsor_effects on public.orders;
  v_h := pg_temp.mkuser(pg_temp.f('org'), 'sabot2', 'patient');
  perform pg_temp.hmo_pass(v_h, 'SABOT-4440001');
  o := pg_temp.mkc(v_h, 'proof_plain');
  v_oid := (o ->> 'order_id')::uuid;
  perform pg_temp.q_as(v_h, format($q$select public.cancel_order(%L)::text$q$, v_oid));
  select state into v_state from public.sponsor_reservations where order_id = v_oid;
  insert into results values ('sabotaged', 'cancelling an unpaid order frees the sponsor reservation', 'released', coalesce(v_state, 'no reservation: ' || coalesce(o::text, 'null')));
end $$;

do $$
declare v_bad integer; v_caught integer; v_real integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S71 proof FAILED on the real migration: %',
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
