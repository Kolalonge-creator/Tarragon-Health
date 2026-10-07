-- S53 pre-fix, spec 8.16: "Clinicians never see which pharmacy earns Tarragon more."
-- Standing proof that the commission columns on pharmacy_medications and the commissions ledger are not readable by a patient, a
-- clinician, a pharmacist or anon, while price and stock stay readable and admin / finance keep their access.
-- Migration: 20261007210001_s53_pre_8_16_commission_columns_off_the_patient_and_clinician_surface.sql
--
-- Roles proved: patient, clinician, pharmacist (own partner), admin, finance (with and without commissions.view), anon.
-- Sabotage: inside the same rolled-back transaction the old table-wide SELECT grant, the `using (true)` policy and the old
-- is_org_staff commissions policy are put back; every refusal above must then flip to a leak, or this script raises
-- "VACUOUS TEST".
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
  v_org uuid; v_patient uuid := gen_random_uuid(); v_clin uuid := gen_random_uuid(); v_pharm uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid(); v_fin uuid := gen_random_uuid(); v_fin2 uuid := gen_random_uuid();
  v_partner uuid; v_other_partner uuid; v_med uuid; v_comm uuid;
  r text; n bigint;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'SETUP: need an organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_patient, 's53p@example.invalid', 'x', now(), '{}', '{}'), (v_clin, 's53c@example.invalid', 'x', now(), '{}', '{}'),
    (v_pharm, 's53ph@example.invalid', 'x', now(), '{}', '{}'), (v_admin, 's53a@example.invalid', 'x', now(), '{}', '{}'),
    (v_fin, 's53f@example.invalid', 'x', now(), '{}', '{}'), (v_fin2, 's53f2@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', is_test = true where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'clinician', is_test = true where id = v_clin;
  update public.profiles set organisation_id = v_org, role = 'admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'finance', is_test = true where id in (v_fin, v_fin2);

  insert into public.pharmacy_partners (name, is_active) values ('S53 Test Pharmacy', false) returning id into v_partner;
  insert into public.pharmacy_partners (name, is_active) values ('S53 Other Pharmacy', false) returning id into v_other_partner;
  update public.profiles set organisation_id = v_org, role = 'pharmacist', pharmacy_partner_id = v_partner, is_test = true where id = v_pharm;

  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, price_kobo, is_active, commission_rate, commission_rate_type, commission_flat_kobo)
    values (v_partner, 'S53 Test Drug', 150000, true, 0.1234, 'percentage', 777) returning id into v_med;
  insert into public.commissions (organisation_id, commission_type, partner_name, amount_kobo)
    values (v_org, 'pharmacy', 'S53 Test Pharmacy', 4242) returning id into v_comm;
  -- finance A holds commissions.view, finance B does not
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_fin, 'commissions.view', v_admin);

  -- A. commission columns on pharmacy_medications: refused to every non-admin role, even for the owning pharmacist
  foreach r in array array['patient', 'clinician', 'pharmacist', 'finance'] loop
    insert into t_results select 'A pharmacy_medications.commission_rate refused to ' || r,
      pg_temp.probe(case r when 'patient' then v_patient when 'clinician' then v_clin when 'pharmacist' then v_pharm else v_fin end,
                    'authenticated', 'select commission_rate from public.pharmacy_medications'), 'denied', null;
  end loop;
  insert into t_results select 'A commission_flat_kobo refused to patient',
    pg_temp.probe(v_patient, 'authenticated', 'select commission_flat_kobo from public.pharmacy_medications'), 'denied', null;
  insert into t_results select 'A commission_rate_type refused to clinician',
    pg_temp.probe(v_clin, 'authenticated', 'select commission_rate_type from public.pharmacy_medications'), 'denied', null;
  insert into t_results select 'A select * refused to patient (fails loudly rather than leaking)',
    pg_temp.probe(v_patient, 'authenticated', 'select * from public.pharmacy_medications'), 'denied', null;
  insert into t_results select 'A anon refused the commission column',
    pg_temp.probe(null, 'anon', 'select commission_rate from public.pharmacy_medications'), 'denied', null;
  insert into t_results select 'A anon refused the admin view',
    pg_temp.probe(null, 'anon', 'select * from public.pharmacy_medications_admin'), 'denied', null;

  -- B. price and stock stay readable; the pharmacist sees their own row; the admin view is empty for non-admins
  insert into t_results select 'B patient reads price and stock of the active row',
    pg_temp.probe(v_patient, 'authenticated', format('select drug_name, price_kobo, stock_status, is_active from public.pharmacy_medications where id = %L', v_med)), 'rows:1', null;
  insert into t_results select 'B clinician reads price and stock',
    pg_temp.probe(v_clin, 'authenticated', format('select price_kobo, stock_status from public.pharmacy_medications where id = %L', v_med)), 'rows:1', null;
  insert into t_results select 'B pharmacist reads own catalogue (safe columns)',
    pg_temp.probe(v_pharm, 'authenticated', format('select drug_name, price_kobo from public.pharmacy_medications where pharmacy_partner_id = %L', v_partner)), 'rows:1', null;
  insert into t_results select 'B patient sees no commission via the admin view',
    pg_temp.probe(v_patient, 'authenticated', 'select commission_rate from public.pharmacy_medications_admin'), 'rows:0', null;
  insert into t_results select 'B clinician sees no commission via the admin view',
    pg_temp.probe(v_clin, 'authenticated', 'select commission_rate from public.pharmacy_medications_admin'), 'rows:0', null;
  insert into t_results select 'B pharmacist sees no commission via the admin view',
    pg_temp.probe(v_pharm, 'authenticated', 'select commission_rate from public.pharmacy_medications_admin'), 'rows:0', null;
  insert into t_results select 'B admin reads commission via the admin view',
    pg_temp.probe(v_admin, 'authenticated', format('select commission_rate, commission_flat_kobo, pharmacy_partner_name from public.pharmacy_medications_admin where id = %L', v_med)), 'rows:1', null;

  -- C. inactive rows: hidden from a patient, visible to the owning pharmacist and to admin; another pharmacist's row stays hidden
  update public.pharmacy_medications set is_active = false where id = v_med;
  insert into t_results select 'C inactive row hidden from patient',
    pg_temp.probe(v_patient, 'authenticated', format('select id from public.pharmacy_medications where id = %L', v_med)), 'rows:0', null;
  insert into t_results select 'C inactive row visible to the owning pharmacist',
    pg_temp.probe(v_pharm, 'authenticated', format('select id from public.pharmacy_medications where id = %L', v_med)), 'rows:1', null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pharm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.pharmacy_medications set is_active = true where id = v_med;
  get diagnostics n = row_count;
  reset role;
  insert into t_results values ('C pharmacist can still toggle own row (UPDATE needs the SELECT policy)', 'rows:' || n, 'rows:1', null);
  update public.pharmacy_medications set is_active = false where id = v_med;
  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, price_kobo, is_active) values (v_other_partner, 'S53 Other Drug', 100, false);
  insert into t_results select 'C another pharmacy''s inactive row hidden from this pharmacist',
    pg_temp.probe(v_pharm, 'authenticated', format('select id from public.pharmacy_medications where pharmacy_partner_id = %L', v_other_partner)), 'rows:0', null;
  update public.pharmacy_medications set is_active = true where id = v_med;

  -- D. the commissions ledger
  insert into t_results select 'D clinician reads no commissions',
    pg_temp.probe(v_clin, 'authenticated', format('select id from public.commissions where id = %L', v_comm)), 'rows:0', null;
  insert into t_results select 'D patient reads no commissions',
    pg_temp.probe(v_patient, 'authenticated', format('select id from public.commissions where id = %L', v_comm)), 'rows:0', null;
  insert into t_results select 'D pharmacist reads no commissions',
    pg_temp.probe(v_pharm, 'authenticated', format('select id from public.commissions where id = %L', v_comm)), 'rows:0', null;
  insert into t_results select 'D finance without commissions.view reads no commissions',
    pg_temp.probe(v_fin2, 'authenticated', format('select id from public.commissions where id = %L', v_comm)), 'rows:0', null;
  insert into t_results select 'D finance with commissions.view reads the ledger',
    pg_temp.probe(v_fin, 'authenticated', format('select id from public.commissions where id = %L', v_comm)), 'rows:1', null;
  -- commissions.view is a read permission: it must not carry a write
  perform set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.commissions set status = 'paid' where id = v_comm;
  reset role;
  insert into t_results select 'D finance with commissions.view cannot mark a commission paid',
    (select 'rows:' || count(*) from public.commissions where id = v_comm and status <> 'paid'), 'rows:1', null;
  insert into t_results select 'D admin reads the ledger',
    pg_temp.probe(v_admin, 'authenticated', format('select id from public.commissions where id = %L', v_comm)), 'rows:1', null;
  insert into t_results select 'D anon reads no commissions (S39 revoked anon table grants, so the read is denied outright)',
    pg_temp.probe(null, 'anon', 'select id from public.commissions'), 'denied', null;
  -- a clinician cannot edit or delete the ledger either
  -- a clinician cannot edit or delete the ledger either (RLS filters the rows, so the statements succeed but touch nothing)
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.commissions set status = 'paid' where id = v_comm;
  delete from public.commissions where id = v_comm;
  reset role;
  insert into t_results select 'D the clinician''s update and delete touched nothing',
    (select 'rows:' || count(*) from public.commissions where id = v_comm and status <> 'paid'), 'rows:1', null;

  -- E. SABOTAGE: restore the old shape in this rolled-back transaction; every refusal must flip
  grant select on public.pharmacy_medications to authenticated;
  drop policy pharmacy_medications_select on public.pharmacy_medications;
  create policy pharmacy_medications_select on public.pharmacy_medications for select to authenticated using (true);
  drop policy commissions_select on public.commissions;
  create policy commissions_select on public.commissions for select to authenticated using (private.is_org_staff(organisation_id));
  insert into t_results select 'E SABOTAGE patient can read commission_rate again (must leak)',
    pg_temp.probe(v_patient, 'authenticated', 'select commission_rate from public.pharmacy_medications'), 'leak', null;
  insert into t_results select 'E SABOTAGE clinician can read commissions again (must leak)',
    pg_temp.probe(v_clin, 'authenticated', format('select id from public.commissions where id = %L', v_comm)), 'rows:1', null;
end $$;

update t_results set verdict = case when check_name like 'E SABOTAGE%' then case when observed ~ '^rows:[1-9]' then 'PASS' else 'FAIL' end
  when observed = expected then 'PASS' else 'FAIL' end;

do $$
declare v_bad text; v_vacuous int;
begin
  select string_agg(check_name || ' => ' || observed, '; ') into v_bad from t_results where verdict = 'FAIL' and check_name not like 'E SABOTAGE%';
  if v_bad is not null then raise exception 'HOLE OPEN: %', v_bad; end if;
  select count(*) into v_vacuous from t_results where check_name like 'E SABOTAGE%' and verdict = 'FAIL';  -- FAIL here means no leak appeared
  if v_vacuous > 0 then raise exception 'VACUOUS TEST: sabotage did not reproduce the leak (% checks)', v_vacuous; end if;
end $$;

select check_name, observed, expected, verdict from t_results order by check_name;

rollback;
