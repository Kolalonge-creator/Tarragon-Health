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
  values (v, 's72-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S72 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
$$ select pg_temp.svc(format($q$select (public.record_order_payment(%L, %s, 150, %s, 'NGN', 'success', 'webhook', 'evt-' || gen_random_uuid(), now(), '{}'::jsonb))->>'result'$q$, p_ref, p_amount, p_amount + 150)) $$;

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


-- S72 helpers ----------------------------------------------------------------------------------------------------------------
create function pg_temp.jb(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_uid, p_sql);
  if r like 'ERR:%' then return jsonb_build_object('error', r); end if;
  return r::jsonb;
end $f$;
create function pg_temp.svcj(p_sql text) returns jsonb language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.svc(p_sql);
  if r like 'ERR:%' then return jsonb_build_object('error', r); end if;
  return r::jsonb;
end $f$;
-- a donation: pledge as a patient, confirm as the admin; returns the id
create function pg_temp.donate(p_uid uuid, p_amount bigint, p_item text default null) returns uuid language plpgsql as
$f$ declare j jsonb; v_id uuid; r text;
begin
  j := pg_temp.jb(p_uid, format($q$select public.pledge_donation(%L, %L)::text$q$, p_amount, p_item));
  if j ? 'error' then raise exception 'pledge failed: %', j; end if;
  v_id := (j ->> 'donation_id')::uuid;
  r := pg_temp.q_as(pg_temp.f('admin'), format($q$select public.ops_confirm_donation_received(%L, 'TRF-PROOF-001', 'Proof run: transfer seen on the statement')::text$q$, v_id));
  if r like 'ERR:%' then raise exception 'confirm failed: %', r; end if;
  return v_id;
end $f$;
create function pg_temp.grant_for(p_pat uuid, p_item text, p_ceiling bigint) returns jsonb language sql as
$$ select pg_temp.jb(pg_temp.f('admin'), format($q$select public.ops_approve_access_fund_grant(%L, %L, %L, 'care_cost_is_a_barrier', 'Proof run: approved for the proof')::text$q$, p_pat, p_item, p_ceiling)) $$;
create function pg_temp.prev(p_code text, p_visitor text default 'visitor-proof-0001') returns jsonb language sql as
$$ select pg_temp.svcj(format($q$select public.payment_request_preview(%L, %L)::text$q$, p_code, p_visitor)) $$;
create function pg_temp.mkreq(p_uid uuid, p_item text default 'proof_member', p_ben uuid default null) returns jsonb language sql as
$$ select pg_temp.jb(p_uid, format($q$select public.create_payment_request(%L, %L)::text$q$, p_item, p_ben)) $$;
create function pg_temp.payreq(p_uid uuid, p_code text, p_key uuid default gen_random_uuid()) returns jsonb language sql as
$$ select pg_temp.jb(p_uid, format($q$select public.create_request_order(%L, %L)::text$q$, p_code, p_key)) $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_item uuid; v_sp uuid; v_coh uuid; v_admin uuid;
begin
  select id into v_org from public.organisations where type = 'direct_consumer' order by created_at limit 1;
  if v_org is null then select id into v_org from public.organisations order by created_at limit 1; end if;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('clin', pg_temp.mkuser(v_org, 'clin', 'clinician'));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));        -- fund-paid, covered in full
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));      -- fund-paid, part covered
  perform pg_temp.setf('pat3', pg_temp.mkuser(v_org, 'pat3', 'patient'));      -- cancel and re-order
  perform pg_temp.setf('pat4', pg_temp.mkuser(v_org, 'pat4', 'patient'));      -- expiry
  perform pg_temp.setf('pat5', pg_temp.mkuser(v_org, 'pat5', 'patient'));      -- cancelled grant
  perform pg_temp.setf('other', pg_temp.mkuser(v_org, 'other', 'patient'));    -- has no grant
  perform pg_temp.setf('donor', pg_temp.mkuser(v_org, 'donor', 'patient'));
  perform pg_temp.setf('supporter', pg_temp.mkuser(v_org, 'supporter', 'patient'));
  perform pg_temp.setf('requester', pg_temp.mkuser(v_org, 'requester', 'patient'));
  perform pg_temp.setf('payer', pg_temp.mkuser(v_org, 'payer', 'patient'));
  perform pg_temp.setf('payer2', pg_temp.mkuser(v_org, 'payer2', 'patient'));
  perform pg_temp.setf('cgv', pg_temp.mkuser(v_org, 'caregiver_view', 'patient'));
  perform pg_temp.setf('cgp', pg_temp.mkuser(v_org, 'caregiver_pay', 'patient'));
  perform pg_temp.setf('member', pg_temp.mkuser(v_org, 'member', 'patient'));  -- already a member
  perform pg_temp.setf('spm', pg_temp.mkuser(v_org, 'cohort_member', 'patient'));
  perform pg_temp.setf('real', pg_temp.mkuser(v_org, 'real', 'patient'));
  update public.profiles set is_test = false where id = pg_temp.f('real');
  -- items: a yearly Membership (10,000 naira, all Tarragon's own fee), a consultation (5,000: 3,000 partner, 2,000 Tarragon), a plain 8,000 item, a 3,000 lab panel
  -- main-dev's two-tier rule (catalog_items_only_membership_sellable) allows only the Membership to be active in the real catalog. This proof exercises the generic
  -- checkout and pricing machinery with consultation items, so the rule is lifted for this rolled-back transaction only.
  alter table public.catalog_items drop constraint if exists catalog_items_only_membership_sellable;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
  values (v_org, 'proof_member', 'membership', 'catalog.proof.name', 'catalog.proof.description', 365, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 10000000, '{"tarragon_service_fee":10000000}', 'proof');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_consult', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 2, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 500000, '{"partner_fee":300000,"tarragon_service_fee":200000}', 'proof');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'proof_plain', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 800000, '{}', 'proof');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
  values (v_org, 'proof_other', 'lab_panel', 'catalog.proof.name', 'catalog.proof.description', 60, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 300000, '{}', 'proof');
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S72 proof run' where key = 'v5_checkout';
  -- the pepper for payment request codes (Vault), made inside this rolled-back proof
  perform vault.create_secret('s72-proof-pepper-value', 'payment_request_pepper');
  -- the S71 sponsor path, for the sponsor-source entitlement
  insert into public.organisations (name, type) values ('S72 Acme Ltd', 'corporate') returning id into v_sp;
  perform pg_temp.setf('sponsor', v_sp);
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
  values (v_org, v_sp, 'S72 proof cohort', 'PRQFSX72', current_date - 1, current_date + 100, 50, true) returning id into v_coh;
  perform pg_temp.setf('cohort', v_coh);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (v_org, pg_temp.f('spm'), v_coh, true);
  -- the member who already has a Membership
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
  values (v_org, pg_temp.f('member'), 'purchase', now(), now() + interval '300 days', true);
  -- a caregiver with only view, and one with manage_payments, for the requester
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level) values (pg_temp.f('requester'), pg_temp.f('cgv'), pg_temp.f('requester'), 'view');
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level, permissions)
    values (pg_temp.f('requester'), pg_temp.f('cgp'), pg_temp.f('requester'), 'manage', array['manage_payments']::public.caregiver_permission[]);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pg_temp.f('pat'), pg_temp.f('supporter'), 'sibling', array['pay_for_care'], now() + interval '30 days', true);
end $$;

-- 1. What the migration left behind --------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('the kobo conversion function is gone', 'false', (to_regprocedure('public.redeem_wellness_points(integer)') is not null)::text);
  perform pg_temp.ck('the redemptions table is gone', 'false', (to_regclass('public.wellness_points_redemptions') is not null)::text);
  perform pg_temp.ck('points_to_kobo_rate is gone', '0', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'wellness_points_config' and column_name = 'points_to_kobo_rate'));
  perform pg_temp.ck('no public function mentions the kobo conversion any more', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and (p.prosrc ilike '%points_to_kobo_rate%' or p.prosrc ilike '%wellness_points_redemptions%')));
  perform pg_temp.ck('the points balance and ledger tables are untouched', '2',
    (select count(*)::text from pg_class where oid in ('public.wellness_points_balances'::regclass, 'public.wellness_points_ledger'::regclass)));
  perform pg_temp.ck('the Fund guard exists and is off', '1', (select count(*)::text from public.go_live_guards where key = 'access_fund_enabled' and not is_on));
  perform pg_temp.ck('the Fund guard has four conditions, three of them attestations and one a switch', '4,3,1',
    (select jsonb_array_length(c) || ',' || (select count(*) from jsonb_array_elements(c) e where e ->> 'source' = 'attestation') || ',' || (select count(*) from jsonb_array_elements(c) e where e ->> 'source' = 'switch')
       from (select private.go_live_conditions('access_fund_enabled', null) c) x));
  perform pg_temp.ck('the older guards still answer through the two wrappers', 'true',
    (jsonb_array_length(private.go_live_conditions('checkout_enabled', null)) >= 4 and jsonb_array_length(private.go_live_conditions('sponsor_payment_enabled', null)) >= 3
     and jsonb_array_length(private.go_live_conditions('membership_billing_enabled', null)) >= 4 and jsonb_array_length(private.go_live_conditions('clinical_operations_enabled', null)) >= 4)::text);
  perform pg_temp.ck('an unknown guard still fails closed', 'false', (private.go_live_conditions('no_such_guard', null) -> 0 ->> 'met'));
  perform pg_temp.ck('donation.received is registered with ids only', 'donation_id,amount_kobo', (select array_to_string(required_keys, ',') from public.event_type_versions where event_type = 'donation.received' and version = 1));
  perform pg_temp.ck('the extras rules v1 are active', '1', (select version::text from public.checkout_extras_config where is_active));
  perform pg_temp.ck('create_order still has exactly one signature', '1', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_order'));
  perform pg_temp.ck('the hardship seam is deliberately still 0 (grants use the sponsor slot, OQ-329 answered)', '0', (private.hardship_reduction(pg_temp.f('pat'), (select id from public.catalog_items where code = 'proof_plain'), 800000))::text);
  perform pg_temp.ck('no points path turns points into money: a points wish is only a quote line', 'true',
    (pg_temp.q_as(pg_temp.f('pat'), $q$select (public.price_quote('proof_consult', null, null, true))->>'amount_due_kobo'$q$) = '500000')::text);
end $$;

-- 2. Donations: pledges, who may confirm, immutability, lapsing ------------------------------------------------------------------
do $$
declare v_donor uuid := pg_temp.f('donor'); j jsonb; v_id uuid; r text; k integer;
begin
  -- the guard is OFF: a real person cannot pledge; a test person (the S37 pair rule) can
  perform pg_temp.ck('a real person cannot pledge while the Fund guard is off', 'true',
    (pg_temp.jb(pg_temp.f('real'), $q$select public.pledge_donation(500000, null)::text$q$) ->> 'error' like '%access_fund_not_open%')::text);
  perform pg_temp.ck('a clinician cannot pledge (patients only)', 'true', (pg_temp.jb(pg_temp.f('clin'), $q$select public.pledge_donation(500000, null)::text$q$) ->> 'error' like '%donation_not_authorised%')::text);
  perform pg_temp.ck('anon cannot pledge', '42501', pg_temp.try_anon($q$select public.pledge_donation(500000, null)$q$));
  perform pg_temp.ck('below the minimum is refused', 'true', (pg_temp.jb(v_donor, $q$select public.pledge_donation(99999, null)::text$q$) ->> 'error' like '%donation_amount_invalid%')::text);
  perform pg_temp.ck('a restricted gift for an item that does not exist is refused', 'true', (pg_temp.jb(v_donor, $q$select public.pledge_donation(500000, 'no_such_item')::text$q$) ->> 'error' like '%item_not_available%')::text);
  j := pg_temp.jb(v_donor, $q$select public.pledge_donation(500000, null)::text$q$);
  perform pg_temp.ck('a test person can pledge and gets a reference', 'true', (j ->> 'reference' ~ '^CAF-[A-Z0-9]{8}$')::text);
  v_id := (j ->> 'donation_id')::uuid;
  perform pg_temp.ck('the pledge is waiting, not received', 'pledged', (select state from public.donations where id = v_id));
  j := pg_temp.jb(v_donor, $q$select public.pledge_donation(500000, null)::text$q$);
  perform pg_temp.ck('the second open pledge is allowed', 'true', (j ? 'donation_id')::text);
  j := pg_temp.jb(v_donor, $q$select public.pledge_donation(500000, null)::text$q$);
  perform pg_temp.ck('the third open pledge is allowed', 'true', (j ? 'donation_id')::text);
  j := pg_temp.jb(v_donor, $q$select public.pledge_donation(500000, null)::text$q$);
  perform pg_temp.ck('the fourth open pledge is refused', 'true', (j ->> 'error' like '%too_many_open_pledges%')::text);
  -- a donor cancels their own pledges; nobody else can
  perform pg_temp.ck('another patient cannot cancel the donor''s pledge', 'not_found', pg_temp.jb(pg_temp.f('other'), format($q$select public.cancel_my_donation(%L)::text$q$, v_id)) ->> 'result');
  perform pg_temp.ck('the donor cancels a pledge', 'cancelled', pg_temp.jb(v_donor, format($q$select public.cancel_my_donation(%L)::text$q$, v_id)) ->> 'result');
  perform pg_temp.ck('a cancelled pledge cannot be cancelled again', 'not_pledged', pg_temp.jb(v_donor, format($q$select public.cancel_my_donation(%L)::text$q$, v_id)) ->> 'result');
  -- clear the donor's other waiting pledges so later gifts can be made
  update public.donations set state = 'cancelled' where donor_profile_id = v_donor and state = 'pledged';

  -- who may confirm a transfer
  j := pg_temp.jb(v_donor, $q$select public.pledge_donation(2000000, null)::text$q$);
  v_id := (j ->> 'donation_id')::uuid;
  perform pg_temp.setf('d_conf', v_id);
  perform pg_temp.ck('the donor cannot confirm their own gift', 'true', (pg_temp.q_as(v_donor, format($q$select public.ops_confirm_donation_received(%L, 'TRF-X-0001', 'Proof run: trying to confirm my own')::text$q$, v_id)) like '%access_fund_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot confirm', 'true', (pg_temp.q_as(pg_temp.f('clin'), format($q$select public.ops_confirm_donation_received(%L, 'TRF-X-0001', 'Proof run: a clinician trying')::text$q$, v_id)) like '%access_fund_not_authorised%')::text);
  perform pg_temp.ck('anon cannot confirm', '42501', pg_temp.try_anon(format($q$select public.ops_confirm_donation_received(%L, 'TRF-X-0001', 'Proof run: anon trying here')$q$, v_id)));
  perform pg_temp.ck('the admin must give a reason', 'true', (pg_temp.q_as(pg_temp.f('admin'), format($q$select public.ops_confirm_donation_received(%L, 'TRF-X-0001', 'short')::text$q$, v_id)) like '%access_fund_reason_needed%')::text);
  perform pg_temp.ck('the admin must give the bank reference', 'true', (pg_temp.q_as(pg_temp.f('admin'), format($q$select public.ops_confirm_donation_received(%L, 'ab', 'Proof run: a long enough reason')::text$q$, v_id)) like '%bank_reference_needed%')::text);
  r := pg_temp.q_as(pg_temp.f('admin'), format($q$select public.ops_confirm_donation_received(%L, 'TRF-PROOF-001', 'Proof run: transfer seen on the statement')::text$q$, v_id));
  perform pg_temp.ck('the admin confirms the transfer', 'received', r::jsonb ->> 'result');
  perform pg_temp.ck('donation.received was emitted exactly once, ids and amount only', '1,amount_kobo,donation_id,restricted',
    (select count(*)::text from public.domain_events where event_type = 'donation.received' and aggregate_id = v_id) || ',' ||
    (select string_agg(kk, ',' order by kk) from public.domain_events e, jsonb_object_keys(e.payload) kk where e.event_type = 'donation.received' and e.aggregate_id = v_id));
  perform pg_temp.ck('the donor''s id is not in the event payload', 'false', (select (payload::text like '%' || v_donor::text || '%')::text from public.domain_events where event_type = 'donation.received' and aggregate_id = v_id));
  perform pg_temp.ck('confirming again changes nothing', 'not_waiting', pg_temp.q_as(pg_temp.f('admin'), format($q$select (public.ops_confirm_donation_received(%L, 'TRF-PROOF-002', 'Proof run: trying to confirm twice')->>'result')$q$, v_id)));
  perform pg_temp.ck('the audit log has the confirmation', '1', (select count(*)::text from public.audit_log where action = 'access_fund.donation_received' and entity_id = v_id));
  -- a received donation never changes
  perform pg_temp.ck('a received gift''s amount cannot be changed, even by the owner role', 'true', (pg_temp.owner_sql(format($q$update public.donations set amount_kobo = 1 where id = %L$q$, v_id)) like '%donation_immutable%')::text);
  perform pg_temp.ck('a received gift cannot go back to waiting', 'true', (pg_temp.owner_sql(format($q$update public.donations set state = 'pledged' where id = %L$q$, v_id)) like '%donation_bad_transition%')::text);
  perform pg_temp.ck('a gift cannot be deleted', 'true', (pg_temp.owner_sql(format($q$delete from public.donations where id = %L$q$, v_id)) like '%donation_immutable%')::text);
  -- the donor sees their own gifts, with no pool and no grant
  perform pg_temp.ck('the donor sees only their own gifts, all of them', (select count(*)::text from public.donations where donor_profile_id = v_donor), jsonb_array_length(pg_temp.jb(v_donor, $q$select public.my_donations()::text$q$) )::text);
  perform pg_temp.ck('...and every one of them is the donor''s', '0', (select count(*)::text from jsonb_array_elements(pg_temp.jb(v_donor, $q$select public.my_donations()::text$q$)) e where not exists (select 1 from public.donations d where d.id = (e ->> 'id')::uuid and d.donor_profile_id = v_donor)));
  perform pg_temp.ck('another patient sees none of them', '0', jsonb_array_length(pg_temp.jb(pg_temp.f('other'), $q$select public.my_donations()::text$q$))::text);
  perform pg_temp.ck('a donor row carries no pool, balance or grant field', 'amount_kobo,created_at,id,item_name_key,pledge_expires_at,received_at,reference,state',
    (select string_agg(kk, ',' order by kk) from jsonb_object_keys(pg_temp.jb(v_donor, $q$select public.my_donations()::text$q$) -> 0) kk));
  -- lapse: an old pledge shows as lapsed; operations can still confirm a late transfer
  j := pg_temp.jb(v_donor, $q$select public.pledge_donation(300000, null)::text$q$);
  v_id := (j ->> 'donation_id')::uuid;
  update public.donations set pledge_expires_at = now() - interval '1 day' where id = v_id;
  perform pg_temp.ck('an old pledge reads as lapsed to the donor', 'lapsed', (select e ->> 'state' from jsonb_array_elements(pg_temp.jb(v_donor, $q$select public.my_donations()::text$q$)) e where e ->> 'id' = v_id::text));
  perform pg_temp.ck('expire_access_fund lapses it (admin)', '1', pg_temp.q_as(pg_temp.f('admin'), $q$select (public.expire_access_fund()->>'pledges_lapsed')$q$));
  perform pg_temp.ck('a patient cannot run expire_access_fund', 'true', (pg_temp.q_as(pg_temp.f('other'), $q$select public.expire_access_fund()::text$q$) like '%access_fund_not_authorised%')::text);
  perform pg_temp.ck('operations can still confirm a late transfer', 'received', pg_temp.q_as(pg_temp.f('admin'), format($q$select (public.ops_confirm_donation_received(%L, 'TRF-LATE-001', 'Proof run: the transfer arrived late')->>'result')$q$, v_id)));
  -- a gift to put the pool in order for the grant section: 50,000 naira general and a 10,000 naira gift restricted to the consultation
  perform pg_temp.donate(v_donor, 5000000, null);
  update public.donations set state = 'cancelled' where donor_profile_id = v_donor and state = 'pledged';
  perform pg_temp.donate(v_donor, 1000000, 'proof_consult');
end $$;

-- 3. Grants: who may approve, what is checked, the pool ---------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); j jsonb; r text; v_org uuid := pg_temp.f('org');
begin
  perform pg_temp.ck('a patient cannot approve a grant', 'true', (pg_temp.jb(pg_temp.f('other'), format($q$select public.ops_approve_access_fund_grant(%L, 'proof_other', 300000, 'care_cost_is_a_barrier', 'Proof run: a patient trying here')::text$q$, v_pat)) ->> 'error' like '%access_fund_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot approve a grant', 'true', (pg_temp.jb(pg_temp.f('clin'), format($q$select public.ops_approve_access_fund_grant(%L, 'proof_other', 300000, 'care_cost_is_a_barrier', 'Proof run: a clinician trying')::text$q$, v_pat)) ->> 'error' like '%access_fund_not_authorised%')::text);
  perform pg_temp.ck('anon cannot approve a grant', '42501', pg_temp.try_anon(format($q$select public.ops_approve_access_fund_grant(%L, 'proof_other', 300000, 'care_cost_is_a_barrier', 'Proof run: anon trying here')$q$, v_pat)));
  -- the grant 'other' call above was refused for the patient, so nothing exists yet
  perform pg_temp.ck('nothing exists after the refused attempts', '0', (select count(*)::text from public.access_fund_grants));
  perform pg_temp.ck('a reason is required', 'true', (pg_temp.jb(pg_temp.f('admin'), format($q$select public.ops_approve_access_fund_grant(%L, 'proof_other', 300000, 'care_cost_is_a_barrier', 'short')::text$q$, v_pat)) ->> 'error' like '%access_fund_reason_needed%')::text);
  perform pg_temp.ck('only a published criterion may be cited', 'true', (pg_temp.jb(pg_temp.f('admin'), format($q$select public.ops_approve_access_fund_grant(%L, 'proof_other', 300000, 'made_up_reason', 'Proof run: an unpublished reason')::text$q$, v_pat)) ->> 'error' like '%criterion_not_published%')::text);
  perform pg_temp.ck('a zero ceiling is refused', 'true', (pg_temp.grant_for(v_pat, 'proof_other', 0) ->> 'error' like '%grant_amount_invalid%')::text);
  perform pg_temp.ck('a ceiling above the item price is refused', 'true', (pg_temp.grant_for(v_pat, 'proof_other', 300001) ->> 'error' like '%grant_amount_invalid%')::text);
  perform pg_temp.ck('an unknown item is refused', 'true', (pg_temp.grant_for(v_pat, 'no_such_item', 100) ->> 'error' like '%item_not_available%')::text);
  perform pg_temp.ck('a person who is not in the admin''s organisation or not a patient is refused', 'true', (pg_temp.grant_for(pg_temp.f('clin'), 'proof_other', 100000) ->> 'error' like '%unknown_patient%')::text);
  perform pg_temp.ck('a real person cannot be granted while the guard is off', 'true', (pg_temp.grant_for(pg_temp.f('real'), 'proof_other', 100000) ->> 'error' like '%access_fund_not_open%')::text);
  -- the pool: 50,000 naira general and 10,000 restricted to the consultation have been received. The yearly Membership is 100,000 naira
  perform pg_temp.ck('a grant the pool cannot carry is refused', 'true', (pg_temp.grant_for(v_pat, 'proof_member', 10000000) ->> 'error' like '%fund_pool_short%')::text);
  perform pg_temp.ck('the pool counts only received gifts: waiting and cancelled ones are not money', '7300000',
    (select private.fund_general_received(v_org, true)::text));
  perform pg_temp.ck('a gift restricted to the consultation funds only the consultation', '0,200000',
    (private.fund_general_needed(v_org, true, 'proof_consult', 500000)::text || ',' || private.fund_general_needed(v_org, true, 'proof_other', 200000)::text));
  perform pg_temp.ck('the restricted gift covers a consultation grant first, then general gifts carry the rest', '0,500000',
    (private.fund_general_needed(v_org, true, 'proof_consult', 1000000)::text || ',' || private.fund_general_needed(v_org, true, 'proof_consult', 1500000)::text));
end $$;

-- 3b. A grant covers one order in full: no payment step ----------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_other uuid := pg_temp.f('other'); j jsonb; q jsonb; o jsonb; v_oid uuid; v_prog uuid; v_grant uuid; r text; k integer;
begin
  j := pg_temp.grant_for(v_pat, 'proof_other', 300000);
  perform pg_temp.ck('the admin approves a grant', 'true', (j ? 'grant_id')::text);
  v_grant := (j ->> 'grant_id')::uuid; v_prog := (j ->> 'programme_id')::uuid;
  perform pg_temp.setf('g_pat', v_grant);
  perform pg_temp.ck('the grant is approved and expires in the configured days', 'approved,60',
    (select status || ',' || round(extract(epoch from (expires_at - approved_at)) / 86400)::text from public.access_fund_grants where id = v_grant));
  perform pg_temp.ck('its programme is a 100 percent access_grant programme with the ceiling as budget', 'access_grant,100,300000,300000,active',
    (select eligibility || ',' || share_percent || ',' || budget_kobo || ',' || per_person_cap_kobo || ',' || status from public.sponsor_programmes where id = v_prog));
  perform pg_temp.ck('the sponsor is the Community Access Fund organisation, named so', 'Community Access Fund',
    (select o.name from public.sponsor_programmes p join public.organisations o on o.id = p.sponsor_org_id where p.id = v_prog));
  perform pg_temp.ck('the approval is audited with the criterion and the reason', '1',
    (select count(*)::text from public.audit_log where action = 'access_fund.grant_approved' and entity_id = v_grant and event ->> 'criterion' = 'care_cost_is_a_barrier' and (event ->> 'note') like 'Proof run%'));
  perform pg_temp.ck('a second open grant for the same person and item is refused', 'true', (pg_temp.grant_for(v_pat, 'proof_other', 100000) ->> 'error' like '%grant_already_open%')::text);
  perform pg_temp.ck('a grant''s programme does not show in the admin''s sponsor-programme list', '0',
    pg_temp.q_as(pg_temp.f('admin'), $q$select count(*)::text from jsonb_array_elements(public.admin_sponsor_programmes()) e where e ->> 'eligibility' = 'access_grant'$q$));
  perform pg_temp.ck('what a grant IS cannot be edited (ceiling)', 'true', (pg_temp.owner_sql(format($q$update public.access_fund_grants set ceiling_kobo = 999999 where id = %L$q$, v_grant)) like '%grant_immutable%')::text);
  perform pg_temp.ck('what a grant IS cannot be edited (person)', 'true', (pg_temp.owner_sql(format($q$update public.access_fund_grants set patient_id = %L where id = %L$q$, v_other, v_grant)) like '%grant_immutable%')::text);
  perform pg_temp.ck('a grant cannot be deleted', 'true', (pg_temp.owner_sql(format($q$delete from public.access_fund_grants where id = %L$q$, v_grant)) like '%grant_immutable%')::text);
  -- the person, and only the person, is covered
  q := pg_temp.qb(v_pat, 'proof_other');
  perform pg_temp.ck('the person is quoted the whole price as covered', '300000,0,true,Community Access Fund', (q ->> 'sponsor_share_kobo') || ',' || (q ->> 'amount_due_kobo') || ',' || (q ->> 'covered_in_full') || ',' || (q ->> 'sponsor_name'));
  perform pg_temp.ck('another patient with no grant pays the full price', '300000', pg_temp.qb(v_other, 'proof_other') ->> 'amount_due_kobo');
  perform pg_temp.ck('a Care Circle supporter paying for the person neither gets the cover nor learns of it', '300000,0',
    (pg_temp.qb(pg_temp.f('supporter'), 'proof_other', v_pat) ->> 'amount_due_kobo') || ',' || (pg_temp.qb(pg_temp.f('supporter'), 'proof_other', v_pat) ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('the grant covers only its named item', '500000', pg_temp.qb(v_pat, 'proof_consult') ->> 'amount_due_kobo');
  -- the covered order: no payment step at all
  o := pg_temp.mkc(v_pat, 'proof_other');
  v_oid := (o ->> 'order_id')::uuid;
  perform pg_temp.ck('the order is covered: amount 0, paid, no checkout link, the Fund named', '0,paid,true,Community Access Fund,',
    (o ->> 'amount_kobo') || ',' || (o ->> 'state') || ',' || (o ->> 'covered') || ',' || (o ->> 'sponsor_name') || ',' || coalesce(o ->> 'checkout_url', ''));
  perform pg_temp.ck('ACCEPTANCE: a sponsor-paid item never shows a payment step: no payment row, no Paystack reference sent', '0',
    (select count(*)::text from public.payments where order_id = v_oid));
  perform pg_temp.ck('the reference is the sponsor kind, never one Paystack could be given', 'true', ((select paystack_reference from public.orders where id = v_oid) like 'spo\_%')::text);
  perform pg_temp.ck('the grant is now used, bound to this one order, with the amount used', 'used,300000',
    (select status || ',' || used_kobo from public.access_fund_grants where id = v_grant) );
  perform pg_temp.ck('...and bound to the order', 'true', ((select order_id from public.access_fund_grants where id = v_grant) = v_oid)::text);
  perform pg_temp.ck('the entitlement exists for the person', '1', (select count(*)::text from public.entitlements where order_id = v_oid and patient_id = v_pat));
  perform pg_temp.ck('order.paid was emitted once', '1', (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = v_oid));
  perform pg_temp.ck('sponsor_entitlement.granted was emitted once, ids, code and kind only', '1,code,kind,order_id,programme_id',
    (select count(*)::text from public.domain_events where event_type = 'sponsor_entitlement.granted' and aggregate_id = v_oid) || ',' ||
    (select string_agg(kk, ',' order by kk) from public.domain_events e, jsonb_object_keys(e.payload) kk where e.event_type = 'sponsor_entitlement.granted' and e.aggregate_id = v_oid));
  perform pg_temp.ck('the reservation is committed', 'committed', (select state from public.sponsor_reservations where order_id = v_oid));
  perform pg_temp.ck('a used grant cannot cover a second order (nothing is left)', '300000', pg_temp.qb(v_pat, 'proof_other') ->> 'amount_due_kobo');
  perform pg_temp.ck('...and a second grant for the same item is refused while the first is used', 'true', (pg_temp.grant_for(v_pat, 'proof_other', 100000) ->> 'error' like '%grant_already_open%')::text);
  perform pg_temp.ck('the person''s own view of support shows item, status and end date only', 'expires_at,item_code,item_name_key,status',
    (select string_agg(kk, ',' order by kk) from jsonb_object_keys(pg_temp.jb(v_pat, $q$select public.my_access_fund_support()::text$q$) -> 0) kk));
  perform pg_temp.ck('the person''s entitlement says it came from the Fund and names no sponsor', 'access_fund,,60',
    (select (e ->> 'source') || ',' || coalesce(e ->> 'sponsor_name', '') || ',' || (e ->> 'days_left') from jsonb_array_elements(pg_temp.jb(v_pat, $q$select public.my_entitlements()::text$q$) ) e where e ->> 'kind' = 'lab_panel'));
end $$;

-- 3c. A part-cover grant, cancel and re-order, expiry, cancel by operations ---------------------------------------------------------
do $$
declare v_p2 uuid := pg_temp.f('pat2'); v_p3 uuid := pg_temp.f('pat3'); v_p4 uuid := pg_temp.f('pat4'); v_p5 uuid := pg_temp.f('pat5'); j jsonb; q jsonb; o jsonb; v_oid uuid; v_g uuid; v_prog uuid; r text;
begin
  -- part cover: 8,000 naira item, 3,000 naira ceiling
  j := pg_temp.grant_for(v_p2, 'proof_plain', 300000);
  v_g := (j ->> 'grant_id')::uuid;
  q := pg_temp.qb(v_p2, 'proof_plain');
  perform pg_temp.ck('part cover: the person is quoted the remainder, not covered in full', '300000,500000,false', (q ->> 'sponsor_share_kobo') || ',' || (q ->> 'amount_due_kobo') || ',' || (q ->> 'covered_in_full'));
  o := pg_temp.mkc(v_p2, 'proof_plain', null, 500000);
  v_oid := (o ->> 'order_id')::uuid;
  perform pg_temp.ck('part cover: the order is 5,000 naira and waits for payment', '500000,created', (o ->> 'amount_kobo') || ',' || (o ->> 'state'));
  perform pg_temp.ck('part cover: the reservation holds the Fund''s part, the grant is still approved', 'reserved,approved', (select state from public.sponsor_reservations where order_id = v_oid) || ',' || (select status from public.access_fund_grants where id = v_g));
  perform pg_temp.ck('part cover: a second order for the same item cannot reserve the same ceiling', 'true',
    (pg_temp.mkc(v_p2, 'proof_plain') ->> 'amount_kobo' = '800000')::text);
  r := pg_temp.pay((select paystack_reference from public.orders where id = v_oid), 500000);
  perform pg_temp.ck('part cover: paying the 5,000 naira is recorded', 'paid', r);
  perform pg_temp.ck('part cover: the Fund''s part is committed and the grant is used for 3,000 naira', 'used,300000', (select status || ',' || used_kobo from public.access_fund_grants where id = v_g));
  perform pg_temp.ck('part cover: the entitlement says part of it was covered', 'access_fund,true',
    (select (e ->> 'source') || ',' || (e ->> 'part_covered') from jsonb_array_elements(pg_temp.jb(v_p2, $q$select public.my_entitlements()::text$q$)) e where e ->> 'kind' = 'consultation_credit'));

  -- cancel an unpaid part-covered order: the grant is available again
  j := pg_temp.grant_for(v_p3, 'proof_plain', 300000);
  v_g := (j ->> 'grant_id')::uuid;
  o := pg_temp.mkc(v_p3, 'proof_plain');
  v_oid := (o ->> 'order_id')::uuid;
  perform pg_temp.ck('cancel: while an order is open, operations cannot cancel the grant', 'order_in_progress', pg_temp.jb(pg_temp.f('admin'), format($q$select public.ops_cancel_access_fund_grant(%L, 'Proof run: trying to cancel mid-order')::text$q$, v_g)) ->> 'result');
  perform pg_temp.q_as(v_p3, format($q$select public.cancel_order(%L)::text$q$, v_oid));
  perform pg_temp.ck('cancel: cancelling the order releases the reservation and the grant stays approved', 'released,approved',
    (select state from public.sponsor_reservations where order_id = v_oid) || ',' || (select status from public.access_fund_grants where id = v_g));
  perform pg_temp.ck('cancel: the person is covered again', '300000', pg_temp.qb(v_p3, 'proof_plain') ->> 'sponsor_share_kobo');

  -- expiry
  j := pg_temp.grant_for(v_p4, 'proof_plain', 300000);
  v_g := (j ->> 'grant_id')::uuid; v_prog := (j ->> 'programme_id')::uuid;
  set local session_replication_role = replica;
  update public.access_fund_grants set expires_at = now() - interval '1 hour', approved_at = now() - interval '2 days' where id = v_g;
  set local session_replication_role = origin;
  perform pg_temp.ck('expiry: an expired grant covers nothing', '0', pg_temp.qb(v_p4, 'proof_plain') ->> 'sponsor_share_kobo');
  r := pg_temp.q_as(pg_temp.f('admin'), $q$select (public.expire_access_fund()->>'grants_expired')$q$);
  perform pg_temp.ck('expiry: expire_access_fund marks it expired', '1', r);
  perform pg_temp.ck('expiry: ...and closes its programme', 'expired,closed', (select g.status || ',' || p.status from public.access_fund_grants g join public.sponsor_programmes p on p.id = g.programme_id where g.id = v_g));
  perform pg_temp.ck('expiry: the person''s view says it has ended', 'expired', (select e ->> 'status' from jsonb_array_elements(pg_temp.jb(v_p4, $q$select public.my_access_fund_support()::text$q$)) e limit 1));

  -- cancelled by operations
  j := pg_temp.grant_for(v_p5, 'proof_plain', 300000);
  v_g := (j ->> 'grant_id')::uuid; v_prog := (j ->> 'programme_id')::uuid;
  perform pg_temp.ck('cancel: a patient cannot cancel a grant', 'true', (pg_temp.jb(v_p5, format($q$select public.ops_cancel_access_fund_grant(%L, 'Proof run: the patient trying')::text$q$, v_g)) ->> 'error' like '%access_fund_not_authorised%')::text);
  perform pg_temp.ck('cancel: a reason is required', 'true', (pg_temp.jb(pg_temp.f('admin'), format($q$select public.ops_cancel_access_fund_grant(%L, 'short')::text$q$, v_g)) ->> 'error' like '%access_fund_reason_needed%')::text);
  perform pg_temp.ck('cancel: operations cancel an unused grant', 'cancelled', pg_temp.jb(pg_temp.f('admin'), format($q$select public.ops_cancel_access_fund_grant(%L, 'Proof run: the support is no longer needed')::text$q$, v_g)) ->> 'result');
  perform pg_temp.ck('cancel: the programme is closed and the person is no longer covered', 'closed,0', (select status from public.sponsor_programmes where id = v_prog) || ',' || (pg_temp.qb(v_p5, 'proof_plain') ->> 'sponsor_share_kobo'));
  perform pg_temp.ck('cancel: a cancelled grant cannot be cancelled again', 'not_open', pg_temp.jb(pg_temp.f('admin'), format($q$select public.ops_cancel_access_fund_grant(%L, 'Proof run: trying a second time')::text$q$, v_g)) ->> 'result');
  perform pg_temp.ck('cancel: only the used and approved grants count against the Fund (cancelled and expired count for nothing)', '600000',
    (select private.fund_committed(pg_temp.f('org'), true, 'proof_plain')::text));
end $$;

-- 4. ACCEPTANCE: a donation cannot be used as a stored balance by anyone, including the donor (INV-09) -------------------------------
do $$
declare v_donor uuid := pg_temp.f('donor'); o jsonb; q jsonb;
begin
  perform pg_temp.ck('the donor has received gifts on record (so there is something to misuse)', 'true', ((select coalesce(sum(amount_kobo), 0) from public.donations where donor_profile_id = v_donor and state = 'received') > 0)::text);
  q := pg_temp.qb(v_donor, 'proof_consult');
  perform pg_temp.ck('the donor''s quote is the ordinary price: nothing is deducted for their gifts', '500000,0', (q ->> 'amount_due_kobo') || ',' || (q ->> 'sponsor_share_kobo'));
  o := pg_temp.mkc(v_donor, 'proof_consult');
  perform pg_temp.ck('the donor''s order is the ordinary price and waits for a card', '500000,created', (o ->> 'amount_kobo') || ',' || (o ->> 'state'));
  perform pg_temp.ck('the donor cannot read the donations table directly', 'true', (pg_temp.try_as(v_donor, 'select 1 from public.donations limit 1') like '%permission denied%')::text);
  perform pg_temp.ck('the donor cannot write the donations table directly', 'true', (pg_temp.try_as(v_donor, format($q$update public.donations set state = 'received' where donor_profile_id = %L$q$, v_donor)) like '%permission denied%')::text);
  perform pg_temp.ck('the donor cannot insert a donation directly', 'true', (pg_temp.try_as(v_donor, format($q$insert into public.donations (organisation_id, donor_profile_id, reference, amount_kobo, pledge_expires_at) values (%L, %L, 'CAF-ZZZZZZZZ', 100000, now())$q$, pg_temp.f('org'), v_donor)) like '%permission denied%')::text);
  perform pg_temp.ck('the donor cannot read the grants table, nor the pool', 'true', (pg_temp.try_as(v_donor, 'select 1 from public.access_fund_grants limit 1') like '%permission denied%')::text);
  perform pg_temp.ck('the donor cannot call the operations functions', 'true', (pg_temp.q_as(v_donor, $q$select public.admin_access_fund_overview()::text$q$) like '%access_fund_not_authorised%')::text);
  perform pg_temp.ck('the only donation functions a signed-in person can run are the four intended', 'cancel_my_donation,my_donations,ops_confirm_donation_received,pledge_donation',
    (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname ilike '%donation%' and has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  perform pg_temp.ck('nothing in the database can point at a donation as a payment (no foreign key to donations)', '0',
    (select count(*)::text from pg_constraint where confrelid = 'public.donations'::regclass and contype = 'f'));
  perform pg_temp.ck('no payment, order, entitlement, reservation or voucher column mentions a donation', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('orders', 'payments', 'entitlements', 'sponsor_reservations', 'care_vouchers', 'patient_memberships') and column_name ilike '%donation%'));
  perform pg_temp.ck('donations has no balance, available, remaining or credit column', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('donations', 'access_fund_grants') and column_name ~* '(balance|available|remaining|credit|wallet)'));
  perform pg_temp.ck('a gift is only ever a fact about money received: its amount cannot change after the fact', 'true',
    (pg_temp.owner_sql(format($q$update public.donations set amount_kobo = amount_kobo + 1 where donor_profile_id = %L and state = 'received'$q$, v_donor)) like '%donation_immutable%')::text);
end $$;

-- 5. Payment requests (19.13) --------------------------------------------------------------------------------------------------
do $$
declare
  v_req uuid := pg_temp.f('requester'); v_payer uuid := pg_temp.f('payer'); v_payer2 uuid := pg_temp.f('payer2'); j jsonb; v_code text; v_code2 text; v_id uuid; o jsonb; v_oid uuid; r text; p jsonb; k integer; v_ref text;
begin
  perform pg_temp.ck('only the yearly Membership can be asked for (nothing smaller can be a gift, S29c)', 'true', (pg_temp.mkreq(v_req, 'proof_consult') ->> 'error' like '%gift_item_not_allowed%')::text);
  perform pg_temp.ck('a person who is already a member is told so', 'true', (pg_temp.mkreq(pg_temp.f('member')) ->> 'error' like '%already_member%')::text);
  perform pg_temp.ck('a clinician cannot create one', 'true', (pg_temp.mkreq(pg_temp.f('clin')) ->> 'error' like '%request_not_authorised%')::text);
  perform pg_temp.ck('anon cannot create one', '42501', pg_temp.try_anon($q$select public.create_payment_request('proof_member', null)$q$));
  perform pg_temp.ck('a view-only caregiver cannot make one for the person', 'true', (pg_temp.mkreq(pg_temp.f('cgv'), 'proof_member', v_req) ->> 'error' like '%request_not_authorised%')::text);
  j := pg_temp.mkreq(pg_temp.f('cgp'), 'proof_member', v_req);
  perform pg_temp.ck('CONTROL: a caregiver holding manage_payments can make one for the person', 'true', (j ? 'request_id')::text);

  j := pg_temp.mkreq(v_req);
  v_code := j ->> 'code'; v_id := (j ->> 'request_id')::uuid;
  perform pg_temp.ck('the code is unguessable in shape: pr_ and 24 URL-safe characters', 'true', (v_code ~ '^pr_[A-Za-z0-9_-]{24}$')::text);
  perform pg_temp.ck('the code is stored only as an HMAC: no column holds it', 'false', (select (pr::text like '%' || v_code || '%')::text from public.payment_requests pr where id = v_id));
  perform pg_temp.ck('the stored hash is 64 hex characters and is not the code', 'true', (select (code_hash ~ '^[0-9a-f]{64}$' and code_hash <> v_code)::text from public.payment_requests where id = v_id));
  perform pg_temp.ck('it expires in seven days', '7', (select round(extract(epoch from (expires_at - created_at)) / 86400)::text from public.payment_requests where id = v_id));
  perform pg_temp.ck('the requester''s list shows it with no code in it', 'created_at,expires_at,id,item_code,name_key,paid_at,status',
    (select string_agg(kk, ',' order by kk) from jsonb_object_keys(pg_temp.jb(v_req, $q$select public.my_payment_requests()::text$q$) -> 0) kk));
  perform pg_temp.ck('another patient''s list does not show it', '0', jsonb_array_length(pg_temp.jb(pg_temp.f('other'), $q$select public.my_payment_requests()::text$q$))::text);

  -- the link page: server only, generic, no person
  p := pg_temp.prev(v_code);
  perform pg_temp.ck('the preview shows a generic item key and the price, nothing else', 'amount_kobo,components,expires_at,name_key,status',
    (select string_agg(kk, ',' order by kk) from jsonb_object_keys(p) kk));
  perform pg_temp.ck('...the amount is the catalogue price and the components are the fee split', '10000000,10000000', (p ->> 'amount_kobo') || ',' || (p #>> '{components,tarragon_service_fee}'));
  perform pg_temp.ck('INV-07: the preview carries no name, id or condition of the requester', 'false', (p::text ~* (v_req::text || '|full_name|S72 requester'))::text);
  perform pg_temp.ck('anon cannot call the preview', '42501', pg_temp.try_anon(format($q$select public.payment_request_preview(%L, 'visitor-proof-0002')$q$, v_code)));
  perform pg_temp.ck('a signed-in patient cannot call the preview either', 'true', (pg_temp.q_as(v_payer, format($q$select public.payment_request_preview(%L, 'visitor-proof-0002')::text$q$, v_code)) like '%permission denied%')::text);
  perform pg_temp.ck('an unknown code answers unknown', 'unknown', pg_temp.prev('pr_aaaaaaaaaaaaaaaaaaaaaaaa') ->> 'status');
  perform pg_temp.ck('a malformed code answers unknown', 'unknown', pg_temp.prev('../etc/passwd') ->> 'status');
  perform pg_temp.ck('a missing visitor id is refused', 'true', (pg_temp.svc(format($q$select public.payment_request_preview(%L, '')::text$q$, v_code)) like '%visitor_needed%')::text);
  insert into public.payment_request_attempts (visitor, at) select 'v:visitor-ratelimit', now() from generate_series(1, 31);
  perform pg_temp.ck('a visitor who looks up too many links is rate limited', 'rate_limited', pg_temp.prev(v_code, 'visitor-ratelimit') ->> 'status');
  perform pg_temp.ck('...another visitor is not', 'open', pg_temp.prev(v_code, 'visitor-proof-0003') ->> 'status');

  -- paying from the link
  perform pg_temp.ck('a person who is not signed in cannot start paying', '42501', pg_temp.try_anon(format($q$select public.create_request_order(%L, gen_random_uuid())$q$, v_code)));
  o := pg_temp.payreq(v_payer, v_code);
  v_oid := (o ->> 'order_id')::uuid;
  perform pg_temp.ck('the payer gets an order for the full price, waiting for payment', '10000000,created', (o ->> 'amount_kobo') || ',' || (o ->> 'state'));
  perform pg_temp.ck('the order is the requested item, for the requester, bought by the payer', 'proof_member,true,true',
    (select i.code || ',' || (ord.beneficiary_patient_id = v_req)::text || ',' || (ord.buyer_profile_id = v_payer)::text from public.orders ord join public.catalog_items i on i.id = ord.catalog_item_id where ord.id = v_oid));
  perform pg_temp.ck('the request is now pending payment, bound to that order', 'pending_payment,true', (select status || ',' || (order_id = v_oid)::text from public.payment_requests where id = v_id));
  perform pg_temp.ck('the preview says payment is in progress', 'pending_payment', pg_temp.prev(v_code) ->> 'status');
  perform pg_temp.ck('single use: a second payer is refused while the first is paying', 'true', (pg_temp.payreq(v_payer2, v_code) ->> 'error' like '%request_in_use%')::text);
  perform pg_temp.ck('the same payer with a fresh retry key gets the same order back', 'true', ((pg_temp.payreq(v_payer, v_code) ->> 'order_id')::uuid = v_oid)::text);
  perform pg_temp.ck('the requester cannot cancel while a payment is in progress', 'payment_in_progress', pg_temp.jb(v_req, format($q$select public.cancel_payment_request(%L)::text$q$, v_id)) ->> 'result');
  perform pg_temp.ck('nobody else can cancel it', 'not_found', pg_temp.jb(v_payer, format($q$select public.cancel_payment_request(%L)::text$q$, v_id)) ->> 'result');
  perform pg_temp.q_as(v_payer, format($q$select public.cancel_order(%L)::text$q$, v_oid));
  perform pg_temp.ck('the payer gives up: the link works again', 'open,true', (select status || ',' || (order_id is null)::text from public.payment_requests where id = v_id));
  o := pg_temp.payreq(v_payer2, v_code);
  v_oid := (o ->> 'order_id')::uuid; v_ref := (select paystack_reference from public.orders where id = v_oid);
  perform pg_temp.ck('a different supporter can then pay from it', 'true', (v_oid is not null)::text);
  r := pg_temp.pay(v_ref, 10000000);
  perform pg_temp.ck('the payment is recorded', 'paid', r);
  perform pg_temp.ck('the request is paid, with the payer and time recorded', 'paid,true,true', (select status || ',' || (payer_id = v_payer2)::text || ',' || (paid_at is not null)::text from public.payment_requests where id = v_id));
  perform pg_temp.ck('the requester has the Membership', '1', (select count(*)::text from public.patient_memberships where patient_id = v_req and state = 'active'));
  perform pg_temp.ck('the entitlement says a supporter paid, and gives days left', 'supporter,365',
    (select (e ->> 'source') || ',' || (e ->> 'days_left') from jsonb_array_elements(pg_temp.jb(v_req, $q$select public.my_entitlements()::text$q$)) e where e ->> 'kind' = 'membership'));
  perform pg_temp.ck('single use: the used link is refused', 'true', (pg_temp.payreq(v_payer, v_code) ->> 'error' like '%request_used%')::text);
  perform pg_temp.ck('the preview of a used link says so', 'paid', pg_temp.prev(v_code) ->> 'status');
  perform pg_temp.ck('a used link cannot be cancelled', 'not_open', pg_temp.jb(v_req, format($q$select public.cancel_payment_request(%L)::text$q$, v_id)) ->> 'result');
  perform pg_temp.ck('the payer''s orders say they are the buyer; the requester''s say they are not', 'true,false',
    (select (e ->> 'is_buyer') from jsonb_array_elements(pg_temp.jb(v_payer2, $q$select public.my_orders()::text$q$)) e where e ->> 'order_id' = v_oid::text) || ',' ||
    (select (e ->> 'is_buyer') from jsonb_array_elements(pg_temp.jb(v_req, $q$select public.my_orders()::text$q$)) e where e ->> 'order_id' = v_oid::text));
  perform pg_temp.ck('the requester cannot request a refund of an order a supporter paid', 'not_found', pg_temp.jb(v_req, format($q$select public.request_order_refund(%L, 'Proof run: not mine to refund')::text$q$, v_oid)) ->> 'result');
  perform pg_temp.ck('the supporter can request the refund, and my_orders then says so', 'requested,pending',
    (pg_temp.jb(v_payer2, format($q$select public.request_order_refund(%L, 'Proof run: asking for a refund')::text$q$, v_oid)) ->> 'result') || ',' ||
    (select (e ->> 'refund_state') from jsonb_array_elements(pg_temp.jb(v_payer2, $q$select public.my_orders()::text$q$)) e where e ->> 'order_id' = v_oid::text));

  -- expired, cancelled, own
  j := pg_temp.mkreq(pg_temp.f('other'));
  v_code2 := j ->> 'code';
  update public.payment_requests set expires_at = now() - interval '1 minute' where id = (j ->> 'request_id')::uuid;
  perform pg_temp.ck('an expired link is refused at payment', 'true', (pg_temp.payreq(v_payer, v_code2) ->> 'error' like '%request_expired%')::text);
  perform pg_temp.ck('...and the preview says expired', 'expired', pg_temp.prev(v_code2) ->> 'status');
  perform pg_temp.ck('...and the requester''s list says expired', 'expired', (select e ->> 'status' from jsonb_array_elements(pg_temp.jb(pg_temp.f('other'), $q$select public.my_payment_requests()::text$q$)) e where e ->> 'id' = j ->> 'request_id'));
  j := pg_temp.mkreq(pg_temp.f('pat'));
  v_code2 := j ->> 'code';
  perform pg_temp.ck('the requester cancels an open link', 'cancelled', pg_temp.jb(pg_temp.f('pat'), format($q$select public.cancel_payment_request(%L)::text$q$, j ->> 'request_id')) ->> 'result');
  perform pg_temp.ck('a cancelled link is refused at payment', 'true', (pg_temp.payreq(v_payer, v_code2) ->> 'error' like '%request_cancelled%')::text);
  perform pg_temp.ck('...and the preview says cancelled', 'cancelled', pg_temp.prev(v_code2) ->> 'status');
  perform pg_temp.ck('a cancelled link cannot be cancelled again', 'not_open', pg_temp.jb(pg_temp.f('pat'), format($q$select public.cancel_payment_request(%L)::text$q$, j ->> 'request_id')) ->> 'result');
  j := pg_temp.mkreq(pg_temp.f('pat2'));
  perform pg_temp.ck('you cannot pay your own request', 'true', (pg_temp.payreq(pg_temp.f('pat2'), j ->> 'code') ->> 'error' like '%request_own%')::text);
  perform pg_temp.ck('a real person cannot pay a test person''s link (the two worlds never mix, INV-13)', 'true', (pg_temp.payreq(pg_temp.f('real'), j ->> 'code') ->> 'error' like '%request_not_payable%')::text);
  perform pg_temp.ck('an unknown code at payment is not found', 'true', (pg_temp.payreq(v_payer, 'pr_aaaaaaaaaaaaaaaaaaaaaaaa') ->> 'error' like '%request_not_found%')::text);
  perform pg_temp.ck('a malformed code at payment is not found', 'true', (pg_temp.payreq(v_payer, 'junk') ->> 'error' like '%request_not_found%')::text);

  -- the database itself refuses an order that does not match its request
  j := pg_temp.mkreq(pg_temp.f('pat3'));
  v_id := (j ->> 'request_id')::uuid;
  perform pg_temp.ck('ACCEPTANCE: an order for a different ITEM cannot be tied to a request', 'true',
    (pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, payment_request_id)
       select pr.organisation_id, %L, pr.beneficiary_id, i.id, (private.current_price(i.id)).id, 300000, 'tho_' || replace(gen_random_uuid()::text, '-', ''), true, pr.id from public.payment_requests pr, public.catalog_items i where pr.id = %L and i.code = 'proof_other'$q$, v_payer, v_id)) like '%request_order_mismatch%')::text);
  perform pg_temp.ck('ACCEPTANCE: an order for a different PERSON cannot be tied to a request', 'true',
    (pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, payment_request_id)
       select pr.organisation_id, %L, %L, pr.catalog_item_id, (private.current_price(pr.catalog_item_id)).id, 10000000, 'tho_' || replace(gen_random_uuid()::text, '-', ''), true, pr.id from public.payment_requests pr where pr.id = %L$q$, v_payer, pg_temp.f('other'), v_id)) like '%request_order_mismatch%')::text);
  perform pg_temp.ck('an order the requester bought for themselves cannot be tied to their own request', 'true',
    (pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, payment_request_id)
       select pr.organisation_id, pr.beneficiary_id, pr.beneficiary_id, pr.catalog_item_id, (private.current_price(pr.catalog_item_id)).id, 10000000, 'tho_' || replace(gen_random_uuid()::text, '-', ''), true, pr.id from public.payment_requests pr where pr.id = %L$q$, v_id)) like '%request_order_mismatch%')::text);
  perform pg_temp.ck('CONTROL: the matching order for the matching person is accepted', 'ok',
    pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, payment_request_id)
       select pr.organisation_id, %L, pr.beneficiary_id, pr.catalog_item_id, (private.current_price(pr.catalog_item_id)).id, 10000000, 'tho_' || replace(gen_random_uuid()::text, '-', ''), true, pr.id from public.payment_requests pr where pr.id = %L$q$, v_payer, v_id)));
  perform pg_temp.ck('a request link cannot be moved onto another order afterwards', 'true',
    (pg_temp.owner_sql(format($q$update public.orders set payment_request_id = null where payment_request_id = %L$q$, v_id)) like '%order_immutable%')::text);
  update public.payment_requests set status = 'cancelled', cancelled_at = now() where id = v_id;
  perform pg_temp.ck('an order cannot be tied to a request that is no longer open', 'true',
    (pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, payment_request_id)
       select pr.organisation_id, %L, pr.beneficiary_id, pr.catalog_item_id, (private.current_price(pr.catalog_item_id)).id, 10000000, 'tho_' || replace(gen_random_uuid()::text, '-', ''), true, pr.id from public.payment_requests pr where pr.id = %L$q$, v_payer, v_id)) like '%request_order_mismatch%')::text);

  -- limits
  k := 0;
  for r in select pg_temp.mkreq(pg_temp.f('pat5')) ->> 'request_id' from generate_series(1, 6) loop null; end loop;
  perform pg_temp.ck('a person can have at most five open links', '5', (select count(*)::text from public.payment_requests where requester_id = pg_temp.f('pat5') and status = 'open'));
  perform pg_temp.ck('the sixth is refused with its own code', 'true', (pg_temp.mkreq(pg_temp.f('pat5')) ->> 'error' like '%too_many_requests%')::text);
  -- fails closed without the pepper
  delete from vault.secrets where name = 'payment_request_pepper';
  perform pg_temp.ck('without the pepper a link cannot be made', 'true', (pg_temp.mkreq(pg_temp.f('pat4')) ->> 'error' like '%payment_requests_not_configured%')::text);
  perform pg_temp.ck('without the pepper a link cannot be looked up', 'true', (pg_temp.svc(format($q$select public.payment_request_preview(%L, 'visitor-proof-0009')::text$q$, v_code)) like '%payment_requests_not_configured%')::text);
  perform pg_temp.ck('without the pepper a link cannot be paid', 'true', (pg_temp.payreq(v_payer, v_code) ->> 'error' like '%payment_requests_not_configured%')::text);
  perform vault.create_secret('s72-proof-pepper-value', 'payment_request_pepper');
  perform pg_temp.ck('with the pepper back the same link is found again (the hash is stable)', 'paid', pg_temp.prev(v_code) ->> 'status');
  perform pg_temp.ck('expire_payment_requests runs for admin and service role only', 'true,true',
    (pg_temp.q_as(pg_temp.f('other'), 'select public.expire_payment_requests()::text') like '%request_not_authorised%')::text || ',' || (pg_temp.svc('select public.expire_payment_requests()::text') ~ '^[0-9]+$')::text);
end $$;

-- 6. Entitlements and orders (19.12, 19.8) ---------------------------------------------------------------------------------------
do $$
declare v_spm uuid := pg_temp.f('spm'); v_b uuid := pg_temp.f('other'); v_prog uuid; o jsonb; v_oid uuid; r text; q jsonb;
begin
  v_prog := pg_temp.mkprog(pg_temp.f('sponsor'), 'S72 acme proof', array['proof_plain'], 100, 8000000, null, 'cohort', pg_temp.f('cohort'), null);
  o := pg_temp.mkc(v_spm, 'proof_plain');
  perform pg_temp.ck('a sponsor-paid item is covered with no payment step', '0,paid,true', (o ->> 'amount_kobo') || ',' || (o ->> 'state') || ',' || (o ->> 'covered'));
  perform pg_temp.ck('...its entitlement says it is covered by the sponsor, by name', 'sponsor,S72 Acme Ltd,false',
    (select (e ->> 'source') || ',' || (e ->> 'sponsor_name') || ',' || (e ->> 'part_covered') from jsonb_array_elements(pg_temp.jb(v_spm, $q$select public.my_entitlements()::text$q$)) e where e ->> 'kind' = 'consultation_credit'));
  perform pg_temp.ck('...and shows its uses remaining', '1', (select e ->> 'remaining_uses' from jsonb_array_elements(pg_temp.jb(v_spm, $q$select public.my_entitlements()::text$q$)) e where e ->> 'kind' = 'consultation_credit'));
  -- an ordinary purchase
  o := pg_temp.mkc(v_b, 'proof_consult');
  v_oid := (o ->> 'order_id')::uuid;
  r := pg_temp.pay((select paystack_reference from public.orders where id = v_oid), 500000);
  perform pg_temp.ck('an ordinary purchase is paid', 'paid', r);
  perform pg_temp.ck('...its entitlement says you bought it and has two uses left and no end date', 'paid,2,',
    (select (e ->> 'source') || ',' || (e ->> 'remaining_uses') || ',' || coalesce(e ->> 'days_left', '') from jsonb_array_elements(pg_temp.jb(v_b, $q$select public.my_entitlements()::text$q$)) e where e ->> 'kind' = 'consultation_credit'));
  perform pg_temp.ck('a person sees only their own entitlements', '0', (select count(*)::text from jsonb_array_elements(pg_temp.jb(pg_temp.f('clin'), $q$select public.my_entitlements()::text$q$))));
  perform pg_temp.ck('my_orders says the buyer is the buyer and no refund has been asked for', 'true,',
    (select (e ->> 'is_buyer') || ',' || coalesce(e ->> 'refund_state', '') from jsonb_array_elements(pg_temp.jb(v_b, $q$select public.my_orders()::text$q$)) e where e ->> 'order_id' = v_oid::text));
  perform pg_temp.ck('a refund request goes through the existing function', 'requested', pg_temp.jb(v_b, format($q$select public.request_order_refund(%L, 'Proof run: asking for a refund')::text$q$, v_oid)) ->> 'result');
  perform pg_temp.ck('...and my_orders then says pending', 'pending', (select e ->> 'refund_state' from jsonb_array_elements(pg_temp.jb(v_b, $q$select public.my_orders()::text$q$)) e where e ->> 'order_id' = v_oid::text));
  perform pg_temp.ck('a covered order has nothing to refund', 'covered_by_sponsor', pg_temp.jb(v_spm, format($q$select public.request_order_refund(%L, 'Proof run: asking for a refund')::text$q$, (select order_id from public.entitlements where patient_id = v_spm limit 1))) ->> 'result');
end $$;

-- 7. Access and RLS ---------------------------------------------------------------------------------------------------------------
do $$
declare f text; t text;
begin
  foreach t in array array['checkout_extras_config', 'donations', 'access_fund_grants', 'payment_requests', 'payment_request_attempts'] loop
    perform pg_temp.ck('RLS is on and anon, authenticated have no table access: ' || t, 'true,false,false,false,false',
      ((select relrowsecurity from pg_class where oid = ('public.' || t)::regclass)::text || ',' || has_table_privilege('anon', 'public.' || t, 'SELECT') || ',' ||
       has_table_privilege('authenticated', 'public.' || t, 'SELECT') || ',' || has_table_privilege('authenticated', 'public.' || t, 'INSERT') || ',' || has_table_privilege('authenticated', 'public.' || t, 'UPDATE')));
  end loop;
  foreach f in array array['public.pledge_donation(bigint,text)', 'public.cancel_my_donation(uuid)', 'public.my_donations()', 'public.my_access_fund_support()', 'public.ops_confirm_donation_received(uuid,text,text)',
    'public.ops_approve_access_fund_grant(uuid,text,bigint,text,text)', 'public.ops_cancel_access_fund_grant(uuid,text)', 'public.admin_access_fund_overview()', 'public.expire_access_fund()',
    'public.create_payment_request(text,uuid)', 'public.cancel_payment_request(uuid)', 'public.my_payment_requests()', 'public.create_request_order(text,uuid)', 'public.expire_payment_requests()',
    'public.my_entitlements()', 'public.my_orders()', 'public.access_fund_public_report()', 'public.payment_request_preview(text,text)', 'public.admin_sponsor_programmes()',
    'private.sponsor_match(uuid,uuid,uuid,boolean)', 'private.fund_general_needed(uuid,boolean,text,bigint)', 'private.payment_request_hash(text)', 'private.fund_sponsor_org(uuid)',
    'private.go_live_conditions(text,uuid)', 'private.go_live_conditions_s71(text,uuid)', 'private.fund_min_cell()', 'private.extras_rules()'] loop
    perform pg_temp.ck('anon cannot execute ' || f, 'false', has_function_privilege('anon', f, 'EXECUTE')::text);
  end loop;
  foreach f in array array['public.access_fund_public_report()', 'public.payment_request_preview(text,text)', 'private.sponsor_match(uuid,uuid,uuid,boolean)', 'private.payment_request_hash(text)',
    'private.go_live_conditions_s71(text,uuid)', 'private.fund_min_cell()', 'private.extras_rules()', 'private.fund_sponsor_org(uuid)'] loop
    perform pg_temp.ck('a signed-in person cannot execute ' || f, 'false', has_function_privilege('authenticated', f, 'EXECUTE')::text);
  end loop;
  perform pg_temp.ck('the service role can run the public report and the link preview', 'true,true', has_function_privilege('service_role', 'public.access_fund_public_report()', 'EXECUTE')::text || ',' || has_function_privilege('service_role', 'public.payment_request_preview(text,text)', 'EXECUTE')::text);
end $$;

-- 8. The public report: aggregate only, test data never, small cells withheld whole ---------------------------------------------------
do $$
declare rep jsonb; v_org uuid := pg_temp.f('org'); k integer;
begin
  -- the Fund guard is still off: the report shows no figures at all
  rep := pg_temp.svcj('select public.access_fund_public_report()::text');
  perform pg_temp.ck('while the Fund is closed the report shows no figures', 'false,', (rep ->> 'open') || ',' || coalesce(rep ->> 'donations', ''));
  perform pg_temp.ck('...but it does publish the criteria', '4', jsonb_array_length(rep -> 'criteria')::text);
  -- turn the guard on directly (this proof is not about the guard's own switch)
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = pg_temp.f('admin'), change_note = 'S72 proof run' where key = 'access_fund_enabled';
  set local session_replication_role = origin;
  rep := pg_temp.svcj('select public.access_fund_public_report()::text');
  perform pg_temp.ck('open, with only test data on record, every figure is withheld (test data is never published, INV-13)', 'true,true,20', (rep -> 'donations' ->> 'withheld') || ',' || (rep -> 'grants' ->> 'withheld') || ',' || (rep ->> 'min_cell'));
  -- fabricate REAL (non-test) rows; foreign keys and triggers are switched off for these inserts only
  set local session_replication_role = replica;
  insert into public.donations (organisation_id, donor_profile_id, reference, amount_kobo, state, pledge_expires_at, bank_reference, received_at, is_test)
    select v_org, null, 'CAF-REAL' || lpad(g::text, 4, '0'), 1000000, 'received', now(), 'TRF-REAL-' || g, now(), false from generate_series(1, 3) g;
  insert into public.access_fund_grants (organisation_id, patient_id, item_code, ceiling_kobo, criterion_key, decision_note, status, expires_at, programme_id, order_id, used_kobo, is_test)
    select v_org, gen_random_uuid(), c, 100000, 'care_cost_is_a_barrier', 'Proof run: fabricated real row', 'used', now() + interval '10 days', gen_random_uuid(), gen_random_uuid(), 100000, false
      from unnest(array['proof_member', 'proof_member', 'proof_member', 'proof_consult', 'proof_plain', 'proof_other']) c;
  set local session_replication_role = origin;
  create or replace function private.fund_min_cell() returns integer language sql stable security definer set search_path = '' as $f$ select 2 $f$;
  rep := pg_temp.svcj('select public.access_fund_public_report()::text');
  perform pg_temp.ck('real donations at the minimum are shown, and test gifts are not counted', '3,3000000', (rep -> 'donations' ->> 'count') || ',' || (rep -> 'donations' ->> 'total_kobo'));
  perform pg_temp.ck('grant cells at the minimum are shown (membership 3, consultation 2)', 'consultation:2,membership:3',
    (select string_agg((c ->> 'kind') || ':' || (c ->> 'count'), ',' order by c ->> 'kind') from jsonb_array_elements(rep -> 'grants' -> 'by_kind') c));
  perform pg_temp.ck('a cell of one is not shown, and because it cannot be recovered by subtraction the totals are withheld too', 'true,,',
    (rep -> 'grants' ->> 'totals_withheld') || ',' || coalesce(rep -> 'grants' ->> 'count', '') || ',' || coalesce(rep -> 'grants' ->> 'total_kobo', ''));
  set local session_replication_role = replica;
  insert into public.access_fund_grants (organisation_id, patient_id, item_code, ceiling_kobo, criterion_key, decision_note, status, expires_at, programme_id, order_id, used_kobo, is_test)
    values (v_org, gen_random_uuid(), 'home_kit_sample', 100000, 'care_cost_is_a_barrier', 'Proof run: fabricated real row', 'used', now() + interval '10 days', gen_random_uuid(), gen_random_uuid(), 100000, false);
  set local session_replication_role = origin;
  rep := pg_temp.svcj('select public.access_fund_public_report()::text');
  perform pg_temp.ck('once the small cells together reach the minimum they are shown as "other" and the totals return', 'consultation:2,membership:3,other:2|7|700000',
    (select string_agg((c ->> 'kind') || ':' || (c ->> 'count'), ',' order by c ->> 'kind') from jsonb_array_elements(rep -> 'grants' -> 'by_kind') c) || '|' || (rep -> 'grants' ->> 'count') || '|' || (rep -> 'grants' ->> 'total_kobo'));
  perform pg_temp.ck('the report carries no person, no order and no reason', 'false',
    (rep::text ~* ('patient|order_id|decision_note|criterion_key|approved_by|donor'))::text);
  -- the real minimum
  create or replace function private.fund_min_cell() returns integer language sql stable security definer set search_path = '' as $f$ select greatest((private.outcome_rule('min_cell') #>> '{}')::integer, 2) $f$;
  rep := pg_temp.svcj('select public.access_fund_public_report()::text');
  perform pg_temp.ck('at the real minimum (20) three gifts and seven grants are both withheld', 'true,true', (rep -> 'donations' ->> 'withheld') || ',' || (rep -> 'grants' ->> 'withheld'));
  perform pg_temp.ck('a signed-in person cannot run the report', 'true', (pg_temp.q_as(pg_temp.f('other'), 'select public.access_fund_public_report()::text') like '%permission denied%')::text);
  perform pg_temp.ck('anon cannot run the report', '42501', pg_temp.try_anon('select public.access_fund_public_report()'));
  perform pg_temp.ck('operations see the pool: real and test never mixed', 'true',
    ((pg_temp.jb(pg_temp.f('admin'), $q$select public.admin_access_fund_overview()::text$q$) #>> '{real,received_kobo}')::bigint = 3000000)::text);
end $$;

-- 9. SABOTAGE: six protections removed; each check must flip --------------------------------------------------------------------------
do $$
declare v_o jsonb; v_g uuid; v_state text; v_pat6 uuid; r text; v_rid uuid; rep jsonb; v_cnt text;
begin
  -- (f) the effects trigger dropped: a covered order no longer marks its grant used
  drop trigger access_grant_reservation_effects on public.sponsor_reservations;
  v_pat6 := pg_temp.mkuser(pg_temp.f('org'), 'pat6', 'patient');
  v_g := (pg_temp.grant_for(v_pat6, 'proof_plain', 800000) ->> 'grant_id')::uuid;
  v_o := pg_temp.mkc(v_pat6, 'proof_plain');
  select status into v_state from public.access_fund_grants where id = v_g;
  insert into results values ('sabotaged', 'a covered order marks its grant used', 'used', coalesce(v_state, 'null') || ' (order ' || coalesce(v_o ->> 'state', v_o::text) || ')');

  -- (b) the request guard dropped: an order for a different item can be tied to a request
  v_rid := (pg_temp.mkreq(pg_temp.f('pat4')) ->> 'request_id')::uuid;
  drop trigger orders_payment_request_guard on public.orders;
  r := pg_temp.owner_sql(format($q$insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, payment_request_id)
       select pr.organisation_id, %L, pr.beneficiary_id, i.id, (private.current_price(i.id)).id, 300000, 'tho_' || replace(gen_random_uuid()::text, '-', ''), true, pr.id from public.payment_requests pr, public.catalog_items i where pr.id = %L and i.code = 'proof_other'$q$, pg_temp.f('payer'), v_rid));
  insert into results values ('sabotaged', 'an order for a different item cannot be tied to a request', 'refused', case when r like '%request_order_mismatch%' then 'refused' else 'accepted' end);

  -- (c) a foreign key from an order to a donation: a donation could then be the payment of an order
  alter table public.orders add column donation_id uuid references public.donations (id);
  insert into results values ('sabotaged', 'nothing in the database can point at a donation as a payment (no foreign key to donations)', '0',
    (select count(*)::text from pg_constraint where confrelid = 'public.donations'::regclass and contype = 'f'));

  -- (d) the donations table opened to the donor
  grant select on public.donations to authenticated;
  create policy sab_donor_read on public.donations for select to authenticated using (donor_profile_id = (select auth.uid()));
  v_cnt := pg_temp.q_as(pg_temp.f('donor'), 'select count(*)::text from public.donations');
  insert into results values ('sabotaged', 'the donor cannot read the donations table directly', 'blocked', case when v_cnt like 'ERR:%' then 'blocked' else 'readable' end);

  -- (e) the minimum-cell rule weakened to one: three real gifts would be published
  create or replace function private.fund_min_cell() returns integer language sql stable security definer set search_path = '' as $f$ select 1 $f$;
  rep := pg_temp.svcj('select public.access_fund_public_report()::text');
  insert into results values ('sabotaged', 'three real gifts are withheld at the real minimum', 'withheld', case when rep -> 'donations' ->> 'withheld' = 'true' then 'withheld' else 'shown' end);

  -- (a) the grant-eligibility test removed from the sponsor match: anyone is covered by anyone's grant
  create or replace function private.sponsor_match(p_beneficiary uuid, p_item uuid, p_sponsor_org uuid default null, p_check_eligibility boolean default true)
  returns public.sponsor_programmes language plpgsql stable security definer set search_path = '' as $f$
  declare bn public.profiles%rowtype; it public.catalog_items%rowtype; r public.sponsor_programmes%rowtype;
  begin
    select * into bn from public.profiles where id = p_beneficiary;
    select * into it from public.catalog_items where id = p_item;
    select p.* into r from public.sponsor_programmes p
     where p.organisation_id = bn.organisation_id and p.status = 'active' and p.is_test = coalesce(bn.is_test, false) and it.code = any (p.item_codes) and p.eligibility = 'access_grant'
     order by private.sponsor_budget_left(p.id) desc, p.id limit 1;
    if not found then return null; end if;
    return r;
  end $f$;
  insert into results values ('sabotaged', 'a patient with no grant is not covered by someone else''s grant', '0',
    coalesce(pg_temp.qb(pg_temp.f('other'), 'proof_plain') ->> 'sponsor_share_kobo', 'error'));
end $$;

do $$
declare v_bad integer; v_caught integer; v_real integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S72 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_real from results where phase = 'real';
  if v_real < 150 then raise exception 'VACUOUS TEST: only % checks ran', v_real; end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 6 then raise exception 'VACUOUS TEST: the sabotage flipped % of 6 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
