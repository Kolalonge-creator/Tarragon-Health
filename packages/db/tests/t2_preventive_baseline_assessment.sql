-- Tarragon Health: the baseline assessment step of a new Member produces their plan and a doctor review task (20261104233740).
--
--  1. a Free patient is refused (a doctor reviews the plan; Free uses no doctor time);
--  2. a Member with items missing is refused, and told which (codes only);
--  3. with the items present the Member submits: one baseline row, the scheduler's result, the plan snapshot, one preventive_plan_review
--     task for a doctor; a second submit makes no second row or task;
--  4. my_preventive_baseline shows the state, the items and the plan; the row holds codes and true/false, no values;
--  5. RLS: another patient sees nothing; nobody writes the table directly;
--  6. review: a coordinator and an untied doctor are refused; "adjusted" needs a note; a tied doctor authorises once;
--  7. the decision closes the review task: an unclaimed one is cancelled with the reason, one the doctor claimed is completed.
-- Sabotage (rolled-back sub-blocks): the Members-only check removed -> check 1 flips; a coordinator admitted to review -> check 6 flips;
-- the task-closing call removed -> check 7 flips.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/t2_preventive_baseline_assessment.sql

begin;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := sqlstate || ':' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 't2bl-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = p_role::public.user_role, full_name = 'T2bl ' || p_label, is_test = true, is_active = true,
         date_of_birth = '1972-06-01', sex = 'male' where id = v;
  return v;
end $f$;

do $proof$
declare
  v_org uuid; v_member uuid; v_free uuid; v_other uuid; v_doc uuid; v_doc2 uuid; v_coord uuid; v_admin uuid;
  r text; j jsonb; v_bid uuid; v_n integer; v_m2 uuid; v_bid2 uuid; v_task uuid; v_task2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_member := pg_temp.mkuser(v_org, 'member', 'patient');
  v_free := pg_temp.mkuser(v_org, 'free', 'patient');
  v_other := pg_temp.mkuser(v_org, 'other', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_doc2 := pg_temp.mkuser(v_org, 'doc2', 'clinician');
  v_coord := pg_temp.mkuser(v_org, 'coord', 'care_coordinator');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
  values (v_org, v_doc, 'T2bl Doctor', 'MDCN', 'T2BL-DOC-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true),
         (v_org, v_doc2, 'T2bl Doctor Two', 'MDCN', 'T2BL-DOC-2', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true),
         (v_org, v_coord, 'T2bl Coordinator', 'NMCN', 'T2BL-CC-1', true, 'active', now(), v_admin, 'care_coordinator', 'employed', 1, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id) values (v_org, v_member, v_doc, v_coord);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test)
  values (v_org, v_member, 'purchase', 'active', now() - interval '1 day', true);

  -- 1. Free refused
  r := pg_temp.as_user(v_free, 'select public.submit_my_preventive_baseline()::text');
  if r not like 'P0001:members_only%' then raise exception 'FAIL 1: a Free patient was not refused: %', r; end if;

  -- 2. items missing
  r := pg_temp.as_user(v_member, 'select public.submit_my_preventive_baseline()::text');
  if r not like 'P0001:baseline_incomplete: risk_questionnaire,blood_pressure,weight,height,waist%' then raise exception 'FAIL 2: %', r; end if;

  -- 3. items present, submit
  insert into public.prevention_risk_scores (organisation_id, profile_id, condition, tier) values (v_org, v_member, 'hypertension', 'low');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic) values (v_org, v_member, 'blood_pressure', 128, 82);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_member, 'weight', 82.5);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, waist_cm) values (v_org, v_member, 'waist_circumference', 96);
  update public.profiles set height_cm = 176 where id = v_member;
  r := pg_temp.as_user(v_member, 'select public.submit_my_preventive_baseline()::text');
  if r not like '{%' then raise exception 'FAIL 3: the Member could not submit: %', r; end if;
  j := r::jsonb; v_bid := (j ->> 'baseline_id')::uuid;
  if (j ->> 'already_submitted')::boolean or j ->> 'task_id' is null or j -> 'scheduler' is null then raise exception 'FAIL 3: unexpected result %', j; end if;
  if not exists (select 1 from public.clinical_tasks t join public.preventive_baselines b on b.review_task_id = t.id
                  where b.id = v_bid and t.type = 'preventive_plan_review' and t.min_tier = 'senior_medical_officer' and t.patient_id = v_member) then
    raise exception 'FAIL 3: no doctor review task';
  end if;
  r := pg_temp.as_user(v_member, 'select public.submit_my_preventive_baseline()::text');
  if not (r::jsonb ->> 'already_submitted')::boolean then raise exception 'FAIL 3: a second submit was not recognised'; end if;
  select count(*) into v_n from public.clinical_tasks where patient_id = v_member and type = 'preventive_plan_review';
  if v_n <> 1 or (select count(*) from public.preventive_baselines where patient_id = v_member) <> 1 then raise exception 'FAIL 3: a duplicate row or task'; end if;

  -- 4. the patient's view; codes only in the row
  r := pg_temp.as_user(v_member, 'select public.my_preventive_baseline()::text');
  j := r::jsonb;
  if not (j ->> 'eligible')::boolean or j -> 'baseline' ->> 'state' <> 'submitted' or jsonb_typeof(j -> 'plan') <> 'array'
     or exists (select 1 from jsonb_array_elements(j -> 'items') i where (i ->> 'required')::boolean and not (i ->> 'done')::boolean) then
    raise exception 'FAIL 4: the patient view is wrong: %', j;
  end if;
  if (select items::text from public.preventive_baselines where id = v_bid) ~ '(128|82\.5|96|176)' then raise exception 'FAIL 4: a clinical value was copied into the step record'; end if;

  -- 5. RLS
  r := pg_temp.as_user(v_other, 'select count(*)::text from public.preventive_baselines');
  if r <> '0' then raise exception 'FAIL 5: another patient sees % baseline rows', r; end if;
  r := pg_temp.as_user(v_member, format('update public.preventive_baselines set state = %L where id = %L returning id::text', 'authorised', v_bid));
  if r not like '42501:%' then raise exception 'FAIL 5: the patient wrote the table directly: %', r; end if;

  -- 6. review
  r := pg_temp.as_user(v_coord, format('select public.review_preventive_plan(%L, %L, null)::text', v_bid, 'authorised'));
  if r not like '42501:%' then raise exception 'FAIL 6: a coordinator reviewed the plan: %', r; end if;
  r := pg_temp.as_user(v_doc2, format('select public.review_preventive_plan(%L, %L, null)::text', v_bid, 'authorised'));
  if r not like '42501:%' then raise exception 'FAIL 6: an untied doctor reviewed the plan: %', r; end if;
  r := pg_temp.as_user(v_doc2, format('select public.clinician_preventive_baseline(%L)::text', v_member));
  if r not like '42501:%' then raise exception 'FAIL 6: an untied doctor read the plan: %', r; end if;
  r := pg_temp.as_user(v_doc, format('select public.review_preventive_plan(%L, %L, %L)::text', v_bid, 'adjusted', 'short'));
  if r not like '22023:note_required%' then raise exception 'FAIL 6: adjusted without a real note was accepted: %', r; end if;
  r := pg_temp.as_user(v_doc, format('select public.clinician_preventive_baseline(%L)::text', v_member));
  if (r::jsonb -> 'baseline' ->> 'id')::uuid <> v_bid then raise exception 'FAIL 6: the tied doctor could not read the plan: %', r; end if;
  r := pg_temp.as_user(v_doc, format('select public.review_preventive_plan(%L, %L, null)::text', v_bid, 'authorised'));
  if r <> v_bid::text then raise exception 'FAIL 6: the tied doctor could not authorise: %', r; end if;
  if (select state from public.preventive_baselines where id = v_bid) <> 'authorised'
     or (select reviewed_by from public.preventive_baselines where id = v_bid) <> (select id from public.clinical_staff where profile_id = v_doc) then
    raise exception 'FAIL 6: the decision was not recorded against the doctor';
  end if;
  r := pg_temp.as_user(v_doc, format('select public.review_preventive_plan(%L, %L, null)::text', v_bid, 'authorised'));
  if r not like '22023:already_reviewed%' then raise exception 'FAIL 6: a plan was reviewed twice: %', r; end if;

  -- 7. the decision closes the review task in the same transaction: an unclaimed task is cancelled with the reason
  select review_task_id into v_task from public.preventive_baselines where id = v_bid;
  if (select state::text from public.clinical_tasks where id = v_task) <> 'cancelled'
     or not exists (select 1 from public.clinical_task_transitions tr where tr.task_id = v_task and tr.to_state = 'cancelled'
                     and tr.reason like 'The preventive plan was authorised%') then
    raise exception 'FAIL 7: the unclaimed review task was not closed by the decision (state %)', (select state from public.clinical_tasks where id = v_task);
  end if;

  -- 7b. a task the deciding doctor has claimed is completed (claim ended, completion audited)
  v_m2 := pg_temp.mkuser(v_org, 'member2', 'patient');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_m2, v_doc);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test)
  values (v_org, v_m2, 'purchase', 'active', now() - interval '1 day', true);
  insert into public.prevention_risk_scores (organisation_id, profile_id, condition, tier) values (v_org, v_m2, 'hypertension', 'low');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic) values (v_org, v_m2, 'blood_pressure', 124, 80);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_m2, 'weight', 70);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, waist_cm) values (v_org, v_m2, 'waist_circumference', 84);
  update public.profiles set height_cm = 170 where id = v_m2;
  r := pg_temp.as_user(v_m2, 'select public.submit_my_preventive_baseline()::text');
  v_bid2 := (r::jsonb ->> 'baseline_id')::uuid; v_task2 := (r::jsonb ->> 'task_id')::uuid;
  if v_task2 is null then raise exception 'FAIL 7b: no task for the second Member: %', r; end if;
  insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, is_test)
  values (v_org, v_task2, v_doc, now(), now() + interval '30 minutes', true);
  perform private.apply_task_transition(v_task2, 'claimed', 'clinician', v_doc, null, v_doc, now() + interval '30 minutes');
  r := pg_temp.as_user(v_doc, format('select public.review_preventive_plan(%L, %L, %L)::text', v_bid2, 'adjusted', 'Lipid profile moved to after the fasting week.'));
  if r <> v_bid2::text then raise exception 'FAIL 7b: the doctor could not record an adjusted plan: %', r; end if;
  if (select state::text from public.clinical_tasks where id = v_task2) <> 'completed'
     or exists (select 1 from public.task_claims where task_id = v_task2 and ended_at is null)
     or not exists (select 1 from public.audit_log where action = 'queue.complete' and entity_id = v_task2) then
    raise exception 'FAIL 7b: the claimed review task was not completed by the decision';
  end if;

  -- SABOTAGE A: no Members-only check -> a Free patient gets a doctor task
  begin
    execute replace(pg_get_functiondef('public.submit_my_preventive_baseline()'::regprocedure),
                    'if not private.patient_is_member(v_uid) then', 'if false then');
    r := pg_temp.as_user(v_free, 'select public.submit_my_preventive_baseline()::text');
    if r like 'P0001:members_only%' then raise exception 'VACUOUS A: the Members-only rule is not tested'; end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;

  -- SABOTAGE B: a coordinator admitted to review -> check 6 must flip
  begin
    execute replace(pg_get_functiondef('public.review_preventive_plan(uuid,text,text)'::regprocedure),
                    'cs.doctor_tier in (''senior_medical_officer'', ''chief_medical_officer'')', 'true');
    update public.preventive_baselines set state = 'submitted', reviewed_by = null, reviewed_at = null where id = v_bid;
    r := pg_temp.as_user(v_coord, format('select public.review_preventive_plan(%L, %L, null)::text', v_bid, 'authorised'));
    if r like '42501:%' then raise exception 'VACUOUS B: the doctor-only rule is not tested'; end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;

  -- SABOTAGE C: the decision no longer closes the task -> check 7 must flip
  begin
    execute replace(pg_get_functiondef('public.review_preventive_plan(uuid,text,text)'::regprocedure),
                    'perform private.close_preventive_plan_task(b.review_task_id, v_uid, p_decision);', '');
    update public.preventive_baselines set state = 'submitted', reviewed_by = null, reviewed_at = null, review_note = null where id = v_bid2;
    perform set_config('tarragon.task_transition', 'on', true);
    update public.clinical_tasks set state = 'open', claimed_by = null where id = v_task2;
    perform set_config('tarragon.task_transition', 'off', true);
    r := pg_temp.as_user(v_doc, format('select public.review_preventive_plan(%L, %L, null)::text', v_bid2, 'authorised'));
    if r <> v_bid2::text then raise exception 'sabotage C setup failed: %', r; end if;
    if (select state::text from public.clinical_tasks where id = v_task2) in ('completed', 'cancelled') then
      raise exception 'VACUOUS C: task closing is not tested';
    end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;

  r := pg_temp.as_user(v_free, 'select public.submit_my_preventive_baseline()::text');
  if r not like 'P0001:members_only%' then raise exception 'FAIL: the Members-only rule was not restored after sabotage'; end if;
  raise notice 't2_preventive_baseline_assessment: PASS';
end $proof$;

rollback;
