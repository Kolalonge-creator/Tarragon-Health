-- S35 proof: public.clinician_patient_summary and public.my_lead_patients (migration *_s35_clinician_patient_summary_and_lead_patients.sql).
-- INV-10 (every staff clinical read is audited), INV-12 (only through a tie), INV-03 (results are metadata only).
--
--   1. A clinician with a tie gets the summary and EXACTLY ONE audit_log row for the open, naming the patient and the 'summary' section.
--   2. A clinician without a tie is denied, sees no data, and the denial is audited.
--   3. A short reason, a patient caller and anon are all refused.
--   4. Readings are the last 14 days only; shadow triage events are excluded; staff cannot read triage_events directly.
--   5. Care circle is a count with no identities; results carry no values.
--   6. my_lead_patients lists only my own active leads and audits each one.
--   7. SABOTAGE: the "no readable section means denied" branch removed (an untied clinician must then get through), and the reason check removed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

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
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
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
  values (v, 's35-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S35 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S35 ' || p_label, 'MDCN', 'S35-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
create function pg_temp.audit_rows(p_patient uuid, p_actor uuid) returns integer language sql as
$$ select count(*)::integer from public.audit_log where subject_patient_id = p_patient and actor_id = p_actor and action = 'staff.chart_read' $$;
create function pg_temp.summary_as(p_uid uuid, p_patient uuid, p_reason text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.clinician_patient_summary(p_patient, p_reason); exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_pat uuid; v_pat2 uuid; v_sup uuid; v_rs uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkdoc(v_org, 'tied', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'untied', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_sup := pg_temp.mkuser(v_org, 'supporter', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('admin', v_admin);

  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());

  -- readings: one recent, one 20 days old (inserted with triggers off so the manual-timestamp and red-flag triggers do not interfere)
  set local session_replication_role = replica;
  -- the lead guard trigger only lets the lead functions write; a proof fixture goes round it
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test)
  values (v_org, v_pat, v_doc, 'active', 'admin', 1, true);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_pat, 'blood_pressure', 150, 95, now() - interval '1 day', 'manual'),
         (v_org, v_pat, 'blood_pressure', 118, 76, now() - interval '20 days', 'manual');
  select id into v_rs from public.triage_rule_sets order by created_at limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, is_test)
  values (v_org, v_pat, 'observation', gen_random_uuid(), 'amber', v_rs, 's35', 1, 'approved', false, true),
         (v_org, v_pat, 'observation', gen_random_uuid(), 'amber', v_rs, 's35', 1, 'draft', true, true);
  set local session_replication_role = origin;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, state, is_test)
  values (v_org, v_pat, v_sup, 'sister', array['adherence_summary'], now() + interval '30 days', 'active', true);
end $$;

-- 1. A tied clinician gets the summary, and one audit row ----------------------------------------------------------------
do $$
declare r jsonb; v_before int; v_after int;
begin
  v_before := pg_temp.audit_rows(pg_temp.f('pat'), pg_temp.f('doc'));
  r := pg_temp.summary_as(pg_temp.f('doc'), pg_temp.f('pat'), 'Reviewing before the call');
  v_after := pg_temp.audit_rows(pg_temp.f('pat'), pg_temp.f('doc'));
  insert into results values ('real', 'tied clinician: status is ok or partial', 'true', (r ->> 'status' in ('ok','partial'))::text);
  insert into results values ('real', 'one audit row for one open', '1', (v_after - v_before)::text);
  insert into results values ('real', 'audit row names the summary section', 'true', (exists (
    select 1 from public.audit_log where subject_patient_id = pg_temp.f('pat') and actor_id = pg_temp.f('doc')
      and event -> 'sections' ? 'summary' and result = 'success'))::text);
  insert into results values ('real', 'readings: only the last 14 days', '1', jsonb_array_length(r -> 'readings' -> 'rows')::text);
  insert into results values ('real', 'triage events: the shadow one is excluded', '1', jsonb_array_length(r -> 'triage_events')::text);
  insert into results values ('real', 'care circle is a count, no identities', '1|false',
    (r -> 'care_circle' ->> 'active_members') || '|' || (r -> 'care_circle' ? 'supporter_id')::text);
  insert into results values ('real', 'patient first name comes back for the header', 'true', (r ? 'patient_first_name')::text);
end $$;

-- 2. An untied clinician is denied and the denial is audited ---------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := pg_temp.summary_as(pg_temp.f('other'), pg_temp.f('pat'), 'Looking without a reason to');
  insert into results values ('real', 'untied clinician: denied', 'denied', coalesce(r ->> 'status', r ->> 'err'));
  insert into results values ('real', 'untied clinician: no readings key', 'false', (r ? 'readings')::text);
  insert into results values ('real', 'the denial is audited', '1', (select count(*)::text from public.audit_log
    where subject_patient_id = pg_temp.f('pat') and actor_id = pg_temp.f('other') and result = 'denied'));
  r := pg_temp.summary_as(pg_temp.f('doc'), pg_temp.f('pat2'), 'Reviewing a patient I do not have');
  insert into results values ('real', 'tied to one patient is not tied to another', 'denied', r ->> 'status');
end $$;

-- 3. Refusals ---------------------------------------------------------------------------------------------------------------
do $$
begin
  insert into results values ('real', 'short reason refused', '22023', pg_temp.summary_as(pg_temp.f('doc'), pg_temp.f('pat'), 'short') ->> 'err');
  insert into results values ('real', 'a patient caller is refused', '42501', pg_temp.summary_as(pg_temp.f('pat'), pg_temp.f('pat'), 'Looking at my own record') ->> 'err');
  insert into results values ('real', 'anon cannot execute the summary', '42501',
    pg_temp.try_anon(format($q$select public.clinician_patient_summary(%L, 'Reviewing before the call')$q$, pg_temp.f('pat'))));
  insert into results values ('real', 'anon cannot execute the lead list', '42501', pg_temp.try_anon($q$select public.my_lead_patients()$q$));
  insert into results values ('real', 'staff cannot read triage_events directly', '0',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.triage_events where patient_id = %L$q$, pg_temp.f('pat'))));
end $$;

-- 4. my_lead_patients -------------------------------------------------------------------------------------------------------
do $$
declare v_mine text; v_theirs text; v_before int; v_after int;
begin
  v_before := pg_temp.audit_rows(pg_temp.f('pat'), pg_temp.f('doc'));
  v_mine := pg_temp.q_as(pg_temp.f('doc'), $q$select jsonb_array_length(public.my_lead_patients())::text$q$);
  v_after := pg_temp.audit_rows(pg_temp.f('pat'), pg_temp.f('doc'));
  v_theirs := pg_temp.q_as(pg_temp.f('other'), $q$select jsonb_array_length(public.my_lead_patients())::text$q$);
  insert into results values ('real', 'lead list: I see my own lead', '1', v_mine);
  insert into results values ('real', 'lead list: another clinician sees none', '0', v_theirs);
  insert into results values ('real', 'lead list: each patient is audited', '1', (v_after - v_before)::text);
  insert into results values ('real', 'lead list: a patient caller is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), $q$select public.my_lead_patients()::text$q$));
end $$;

-- 5. SABOTAGE ---------------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; r jsonb;
begin
  v_orig := pg_get_functiondef('public.clinician_patient_summary(uuid,text)'::regprocedure);

  v_def := replace(v_orig, 'if cardinality(v_sections) = 0 then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  r := pg_temp.summary_as(pg_temp.f('other'), pg_temp.f('pat'), 'Looking without a reason to');
  insert into results values ('sabotaged', 'an untied clinician is denied', 'denied', coalesce(r ->> 'status', 'got through'));
  execute v_orig;

  v_def := replace(v_orig, 'char_length(btrim(p_reason)) < 10', 'false');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.summary_as(pg_temp.f('doc'), pg_temp.f('pat'), 'short');
  insert into results values ('sabotaged', 'a short reason is refused', '22023', coalesce(r ->> 'err', 'accepted'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S35 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
