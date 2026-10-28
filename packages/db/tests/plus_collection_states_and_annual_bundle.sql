-- Proof: Membership Plus collection states and the open annual test bundle (migration 20261026130810, decision 2026-10-26).
-- One rolled-back transaction. Sections:
--   A. The four launch states are approved for Plus; every other state is not; an admin can approve and withdraw one, and each change is audited.
--   B. The partner-lab picker is nationwide: it lists labs in a state that is NOT approved for Plus and not is_active, and towns come from the mapping.
--   C. Any patient (no membership of any kind) starts the bundle once; a second start is refused; a direct insert that skips the function is refused;
--      anon cannot call any of the functions; a non-patient cannot start one.
--   D. SABOTAGE: the origin-guard extension is reverted and starting must then fail, proving the extension is what lets the function work.
begin;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;


-- Review fixes (migration *_annual_bundle_review_fixes.sql): acting for someone, the lock, the INSERT audit, the town rule
do $$
declare
  v_org uuid; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); r text; v_def text; v_ord uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (a, 'rfa-' || a || '@example.invalid', 'x', now(), '{}', '{}'), (b, 'rfb-' || b || '@example.invalid', 'x', now(), '{}', '{}'), (c, 'rfc-' || c || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test) values
    (a, v_org, 'patient', 'RF dependant', '+23480' || lpad((random()*99999999)::int::text, 8, '0'), '1950-01-01', true),
    (b, v_org, 'patient', 'RF carer', '+23480' || lpad((random()*99999999)::int::text, 8, '0'), '1980-01-01', true),
    (c, v_org, 'patient', 'RF stranger', '+23480' || lpad((random()*99999999)::int::text, 8, '0'), '1980-01-01', true)
  on conflict (id) do update set role = 'patient', is_test = true, is_active = true;

  -- a stranger cannot start the dependant's bundle; the carer without the permission cannot either
  r := pg_temp.as_user(c, format('select public.start_annual_bundle(null, %L)::text', a));
  if r not like 'ERR:42501%' then raise exception 'FAIL R1: a stranger started someone else''s bundle: %', r; end if;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions)
    values (a, b, 'manage', a, array['log_readings']::public.caregiver_permission[]);
  r := pg_temp.as_user(b, format('select public.start_annual_bundle(null, %L)::text', a));
  if r not like 'ERR:42501%' then raise exception 'FAIL R2: a carer without book_appointments started the bundle: %', r; end if;
  -- with the permission, the order belongs to the dependant, not the carer
  update public.profile_access set permissions = array['book_appointments']::public.caregiver_permission[] where profile_id = a and grantee_user_id = b;
  r := pg_temp.as_user(b, format('select public.start_annual_bundle(null, %L)::text', a));
  if r like 'ERR:%' then raise exception 'FAIL R3: a permitted carer could not start the bundle: %', r; end if;
  v_ord := r::uuid;
  if (select patient_id from public.lab_orders where id = v_ord) is distinct from a then raise exception 'FAIL R4: the order is not the dependant''s'; end if;
  if exists (select 1 from public.lab_orders where patient_id = b and panel_code = 'membership_annual') then raise exception 'FAIL R5: the carer got a bundle on their own account'; end if;

  -- the lock that makes the once-a-year check hold when two calls overlap (one session cannot race itself, so the lock is checked in the body)
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.start_annual_bundle(uuid,uuid)'::regprocedure)) = 0 then raise exception 'FAIL R6: the per-patient lock is gone'; end if;
  if to_regprocedure('public.start_annual_bundle(uuid)') is not null then raise exception 'FAIL R7: the ambiguous one-argument overload exists'; end if;

  -- an approval made by INSERT is audited and timestamped like one made by UPDATE
  insert into public.service_regions (state, display_name, plus_collection_enabled) values ('ZZ Proof State', 'ZZ Proof State', true);
  if (select plus_collection_enabled_at from public.service_regions where state = 'ZZ Proof State') is null then raise exception 'FAIL R8: an inserted approval has no timestamp'; end if;
  if not exists (select 1 from public.audit_log where action = 'service_region.plus_collection_enabled' and event ->> 'state' = 'ZZ Proof State') then raise exception 'FAIL R9: an inserted approval was not audited'; end if;
  delete from public.service_regions where state = 'ZZ Proof State';

  -- an active branch needs a town
  begin
    insert into public.lab_provider_locations (lab_provider_id, name, state, address, is_active)
      select id, 'RF no-town branch', 'Kano', '2 Test Road', true from public.lab_providers where is_active order by created_at limit 1;
    raise exception 'FAIL R10: an active branch with no town was accepted';
  exception when check_violation then null; end;
  begin
    update public.lab_provider_locations set town = null where state = 'Oyo' and is_active;
    raise exception 'FAIL R11: an active branch lost its town';
  exception when check_violation then null; end;

  -- SABOTAGE: the permission check removed; a stranger must then be able to start someone else's bundle (so R1 can fail)
  v_def := pg_get_functiondef('public.start_annual_bundle(uuid,uuid)'::regprocedure);
  if position('and not private.can_act_for(v_patient' in v_def) = 0 then raise exception 'FAIL R12: sabotage cannot apply, test is stale'; end if;
  execute replace(v_def, 'and not private.can_act_for(v_patient', 'and false and not private.can_act_for(v_patient');
  delete from public.lab_orders where patient_id = a;
  r := pg_temp.as_user(c, format('select public.start_annual_bundle(null, %L)::text', a));
  if r like 'ERR:42501%' then raise exception 'FAIL R13: the acting-for check did not flip under sabotage'; end if;
  execute v_def;
end $$;

do $$
declare
  v_org uuid; v_pat uuid := gen_random_uuid(); v_staff uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  r text; v_loc uuid; v_def text; v_n integer;
  v_old constant text := E'(coalesce(current_setting(''tarragon.testing_day_checkin'', true), '''') = ''on'' or coalesce(current_setting(''tarragon.annual_bundle_start'', true), '''') = ''on'')';
  v_orig constant text := E'coalesce(current_setting(''tarragon.testing_day_checkin'', true), '''') = ''on''';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat, 'pb-' || v_pat || '@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff, 'pbs-' || v_staff || '@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'pba-' || v_admin || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test) values
    (v_pat, v_org, 'patient', 'PB patient', '+23480' || lpad((random()*99999999)::int::text, 8, '0'), '1980-01-01', true),
    (v_staff, v_org, 'clinician', 'PB clinician', '+23480' || lpad((random()*99999999)::int::text, 8, '0'), '1980-01-01', true),
    (v_admin, v_org, 'admin', 'PB admin', '+23480' || lpad((random()*99999999)::int::text, 8, '0'), '1980-01-01', true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true;

  -- A. launch states
  select count(*) into v_n from public.service_regions where plus_collection_enabled;
  if v_n <> 4 then raise exception 'FAIL A1: expected exactly 4 Plus states, got %', v_n; end if;
  if exists (select 1 from public.service_regions where plus_collection_enabled and state not in ('Lagos', 'Oyo', 'Osun', 'Ogun')) then
    raise exception 'FAIL A2: a non-launch state is approved'; end if;
  if private.plus_collection_state_enabled('Abuja') then raise exception 'FAIL A3: Abuja must not be approved'; end if;
  if not private.plus_collection_state_enabled('Oyo') then raise exception 'FAIL A4: Oyo must be approved'; end if;
  update public.service_regions set plus_collection_enabled = true where state = 'Abuja';
  if not private.plus_collection_state_enabled('Abuja') then raise exception 'FAIL A5: admin approval did not take effect'; end if;
  if not exists (select 1 from public.audit_log where action = 'service_region.plus_collection_enabled' and event ->> 'state' = 'Abuja') then
    raise exception 'FAIL A6: approval was not audited'; end if;
  update public.service_regions set plus_collection_enabled = false where state = 'Abuja';
  if private.plus_collection_state_enabled('Abuja') then raise exception 'FAIL A7: withdrawal did not take effect'; end if;

  -- B. the picker is nationwide and independent of both state flags
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, is_active)
    select id, 'PB Kano branch', 'Kano', 'Kano City', '1 Test Road, Kano', true from public.lab_providers where is_active order by created_at limit 1 returning id into v_loc;
  if v_loc is null then raise exception 'FAIL B00: no active laboratory to hang the fixture branch on'; end if;
  if (select is_active from public.service_regions where state = 'Kano') or private.plus_collection_state_enabled('Kano') then
    raise exception 'FAIL B0: fixture assumption broken, Kano must be dark'; end if;
  r := pg_temp.as_user(v_pat, $q$select string_agg(location_name, ',') from public.list_annual_bundle_labs('Kano', 'Kano City')$q$);
  if r is distinct from 'PB Kano branch' then raise exception 'FAIL B1: dark, non-Plus state must still list its labs: %', r; end if;
  r := pg_temp.as_user(v_pat, $q$select string_agg(town, ',') from public.list_annual_bundle_towns('Oyo')$q$);
  if r is distinct from 'Ibadan' then raise exception 'FAIL B2: Oyo towns: %', r; end if;

  -- C. start once, any plan
  if exists (select 1 from public.patient_memberships where patient_id = v_pat) then raise exception 'FAIL C0: fixture has a membership'; end if;
  r := pg_temp.as_user(v_pat, format('select public.start_annual_bundle(%L)::text', v_loc));
  if r like 'ERR:%' then raise exception 'FAIL C1: a patient with no membership could not start the bundle: %', r; end if;
  if not exists (select 1 from public.lab_orders where patient_id = v_pat and panel_code = 'membership_annual' and fulfilment = 'self_arranged'
                  and total_kobo = 0 and location_id = v_loc) then raise exception 'FAIL C2: order shape wrong'; end if;
  r := pg_temp.as_user(v_pat, 'select public.start_annual_bundle(null)::text');
  if r not like 'ERR:22023:annual_bundle_already_started%' then raise exception 'FAIL C3: second start must be refused, got %', r; end if;
  delete from public.lab_orders where patient_id = v_pat;
  r := pg_temp.as_user(v_pat, format($q$insert into public.lab_orders (organisation_id, patient_id, status, panel_code, fulfilment, origin, total_kobo)
         values (%L, %L, 'ordered', 'membership_annual', 'self_arranged', 'patient_initiated', 0) returning id::text$q$, v_org, v_pat));
  if r not like 'ERR:%' then raise exception 'FAIL C4: a direct insert skipping the function must be refused, got %', r; end if;
  r := pg_temp.as_user(v_staff, 'select public.start_annual_bundle(null)::text');
  if r not like 'ERR:42501%' then raise exception 'FAIL C5: a non-patient must be refused, got %', r; end if;
  if has_function_privilege('anon', 'public.start_annual_bundle(uuid,uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.list_annual_bundle_labs(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_annual_bundle_towns(text)', 'EXECUTE') or has_function_privilege('anon', 'public.plus_collection_states()', 'EXECUTE') then
    raise exception 'FAIL C6: anon can execute a bundle function'; end if;

  -- D. SABOTAGE: revert the origin-guard extension; starting must now fail
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'enforce_lab_order_origin';
  if position(v_old in v_def) = 0 then raise exception 'FAIL D0: guard extension not found, test is stale'; end if;
  execute replace(v_def, v_old, v_orig);
  r := pg_temp.as_user(v_pat, 'select public.start_annual_bundle(null)::text');
  if r not like 'ERR:%' then raise exception 'FAIL D1: with the guard extension reverted, starting must fail (the test cannot discriminate): %', r; end if;
  raise notice 'plus_collection_states_and_annual_bundle: all assertions passed';
end $$;

rollback;
