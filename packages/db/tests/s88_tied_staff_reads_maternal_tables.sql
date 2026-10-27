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
--   V. a support VIEW-AS session does NOT open them either (the generic helper private.staff_may_read DOES admit view-as for the same patient and
--      category: that control proves the fixture bites, so the zero is not vacuous);
--   F. the kill switches give the old organisation-wide read and write back, and switching on closes them again;
--   W. writes through real row security, each with SQLSTATE 42501 (not just "some error"): an untied clinician and a coordinator cannot write a feed,
--      a baby check, a pregnancy, a birth plan, a kick count or a contraction session; the tied active clinician CAN (positive controls, including an
--      UPDATE of a baby check); the patient can write her own;
--   R. SECURITY DEFINER functions: record_lifecycle_event and antenatal_schedule_review_prompt refuse an untied clinician, a coordinator and a view-as
--      holder (SQLSTATE 42501, nothing written) and admit the tied clinician; no SECURITY DEFINER non-trigger function that names one of the nine
--      tables still carries the plain is_org_staff arm (a structural sweep of pg_proc);
--   G. structure: the nine are registered tied/reproductive_health; no policy keeps a plain staff arm, the dead helper or view-as; the dead helper is
--      neutralised; anon cannot execute the helpers; both backups exist.
-- SABOTAGE (nine steps, each must flip its check; the guard demands all nine): (1) the read helper put back to the old plain staff check; (2) the read
-- helper put back to staff_may_read (the first draft, admits view-as); (3) pregnancy_may_write's staff arm put back to organisation-wide; (4) the
-- baby-check UPDATE policy, (5) the baby-check INSERT policy and (6) the feed-log INSERT policy put back to the old plain staff arm; (7)
-- record_lifecycle_event and (8) antenatal_schedule_review_prompt put back to their old bodies from staff_read_function_backup; (9) the COMPLETE rollback
-- (every old function body from the function backup and every old policy from the policy backup) must give the untied clinician the organisation-wide
-- read again, which also proves the backups are complete; everything is re-applied from snapshots after each step.

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


-- run a statement as a user: 'ok' or its SQLSTATE
create function pg_temp.state_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run an UPDATE ... as a user and return how many rows it changed
create function pg_temp.upd_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare n bigint;
begin
  perform pg_temp.act(p_uid);
  begin execute 'with u as (' || p_sql || ' returning 1) select count(*) from u' into n; exception when others then n := -1; end;
  perform pg_temp.back();
  return n::text;
end $f$;
-- statement builders (the BEFORE INSERT triggers set source and attach the pregnancy; the values here satisfy every check constraint)
create function pg_temp.ins(p_kind text, p_pat uuid, p_preg uuid) returns text language sql as
$$ select case p_kind
  when 'pregnancies' then format($q$insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, lmp, edd) values (%L, %L, 0, current_date - 140, current_date + 140)$q$, pg_temp.f('org'), p_pat)
  when 'birth_plans' then format($q$insert into public.birth_plans (organisation_id, patient_id, pregnancy_id, place_of_birth, source) values (%L, %L, %L, 'S88 hospital', 'clinician')$q$, pg_temp.f('org'), p_pat, p_preg)
  when 'kick_counts' then format($q$insert into public.kick_counts (organisation_id, patient_id, pregnancy_id, client_id, started_at, result, config_version, source) values (%L, %L, %L, gen_random_uuid(), now(), 'target_reached', 1, 'clinician')$q$, pg_temp.f('org'), p_pat, p_preg)
  when 'contractions' then format($q$insert into public.contractions (organisation_id, patient_id, pregnancy_id, client_id, started_at, pattern, result, config_version, source) values (%L, %L, %L, gen_random_uuid(), now(), 'standard', 'keep_timing', 1, 'clinician')$q$, pg_temp.f('org'), p_pat, p_preg)
  when 'baby_check' then format($q$insert into public.postnatal_baby_checks (organisation_id, patient_id, postnatal_profile_id, check_window, scheduled_date) values (%L, %L, %L, 'week_6', current_date)$q$, pg_temp.f('org'), p_pat, (select id from public.postnatal_profiles where patient_id = p_pat limit 1))
  when 'feed' then format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, pg_temp.f('org'), p_pat)
 end $$;
create function pg_temp.preg_of(p_pat uuid) returns uuid language sql as $$ select id from public.pregnancies where patient_id = p_pat order by created_at desc limit 1 $$;
-- snapshots so a sabotage can always be undone exactly
create temp table snap_fn(sig text primary key, def text) on commit drop;
create temp table snap_pol(tbl text, pol text, q text, w text, primary key (tbl, pol)) on commit drop;
create function pg_temp.set_pol(p_tbl text, p_pol text, p_q text, p_w text) returns void language plpgsql as
$f$ begin
  execute format('alter policy %I on public.%I %s %s', p_pol, p_tbl,
                 case when p_q is not null then 'using (' || p_q || ')' else '' end,
                 case when p_w is not null then 'with check (' || p_w || ')' else '' end);
end $f$;
create function pg_temp.snap_all() returns void language plpgsql as
$f$ declare s text;
begin
  delete from snap_fn; delete from snap_pol;
  foreach s in array array['private.maternal_staff_may_read(uuid,uuid)', 'private.pregnancy_may_write(uuid,uuid)', 'private.pregnancy_staff_may_read(uuid)',
                           'public.record_lifecycle_event(text,date,uuid,integer,text,text)', 'public.antenatal_schedule_review_prompt(uuid)'] loop
    insert into snap_fn values (s, pg_get_functiondef(s::regprocedure));
  end loop;
  insert into snap_pol select p.tablename, p.policyname, p.qual, p.with_check from pg_policies p where p.schemaname = 'public' and p.tablename = any (pg_temp.tables());
end $f$;
create function pg_temp.restore_all() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select def from snap_fn loop execute r.def; end loop;
  for r in select * from snap_pol loop perform pg_temp.set_pol(r.tbl, r.pol, r.q, r.w); end loop;
end $f$;

do $$
declare v_org uuid; v_s uuid; v_o uuid; v_t uuid; v_l uuid; v_l2 uuid; v_c1 uuid; v_c2 uuid; v_co uuid; v_cv uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_s := pg_temp.mkuser(v_org, 'subject', 'patient', (current_date - interval '28 years')::date, 'female');
  v_o := pg_temp.mkuser(v_org, 'other', 'patient', (current_date - interval '30 years')::date, 'female');
  v_t := pg_temp.mkuser(v_org, 'write target', 'patient', (current_date - interval '27 years')::date, 'female');
  v_l := pg_temp.mkuser(v_org, 'lifecycle target', 'patient', (current_date - interval '29 years')::date, 'female');
  v_l2 := pg_temp.mkuser(v_org, 'lifecycle sabotage target', 'patient', (current_date - interval '29 years')::date, 'female');
  v_c1 := pg_temp.mkuser(v_org, 'untied clinician', 'clinician');
  v_c2 := pg_temp.mkuser(v_org, 'tied clinician', 'clinician');
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  v_cv := pg_temp.mkuser(v_org, 'view-as clinician', 'clinician');
  -- S, T and L are on the tied clinician's care team (and the coordinator's); O and L2 are nobody's
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at)
  select v_org, p, v_c2, v_co, now() from unnest(array[v_s, v_t, v_l]) p
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id, care_coordinator_id = excluded.care_coordinator_id, clinical_director_id = null;
  -- the view-as clinician holds the support.view_as permission and an open session about S (the session trigger checks the signed-in user, so sign in first)
  insert into public.user_permission_grants (profile_id, permission_key) values (v_cv, 'support.view_as');
  perform set_config('request.jwt.claim.sub', v_cv::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cv, 'role', 'authenticated')::text, true);
  insert into public.support_view_sessions (viewer_id, subject_id, subject_role, organisation_id, reason, expires_at)
    values (v_cv, v_s, 'patient', v_org, 'S88 proof', now() + interval '1 hour');
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('s', v_s); perform pg_temp.setf('o', v_o); perform pg_temp.setf('t', v_t);
  perform pg_temp.setf('l', v_l); perform pg_temp.setf('l2', v_l2);
  perform pg_temp.setf('c1', v_c1); perform pg_temp.setf('c2', v_c2); perform pg_temp.setf('co', v_co); perform pg_temp.setf('cv', v_cv);
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

-- V view-as never opens them
create function pg_temp.helper_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'error:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
select pg_temp.ck('real', 'V0 CONTROL the session bites: the generic helper staff_may_read admits the view-as clinician for S in reproductive_health', 'true',
  pg_temp.helper_as(pg_temp.f('cv'), format($q$select private.staff_may_read(%L, %L, 'reproductive_health'::public.care_access_category)::text$q$, pg_temp.f('s'), pg_temp.f('org'))));
select pg_temp.ck('real', 'V1 ...but maternal_staff_may_read refuses the same caller', 'false',
  pg_temp.helper_as(pg_temp.f('cv'), format($q$select private.maternal_staff_may_read(%L, %L)::text$q$, pg_temp.f('s'), pg_temp.f('org'))));
select pg_temp.ck('real', 'V2 the view-as clinician reads zero rows about S in all nine tables', '', pg_temp.gaps(pg_temp.f('cv'), pg_temp.f('s'), '=', false));

-- W writes through real row security. Order matters: the tied clinician's pregnancy for T first (the other inserts need its id).
select pg_temp.ck('real', 'W0 the tied clinician can insert a pregnancy for T (positive control, real RLS)', 'ok', pg_temp.state_as(pg_temp.f('c2'), pg_temp.ins('pregnancies', pg_temp.f('t'), null)));
create function pg_temp.negatives(p_user uuid, p_kind text) returns text language sql as
$$ select pg_temp.state_as(p_user, pg_temp.ins(p_kind, pg_temp.f('t'), pg_temp.preg_of(pg_temp.f('t')))) $$;
select pg_temp.ck('real', 'W1 an untied clinician is refused with 42501 on: feed, pregnancy, birth plan, kick count, contraction session', '42501|42501|42501|42501|42501',
  pg_temp.negatives(pg_temp.f('c1'), 'feed') || '|' || pg_temp.negatives(pg_temp.f('c1'), 'pregnancies') || '|' || pg_temp.negatives(pg_temp.f('c1'), 'birth_plans')
  || '|' || pg_temp.negatives(pg_temp.f('c1'), 'kick_counts') || '|' || pg_temp.negatives(pg_temp.f('c1'), 'contractions'));
select pg_temp.ck('real', 'W2 a care coordinator is refused with 42501 on the same five', '42501|42501|42501|42501|42501',
  pg_temp.negatives(pg_temp.f('co'), 'feed') || '|' || pg_temp.negatives(pg_temp.f('co'), 'pregnancies') || '|' || pg_temp.negatives(pg_temp.f('co'), 'birth_plans')
  || '|' || pg_temp.negatives(pg_temp.f('co'), 'kick_counts') || '|' || pg_temp.negatives(pg_temp.f('co'), 'contractions'));
select pg_temp.ck('real', 'W3 the tied active clinician CAN insert: feed, birth plan, kick count, contraction session', 'ok|ok|ok|ok',
  pg_temp.negatives(pg_temp.f('c2'), 'feed') || '|' || pg_temp.negatives(pg_temp.f('c2'), 'birth_plans') || '|' || pg_temp.negatives(pg_temp.f('c2'), 'kick_counts')
  || '|' || pg_temp.negatives(pg_temp.f('c2'), 'contractions'));
select pg_temp.ck('real', 'W4 the patient can still write her own feed', 'ok', pg_temp.state_as(pg_temp.f('s'), pg_temp.ins('feed', pg_temp.f('s'), null)));
-- baby checks: T gets a postnatal profile (the owner; the trigger schedules the checks); week_6 is cleared so the inserts below are fresh rows
insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode) values (pg_temp.f('org'), pg_temp.f('t'), current_date - 3, 'vaginal');
delete from public.postnatal_baby_checks where patient_id = pg_temp.f('t') and check_window = 'week_6';
select pg_temp.ck('real', 'W5 an untied clinician and a coordinator are refused with 42501 on a baby-check insert', '42501|42501',
  pg_temp.state_as(pg_temp.f('c1'), pg_temp.ins('baby_check', pg_temp.f('t'), null)) || '|' || pg_temp.state_as(pg_temp.f('co'), pg_temp.ins('baby_check', pg_temp.f('t'), null)));
select pg_temp.ck('real', 'W6 the tied clinician can insert a baby check', 'ok', pg_temp.state_as(pg_temp.f('c2'), pg_temp.ins('baby_check', pg_temp.f('t'), null)));
select pg_temp.ck('real', 'W7 baby-check UPDATE: untied clinician 0 rows, coordinator 0 rows, tied clinician >= 1 row', '0|0|true', (
  pg_temp.upd_as(pg_temp.f('c1'), format($q$update public.postnatal_baby_checks set concerns_noted = true where patient_id = %L$q$, pg_temp.f('t'))) || '|' ||
  pg_temp.upd_as(pg_temp.f('co'), format($q$update public.postnatal_baby_checks set concerns_noted = true where patient_id = %L$q$, pg_temp.f('t'))) || '|' ||
  (pg_temp.upd_as(pg_temp.f('c2'), format($q$update public.postnatal_baby_checks set concerns_noted = true where patient_id = %L$q$, pg_temp.f('t')))::integer >= 1)::text));
select pg_temp.ck('real', 'W8 the patient can still update her own baby check', 'true',
  (pg_temp.upd_as(pg_temp.f('t'), format($q$update public.postnatal_baby_checks set concern_note = 'S88' where patient_id = %L$q$, pg_temp.f('t')))::integer >= 1)::text);
-- the pregnancy write helper: a tied clinician passes, an untied one and a coordinator do not
create function pg_temp.mayw(p_uid uuid, p_pat uuid, p_org uuid) returns boolean language plpgsql as
$f$ declare r boolean;
begin
  perform pg_temp.act(p_uid);
  select private.pregnancy_may_write(p_pat, p_org) into r;
  perform pg_temp.back();
  return r;
end $f$;
select pg_temp.ck('real', 'W9 pregnancy_may_write: the tied clinician passes, the untied clinician and the coordinator do not', 'true|false|false',
  pg_temp.mayw(pg_temp.f('c2'), pg_temp.f('s'), pg_temp.f('org'))::text || '|' || pg_temp.mayw(pg_temp.f('c1'), pg_temp.f('s'), pg_temp.f('org'))::text || '|' || pg_temp.mayw(pg_temp.f('co'), pg_temp.f('s'), pg_temp.f('org'))::text);

-- R SECURITY DEFINER functions
select pg_temp.ck('real', 'R1 record_lifecycle_event for L: an untied clinician, a coordinator and the view-as clinician are all refused with 42501', '42501|42501|42501', 
  pg_temp.state_as(pg_temp.f('c1'), format($q$select public.record_lifecycle_event('pregnancy_confirmed', current_date, %L)$q$, pg_temp.f('l'))) || '|' ||
  pg_temp.state_as(pg_temp.f('co'), format($q$select public.record_lifecycle_event('pregnancy_confirmed', current_date, %L)$q$, pg_temp.f('l'))) || '|' ||
  pg_temp.state_as(pg_temp.f('cv'), format($q$select public.record_lifecycle_event('pregnancy_confirmed', current_date, %L)$q$, pg_temp.f('s'))));
select pg_temp.ck('real', 'R2 ...and nothing was written for L by the refused calls', '0|0|tracking', (
  select (select count(*) from public.lifecycle_events where patient_id = pg_temp.f('l'))::text || '|' ||
         (select count(*) from public.pregnancy_loss_records where patient_id = pg_temp.f('l'))::text || '|' ||
         coalesce((select stage from public.lifecycle_states where patient_id = pg_temp.f('l')), 'tracking')));
select pg_temp.ck('real', 'R3 the tied clinician can record a confirmed pregnancy and then a loss for L', 'ok|ok', (
  pg_temp.state_as(pg_temp.f('c2'), format($q$select public.record_lifecycle_event('pregnancy_confirmed', current_date, %L)$q$, pg_temp.f('l'))) || '|' ||
  pg_temp.state_as(pg_temp.f('c2'), format($q$select public.record_lifecycle_event('pregnancy_loss_recorded', current_date, %L, 7, 'S88 team note')$q$, pg_temp.f('l')))));
select pg_temp.ck('real', 'R3b ...both marked clinician_recorded, and the loss note exists', 'clinician_recorded,clinician_recorded|1', (
  (select string_agg(cause, ',' order by created_at) from public.lifecycle_events where patient_id = pg_temp.f('l')) || '|' ||
  (select count(*) from public.pregnancy_loss_records where patient_id = pg_temp.f('l') and source = 'clinician_recorded')::text));
select pg_temp.ck('real', 'R4 the patient can still confirm for herself', 'ok',
  pg_temp.state_as(pg_temp.f('l2'), $q$select public.record_lifecycle_event('pregnancy_confirmed')$q$));
-- (L2 was just confirmed by herself; reset it to tracking so the sabotage below starts from the same stage as R1)
delete from public.pregnancy_loss_records where patient_id = pg_temp.f('l2');
delete from public.patient_pregnancy where patient_id = pg_temp.f('l2');
delete from public.pregnancies where patient_id = pg_temp.f('l2');
delete from public.lifecycle_states where patient_id = pg_temp.f('l2');
create function pg_temp.prompt_as(p_uid uuid, p_pat uuid) returns text language plpgsql as
$f$ declare r text; v_preg uuid := (select id from public.pregnancies where patient_id = p_pat order by created_at limit 1);  -- looked up as the owner, so the function itself is what is tested
begin
  perform pg_temp.act(p_uid);
  begin r := ((public.antenatal_schedule_review_prompt(v_preg) ->> 'pregnancy_id') is not null)::text;
  exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
select pg_temp.ck('real', 'R5 antenatal_schedule_review_prompt for S: untied clinician, coordinator, view-as clinician and the patient are refused with 42501; the tied clinician gets the prompt',
  '42501|42501|42501|42501|true', pg_temp.prompt_as(pg_temp.f('c1'), pg_temp.f('s')) || '|' || pg_temp.prompt_as(pg_temp.f('co'), pg_temp.f('s')) || '|' ||
  pg_temp.prompt_as(pg_temp.f('cv'), pg_temp.f('s')) || '|' || pg_temp.prompt_as(pg_temp.f('s'), pg_temp.f('s')) || '|' || pg_temp.prompt_as(pg_temp.f('c2'), pg_temp.f('s')));
select pg_temp.ck('real', 'R6 no SECURITY DEFINER function that returns data (not a trigger) names one of the nine tables and still carries a plain is_org_staff arm', '', (
  select coalesce(string_agg(n.nspname || '.' || p.proname, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'analytics') and p.prokind = 'f' and p.prosecdef and p.prorettype <> 'trigger'::regtype
     and p.prosrc ~ 'is_org_staff'
     and p.prosrc ~* '\m(pregnancies|kick_counts|contractions|birth_plans|postnatal_baby_checks|breastfeeding_feed_log|lifecycle_states|lifecycle_events|pregnancy_loss_records)\M'
     and p.proname <> 'maternal_staff_may_read'));

-- F kill switches
update public.platform_modules set is_enabled = false where key = 'tied_staff_reads';
select pg_temp.ck('real', 'F1 with tied_staff_reads off an untied clinician reads the nine tables organisation-wide again (the old behaviour)', 'true',
  (pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false) <> '')::text);
select pg_temp.ck('real', 'F3 ...and the review prompt answers him again', 'true', pg_temp.prompt_as(pg_temp.f('c1'), pg_temp.f('s')));
update public.platform_modules set is_enabled = true where key = 'tied_staff_reads';
select pg_temp.ck('real', 'F2 and switching it back on closes them', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));
update public.platform_modules set is_enabled = false where key = 'tied_staff_writes';
select pg_temp.ck('real', 'F4 with tied_staff_writes off an untied clinician can write a feed again (the documented rollback path)', 'ok', pg_temp.state_as(pg_temp.f('c1'), pg_temp.ins('feed', pg_temp.f('s'), null)));
update public.platform_modules set is_enabled = true where key = 'tied_staff_writes';
select pg_temp.ck('real', 'F5 and switching it back on refuses him again', '42501', pg_temp.state_as(pg_temp.f('c1'), pg_temp.ins('feed', pg_temp.f('s'), null)));

-- G structure
select pg_temp.ck('real', 'G1 the nine are registered tied / reproductive_health', '9', (select count(*)::text from public.staff_read_scope where mode = 'tied' and category = 'reproductive_health' and table_name = any (pg_temp.tables())));
select pg_temp.ck('real', 'G2 no policy on the nine keeps a plain staff arm, the one-argument helper or a view-as arm', '', (
  select coalesce(string_agg(p.tablename || '.' || p.policyname, ', '), '') from pg_policies p
   where p.schemaname = 'public' and p.tablename = any (pg_temp.tables()) and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '(is_org_staff\(|pregnancy_staff_may_read\(|can_support_view)'));
select pg_temp.ck('real', 'G3 anon cannot execute the helpers or read the tables', 'false', (
  has_function_privilege('anon', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE') or has_function_privilege('anon', 'private.pregnancy_may_write(uuid,uuid)', 'EXECUTE')
  or has_function_privilege('anon', 'private.pregnancy_staff_may_read(uuid)', 'EXECUTE')
  or has_function_privilege('anon', 'public.record_lifecycle_event(text,date,uuid,integer,text,text)', 'EXECUTE')
  or has_function_privilege('anon', 'public.antenatal_schedule_review_prompt(uuid)', 'EXECUTE')
  or exists (select 1 from unnest(pg_temp.tables()) t where has_table_privilege('anon', 'public.' || t, 'SELECT')))::text);
select pg_temp.ck('real', 'G4 authenticated keeps execute on the helpers the policies call', 'true', (
  has_function_privilege('authenticated', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'private.pregnancy_may_write(uuid,uuid)', 'EXECUTE'))::text);
select pg_temp.ck('real', 'G5 the replaced policy text and all five old function bodies are saved for rollback, and no client role can read the function backup', 'true|5|false', (
  ((select count(*) from public.staff_read_policy_backup where table_name = any (pg_temp.tables())) >= 12)::text || '|' ||
  (select count(*) from public.staff_read_function_backup)::text || '|' ||
  (has_table_privilege('authenticated', 'public.staff_read_function_backup', 'SELECT') or has_table_privilege('anon', 'public.staff_read_function_backup', 'SELECT'))::text));
select pg_temp.ck('real', 'G6 the one-argument helper is neutralised: it is false even for the tied clinician, and no policy calls it', 'false|0', (
  pg_temp.helper_as(pg_temp.f('c2'), format($q$select private.pregnancy_staff_may_read(%L)::text$q$, pg_temp.f('org'))) || '|' ||
  (select count(*) from pg_policies p where p.schemaname = 'public' and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%pregnancy_staff_may_read%')::text));
select pg_temp.ck('real', 'G7 the changed helpers and the lifecycle function carry the reproductive_health category', 'true', (
  pg_get_functiondef('private.maternal_staff_may_read(uuid,uuid)'::regprocedure) like '%reproductive_health%'
  and pg_get_functiondef('private.pregnancy_may_write(uuid,uuid)'::regprocedure) like '%reproductive_health%'
  and pg_get_functiondef('public.record_lifecycle_event(text,date,uuid,integer,text,text)'::regprocedure) like '%reproductive_health%')::text);

-- SABOTAGE. Every step records what the check would have said with the fix reverted; it must differ from the real expectation.
select pg_temp.snap_all();
-- 1: the read helper back to the old plain staff check
do $$ begin
  create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid) returns boolean language sql stable security definer set search_path = '' as 'select private.is_org_staff(p_org)';
  insert into results values ('sabotaged', 'SAB1 read helper put back to is_org_staff: the untied clinician reads the nine tables', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));
  perform pg_temp.restore_all();
end $$;
-- 2: the read helper back to the first draft (staff_may_read admits view-as)
do $$ begin
  create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid) returns boolean language sql stable security definer set search_path = '' as
    $b$ select private.staff_may_read(p_patient, p_org, 'reproductive_health'::public.care_access_category) $b$;
  insert into results values ('sabotaged', 'SAB2 read helper put back to staff_may_read: the view-as clinician reads the nine tables', '', pg_temp.gaps(pg_temp.f('cv'), pg_temp.f('s'), '=', false));
  perform pg_temp.restore_all();
end $$;
-- 3: pregnancy_may_write staff arm back to organisation-wide
do $$ begin
  create or replace function private.pregnancy_may_write(p_patient uuid, p_org uuid) returns boolean language sql stable security definer set search_path = '' as
    $b$ select (p_patient = (select auth.uid()) and p_org = private.current_org_id()) or private.is_org_staff(p_org) $b$;
  insert into results values ('sabotaged', 'SAB3 pregnancy_may_write put back to is_org_staff: the untied clinician can insert a kick count', '42501',
    pg_temp.negatives(pg_temp.f('c1'), 'kick_counts'));
  perform pg_temp.restore_all();
end $$;
-- 4, 5, 6: the S68 write policies back to the old plain staff arm. An UPDATE also needs the row to be visible through the SELECT policy, so for 4 the read
-- helper is opened first (the old is_org_staff body): with the fixed UPDATE policy the untied clinician must STILL change 0 rows (the update policy is tied
-- on its own, a real check), and with the old UPDATE policy he changes rows (the sabotage).
do $$ begin
  create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid) returns boolean language sql stable security definer set search_path = '' as 'select private.is_org_staff(p_org)';
  insert into results values ('real', 'U1 with the read helper opened, the baby-check UPDATE policy alone still stops an untied clinician (0 rows)', '0',
    pg_temp.upd_as(pg_temp.f('c1'), format($q$update public.postnatal_baby_checks set concerns_noted = true where patient_id = %L$q$, pg_temp.f('t'))));
  perform pg_temp.set_pol('postnatal_baby_checks', 'postnatal_baby_checks_update',
    '(patient_id = (select auth.uid())) or private.is_org_staff(organisation_id)',
    '((patient_id = (select auth.uid())) and (organisation_id = private.current_org_id())) or private.is_org_staff(organisation_id)');
  insert into results values ('sabotaged', 'SAB4 baby-check UPDATE policy put back to is_org_staff: the untied clinician changes rows', '0',
    pg_temp.upd_as(pg_temp.f('c1'), format($q$update public.postnatal_baby_checks set concerns_noted = true where patient_id = %L$q$, pg_temp.f('t'))));
  perform pg_temp.restore_all();
  perform pg_temp.set_pol('postnatal_baby_checks', 'postnatal_baby_checks_insert', null,
    '((patient_id = (select auth.uid())) and (organisation_id = private.current_org_id())) or private.is_org_staff(organisation_id)');
  delete from public.postnatal_baby_checks where patient_id = pg_temp.f('t') and check_window = 'week_6';
  insert into results values ('sabotaged', 'SAB5 baby-check INSERT policy put back to is_org_staff: the untied clinician inserts a baby check', '42501',
    pg_temp.state_as(pg_temp.f('c1'), pg_temp.ins('baby_check', pg_temp.f('t'), null)));
  perform pg_temp.restore_all();
  perform pg_temp.set_pol('breastfeeding_feed_log', 'breastfeeding_feed_log_insert', null,
    '((patient_id = (select auth.uid())) and (organisation_id = private.current_org_id())) or private.is_org_staff(organisation_id)');
  insert into results values ('sabotaged', 'SAB6 feed-log INSERT policy put back to is_org_staff: the untied clinician inserts a feed', '42501',
    pg_temp.state_as(pg_temp.f('c1'), pg_temp.ins('feed', pg_temp.f('s'), null)));
  perform pg_temp.restore_all();
end $$;
-- 7, 8: the two SECURITY DEFINER functions back to their old bodies, taken from the function backup
do $$ begin
  execute (select definition from public.staff_read_function_backup where fn_signature like 'record_lifecycle_event(%' or fn_signature like 'public.record_lifecycle_event(%');
  insert into results values ('sabotaged', 'SAB7 record_lifecycle_event put back to its old body: an untied clinician records a pregnancy for L2', '42501',
    pg_temp.state_as(pg_temp.f('c1'), format($q$select public.record_lifecycle_event('pregnancy_confirmed', current_date, %L)$q$, pg_temp.f('l2'))));
  perform pg_temp.restore_all();
  execute (select definition from public.staff_read_function_backup where fn_signature like 'antenatal_schedule_review_prompt(%' or fn_signature like 'public.antenatal_schedule_review_prompt(%');
  insert into results values ('sabotaged', 'SAB8 antenatal_schedule_review_prompt put back to its old body: the untied clinician gets the prompt', '42501',
    pg_temp.prompt_as(pg_temp.f('c1'), pg_temp.f('s')));
  perform pg_temp.restore_all();
end $$;
-- 9: the COMPLETE documented rollback (every old body from the function backup, every old policy from the policy backup) must reopen the nine tables,
-- which proves the backups are complete; the new state is then re-applied from the snapshots
do $$
declare r record;
begin
  for r in select definition from public.staff_read_function_backup loop execute r.definition; end loop;
  for r in select * from public.staff_read_policy_backup where table_name = any (pg_temp.tables()) loop
    perform pg_temp.set_pol(r.table_name, r.policy_name, r.qual, r.with_check);
  end loop;
  insert into results values ('sabotaged', 'SAB9 complete rollback from the two backups: the untied clinician reads the nine tables again', '', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false));
  perform pg_temp.restore_all();
end $$;
-- after all the restores the real behaviour is back (a sabotage that left the fix broken would be caught here)
select pg_temp.ck('real', 'Z1 after every sabotage was undone the untied clinician reads zero again and the tied clinician reads S', '|', pg_temp.gaps(pg_temp.f('c1'), pg_temp.f('s'), '=', false) || '|' || pg_temp.gaps(pg_temp.f('c2'), pg_temp.f('s'), '=', true));

do $$
declare v_bad integer; v_caught integer; v_total integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S88 proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || left(coalesce(actual, 'null'), 600) || ']', E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*), count(*) filter (where expected <> actual) into v_total, v_caught from results where phase = 'sabotaged';
  if v_total <> 9 then raise exception 'VACUOUS TEST: expected 9 sabotage steps, found %', v_total; end if;
  if v_caught <> 9 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 9 checks (%)', v_caught, (select string_agg(check_name, ' | ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;

select phase, check_name, case when phase = 'sabotaged' then (case when expected <> actual then 'FLIPPED' else 'NOT FLIPPED' end) when expected = actual then 'PASS' else 'FAIL' end as result, left(actual, 160) as detail from results order by phase desc, check_name;

rollback;
