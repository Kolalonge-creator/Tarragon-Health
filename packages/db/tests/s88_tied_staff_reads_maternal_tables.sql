-- S88 proof: staff read (and write) the nine pregnancy and maternal tables only through a care relationship (INV-10, INV-12, OQ-362, OQ-588).
-- Migration *_s88_tie_staff_reads_pregnancy_and_maternal_tables.sql. One rolled-back transaction, simulated JWT sessions
-- (set_config request.jwt.claim.sub + set local role authenticated), no real person's data touched (every user is a fresh is_test fixture).
-- Tables: pregnancies, kick_counts, contractions, birth_plans, postnatal_baby_checks, breastfeeding_feed_log, lifecycle_states, lifecycle_events,
-- pregnancy_loss_records. Two patients (the subject S and another O) each have rows in all nine, so "zero rows" is never vacuous.
-- Proves:
--   0. CONTROL: the table owner sees rows for S and for O in every one of the nine tables;
--   A. an untied clinician of the same organisation reads zero rows about S and about O;
--   B. a clinician tied to S through the care team reads exactly S's rows (the owner's count) and nothing about O;
--   C. a care coordinator, even one assigned to S, reads none of the nine (logistics only);
--   D. the patient reads exactly her own rows and nothing about O;
--   E. a break-glass grant does NOT open them for an untied clinician (reproductive_health is never opened by break-glass);
--   F. the kill switch tied_staff_reads off gives back the old organisation-wide read, and on closes it again;
--   W. writes: an untied clinician and a coordinator cannot write a baby check or a feed for S; the tied active clinician can; the patient can write her own;
--   G. structure: the nine are registered tied/reproductive_health; no policy on them keeps a plain staff arm; anon cannot execute the helpers.
-- SABOTAGE (each must flip check A, which then reads non-zero): (1) the helper put back to the old plain staff check; (2) one S67 policy put back
-- from staff_read_policy_backup (its original private.pregnancy_staff_may_read arm).

begin;

-- S47d: reproductive records are written only after the person said yes; this proof is about something else (rolled-back trigger, as in the S68 proofs)
create function pg_temp.s47d_say_yes() returns trigger language plpgsql as $f$
begin
  if new.organisation_id is not null and not exists (select 1 from public.consent_matrix_events e where e.patient_id = new.id and e.data_type = 'reproductive') then
    insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, recorded_by, is_test)
    values (new.organisation_id, new.id, 'reproductive', 'care', 'granted', 2, 'patient', new.id, false);
  end if;
  return new;
end $f$;
create trigger zz_s47d_say_yes after insert or update of organisation_id on public.profiles for each row execute function pg_temp.s47d_say_yes();

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
-- run a statement as a user: 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null, p_sex text default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's88-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S88 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '30 years')::date), true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  if p_sex is not null then update public.profiles set sex = p_sex::public.sex where id = v; end if;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'S88 ' || p_label, true, now(), 'senior_medical_officer') on conflict do nothing;  -- S39g: a clinician's write needs an active staff row and a care tie
  end if;
  return v;
end $f$;

-- rows in the nine tables for one patient (as the patient; the postnatal profile as the table owner, which creates the baby checks)
create function pg_temp.seed(p_org uuid, p_pat uuid, p_label text) returns void language plpgsql as
$f$ declare r text; v_preg uuid;
begin
  perform pg_temp.act(p_pat);
  insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, lmp, edd) values (p_org, p_pat, 0, current_date - 140, current_date + 140) returning id into v_preg;
  insert into public.kick_counts (organisation_id, patient_id, pregnancy_id, client_id, started_at, result, config_version, source)
    values (p_org, p_pat, v_preg, gen_random_uuid(), now(), 'target_reached', 1, 'patient');
  insert into public.contractions (organisation_id, patient_id, pregnancy_id, client_id, started_at, pattern, result, config_version, source)
    values (p_org, p_pat, v_preg, gen_random_uuid(), now(), 'standard', 'keep_timing', 1, 'patient');
  insert into public.birth_plans (organisation_id, patient_id, pregnancy_id, place_of_birth, money_plan_kobo, source)
    values (p_org, p_pat, v_preg, 'General Hospital', 15000000, 'patient');
  insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type, duration_minutes) values (p_org, p_pat, 'breast_left', 12);
  -- a loss makes the lifecycle state, the lifecycle events and the loss note
  perform public.record_lifecycle_event('pregnancy_loss_recorded', current_date - 1, null, 9, 'S88 private note');
  perform pg_temp.back();
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode) values (p_org, p_pat, current_date - 3, 'vaginal');
end $f$;

-- how many rows of public.<table> where patient_id <op> subject can this user see (p_uid null = the table owner, no row security)
create function pg_temp.count_as(p_uid uuid, p_table text, p_op text, p_subject uuid) returns text language plpgsql as
$f$ declare r bigint;
begin
  if p_uid is not null then perform pg_temp.act(p_uid); end if;
  begin
    execute format('select count(*) from public.%I where patient_id %s %L::uuid', p_table, p_op, p_subject) into r;
  exception when insufficient_privilege then r := 0; when others then r := -1;
  end;
  if p_uid is not null then perform pg_temp.back(); end if;
  return r::text;
end $f$;
create function pg_temp.tables() returns text[] language sql as
$$ select array['pregnancies', 'kick_counts', 'contractions', 'birth_plans', 'postnatal_baby_checks', 'breastfeeding_feed_log', 'lifecycle_states', 'lifecycle_events', 'pregnancy_loss_records'] $$;
-- one string per table: 'table=count' for every table where the user's count about the subject differs from p_want (null want = owner's count)
create function pg_temp.gaps(p_uid uuid, p_subject uuid, p_op text, p_want_owner boolean, p_want integer default 0) returns text language plpgsql as
$f$ declare t text; out_ text := ''; a text; b text;
begin
  foreach t in array pg_temp.tables() loop
    a := case when p_want_owner then pg_temp.count_as(null, t, p_op, p_subject) else p_want::text end;
    b := pg_temp.count_as(p_uid, t, p_op, p_subject);
    if a <> b then out_ := out_ || t || '(want ' || a || ' saw ' || b || '); '; end if;
  end loop;
  return out_;
end $f$;

do $$
declare v_org uuid; v_s uuid; v_o uuid; v_c1 uuid; v_c2 uuid; v_co uuid; v_r text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_s := pg_temp.mkuser(v_org, 'subject', 'patient', (current_date - interval '28 years')::date, 'female');
  v_o := pg_temp.mkuser(v_org, 'other', 'patient', (current_date - interval '30 years')::date, 'female');
  v_c1 := pg_temp.mkuser(v_org, 'untied clinician', 'clinician');
  v_c2 := pg_temp.mkuser(v_org, 'tied clinician', 'clinician');
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_s, v_c2, v_co, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id, care_coordinator_id = excluded.care_coordinator_id, clinical_director_id = null;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('s', v_s); perform pg_temp.setf('o', v_o);
  perform pg_temp.setf('c1', v_c1); perform pg_temp.setf('c2', v_c2); perform pg_temp.setf('co', v_co);
  perform pg_temp.seed(v_org, v_s, 'S');
  perform pg_temp.seed(v_org, v_o, 'O');
end $$;

-- 0 control: rows exist for both patients in every table (otherwise a zero below proves nothing)
select pg_temp.ck('real', '0a CONTROL the owner sees at least one row about S in every one of the nine tables', '', (
  select coalesce(string_agg(t, ', '), '') from unnest(pg_temp.tables()) t where pg_temp.count_as(null, t, '=', pg_temp.f('s'))::integer < 1));
select pg_temp.ck('real', '0b CONTROL ...and about O', '', (
  select coalesce(string_agg(t, ', '), '') from unnest(pg_temp.tables()) t where pg_temp.count_as(null, t, '=', pg_temp.f('o'))::integer < 1));

-- A untied clinician
select pg_temp.ck('real', 'A1 an untied clinician reads zero rows about S in all nine tables', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));
select pg_temp.ck('real', 'A2 ...and zero rows about O', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('o'), '=', false));
-- B tied clinician
select pg_temp.ck('real', 'B1 a clinician tied to S reads exactly S''s rows in every table', '', pg_temp.gaps(pg_temp.f('c2'), pg_temp.f('s'), '=', true));
select pg_temp.ck('real', 'B2 ...and nothing about O (not tied to O)', '', pg_temp.gaps(pg_temp.f('c2'), pg_temp.f('o'), '=', false));
-- C coordinator (assigned to S, still never clinical)
select pg_temp.ck('real', 'C1 a care coordinator assigned to S reads none of the nine about S', '', pg_temp.gaps(pg_temp.f('co'), pg_temp.f('s'), '=', false));
select pg_temp.ck('real', 'C2 ...nor about O', '', pg_temp.gaps(pg_temp.f('co'), pg_temp.f('o'), '=', false));
-- D patient
select pg_temp.ck('real', 'D1 the patient reads exactly her own rows', '', pg_temp.gaps(pg_temp.f('s'), pg_temp.f('s'), '=', true));
select pg_temp.ck('real', 'D2 ...and nothing about O', '', pg_temp.gaps(pg_temp.f('s'), pg_temp.f('o'), '=', false));
-- E break-glass never opens reproductive_health
insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (pg_temp.f('c1'), pg_temp.f('org'), pg_temp.f('s'), pg_temp.f('org'), 'S88 proof', now() + interval '8 hours');
select pg_temp.ck('real', 'E1 with an active break-glass grant the untied clinician still reads none of the nine about S', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));
delete from public.emergency_record_access_grants where reason = 'S88 proof';

-- W writes
select pg_temp.ck('real', 'W1 an untied clinician cannot write a feed for S', 'true', (pg_temp.try_as(pg_temp.f('c1'), format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, pg_temp.f('org'), pg_temp.f('s'))) <> 'ok')::text);
select pg_temp.ck('real', 'W2 a coordinator cannot write a feed for S', 'true', (pg_temp.try_as(pg_temp.f('co'), format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, pg_temp.f('org'), pg_temp.f('s'))) <> 'ok')::text);
select pg_temp.ck('real', 'W3 the tied active clinician can write a feed for S', 'ok', pg_temp.try_as(pg_temp.f('c2'), format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, pg_temp.f('org'), pg_temp.f('s'))));
select pg_temp.ck('real', 'W4 the patient can still write her own feed', 'ok', pg_temp.try_as(pg_temp.f('s'), format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, pg_temp.f('org'), pg_temp.f('s'))));
do $$ declare v_n bigint; begin
  perform pg_temp.act(pg_temp.f('c1'));
  with u as (update public.postnatal_baby_checks set concerns_noted = true where patient_id = pg_temp.f('s') returning 1) select count(*) into v_n from u;
  perform pg_temp.back();
  insert into results values ('real', 'W5 an untied clinician changes no baby check of S (0 rows)', '0', v_n::text);
end $$;
-- the pregnancy write helper: a tied clinician passes, an untied one and a coordinator do not
create function pg_temp.mayw(p_uid uuid, p_pat uuid, p_org uuid) returns boolean language plpgsql as
$f$ declare r boolean;
begin
  perform pg_temp.act(p_uid);
  select private.pregnancy_may_write(p_pat, p_org) into r;
  perform pg_temp.back();
  return r;
end $f$;
select pg_temp.ck('real', 'W6 pregnancy_may_write: the tied clinician passes, the untied clinician and the coordinator do not', 'true|false|false',
  pg_temp.mayw(pg_temp.f('c2'), pg_temp.f('s'), pg_temp.f('org'))::text || '|' || pg_temp.mayw(pg_temp.f('c1'), pg_temp.f('s'), pg_temp.f('org'))::text || '|' || pg_temp.mayw(pg_temp.f('co'), pg_temp.f('s'), pg_temp.f('org'))::text);

-- F kill switch
update public.platform_modules set is_enabled = false where key = 'tied_staff_reads';
select pg_temp.ck('real', 'F1 with tied_staff_reads off an untied clinician reads the nine tables organisation-wide again (the old behaviour)', 'true',
  (pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false) <> '')::text);
update public.platform_modules set is_enabled = true where key = 'tied_staff_reads';
select pg_temp.ck('real', 'F2 and switching it back on closes them', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));

-- G structure
select pg_temp.ck('real', 'G1 the nine are registered tied / reproductive_health', '9', (select count(*)::text from public.staff_read_scope where mode = 'tied' and category = 'reproductive_health' and table_name = any (pg_temp.tables())));
select pg_temp.ck('real', 'G2 no policy on the nine keeps a plain staff arm or the old one-argument helper', '', (
  select coalesce(string_agg(p.tablename || '.' || p.policyname, ', '), '') from pg_policies p
   where p.schemaname = 'public' and p.tablename = any (pg_temp.tables()) and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '(is_org_staff\(|pregnancy_staff_may_read\()'));
select pg_temp.ck('real', 'G3 anon cannot execute the helpers or read the tables', 'false', (
  has_function_privilege('anon', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE') or has_function_privilege('anon', 'private.pregnancy_may_write(uuid,uuid)', 'EXECUTE')
  or exists (select 1 from unnest(pg_temp.tables()) t where has_table_privilege('anon', 'public.' || t, 'SELECT')))::text);
select pg_temp.ck('real', 'G4 authenticated keeps execute on the helpers the policies call', 'true', (
  has_function_privilege('authenticated', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'private.pregnancy_may_write(uuid,uuid)', 'EXECUTE'))::text);
select pg_temp.ck('real', 'G5 the replaced policy text is saved for rollback', 'true', ((select count(*) from public.staff_read_policy_backup where table_name = any (pg_temp.tables())) >= 12)::text);

-- SABOTAGE 1: the helper back to the old plain staff check; check A must flip on the five S68 tables
do $$ begin
  create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid) returns boolean language sql stable security definer set search_path = '' as 'select private.is_org_staff(p_org)';
  insert into results values ('sabotaged', 'SABOTAGE helper put back to is_org_staff: the untied clinician is shut out', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));
  create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid) returns boolean language sql stable security definer set search_path = '' as
    $b$ select private.staff_may_read(p_patient, p_org, 'reproductive_health'::public.care_access_category) $b$;
end $$;
-- SABOTAGE 2: one S67 policy put back from the backup
do $$
declare b record;
begin
  select * into b from public.staff_read_policy_backup where cmd = 'SELECT' and table_name = 'pregnancies' limit 1;
  execute format('drop policy %I on public.%I', b.policy_name, b.table_name);
  execute format('create policy %I on public.%I for select to %s using (%s)', b.policy_name, b.table_name, b.roles, b.qual);
  insert into results values ('sabotaged', 'SABOTAGE old policy restored on pregnancies: the untied clinician is shut out', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S88 proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || left(coalesce(actual, 'null'), 600) || ']', E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, case when expected = actual then 'PASS' else 'FAIL' end as result, left(actual, 160) as detail from results order by phase desc, check_name;

rollback;
