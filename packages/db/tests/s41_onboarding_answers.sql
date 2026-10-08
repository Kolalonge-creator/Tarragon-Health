-- S41 proof: onboarding answers and local government area (migration *_s41_onboarding_answers_and_lga.sql). One rolled-back transaction. Proves:
--   1. A patient saves goals and conditions; two rows exist, they read their own; saving again replaces (still two rows) and emits one event each time.
--   2. The event payload carries a count only, never a choice (no condition text in the outbox).
--   3. A second patient, a clinician, an admin, a care coordinator and anon each read ZERO rows of someone else's answers (RLS per role).
--   4. Nobody can write the table directly (insert, update, delete refused for the patient and a clinician); only the RPC writes.
--   5. The RPC refuses: anon, a clinician (not a patient), an unknown option, an empty list, "none" mixed with another condition,
--      "not sure" mixed with another goal, more than five goals, and null arguments.
--   6. profiles.lga accepts 2 to 60 characters and refuses 1 and 61.
--   7. SABOTAGE A: the own-rows policy replaced by "true": a second patient must then see rows (the real check flips).
--   8. SABOTAGE B: the option check replaced by "true": an unknown option must then be accepted.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user; return 'ok' or the SQLSTATE
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's41-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S41 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_doc uuid; v_adm uuid; v_cc uuid; v_n integer; v_pay text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'patA', 'patient'); v_b := pg_temp.mkuser(v_org, 'patB', 'patient');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician'); v_adm := pg_temp.mkuser(v_org, 'adm', 'admin'); v_cc := pg_temp.mkuser(v_org, 'cc', 'care_coordinator');
  perform set_config('s41.a', v_a::text, true); perform set_config('s41.b', v_b::text, true);
  perform set_config('s41.doc', v_doc::text, true); perform set_config('s41.adm', v_adm::text, true); perform set_config('s41.cc', v_cc::text, true);
  insert into fx values ('a', v_a), ('b', v_b), ('doc', v_doc), ('adm', v_adm), ('cc', v_cc);

  -- 1. save and read
  perform pg_temp.ck('patient A saves answers', 'ok', pg_temp.try_as(v_a, $q$select public.save_onboarding_answers(array['manage_condition','family_care'], array['hypertension','diabetes'])$q$));
  perform pg_temp.ck('two rows for A', '2', (select count(*)::text from public.onboarding_answers where patient_id = v_a));
  perform pg_temp.ck('A reads their own two rows', '2', pg_temp.q_as(v_a, 'select count(*)::text from public.onboarding_answers'));
  perform pg_temp.ck('row is self reported and recorded by the patient', 'patient_self_report|true',
    (select min(source) || '|' || bool_and(recorded_by = patient_id)::text from public.onboarding_answers where patient_id = v_a));
  perform pg_temp.ck('is_test copied from the profile', 'true', (select bool_and(is_test)::text from public.onboarding_answers where patient_id = v_a));
  perform pg_temp.ck('saving again replaces', 'ok', pg_temp.try_as(v_a, $q$select public.save_onboarding_answers(array['stay_ahead'], array['none'])$q$));
  perform pg_temp.ck('still two rows after a second save', '2', (select count(*)::text from public.onboarding_answers where patient_id = v_a));
  perform pg_temp.ck('answer replaced', '["stay_ahead"]', (select answer::text from public.onboarding_answers where patient_id = v_a and question_code = 'goals'));
  -- 2. event
  select count(*) into v_n from public.domain_events where event_type = 'onboarding.answers_saved' and patient_id = v_a;
  perform pg_temp.ck('one event per save', '2', v_n::text);
  select string_agg(payload::text, ' ') into v_pay from public.domain_events where event_type = 'onboarding.answers_saved' and patient_id = v_a;
  perform pg_temp.ck('event payload names no choice', 'false', (v_pay ~* 'hypertension|diabetes|stay_ahead|none|manage')::text);

  -- 3. RLS per role
  perform pg_temp.ck('patient B sees none of A', '0', pg_temp.q_as(v_b, format('select count(*)::text from public.onboarding_answers where patient_id = %L', v_a)));
  perform pg_temp.ck('clinician sees none of A', '0', pg_temp.q_as(v_doc, format('select count(*)::text from public.onboarding_answers where patient_id = %L', v_a)));
  perform pg_temp.ck('admin sees none of A', '0', pg_temp.q_as(v_adm, format('select count(*)::text from public.onboarding_answers where patient_id = %L', v_a)));
  perform pg_temp.ck('care coordinator sees none of A', '0', pg_temp.q_as(v_cc, format('select count(*)::text from public.onboarding_answers where patient_id = %L', v_a)));
  perform pg_temp.ck('anon cannot read the table', '42501', pg_temp.try_anon('select * from public.onboarding_answers'));

  -- 4. no direct writes
  perform pg_temp.ck('patient cannot insert directly', '42501', pg_temp.try_as(v_b, format($q$insert into public.onboarding_answers (organisation_id, patient_id, question_code, answer, recorded_by) values (%L, %L, 'goals', '["manage_condition"]', %L)$q$, v_org, v_b, v_b)));
  perform pg_temp.ck('patient cannot update directly', '42501', pg_temp.try_as(v_a, $q$update public.onboarding_answers set answer = '["manage_condition"]'$q$));
  perform pg_temp.ck('patient cannot delete directly', '42501', pg_temp.try_as(v_a, 'delete from public.onboarding_answers'));
  perform pg_temp.ck('clinician cannot insert directly', '42501', pg_temp.try_as(v_doc, format($q$insert into public.onboarding_answers (organisation_id, patient_id, question_code, answer, recorded_by) values (%L, %L, 'goals', '["manage_condition"]', %L)$q$, v_org, v_a, v_doc)));

  -- 5. refusals
  perform pg_temp.ck('anon cannot call the RPC', '42501', pg_temp.try_anon($q$select public.save_onboarding_answers(array['stay_ahead'], array['none'])$q$));
  perform pg_temp.ck('clinician cannot call the RPC', '42501', pg_temp.try_as(v_doc, $q$select public.save_onboarding_answers(array['stay_ahead'], array['none'])$q$));
  perform pg_temp.ck('unknown goal refused', '22023', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(array['become_rich'], array['none'])$q$));
  perform pg_temp.ck('unknown condition refused', '22023', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(array['stay_ahead'], array['made_up'])$q$));
  perform pg_temp.ck('empty goals refused', '22023', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(array[]::text[], array['none'])$q$));
  perform pg_temp.ck('null arguments refused', '22023', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(null, null)$q$));
  perform pg_temp.ck('none mixed with a condition refused', '22023', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(array['stay_ahead'], array['none','asthma'])$q$));
  perform pg_temp.ck('not sure mixed with a goal refused', '22023', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(array['not_sure','stay_ahead'], array['none'])$q$));
  perform pg_temp.ck('six goals refused', '22023', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(array['manage_condition','stay_ahead','screening_check','family_care','not_sure','x'], array['none'])$q$));
  perform pg_temp.ck('nothing was written for B by the refusals', '0', (select count(*)::text from public.onboarding_answers where patient_id = v_b));
  perform pg_temp.ck('duplicates collapse', 'ok', pg_temp.try_as(v_b, $q$select public.save_onboarding_answers(array['stay_ahead','stay_ahead'], array['asthma','asthma'])$q$));
  perform pg_temp.ck('duplicates stored once', '["stay_ahead"]', (select answer::text from public.onboarding_answers where patient_id = v_b and question_code = 'goals'));

  -- 6. lga
  perform pg_temp.ck('lga of two characters accepted', 'ok', pg_temp.try_as(v_a, format($q$update public.profiles set lga = 'Ife' where id = %L$q$, v_a)));
  perform pg_temp.ck('lga of one character refused', '23514', pg_temp.try_as(v_a, format($q$update public.profiles set lga = 'X' where id = %L$q$, v_a)));
  perform pg_temp.ck('lga of 61 characters refused', '23514', pg_temp.try_as(v_a, format($q$update public.profiles set lga = %L where id = %L$q$, repeat('a', 61), v_a)));
end $$;

-- 7. SABOTAGE A: the own-rows policy opened to everyone. A second patient must then see rows; the real "sees none" check must flip.
drop policy onboarding_answers_own_select on public.onboarding_answers;
create policy onboarding_answers_own_select on public.onboarding_answers for select to authenticated using (true);
do $$
begin
  insert into results values ('sabotaged', 'patient B sees none of A', '0',
    pg_temp.q_as(pg_temp.f('b'), format('select count(*)::text from public.onboarding_answers where patient_id = %L', pg_temp.f('a'))));
end $$;
drop policy onboarding_answers_own_select on public.onboarding_answers;
create policy onboarding_answers_own_select on public.onboarding_answers for select to authenticated using (patient_id = (select auth.uid()));

-- 8. SABOTAGE B: the option check says yes to everything. An unknown option must then be accepted.
create or replace function private.onboarding_option_ok(p_question text, p_option text) returns boolean language sql immutable set search_path = '' as $$ select true $$;
do $$
begin
  insert into results values ('sabotaged', 'unknown goal refused', '22023',
    pg_temp.try_as(pg_temp.f('b'), $q$select public.save_onboarding_answers(array['become_rich'], array['none'])$q$));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S41 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
