-- Proof (S60 review fixes): five findings from the PR #1003 review, each with a sabotage step proving the check can fail.
--   1. an URGENT result that could not be recorded raises a durable incident + task (service role only, neutral text, INV-07)
--   2. request_symptom_review follows the clinical read grant (patient or a CURRENT grant), not "who logged the check"
--   3. private.symptom_review_sla never raises on a malformed or huge sla_minutes or a non-array config
--   8. complete_symptom_review 'agrees' is judged against the effective category (override if set, else the checker's)
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
-- run a statement under the current role and return 'ok' or its sqlstate
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.scalar(p_sql text) returns text language plpgsql as
$f$ declare v text; begin execute p_sql into v; return v; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's60-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, p_role::public.user_role, 'S60 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en', 'female', 'Lagos')
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, sex = excluded.sex, state = excluded.state;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S60 ' || p_label, 'MDCN', 'S60-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
create function pg_temp.assess(p_org uuid, p_patient uuid, p_category text default 'urgent') returns uuid language plpgsql as
$f$ declare v uuid; begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (p_org, p_patient, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}',
          p_category::public.triage_category, false, 'routine', 'S60 proof')
  returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_p1 uuid; v_cg uuid; v_c1 uuid; v_a1 uuid; v_a2 uuid; v_pa uuid; v_rid uuid; v_task uuid;
  v_j jsonb; v_r text; v_ver integer; v_min integer; v_def text; v_n integer; v_cfg jsonb;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p1 := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_cg := pg_temp.mkuser(v_org, 'caregiver', 'patient');
  v_c1 := pg_temp.mkstaff(v_org, v_admin, 'tied', 'medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_p1, v_c1);
  v_a1 := pg_temp.assess(v_org, v_p1, 'urgent');
  -- the caregiver logged the check for the patient, holding a medical_history grant (set up with triggers off: the fixture is the grant)
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, logged_by_profile_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (v_org, v_p1, v_cg, 'headache', (select min(version) from public.triage_protocols), '{}', '[]', '{}', 'urgent', false, 'routine', 'S60 proof')
  returning id into v_a2;
  set local session_replication_role = replica;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_p1, v_cg, 'view', v_p1) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medical_history');
  set local session_replication_role = origin;

  -- ===== finding 2: request_symptom_review follows the read grant, not "who logged it" =====
  perform pg_temp.act(v_cg);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a2));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'FAIL 2a: a caregiver with a current grant could not request a review (%)', v_r; end if;
  -- the grant is revoked; the caregiver still "logged" the check but must now be refused, and so must a fresh request on another check
  delete from public.profile_access_categories where profile_access_id = v_pa;
  delete from public.profile_access where id = v_pa;
  v_a1 := pg_temp.assess(v_org, v_p1, 'urgent');
  update public.symptom_triage_assessments set logged_by_profile_id = v_cg where id = v_a1;
  perform pg_temp.act(v_cg);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a1));
  perform pg_temp.back();
  if v_r <> '42501' then raise exception 'FAIL 2b: a caregiver whose grant was revoked could request a review (%)', v_r; end if;
  if exists (select 1 from public.symptom_reviews where assessment_id = v_a1) then raise exception 'FAIL 2c: a refused request still created a review'; end if;
  perform pg_temp.act(v_p1);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a1));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'FAIL 2d: the patient could not request their own review (%)', v_r; end if;
  -- SABOTAGE: put the old "logged it" rule back; the revoked caregiver must then get in, or the test above is vacuous
  v_def := pg_get_functiondef('public.request_symptom_review(uuid)'::regprocedure);
  execute replace(v_def, 'not (a.patient_id = v_uid or private.can_read_clinical(a.patient_id, ''medical_history''::public.care_access_category))',
                         '(a.patient_id <> v_uid and a.logged_by_profile_id is distinct from v_uid)');
  delete from public.symptom_reviews where assessment_id = v_a1;
  perform pg_temp.act(v_cg);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a1));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'VACUOUS TEST (finding 2): with the old rule restored the revoked caregiver was still refused (%)', v_r; end if;
  execute v_def;
  delete from public.symptom_reviews where assessment_id = v_a1;

  -- ===== finding 3: a malformed SLA config never raises, it reads as "no time stated" =====
  select version into v_ver from public.escalation_slas where notes like 'DRAFT, UNSIGNED (F1%' limit 1;
  if v_ver is null then raise exception 'fixture: the F1 draft SLA is missing'; end if;
  select config into v_cfg from public.escalation_slas where version = v_ver;
  update public.escalation_slas set approved_at = now(), config = v_cfg where is_active;
  if (select minutes from private.symptom_review_sla()) is distinct from 1440 then raise exception 'FAIL 3a: the well-formed config does not give 1440 (%)', (select minutes from private.symptom_review_sla()); end if;
  foreach v_r in array array[
      '"just a string"', '{"pathway":"symptom_triage"}', '42', 'null',
      '[1, "x", null, {"pathway":"symptom_triage","tier":"clinician_review","sla_minutes":"abc"}]',
      '[{"pathway":"symptom_triage","tier":"clinician_review","sla_minutes":99999999999999999999}]',
      '[{"pathway":"symptom_triage","tier":"clinician_review","sla_minutes":1.5}]',
      '[{"pathway":"symptom_triage","tier":"clinician_review","sla_minutes":-30}]',
      '[{"pathway":"symptom_triage","tier":"clinician_review","sla_minutes":{"a":1}}]',
      '[{"pathway":"symptom_triage","tier":"clinician_review","sla_minutes":"0"}]'] loop
    update public.escalation_slas set config = v_r::jsonb where is_active;
    begin
      select count(*) into v_n from private.symptom_review_sla();
    exception when others then
      raise exception 'FAIL 3b: a malformed config (%) raised % (%)', v_r, sqlstate, sqlerrm;
    end;
    if v_n <> 0 then raise exception 'FAIL 3c: a malformed config (%) still stated a time', v_r; end if;
    if (public.symptom_review_stated_time() ->> 'stated')::boolean then raise exception 'FAIL 3d: stated_time invented a time for %', v_r; end if;
  end loop;
  -- the request itself still works against a malformed config (it must never fail because of it)
  perform pg_temp.act(v_p1);
  v_r := pg_temp.try(format('select public.request_symptom_review(%L)', v_a1));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'FAIL 3e: a malformed SLA config broke request_symptom_review (%)', v_r; end if;
  delete from public.symptom_reviews where assessment_id = v_a1;
  -- SABOTAGE: the old unguarded body must raise on a non-array config, proving the guard is what protects it
  update public.escalation_slas set config = '"just a string"'::jsonb where is_active;
  begin
    perform 1 from public.escalation_slas s, jsonb_array_elements(s.config) e where s.is_active and (e ->> 'sla_minutes') ~ '^[0-9]+$';
    raise exception 'VACUOUS TEST (finding 3): the unguarded form did not raise on a non-array config';
  exception when others then
    if sqlerrm like 'VACUOUS%' then raise; end if;
  end;
  update public.escalation_slas set config = '[{"pathway":"symptom_triage","tier":"clinician_review","sla_minutes":"99999999999999999999"}]'::jsonb where is_active;
  begin
    perform (e ->> 'sla_minutes')::integer from public.escalation_slas s, jsonb_array_elements(s.config) e where s.is_active and e ->> 'pathway' = 'symptom_triage';
    raise exception 'VACUOUS TEST (finding 3b): the unguarded cast did not raise on a huge value';
  exception when others then
    if sqlerrm like 'VACUOUS%' then raise; end if;
  end;
  update public.escalation_slas set config = v_cfg where is_active;

  -- ===== finding 8: "agrees" is judged against the category the patient was actually given =====
  v_a1 := pg_temp.assess(v_org, v_p1, 'urgent');
  update public.symptom_triage_assessments set override_category = 'emergency', override_reason = 'proof: clinician raised it',
         overridden_by = v_c1, overridden_at = now() where id = v_a1;
  perform pg_temp.act(v_p1);
  perform public.request_symptom_review(v_a1);
  perform pg_temp.back();
  select id into v_rid from public.symptom_reviews where assessment_id = v_a1;
  perform pg_temp.act(v_c1);
  -- the override says emergency: agreeing while giving the ORIGINAL category (urgent) is not agreement
  if pg_temp.try(format('select public.complete_symptom_review(%L, %L, %L, %L, true, %L)', v_rid, 'G43.9', 'x', 'urgent', 'A message long enough to pass.')) <> '22023' then
    raise exception 'FAIL 8a: agrees=true was accepted against the checker category although an override applies';
  end if;
  v_j := public.complete_symptom_review(v_rid, 'G43.9', 'Migraine', 'emergency', true, 'A message long enough to pass.');
  perform pg_temp.back();
  if v_j ->> 'ok' <> 'true' then raise exception 'FAIL 8b: agreeing with the effective (override) category was refused: %', v_j; end if;
  -- SABOTAGE: compare to the raw category again; the wrong-way agreement must then be accepted
  v_a1 := pg_temp.assess(v_org, v_p1, 'urgent');
  update public.symptom_triage_assessments set override_category = 'emergency', override_reason = 'proof: clinician raised it',
         overridden_by = v_c1, overridden_at = now() where id = v_a1;
  perform pg_temp.act(v_p1);
  perform public.request_symptom_review(v_a1);
  perform pg_temp.back();
  select id into v_rid from public.symptom_reviews where assessment_id = v_a1;
  v_def := pg_get_functiondef('public.complete_symptom_review(uuid,text,text,public.triage_category,boolean,text,text)'::regprocedure);
  execute replace(v_def, 'coalesce(a.override_category, a.category)', 'a.category');
  perform pg_temp.act(v_c1);
  v_r := pg_temp.try(format('select public.complete_symptom_review(%L, %L, %L, %L, true, %L)', v_rid, 'G43.9', 'x', 'urgent', 'A message long enough to pass.'));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'VACUOUS TEST (finding 8): with the raw-category comparison restored the wrong agreement was still refused (%)', v_r; end if;
  execute v_def;

  -- ===== finding 1: an urgent result that could not be recorded is never silent =====
  -- who may call it: the service role only
  if has_function_privilege('anon', 'public.report_unrecorded_symptom_check(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.report_unrecorded_symptom_check(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL 1a: a client role can execute report_unrecorded_symptom_check';
  end if;
  if not has_function_privilege('service_role', 'public.report_unrecorded_symptom_check(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL 1a2: the service role cannot execute report_unrecorded_symptom_check';
  end if;
  v_j := public.report_unrecorded_symptom_check(v_p1, 'routine');
  if (v_j ->> 'ok')::boolean then raise exception 'FAIL 1b: a routine result raised an incident'; end if;
  v_j := public.report_unrecorded_symptom_check(v_p1, 'urgent');
  if not (v_j ->> 'ok')::boolean then raise exception 'FAIL 1c: an urgent unrecorded result was not reported: %', v_j; end if;
  select count(*) into v_n from public.ops_incidents where external_reference like 'symptom_check_unrecorded:' || v_p1 || ':%' and status not in ('resolved', 'closed');
  if v_n <> 1 then raise exception 'FAIL 1d: expected one open incident, got %', v_n; end if;
  if not exists (select 1 from public.clinical_tasks t where t.patient_id = v_p1 and t.dedup_key like 'symptom_unrecorded:' || v_p1 || ':%') then
    raise exception 'FAIL 1e: no follow-up clinical task was created';
  end if;
  -- reported twice on one day: one incident, one task (refreshed, never duplicated)
  perform public.report_unrecorded_symptom_check(v_p1, 'urgent');
  select count(*) into v_n from public.ops_incidents where external_reference like 'symptom_check_unrecorded:' || v_p1 || ':%' and status not in ('resolved', 'closed');
  if v_n <> 1 then raise exception 'FAIL 1f: a repeat made a second incident (%)', v_n; end if;
  -- INV-07: neutral text, no category, condition or result named
  if exists (select 1 from public.ops_incidents where external_reference like 'symptom_check_unrecorded:' || v_p1 || ':%'
              and (title || ' ' || summary) ~* '(urgent|emergency|routine|headache|chest|pain|breath|result)') then
    raise exception 'FAIL 1g: the incident text names a result or condition (INV-07)';
  end if;
  -- an unknown patient is refused quietly with a reason (never an exception that would hide the original problem)
  v_j := public.report_unrecorded_symptom_check(gen_random_uuid(), 'urgent');
  if (v_j ->> 'ok')::boolean then raise exception 'FAIL 1h: an unknown patient was reported'; end if;
  -- SABOTAGE: with page_incident made a no-op the incident count must drop to zero, proving the check watches the real effect
  delete from public.ops_incidents where external_reference like 'symptom_check_unrecorded:' || v_p1 || ':%';
  create or replace function private.page_incident(p_org uuid, p_ref text, p_title text, p_summary text) returns void
    language plpgsql security definer set search_path = '' as $f$ begin null; end $f$;
  perform public.report_unrecorded_symptom_check(v_p1, 'urgent');
  select count(*) into v_n from public.ops_incidents where external_reference like 'symptom_check_unrecorded:' || v_p1 || ':%';
  if v_n <> 0 then raise exception 'VACUOUS TEST (finding 1): with page_incident disabled an incident still appeared'; end if;

  raise notice 'PASS: review request follows the read grant, a malformed SLA never raises, agreement is against the effective category, an unrecorded urgent result raises an incident and task';
end $$;

rollback;
