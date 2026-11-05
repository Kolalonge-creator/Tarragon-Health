-- ===========================================================================
-- Proof: *_t2_11b_prescribing_safety_gaps.sql (founder decision 2026-11-05, safety case HZ-RX-03, HZ-RX-05, HZ-RX-06/11).
--
-- With the prescribing master on and a real senior doctor tied to a real patient:
--   A. the drug classes in the database match the add check (a combination is split; amoxicillin is a penicillin);
--   B. interactions at signing, from the SIGNED dataset and rule set: lisinopril + losartan is a hard stop even with a reason (both
--      sources fire); lisinopril + ibuprofen stops until a reason is given, then signs, the reason is on the prescription and an audit
--      row is written; levothyroxine + omeprazole (info) signs without a reason and is stored as advisory;
--   C. a penicillin allergy stops amoxicillin until a reason is given (class match, not name match);
--   D. with no active signed rule set, nothing can be signed (SAFETY_CHECK_UNAVAILABLE);
--   E. a lapsed licence or a placeholder number refuses signing (prescriber_licence_not_verified); the master's count agrees;
--   F. the Rx number and code give the QR token to anyone; a wrong code gives nothing; ten wrong codes lock that number for the hour.
-- SABOTAGE: interaction findings emptied (the hard stop disappears); the licence test made true (a lapsed doctor signs); the lock
-- removed (an eleventh wrong code is answered).
-- BEGIN/ROLLBACK; own fixtures.
-- ===========================================================================
begin;
\ir _fixtures/signed_interaction_sets.sql

create temp table results (kind text, check_name text, expected text, observed text) on commit drop;
create temp table fx (k text primary key, v uuid) on commit drop;
grant all on results, fx to authenticated, anon;

-- runs one statement as a user (or anon) and returns its value, or ERR:<detail or message>
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare v text; v_detail text; v_msg text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', 'anon') else json_build_object('sub', p_uid, 'role', 'authenticated') end::text, true);
  if p_uid is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
  begin
    execute p_sql into v;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail, v_msg = message_text;
    v := 'ERR:' || coalesce(nullif(v_detail, ''), v_msg);
  end;
  execute 'reset role';
  return v;
end $f$;
grant execute on function pg_temp.as_user(uuid, text) to authenticated, anon;

create function pg_temp.rx(p_drug text, p_reason text default null) returns text language sql as $f$
  select pg_temp.as_user((select v from fx where k = 'doc'), format(
    $q$select public.prescribe_medication(%L, %L, '1 tablet', 'once a day', p_route => 'oral', p_duration_days => 30, p_quantity => '30 tablets', p_allergies_confirmed => true, p_safety_override_reason => %L)::text$q$,
    (select v from fx where k = 'pat'), p_drug, p_reason))
$f$;

do $$
declare v_org uuid; v_pat uuid := gen_random_uuid(); v_doc uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  select 'prescribing_enabled', 'switched_on', id, 'cmo', 'T2-11b proof', '[]'::jsonb from public.profiles order by created_at limit 1;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = (select id from public.profiles order by created_at limit 1), change_note = 'T2-11b proof'
   where key = 'prescribing_enabled';
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 't211b-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_doc]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat, v_org, 'patient',   'T211b Patient', '+2348058881201'),
    (v_doc, v_org, 'clinician', 'T211b Doctor',  '+2348058881202')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  update public.profiles set is_test = false where id in (v_pat, v_doc);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, credential_type, credential_number,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_doc, 'T211b Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'T211B-5501', 'Probe', 'T211B-1', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doc, now()) on conflict (patient_id) do update set clinician_id = v_doc;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source) values (v_org, v_pat, 'Penicillin', 'clinician');
  insert into fx values ('org', v_org), ('pat', v_pat), ('doc', v_doc);
end $$;

-- A. classes ---------------------------------------------------------------------------------------------------------------------
insert into results values
  ('real', 'A1 a combination gives both classes', '{ace_inhibitor,thiazide_diuretic}', private.drug_classes('Lisinopril/HCTZ 10/12.5mg')::text),
  ('real', 'A2 amoxicillin is a penicillin', '{penicillin}', private.drug_classes('Amoxicillin 500mg capsules')::text),
  ('real', 'A3 an unrelated name has no class', '{}', private.drug_classes('Folic acid')::text);

-- B. interactions at signing -----------------------------------------------------------------------------------------------------
do $$
declare v_res text;
begin
  v_res := pg_temp.rx('Lisinopril');
  if v_res like 'ERR:%' then raise exception 'FAIL: setup, lisinopril could not be signed: %', v_res; end if;
  v_res := pg_temp.rx('Levothyroxine');
  if v_res like 'ERR:%' then raise exception 'FAIL: setup, levothyroxine could not be signed: %', v_res; end if;
end $$;

insert into results values
  ('real', 'B1 lisinopril + losartan is a hard stop even with a reason', 'ERR:SAFETY_BLOCKED', pg_temp.rx('Losartan', 'I have considered this')),
  ('real', 'B2 ...and nothing was written', '0', (select count(*)::text from public.medications where patient_id = (select v from fx where k = 'pat') and drug_name = 'Losartan'));
do $$
declare v_hint text; v_det text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from fx where k = 'doc'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.prescribe_medication((select v from fx where k = 'pat'), 'Losartan', '50 mg', 'once a day', p_duration_days => 30, p_quantity => '30 tablets', p_allergies_confirmed => true, p_safety_override_reason => 'x');
  exception when others then get stacked diagnostics v_hint = pg_exception_hint, v_det = pg_exception_detail;
  end;
  execute 'reset role';
  insert into results values ('real', 'B3 the stop names both the signed dataset and the signed rule set', 'true|true',
    ((v_hint::jsonb @> '[{"code":"interaction","source":"dataset","severity":"contraindicated"}]')::text) || '|' ||
    ((v_hint::jsonb @> '[{"code":"interaction","source":"rule_set","rule":"p01_lisinopril_losartan"}]')::text));
end $$;

insert into results values
  ('real', 'B4 lisinopril + ibuprofen stops until a reason is given', 'ERR:SAFETY_FINDINGS', pg_temp.rx('Ibuprofen 400mg')),
  ('real', 'B5 ...with a reason it signs', 'true', (pg_temp.rx('Ibuprofen 400mg', 'Short course for 5 days, kidney function checked') not like 'ERR:%')::text);
-- (separate statements: a later subquery in the same statement would not see what the call above just wrote)
insert into results values
  ('real', 'B6 ...the reason and the finding are kept on the prescription', 'Short course for 5 days, kidney function checked|true',
    (select (p.safety_checks ->> 'override_reason') || '|' || ((p.safety_checks -> 'findings') @> '[{"code":"interaction","severity":"caution"}]')::text
       from public.medications m join public.prescriptions p on p.id = m.prescription_id
      where m.patient_id = (select v from fx where k = 'pat') and m.drug_name = 'Ibuprofen 400mg')),
  ('real', 'B7 ...and the override is in the audit log', '1',
    (select count(*)::text from public.audit_log where action = 'prescription.safety_override' and entity_id = (select v from fx where k = 'pat'))),
  ('real', 'B8 levothyroxine + omeprazole (info) signs with no reason', 'true', (pg_temp.rx('Omeprazole 20mg') not like 'ERR:%')::text);
insert into results values
  ('real', 'B9 ...and the advisory finding is stored', 'true',
    (select ((p.safety_checks -> 'findings') @> '[{"code":"interaction","severity":"info","advisory":true}]')::text
       from public.medications m join public.prescriptions p on p.id = m.prescription_id
      where m.patient_id = (select v from fx where k = 'pat') and m.drug_name = 'Omeprazole 20mg'));

insert into results values ('real', 'B10 ibuprofen + warfarin is a hard stop (a pair only the signed rules know)', 'ERR:SAFETY_BLOCKED', pg_temp.rx('Warfarin 5mg', 'I have considered this'));

-- C. allergy class -----------------------------------------------------------------------------------------------------------------
insert into results values
  ('real', 'C1 a penicillin allergy stops amoxicillin until a reason is given', 'ERR:SAFETY_FINDINGS', pg_temp.rx('Amoxicillin 500mg')),
  ('real', 'C2 ...as a class match', 'true',
    (select ((private.prescription_safety_findings((select v from fx where k = 'pat'), 'Amoxicillin 500mg', null))
             @> '[{"code":"allergy_class_match","allergen":"Penicillin","drug_class":"penicillin"}]')::text));

-- E. licence ----------------------------------------------------------------------------------------------------------------------
do $$
declare v_count_before integer := private.prescriber_ready_count();
begin
  update public.clinical_staff set license_expires_at = now() - interval '1 day' where profile_id = (select v from fx where k = 'doc');
  insert into results values
    ('real', 'E1 a lapsed licence cannot sign', 'ERR:prescriber_licence_not_verified', pg_temp.rx('Folic acid')),
    ('real', 'E2 ...and the master no longer counts the doctor', (v_count_before - 1)::text, private.prescriber_ready_count()::text);
  update public.clinical_staff set license_expires_at = null, credential_number = 'MDCN-PENDING' where profile_id = (select v from fx where k = 'doc');
  insert into results values ('real', 'E3 a placeholder number cannot sign', 'ERR:prescriber_licence_not_verified', pg_temp.rx('Folic acid'));
  update public.clinical_staff set credential_number = 'T211B-5501' where profile_id = (select v from fx where k = 'doc');
  insert into results values ('real', 'E4 restored, the same doctor signs', 'true', (pg_temp.rx('Folic acid') not like 'ERR:%')::text);
end $$;

-- F. enter the code ----------------------------------------------------------------------------------------------------------------
do $$
declare m public.medications%rowtype; v_res text; i integer;
begin
  select * into m from public.medications where patient_id = (select v from fx where k = 'pat') and drug_name = 'Folic acid';
  insert into results values
    ('real', 'F1 the Rx number and code give the QR token to anyone', 'true',
      (pg_temp.as_user(null, format('select public.verify_prescription_by_code(%L, %L)', lower(m.rx_number), ' ' || lower(m.verification_code))) = m.public_token)::text),
    ('real', 'F2 a wrong code gives nothing', 'null',
      coalesce(pg_temp.as_user(null, format('select public.verify_prescription_by_code(%L, %L)', m.rx_number, 'ZZZZZZ')), 'null'));
  for i in 1 .. 9 loop
    perform pg_temp.as_user(null, format('select public.verify_prescription_by_code(%L, %L)', m.rx_number, 'ZZZZZ' || i));
  end loop;
  v_res := pg_temp.as_user(null, format('select public.verify_prescription_by_code(%L, %L)', m.rx_number, m.verification_code));
  insert into results values ('real', 'F3 after ten wrong codes even the right one is locked for the hour', 'ERR:too_many_attempts', v_res);
  insert into fx values ('med_folic', m.id);
end $$;

-- D. fail closed ------------------------------------------------------------------------------------------------------------------
update public.medicine_interaction_rule_sets set is_active = false where is_active;
insert into results values ('real', 'D1 with no active signed rule set nothing can be signed', 'ERR:SAFETY_CHECK_UNAVAILABLE', pg_temp.rx('Cetirizine'));
update public.medicine_interaction_rule_sets set is_active = true
 where id = (select id from public.medicine_interaction_rule_sets where approved_by is not null and jsonb_array_length(config -> 'rules') > 0 order by version desc limit 1);

-- SABOTAGE --------------------------------------------------------------------------------------------------------------------------
create or replace function private.prescription_interaction_findings(p_patient uuid, p_drug text, p_replacing uuid default null)
  returns jsonb language sql stable security definer set search_path = '' as $f$ select '[]'::jsonb $f$;
insert into results values ('sabotage', 'S1 without the interaction findings, warfarin signs next to ibuprofen (B10 discriminates)', 'true',
  (pg_temp.rx('Warfarin 5mg') not like 'ERR:%')::text);

update public.clinical_staff set license_expires_at = now() - interval '1 day' where profile_id = (select v from fx where k = 'doc');
create or replace function private.prescriber_licence_ok(p_profile uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
insert into results values ('sabotage', 'S2 with the licence test made true, a lapsed doctor signs (E1 discriminates)', 'true',
  (pg_temp.rx('Vitamin D3') not like 'ERR:%')::text);

create or replace function public.verify_prescription_by_code(p_rx_number text, p_code text) returns text language sql volatile security definer set search_path = '' as $f$
  select m.public_token from public.medications m where upper(m.rx_number) = upper(btrim(p_rx_number)) and upper(m.verification_code) = upper(btrim(p_code)) and m.source = 'clinician' limit 1
$f$;
insert into results values ('sabotage', 'S3 without the lock, the right code is answered after ten wrong ones (F3 discriminates)', 'true',
  (select (pg_temp.as_user(null, format('select public.verify_prescription_by_code(%L, %L)', m.rx_number, m.verification_code)) = m.public_token)::text
     from public.medications m where m.id = (select v from fx where k = 'med_folic')));

select kind, check_name, expected, observed, case when expected = observed then 'PASS' else 'FAIL' end as verdict from results order by kind, check_name;

do $$
declare v_bad text;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(observed, 'NULL'), '; ') into v_bad from results where expected is distinct from observed;
  if v_bad is not null then raise exception 'T2-11b proof FAILED: %', v_bad; end if;
  if (select count(*) from results where kind = 'sabotage') < 3 then raise exception 'VACUOUS TEST: the sabotage steps did not run'; end if;
end $$;

rollback;
