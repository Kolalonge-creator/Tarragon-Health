-- Track E, spec 8.16: "Clinicians never see what Tarragon earns." Standing proof that the commission columns on lab_tests,
-- panel_bundles, screen_types and therapy_sessions are not readable by any signed-in role except through the owner-run admin views,
-- while price, name and active columns stay readable and every existing writer keeps working.
-- Migration: 20261007105817_e_lab_screen_therapy_commission_columns_off_the_authenticated_surface.sql
--
-- Roles proved: patient, clinician, pharmacist, lab_partner (own provider), lab_liaison, analyst, corporate_admin, hmo_admin,
-- finance (with and without commissions.view), a partner manager (partners.labs.manage), admin, anon.
-- Sabotage: inside the same rolled-back transaction the old table-wide SELECT grant is put back; the refusals must then flip to
-- leaks, or this script raises "VACUOUS TEST".
begin;

create function pg_temp.probe(p_uid uuid, p_role text, p_sql text) returns text
language plpgsql as $f$
declare v_n bigint;
begin
  if p_uid is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  else
    perform set_config('request.jwt.claims', '', true);
  end if;
  execute format('set local role %I', p_role);
  begin
    execute 'select count(*) from (' || p_sql || ') q' into v_n;
    reset role;
    return 'rows:' || v_n;
  exception when insufficient_privilege then
    reset role;
    return 'denied';
  end;
end $f$;

create temp table t_results (check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid := gen_random_uuid(); v_clin uuid := gen_random_uuid(); v_pharm uuid := gen_random_uuid();
  v_labp uuid := gen_random_uuid(); v_liaison uuid := gen_random_uuid(); v_analyst uuid := gen_random_uuid();
  v_corp uuid := gen_random_uuid(); v_hmo uuid := gen_random_uuid(); v_fin uuid := gen_random_uuid(); v_fin2 uuid := gen_random_uuid();
  v_mgr uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  v_lab uuid; v_test uuid; v_bundle uuid; v_screen uuid; v_spec uuid; v_sess uuid; v_partner uuid;
  r text; uid uuid; n bigint; v_comm bigint; s text;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'SETUP: need an organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    select u, 'e-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_patient, v_clin, v_pharm, v_labp, v_liaison, v_analyst, v_corp, v_hmo, v_fin, v_fin2, v_mgr, v_admin]) u;
  update public.profiles set organisation_id = v_org, role = 'patient', is_test = true where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'clinician', is_test = true where id = v_clin;
  update public.profiles set organisation_id = v_org, role = 'lab_liaison', is_test = true where id = v_liaison;
  update public.profiles set organisation_id = v_org, role = 'analyst', is_test = true where id = v_analyst;
  update public.profiles set organisation_id = v_org, role = 'corporate_admin', is_test = true where id = v_corp;
  update public.profiles set organisation_id = v_org, role = 'hmo_admin', is_test = true where id = v_hmo;
  update public.profiles set organisation_id = v_org, role = 'finance', is_test = true where id in (v_fin, v_fin2);
  update public.profiles set organisation_id = v_org, role = 'clinician', is_test = true where id = v_mgr;
  update public.profiles set organisation_id = v_org, role = 'admin', is_test = true where id = v_admin;

  insert into public.lab_providers (name, is_active) values ('E Test Lab', false) returning id into v_lab;
  insert into public.pharmacy_partners (name, is_active) values ('E Test Pharmacy', false) returning id into v_partner;
  update public.profiles set organisation_id = v_org, role = 'pharmacist', pharmacy_partner_id = v_partner, is_test = true where id = v_pharm;
  update public.profiles set organisation_id = v_org, role = 'lab_partner', lab_provider_id = v_lab, is_test = true where id = v_labp;

  insert into public.lab_tests (provider_id, code, name, price_kobo, commission_rate_type, commission_rate, commission_flat_kobo)
    values (v_lab, 'E_TEST_CODE', 'E Test Lab Test', 500000, 'percentage', 0.1234, 777) returning id into v_test;
  insert into public.panel_bundles (code, name, price_kobo, test_codes, commission_rate_type, commission_rate, commission_flat_kobo)
    values ('E_TEST_BUNDLE', 'E Test Bundle', 900000, array['E_TEST_CODE'], 'percentage', 0.2345, 888) returning id into v_bundle;
  insert into public.screen_types (code, name, sex_applicability, commission_rate)
    values ('E_TEST_SCREEN', 'E Test Screen', 'all', 0.3456) returning id into v_screen;

  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_fin, 'commissions.view', v_admin);
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_mgr, 'partners.labs.manage', v_admin);

  -- therapy: a verified, active psychologist taking video sessions; the patient books through the real INSERT path
  insert into public.specialist_providers (name, specialist_type, is_active, verification_stage, license_verified_at, supports_telemedicine, commission_rate_type, commission_rate)
    values ('E Test Psychologist', 'psychology', true, 'active', now(), true, 'percentage', 0.10) returning id into v_spec;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.therapy_sessions (organisation_id, patient_id, provider_id, fee_kobo, modality)
    values (v_org, v_patient, v_spec, 1000000, 'video');
  reset role;
  select id, commission_kobo into v_sess, v_comm from public.therapy_sessions where patient_id = v_patient;
  insert into t_results values ('W the patient INSERT still works and the trigger still snapshots the commission', coalesce(v_comm::text, 'null'), '100000', null);

  -- A. every non-admin role is refused each commission column, and select * fails loudly
  foreach r in array array['patient', 'clinician', 'pharmacist', 'lab_partner', 'lab_liaison', 'analyst', 'corporate_admin', 'hmo_admin', 'finance'] loop
    uid := case r when 'patient' then v_patient when 'clinician' then v_clin when 'pharmacist' then v_pharm when 'lab_partner' then v_labp
                  when 'lab_liaison' then v_liaison when 'analyst' then v_analyst when 'corporate_admin' then v_corp when 'hmo_admin' then v_hmo else v_fin2 end;
    insert into t_results select 'A ' || r || ' refused lab_tests.commission_rate', pg_temp.probe(uid, 'authenticated', 'select commission_rate from public.lab_tests'), 'denied', null;
    insert into t_results select 'A ' || r || ' refused lab_tests.commission_flat_kobo', pg_temp.probe(uid, 'authenticated', 'select commission_flat_kobo from public.lab_tests'), 'denied', null;
    insert into t_results select 'A ' || r || ' refused panel_bundles.commission_rate', pg_temp.probe(uid, 'authenticated', 'select commission_rate from public.panel_bundles'), 'denied', null;
    insert into t_results select 'A ' || r || ' refused panel_bundles.commission_rate_type', pg_temp.probe(uid, 'authenticated', 'select commission_rate_type from public.panel_bundles'), 'denied', null;
    insert into t_results select 'A ' || r || ' refused screen_types.commission_rate', pg_temp.probe(uid, 'authenticated', 'select commission_rate from public.screen_types'), 'denied', null;
    insert into t_results select 'A ' || r || ' refused therapy_sessions.commission_kobo', pg_temp.probe(uid, 'authenticated', 'select commission_kobo from public.therapy_sessions'), 'denied', null;
  end loop;
  foreach s in array array['lab_tests', 'panel_bundles', 'screen_types', 'therapy_sessions'] loop
    insert into t_results select 'A select * on ' || s || ' fails loudly for the patient', pg_temp.probe(v_patient, 'authenticated', 'select * from public.' || s), 'denied', null;
    insert into t_results select 'A select * on ' || s || ' fails loudly for the clinician', pg_temp.probe(v_clin, 'authenticated', 'select * from public.' || s), 'denied', null;
    insert into t_results select 'A anon refused ' || s, pg_temp.probe(null, 'anon', 'select id from public.' || s), 'denied', null;
  end loop;
  insert into t_results select 'A anon refused the commission column', pg_temp.probe(null, 'anon', 'select commission_rate from public.lab_tests'), 'denied', null;
  foreach s in array array['lab_tests_admin', 'panel_bundles_admin', 'screen_types_admin'] loop
    insert into t_results select 'A anon refused ' || s, pg_temp.probe(null, 'anon', 'select * from public.' || s), 'denied', null;
  end loop;

  -- B. price, name, active, code stay readable for the patient, the clinician and the lab partner
  foreach r in array array['patient', 'clinician', 'lab_partner', 'pharmacist'] loop
    uid := case r when 'patient' then v_patient when 'clinician' then v_clin when 'lab_partner' then v_labp else v_pharm end;
    insert into t_results select 'B ' || r || ' reads lab_tests price, name and active', pg_temp.probe(uid, 'authenticated',
      format('select id, code, name, price_kobo, is_active, turnaround_hours, provider_id from public.lab_tests where id = %L', v_test)), 'rows:1', null;
    insert into t_results select 'B ' || r || ' reads panel_bundles price, name, tests, prep', pg_temp.probe(uid, 'authenticated',
      format('select id, code, name, price_kobo, test_codes, is_active, preparation_instructions, indicative_price_kobo, self_bookable from public.panel_bundles where id = %L', v_bundle)), 'rows:1', null;
    insert into t_results select 'B ' || r || ' reads screen_types name, price, explainer', pg_temp.probe(uid, 'authenticated',
      format('select id, code, name, price_kobo, patient_explainer, frequency_months from public.screen_types where id = %L', v_screen)), 'rows:1', null;
  end loop;
  insert into t_results select 'B patient reads own therapy session without the commission', pg_temp.probe(v_patient, 'authenticated',
    format('select id, status, fee_kobo, modality, patient_note from public.therapy_sessions where id = %L', v_sess)), 'rows:1', null;
  insert into t_results select 'B a clinician embedding screen_types(name, code) still works', pg_temp.probe(v_clin, 'authenticated',
    'select ss.id, st.name from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id'), 'rows:0', null;
  insert into t_results select 'B patient_care_gaps (names only) still readable', pg_temp.probe(v_clin, 'authenticated', 'select gap_type from public.patient_care_gaps limit 1'), 'rows:0', null;

  -- C. the admin views: only admin, partner managers and finance with commissions.view see rows
  foreach r in array array['patient', 'clinician', 'pharmacist', 'lab_partner', 'lab_liaison', 'analyst', 'corporate_admin', 'hmo_admin', 'finance'] loop
    uid := case r when 'patient' then v_patient when 'clinician' then v_clin when 'pharmacist' then v_pharm when 'lab_partner' then v_labp
                  when 'lab_liaison' then v_liaison when 'analyst' then v_analyst when 'corporate_admin' then v_corp when 'hmo_admin' then v_hmo else v_fin2 end;
    insert into t_results select 'C ' || r || ' sees no rows in lab_tests_admin', pg_temp.probe(uid, 'authenticated', 'select commission_rate from public.lab_tests_admin'), 'rows:0', null;
    insert into t_results select 'C ' || r || ' sees no rows in panel_bundles_admin', pg_temp.probe(uid, 'authenticated', 'select commission_rate from public.panel_bundles_admin'), 'rows:0', null;
    insert into t_results select 'C ' || r || ' sees no rows in screen_types_admin', pg_temp.probe(uid, 'authenticated', 'select commission_rate from public.screen_types_admin'), 'rows:0', null;
  end loop;
  foreach r in array array['admin', 'partner manager', 'finance with commissions.view'] loop
    uid := case r when 'admin' then v_admin when 'partner manager' then v_mgr else v_fin end;
    insert into t_results select 'C ' || r || ' reads lab_tests_admin commission', pg_temp.probe(uid, 'authenticated',
      format('select commission_rate, commission_flat_kobo from public.lab_tests_admin where id = %L', v_test)), 'rows:1', null;
    insert into t_results select 'C ' || r || ' reads panel_bundles_admin commission', pg_temp.probe(uid, 'authenticated',
      format('select commission_rate, commission_rate_type, commission_flat_kobo from public.panel_bundles_admin where id = %L', v_bundle)), 'rows:1', null;
    insert into t_results select 'C ' || r || ' reads screen_types_admin commission', pg_temp.probe(uid, 'authenticated',
      format('select commission_rate from public.screen_types_admin where id = %L', v_screen)), 'rows:1', null;
  end loop;

  -- D. writers keep working: admin and partner manager edit commissions, the lab partner toggles is_active, with no RETURNING
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.panel_bundles set commission_rate = 0.5, commission_flat_kobo = 1 where id = v_bundle;
  get diagnostics n = row_count;
  update public.lab_tests set commission_rate = 0.4 where id = v_test;
  update public.screen_types set commission_rate = 0.3 where id = v_screen;
  reset role;
  insert into t_results values ('D admin commission UPDATE on panel_bundles still works', 'rows:' || n, 'rows:1', null);
  insert into t_results select 'D admin edit landed on lab_tests', (select 'rows:' || count(*) from public.lab_tests where id = v_test and commission_rate = 0.4), 'rows:1', null;
  insert into t_results select 'D admin edit landed on screen_types', (select 'rows:' || count(*) from public.screen_types where id = v_screen and commission_rate = 0.3), 'rows:1', null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.panel_bundles set commission_rate = 0.6 where id = v_bundle;
  get diagnostics n = row_count;
  reset role;
  insert into t_results values ('D partner manager commission UPDATE on panel_bundles still works', 'rows:' || n, 'rows:1', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_labp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_tests set is_active = false where id = v_test;
  get diagnostics n = row_count;
  reset role;
  insert into t_results values ('D lab partner is_active toggle on own test still works', 'rows:' || n, 'rows:1', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_tests set is_active = true where id = v_test;
  get diagnostics n = row_count;
  reset role;
  insert into t_results values ('D a clinician cannot edit lab_tests (no policy)', 'rows:' || n, 'rows:0', null);

  -- F. the RPC no longer hands the row (and the commission) back; the grant list covers every non-commission column
  insert into t_results select 'F approve_therapy_session returns void (no row to leak)',
    pg_get_function_result('public.approve_therapy_session(uuid, boolean)'::regprocedure), 'void', null;
  insert into t_results select 'F anon cannot execute approve_therapy_session',
    case when has_function_privilege('anon', 'public.approve_therapy_session(uuid, boolean)', 'EXECUTE') then 'yes' else 'no' end, 'no', null;
  update public.therapy_sessions set scheduled_for = now() + interval '2 days' where id = v_sess;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, employment_type)
    values (v_org, v_clin, 'E Test Senior Doctor', true, now(), 'senior_medical_officer', 'employed');
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.approve_therapy_session(v_sess, true);
  reset role;
  insert into t_results select 'F a clinician approving still works and stamps approved_by',
    (select 'rows:' || count(*) from public.therapy_sessions where id = v_sess and approved_by = v_clin and status = 'confirmed'), 'rows:1', null;
  insert into t_results select 'F every non-commission column of the four tables is granted',
    (select 'rows:' || count(*) from pg_attribute a
      where a.attrelid in ('public.lab_tests'::regclass, 'public.panel_bundles'::regclass, 'public.screen_types'::regclass, 'public.therapy_sessions'::regclass)
        and a.attnum > 0 and not a.attisdropped and a.attname !~ '^commission_'
        and not has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')), 'rows:0', null;
  -- a column added later is NOT readable by default, and the check above would catch it
  alter table public.panel_bundles add column e_probe_col int;
  insert into t_results select 'F SABOTAGE a newly added column is ungranted and detected',
    (select 'rows:' || count(*) from pg_attribute a
      where a.attrelid = 'public.panel_bundles'::regclass and a.attname = 'e_probe_col'
        and not has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')), 'rows:1', null;

  -- E. SABOTAGE: put the table-wide SELECT grant back; the refusals must flip to leaks
  grant select on public.lab_tests, public.panel_bundles, public.screen_types, public.therapy_sessions to authenticated;
  insert into t_results select 'E SABOTAGE patient reads lab_tests.commission_rate again (must leak)', pg_temp.probe(v_patient, 'authenticated', 'select commission_rate from public.lab_tests'), 'leak', null;
  insert into t_results select 'E SABOTAGE patient reads panel_bundles.commission_rate again (must leak)', pg_temp.probe(v_patient, 'authenticated', 'select commission_rate from public.panel_bundles'), 'leak', null;
  insert into t_results select 'E SABOTAGE clinician reads screen_types.commission_rate again (must leak)', pg_temp.probe(v_clin, 'authenticated', 'select commission_rate from public.screen_types'), 'leak', null;
  insert into t_results select 'E SABOTAGE patient reads therapy_sessions.commission_kobo again (must leak)', pg_temp.probe(v_patient, 'authenticated', 'select commission_kobo from public.therapy_sessions'), 'leak', null;
end $$;

update t_results set verdict = case when check_name ~ '^[EF] SABOTAGE' then case when observed ~ '^rows:[1-9]' then 'PASS' else 'FAIL' end
  when observed = expected then 'PASS' else 'FAIL' end;

do $$
declare v_bad text; v_vacuous int;
begin
  select string_agg(check_name || ' => ' || observed, '; ') into v_bad from t_results where verdict = 'FAIL' and check_name !~ '^[EF] SABOTAGE';
  if v_bad is not null then raise exception 'HOLE OPEN: %', v_bad; end if;
  select count(*) into v_vacuous from t_results where check_name ~ '^[EF] SABOTAGE' and verdict = 'FAIL';
  if v_vacuous > 0 then raise exception 'VACUOUS TEST: sabotage did not reproduce the leak (% checks)', v_vacuous; end if;
end $$;

select check_name, observed, expected, verdict from t_results order by check_name;

rollback;
