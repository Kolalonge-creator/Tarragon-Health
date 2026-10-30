-- OQ-BPW-5 proof: a blood pressure reading can resolve an open severity-2 "Missing expected blood-pressure readings" alert.
--
-- Before the fix the handler resolved that alert with a bare `status = 'resolved'`; the check
-- clinician_alerts_resolution_requires_documentation refuses that for severity 2, so the patient's NEXT reading was refused (23514).
-- Proved in one rolled-back transaction:
--   1. the fixture alert really is severity 2 and open;
--   2. a normal cuff reading is accepted, and the alert is resolved with a documented action and the outcome 'no_action_needed';
--   3. the reading itself was saved;
--   4. nothing else moved: another patient's alert with the same title, and the same patient's alert with a different title, stay open;
--   5. SABOTAGE: with the old bare statement put back, the same insert raises 23514 and the alert stays open, so checks 2 and 3 flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'oqbpw5-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'OQBPW5 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- a cuff reading, as the owner; returns 'ok' or the SQLSTATE if the insert is refused
create function pg_temp.reading(p_patient uuid, p_org uuid) returns text language plpgsql as
$f$ begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, systolic, diastolic)
  values (p_org, p_patient, 'blood_pressure', 'manual', now() - interval '1 minute', 120, 80);
  return 'ok';
exception when others then return sqlstate;
end $f$;
create function pg_temp.alert(p_org uuid, p_patient uuid, p_title text) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
  values (p_org, p_patient, 'clinician_review', 'open', p_title, 'proof', now() + interval '1 day', 2)
  returning id into v;
  return v;
end $f$;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_alert uuid; v_other_patient uuid; v_other_title uuid; v_res text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_a := pg_temp.mkuser(v_org, 'patient-a', 'patient');
  v_b := pg_temp.mkuser(v_org, 'patient-b', 'patient');
  v_c := pg_temp.mkuser(v_org, 'patient-c', 'patient');
  v_alert := pg_temp.alert(v_org, v_a, 'Missing expected blood-pressure readings');
  v_other_patient := pg_temp.alert(v_org, v_b, 'Missing expected blood-pressure readings');
  v_other_title := pg_temp.alert(v_org, v_a, 'Some other review the care team opened');
  perform pg_temp.setf('a', v_a); perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('alert', v_alert); perform pg_temp.setf('other_patient', v_other_patient); perform pg_temp.setf('other_title', v_other_title);

  perform pg_temp.rec('the fixture alert is open and severity 2 (the case the check refuses)', 'open,2',
    (select status::text || ',' || severity::text from public.clinician_alerts where id = v_alert));

  v_res := pg_temp.reading(v_a, v_org);
  perform pg_temp.rec('a normal cuff reading is accepted although a severity-2 missing-readings alert is open', 'ok', v_res);
  perform pg_temp.rec('...the reading was saved', '1', (select count(*)::text from public.vitals_readings where patient_id = v_a and vital_type = 'blood_pressure'));
  perform pg_temp.rec('...the alert is resolved with a documented action and the outcome no_action_needed', 'resolved,true,no_action_needed',
    (select status::text || ',' || (resolution_action is not null and char_length(resolution_action) >= 10)::text || ',' || resolution_outcome::text
       from public.clinician_alerts where id = v_alert));
  perform pg_temp.rec('another patient''s alert with the same title stays open', 'open', (select status::text from public.clinician_alerts where id = v_other_patient));
  perform pg_temp.rec('the same patient''s alert with a different title stays open', 'open', (select status::text from public.clinician_alerts where id = v_other_title));
end $$;

-- 5. SABOTAGE: the old bare statement put back. The same insert must now be refused and the alert must stay open.
do $$
declare
  v_def text := pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure);
  v_new text := $q$    set status = 'resolved', updated_at = now(),
        resolution_action = 'Resolved automatically: a new blood pressure reading arrived.',
        resolution_outcome = 'no_action_needed'$q$;
  v_old text := $q$    set status = 'resolved', updated_at = now()$q$;
  v_org uuid := pg_temp.f('org'); v_c uuid; v_alert uuid; v_res text;
begin
  if position(v_new in v_def) = 0 then raise exception 'sabotage anchor not found: the fix is not in the live body'; end if;
  execute replace(v_def, v_new, v_old);
  v_c := pg_temp.mkuser(v_org, 'patient-sabotage', 'patient');
  v_alert := pg_temp.alert(v_org, v_c, 'Missing expected blood-pressure readings');
  v_res := pg_temp.reading(v_c, v_org);
  insert into results values ('sabotaged', 'a normal cuff reading is accepted although a severity-2 missing-readings alert is open', 'ok', v_res);
  insert into results values ('sabotaged', '...the reading was saved', '1', (select count(*)::text from public.vitals_readings where patient_id = v_c and vital_type = 'blood_pressure'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-BPW-5 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
  from results where phase = 'real' order by check_name;

rollback;
