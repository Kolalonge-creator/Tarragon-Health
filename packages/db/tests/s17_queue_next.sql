-- S17 proof: Next task (migration *_s17_queue_next.sql). Spec 7.6, safety cases 17 and 19 (and the single-session half of 18).
--
-- Proves in one rolled-back transaction:
--   0. Eligibility: the shared table of cases (packages/queue/fixtures/eligibility-cases.json, also run through the pure
--      TypeScript model in Jest) gives the same answer through the real queue_next().
--   1. Execute and table grants (anon and PUBLIC nothing; private helpers not callable by signed-in users).
--   2. Gates: not a clinician, no queue block, declare and cancel availability (overlap, window).
--   3. Order (class, due, age), one claim at a time, an idempotent retry returns the same claim, completion, and
--      INV-12: the claim, and only the claim, ties the clinician to the patient.
--   4. Tier and competency.
--   5. Hand-back: reasons, a note for "other", only the claimant, never re-offered, the review flag once, the
--      cooling-off, and a conflict_of_interest hand-back records a conflict.
--   6. Safety case 17: a conflicted clinician never receives the patient's task; only the CMO lifts the conflict.
--   7. Safety case 19: an abandoned claim returns to the queue (not counted as a hand-back), the score falls, access
--      ends, an overdue task escalates, an ineligible clinician's claims are released without penalty, one extension only.
--   8. Offers: a task pushed to an employed doctor is hidden from everyone else; they take it without a queue block but
--      cannot pull from the pool. Escalated tasks need the on_call competency.
--   9. Reliability arithmetic and an append-only event log.
--  10. RLS (patient, other clinician, CMO, anon) and no direct writes.
--  11. SABOTAGE: the conflict clause removed from the candidate function; the case 17 check must flip.
-- The 50-parallel claim test (safety case 18, real contention) is s17_queue_concurrent_claim.sh.
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
  values (v, 's17-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S17 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'S17 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.mkblock(p_org uuid, p_uid uuid) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
   values (p_org, p_uid, now() - interval '1 minute', now() + interval '2 hours', 'queue', true) $$;
create function pg_temp.mktask(p_patient uuid, p_type text, p_due integer default null) returns uuid language sql as
$$ select private.create_clinical_task(p_patient, p_type, p_due) $$;
-- fixture cleanup without deleting (the logs are append only): end any live claim and cancel what is left
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
create function pg_temp.state_of(p_task uuid) returns text language sql as $$ select state::text from public.clinical_tasks where id = p_task $$;
create function pg_temp.score_of(p_uid uuid) returns text language sql as $$ select reliability_score::text from public.clinical_staff where profile_id = p_uid $$;

-- cases-begin
create temp table cases_json on commit drop as select $cases$
{
  "defaults": {
    "clinician": { "tier": "medical_officer", "competencies": ["hypertension"], "employed": false, "hasBlock": true, "isTest": true, "conflicted": false, "handedBack": false, "ownPatient": false },
    "task": { "state": "open", "minTier": "medical_officer", "requiredCompetencies": ["hypertension"], "offeredTo": "none", "isTest": true }
  },
  "cases": [
    { "name": "base: an open pool task for a matching clinician", "expect": true },
    { "name": "freelancer with no queue block cannot pull", "clinician": { "hasBlock": false }, "expect": false },
    { "name": "employed doctor with no block cannot pull from the pool", "clinician": { "hasBlock": false, "employed": true }, "expect": false },
    { "name": "employed doctor with no block still takes work pushed to them", "clinician": { "hasBlock": false, "employed": true }, "task": { "state": "offered_to_lead", "offeredTo": "me" }, "expect": true },
    { "name": "freelancer with no block cannot take an offered task either", "clinician": { "hasBlock": false }, "task": { "state": "offered_to_lead", "offeredTo": "me" }, "expect": false },
    { "name": "tier below the task minimum", "clinician": { "tier": "care_coordinator" }, "expect": false },
    { "name": "tier above the task minimum", "clinician": { "tier": "senior_medical_officer" }, "expect": true },
    { "name": "a missing competency", "clinician": { "competencies": ["adult_general"] }, "expect": false },
    { "name": "extra competencies are fine", "clinician": { "competencies": ["hypertension", "adult_general"] }, "expect": true },
    { "name": "task needing no competency", "task": { "requiredCompetencies": [] }, "clinician": { "competencies": [] }, "expect": true },
    { "name": "safety case 17: a conflicted clinician is never offered the patient", "clinician": { "conflicted": true }, "expect": false },
    { "name": "a task the clinician handed back is never offered again", "clinician": { "handedBack": true }, "expect": false },
    { "name": "a clinician is never offered their own record", "clinician": { "ownPatient": true }, "expect": false },
    { "name": "a test clinician never takes a real patient's task", "task": { "isTest": false }, "expect": false },
    { "name": "a real clinician never takes a test patient's task", "clinician": { "isTest": false }, "expect": false },
    { "name": "a task offered to another clinician stays hidden", "task": { "state": "offered_to_lead", "offeredTo": "other" }, "expect": false },
    { "name": "a task offered to me, with a block", "task": { "state": "offered_to_lead", "offeredTo": "me" }, "expect": true },
    { "name": "an offered task still needs the competency", "task": { "state": "offered_to_lead", "offeredTo": "me" }, "clinician": { "competencies": [] }, "expect": false },
    { "name": "an escalated task needs the on_call competency", "task": { "state": "escalated" }, "expect": false },
    { "name": "an escalated task for an on-call clinician", "task": { "state": "escalated" }, "clinician": { "competencies": ["hypertension", "on_call"] }, "expect": true },
    { "name": "an escalated task still needs the tier", "task": { "state": "escalated", "minTier": "senior_medical_officer" }, "clinician": { "competencies": ["hypertension", "on_call"] }, "expect": false }
  ]
}
$cases$::jsonb as j;
-- cases-end

-- 0. Fixtures and the shared eligibility cases ---------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid;
  d jsonb; c jsonb; cl jsonb; tk jsonb;
  v_cu uuid; v_pat uuid; v_decoy uuid; v_task uuid; v_s uuid; v_comp text; v_out text; v_expect text; v_other uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  -- only the fixture clinicians may be picked (live rows would make "least loaded" depend on production data)
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{}', v_admin);
  perform pg_temp.setf('cmo', v_cmo);
  v_decoy := pg_temp.mkuser(v_org, 'decoy', 'clinician');

  select j -> 'defaults' into d from cases_json;
  for c in select jsonb_array_elements(j -> 'cases') from cases_json loop
    cl := (d -> 'clinician') || coalesce(c -> 'clinician', '{}'::jsonb);
    tk := (d -> 'task') || coalesce(c -> 'task', '{}'::jsonb);
    v_cu := pg_temp.mkuser(v_org, 'pc', 'clinician');
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
        license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cu, 'S17 case clinician', 'MDCN', 'S17-C-' || substr(v_cu::text, 1, 8), true, 'active', now(), v_admin,
        (cl ->> 'tier')::public.doctor_tier,
        (case when (cl ->> 'employed')::boolean then 'employed' else 'contracted' end)::public.staff_employment_type, 2,
        not (cl ->> 'employed')::boolean, case when (cl ->> 'employed')::boolean then null else v_admin end, (cl ->> 'isTest')::boolean)
    returning id into v_s;
    for v_comp in select jsonb_array_elements_text(cl -> 'competencies') loop
      insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (v_org, v_s, v_comp, v_admin, true);
    end loop;
    if (cl ->> 'hasBlock')::boolean then perform pg_temp.mkblock(v_org, v_cu); end if;
    v_pat := case when (cl ->> 'ownPatient')::boolean then v_cu else pg_temp.mkuser(v_org, 'pp', 'patient') end;
    v_other := case tk ->> 'offeredTo' when 'me' then v_cu when 'other' then v_decoy else null end;
    perform set_config('tarragon.task_transition', 'on', true);
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
        required_competencies, min_tier, due_at, delivery_path, pushed_to, lead_window_ends_at, state, is_test)
    values (v_org, 'amber_bp_review', 1, 4, 4, v_pat, array(select jsonb_array_elements_text(tk -> 'requiredCompetencies')),
        (tk ->> 'minTier')::public.doctor_tier, now() + interval '1 day', case when v_other is null then 'pull' else 'push' end, v_other,
        case when v_other is null then null else now() + interval '1 hour' end, (tk ->> 'state')::public.clinical_task_state, (tk ->> 'isTest')::boolean)
    returning id into v_task;
    perform set_config('tarragon.task_transition', 'off', true);
    if (cl ->> 'conflicted')::boolean then
      insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source, status, is_test)
      values (v_org, v_cu, v_pat, 'proof fixture', 'cmo', 'active', true);
    end if;
    if (cl ->> 'handedBack')::boolean then
      insert into public.task_handbacks (organisation_id, task_id, clinician_id, reason_code, is_test) values (v_org, v_task, v_cu, 'outside_competence', true);
    end if;
    v_out := pg_temp.next_outcome(v_cu);
    v_expect := case when (c ->> 'expect')::boolean then 'claimed' else 'no' end;
    perform pg_temp.rec('case: ' || (c ->> 'name'), v_expect, case when v_out = 'claimed' then 'claimed' else 'no' end);
    perform pg_temp.clear_queue();
  end loop;
  -- the case clinicians must not stay active: an employed one would be pushed every later task
  update public.clinical_staff set active = false where full_name = 'S17 case clinician';
end $$;

-- fixtures for the rest ---------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin');
  i integer;
begin
  perform pg_temp.setf('A', pg_temp.mkdoc(v_org, 'A', 'senior_medical_officer', 'contracted', '{hypertension,adult_general,result_review,prescribing,on_call}', v_admin));
  perform pg_temp.setf('B', pg_temp.mkdoc(v_org, 'B', 'senior_medical_officer', 'contracted', '{hypertension,adult_general,result_review,prescribing}', v_admin));
  perform pg_temp.setf('MO', pg_temp.mkdoc(v_org, 'MO', 'medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('R', pg_temp.mkdoc(v_org, 'R', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('R2', pg_temp.mkdoc(v_org, 'R2', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('E', pg_temp.mkdoc(v_org, 'E', 'senior_medical_officer', 'employed', '{hypertension,adult_general,result_review}', v_admin));
  for i in 1..9 loop perform pg_temp.setf('p' || i, pg_temp.mkuser(v_org, 'patient-' || i, 'patient')); end loop;
  -- E starts inactive so nothing is pushed to them until the offers section
  update public.clinical_staff set active = false where profile_id = pg_temp.f('E');
  -- B, MO, R, R2 get a block directly; A declares theirs through the function in section 2
  perform pg_temp.mkblock(v_org, pg_temp.f('B'));
  perform pg_temp.mkblock(v_org, pg_temp.f('MO'));
  perform pg_temp.mkblock(v_org, pg_temp.f('R'));
  perform pg_temp.mkblock(v_org, pg_temp.f('R2'));
end $$;

-- 1. Grants ---------------------------------------------------------------------------------------------------------
do $$
declare fn text;
begin
  perform pg_temp.rec('the claim config has one active row', '1', (select count(*)::text from public.queue_claim_config where is_active));
  foreach fn in array array['public.queue_next()', 'public.queue_summary()', 'public.queue_handback(uuid,text,text)', 'public.queue_extend_claim(uuid)',
      'public.queue_complete(uuid,jsonb)', 'public.declare_conflict(uuid,text)', 'public.record_conflict(uuid,uuid,text)', 'public.lift_conflict(uuid,text)',
      'public.declare_availability(text,timestamptz,timestamptz)', 'public.cancel_availability(uuid)'] loop
    perform pg_temp.rec('anon cannot execute ' || fn, 'false', has_function_privilege('anon', fn::regprocedure, 'execute')::text);
    perform pg_temp.rec('PUBLIC has no execute on ' || fn, '0', (select count(*)::text from pg_proc p, aclexplode(p.proacl) a where p.oid = fn::regprocedure and a.grantee = 0));
    perform pg_temp.rec('authenticated can execute ' || fn, 'true', has_function_privilege('authenticated', fn::regprocedure, 'execute')::text);
  end loop;
  foreach fn in array array['private.queue_candidates(uuid,boolean)', 'private.queue_gate(uuid)', 'private.queue_has_block(uuid)', 'private.expire_task_claims()',
      'private.recompute_reliability(uuid)', 'private.reliability_event(uuid,uuid,text)', 'private.claim_setting(text)'] loop
    perform pg_temp.rec('signed-in users cannot execute ' || fn, 'false', has_function_privilege('authenticated', fn::regprocedure, 'execute')::text);
    perform pg_temp.rec('anon cannot execute ' || fn, 'false', has_function_privilege('anon', fn::regprocedure, 'execute')::text);
  end loop;
  perform pg_temp.rec('no direct write on the new tables for signed-in users, no read for anon', '0', (select count(*)::text from (
    select unnest(array['public.clinician_conflicts', 'public.availability_blocks', 'public.clinician_reliability_events', 'public.queue_claim_config', 'public.task_claims', 'public.task_handbacks']) t) x
    where has_table_privilege('authenticated', x.t, 'insert') or has_table_privilege('authenticated', x.t, 'update') or has_table_privilege('authenticated', x.t, 'delete')
       or has_table_privilege('anon', x.t, 'select')));
end $$;

-- 2. Gates and availability -------------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_p1 uuid := pg_temp.f('p1'); v_blk uuid;
begin
  perform pg_temp.mktask(v_p1, 'amber_bp_review');
  perform pg_temp.rec('a patient cannot ask for the next task', 'queue_not_clinician', pg_temp.next_outcome(v_p1));
  perform pg_temp.rec('anon cannot call queue_next', '42501', pg_temp.try_anon('select public.queue_next()'));
  perform pg_temp.rec('a freelancer with no queue block is refused', 'queue_no_availability', pg_temp.next_outcome(v_a));
  perform pg_temp.rec('only an eligible clinician may declare availability', 'queue_not_eligible',
    pg_temp.try_as(v_p1, format('select public.declare_availability(''queue'', now(), now() + interval ''1 hour'')')));
  perform pg_temp.rec('a start more than 5 minutes ago is refused', 'queue_bad_window',
    pg_temp.try_as(v_a, 'select public.declare_availability(''queue'', now() - interval ''1 hour'', now() + interval ''1 hour'')'));
  perform pg_temp.rec('a block longer than 24 hours is refused (check)', 'true',
    (pg_temp.try_as(v_a, 'select public.declare_availability(''queue'', now(), now() + interval ''25 hours'')') like '%availability_blocks_check%')::text);
  perform pg_temp.rec('declaring a block works', 'ok', pg_temp.try_as(v_a, 'select public.declare_availability(''queue'', now() - interval ''1 minute'', now() + interval ''2 hours'')'));
  perform pg_temp.rec('an overlapping block is refused', 'availability_overlap',
    pg_temp.try_as(v_a, 'select public.declare_availability(''queue'', now(), now() + interval ''1 hour'')'));
  select id into v_blk from public.availability_blocks where clinician_id = v_a;
  perform pg_temp.rec('another clinician cannot cancel it', 'queue_no_block', pg_temp.try_as(pg_temp.f('B'), format('select public.cancel_availability(%L)', v_blk)));
  perform pg_temp.rec('cancelling closes the queue again', 'queue_no_availability',
    (select case when pg_temp.try_as(v_a, format('select public.cancel_availability(%L)', v_blk)) = 'ok' then pg_temp.next_outcome(v_a) else 'cancel failed' end));
  perform pg_temp.rec('a cancelled block can be declared again', 'ok', pg_temp.try_as(v_a, 'select public.declare_availability(''queue'', now() - interval ''1 minute'', now() + interval ''2 hours'')'));
  perform pg_temp.clear_queue();
end $$;

-- 3. Order, one at a time, retry, completion, INV-12 ------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B');
  t5 uuid; t4b uuid; t4a uuid; t2 uuid; r jsonb; v_claims integer;
begin
  t5 := pg_temp.mktask(pg_temp.f('p1'), 'symptom_review');
  t4b := pg_temp.mktask(pg_temp.f('p2'), 'amber_bp_review', 600);
  t4a := pg_temp.mktask(pg_temp.f('p3'), 'amber_bp_review', 300);
  t2 := pg_temp.mktask(pg_temp.f('p4'), 'critical_result_review');
  perform pg_temp.rec('the best task is the lowest class', t2::text, pg_temp.next_task(v_a)::text);
  r := pg_temp.next_as(v_a);
  perform pg_temp.rec('a second call returns the same claim, flagged', t2::text || ',true', (r -> 'task' ->> 'id') || ',' || (r ->> 'already_claimed'));
  select count(*) into v_claims from public.task_claims where clinician_id = v_a and ended_at is null;
  perform pg_temp.rec('...and there is still exactly one live claim', '1', v_claims::text);
  perform pg_temp.rec('INV-12: the holder is tied to the patient', 'true', pg_temp.q_as(v_a, format('select private.clinician_has_patient_access(%L)::text', pg_temp.f('p4'))));
  perform pg_temp.rec('INV-12: nobody else is', 'false', pg_temp.q_as(v_b, format('select private.clinician_has_patient_access(%L)::text', pg_temp.f('p4'))));
  perform pg_temp.rec('the task is held by A and no one else', v_a::text, (select claimed_by::text from public.clinical_tasks where id = t2));
  perform pg_temp.rec('completing needs an outcome', 'queue_outcome_needed', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{}''::jsonb)', t2)));
  perform pg_temp.rec('only the claimant can complete', 'queue_no_claim', pg_temp.try_as(v_b, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t2)));
  perform pg_temp.rec('the claimant completes', 'ok', pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t2)));
  perform pg_temp.rec('INV-12: completing ends the tie', 'false', pg_temp.q_as(v_a, format('select private.clinician_has_patient_access(%L)::text', pg_temp.f('p4'))));
  perform pg_temp.rec('next is the earlier-due amber review', t4a::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t4a));
  perform pg_temp.rec('then the later-due amber review', t4b::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t4b));
  perform pg_temp.rec('then the class 5 task', t5::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t5));
  perform pg_temp.rec('an empty queue says so', 'none_eligible', pg_temp.next_outcome(v_a));
  perform pg_temp.rec('the claim was audited (INV-10) four times', '4', (select count(*)::text from public.audit_log where actor_id = v_a and action = 'queue.claim'));
  perform pg_temp.rec('the audit note holds no clinical content', 'true',
    (select bool_and((event ?& array['type', 'priority_class', 'claim_id']) and not (event ?| array['reading', 'systolic', 'condition', 'result'])) from public.audit_log where actor_id = v_a and action = 'queue.claim')::text);
  perform pg_temp.rec('four on-time completions raised the score above the prior', 'true', (pg_temp.score_of(v_a)::numeric > 80)::text);
  perform pg_temp.rec('a claim fired the claimed event with ids only', 'true',
    (select bool_and(not (payload ?| array['reading', 'systolic', 'condition', 'result'])) from public.domain_events where event_type = 'clinical_task.claimed' and aggregate_id in (t2, t4a, t4b, t5))::text);
end $$;

-- 4. Tier and competency ----------------------------------------------------------------------------------------------
do $$
declare v_mo uuid := pg_temp.f('MO'); v_b uuid := pg_temp.f('B'); t2 uuid; t4 uuid;
begin
  t2 := pg_temp.mktask(pg_temp.f('p5'), 'critical_result_review');
  perform pg_temp.rec('a medical officer is not offered a senior-tier task', 'none_eligible', pg_temp.next_outcome(v_mo));
  perform pg_temp.rec('a senior with the competency is', t2::text, pg_temp.next_task(v_b)::text);
  perform pg_temp.try_as(v_b, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t2));
  t4 := pg_temp.mktask(pg_temp.f('p6'), 'amber_bp_review');
  perform pg_temp.rec('a medical officer takes an amber review', t4::text, pg_temp.next_task(v_mo)::text);
  perform pg_temp.try_as(v_mo, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t4));
  perform pg_temp.clear_queue();
end $$;

-- 5. Hand-back --------------------------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_mo uuid := pg_temp.f('MO'); v_h uuid; v_org uuid := pg_temp.f('org');
  t uuid; i integer; v_before text;
begin
  v_h := pg_temp.mkdoc(v_org, 'H', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', pg_temp.f('admin'));
  perform pg_temp.mkblock(v_org, v_h);
  for i in 1..5 loop perform pg_temp.mktask(pg_temp.f('p' || i), 'amber_bp_review', 500 + i); end loop;

  -- validation and the claimant rule
  t := pg_temp.next_task(v_a);
  perform pg_temp.rec('an unknown reason is refused', 'queue_bad_reason', pg_temp.try_as(v_a, format('select public.queue_handback(%L, ''bored'', null)', t)));
  perform pg_temp.rec('other needs a note', 'queue_note_needed', pg_temp.try_as(v_a, format('select public.queue_handback(%L, ''other'', ''short'')', t)));
  perform pg_temp.rec('only the claimant can hand it back', 'queue_no_claim', pg_temp.try_as(v_b, format('select public.queue_handback(%L, ''technical_problem'', null)', t)));
  perform pg_temp.rec('a reasoned hand-back works', 'ok', pg_temp.try_as(v_a, format('select public.queue_handback(%L, ''technical_problem'', null)', t)));
  perform pg_temp.rec('the task is open again with one hand-back counted', 'open,1', pg_temp.state_of(t) || ',' || (select handback_count::text from public.clinical_tasks where id = t));
  perform pg_temp.rec('the claim ended as handed back', 'handed_back', (select end_reason from public.task_claims where task_id = t));
  perform pg_temp.rec('INV-12: the tie ended with the hand-back', 'false', pg_temp.q_as(v_a, format('select private.clinician_has_patient_access(%L)::text',
    (select patient_id from public.clinical_tasks where id = t))));
  -- a dropped connection is not a reason to bar the clinician from the task, but "outside my competence" is
  perform pg_temp.rec('a technical_problem hand-back does not bar the clinician from the task', t::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.try_as(v_a, format('select public.queue_handback(%L, ''outside_competence'', null)', t));
  perform pg_temp.rec('an outside_competence hand-back bars the clinician from that task', 'true', (pg_temp.next_task(v_a) is distinct from t)::text);
  perform pg_temp.rec('another clinician can take the handed-back task', 'true', (pg_temp.next_task(v_b) is not null)::text);
  perform pg_temp.clear_queue();

  -- the review flag: four hand-backs in a week go to the clinical lead, once
  for i in 1..5 loop perform pg_temp.mktask(pg_temp.f('p' || i), 'amber_bp_review', 500 + i); end loop;
  for i in 1..4 loop
    t := pg_temp.next_task(v_h);
    perform pg_temp.try_as(v_h, format('select public.queue_handback(%L, ''technical_problem'', null)', t));
  end loop;
  perform pg_temp.rec('four hand-backs raised exactly one review flag', '1', (select count(*)::text from public.audit_log where actor_id = v_h and action = 'queue.handback_review_flagged'));
  perform pg_temp.rec('...and one event', '1', (select count(*)::text from public.domain_events where event_type = 'clinician.handback_review_flagged' and payload ->> 'clinician_id' = v_h::text));
  t := pg_temp.next_task(v_h);
  perform pg_temp.try_as(v_h, format('select public.queue_handback(%L, ''needs_information'', null)', t));
  perform pg_temp.rec('a fifth hand-back does not flag again', '1', (select count(*)::text from public.audit_log where actor_id = v_h and action = 'queue.handback_review_flagged'));
  perform pg_temp.rec('the queue is still open at five (exempt reasons are not counted by the short cooling-off)', 'claimed', pg_temp.next_outcome(v_h));
  t := pg_temp.next_task(v_h);
  perform pg_temp.try_as(v_h, format('select public.queue_handback(%L, ''technical_problem'', null)', t));
  perform pg_temp.rec('the sixth hand-back, even with exempt reasons, hits the hard cap (no unlimited re-rolling)', 'queue_cooling_off', pg_temp.next_outcome(v_h));
  perform pg_temp.clear_queue();
  perform pg_temp.rec('reasoned hand-backs left the score where completions put it', 'true', (pg_temp.score_of(v_a)::numeric > 80)::text);

  -- cooling-off: three counted hand-backs in ten minutes close the queue; exempt reasons do not count toward it
  for i in 1..4 loop perform pg_temp.mktask(pg_temp.f('p' || i), 'amber_bp_review', 700 + i); end loop;
  t := pg_temp.next_task(v_mo); perform pg_temp.try_as(v_mo, format('select public.queue_handback(%L, ''outside_competence'', null)', t));
  t := pg_temp.next_task(v_mo); perform pg_temp.try_as(v_mo, format('select public.queue_handback(%L, ''needs_information'', null)', t));
  perform pg_temp.rec('two counted hand-backs: still open', 'claimed', pg_temp.next_outcome(v_mo));
  t := (pg_temp.next_as(v_mo) -> 'task' ->> 'id')::uuid;
  v_before := pg_temp.score_of(v_mo);
  perform pg_temp.try_as(v_mo, format('select public.queue_handback(%L, ''other'', ''needed a second opinion on this'')', t));
  perform pg_temp.rec('the third counted hand-back closes the queue for a while', 'queue_cooling_off', pg_temp.next_outcome(v_mo));
  perform pg_temp.rec('the summary says why', 'queue_cooling_off', pg_temp.q_as(v_mo, 'select public.queue_summary() ->> ''blocked'''));
  perform pg_temp.rec('an other hand-back weighs against the score', 'true', (pg_temp.score_of(v_mo)::numeric < v_before::numeric)::text);
  perform pg_temp.clear_queue();
end $$;

-- 6. Safety case 17: conflicts ----------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_cmo uuid := pg_temp.f('cmo');
  t uuid; v_conf uuid; i integer; v_q text;
begin
  t := pg_temp.mktask(pg_temp.f('p7'), 'amber_bp_review');
  perform pg_temp.rec('only the CMO can record a conflict', 'not allowed', pg_temp.try_as(v_a, format('select public.record_conflict(%L, %L, ''family member'')', v_b, pg_temp.f('p7'))));
  perform pg_temp.rec('the CMO records one', 'ok', pg_temp.try_as(v_cmo, format('select public.record_conflict(%L, %L, ''family member'')', v_b, pg_temp.f('p7'))));
  perform pg_temp.rec('CASE 17: the conflicted clinician is never offered the patient', 'none_eligible', pg_temp.next_outcome(v_b));
  perform pg_temp.rec('another clinician is', t::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t));

  t := pg_temp.mktask(pg_temp.f('p8'), 'amber_bp_review');
  perform pg_temp.rec('a clinician declares their own conflict', 'ok', pg_temp.try_as(v_b, format('select public.declare_conflict(%L, ''my neighbour'')', pg_temp.f('p8'))));
  select id into v_conf from public.clinician_conflicts where clinician_id = v_b and patient_id = pg_temp.f('p8');
  perform pg_temp.rec('a pending conflict already blocks the offer', 'none_eligible', pg_temp.next_outcome(v_b));
  perform pg_temp.rec('a clinician cannot lift a conflict', 'not allowed', pg_temp.try_as(v_b, format('select public.lift_conflict(%L, ''I think it is fine now'')', v_conf)));
  perform pg_temp.rec('lifting needs a reason', 'queue_note_needed', pg_temp.try_as(v_cmo, format('select public.lift_conflict(%L, ''ok'')', v_conf)));
  perform pg_temp.rec('the CMO lifts it with a reason', 'ok', pg_temp.try_as(v_cmo, format('select public.lift_conflict(%L, ''Checked: no relationship, only the same street'')', v_conf)));
  perform pg_temp.rec('after the lift the task is offered', t::text, pg_temp.next_task(v_b)::text);
  -- self-declared conflicts are capped at five pending; the sixth is refused
  for i in 1..6 loop
    v_q := pg_temp.try_as(v_b, format('select public.declare_conflict(%L, ''my relative'')', pg_temp.mkuser(pg_temp.f('org'), 'q' || i, 'patient')));
  end loop;
  perform pg_temp.rec('self-declared conflicts are capped (5 pending), the sixth is refused', 'queue_too_many_conflicts', v_q);
  perform pg_temp.rec('the lift was audited', '1', (select count(*)::text from public.audit_log where action = 'queue.conflict_lifted' and entity_id = v_conf));
  perform pg_temp.try_as(v_b, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t));

  -- a conflict_of_interest hand-back records the conflict and the patient never comes back to that clinician
  t := pg_temp.mktask(pg_temp.f('p3'), 'amber_bp_review');
  perform pg_temp.rec('A takes the task', t::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.try_as(v_a, format('select public.queue_handback(%L, ''conflict_of_interest'', ''I know this family'')', t));
  perform pg_temp.rec('a conflict row was written with source handback', 'handback,pending_review',
    (select source || ',' || status from public.clinician_conflicts where clinician_id = v_a and patient_id = pg_temp.f('p3')));
  perform pg_temp.mktask(pg_temp.f('p3'), 'symptom_review');
  perform pg_temp.rec('a later task for that patient is not offered to A either', 'none_eligible', pg_temp.next_outcome(v_a));
  perform pg_temp.rec('a conflict_of_interest hand-back is not held against the clinician', 'true',
    (select (count(*) = 0)::text from public.clinician_reliability_events where clinician_id = v_a and kind = 'handed_back_other'));
  perform pg_temp.clear_queue();
end $$;

-- 7. Safety case 19: timeouts, escalation, release, extension ----------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B');
  t uuid; v_before text; v_res jsonb; v_old timestamptz; v_new timestamptz;
begin
  t := pg_temp.mktask(pg_temp.f('p1'), 'amber_bp_review');
  perform pg_temp.rec('A claims', t::text, pg_temp.next_task(v_a)::text);
  v_before := pg_temp.score_of(v_a);
  perform pg_temp.rec('INV-12: A is tied to the patient', 'true', pg_temp.q_as(v_a, format('select private.clinician_has_patient_access(%L)::text', pg_temp.f('p1'))));
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  perform pg_temp.backdate(t, 'claim_expires_at = now() - interval ''1 minute''');
  v_res := private.expire_task_claims();
  perform pg_temp.rec('the sweep expired one claim and failed none', '1,0', (v_res ->> 'expired') || ',' || (v_res ->> 'errors'));
  perform pg_temp.rec('CASE 19: the task is back in the queue', 'open', pg_temp.state_of(t));
  perform pg_temp.rec('a timeout is not counted as a hand-back', '0', (select handback_count::text from public.clinical_tasks where id = t));
  perform pg_temp.rec('the claim is logged as expired', 'expired', (select end_reason from public.task_claims where task_id = t));
  perform pg_temp.rec('the reliability score fell', 'true', (pg_temp.score_of(v_a)::numeric < v_before::numeric)::text);
  perform pg_temp.rec('INV-12: A no longer reaches the patient', 'false', pg_temp.q_as(v_a, format('select private.clinician_has_patient_access(%L)::text', pg_temp.f('p1'))));
  perform pg_temp.rec('the expiry event carries ids only', 'true',
    (select bool_and(not (payload ?| array['reading', 'systolic', 'condition', 'result']))::text from public.domain_events where event_type = 'clinical_task.claim_expired' and aggregate_id = t));
  perform pg_temp.rec('a second sweep does nothing', '0', (private.expire_task_claims() ->> 'expired'));
  perform pg_temp.rec('the task is claimable again, even by the same clinician (a power cut is not misconduct)', t::text, pg_temp.next_task(v_a)::text);

  -- one extension only
  select expires_at into v_old from public.task_claims where task_id = t and ended_at is null;
  perform pg_temp.rec('another clinician cannot extend', 'queue_no_claim', pg_temp.try_as(v_b, format('select public.queue_extend_claim(%L)', t)));
  perform pg_temp.rec('the claimant extends once', 'ok', pg_temp.try_as(v_a, format('select public.queue_extend_claim(%L)', t)));
  select expires_at into v_new from public.task_claims where task_id = t and ended_at is null;
  perform pg_temp.rec('...by the type timeout (30 minutes)', '30', (round(extract(epoch from (v_new - v_old)) / 60))::text);
  perform pg_temp.rec('the task row matches the claim', 'true', (select (claim_expires_at = v_new)::text from public.clinical_tasks where id = t));
  perform pg_temp.rec('a second extension is refused', 'queue_extension_used', pg_temp.try_as(v_a, format('select public.queue_extend_claim(%L)', t)));
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t));

  -- a task already past due goes straight to escalated when its claim times out
  t := pg_temp.mktask(pg_temp.f('p2'), 'amber_bp_review');
  perform pg_temp.next_task(v_a);
  perform pg_temp.backdate(t, 'due_at = now() - interval ''5 minutes'', claim_expires_at = now() - interval ''1 minute''');
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  perform private.expire_task_claims();
  perform pg_temp.rec('an overdue abandoned task escalates at once', 'escalated', pg_temp.state_of(t));
  perform pg_temp.clear_queue();

  -- a clinician who stops being eligible gives up their claims, with no penalty
  t := pg_temp.mktask(pg_temp.f('p3'), 'amber_bp_review');
  perform pg_temp.rec('B claims', t::text, pg_temp.next_task(v_b)::text);
  v_before := pg_temp.score_of(v_b);
  update public.clinical_staff set active = false where profile_id = v_b;
  v_res := private.expire_task_claims();
  update public.clinical_staff set active = true where profile_id = v_b;
  perform pg_temp.rec('the claim of an ineligible clinician was released', 'open,cancelled,1', pg_temp.state_of(t) || ',' || (select end_reason from public.task_claims where task_id = t) || ',' || (v_res ->> 'released'));
  perform pg_temp.rec('...without touching their score', coalesce(v_before, 'null'), coalesce(pg_temp.score_of(v_b), 'null'));
  perform pg_temp.clear_queue();
end $$;

-- 8. Offers and escalated tasks ---------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_e uuid := pg_temp.f('E');
  t uuid; t2 uuid; t3 uuid;
begin
  update public.clinical_staff set active = true where profile_id = v_e;
  t := pg_temp.mktask(pg_temp.f('p4'), 'amber_bp_review');
  perform pg_temp.rec('a task is pushed to the employed doctor as an offer', 'offered_to_lead,' || v_e::text, pg_temp.state_of(t) || ',' || (select pushed_to::text from public.clinical_tasks where id = t));
  perform pg_temp.rec('a freelancer with a block does not see it', 'none_eligible', pg_temp.next_outcome(v_a));
  perform pg_temp.rec('the employed doctor takes it with no queue block', t::text, pg_temp.next_task(v_e)::text);
  perform pg_temp.rec('...and a retry returns the same claim', 'true', (pg_temp.next_as(v_e) ->> 'already_claimed'));
  perform pg_temp.try_as(v_e, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t));
  -- a pool task (not pushable) is not theirs to pull without a block
  t2 := pg_temp.mktask(pg_temp.f('p5'), 'critical_result_review');
  perform pg_temp.rec('an employed doctor with no block cannot pull from the pool', 'none_eligible', pg_temp.next_outcome(v_e));
  perform pg_temp.rec('the summary shows the pool as theirs only through offers', 'true', (pg_temp.q_as(v_e, 'select public.queue_summary() -> ''by_class'' ->> ''2''') is null)::text);
  update public.clinical_staff set active = false where profile_id = v_e;
  perform pg_temp.clear_queue();

  -- escalated tasks need the on_call competency
  t3 := pg_temp.mktask(pg_temp.f('p6'), 'red_event_unacknowledged');
  perform pg_temp.rec('a red-class task is created open (INV-05)', 'open', pg_temp.state_of(t3));
  perform private.apply_task_transition(t3, 'escalated', 'system', null, 'proof escalation');
  perform pg_temp.rec('a senior without on_call is not offered an escalated task', 'none_eligible', pg_temp.next_outcome(v_b));
  perform pg_temp.rec('a senior with on_call is', t3::text, pg_temp.next_task(v_a)::text);
  perform pg_temp.try_as(v_a, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t3));
  perform pg_temp.clear_queue();
end $$;

-- 9. Reliability arithmetic and the append-only log ----------------------------------------------------------------------
do $$
declare
  v_r uuid := pg_temp.f('R'); v_r2 uuid := pg_temp.f('R2'); t uuid;
begin
  perform pg_temp.rec('a clinician with no events has no score yet', 'null', coalesce(pg_temp.score_of(v_r), 'null'));
  t := pg_temp.mktask(pg_temp.f('p1'), 'amber_bp_review');
  perform pg_temp.next_task(v_r);
  perform pg_temp.try_as(v_r, format('select public.queue_complete(%L, ''{"done":true}''::jsonb)', t));
  perform pg_temp.rec('one on-time completion: 100 x (5 x 0.8 + 1) / (5 + 1)', '83.33', pg_temp.score_of(v_r));
  t := pg_temp.mktask(pg_temp.f('p2'), 'amber_bp_review');
  perform pg_temp.next_task(v_r);
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  perform pg_temp.backdate(t, 'claim_expires_at = now() - interval ''1 minute''');
  perform private.expire_task_claims();
  perform pg_temp.rec('then one expiry (weight 0.5): 100 x 5 / 6.5', '76.92', pg_temp.score_of(v_r));
  perform pg_temp.clear_queue();

  t := pg_temp.mktask(pg_temp.f('p3'), 'amber_bp_review');
  perform pg_temp.next_task(v_r2);
  update public.task_claims set expires_at = now() - interval '1 minute' where task_id = t and ended_at is null;
  perform pg_temp.backdate(t, 'claim_expires_at = now() - interval ''1 minute''');
  perform private.expire_task_claims();
  perform pg_temp.rec('a single expiry from a new clinician: 100 x 4 / 5.5', '72.73', pg_temp.score_of(v_r2));
  perform pg_temp.clear_queue();

  perform pg_temp.rec('an event written under config version 1 records it', '1', (select min(config_version)::text from public.clinician_reliability_events where clinician_id = v_r2));
  begin
    update public.clinician_reliability_events set good = 1 where clinician_id = v_r2;
    perform pg_temp.rec('the reliability log is append only (update)', '23514', 'allowed');
  exception when sqlstate '23514' then
    perform pg_temp.rec('the reliability log is append only (update)', '23514', '23514');
  end;
end $$;

-- 10. RLS ------------------------------------------------------------------------------------------------------------
do $$
declare v_b uuid := pg_temp.f('B'); v_a uuid := pg_temp.f('A'); v_cmo uuid := pg_temp.f('cmo'); v_p uuid := pg_temp.f('p1'); tbl text;
begin
  foreach tbl in array array['clinician_conflicts', 'availability_blocks', 'clinician_reliability_events', 'queue_claim_config'] loop
    perform pg_temp.rec('a patient reads nothing from ' || tbl, '0', pg_temp.q_as(v_p, 'select count(*)::text from public.' || tbl));
    perform pg_temp.rec('anon is refused on ' || tbl, '42501', pg_temp.try_anon('select * from public.' || tbl));
  end loop;
  perform pg_temp.rec('a clinician sees only their own reliability events', '0',
    pg_temp.q_as(v_b, format('select count(*)::text from public.clinician_reliability_events where clinician_id <> %L', v_b)));
  perform pg_temp.rec('...and their own conflicts only', '0',
    pg_temp.q_as(v_b, format('select count(*)::text from public.clinician_conflicts where clinician_id <> %L', v_b)));
  perform pg_temp.rec('the CMO reads everyone''s events', 'true', (pg_temp.q_as(v_cmo, 'select count(*)::text from public.clinician_reliability_events')::integer > 0)::text);
  perform pg_temp.rec('a clinician cannot read the config', '0', pg_temp.q_as(v_b, 'select count(*)::text from public.queue_claim_config'));
  perform pg_temp.rec('no direct insert of an availability block', '42501',
    (select case when pg_temp.try_as(v_a, format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind) select organisation_id, id, now(), now() + interval ''1 hour'', ''queue'' from public.profiles where id = %L', v_a)) like 'permission denied%' then '42501' else 'allowed' end));
  perform pg_temp.rec('no direct insert of a conflict', '42501',
    (select case when pg_temp.try_as(v_a, format('insert into public.clinician_conflicts (organisation_id, clinician_id, patient_id, reason, source) select organisation_id, %L, %L, ''x y z'', ''cmo'' from public.profiles where id = %L', v_a, v_p, v_a)) like 'permission denied%' then '42501' else 'allowed' end));
  perform pg_temp.rec('the summary for a patient says not a clinician', 'queue_not_clinician', pg_temp.q_as(v_p, 'select public.queue_summary() ->> ''blocked'''));
  perform pg_temp.rec('the summary for a clinician with a block is open', 'true', pg_temp.q_as(v_b, 'select public.queue_summary() ->> ''open'''));
end $$;

-- 11. SABOTAGE: remove the conflict clause from the candidate function; case 17 must now fail ---------------------------------
do $$
declare v_b uuid := pg_temp.f('B'); t uuid;
begin
  perform pg_temp.clear_queue();
  t := pg_temp.mktask(pg_temp.f('p7'), 'amber_bp_review');   -- B has an active CMO conflict on p7 from section 6
  perform pg_temp.rec('control: with the clause in place the conflicted clinician gets nothing', 'none_eligible', pg_temp.next_outcome(v_b));
end $$;

create or replace function private.queue_candidates(p_uid uuid, p_only_offered boolean default false)
returns table (id uuid, priority_class smallint, due_at timestamptz, created_at timestamptz, state public.clinical_task_state)
language sql stable security definer set search_path = ''
as $$
  with me as (
    select cs.organisation_id, cs.is_test, private.doctor_tier_rank(cs.doctor_tier) as rank,
           coalesce((select array_agg(cc.competency_code) from public.clinician_competencies cc
                      where cc.clinical_staff_id = cs.id and cc.revoked_at is null), '{}'::text[]) as comps
      from public.clinical_staff cs where cs.profile_id = p_uid
  )
  select ct.id, ct.priority_class, ct.due_at, ct.created_at, ct.state
    from public.clinical_tasks ct, me
   where ct.organisation_id = me.organisation_id and ct.is_test = me.is_test and ct.patient_id <> p_uid
     and private.doctor_tier_rank(ct.min_tier) <= me.rank and ct.required_competencies <@ me.comps
     and ((ct.state = 'offered_to_lead' and p_uid in (ct.pushed_to, ct.lead_clinician_id))
       or (not p_only_offered and ct.state = 'open')
       or (not p_only_offered and ct.state = 'escalated' and 'on_call' = any (me.comps)))
     and not exists (select 1 from public.task_handbacks h where h.task_id = ct.id and h.clinician_id = p_uid);
$$;

do $$
begin
  insert into results values ('sabotaged', 'the conflicted clinician is not offered the patient', 'none_eligible', pg_temp.next_outcome(pg_temp.f('B')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S17 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: removing the conflict clause did not change the case 17 check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged row is asserted to FAIL inside the DO block above. It is deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;
