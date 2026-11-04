-- ===========================================================================
-- Proof: MSG-5 care_operations_summary. Runs in its own organisation so every count is known.
--   1. Access: a patient is refused (42501); out-of-range arguments are refused (22023); a coordinator and a doctor may read it.
--   2. Messages: support and clinical waits, needs a doctor, past the reply target (from the first unanswered message), older than the
--      lookback, waiting with no owner, and new messages today, each matching the fixture exactly.
--   3. Alerts: an emergency alert raised by a danger-phrase message is counted.
--   4. Workload: one row per active clinician or coordinator, with what each owns; names only, no patient detail anywhere in the output.
--   5. Another organisation's staff see none of it.
--   6. SABOTAGE: the test patient's waiting thread is left out; flipping that patient to a real one raises support_waiting by one,
--      so the exclusion is what kept it out.
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table msg5_results (check_name text, observed text, expected text, verdict text);
grant all on msg5_results to public;
create temp table msg5_fx (k text primary key, v uuid);
grant all on msg5_fx to public;

create function pg_temp.mkuser(p_role text, p_name text, p_org uuid, p_test boolean default false) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'msg5-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, is_active)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), date '1970-01-01', p_test, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = excluded.is_test, is_active = true, organisation_id = excluded.organisation_id;
  return v;
end $$;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from msg5_fx where k = p_k $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  begin execute p_sql; execute 'reset role'; perform pg_temp.back(); return 'ok';
  exception when others then get stacked diagnostics v_state = returned_sqlstate; execute 'reset role'; perform pg_temp.back(); return v_state;
  end;
end $$;
create function pg_temp.summary_as(p_uid uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  select public.care_operations_summary(24, 14) into r;
  execute 'reset role'; perform pg_temp.back(); return r;
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into msg5_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;
create function pg_temp.thread(p_patient uuid, p_subject text) returns uuid language sql as
$$ select id from public.care_message_threads where patient_id = p_patient and subject = p_subject $$;

do $$
declare
  v_org uuid; v_org2 uuid; admin uuid; doc uuid; co uuid; fp uuid; mp uuid; tp uuid; other_staff uuid;
  t_support uuid; t_clinical uuid; t_old uuid; t_test uuid; t_unowned uuid; s jsonb; s2 jsonb; w jsonb;
begin
  insert into public.organisations (name, type) select 'MSG5 org', type from public.organisations order by created_at limit 1 returning id into v_org;
  insert into public.organisations (name, type) select 'MSG5 other org', type from public.organisations order by created_at limit 1 returning id into v_org2;
  admin := pg_temp.mkuser('admin', 'MSG5 Admin', v_org);
  doc := pg_temp.mkuser('clinician', 'MSG5 Doctor', v_org);
  co := pg_temp.mkuser('care_coordinator', 'MSG5 Coordinator', v_org);
  fp := pg_temp.mkuser('patient', 'MSG5 Free Patient', v_org);
  mp := pg_temp.mkuser('patient', 'MSG5 Member', v_org);
  tp := pg_temp.mkuser('patient', 'MSG5 Test Patient', v_org, true);
  other_staff := pg_temp.mkuser('care_coordinator', 'MSG5 Coordinator Elsewhere', v_org2);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, employment_type, license_verified_at)
  values (v_org, doc, 'MSG5 Doctor', 'senior_medical_officer', true, 'employed', now());
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  values (v_org, mp, 'granted', 'active', admin, 'MSG5 proof: a Member', true);
  insert into msg5_fx values ('org', v_org), ('doc', doc), ('co', co), ('fp', fp), ('mp', mp), ('tp', tp), ('other', other_staff);

  -- Fixture threads. Each patient message routes the thread (MSG-3); the coordinator is first in line.
  perform pg_temp.try_as(fp, $q$select public.start_care_thread('MSG5 login', 'I cannot open my results page', null, null, null, 'general')$q$);
  perform pg_temp.try_as(mp, $q$select public.start_care_thread('MSG5 BP', 'My BP is 150 over 95 this week', null, null, null, 'clinical')$q$);
  perform pg_temp.try_as(fp, $q$select public.start_care_thread('MSG5 old', 'Any news on my booking?', null, null, null, 'appointment')$q$);
  perform pg_temp.try_as(fp, $q$select public.start_care_thread('MSG5 unowned', 'Where is the nearest lab?', null, null, null, 'laboratory')$q$);
  perform pg_temp.try_as(tp, $q$select public.start_care_thread('MSG5 test', 'Test patient question', null, null, null, 'general')$q$);
  t_support := pg_temp.thread(fp, 'MSG5 login'); t_clinical := pg_temp.thread(mp, 'MSG5 BP');
  t_old := pg_temp.thread(fp, 'MSG5 old'); t_unowned := pg_temp.thread(fp, 'MSG5 unowned'); t_test := pg_temp.thread(tp, 'MSG5 test');
  -- Past target: first asked 30 hours ago, nudged just now (so it stays inside the lookback).
  update public.care_message_threads set awaiting_reply_since = now() - interval '30 hours' where id = t_support;
  -- Older than the lookback: nothing from anyone for 20 days.
  update public.care_message_threads set awaiting_reply_since = now() - interval '20 days', last_message_at = now() - interval '20 days' where id = t_old;
  -- No owner.
  delete from public.care_thread_owners where thread_id = t_unowned;
  -- A danger phrase raises an emergency alert; then the coordinator sends the clinical thread to the doctor.
  perform pg_temp.try_as(mp, format($q$select public.post_care_message(%L, 'Now I have chest pain as well')$q$, t_clinical));
  perform pg_temp.try_as(co, format($q$select public.flag_care_thread_for_doctor(%L, 'BP high and now chest pain, please review')$q$, t_clinical));

  -- 1. Access.
  perform pg_temp.ck('1a patient refused', '42501', pg_temp.try_as(fp, $q$select public.care_operations_summary(24, 14)$q$));
  perform pg_temp.ck('1b bad arguments refused', '22023', pg_temp.try_as(co, $q$select public.care_operations_summary(0, 14)$q$));
  perform pg_temp.ck('1c doctor may read', 'ok', pg_temp.try_as(doc, $q$select public.care_operations_summary(24, 14)$q$));
  s := pg_temp.summary_as(co);

  -- 2. Messages.
  perform pg_temp.ck('2a support waiting (login, old, unowned; not the test patient)', '3', s->'messages'->>'support_waiting');
  perform pg_temp.ck('2b clinical waiting', '1', s->'messages'->>'clinical_waiting');
  perform pg_temp.ck('2c needs a doctor', '1', s->'messages'->>'needs_doctor');
  perform pg_temp.ck('2d past target counts from the first unanswered message', '1', s->'messages'->>'past_target');
  perform pg_temp.ck('2e older than the lookback', '1', s->'messages'->>'older_unanswered');
  perform pg_temp.ck('2f waiting with no owner', '1', s->'messages'->>'unowned_waiting');
  perform pg_temp.ck('2g new patient messages today (5 real; the test patient''s left out)', '5', s->'messages'->>'new_today');

  -- 3. Alerts.
  perform pg_temp.ck('3 emergency alert from the danger phrase is counted', '1', s->'alerts'->>'emergency_open');

  -- 4. Workload.
  w := s->'workload';
  perform pg_temp.ck('4a one row per active clinician and coordinator', '2', jsonb_array_length(w)::text);
  perform pg_temp.ck('4b coordinator holds login and old', '2',
    (select e->>'waiting' from jsonb_array_elements(w) e where e->>'staff_id' = co::text));
  perform pg_temp.ck('4c doctor holds the flagged clinical thread', '1/1/true',
    (select (e->>'waiting') || '/' || (e->>'needs_doctor') || '/' || (e->>'is_doctor') from jsonb_array_elements(w) e where e->>'staff_id' = doc::text));
  perform pg_temp.ck('4d the coordinator''s past-target thread is counted against them', '1',
    (select e->>'past_target' from jsonb_array_elements(w) e where e->>'staff_id' = co::text));
  perform pg_temp.ck('4e no patient name or id anywhere in the output', 'false',
    (s::text like '%' || fp::text || '%' or s::text like '%' || mp::text || '%' or s::text like '%MSG5 Free Patient%' or s::text like '%MSG5 Member%')::text);

  -- 5. Another organisation.
  s2 := pg_temp.summary_as(other_staff);
  perform pg_temp.ck('5 another organisation''s staff see none of it', '0/0/0',
    (s2->'messages'->>'support_waiting') || '/' || (s2->'messages'->>'clinical_waiting') || '/' || (s2->'alerts'->>'emergency_open'));

  -- 6. Sabotage: the test patient's thread is what the exclusion keeps out.
  update public.profiles set is_test = false where id = tp;
  s := pg_temp.summary_as(co);
  perform pg_temp.ck('6 SABOTAGE test patient made real: support_waiting rises to 4', '4', s->'messages'->>'support_waiting');
end $$;

select * from msg5_results order by check_name;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || coalesce(expected, 'null') || ', got ' || coalesce(observed, 'null') || ')', '; ')
    into v_fail from msg5_results where verdict <> 'PASS';
  if v_fail is not null then raise exception 'MSG-5 proof FAILED: %', v_fail; end if;
  if (select count(*) from msg5_results) < 18 then raise exception 'MSG-5 proof FAILED: only % checks ran', (select count(*) from msg5_results); end if;
end $$;

rollback;
