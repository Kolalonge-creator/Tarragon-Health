-- ===========================================================================
-- Proof: 20261105111305_test_flag_follows_profile.sql
-- PROVES
--   1. Marking a real patient as a test account re-stamps their existing rows (risk_scores, an append-only table, and
--      care_gaps, which carries update guards) to is_test = true, without tripping the append-only guard.
--   2. Another real patient's rows are untouched (non-vacuity of the match).
--   3. One audit_log row records the re-stamp with per-table counts.
--   4. Unmarking the patient turns the same rows back to is_test = false.
--   5. Row triggers did not fire for the re-stamp: risk_scores' append-only trigger would otherwise have refused it.
--   6. No client can call the re-stamp function.
--   7. SABOTAGE: with the profiles trigger dropped, marking a patient as test leaves their rows real, so check 1 discriminates.
-- Wrapped in BEGIN/ROLLBACK; mints its own people and rows.
-- ===========================================================================
begin;
create temp table tf_results (check_name text, observed text, expected text, verdict text);
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin
  insert into tf_results values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;

create function pg_temp.mint(p_email text, p_org uuid) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (u, p_email, 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (u, p_org, 'patient', 'Test-flag proof', false)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = false;
  return u;
end $$;

create function pg_temp.seed_rows(p_patient uuid, p_org uuid) returns void language plpgsql as $$
begin
  insert into public.risk_scores (organisation_id, patient_id, model_version, computed_on, deterioration_risk, dropout_risk, level, inputs, reasons)
  values (p_org, p_patient, 1, current_date, 10, 10, 'low', '{}'::jsonb, '[]'::jsonb);
  insert into public.care_gaps (organisation_id, patient_id, gap_type, due_date, owner_role, shadow, config_version, why, condition)
  values (p_org, p_patient, 'missed_reading', current_date, 'care_coordinator', true, 1, '{}'::jsonb, 'hypertension');
end $$;

create temp table tf_ids (k text primary key, v uuid);
insert into tf_ids select 'org', id from public.organisations order by created_at limit 1;
insert into tf_ids select 'p', pg_temp.mint('tf-p-' || gen_random_uuid() || '@example.com', (select v from tf_ids where k = 'org'));
insert into tf_ids select 'q', pg_temp.mint('tf-q-' || gen_random_uuid() || '@example.com', (select v from tf_ids where k = 'org'));
select pg_temp.seed_rows((select v from tf_ids where k = 'p'), (select v from tf_ids where k = 'org'));
select pg_temp.seed_rows((select v from tf_ids where k = 'q'), (select v from tf_ids where k = 'org'));

-- 1-3. mark P as a test account (as the migration connection, a service context)
update public.profiles set is_test = true where id = (select v from tf_ids where k = 'p');
select pg_temp.chk('1a risk_scores (append-only) follows to test', 'true',
  (select bool_and(is_test)::text from public.risk_scores where patient_id = (select v from tf_ids where k = 'p')));
select pg_temp.chk('1b care_gaps follows to test', 'true',
  (select bool_and(is_test)::text from public.care_gaps where patient_id = (select v from tf_ids where k = 'p')));
select pg_temp.chk('2 another real patient untouched', 'false',
  (select bool_or(is_test)::text from (
     select is_test from public.risk_scores where patient_id = (select v from tf_ids where k = 'q')
     union all select is_test from public.care_gaps where patient_id = (select v from tf_ids where k = 'q')) x));
select pg_temp.chk('3 one audit row with counts', '1|1|1',
  (select count(*)::text || '|' || max((event #>> '{rows_by_table,risk_scores}'))  || '|' || max((event #>> '{rows_by_table,care_gaps}'))
     from public.audit_log where action = 'test_flag_restamp' and entity_id = (select v from tf_ids where k = 'p')));

-- 4. unmark
update public.profiles set is_test = false where id = (select v from tf_ids where k = 'p');
select pg_temp.chk('4 unmarking turns the rows back to real', 'false',
  (select bool_or(is_test)::text from (
     select is_test from public.risk_scores where patient_id = (select v from tf_ids where k = 'p')
     union all select is_test from public.care_gaps where patient_id = (select v from tf_ids where k = 'p')) x));

select pg_temp.chk('4b unmarking raises an ops incident so finance reviews the money', '1',
  (select count(*)::text from public.ops_incidents where external_reference = 'test-flag-unmarked:' || (select v from tf_ids where k = 'p')));

-- 5. the append-only guard is real: an ordinary update of the same column is refused
do $$
declare v_refused boolean := false;
begin
  begin
    update public.risk_scores set is_test = true where patient_id = (select v from tf_ids where k = 'p');
  exception when others then v_refused := true;
  end;
  perform pg_temp.chk('5 ordinary update of risk_scores is refused (so the re-stamp skipped triggers)', 'true', v_refused::text);
end $$;

-- 6. no client can call it
select pg_temp.chk('6 authenticated cannot execute the re-stamp', 'false',
  has_function_privilege('authenticated', 'private.restamp_test_flag_for_profile(uuid, boolean)', 'EXECUTE')::text);
select pg_temp.chk('6b anon cannot execute the re-stamp', 'false',
  has_function_privilege('anon', 'private.restamp_test_flag_for_profile(uuid, boolean)', 'EXECUTE')::text);

-- 6c. the setting is back to normal afterwards, so later triggers in the same transaction still fire
select pg_temp.chk('6c session_replication_role restored after a re-stamp', 'origin', current_setting('session_replication_role'));

-- 8. through a real signed-in admin (the path the admin console uses): the flag change is allowed and the rows follow
insert into tf_ids select 'admin', pg_temp.mint('tf-admin-' || gen_random_uuid() || '@example.com', (select v from tf_ids where k = 'org'));
update public.profiles set role = 'admin' where id = (select v from tf_ids where k = 'admin');
select set_config('request.jwt.claims', json_build_object('sub', (select v from tf_ids where k = 'admin'), 'role', 'authenticated')::text, true);
grant select on tf_ids to authenticated;
set local role authenticated;
update public.profiles set is_test = true where id = (select v from tf_ids where k = 'p');
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.chk('8 an admin marking a patient as test re-stamps their rows', 'true',
  (select bool_and(is_test)::text from public.risk_scores where patient_id = (select v from tf_ids where k = 'p')));
select pg_temp.chk('8b and the setting is back to normal for the admin session', 'origin', current_setting('session_replication_role'));

-- 7. SABOTAGE: without the trigger, marking Q as test leaves Q's rows real. Run in a sub-block that is undone afterwards,
-- keeping only its verdict (a savepoint rollback would also discard the result row).
do $$
declare v_leaked boolean;
begin
  begin
    drop trigger profiles_zz_test_flag_follows on public.profiles;
    update public.profiles set is_test = true where id = (select v from tf_ids where k = 'q');
    select coalesce(bool_or(is_test), false) into v_leaked from public.risk_scores where patient_id = (select v from tf_ids where k = 'q');
    raise exception 'undo sabotage';
  exception when others then
    if sqlerrm <> 'undo sabotage' then raise; end if;
  end;
  perform pg_temp.chk('7 SABOTAGE caught: without the trigger the rows stay real', 'PASS',
    case when v_leaked then 'FAIL' else 'PASS' end);
end $$;
select pg_temp.chk('7b trigger is back after the sabotage block', 'true',
  exists (select 1 from pg_trigger where tgname = 'profiles_zz_test_flag_follows')::text);

select check_name, expected, observed, verdict from tf_results order by check_name;
do $$
begin
  if exists (select 1 from tf_results where verdict = 'FAIL') then
    raise exception 'test_flag_follows_profile: % check(s) FAILED', (select count(*) from tf_results where verdict = 'FAIL');
  end if;
end $$;
rollback;
