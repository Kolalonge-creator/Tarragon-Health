-- S74 proof: the module 21 acceptance test. "A result entered by a laboratory for ANOTHER laboratory's order is rejected by RLS" (spec B.21).
-- Laboratory revenue follows D-06 (the patient pays the laboratory directly), and a laboratory has no way to read a patient's results back (INV-10).
-- One rolled-back transaction. Sections:
--   1. THE ACCEPTANCE TEST, verbatim: laboratory B submits a result for laboratory A's order and is refused with the database's own words
--      "Order not found for this lab" (SQLSTATE 42501); no result row, no file row, no task, no notice, and the order does not move.
--   2. Every other order-scoped door refuses the same way: mark collected, correction, document upload, the order-patient lookup, the order lists.
--   3. Row level security: a laboratory cannot insert into lab_results, lab_result_items or lab_result_files, directly or through any policy; it reads
--      no result of any laboratory (its own included), so a partner read of patient results never happens (INV-10); a signed-in patient and an
--      unrelated clinician are in the same position.
--   4. The control: laboratory A, with its own order, can submit (so the refusal is not a closed door for everyone); the result is HELD for review.
--   5. The partner's own quality view shows its own figures only.
--   6. SABOTAGE: (a) the owner filter removed from the submit function and (b) a read policy opened on lab_results; both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.r(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- returns 'ERR:' || the message (not the code) so the database's own words can be asserted
create function pg_temp.msg_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.code_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's74l-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S74 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.items(p_creatinine numeric) returns text language sql as
$$ select '[{"analyte_code":"fasting_glucose","value_numeric":88},{"analyte_code":"hba1c","value_numeric":5.2},{"analyte_code":"creatinine","value_numeric":'
  || p_creatinine || '},{"analyte_code":"potassium","value_numeric":4.1},{"analyte_code":"sodium","value_numeric":140},{"analyte_code":"total_cholesterol","value_numeric":170},{"analyte_code":"ldl_cholesterol","value_numeric":100},{"analyte_code":"hdl_cholesterol","value_numeric":55},{"analyte_code":"triglycerides","value_numeric":110},{"analyte_code":"alt","value_numeric":24}'
  || ',{"analyte_code":"ast","value_numeric":20},{"analyte_code":"haemoglobin","value_numeric":14},{"analyte_code":"wbc","value_numeric":6},{"analyte_code":"platelets","value_numeric":250},{"analyte_code":"tsh","value_numeric":2}]' $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_labA uuid; v_labB uuid; v_admin uuid; v_doc uuid; v_staff uuid; v_pat uuid; v_order uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into public.lab_providers (name, is_active) values ('S74 Lab A', false) returning id into v_labA;
  insert into public.lab_providers (name, is_active) values ('S74 Lab B', false) returning id into v_labB;
  perform pg_temp.setf('provA', v_labA); perform pg_temp.setf('provB', v_labB);
  perform pg_temp.setf('labA', pg_temp.mkuser(v_org, 'labA', 'lab_partner')); perform pg_temp.setf('labB', pg_temp.mkuser(v_org, 'labB', 'lab_partner'));
  update public.profiles set lab_provider_id = v_labA where id = pg_temp.f('labA');
  update public.profiles set lab_provider_id = v_labB where id = pg_temp.f('labB');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician'); perform pg_temp.setf('doc', v_doc);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doc, 'S74 doc', 'MDCN', 'S74-doc-' || substr(v_doc::text, 1, 8), true, 'active', now(), v_admin, 'senior_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 1, true, v_admin, true)
  returning id into v_staff;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient'));
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication, payment_confirmed_at)
  values (v_org, v_pat, v_labA, 'partner', 'pending_payment', 'clinically_triggered', v_staff, 'S74 proof order', now() - interval '1 hour') returning id into v_order;
  update public.lab_orders set status = 'payment_confirmed', payment_confirmed_at = now() - interval '1 hour' where id = v_order;
  update public.lab_orders set status = 'sample_collected' where id = v_order;
  perform pg_temp.setf('orderA', v_order);
end $$;

-- 1. THE ACCEPTANCE TEST --------------------------------------------------------------------------------------------------------------
select pg_temp.r('1.1 laboratory B submitting a result for laboratory A''s order is refused with the database''s own words', 'ERR:Order not found for this lab',
  pg_temp.msg_as(pg_temp.f('labB'), format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, pg_temp.f('orderA'), pg_temp.items(0.9))));
select pg_temp.r('1.2 ...with SQLSTATE 42501 (insufficient privilege)', 'ERR:42501',
  pg_temp.code_as(pg_temp.f('labB'), format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, pg_temp.f('orderA'), pg_temp.items(0.9))));
select pg_temp.r('1.3 nothing was written: no result, no file, no task, no notice for the patient', '0|0|0|0',
  (select count(*)::text from public.lab_results where lab_order_id = pg_temp.f('orderA')) || '|' ||
  (select count(*)::text from public.lab_result_files where patient_id = pg_temp.f('pat')) || '|' ||
  (select count(*)::text from public.clinical_tasks where dedup_key like 'lab_result:%' and patient_id = pg_temp.f('pat')) || '|' ||
  (select count(*)::text from public.notifications where recipient_id = pg_temp.f('pat') and template = 'lab_result_ready'));
select pg_temp.r('1.4 ...and the order did not move', 'sample_collected', (select status::text from public.lab_orders where id = pg_temp.f('orderA')));
select pg_temp.r('1.5 a file-only submission by laboratory B is refused the same way', 'ERR:Order not found for this lab',
  pg_temp.msg_as(pg_temp.f('labB'), format($q$select public.lab_partner_submit_result(%L, null, null, '{"file_path":"x/y.pdf","original_filename":"y.pdf","mime_type":"application/pdf","file_size_bytes":1000}'::jsonb)::text$q$, pg_temp.f('orderA'))));

-- 2. Every other order-scoped door ----------------------------------------------------------------------------------------------------
select pg_temp.r('2.1 laboratory B cannot mark A''s sample collected', 'ERR:Order not found for this lab', pg_temp.msg_as(pg_temp.f('labB'), format($q$select public.lab_partner_mark_collected(%L)::text$q$, pg_temp.f('orderA'))));
select pg_temp.r('2.2 laboratory B cannot upload a document against A''s order', 'ERR:Order not found for this lab',
  pg_temp.msg_as(pg_temp.f('labB'), format($q$select public.lab_partner_upload_result(%L, 'x/y.pdf', 'y.pdf', 'application/pdf', 1000, 'n')::text$q$, pg_temp.f('orderA'))));
select pg_temp.r('2.3 laboratory B cannot learn which patient A''s order is for', 'null', coalesce(pg_temp.msg_as(pg_temp.f('labB'), format($q$select public.lab_partner_order_patient(%L)::text$q$, pg_temp.f('orderA'))), 'null'));
select pg_temp.r('2.4 laboratory A can (it is A''s own order)', 'true', (pg_temp.msg_as(pg_temp.f('labA'), format($q$select public.lab_partner_order_patient(%L)::text$q$, pg_temp.f('orderA'))) = pg_temp.f('pat')::text)::text);
select pg_temp.r('2.5 laboratory B''s order list does not contain A''s order', '0', pg_temp.msg_as(pg_temp.f('labB'), format($q$select count(*)::text from public.lab_partner_portal_orders() where order_id = %L$q$, pg_temp.f('orderA'))));
select pg_temp.r('2.6 laboratory A''s order list does', '1', pg_temp.msg_as(pg_temp.f('labA'), format($q$select count(*)::text from public.lab_partner_portal_orders() where order_id = %L$q$, pg_temp.f('orderA'))));
select pg_temp.r('2.7 a patient and a clinician are not partner laboratories: refused', 'ERR:This action is for partner labs|ERR:This action is for partner labs',
  pg_temp.msg_as(pg_temp.f('pat'), format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, pg_temp.f('orderA'), pg_temp.items(0.9))) || '|' ||
  pg_temp.msg_as(pg_temp.f('doc'), format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, pg_temp.f('orderA'), pg_temp.items(0.9))));

-- 3. Row level security: no write path and no read path for a laboratory ------------------------------------------------------------------
select pg_temp.r('3.1 a laboratory cannot insert into lab_results directly', 'ERR:42501',
  pg_temp.code_as(pg_temp.f('labA'), format($q$insert into public.lab_results (organisation_id, patient_id, lab_order_id, partner_id, source, submitted_by_kind) values (%L, %L, %L, %L, 'pdf_upload', 'partner')$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('orderA'), pg_temp.f('provA'))));
select pg_temp.r('3.2 ...nor into lab_result_items', 'ERR:42501', pg_temp.code_as(pg_temp.f('labB'), format($q$insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag) values (gen_random_uuid(), %L, %L, 'hba1c', 5, '%%', 'normal')$q$, pg_temp.f('org'), pg_temp.f('pat'))));
select pg_temp.r('3.3 ...nor into lab_result_files', 'ERR:42501', pg_temp.code_as(pg_temp.f('labB'), format($q$insert into public.lab_result_files (organisation_id, patient_id, file_path, mime_type, file_size_bytes) values (%L, %L, 'x/y.pdf', 'application/pdf', 100)$q$, pg_temp.f('org'), pg_temp.f('pat'))));
select pg_temp.r('3.4 no signed-in role holds a write grant on the three result tables', '0',
  (select count(*)::text from unnest(array['lab_results', 'lab_result_items', 'lab_result_files']) t where has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'DELETE')));
-- the control that makes the read checks mean something: laboratory A submits its own order, and a result then exists
do $$ declare r text; begin
  r := pg_temp.msg_as(pg_temp.f('labA'), format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, pg_temp.f('orderA'), pg_temp.items(0.9)));
  perform pg_temp.r('4.1 CONTROL: laboratory A submits its own order and the result is HELD, never released by the lab', 'awaiting_review', case when r like 'ERR:%' then r else (r::jsonb ->> 'release_state') end);
  perform pg_temp.r('4.2 ...the result is stored against laboratory A', 'true', (select (partner_id = pg_temp.f('provA') and submitted_by_kind = 'partner')::text from public.lab_results where lab_order_id = pg_temp.f('orderA') order by created_at desc limit 1));
  perform pg_temp.r('4.3 ...and a second result for the same order is refused as already received', 'ERR:lab_result_already_received',
    pg_temp.msg_as(pg_temp.f('labA'), format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, pg_temp.f('orderA'), pg_temp.items(0.9))));
end $$;
select pg_temp.r('3.5 laboratory A reads no result row, not even its own (a partner never reads results back, INV-10); the files table is not readable by any signed-in user at all (S27 grants nothing on it)', '0|0|false',
  pg_temp.code_as(pg_temp.f('labA'), 'select (select count(*) from public.lab_results)::text || ''|'' || (select count(*) from public.lab_result_items)::text || ''|'' || has_table_privilege(''authenticated'', ''public.lab_result_files'', ''SELECT'')::text'));
select pg_temp.r('3.6 laboratory B reads none either', '0|0|false',
  pg_temp.code_as(pg_temp.f('labB'), 'select (select count(*) from public.lab_results)::text || ''|'' || (select count(*) from public.lab_result_items)::text || ''|'' || has_table_privilege(''authenticated'', ''public.lab_result_files'', ''SELECT'')::text'));
select pg_temp.r('3.7 an unrelated patient reads none', '0|0', pg_temp.code_as(pg_temp.f('stranger'), 'select (select count(*) from public.lab_results)::text || ''|'' || (select count(*) from public.lab_result_items)::text'));
select pg_temp.r('3.8 the patient does not see the held result yet (INV-03)', '0', pg_temp.code_as(pg_temp.f('pat'), 'select count(*)::text from public.lab_results'));
select pg_temp.r('3.9 a clinician reads no result directly either (reads go through the audited function)', '0', pg_temp.code_as(pg_temp.f('doc'), 'select count(*)::text from public.lab_results'));

-- 5. The partner's own quality view --------------------------------------------------------------------------------------------------------
select pg_temp.r('5.1 laboratory A sees a quality view for itself', 'lab', (pg_temp.msg_as(pg_temp.f('labA'), 'select public.partner_my_quality()::text')::jsonb) ->> 'partner_kind');
select pg_temp.r('5.2 a patient is refused it', 'ERR:42501', pg_temp.code_as(pg_temp.f('pat'), 'select public.partner_my_quality()::text'));

-- 6. SABOTAGE -------------------------------------------------------------------------------------------------------------------------
-- (a) the owner filter removed from the submit function: laboratory B can submit for A's order
create or replace function public.lab_partner_submit_result(p_order uuid, p_panel text, p_items jsonb, p_file jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.lab_orders%rowtype; v_provider uuid := private.lab_partner_provider();
begin
  if v_provider is null then raise exception 'This action is for partner labs' using errcode = '42501'; end if;
  select * into o from public.lab_orders where id = p_order;     -- SABOTAGE: any laboratory's order
  if not found then raise exception 'Order not found for this lab' using errcode = '42501'; end if;
  return jsonb_build_object('lab_result_id', gen_random_uuid(), 'release_state', 'accepted_from_the_wrong_lab');
end $$;
select pg_temp.sab('laboratory B is still refused for A''s order', 'ERR:Order not found for this lab',
  pg_temp.msg_as(pg_temp.f('labB'), format($q$select public.lab_partner_submit_result(%L, 'membership_annual', %L::jsonb)::text$q$, pg_temp.f('orderA'), pg_temp.items(0.9))));
-- (b) a read policy opened on lab_results
grant select on public.lab_results to authenticated;
create policy s74_sabotage_open_read on public.lab_results for select to authenticated using (true);
select pg_temp.sab('laboratory B still reads no result', '0', pg_temp.code_as(pg_temp.f('labB'), 'select count(*)::text from public.lab_results'));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S74 cross-lab proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
