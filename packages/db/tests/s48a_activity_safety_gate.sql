-- S48a proof: activity safety gate, kinds/goals/events, workout plans, private routes (migration *_s48a_activity_safety_gate.sql).
--   a. the gate: 25 shared cases (ids C01..C26 are the same ids as packages/clinical/src/activity-gate.test.ts; activity-gate-parity.test.ts pins them),
--      the acceptance case (red event in the last 48 hours = rest), fail-closed with no config, shadow rows count, nothing for anon.
--   b. enforcement: programme enrolment refuses under rest and over-intense under restrict, including the re-activate-by-UPDATE path.
--   c. activity kinds, distance, the two v5 views, weekly progress, and the events through the outbox (once per period).
--   d. workout plans: starter set is unreviewed and inactive and invisible; a reviewed plan shows only when the gate and the plan's conditions allow.
--   e. private routes: guard off, switch off, owner-only read/insert/delete, no staff or other-patient read, no update.
--   f. config: signed by the CMO only; an invalid config cannot be stored.
-- One rolled-back transaction. is_test data only. SABOTAGE section at the end: the gate, the enrolment trigger and the route policy are each broken
-- once; the matching checks must flip (otherwise the test is vacuous).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    if p_sql ~* '^\s*select' then execute p_sql into r; else execute p_sql; r := null; end if;
  exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's48a-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S48a ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S48a ' || p_label, 'MDCN', 'S48A-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;

-- one case: a fresh patient with the given events / conditions / pregnancy; returns "decision|reason|reasons|max|blocked"
create function pg_temp.run_case(p_events jsonb, p_conds jsonb, p_preg jsonb, p_include_preg boolean default true) returns text
language plpgsql as $f$
declare v uuid; e jsonb; c jsonb; g jsonb; v_org uuid := pg_temp.f('org');
begin
  v := pg_temp.mkuser(v_org, 'case', 'patient');
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions, created_at, is_test)
    values (v_org, v, coalesce(e ->> 'type', 'observation'), gen_random_uuid(), e ->> 'grade', null, 'live_symptom_gate', 1, 'draft', true,
            case when e ->> 'grade' = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end,
            now() - ((e ->> 'hours')::numeric * interval '1 hour'), true);
  end loop;
  for c in select * from jsonb_array_elements(coalesce(p_conds, '[]'::jsonb)) loop
    insert into public.patient_conditions (organisation_id, patient_id, condition_name, icd10_code, status)
    values (v_org, v, c ->> 'name', c ->> 'icd10', coalesce(c ->> 'status', 'active')::public.condition_clinical_status);
  end loop;
  if p_preg is not null then
    insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant, high_risk)
    values (v_org, v, (p_preg ->> 'pregnant')::boolean, (p_preg ->> 'high_risk')::boolean);
  end if;
  g := private.activity_gate_for(v, p_include_preg, now());
  return (g ->> 'decision') || '|' || (g ->> 'reason') || '|' ||
    (select string_agg(x, ',' order by ord) from jsonb_array_elements_text(g -> 'reasons') with ordinality as t(x, ord)) || '|' ||
    (g ->> 'max_intensity') || '|' ||
    coalesce((select string_agg(x, ',' order by ord) from jsonb_array_elements_text(g -> 'blocked_kinds') with ordinality as t(x, ord)), '');
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('p', pg_temp.mkuser(v_org, 'patient', 'patient'));
  perform pg_temp.setf('q', pg_temp.mkuser(v_org, 'other', 'patient'));
  perform pg_temp.setf('red', pg_temp.mkuser(v_org, 'red', 'patient'));
  perform pg_temp.setf('amber', pg_temp.mkuser(v_org, 'amber', 'patient'));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'senior', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

-- a. the shared gate cases -------------------------------------------------------------------------------------------------------
do $$
declare
  v_pw text := 'allow|none|none|vigorous|';
begin
  perform pg_temp.ck('C01 nothing recorded: allow', v_pw, pg_temp.run_case(null, null, null));
  perform pg_temp.ck('C02 red 47h ago: rest', 'rest|recent_red_event|recent_red_event|none|', pg_temp.run_case('[{"grade":"red","hours":47}]', null, null));
  perform pg_temp.ck('C03 red 49h ago: allow', v_pw, pg_temp.run_case('[{"grade":"red","hours":49}]', null, null));
  perform pg_temp.ck('C04 amber 10h ago: gentle only', 'restrict|recent_amber_event|recent_amber_event|gentle|', pg_temp.run_case('[{"grade":"amber","hours":10}]', null, null));
  perform pg_temp.ck('C05 amber 49h ago: allow', v_pw, pg_temp.run_case('[{"grade":"amber","hours":49}]', null, null));
  perform pg_temp.ck('C06 a red event dated in the future is ignored', v_pw, pg_temp.run_case('[{"grade":"red","hours":-2}]', null, null));
  perform pg_temp.ck('C07 pregnancy', 'restrict|pregnancy|pregnancy|moderate|football', pg_temp.run_case(null, null, '{"pregnant":true,"high_risk":false}'));
  perform pg_temp.ck('C08 high-risk pregnancy', 'restrict|pregnancy_high_risk|pregnancy_high_risk|gentle|football,running', pg_temp.run_case(null, null, '{"pregnant":true,"high_risk":true}'));
  perform pg_temp.ck('C09 not pregnant: allow', v_pw, pg_temp.run_case(null, null, '{"pregnant":false,"high_risk":true}'));
  perform pg_temp.ck('C10 hypertension, settled: allow', v_pw, pg_temp.run_case(null, '[{"name":"Essential hypertension"}]', null));
  perform pg_temp.ck('C11 hypertension, uncontrolled', 'restrict|hypertension_unsettled|hypertension_unsettled|gentle|', pg_temp.run_case(null, '[{"name":"Essential hypertension","status":"uncontrolled"}]', null));
  perform pg_temp.ck('C12 hypertension + amber BP reading 5 days ago', 'restrict|hypertension_unsettled|hypertension_unsettled|gentle|', pg_temp.run_case('[{"grade":"amber","hours":120}]', '[{"name":"High blood pressure"}]', null));
  perform pg_temp.ck('C13 hypertension + red BP reading 5 days ago', 'restrict|hypertension_unsettled|hypertension_unsettled|gentle|', pg_temp.run_case('[{"grade":"red","hours":120}]', '[{"name":"Hypertension"}]', null));
  perform pg_temp.ck('C14 resolved hypertension: allow', v_pw, pg_temp.run_case(null, '[{"name":"Hypertension","status":"resolved"}]', null));
  perform pg_temp.ck('C15 arthritis by name, any case', 'restrict|arthritis|arthritis|moderate|football,running', pg_temp.run_case(null, '[{"name":"Rheumatoid ARTHRITIS"}]', null));
  perform pg_temp.ck('C16 back pain by ICD-10', 'restrict|back_pain|back_pain|moderate|farm_manual_work,football', pg_temp.run_case(null, '[{"name":"Chronic complaint","icd10":"M54.5"}]', null));
  perform pg_temp.ck('C17 pregnancy + arthritis + back pain combine', 'restrict|pregnancy|pregnancy,arthritis,back_pain|moderate|farm_manual_work,football,running',
    pg_temp.run_case(null, '[{"name":"Osteoarthritis"},{"name":"Lower back pain"}]', '{"pregnant":true,"high_risk":false}'));
  perform pg_temp.ck('C18 amber + high-risk pregnancy', 'restrict|recent_amber_event|recent_amber_event,pregnancy_high_risk|gentle|football,running',
    pg_temp.run_case('[{"grade":"amber","hours":5}]', null, '{"pregnant":true,"high_risk":true}'));
  perform pg_temp.ck('C19 red wins over everything', 'rest|recent_red_event|recent_red_event|none|',
    pg_temp.run_case('[{"grade":"red","hours":2}]', '[{"name":"Arthritis"}]', '{"pregnant":true,"high_risk":false}'));
  perform pg_temp.ck('C20 hypertension + amber BP reading 24h ago', 'restrict|recent_amber_event|recent_amber_event,hypertension_unsettled|gentle|',
    pg_temp.run_case('[{"grade":"amber","hours":24}]', '[{"name":"Hypertension"}]', null));
  perform pg_temp.ck('C21 an amber that is not an observation does not unsettle hypertension', v_pw,
    pg_temp.run_case('[{"grade":"amber","hours":120,"type":"symptom_report"}]', '[{"name":"Hypertension"}]', null));
  perform pg_temp.ck('C22 no pregnancy record: allow', v_pw, pg_temp.run_case(null, null, null));
  perform pg_temp.ck('C23 hypertension matched by ICD-10, uncontrolled', 'restrict|hypertension_unsettled|hypertension_unsettled|gentle|',
    pg_temp.run_case(null, '[{"name":"Unspecified","status":"uncontrolled","icd10":"I10"}]', null));
  perform pg_temp.ck('C26 red exactly 48h ago is still rest (the window is inclusive)', 'rest|recent_red_event|recent_red_event|none|', pg_temp.run_case('[{"grade":"red","hours":48}]', null, null));
  perform pg_temp.ck('pregnancy is not read when the caller is not entitled to it', v_pw, pg_temp.run_case(null, null, '{"pregnant":true,"high_risk":true}', false));
end $$;

do $$
declare v_cfg uuid;
begin
  select id into v_cfg from public.activity_safety_config where is_active;
  perform pg_temp.setf('cfg', v_cfg);
  -- C24: no active config fails closed
  update public.activity_safety_config set is_active = false where id = v_cfg;
  perform pg_temp.ck('C24 no active config: restrict, gentle, rules_unavailable', 'restrict|rules_unavailable|rules_unavailable|gentle|', pg_temp.run_case(null, null, null));
  update public.activity_safety_config set is_active = true where id = v_cfg;
  perform pg_temp.ck('the seeded config is unsigned (PROPOSED)', 'false', (select (approved_by is not null)::text from public.activity_safety_config where id = v_cfg));
end $$;

-- the public door
do $$
declare v_pregnant uuid; v_door jsonb;
begin
  v_pregnant := pg_temp.mkuser(pg_temp.f('org'), 'pregnant', 'patient');
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant, high_risk) values (pg_temp.f('org'), v_pregnant, true, true);
  insert into public.patient_conditions (organisation_id, patient_id, condition_name) values (pg_temp.f('org'), v_pregnant, 'Rheumatoid arthritis');
  v_door := pg_temp.q_as(v_pregnant, 'select public.activity_gate()::text')::jsonb;
  perform pg_temp.setf('pregnant', v_pregnant);
  perform pg_temp.ck('the public door still restricts for a pregnant person', 'restrict|gentle', (v_door ->> 'decision') || '|' || (v_door ->> 'max_intensity'));
  perform pg_temp.ck('...but names neither pregnancy nor a condition in the payload', 'health_condition|false',
    (v_door ->> 'reason') || '|' || (v_door::text ~* 'pregnan|arthrit|hypertens|back_pain')::text);
  perform pg_temp.ck('anon cannot call the gate', '42501', replace(pg_temp.q_anon('select public.activity_gate()::text'), 'ERR:', ''));
  perform pg_temp.ck('a client cannot call the unscoped gate', 'true', (pg_temp.q_as(pg_temp.f('p'), format('select private.activity_gate_for(%L)::text', pg_temp.f('q'))) like 'ERR:%')::text);
  perform pg_temp.ck('a client with no events is allowed', 'allow', pg_temp.q_as(pg_temp.f('p'), 'select (public.activity_gate())->>''decision'''));
end $$;

-- b. enforcement on enrolment -------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_red uuid := pg_temp.f('red'); v_amber uuid := pg_temp.f('amber'); v_walk uuid; v_mod uuid; v_enr uuid;
begin
  select id into v_walk from public.exercise_programmes where key = 'beginner_walking_4wk';
  select id into v_mod from public.exercise_programmes where key = 'weight_management_6wk';
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions, created_at, is_test)
  values (v_org, v_red, 'observation', gen_random_uuid(), 'red', null, 'live_symptom_gate', 1, 'draft', true, '[{"kind":"page_on_call"}]', now() - interval '30 hours', true),
         (v_org, v_amber, 'observation', gen_random_uuid(), 'amber', null, 'live_symptom_gate', 1, 'draft', true, '[]', now() - interval '5 hours', true);
  -- a readiness screen with no flags, so only the gate (not the older screen rule) decides the moderate case
  insert into public.exercise_readiness_screens (organisation_id, patient_id) values (v_org, v_amber), (v_org, v_red), (v_org, pg_temp.f('p'));

  perform pg_temp.ck('ACCEPTANCE: red event 30h ago, even a beginner walking programme is refused (rest guidance)', 'true',
    (pg_temp.q_as(v_red, format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, v_red, v_walk)) like '%paused for now%')::text);
  perform pg_temp.ck('amber: a gentle (beginner) programme is allowed', 'ok',
    coalesce(nullif(pg_temp.q_as(v_amber, format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, v_amber, v_walk)), ''), 'ok'));
  perform pg_temp.ck('amber: a moderate programme is refused', 'true',
    (pg_temp.q_as(v_amber, format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, v_amber, v_mod)) like '%gentler activity%')::text);
  perform pg_temp.ck('control: a patient with no events can start the moderate programme', 'ok',
    coalesce(nullif(pg_temp.q_as(pg_temp.f('p'), format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, pg_temp.f('p'), v_mod)), ''), 'ok'));
  perform pg_temp.ck('the refusal wording names no reading or condition', 'false',
    (pg_temp.q_as(v_red, format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, v_red, v_walk)) ~* 'pressure|pregnan|arthrit|red event')::text);

  -- the UPDATE path: an abandoned enrolment cannot be flipped back to active under rest
  insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id, status) values (v_org, v_red, v_walk, 'abandoned') returning id into v_enr;
  perform pg_temp.setf('enr', v_enr);
  perform pg_temp.ck('re-activating an abandoned enrolment under rest is refused', 'true',
    (pg_temp.q_as(v_red, format('update public.patient_exercise_enrollments set status = ''active'' where id = %L', v_enr)) like '%paused for now%')::text);
  -- pregnancy reaches the enrolment gate only for the patient (or staff the category path entitles); an untied staff member gets no pregnancy-driven answer
  insert into public.exercise_readiness_screens (organisation_id, patient_id) values (v_org, pg_temp.f('pregnant'));
  perform pg_temp.ck('a high-risk pregnant patient is held to gentle activity on their own enrolment', 'true',
    (pg_temp.q_as(pg_temp.f('pregnant'), format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, pg_temp.f('pregnant'), v_mod)) like '%gentler activity%')::text);
  perform pg_temp.ck('an untied staff member enrolling them is not told, and so cannot learn it from the refusal', 'ok',
    coalesce(nullif(pg_temp.q_as(pg_temp.f('doc'), format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, pg_temp.f('pregnant'), v_mod)), ''), 'ok'));
  -- moving an ACTIVE enrolment to another programme is gated too (the sibling of the re-activation hole)
  perform pg_temp.ck('changing the programme of an active enrolment is gated: a gentle-only patient cannot swap to a moderate programme', 'true',
    (pg_temp.q_as(v_amber, format('update public.patient_exercise_enrollments set programme_id = %L where patient_id = %L and status = ''active''', v_mod, v_amber)) like '%gentler activity%')::text);
  perform pg_temp.ck('abandoning or completing is never blocked', 'ok',
    coalesce(nullif(pg_temp.q_as(v_red, format('update public.patient_exercise_enrollments set status = ''completed'' where id = %L', v_enr)), ''), 'ok'));
end $$;

-- c. kinds, distance, views, progress, events ---------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q'); v_n integer; v_prog jsonb;
begin
  insert into public.patient_activity_goals (organisation_id, patient_id) values (v_org, v_p);
  perform pg_temp.ck('weekly goal defaults to the config figure', '150|7500', (select weekly_active_minutes_goal || '|' || daily_step_goal from public.patient_activity_goals where patient_id = v_p));
  insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes, distance_m, logged_on)
  values (v_org, v_p, 'workout', 'dancing', 60, null, (now() at time zone 'Africa/Lagos')::date);
  perform pg_temp.ck('a workout with a kind gets a readable name', 'Dancing', (select activity_name from public.activity_log_entries where patient_id = v_p));
  perform pg_temp.ck('a steps row cannot carry a kind', 'true',
    (pg_temp.q_as(v_p, format('insert into public.activity_log_entries (organisation_id, patient_id, entry_type, step_count, activity_kind) values (%L, %L, ''steps'', 100, ''walking'')', v_org, v_p)) like 'ERR:%')::text);
  perform pg_temp.ck('a steps row cannot carry a distance', 'true',
    (pg_temp.q_as(v_p, format('insert into public.activity_log_entries (organisation_id, patient_id, entry_type, step_count, distance_m, logged_on) values (%L, %L, ''steps'', 100, 5, current_date - 40)', v_org, v_p)) like 'ERR:%')::text);
  perform pg_temp.ck('activity.recorded emitted once for the workout', '1', (select count(*)::text from public.domain_events where event_type = 'activity.recorded' and patient_id = v_p));
  perform pg_temp.ck('no goal event yet (60 of 150 minutes)', '0', (select count(*)::text from public.domain_events where event_type = 'activity.goal_met' and patient_id = v_p));
  insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes, distance_m, logged_on)
  values (v_org, v_p, 'workout', 'walking', 95, 6000, (now() at time zone 'Africa/Lagos')::date);
  perform pg_temp.ck('weekly goal met event emitted at 155 minutes', '1', (select count(*)::text from public.domain_events where event_type = 'activity.goal_met' and patient_id = v_p and payload ->> 'goal_metric' = 'weekly_active_minutes'));
  insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes, logged_on)
  values (v_org, v_p, 'workout', 'chair_based', 10, (now() at time zone 'Africa/Lagos')::date);
  perform pg_temp.ck('...and not emitted twice in the same week', '1', (select count(*)::text from public.domain_events where event_type = 'activity.goal_met' and patient_id = v_p and payload ->> 'goal_metric' = 'weekly_active_minutes'));
  insert into public.activity_log_entries (organisation_id, patient_id, entry_type, step_count, logged_on)
  values (v_org, v_p, 'steps', 9000, (now() at time zone 'Africa/Lagos')::date);
  perform pg_temp.ck('daily step goal met event', '1', (select count(*)::text from public.domain_events where event_type = 'activity.goal_met' and patient_id = v_p and payload ->> 'goal_metric' = 'daily_steps'));
  update public.activity_log_entries set step_count = 9500 where patient_id = v_p and entry_type = 'steps';
  perform pg_temp.ck('a steps upsert does not repeat the daily goal event', '1', (select count(*)::text from public.domain_events where event_type = 'activity.goal_met' and patient_id = v_p and payload ->> 'goal_metric' = 'daily_steps'));
  perform pg_temp.ck('event payloads carry no clinical content', '0', (select count(*)::text from public.domain_events where patient_id = v_p and event_type like 'activity.%' and payload::text ~* 'pressure|pregnan|diagnos|condition'));

  v_prog := pg_temp.q_as(v_p, 'select public.activity_week_progress()::text')::jsonb;
  perform pg_temp.ck('week progress: minutes and steps', '165|9500|1', (v_prog ->> 'active_minutes') || '|' || (v_prog ->> 'steps') || '|' || (v_prog ->> 'days_step_goal_met'));
  perform pg_temp.ck('the owner sees their sessions through the view', '4', pg_temp.q_as(v_p, 'select count(*)::text from public.activity_sessions'));
  perform pg_temp.ck('another patient sees none', '0', pg_temp.q_as(v_q, format('select count(*)::text from public.activity_sessions where patient_id = %L', v_p)));
  perform pg_temp.ck('the sessions view has no route column', '0', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'activity_sessions' and column_name ilike '%route%'));
  perform pg_temp.ck('activity_goals view lists both metrics', '2', pg_temp.q_as(v_p, 'select count(*)::text from public.activity_goals'));
  perform pg_temp.ck('anon cannot read the views', 'true', (pg_temp.q_anon('select count(*)::text from public.activity_sessions') like 'ERR:%')::text);
end $$;

-- d. workout plans ------------------------------------------------------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.f('p'); v_red uuid := pg_temp.f('red'); v_amber uuid := pg_temp.f('amber'); v_doc uuid; v_org uuid := pg_temp.f('org'); v_arth uuid; v_err text;
begin
  perform pg_temp.ck('starter plans: all unreviewed and inactive', '3|0|0', (select format('%s|%s|%s', count(*), count(*) filter (where clinician_reviewed), count(*) filter (where is_active)) from public.workout_plans));
  perform pg_temp.ck('starter plans carry no audio', '0', (select count(*)::text from public.workout_plans where cardinality(audio_clip_ids) > 0));
  begin
    update public.workout_plans set is_active = true where code = 'starter_gentle_home_10';
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('a plan cannot go active while unreviewed', 'refused', v_err);
  perform pg_temp.ck('nothing is shown while every plan is unreviewed', '[]', pg_temp.q_as(v_p, 'select public.my_workout_plans()::text'));
  perform pg_temp.ck('a client cannot read the table directly', '0', pg_temp.q_as(v_p, 'select count(*)::text from public.workout_plans'));

  select id into v_doc from public.clinical_staff where profile_id = pg_temp.f('doc');
  update public.workout_plans set clinician_reviewed = true, reviewed_by = v_doc, reviewed_at = now(), is_active = true where code in ('starter_gentle_home_10', 'starter_moderate_home_20');
  perform pg_temp.ck('control: once reviewed, an unrestricted patient sees the gentle and the moderate plan', '2', (pg_temp.q_as(v_p, 'select jsonb_array_length(public.my_workout_plans())::text')));
  perform pg_temp.ck('amber: only the gentle plan', 'starter_gentle_home_10', pg_temp.q_as(v_amber, 'select (public.my_workout_plans()) -> 0 ->> ''code'''));
  perform pg_temp.ck('rest: no plan at all', '0', pg_temp.q_as(v_red, 'select jsonb_array_length(public.my_workout_plans())::text'));
  v_arth := pg_temp.mkuser(v_org, 'arth', 'patient');
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status) values (v_org, v_arth, 'Osteoarthritis', 'active');
  perform pg_temp.ck('arthritis: the moderate plan is hidden because it does not list arthritis as safe', '1', pg_temp.q_as(v_arth, 'select jsonb_array_length(public.my_workout_plans())::text'));
end $$;

-- e. private routes -----------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('p'); v_ins text;
begin
  v_ins := format('insert into public.activity_routes (organisation_id, patient_id, route_geojson) values (%L, %L, %L::jsonb)', v_org, v_p, '{"type":"LineString","coordinates":[[3.3,6.5],[3.4,6.6]]}');
  perform pg_temp.ck('guard born off: a route cannot be stored', 'true', (pg_temp.q_as(v_p, v_ins) like 'ERR:%')::text);
end $$;
-- the guard table has its own guard trigger; disabled for this test transaction only (rolled back)
alter table public.go_live_guards disable trigger go_live_guards_guard;
update public.go_live_guards set is_on = true, changed_at = now(), changed_by = pg_temp.f('doc'), change_note = 'S48a proof: rolled back' where key = 'private_route_recording';
alter table public.go_live_guards enable trigger go_live_guards_guard;
do $$
declare v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q'); v_doc uuid := pg_temp.f('doc'); v_ins text; v_rid uuid;
begin
  v_ins := format('insert into public.activity_routes (organisation_id, patient_id, route_geojson) values (%L, %L, %L::jsonb)', v_org, v_p, '{"type":"LineString","coordinates":[[3.3,6.5],[3.4,6.6]]}');
  perform pg_temp.ck('guard on but the person has not switched it on: refused', 'true', (pg_temp.q_as(v_p, v_ins) like 'ERR:%')::text);
  update public.patient_activity_goals set route_recording_enabled = true where patient_id = v_p;
  insert into public.patient_activity_goals (organisation_id, patient_id) values (v_org, v_q);
  insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes, logged_on)
    values (v_org, v_q, 'workout', 'walking', 10, current_date - 60);
  perform pg_temp.ck('staff cannot turn on someone else''s route switch', 'true',
    (pg_temp.q_as(v_doc, format('update public.patient_activity_goals set route_recording_enabled = true where patient_id = %L', v_q)) like '%Only the person themself%')::text);
  perform pg_temp.ck('guard on and switch on: the owner can store a route', 'ok', coalesce(nullif(pg_temp.q_as(v_p, v_ins), ''), 'ok'));
  perform pg_temp.ck('a patient cannot store a route for someone else', 'true',
    (pg_temp.q_as(v_p, format('insert into public.activity_routes (organisation_id, patient_id, route_geojson) values (%L, %L, ''{"type":"LineString"}''::jsonb)', v_org, v_q)) like 'ERR:%')::text);
  perform pg_temp.ck('a route cannot be linked to someone else''s activity entry', 'true',
    (pg_temp.q_as(v_p, format('insert into public.activity_routes (organisation_id, patient_id, activity_log_entry_id, route_geojson) values (%L, %L, %L, ''{"type":"LineString"}''::jsonb)', v_org, v_p,
      (select id from public.activity_log_entries where patient_id = v_q limit 1))) like 'ERR:%')::text);
  perform pg_temp.ck('the owner reads it', '1', pg_temp.q_as(v_p, 'select count(*)::text from public.activity_routes'));
  perform pg_temp.ck('another patient cannot read it', '0', pg_temp.q_as(v_q, 'select count(*)::text from public.activity_routes'));
  perform pg_temp.ck('a clinician in the same organisation cannot read it', '0', pg_temp.q_as(v_doc, 'select count(*)::text from public.activity_routes'));
  perform pg_temp.ck('an administrator cannot read it either', '0', pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.activity_routes'));
  perform pg_temp.ck('anon cannot read it', 'true', (pg_temp.q_anon('select count(*)::text from public.activity_routes') like 'ERR:%')::text);
  perform pg_temp.ck('a route cannot be edited', 'true', (pg_temp.q_as(v_p, 'update public.activity_routes set route_geojson = ''{}''::jsonb') like 'ERR:%')::text);
  perform pg_temp.ck('the policies are exactly the three owner policies', '3', (select count(*)::text from pg_policies where tablename = 'activity_routes'));
  perform pg_temp.ck('routes are not in the patient export', 'false', (select in_export::text from public.data_registry where table_name = 'activity_routes'));
  perform pg_temp.ck('the owner can delete their own route', 'ok', coalesce(nullif(pg_temp.q_as(v_p, 'delete from public.activity_routes'), ''), 'ok'));
  perform pg_temp.ck('...and it is gone', '0', (select count(*)::text from public.activity_routes));
end $$;

-- f. config signing and validity ------------------------------------------------------------------------------------------------------------
do $$
declare v_cfg uuid := pg_temp.f('cfg'); v_new uuid; v_err text;
begin
  perform pg_temp.ck('a senior doctor cannot sign', 'true', (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_activity_safety_config(%L)::text', v_cfg)) like '%only the active Chief Medical Officer%')::text);
  perform pg_temp.ck('a patient cannot sign', 'true', (pg_temp.q_as(pg_temp.f('p'), format('select public.sign_activity_safety_config(%L)::text', v_cfg)) like 'ERR:%')::text);
  perform pg_temp.ck('anon cannot sign', '42501', replace(pg_temp.q_anon(format('select public.sign_activity_safety_config(%L)::text', v_cfg)), 'ERR:', ''));
  perform pg_temp.ck('the CMO can sign', v_cfg::text, pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_activity_safety_config(%L)::text', v_cfg)));
  perform pg_temp.ck('signing records who and when', 'true', (select (approved_by is not null and approved_at is not null)::text from public.activity_safety_config where id = v_cfg));
  begin
    insert into public.activity_safety_config (version, config) values (99, '{"safety":{"lookback":{"red_hours":0,"amber_hours":1,"unsettled_bp_days":1},"rules":{},"kinds":{}},"goals":{}}');
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('a config with a zero window or missing rules cannot be stored', 'refused', v_err);
  -- a rule with no ceiling, a misspelt rule name, a missing condition_match and a blocked kind that does not exist must each be refused
  perform pg_temp.ck('a rule missing max_intensity is refused', 'false', private.activity_config_valid(
    (select config #- '{safety,rules,pregnancy,max_intensity}' from public.activity_safety_config where id = v_cfg))::text);
  perform pg_temp.ck('a misspelt rule name is refused', 'false', private.activity_config_valid(
    (select jsonb_set(config #- '{safety,rules,pregnancy_high_risk}', '{safety,rules,pregnancy_hi_risk}', config #> '{safety,rules,pregnancy_high_risk}') from public.activity_safety_config where id = v_cfg))::text);
  perform pg_temp.ck('a missing condition_match is refused', 'false', private.activity_config_valid(
    (select config #- '{safety,condition_match,arthritis}' from public.activity_safety_config where id = v_cfg))::text);
  perform pg_temp.ck('a blocked kind that is not a kind is refused', 'false', private.activity_config_valid(
    (select jsonb_set(config, '{safety,rules,amber,blocked_kinds}', '["snooker"]') from public.activity_safety_config where id = v_cfg))::text);
  perform pg_temp.ck('the seeded config is valid', 'true', private.activity_config_valid((select config from public.activity_safety_config where id = v_cfg))::text);
  begin
    insert into public.activity_safety_config (version, config)
    select 98, jsonb_set(config, '{safety,rules,amber,max_intensity}', '"extreme"') from public.activity_safety_config where id = v_cfg;
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('an unknown intensity cannot be stored', 'refused', v_err);
end $$;

-- g. SABOTAGE: break each safeguard once; the matching checks must flip -------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_red uuid := pg_temp.f('red');
begin
  -- (1) the enrolment trigger removed: a red-event patient can enrol in a vigorous programme
  drop trigger enforce_exercise_readiness_trg on public.patient_exercise_enrollments;
  insert into results values ('sabotaged', 'SABOTAGE: without the trigger a red-event patient can enrol', 'refused',
    case when pg_temp.q_as(v_red, format('insert into public.patient_exercise_enrollments (organisation_id, patient_id, programme_id) values (%L, %L, %L)', v_org, v_red, (select id from public.exercise_programmes where key = 'beginner_walking_4wk'))) like 'ERR:%' then 'refused' else 'accepted' end);
end $$;

do $$
begin
  -- (2) a gate that ignores red events
  create or replace function private.activity_gate_for(p_patient uuid, p_include_pregnancy boolean default true, p_now timestamptz default now())
  returns jsonb language sql stable as $g$ select '{"decision":"allow","reason":"none","reasons":["none"],"max_intensity":"vigorous","blocked_kinds":[]}'::jsonb $g$;
  insert into results values ('sabotaged', 'SABOTAGE: a gate that ignores red events lets the acceptance case through', 'rest', private.activity_gate_for(pg_temp.f('red'), true, now()) ->> 'decision');
end $$;

do $$
begin
  -- (3) a staff select policy on routes: a clinician can read an owner's route
  insert into public.activity_routes (organisation_id, patient_id, route_geojson) values (pg_temp.f('org'), pg_temp.f('q'), '{"type":"LineString"}');
  create policy sabotage_staff_read on public.activity_routes for select to authenticated using (private.is_org_staff(organisation_id));
  insert into results values ('sabotaged', 'SABOTAGE: a staff policy would expose routes', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.activity_routes'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S48a proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
