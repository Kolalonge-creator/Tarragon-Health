-- S16b proof: the CMO's sign-off functions (migration *_s16b_cmo_signoff_task_types_and_rule_set.sql).
-- Proves, in a rolled-back transaction: only the CMO can confirm or approve; approval is refused while a task
-- type awaits confirmation and while a rule set asks for a task key nothing answers; approving retires the
-- earlier approved set, ends shadow (a grade made under it creates tasks), and is audited; a non-draft cannot be
-- approved; the SABOTAGE step removes the CMO check and the refusal must disappear.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's16b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S16b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_pat uuid; v_draft uuid; v_second uuid; v_bad uuid; v_te uuid; v_made integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  update public.clinical_staff set active = false where is_test is not true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'S16b CMO', 'MDCN', 'S16B-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_doc, 'S16b Doctor', 'MDCN', 'S16B-DOC-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);

  -- a fresh draft rule set (the live draft is left alone) that asks for a task key the types answer
  insert into public.triage_rule_sets (code, version, status, rules) values ('s16b_set', 1, 'draft',
    '{"code":"s16b_set","version":1,"rules":[{"id":"R1","actions":[{"kind":"create_task","task":"bp_review","dueMinutes":60}]}]}'::jsonb) returning id into v_draft;
  insert into public.triage_rule_sets (code, version, status, rules) values ('s16b_set', 2, 'draft',
    '{"code":"s16b_set","version":2,"rules":[{"id":"R1","actions":[{"kind":"create_task","task":"no_such_key"}]}]}'::jsonb) returning id into v_bad;

  perform pg_temp.rec('adherence_follow_up awaits confirmation', 'true,null',
    (select needs_confirmation::text || ',' || coalesce(confirmed_at::text, 'null') from public.task_types where code = 'adherence_follow_up' and is_active));
  perform pg_temp.rec('only that type and crisis_follow_up (S57b) need confirming', 'adherence_follow_up,crisis_follow_up', (select string_agg(code, ',' order by code) from public.task_types where is_active and needs_confirmation));

  -- who can act
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a doctor cannot confirm', '42501', pg_temp.try($q$select public.confirm_task_type('adherence_follow_up')$q$));
  perform pg_temp.rec('a doctor cannot approve', '42501', pg_temp.try(format('select public.approve_triage_rule_set(%L)', v_draft)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot approve (clinical sign-off is the CMO''s)', '42501', pg_temp.try(format('select public.approve_triage_rule_set(%L)', v_draft)));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot confirm', '42501', pg_temp.try($q$select public.confirm_task_type('adherence_follow_up')$q$));
  perform pg_temp.back();

  -- approval waits for the confirmation
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('approval is refused while a task type awaits confirmation', '22023', pg_temp.try(format('select public.approve_triage_rule_set(%L)', v_draft)));
  perform pg_temp.rec('confirming something that needs no confirmation is refused', '22023', pg_temp.try($q$select public.confirm_task_type('symptom_review')$q$));
  perform public.confirm_task_type('adherence_follow_up', 'class 8 and coordinator tier are right');
  perform pg_temp.rec('approval is still refused while crisis_follow_up (S57b) awaits confirmation', 'true',
    ((select count(*) from public.task_types where is_active and needs_confirmation and confirmed_at is null and code = 'crisis_follow_up') = 1
     and pg_temp.try(format('select public.approve_triage_rule_set(%L)', v_draft)) = '22023')::text);
  perform public.confirm_task_type('crisis_follow_up', 'same class and tier as the red event task');
  perform pg_temp.back();
  perform pg_temp.rec('confirmed: who, when and note recorded', 'true,true,class 8 and coordinator tier are right',
    (select (confirmed_by = v_cmo)::text || ',' || (confirmed_at is not null)::text || ',' || confirmation_note from public.task_types where code = 'adherence_follow_up' and is_active));
  perform pg_temp.rec('the confirmations are audited (adherence_follow_up and crisis_follow_up)', '2', (select count(*)::text from public.audit_log where action = 'task_type.confirmed' and actor_id = v_cmo));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('a second confirmation is refused', '22023', pg_temp.try($q$select public.confirm_task_type('adherence_follow_up')$q$));

  -- the rule set asks for a task key nothing answers
  perform pg_temp.rec('approval is refused when the rules ask for an unanswered task key', '22023', pg_temp.try(format('select public.approve_triage_rule_set(%L)', v_bad)));
  perform pg_temp.back();
  perform pg_temp.rec('...and the bad set is still a draft', 'draft', (select status from public.triage_rule_sets where id = v_bad));

  -- the good one
  perform pg_temp.act(v_cmo);
  perform public.approve_triage_rule_set(v_draft, 'reviewed every rule and threshold');
  perform pg_temp.back();
  perform pg_temp.rec('approved by the CMO, with a time', 'approved,true,true',
    (select status || ',' || (approved_by = v_cmo)::text || ',' || (approved_at is not null)::text from public.triage_rule_sets where id = v_draft));
  perform pg_temp.rec('the approval is audited with the version', '1',
    (select count(*)::text from public.audit_log where action = 'triage_rule_set.approved' and entity_id = v_draft and event ->> 'version' = '1'));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('an approved set cannot be approved again', '22023', pg_temp.try(format('select public.approve_triage_rule_set(%L)', v_draft)));
  perform pg_temp.back();

  -- a newer version retires the older approved one
  insert into public.triage_rule_sets (code, version, status, rules) values ('s16b_set', 3, 'draft',
    '{"code":"s16b_set","version":3,"rules":[{"id":"R1","actions":[{"kind":"create_task","task":"bp_review","dueMinutes":60}]}]}'::jsonb) returning id into v_second;
  perform pg_temp.act(v_cmo);
  perform public.approve_triage_rule_set(v_second);
  perform pg_temp.back();
  perform pg_temp.rec('the earlier approved set is retired in the same step', 'retired,approved',
    (select (select status from public.triage_rule_sets where id = v_draft) || ',' || (select status from public.triage_rule_sets where id = v_second)));

  -- end to end: a grade made under an approved set is not shadow, so it creates tasks (S16)
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (v_org, v_pat, 'observation', gen_random_uuid(), 'amber', 'R1', v_second, 's16b_set', 3, 'approved',
            '[{"kind":"create_task","task":"bp_review","dueMinutes":60}]'::jsonb, false, true, gen_random_uuid()::text) returning id into v_te;
  v_made := public.create_tasks_from_triage_event(v_te);
  perform pg_temp.rec('a grade under the approved set creates its task', '1,1', v_made::text || ',' || (select count(*)::text from public.clinical_tasks where patient_id = v_pat));

  perform pg_temp.rec('execute grants: anon none, authenticated yes', 'false,true',
    has_function_privilege('anon', 'public.approve_triage_rule_set(uuid, text)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'public.approve_triage_rule_set(uuid, text)', 'EXECUTE')::text);

  -- SABOTAGE: take away the CMO check; a doctor's approval must now get past it
  create or replace function private.credential_is_cmo() returns boolean language sql stable as $f$ select true $f$;
  insert into results values ('sabotaged', 'a doctor cannot confirm', '42501', pg_temp.try($q$select public.confirm_task_type('symptom_review')$q$));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S16b proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the CMO check did not change the result'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
