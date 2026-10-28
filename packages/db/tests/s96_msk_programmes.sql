-- S96 proof: the MSK pain programmes (back, neck, knee, hip) on the S63 therapy-programme engine.
-- Proves: the content and entry lists are DRAFT and nothing is approved, confirmed or switched on; every one of the 68 pain red flags refuses enrolment with
-- its own route and a missing answer refuses (fail closed); a test patient's week (activity safety gate first, at most 3 exercises, a difficulty rating, a
-- completion gate of different days, the free PEG plus a function goal at weeks 1, 4 and 8); a PEG rise beyond the PROPOSED threshold pauses the programme and
-- raises one review task a tied clinician can resume; "my pain got worse" RE-RUNS the red-flag screen: a positive pauses the plan and raises a clinical task
-- (hospital-now route stops it and runs the crisis path), a clear check records a step-down; the activity gate's rest and gentle-only answers; the events table
-- is own-read only (no staff, sponsor, admin or anon, no direct write) and registered in the data registry.
-- SABOTAGE: the exclusion check made to always pass, the task routing removed, the completion gate removed, and a staff policy added; each must flip its checks
-- (the file fails with VACUOUS TEST otherwise). Everything is rolled back. The S63 proof (s63_therapy_programmes.sql) still covers the engine itself.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
-- 'claimed', the error code, or the reason no task was given
create function pg_temp.next_outcome(p_uid uuid) returns text language sql as
$$ select coalesce(r ->> 'error', case when jsonb_typeof(r -> 'task') = 'object' then 'claimed' else r ->> 'reason' end)
     from (select pg_temp.next_as(p_uid) as r) x $$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's22-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S22 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S22 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.cnt(p_uid uuid, p_table text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.%I', p_table)) $$;
create function pg_temp.tcount(p_sql text) returns text language plpgsql as $f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.tasks_for(p_patient uuid, p_type text) returns text language sql as
$$ select count(*)::text from public.clinical_tasks where patient_id = p_patient and type = p_type $$;
create function pg_temp.audit_n(p_actor uuid, p_result text) returns integer language sql as
$$ select count(*)::integer from public.audit_log where actor_id = p_actor and action = 'staff.therapy_progress_read' and result = p_result $$;
-- answers for a list with every item clear, optionally with one item made positive
create function pg_temp.answers(p_code text, p_positive text default null) returns jsonb language plpgsql as
$f$ declare r record; a jsonb := '{}'::jsonb; v jsonb;
begin
  for r in select * from public.therapy_exclusion_rules where programme_code = p_code and list_version = (select coalesce(max(version) filter (where status = 'confirmed'), max(version)) from public.therapy_exclusion_list_versions where programme_code = p_code) loop
    if r.item_code = p_positive then
      v := case r.kind when 'yes_no' then 'true'::jsonb when 'score_at_least' then to_jsonb(r.threshold) else to_jsonb(r.threshold - 1) end;
    else
      v := case r.kind when 'yes_no' then 'false'::jsonb when 'score_at_least' then to_jsonb(r.threshold - 1) else to_jsonb(r.threshold) end;
    end if;
    a := a || jsonb_build_object(r.item_code, v);
  end loop;
  return a;
end $f$;
create function pg_temp.enrol_as(p_uid uuid, p_code text, p_answers jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.enrol_in_therapy_programme(p_code, p_answers); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.start_as(p_uid uuid, p_enrol uuid, p_ord integer, p_re jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.start_therapy_session(p_enrol, p_ord, p_re); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.done_as(p_uid uuid, p_enrol uuid, p_ord integer, p_scores jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.complete_therapy_session(p_enrol, p_ord, p_scores); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_coord uuid; v_cmo uuid; v_pat uuid; v_real uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('patB', pg_temp.mkuser(v_org, 'patB', 'patient'));
  perform pg_temp.setf('patC', pg_temp.mkuser(v_org, 'patC', 'patient'));
  perform pg_temp.setf('patD', pg_temp.mkuser(v_org, 'patD', 'patient'));
  perform pg_temp.setf('patE', pg_temp.mkuser(v_org, 'patE', 'patient'));
  v_real := pg_temp.mkuser(v_org, 'real', 'patient'); perform pg_temp.setf('real', v_real);
  update public.profiles set is_test = false where id = v_real;
  v_doc := pg_temp.mkdoc(v_org, 'doctied', 'senior_medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('doctied', v_doc);
  v_coord := pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', 'employed', '{}', v_admin); perform pg_temp.setf('coord', v_coord);
  perform pg_temp.setf('finance', pg_temp.mkuser(v_org, 'finance', 'finance'));
  perform pg_temp.setf('analyst', pg_temp.mkuser(v_org, 'analyst', 'analyst'));
  perform pg_temp.setf('corp', pg_temp.mkuser(v_org, 'corp', 'corporate_admin'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id) values (v_org, v_pat, v_doc, v_coord);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('docuntied', pg_temp.mkdoc(v_org, 'docuntied', 'senior_medical_officer', 'contracted', '{adult_general}', v_admin));
end $$;


-- extra patients for the sabotage blocks
do $$
declare v_org uuid := pg_temp.f('org');
begin
  perform pg_temp.setf('patF', pg_temp.mkuser(v_org, 'patF', 'patient'));
  perform pg_temp.setf('patG', pg_temp.mkuser(v_org, 'patG', 'patient'));
  perform pg_temp.setf('patH', pg_temp.mkuser(v_org, 'patH', 'patient'));
  perform pg_temp.setf('patI', pg_temp.mkuser(v_org, 'patI', 'patient'));
  perform pg_temp.setf('patJ', pg_temp.mkuser(v_org, 'patJ', 'patient'));
  perform pg_temp.setf('patK', pg_temp.mkuser(v_org, 'patK', 'patient'));
  perform pg_temp.setf('patL', pg_temp.mkuser(v_org, 'patL', 'patient'));
end $$;

-- S96 helpers ----------------------------------------------------------------------------------------------------------------
create function pg_temp.msk_start_as(p_uid uuid, p_enrol uuid, p_ord integer, p_re jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.start_msk_session(p_enrol, p_ord, p_re); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.msk_done_as(p_uid uuid, p_enrol uuid, p_ord integer, p_scores jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.complete_msk_session(p_enrol, p_ord, p_scores); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.rate_as(p_uid uuid, p_enrol uuid, p_ord integer, p_key text, p_rating integer) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.record_msk_exercise_rating(p_enrol, p_ord, p_key, p_rating); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.flare_as(p_uid uuid, p_enrol uuid, p_answers jsonb, p_pain integer default null) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.report_msk_flare_up(p_enrol, p_answers, p_pain); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
-- ratings on past days for a session, written as the table owner (the functions only record "today"), so a week can reach its required days
create function pg_temp.seed_days(p_enrol uuid, p_ord integer, p_n integer) returns void language sql as
$$ insert into public.therapy_msk_events (organisation_id, patient_id, enrolment_id, kind, ordinal, exercise_key, rating, event_date, is_test)
   select e.organisation_id, e.patient_id, e.id, 'difficulty', p_ord, 'walk', 3, (now() at time zone 'Africa/Lagos')::date - g, true
     from public.therapy_enrolments e, generate_series(1, p_n) g where e.id = p_enrol
   on conflict do nothing $$;
create function pg_temp.clean_start(p_uid uuid, p_code text) returns uuid language plpgsql as
$f$ declare o jsonb;
begin
  o := pg_temp.enrol_as(p_uid, p_code, pg_temp.answers(p_code));
  return (o ->> 'enrolment_id')::uuid;
end $f$;

create temp table orig_gate on commit drop as select pg_get_functiondef('private.activity_gate_for(uuid, boolean, timestamptz)'::regprocedure) as def;

-- 1. Seeds: draft content, draft lists, active config v2, guard off ---------------------------------------------------------------
do $$
declare c text;
begin
  foreach c in array array['pain_back', 'pain_neck', 'pain_knee', 'pain_hip'] loop
    perform pg_temp.ck(c || ' is a draft programme with eight sessions', '8',
      (select count(*)::text from public.therapy_programme_sessions s join public.therapy_programmes p on p.id = s.programme_id where p.code = c and p.status = 'draft'));
    perform pg_temp.ck(c || ' sessions each hold 1 to 3 exercises', '0',
      (select count(*)::text from public.therapy_programme_sessions s join public.therapy_programmes p on p.id = s.programme_id
        where p.code = c and (s.exercises is null or jsonb_array_length(s.exercises) not between 1 and 3)));
    perform pg_temp.ck(c || ' content is not approved', 'draft',
      (select v.review_state from public.therapy_programme_versions v join public.therapy_programmes p on p.id = v.programme_id and p.current_version = v.version where p.code = c));
    perform pg_temp.ck(c || ' list version 2 is an unconfirmed draft and the newest', 'draft:2',
      (select status || ':' || version from public.therapy_exclusion_list_versions where programme_code = c order by version desc limit 1));
  end loop;
  perform pg_temp.ck('config v2 is the one active config and carries the PEG instruments', 'peg_pain',
    (select config -> 'instruments' -> 'pain_back' ->> 0 from public.therapy_programme_config where is_active and version = 2));
  perform pg_temp.ck('the four pain versions carry the internal not-physiotherapist-reviewed marker, no other programme does', '4:0',
    (select count(*) filter (where p.code like 'pain\_%' and v.not_physiotherapist_reviewed)::text || ':' || count(*) filter (where p.code not like 'pain\_%' and v.not_physiotherapist_reviewed)::text
       from public.therapy_programme_versions v join public.therapy_programmes p on p.id = v.programme_id));
  perform pg_temp.ck('...and no physiotherapist review is recorded', '0', (select count(*)::text from public.therapy_programme_versions where physio_review_recorded_at is not null));
  perform pg_temp.ck('the six pain crisis items are non-paging and nothing else is', '6:0',
    (select count(*) filter (where non_paging and programme_code like 'pain\_%' and route = 'crisis')::text || ':' || count(*) filter (where non_paging and not (programme_code like 'pain\_%' and route = 'crisis'))::text from public.therapy_exclusion_rules));
  begin
    insert into public.therapy_exclusion_rules (programme_code, list_version, ordinal, item_code, question, kind, route, non_paging)
      values ('pain_back', 2, 99, 'bad_flag', 'q', 'yes_no', 'same_day_clinician', true);
    perform pg_temp.ck('a non-paging flag on a non-crisis rule is refused by the table', 'refused', 'inserted');
  exception when check_violation then
    perform pg_temp.ck('a non-paging flag on a non-crisis rule is refused by the table', 'refused', 'refused');
  end;
  perform pg_temp.ck('the pain guard is off', 'false', (select is_on::text from public.go_live_guards where key = 'therapy_pain_enabled'));
  perform pg_temp.ck('the pain guard is not open to a real patient', 'false', (private.go_live_open_patient('therapy_pain_enabled', pg_temp.f('real')))::text);
  perform pg_temp.ck('a real patient is told the pain programme is not open yet', 'not_open_yet',
    pg_temp.enrol_as(pg_temp.f('real'), 'pain_back', pg_temp.answers('pain_back')) ->> 'reason');
end $$;

-- 2. Entry screen: every pain item refuses on its own with its own route, unanswered refuses -----------------------------------------
do $$
declare r record; o jsonb; n integer := 0; ok integer := 0;
begin
  for r in select programme_code, item_code, route from public.therapy_exclusion_rules
            where programme_code like 'pain\_%' and list_version = 2 order by programme_code, ordinal loop
    n := n + 1;
    o := pg_temp.enrol_as(pg_temp.f('pat2'), r.programme_code, pg_temp.answers(r.programme_code, r.item_code));
    if (o ->> 'enrolled') = 'false' and (o ->> 'route') = r.route and (o -> 'stop_codes') = jsonb_build_array(r.item_code) then ok := ok + 1; end if;
  end loop;
  perform pg_temp.ck('every pain red flag refuses enrolment with its own route (' || n || ' items)', n::text, ok::text);
  perform pg_temp.ck('...and the pain item count is the seeded 68', '68', n::text);
  perform pg_temp.ck('back: saddle numbness is a same-day clinician route', 'same_day_clinician',
    (select route from public.therapy_exclusion_rules where programme_code = 'pain_back' and list_version = 2 and item_code = 'saddle_numbness'));
  perform pg_temp.ck('neck: chest or arm pain is the hospital-now route', 'crisis',
    (select route from public.therapy_exclusion_rules where programme_code = 'pain_neck' and list_version = 2 and item_code = 'chest_or_arm_pain_now'));
  perform pg_temp.ck('knee: calf pain or swelling (possible clot) is a same-day clinician route', 'same_day_clinician',
    (select route from public.therapy_exclusion_rules where programme_code = 'pain_knee' and list_version = 2 and item_code = 'calf_pain_or_swelling'));
  perform pg_temp.ck('hip: groin pain after a fall is a same-day clinician route', 'same_day_clinician',
    (select route from public.therapy_exclusion_rules where programme_code = 'pain_hip' and list_version = 2 and item_code = 'groin_pain_after_fall'));
  perform pg_temp.ck('a missing answer refuses (fail closed)', 'blocked',
    pg_temp.enrol_as(pg_temp.f('pat2'), 'pain_knee', pg_temp.answers('pain_knee') - 'fever') ->> 'state');
  perform pg_temp.ck('no pain question carries a phone number or helpline', '0',
    (select count(*)::text from public.therapy_exclusion_rules where programme_code like 'pain\_%' and question ~* '(help ?line|hotline|\d{5,})'));
end $$;

-- 3. A test patient's week: gate, exercises, ratings, completion gate, PEG checkpoint, worsening ------------------------------------
do $$
declare e uuid; s jsonb; r jsonb; pat uuid := pg_temp.f('pat');
begin
  e := pg_temp.clean_start(pat, 'pain_back'); perform pg_temp.setf('e_back', e);
  perform pg_temp.ck('a test account with clean answers enrols in the back programme', 'active', (select state from public.therapy_enrolments where id = e));
  s := pg_temp.msk_start_as(pat, e, 1, pg_temp.answers('pain_back'));
  perform pg_temp.ck('week 1 opens with draft content', 'ok:true', (s ->> 'status') || ':' || (s ->> 'draft_content'));
  perform pg_temp.ck('...the day has at most the configured 3 exercises', 'true', (jsonb_array_length(s -> 'exercises') between 1 and 3)::text);
  perform pg_temp.ck('...each exercise has steps, a dose and an alt-text drawing description', '0',
    (select count(*)::text from jsonb_array_elements(s -> 'exercises') x where jsonb_array_length(x -> 'steps') < 3 or coalesce(x ->> 'dose', '') = '' or coalesce(x ->> 'alt', '') = ''));
  perform pg_temp.ck('...the activity gate answer carries a decision and no reason (nothing names a condition)', 'true',
    ((s -> 'activity_gate') ? 'decision' and not (s -> 'activity_gate') ? 'reason' and not (s -> 'activity_gate') ? 'reasons')::text);
  perform pg_temp.ck('...it is a checkpoint with the four PEG and function goal instruments', 'peg_pain,peg_enjoyment,peg_activity,function_goal',
    (select string_agg(x, ',' order by ord) from jsonb_array_elements_text(s -> 'instruments') with ordinality as t(x, ord)));
  perform pg_temp.ck('a rating of 9 is out of range', 'true', (pg_temp.rate_as(pat, e, 1, 'walk', 9) ->> 'error' like '%out of range%')::text);
  perform pg_temp.ck('an exercise that is not in this week is refused', 'true', (pg_temp.rate_as(pat, e, 1, 'clamshell', 3) ->> 'error' like '%not in this session%')::text);
  perform pg_temp.ck('a rating is saved', 'ok', pg_temp.rate_as(pat, e, 1, 'walk', 5) ->> 'status');
  perform pg_temp.ck('...a second rating the same day replaces it (one row)', '1',
    (pg_temp.rate_as(pat, e, 1, 'walk', 4) is not null and (select count(*) from public.therapy_msk_events where enrolment_id = e and kind = 'difficulty' and exercise_key = 'walk' and ordinal = 1)::int = 1)::int::text);
  perform pg_temp.ck('the week cannot be finished after one day', 'not_enough_days', pg_temp.msk_done_as(pat, e, 1, '{"peg_pain":5,"peg_enjoyment":5,"peg_activity":5,"function_goal":5}') ->> 'status');
  perform pg_temp.seed_days(e, 1, 2);
  perform pg_temp.ck('...after three different days it can be (scores needed at a checkpoint)', 'true',
    (pg_temp.msk_done_as(pat, e, 1, null) ->> 'error' like '%scores are needed%')::text);
  perform pg_temp.ck('...an out-of-range PEG score is refused', 'true', (pg_temp.msk_done_as(pat, e, 1, '{"peg_pain":11,"peg_enjoyment":5,"peg_activity":5,"function_goal":5}') ->> 'error' like '%out of range%')::text);
  perform pg_temp.ck('...the old single pain score is an unknown instrument now', 'true', (pg_temp.msk_done_as(pat, e, 1, '{"pain_nrs":5}') ->> 'error' is not null)::text);
  perform pg_temp.ck('...good scores finish week 1', 'ok', pg_temp.msk_done_as(pat, e, 1, '{"peg_pain":5,"peg_enjoyment":5,"peg_activity":5,"function_goal":5}') ->> 'status');
  perform pg_temp.ck('...baseline is the first (pain) score', '5', (select baseline_score::text from public.therapy_enrolments where id = e));
  perform pg_temp.ck('a repeat completion is safe (already saved)', 'true', pg_temp.msk_done_as(pat, e, 1, '{"peg_pain":5,"peg_enjoyment":5,"peg_activity":5,"function_goal":5}') ->> 'already');
  -- weeks 2 and 3 are not checkpoints
  for i in 2..3 loop
    s := pg_temp.msk_start_as(pat, e, i, pg_temp.answers('pain_back'));
    perform pg_temp.ck('week ' || i || ' opens', 'ok', s ->> 'status');
    perform pg_temp.seed_days(e, i, 3);
    perform pg_temp.ck('week ' || i || ' finishes without scores', 'ok', pg_temp.msk_done_as(pat, e, i, null) ->> 'status');
  end loop;
  -- week 4: a rise of 2 on one PEG item beyond the baseline pauses the programme and raises one review task
  perform pg_temp.ck('week 4 opens', 'ok', pg_temp.msk_start_as(pat, e, 4, pg_temp.answers('pain_back')) ->> 'status');
  perform pg_temp.seed_days(e, 4, 3);
  r := pg_temp.msk_done_as(pat, e, 4, '{"peg_pain":5,"peg_enjoyment":5,"peg_activity":7,"function_goal":5}');
  perform pg_temp.ck('a PEG item up by 2 pauses the programme for review', 'true', r ->> 'paused_for_review');
  perform pg_temp.ck('...the enrolment is paused for review', 'paused:worsening_review', (select state || ':' || stop_reason from public.therapy_enrolments where id = e));
  perform pg_temp.ck('...one clinician review task exists (never only a notification)', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = pat and type = 'symptom_review' and dedup_key = 'therapy_worsening:' || e));
  perform pg_temp.ck('a tied clinician can resume it', 'ok', pg_temp.try_as(pg_temp.f('doctied'), format($q$select public.resume_therapy_enrolment(%L, 'reviewed with the patient today')$q$, e)));
  perform pg_temp.ck('...and it is active again', 'active', (select state from public.therapy_enrolments where id = e));
end $$;

-- 4. "My pain got worse" -------------------------------------------------------------------------------------------------------
do $$
declare e uuid; r jsonb; pat uuid := pg_temp.f('pat'); b uuid := pg_temp.f('patB'); eb uuid; c uuid := pg_temp.f('patC'); ec uuid;
begin
  e := (select id from public.therapy_enrolments where patient_id = pat and state = 'active');
  perform pg_temp.ck('pain now above 10 is refused', 'true', (pg_temp.flare_as(pat, e, pg_temp.answers('pain_back'), 11) ->> 'error' like '%0 to 10%')::text);
  perform pg_temp.ck('another patient cannot report a flare-up on this enrolment', 'true', (pg_temp.flare_as(pg_temp.f('pat2'), e, pg_temp.answers('pain_back')) ->> 'error' like '%not found%')::text);
  -- positive: pauses and raises a task
  r := pg_temp.flare_as(pat, e, pg_temp.answers('pain_back', 'saddle_numbness'), 8);
  perform pg_temp.ck('a positive re-check stops the plan with the same-day route', 'stopped:same_day_clinician', (r ->> 'status') || ':' || (r ->> 'route'));
  perform pg_temp.ck('...the plan is paused for a flare-up review', 'paused:flare_up_review', (select state || ':' || stop_reason from public.therapy_enrolments where id = e));
  perform pg_temp.ck('...a clinician task exists (never only a notification)', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = pat and type = 'symptom_review' and dedup_key = 'ts:' || md5(pat::text || ':pain_back:same_day_clinician')));
  perform pg_temp.ck('...the flare-up is recorded, with the pain level', 'stopped:8',
    (select outcome || ':' || pain_now from public.therapy_msk_events where enrolment_id = e and kind = 'flare_up' order by created_at desc limit 1));
  perform pg_temp.ck('...a paused plan opens no session', 'not_active', pg_temp.msk_start_as(pat, e, 5, pg_temp.answers('pain_back')) ->> 'status');
  r := pg_temp.flare_as(pat, e, pg_temp.answers('pain_back', 'fever'));
  perform pg_temp.ck('...a repeat report on the paused plan says the same thing (stopped, same route), not a bare not-active', 'stopped:same_day_clinician:true',
    (r ->> 'status') || ':' || (r ->> 'route') || ':' || (r ->> 'repeat'));
  perform pg_temp.ck('...and raised no second task', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = pat and type = 'symptom_review' and dedup_key = 'ts:' || md5(pat::text || ':pain_back:same_day_clinician')));
  perform pg_temp.ck('an untied clinician cannot resume it', 'true',
    (pg_temp.try_as(pg_temp.f('docuntied'), format($q$select public.resume_therapy_enrolment(%L, 'trying to resume it')$q$, e)) like '%not authorised%')::text);
  perform pg_temp.ck('a tied clinician resumes it', 'ok', pg_temp.try_as(pg_temp.f('doctied'), format($q$select public.resume_therapy_enrolment(%L, 'reviewed with the patient today')$q$, e)));
  -- clear: a recorded step-down
  r := pg_temp.flare_as(pat, e, pg_temp.answers('pain_back'), 6);
  perform pg_temp.ck('a clear re-check records a step-down for the configured days', ((now() at time zone 'Africa/Lagos')::date + 2)::text, r ->> 'until');
  perform pg_temp.ck('...a double tap within a few minutes returns the first step-down and records nothing more', ((now() at time zone 'Africa/Lagos')::date + 2)::text,
    pg_temp.flare_as(pat, e, pg_temp.answers('pain_back'), 6) ->> 'until');
  perform pg_temp.ck('...it is stored once', '1', (select count(*)::text from public.therapy_msk_events where enrolment_id = e and kind = 'step_down'));
  perform pg_temp.ck('...and the next session start reports it', ((now() at time zone 'Africa/Lagos')::date + 2)::text,
    pg_temp.msk_start_as(pat, e, 5, pg_temp.answers('pain_back')) -> 'step_down' ->> 'until');
  -- a missing answer is a positive
  ec := pg_temp.clean_start(c, 'pain_knee');
  r := pg_temp.flare_as(c, ec, pg_temp.answers('pain_knee') - 'cannot_weight_bear');
  perform pg_temp.ck('a missing answer fails closed: the plan is paused', 'stopped:paused', (r ->> 'status') || ':' || (select state from public.therapy_enrolments where id = ec));
  -- the hospital-now route ends the plan and runs the crisis path
  eb := pg_temp.clean_start(b, 'pain_neck');
  r := pg_temp.flare_as(b, eb, pg_temp.answers('pain_neck', 'chest_or_arm_pain_now'));
  perform pg_temp.ck('chest or arm pain on a flare-up is the hospital-now route', 'stopped:crisis', (r ->> 'status') || ':' || (r ->> 'route'));
  perform pg_temp.ck('...the plan is stopped', 'stopped_exclusion', (select state from public.therapy_enrolments where id = eb));
  perform pg_temp.ck('...the patient is told again on a retry (stopped, crisis route)', 'stopped:crisis', (pg_temp.flare_as(b, eb, pg_temp.answers('pain_neck', 'sudden_severe_headache')) ->> 'status') || ':' || (pg_temp.flare_as(b, eb, '{}'::jsonb) ->> 'route'));
  perform pg_temp.ck('...but it does NOT page the on-call clinician: no class 1 task', '0', pg_temp.tasks_for(b, 'red_event_unacknowledged'));
  perform pg_temp.ck('...no page was sent', '0', (select count(*)::text from public.audit_log where action = 'therapy.crisis_notified' and entity_id = b));
  perform pg_temp.ck('...a normal clinician task was raised instead', '1', pg_temp.tasks_for(b, 'symptom_review'));
  perform pg_temp.ck('...due in 90 minutes (the non-paging crisis window, not the 480 same-day one)', '90',
    (select (extract(epoch from (due_at - created_at)) / 60)::integer::text from public.clinical_tasks where patient_id = b and type = 'symptom_review' limit 1));
  perform pg_temp.ck('...and the patient is shown the hospital-now route', 'crisis', (select exclusion_result -> 'stops' -> 0 ->> 'route' from public.therapy_enrolments where id = eb));
end $$;

-- 4a. Server side: the S63 functions refuse the pain programmes; returned exercises obey the gate; unanswered warning sign; gate error audited -----
do $$
declare e uuid := pg_temp.f('e_back'); pat uuid := pg_temp.f('pat'); s jsonb; ej uuid; ep uuid; r jsonb; n_audit integer;
begin
  perform pg_temp.ck('the plain S63 start refuses a pain programme', 'true', (pg_temp.start_as(pat, e, 5, pg_temp.answers('pain_back')) ->> 'error' like '%pain programme path%')::text);
  perform pg_temp.ck('the plain S63 completion refuses a pain programme (no days-rule bypass)', 'true', (pg_temp.done_as(pat, e, 5, null) ->> 'error' like '%pain programme path%')::text);
  ep := pg_temp.clean_start(pg_temp.f('patE'), 'panic_breathing');
  s := pg_temp.start_as(pg_temp.f('patE'), ep, 1, pg_temp.answers('panic_breathing'));
  perform pg_temp.ck('the plain S63 start still works for other programmes (error text shown if not)', 'ok', coalesce(s ->> 'status', 'ERR: ' || coalesce(s ->> 'error', 'null')));
  -- a gentle-only gate: no moderate exercise is RETURNED
  create or replace function private.activity_gate_for(p_patient uuid, p_include_pregnancy boolean default true, p_now timestamptz default now())
  returns jsonb language sql stable as $f$ select '{"decision":"restrict","reason":"x","reasons":["x"],"max_intensity":"gentle","blocked_kinds":[]}'::jsonb $f$;
  s := pg_temp.msk_start_as(pat, e, 5, pg_temp.answers('pain_back'));
  perform pg_temp.ck('with a gentle-only gate the returned exercises are all gentle, and at least one (error text shown if the start failed)', 'true',
    case when s ->> 'status' = 'ok' then (jsonb_array_length(s -> 'exercises') >= 1 and not exists (select 1 from jsonb_array_elements(s -> 'exercises') x where x ->> 'intensity' <> 'gentle'))::text
         else 'ERR: ' || coalesce(s ->> 'error', s ->> 'status', 'null') end);
  -- a gate that raises: gentle only, and the failure is written to the audit log
  create or replace function private.activity_gate_for(p_patient uuid, p_include_pregnancy boolean default true, p_now timestamptz default now())
  returns jsonb language plpgsql stable as $f$ begin raise exception 'gate down'; end $f$;
  select count(*) into n_audit from public.audit_log where action = 'therapy_programme.error' and event ->> 'step' = 'activity_gate';
  s := pg_temp.msk_start_as(pat, e, 5, pg_temp.answers('pain_back'));
  perform pg_temp.ck('a gate error fails closed to gentle only (error text shown if the start failed)', 'restrict:gentle',
    coalesce((s -> 'activity_gate' ->> 'decision') || ':' || (s -> 'activity_gate' ->> 'max_intensity'), 'ERR: ' || coalesce(s ->> 'error', s ->> 'status', 'null')));
  perform pg_temp.ck('...and is written to the audit log', (n_audit + 1)::text,
    (select count(*)::text from public.audit_log where action = 'therapy_programme.error' and event ->> 'step' = 'activity_gate'));
  -- an unanswered non-paging warning sign behaves like a yes: stop, hospital-now route, 90 minute task, no page
  ej := pg_temp.clean_start(pg_temp.f('patK'), 'pain_neck');
  r := pg_temp.flare_as(pg_temp.f('patK'), ej, pg_temp.answers('pain_neck') - 'sudden_severe_headache');
  perform pg_temp.ck('an unanswered warning sign stops the plan on the hospital-now route', 'stopped:crisis', (r ->> 'status') || ':' || (r ->> 'route'));
  perform pg_temp.ck('...and does not page', '0', pg_temp.tasks_for(pg_temp.f('patK'), 'red_event_unacknowledged'));
  perform pg_temp.ck('...and raises the 90 minute task', '90',
    (select (extract(epoch from (due_at - created_at)) / 60)::integer::text from public.clinical_tasks where patient_id = pg_temp.f('patK') and type = 'symptom_review' limit 1));
  perform pg_temp.ck('...the stop records the flag from the rule row', 'true', (select (exclusion_result -> 'stops' -> 0 ->> 'non_paging') from public.therapy_enrolments where id = ej));
end $$;
-- the gate stubs above live in this rolled-back transaction; the real definition is put back for the sections below
do $$ begin execute (select def from orig_gate); end $$;

-- 4b. The mental-health crisis path is unchanged: it still pages ---------------------------------------------------------------
do $$
declare o jsonb;
begin
  o := pg_temp.enrol_as(pg_temp.f('patI'), 'low_mood', pg_temp.answers('low_mood', 'phq9_item9'));
  perform pg_temp.ck('PHQ-9 item 9 above zero is still a paging crisis stop', 'crisis', o ->> 'route');
  perform pg_temp.ck('...with its class 1 task', '1', pg_temp.tasks_for(pg_temp.f('patI'), 'red_event_unacknowledged'));
  perform pg_temp.ck('...and the page record', '1', (select count(*)::text from public.audit_log where action = 'therapy.crisis_notified' and entity_id = pg_temp.f('patI')));
end $$;

-- 5. Access: own rows only, no direct writes, no staff read -------------------------------------------------------------------------
do $$
declare who text;
begin
  perform pg_temp.ck('the patient reads their own events', 'true', (pg_temp.cnt(pg_temp.f('pat'), 'therapy_msk_events')::int > 0)::text);
  foreach who in array array['pat2', 'doctied', 'docuntied', 'coord', 'cmo', 'admin', 'finance', 'analyst', 'corp'] loop
    perform pg_temp.ck(who || ' cannot read the events of another patient', '0',
      pg_temp.q_as(pg_temp.f(who), format('select count(*)::text from public.therapy_msk_events where patient_id = %L', pg_temp.f('pat'))));
  end loop;
  perform pg_temp.ck('a patient cannot write an event directly', 'true',
    (pg_temp.try_as(pg_temp.f('pat'), format($q$insert into public.therapy_msk_events (organisation_id, patient_id, enrolment_id, kind, step_down_until) values (%L, %L, %L, 'step_down', current_date)$q$,
      pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('e_back'))) like 'permission denied%')::text);
  perform pg_temp.ck('anon cannot read them', '42501', pg_temp.try_anon('select 1 from public.therapy_msk_events limit 1'));
  perform pg_temp.ck('anon cannot call the pain functions', '42501', pg_temp.try_anon($q$select public.report_msk_flare_up(gen_random_uuid(), '{}'::jsonb)$q$));
  perform pg_temp.ck('a non-pain enrolment cannot take a rating', 'true',
    (pg_temp.rate_as(pg_temp.f('patE'), (pg_temp.enrol_as(pg_temp.f('patE'), 'panic_breathing', pg_temp.answers('panic_breathing')) ->> 'enrolment_id')::uuid, 1, 'walk', 3) ->> 'error' like '%not a pain programme%')::text);
  perform pg_temp.ck('the table is in the data registry', '1', (select count(*)::text from public.data_registry where table_name = 'therapy_msk_events'));
end $$;

-- 6. The activity safety gate decides what the day shows (the gate function is replaced inside this rolled-back transaction) --------------
create or replace function private.activity_gate_for(p_patient uuid, p_include_pregnancy boolean default true, p_now timestamptz default now())
returns jsonb language sql stable as $$ select '{"decision":"rest","reason":"recent_red_event","reasons":["recent_red_event"],"max_intensity":"none","blocked_kinds":[]}'::jsonb $$;
do $$
declare e uuid := pg_temp.f('e_back'); s jsonb; n_before integer; n_after integer;
begin
  select count(*) into n_before from public.therapy_session_progress where enrolment_id = e;
  s := pg_temp.msk_start_as(pg_temp.f('pat'), e, 5, pg_temp.answers('pain_back'));
  select count(*) into n_after from public.therapy_session_progress where enrolment_id = e;
  perform pg_temp.ck('a red triage event in the last 48 hours means rest: no session opens', 'activity_rest', s ->> 'status');
  perform pg_temp.ck('...nothing is counted, and no reason is returned', 'true', (n_before = n_after and not (s -> 'activity_gate') ? 'reason')::text);
end $$;
create or replace function private.activity_gate_for(p_patient uuid, p_include_pregnancy boolean default true, p_now timestamptz default now())
returns jsonb language sql stable as $$ select '{"decision":"restrict","reason":"pregnancy","reasons":["pregnancy"],"max_intensity":"gentle","blocked_kinds":[]}'::jsonb $$;
do $$
declare s jsonb;
begin
  s := pg_temp.msk_start_as(pg_temp.f('pat'), pg_temp.f('e_back'), 5, pg_temp.answers('pain_back'));
  perform pg_temp.ck('a gentle-only gate still opens the week and passes the ceiling to the screen', 'ok:restrict:gentle',
    (s ->> 'status') || ':' || (s -> 'activity_gate' ->> 'decision') || ':' || (s -> 'activity_gate' ->> 'max_intensity'));
  perform pg_temp.ck('...and does not name the reason (pregnancy) in the answer', 'false', (s::text like '%pregnan%')::text);
end $$;
do $$ begin execute (select def from orig_gate); end $$;

-- 7. SABOTAGE: each protection removed must flip its checks ---------------------------------------------------------------------------
create temp table orig_defs on commit drop as
  select p.proname::text as name, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'private' and p.proname in ('therapy_evaluate_screen', 'therapy_route_stop')) or (n.nspname = 'public' and p.proname = 'complete_msk_session');

-- (a) the exclusion check made to always pass: a flare-up with saddle numbness must no longer pause the plan
create or replace function private.therapy_evaluate_screen(p_code text, p_answers jsonb, p_list_version integer default null)
returns jsonb language sql stable as $$ select jsonb_build_object('passed', true, 'route', null, 'stops', '[]'::jsonb, 'no_rules', false, 'list_version', 2) $$;
do $$
declare ef uuid; r jsonb;
begin
  ef := pg_temp.clean_start(pg_temp.f('patF'), 'pain_hip');
  r := pg_temp.flare_as(pg_temp.f('patF'), ef, pg_temp.answers('pain_hip', 'cannot_weight_bear'));
  perform pg_temp.sab('a flare-up with a red flag pauses the plan', 'stopped', r ->> 'status');
  perform pg_temp.sab('...and leaves it paused', 'paused', (select state from public.therapy_enrolments where id = ef));
end $$;
do $$ begin execute (select def from orig_defs where name = 'therapy_evaluate_screen'); end $$;

-- (b) the pause/task routing removed: a positive flare-up must no longer raise a clinician task
create or replace function private.therapy_route_stop(p_enrolment uuid, p_screen jsonb) returns jsonb language sql as $$ select jsonb_build_object('route', p_screen ->> 'route', 'task_failed', false) $$;
do $$
declare eg uuid; r jsonb;
begin
  eg := pg_temp.clean_start(pg_temp.f('patG'), 'pain_hip');
  r := pg_temp.flare_as(pg_temp.f('patG'), eg, pg_temp.answers('pain_hip', 'groin_pain_after_fall'));
  perform pg_temp.sab('a positive flare-up raises a clinician task', '1', pg_temp.tasks_for(pg_temp.f('patG'), 'symptom_review'));
end $$;
do $$ begin execute (select def from orig_defs where name = 'therapy_route_stop'); end $$;

-- (e) the non-paging branch removed: a hospital-now warning sign on a flare-up would page the on-call clinician again
create or replace function private.therapy_route_stop(p_enrolment uuid, p_screen jsonb) returns jsonb language plpgsql as
$$ begin
  if p_screen ->> 'route' = 'crisis' then perform private.therapy_raise_crisis(p_enrolment); end if;
  return jsonb_build_object('route', p_screen ->> 'route', 'task_failed', false);
end $$;
do $$
declare ej uuid;
begin
  ej := pg_temp.clean_start(pg_temp.f('patJ'), 'pain_neck');
  perform pg_temp.flare_as(pg_temp.f('patJ'), ej, pg_temp.answers('pain_neck', 'sudden_severe_headache'));
  perform pg_temp.sab('a hospital-now warning sign does not page the on-call clinician', '0', pg_temp.tasks_for(pg_temp.f('patJ'), 'red_event_unacknowledged'));
end $$;
do $$ begin execute (select def from orig_defs where name = 'therapy_route_stop'); end $$;

-- (f) the 90 minute window removed: the warning-sign task falls back to the 480 minute same-day window
update public.therapy_programme_config set config = config #- '{route_due_minutes,crisis_non_paging}' where is_active;
do $$
declare ek uuid;
begin
  ek := pg_temp.clean_start(pg_temp.f('patL'), 'pain_knee');
  perform pg_temp.flare_as(pg_temp.f('patL'), ek, pg_temp.answers('pain_knee', 'breathless_with_leg_pain'));
  perform pg_temp.sab('the warning-sign task is due in 90 minutes', '90',
    (select (extract(epoch from (due_at - created_at)) / 60)::integer::text from public.clinical_tasks where patient_id = pg_temp.f('patL') and type = 'symptom_review' limit 1));
end $$;
update public.therapy_programme_config set config = jsonb_set(config, '{route_due_minutes,crisis_non_paging}', '90') where is_active;

-- (g) the direct-path refusal removed: the plain S63 completion would finish a pain week with no days rule
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.complete_therapy_session(uuid, integer, jsonb)'::regprocedure);
  execute replace(v_def, $q$'tarragon.msk_path', true), '') <> 'on'$q$, $q$'tarragon.msk_path', true), '') = 'zzz'$q$);
end $$;
do $$ begin
  perform pg_temp.sab('the plain completion refuses a pain programme', 'true', (pg_temp.done_as(pg_temp.f('pat'), pg_temp.f('e_back'), 5, null) ->> 'error' like '%pain programme path%')::text);
end $$;

-- (c) the completion gate removed: a week must no longer finish with one rated day
create or replace function public.complete_msk_session(p_enrolment uuid, p_ordinal integer, p_scores jsonb default null)
returns jsonb language sql security definer set search_path = '' as $$ select public.complete_therapy_session(p_enrolment, p_ordinal, p_scores) $$;
do $$
declare eh uuid; r jsonb;
begin
  eh := pg_temp.clean_start(pg_temp.f('patH'), 'pain_knee');
  perform pg_temp.msk_start_as(pg_temp.f('patH'), eh, 1, pg_temp.answers('pain_knee'));
  perform pg_temp.rate_as(pg_temp.f('patH'), eh, 1, 'walk', 3);
  r := pg_temp.msk_done_as(pg_temp.f('patH'), eh, 1, '{"peg_pain":4,"peg_enjoyment":4,"peg_activity":4,"function_goal":4}');
  perform pg_temp.sab('a week cannot finish after one rated day', 'not_enough_days', r ->> 'status');
end $$;
do $$ begin execute (select def from orig_defs where name = 'complete_msk_session'); end $$;

-- (d) a staff policy added: an untied clinician must no longer be blind to the events
create policy therapy_msk_sabotage on public.therapy_msk_events for select to authenticated using (true);
grant select on public.therapy_msk_events to authenticated;
do $$
begin
  perform pg_temp.sab('an untied clinician reads no events', '0', pg_temp.cnt(pg_temp.f('docuntied'), 'therapy_msk_events'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S96 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 8 then raise exception 'VACUOUS TEST: the sabotage flipped % of 9 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
