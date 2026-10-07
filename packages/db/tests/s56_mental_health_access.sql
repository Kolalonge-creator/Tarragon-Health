-- S56 proof: every mental-health table is per-patient (INV-12) with audited reads (INV-10); the Care Circle consent hook; the neutral text; the
-- sponsor report; the corporate aggregate and its minimum cohort; the therapy approval path; follow-up pathway; hand-off; crisis card.
-- Roles proved: patient own, other patient, tied clinician, untied clinician, tied coordinator, CMO without a tie, admin, finance, analyst,
-- corporate admin, sponsor, caregiver without and with consent, manage-level guardian, break-glass, anon.
-- SABOTAGE: a staff select policy restored, the tie gate opened to everyone, the consent hook made implicit, the card showing candidates; each
-- must flip its checks (the file fails with VACUOUS TEST otherwise). Everything is rolled back.
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
create function pg_temp.audit_n(p_actor uuid, p_result text) returns integer language sql as
$$ select count(*)::integer from public.audit_log where actor_id = p_actor and action = 'staff.mental_health_read' and result = p_result $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_doc uuid; v_doc2 uuid; v_smo uuid; v_coord uuid; v_cmo uuid; v_spons uuid;
  v_cg_no uuid; v_cg_yes uuid; v_dep uuid; v_dep_mgr uuid; v_pa uuid; v_prov uuid; v_screen uuid; v_i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); perform pg_temp.setf('pat', v_pat);
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient'); perform pg_temp.setf('pat2', v_pat2);
  v_doc := pg_temp.mkdoc(v_org, 'doctied', 'medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('doctied', v_doc);
  v_smo := pg_temp.mkdoc(v_org, 'smotied', 'senior_medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('smotied', v_smo);
  v_coord := pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', 'employed', '{}', v_admin); perform pg_temp.setf('coord', v_coord);
  perform pg_temp.setf('finance', pg_temp.mkuser(v_org, 'finance', 'finance'));
  perform pg_temp.setf('analyst', pg_temp.mkuser(v_org, 'analyst', 'analyst'));
  perform pg_temp.setf('corp', pg_temp.mkuser(v_org, 'corp', 'corporate_admin'));
  v_spons := pg_temp.mkuser(v_org, 'spons', 'patient'); perform pg_temp.setf('spons', v_spons);
  v_cg_no := pg_temp.mkuser(v_org, 'cgno', 'patient'); perform pg_temp.setf('cgno', v_cg_no);
  v_cg_yes := pg_temp.mkuser(v_org, 'cgyes', 'patient'); perform pg_temp.setf('cgyes', v_cg_yes);
  v_dep := pg_temp.mkuser(v_org, 'dep', 'patient'); perform pg_temp.setf('dep', v_dep);
  v_dep_mgr := pg_temp.mkuser(v_org, 'depmgr', 'patient'); perform pg_temp.setf('depmgr', v_dep_mgr);

  -- ties: pat is tied to doctied (assignment) and to smotied (assignment cannot hold two clinicians; smotied gets a claimed task below)
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id) values (v_org, v_pat, v_doc, v_coord);
  update public.care_team_assignment set clinical_director_id = v_smo where patient_id = v_pat;

  -- supporters (fixture inserts bypass the owner-only trigger on purpose; the consent path itself is exercised below)
  set local session_replication_role = replica;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access) values (v_pat, v_cg_no, 'view', v_pat, true) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) select v_pa, c from unnest(array['medical_history', 'vitals_readings', 'medications', 'appointments_care_plan']::public.care_access_category[]) c;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access) values (v_pat, v_cg_yes, 'view', v_pat, true) returning id into v_pa;
  perform pg_temp.setf('pa_yes', v_pa);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medical_history');
  update public.profiles set is_dependent_account = true where id = v_dep;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access) values (v_dep, v_dep_mgr, 'manage', v_dep, true);
  set local session_replication_role = origin;

  -- the target patient's data: two screens (the second moderate), a check-in, then a crisis screen
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (v_org, v_pat, 'gad7', 3, 'minimal');
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (v_org, v_pat, 'phq9', 12, 'moderate') returning id into v_screen;
  perform pg_temp.setf('screen_mod', v_screen);
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level, tags, note) values (v_org, v_pat, 2, 4, 2, 3, array['work', 'sleep'], 'private note');
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged) values (v_org, v_pat2, 'phq9', 22, 'severe', true);
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level) values (v_org, v_pat2, 3, 3, 3, 3);

  -- created AFTER the data so no alert on it is auto-assigned to them (an alert owner is tied by INV-12, which is correct)
  v_doc2 := pg_temp.mkdoc(v_org, 'docuntied', 'medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('docuntied', v_doc2);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('cmo', v_cmo);
  insert into public.specialist_providers (specialist_type, name, consultation_fee_kobo, is_active, supports_telemedicine, license_verified_at, verification_stage)
    values ('psychiatry', 'S56 proof psychiatrist', 1000000, true, true, now(), 'active') returning id into v_prov;
  perform pg_temp.setf('prov', v_prov);
end $$;

-- 1. Direct table reads: nobody but the patient (and a consenting supporter) ----------------------------------------------------
do $$
declare t text;
begin
  perform pg_temp.ck('the patient reads their own screens directly', '2', pg_temp.cnt(pg_temp.f('pat'), 'mental_health_screens'));
  perform pg_temp.ck('the patient reads their own check-ins directly', '1', pg_temp.cnt(pg_temp.f('pat'), 'wellbeing_checkins'));
  perform pg_temp.ck('another patient reads none of it', '0', pg_temp.q_as(pg_temp.f('pat2'), format('select count(*)::text from public.wellbeing_checkins where patient_id = %L', pg_temp.f('pat'))));
  foreach t in array array['mental_health_screens', 'wellbeing_checkins', 'mental_health_screening_schedules', 'therapy_sessions', 'wellbeing_checkin_preferences', 'mental_health_handoffs'] loop
    perform pg_temp.ck('tied clinician cannot read ' || t || ' directly', '0', pg_temp.cnt(pg_temp.f('doctied'), t));
    perform pg_temp.ck('untied clinician cannot read ' || t || ' directly', '0', pg_temp.cnt(pg_temp.f('docuntied'), t));
    perform pg_temp.ck('tied coordinator cannot read ' || t || ' directly', '0', pg_temp.cnt(pg_temp.f('coord'), t));
    perform pg_temp.ck('CMO without a tie cannot read ' || t || ' directly', '0', pg_temp.cnt(pg_temp.f('cmo'), t));
    perform pg_temp.ck('admin cannot read ' || t || ' directly', '0', pg_temp.cnt(pg_temp.f('admin'), t));
  end loop;
  perform pg_temp.ck('finance cannot read screens', '0', pg_temp.cnt(pg_temp.f('finance'), 'mental_health_screens'));
  perform pg_temp.ck('analyst cannot read check-ins', '0', pg_temp.cnt(pg_temp.f('analyst'), 'wellbeing_checkins'));
  perform pg_temp.ck('a corporate admin cannot read screens', '0', pg_temp.cnt(pg_temp.f('corp'), 'mental_health_screens'));
  perform pg_temp.ck('a sponsor cannot read screens', '0', pg_temp.cnt(pg_temp.f('spons'), 'mental_health_screens'));
  perform pg_temp.ck('a caregiver with every other category but no mental-health consent reads no screens', '0', pg_temp.cnt(pg_temp.f('cgno'), 'mental_health_screens'));
  perform pg_temp.ck('...and no check-ins', '0', pg_temp.cnt(pg_temp.f('cgno'), 'wellbeing_checkins'));
  perform pg_temp.ck('a manage-level guardian of a dependent has no bypass', '0', pg_temp.cnt(pg_temp.f('depmgr'), 'mental_health_screens'));
  perform pg_temp.ck('anon is refused at the table', '42501', pg_temp.try_anon('select count(*) from public.mental_health_screens'));
end $$;

-- 2. The consent hook: owner-only, revocable, per category -----------------------------------------------------------------------
do $$
declare v_pa uuid := pg_temp.f('pa_yes'); r text;
begin
  perform pg_temp.ck('the supporter cannot grant themselves the category', 'true',
    (pg_temp.try_as(pg_temp.f('cgyes'), format($q$select public.set_care_access_categories(%L, array['medical_history','mental_health']::public.care_access_category[])$q$, v_pa)) like '%only the person whose record it is%')::text);
  perform pg_temp.ck('...so still no screens', '0', pg_temp.cnt(pg_temp.f('cgyes'), 'mental_health_screens'));
  perform pg_temp.ck('the owner grants it', 'ok',
    pg_temp.try_as(pg_temp.f('pat'), format($q$select public.set_care_access_categories(%L, array['medical_history','mental_health']::public.care_access_category[])$q$, v_pa)));
  perform pg_temp.ck('the supporter now reads the screens', '2', pg_temp.cnt(pg_temp.f('cgyes'), 'mental_health_screens'));
  perform pg_temp.ck('...and the check-ins', '1', pg_temp.cnt(pg_temp.f('cgyes'), 'wellbeing_checkins'));
  perform pg_temp.ck('the supporter reads through the audited function without an audit row', 'ok',
    (pg_temp.q_as(pg_temp.f('cgyes'), format($q$select (public.read_patient_mental_health_audited(%L))->>'status'$q$, pg_temp.f('pat')))));
  perform pg_temp.ck('the grant is logged', '1', (select count(*)::text from public.care_access_events where patient_id = pg_temp.f('pat') and kind = 'category_access_granted' and metadata ->> 'category' = 'mental_health'));
  perform pg_temp.ck('the owner withdraws it', 'ok',
    pg_temp.try_as(pg_temp.f('pat'), format($q$select public.set_care_access_categories(%L, array['medical_history']::public.care_access_category[])$q$, v_pa)));
  perform pg_temp.ck('...and the supporter is back to nothing', '0', pg_temp.cnt(pg_temp.f('cgyes'), 'mental_health_screens'));
  perform pg_temp.ck('the owner grants it again', 'ok',
    pg_temp.try_as(pg_temp.f('pat'), format($q$select public.set_care_access_categories(%L, array['medical_history','mental_health']::public.care_access_category[])$q$, v_pa)));
  update public.profile_access set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = v_pa;
  perform pg_temp.ck('an expired grant gives nothing', '0', pg_temp.cnt(pg_temp.f('cgyes'), 'mental_health_screens'));
end $$;

-- 3. Audited reads: tie or break-glass, always logged, refusals logged -------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); n0 integer; r text; v_g uuid;
begin
  r := pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.read_patient_mental_health_audited(%L, 'follow up on a moderate result', array['screens','checkins'])::text$q$, v_pat));
  perform pg_temp.ck('a tied clinician reads through the audited function', 'ok', r::jsonb ->> 'status');
  perform pg_temp.ck('...and gets the screens', '2', jsonb_array_length(r::jsonb -> 'screens')::text);
  perform pg_temp.ck('...and the check-in with its tags', 'work', r::jsonb -> 'checkins' -> 0 -> 'tags' ->> 0);
  perform pg_temp.ck('...and the read is audited once', '1', pg_temp.audit_n(pg_temp.f('doctied'), 'success')::text);
  perform pg_temp.ck('a reason is required', 'true',
    (pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.read_patient_mental_health_audited(%L, 'short')::text$q$, v_pat)) like 'ERR:a reason of at least 10%')::text);
  perform pg_temp.ck('an unknown section is refused', 'true',
    (pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.read_patient_mental_health_audited(%L, 'follow up on a moderate result', array['everything'])::text$q$, v_pat)) like 'ERR:unknown section%')::text);

  foreach r in array array['docuntied', 'coord', 'cmo', 'admin', 'finance', 'analyst', 'corp'] loop
    perform pg_temp.ck(r || ' is denied by the audited function', 'denied',
      (pg_temp.q_as(pg_temp.f(r), format($q$select (public.read_patient_mental_health_audited(%L, 'checking this chart today'))->>'status'$q$, v_pat))));
  end loop;
  perform pg_temp.ck('a denial by a clinician without a tie is audited', '1', pg_temp.audit_n(pg_temp.f('docuntied'), 'denied')::text);
  perform pg_temp.ck('a denial for the CMO is audited', '1', pg_temp.audit_n(pg_temp.f('cmo'), 'denied')::text);
  perform pg_temp.ck('another patient is refused outright', 'true',
    (pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.read_patient_mental_health_audited(%L)::text$q$, v_pat)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('a caregiver without consent is refused outright', 'true',
    (pg_temp.q_as(pg_temp.f('cgno'), format($q$select public.read_patient_mental_health_audited(%L)::text$q$, v_pat)) like 'ERR:not authorised%')::text);
  n0 := pg_temp.audit_n(pg_temp.f('pat'), 'success');
  perform pg_temp.ck('the patient reads their own through the function', 'ok', pg_temp.q_as(v_pat, format($q$select (public.read_patient_mental_health_audited(%L))->>'status'$q$, v_pat)));
  perform pg_temp.ck('...with no audit row', '0', (pg_temp.audit_n(v_pat, 'success') - n0)::text);

  -- break-glass: a grant for the category opens it; a grant for another category does not
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
    values (pg_temp.f('docuntied'), pg_temp.f('org'), v_pat, pg_temp.f('org'), 'proof break-glass', now() + interval '1 hour') returning id into v_g;
  perform pg_temp.ck('an active break-glass grant opens it (audited, reason recorded on the grant)', 'ok',
    pg_temp.q_as(pg_temp.f('docuntied'), format($q$select (public.read_patient_mental_health_audited(%L, 'emergency access in progress'))->>'status'$q$, v_pat)));
  update public.emergency_record_access_grants set ended_at = now() where id = v_g;
  perform pg_temp.ck('...and an ended grant opens nothing', 'denied',
    pg_temp.q_as(pg_temp.f('docuntied'), format($q$select (public.read_patient_mental_health_audited(%L, 'emergency access in progress'))->>'status'$q$, v_pat)));
end $$;

-- 4. Therapy: the request reaches a doctor, only a prescriber with a tie approves, a patient only cancels -----------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_sess uuid; r text; n integer;
begin
  perform pg_temp.act(v_pat);
  insert into public.therapy_sessions (organisation_id, patient_id, provider_id, fee_kobo, modality)
    values (pg_temp.f('org'), v_pat, pg_temp.f('prov'), 1000000, 'video') returning id into v_sess;
  perform pg_temp.back();
  perform pg_temp.setf('sess', v_sess);
  perform pg_temp.ck('a psychiatry request waits for a doctor', 'awaiting_clinician_approval', (select status::text from public.therapy_sessions where id = v_sess));
  perform pg_temp.ck('...and creates a task a clinician can claim', '1', (select count(*)::text from public.clinical_tasks where dedup_key = 'therapy_approval:' || v_sess));
  perform pg_temp.ck('the task names no clinical detail', 'admin_clinical', (select type from public.clinical_tasks where dedup_key = 'therapy_approval:' || v_sess));

  perform pg_temp.ck('an untied clinician does not see the request', '0', jsonb_array_length((pg_temp.q_as(pg_temp.f('docuntied'), 'select (public.list_therapy_approvals_audited())::text')::jsonb) -> 'rows')::text);
  perform pg_temp.ck('...but is told that some are not yet theirs', 'true', ((pg_temp.q_as(pg_temp.f('docuntied'), 'select (public.list_therapy_approvals_audited())::text')::jsonb) ->> 'not_yet_yours' >= '1')::text);
  perform pg_temp.ck('the tied clinician sees it', '1', jsonb_array_length((pg_temp.q_as(pg_temp.f('doctied'), 'select (public.list_therapy_approvals_audited())::text')::jsonb) -> 'rows')::text);
  perform pg_temp.ck('...and the worklist count is 1 for them', '1', pg_temp.q_as(pg_temp.f('doctied'), 'select public.count_therapy_approvals_waiting()::text'));
  perform pg_temp.ck('...and 0 for a clinician without a tie', '0', pg_temp.q_as(pg_temp.f('docuntied'), 'select public.count_therapy_approvals_waiting()::text'));
  perform pg_temp.ck('a coordinator cannot list the queue', 'true', (pg_temp.q_as(pg_temp.f('coord'), 'select public.list_therapy_approvals_audited()::text') like 'ERR:not authorised%')::text);
  perform pg_temp.ck('a tied medical officer without prescribing authority cannot approve', 'true',
    (pg_temp.q_as(pg_temp.f('doctied'), format('select public.approve_therapy_session(%L, true, now() + interval ''1 day'')::text', v_sess)) is null)::text);
  perform pg_temp.ck('a tied coordinator cannot approve', 'true', (pg_temp.q_as(pg_temp.f('coord'), format('select public.approve_therapy_session(%L, true, now() + interval ''1 day'')::text', v_sess)) is null)::text);
  perform pg_temp.ck('an admin cannot approve', 'true', (pg_temp.q_as(pg_temp.f('admin'), format('select public.approve_therapy_session(%L, true, now() + interval ''1 day'')::text', v_sess)) is null)::text);
  perform pg_temp.ck('...and every refusal of an approval is audited (it returns an empty row instead of raising, so the audit row survives)', '3',
    (select count(*)::text from public.audit_log where action = 'staff.mental_health_read' and result = 'denied' and reason = 'attempted therapy approval' and subject_patient_id = v_pat));
  perform pg_temp.ck('a confirm without a time is refused', 'true',
    (pg_temp.q_as(pg_temp.f('smotied'), format('select public.approve_therapy_session(%L, true)::text', v_sess)) like 'ERR:Choose a time in the future%')::text);
  perform pg_temp.ck('a confirm with a time in the past is refused', 'true',
    (pg_temp.q_as(pg_temp.f('smotied'), format('select public.approve_therapy_session(%L, true, now() - interval ''1 hour'')::text', v_sess)) like 'ERR:Choose a time in the future%')::text);
  perform pg_temp.ck('...and the request is still waiting after those refusals', 'awaiting_clinician_approval', (select status::text from public.therapy_sessions where id = v_sess));
  perform pg_temp.ck('the queue read wrote one audit row for the patient served', '1',
    (select count(*)::text from public.audit_log where action = 'staff.mental_health_read' and result = 'success' and reason = 'therapy approval queue' and subject_patient_id = v_pat and actor_id = pg_temp.f('doctied')) );
  perform pg_temp.ck('a senior clinician without a tie cannot approve', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.approve_therapy_session(%L, true, now() + interval ''1 day'')::text', v_sess)) is null)::text);
  perform pg_temp.ck('a tied senior clinician with prescribing authority approves', 'confirmed',
    pg_temp.q_as(pg_temp.f('smotied'), format('select (public.approve_therapy_session(%L, true, now() + interval ''2 days'')).status::text', v_sess)));
  perform pg_temp.ck('...and the time it proposed is the scheduled time (the table constraint no longer blocks a confirm)', 'true',
    (select (scheduled_for > now() + interval '1 day')::text from public.therapy_sessions where id = v_sess));
  perform pg_temp.ck('a decided request cannot be decided again', 'true',
    (pg_temp.q_as(pg_temp.f('smotied'), format('select public.approve_therapy_session(%L, false)::text', v_sess)) like 'ERR:That request has already been decided%')::text);
  perform pg_temp.ck('...the approver is the session user', pg_temp.f('smotied')::text, (select approved_by::text from public.therapy_sessions where id = v_sess));
  perform pg_temp.ck('...and the decision is audited', '1', pg_temp.audit_n(pg_temp.f('smotied'), 'success')::text);
  perform pg_temp.act(v_pat);
  n := 0;
  begin update public.therapy_sessions set approved_by = v_pat, status = 'completed' where id = v_sess; get diagnostics n = row_count; exception when others then r := 'refused'; end;
  perform pg_temp.back();
  perform pg_temp.ck('the patient cannot confirm their own booking', '0', n::text);
  perform pg_temp.act(v_pat);
  update public.therapy_sessions set status = 'cancelled', cancelled_at = now() where id = v_sess;
  get diagnostics n = row_count;
  perform pg_temp.back();
  perform pg_temp.ck('the patient can cancel', '1', n::text);
end $$;

-- 5. Neutral text, sponsor report, corporate aggregate ----------------------------------------------------------------------------
do $$
declare v_pat2 uuid := pg_temp.f('pat2'); v_pat uuid := pg_temp.f('pat'); v_spons uuid := pg_temp.f('spons'); r text; v_i integer; v_u uuid; v_org uuid := pg_temp.f('org'); v_old integer;
begin
  perform pg_temp.ck('a crisis screen leaves no self-harm wording in an emergency event', '0',
    (select count(*)::text from public.emergency_events where patient_id = v_pat2 and (trigger_detail ilike '%self-harm%' or trigger_detail ilike '%PHQ%')));
  perform pg_temp.ck('a moderate screen leaves no score or instrument in an alert', '0',
    (select count(*)::text from public.clinician_alerts where patient_id = v_pat and (title ilike '%PHQ%' or title ilike '%mental%' or coalesce(detail, '') ~* '(phq|gad|scored|band)')));
  perform pg_temp.ck('a crisis leaves no wellbeing words in the alert detail', '0',
    (select count(*)::text from public.clinician_alerts where patient_id = v_pat2 and (coalesce(detail, '') ~* '(self-harm|phq|mental_health_screen|intake_screen)')));
  -- the one-off rewrite on a legacy row
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, category, type_code)
    select pg_temp.f('org'), v_pat, 'clinician_review', 'open', 'Mental-health screen: moderate concern — PHQ9', 'Screen x scored 12 (moderate band)', category, type_code
      from public.clinician_alerts where patient_id = v_pat limit 1;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, category, type_code)
    select pg_temp.f('org'), v_pat, 'clinician_review', 'open', 'AUDIT-C: hazardous alcohol use flagged', 'AUDIT-C total 9 crossed the hazardous-use threshold', category, type_code
      from public.clinician_alerts where patient_id = v_pat limit 1;
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (pg_temp.f('org'), pg_temp.f('cgyes'), 'intake_screen', 'Wellbeing check-in: reported thoughts of self-harm (PHQ-9 item 9)', 'resolved');
  v_old := private.s56_neutralise_mental_health_text();
  perform pg_temp.ck('the one-off rewrite neutralises a legacy mental-health alert, a legacy alcohol alert and a legacy emergency event', '3', v_old::text);
  perform pg_temp.ck('...nothing names AUDIT-C any more', '0', (select count(*)::text from public.clinician_alerts where title ilike '%AUDIT%' or detail ilike '%AUDIT%'));
  perform pg_temp.ck('...nor the self-harm words in an emergency event', '0', (select count(*)::text from public.emergency_events where trigger_detail ilike '%self-harm%'));
  -- sponsor: pays, patient chose activity, a mental-health alert is acknowledged
  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, face_value_kobo, amount_paid_kobo, status, activated_at, sku_code, service_product_id)
    select v_org, 'S56-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', v_pat, v_spons, 100000, 100000, 'active', now(), 'proof', id from public.service_products limit 1;
  insert into public.sponsor_sharing_preferences (organisation_id, patient_id, sponsor_id, level) values (v_org, v_pat, v_spons, 'activity');
  update public.clinician_alerts set status = 'acknowledged', acknowledged_at = now() where patient_id = v_pat;
  r := pg_temp.q_as(v_spons, format('select public.sponsor_care_report(%L)::text', v_pat));
  perform pg_temp.ck('the sponsor report carries no mental-health word', 'false', (r ~* '(phq|gad|mental|wellbeing|mood|self-harm|therapy)')::text);
  perform pg_temp.ck('...and a mental-health alert is not a clinical review', 'true', ((r::jsonb) ->> 'last_clinical_review' is null)::text);
  perform pg_temp.ck('a sponsor cannot call the audited read', 'true', (pg_temp.q_as(v_spons, format($q$select public.read_patient_mental_health_audited(%L)::text$q$, v_pat)) like 'ERR:not authorised%')::text);

  -- corporate aggregate: suppressed under the minimum cohort, never individual, test accounts excluded
  update public.organisations set min_cohort_size = 5 where id = v_org;
  for v_i in 1..4 loop
    v_u := pg_temp.mkuser(v_org, 'real' || v_i, 'patient');
    update public.profiles set is_test = false where id = v_u;
    insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (v_org, v_u, 'phq9', 2, 'minimal');
  end loop;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  r := public.corporate_wellbeing_cohort(v_org)::text;
  reset role;
  perform pg_temp.ck('four respondents are below the minimum cohort and suppressed', 'true', ((r::jsonb) ->> 'suppressed')::text);
  v_u := pg_temp.mkuser(v_org, 'real5', 'patient');
  update public.profiles set is_test = false where id = v_u;
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (v_org, v_u, 'phq9', 2, 'minimal');
  set local role service_role;
  r := public.corporate_wellbeing_cohort(v_org)::text;
  reset role;
  perform pg_temp.ck('five respondents are released as percentages', 'false', ((r::jsonb) ->> 'suppressed')::text);
  perform pg_temp.ck('...bands only, no scores and no ids', 'false', (r ~* '(total_score|patient_id|[0-9a-f]{8}-[0-9a-f]{4})')::text);
  perform pg_temp.ck('...and the percentages describe only real accounts (test accounts excluded)', '100', (r::jsonb) -> 'phq9' ->> 'minimal');
  perform pg_temp.ck('an authenticated user cannot call the aggregate', 'true', (pg_temp.q_as(pg_temp.f('corp'), format('select public.corporate_wellbeing_cohort(%L)::text', v_org)) like 'ERR:permission denied%')::text);

  -- follow-up pathway: guard off for a real account, on for a test account (S37 rule), crisis not duplicated
  perform pg_temp.ck('a real account gets no follow-up task while the guard is off', '0',
    (select count(*)::text from public.clinical_tasks where dedup_key like 'mh_follow_up:' || v_u || '%'));
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (v_org, v_u, 'phq9', 12, 'moderate');
  perform pg_temp.ck('...even for a moderate result', '0', (select count(*)::text from public.clinical_tasks where dedup_key like 'mh_follow_up:' || v_u || '%'));
  perform pg_temp.ck('a test account with a moderate result gets a follow-up task (existing type symptom_review)', 'symptom_review',
    (select type from public.clinical_tasks where dedup_key = 'mh_follow_up:' || v_pat || ':phq9'));
  perform pg_temp.ck('the questionnaire.completed event is on the outbox, ids only', 'true',
    (select (count(*) = 1 and bool_and(payload ? 'screen_id' and not payload ? 'total_score' and not payload ? 'instrument'))::text
       from public.domain_events where event_type = 'questionnaire.completed' and patient_id = v_pat and aggregate_id = pg_temp.f('screen_mod')));
  perform pg_temp.ck('the follow-up timings are unsigned', '0', (select count(*)::text from public.mental_health_follow_up_config where status = 'confirmed'));
end $$;

-- 6. Hand-off, crisis card -----------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); h uuid; r text;
begin
  h := pg_temp.q_as(v_pat, format($q$select public.request_mental_health_handoff(%L, 'I would like to talk to someone')::text$q$, pg_temp.f('screen_mod')))::uuid;
  perform pg_temp.ck('a patient hands off a screen to a consultation', 'true', (h is not null)::text);
  perform pg_temp.ck('a second tap on the same screen returns the same hand-off', h::text,
    pg_temp.q_as(v_pat, format($q$select public.request_mental_health_handoff(%L, 'again')::text$q$, pg_temp.f('screen_mod'))));
  perform pg_temp.ck('...and does not raise a second task', '1', (select count(*)::text from public.clinical_tasks where dedup_key like 'mh_handoff:%' and patient_id = v_pat));
  perform pg_temp.ck('...a task is raised', 'admin_clinical', (select type from public.clinical_tasks where dedup_key = 'mh_handoff:' || h));
  r := pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.read_patient_mental_health_audited(%L, 'reading the hand-off summary', array['handoffs'])::text$q$, v_pat));
  perform pg_temp.ck('the tied clinician reads the attached summary', 'phq9', r::jsonb -> 'handoffs' -> 0 -> 'summary' ->> 'instrument');
  perform pg_temp.ck('a patient cannot hand off someone else''s screen', 'true',
    (pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.request_mental_health_handoff(%L)::text$q$, pg_temp.f('screen_mod'))) like 'ERR:unknown screen%')::text);
  perform pg_temp.ck('staff cannot send a hand-off', 'true', (pg_temp.q_as(pg_temp.f('doctied'), 'select public.request_mental_health_handoff()::text') like 'ERR:not authorised%')::text);

  r := pg_temp.q_as(v_pat, 'select public.get_crisis_card()::text');
  perform pg_temp.ck('the card shows 112', '112', r::jsonb ->> 'emergency_number');
  perform pg_temp.ck('the card carries no helpline at all (founder decision 2026-10-07)', 'false', (r::jsonb ? 'helplines')::text);
  perform pg_temp.ck('no callback figure is promised while the SLA is unconfirmed', 'true', ((r::jsonb) -> 'callback_sla_minutes' = 'null'::jsonb)::text);
  perform pg_temp.ck('there is no helpline table', 'true', (to_regclass('public.crisis_helplines') is null)::text);
  perform pg_temp.ck('there is no helpline verify function', '0', (select count(*)::text from pg_proc where proname in ('verify_crisis_helpline', 'unverify_crisis_helpline')));
  perform pg_temp.ck('anon cannot reach the card', '42501', pg_temp.try_anon('select public.get_crisis_card()'));
end $$;

-- 6b. The organisation-wide emergency page carries no wellbeing label and no patient name (INV-07, INV-12) -------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); v_product uuid; v_doc uuid := pg_temp.f('doctied'); v_ctl uuid;
begin
  select id into v_product from public.service_products where is_active and 'vitals_red_flag_doctor_escalation' = any(features) order by code limit 1;
  if v_product is null then raise exception 'VACUOUS: no active service product carries the doctor-escalation feature'; end if;
  update public.profiles set full_name = 'Probe Name Pat' where id = v_pat;   -- mkuser leaves full_name null (the auth trigger made the row first)
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
    values (v_org, v_pat, v_pat, v_product, 'active', 1000000, 'NGN', now(), now() + interval '30 days');
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (v_org, v_pat, 'mental_health_screen', 'A check-in needs urgent follow-up', 'active');
  perform pg_temp.ck('a clinician was paged for the mental-health emergency (the safety net still fires)', '1',
    (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'emergency_event_clinician_alert' and payload ->> 'source_label' = 'a check-in'));
  perform pg_temp.ck('...no page carries the source name', '0',
    (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'emergency_event_clinician_alert' and payload ->> 'source_label' in ('mental_health_screen', 'intake_screen')));
  perform pg_temp.ck('...nor the patient name', '0',
    (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'emergency_event_clinician_alert' and payload ->> 'patient_name' like 'Probe Name%'));
  -- control, on a second entitled patient (the first already owns an open alert, which a second event would be attached to)
  v_ctl := pg_temp.mkuser(v_org, 'ctl', 'patient');
  update public.profiles set full_name = 'Probe Name Ctl' where id = v_ctl;
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
    values (v_org, v_ctl, v_ctl, v_product, 'active', 1000000, 'NGN', now(), now() + interval '30 days');
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (v_org, v_ctl, 'bp_reading', 'proof control', 'active');
  perform pg_temp.ck('control: a blood pressure emergency page still names its source and the patient', '1',
    (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'emergency_event_clinician_alert' and payload ->> 'source_label' = 'bp_reading' and payload ->> 'patient_name' = 'Probe Name Ctl'));
end $$;

-- 7. SABOTAGE: each protection removed must flip its checks ---------------------------------------------------------------------
create policy mhs_sabotage on public.mental_health_screens for select to authenticated using (private.is_org_staff(organisation_id));
create or replace function private.can_staff_read_mental_health(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
create or replace function private.supporter_has_mental_health_consent(p_patient uuid, p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profile_access pa where pa.profile_id = p_patient and pa.grantee_user_id = p_user) $$;
create or replace function public.get_crisis_card() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('emergency_number', '112', 'helplines', '[]'::jsonb, 'callback_sla_minutes', null) $$;
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.handle_emergency_event()'::regprocedure);
  execute replace(replace(v_def, E'case when new.source::text in (\'mental_health_screen\', \'intake_screen\') then \'a check-in\' else new.source::text end', 'new.source::text'),
    E'case when new.source::text in (\'mental_health_screen\', \'intake_screen\') then \'A patient\' else coalesce((select full_name from public.profiles where id = new.patient_id), \'A patient\') end',
    E'coalesce((select full_name from public.profiles where id = new.patient_id), \'A patient\')');
end $$;
do $$
begin
  perform pg_temp.sab('a staff member reads no screens directly', '0', pg_temp.cnt(pg_temp.f('docuntied'), 'mental_health_screens'));
  perform pg_temp.sab('a clinician without a tie is denied', 'denied',
    pg_temp.q_as(pg_temp.f('docuntied'), format($q$select (public.read_patient_mental_health_audited(%L, 'checking this chart today'))->>'status'$q$, pg_temp.f('pat'))));
  perform pg_temp.sab('a caregiver without the category reads nothing', '0', pg_temp.cnt(pg_temp.f('cgno'), 'wellbeing_checkins'));
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
    values (pg_temp.f('org'), pg_temp.f('pat'), 'mental_health_screen', 'A check-in needs urgent follow-up', 'active');
  perform pg_temp.sab('the organisation-wide page carries no wellbeing source name', '0',
    (select count(*)::text from public.notifications where recipient_id = pg_temp.f('doctied') and template = 'emergency_event_clinician_alert' and payload ->> 'source_label' = 'mental_health_screen'));
  perform pg_temp.sab('...and no patient name', '0',
    (select count(*)::text from public.notifications where recipient_id = pg_temp.f('doctied') and template = 'emergency_event_clinician_alert' and payload ->> 'patient_name' like 'Probe Name%' and payload ->> 'source_label' = 'mental_health_screen'));
  perform pg_temp.sab('the card carries no helpline at all', 'false', ((pg_temp.q_as(pg_temp.f('pat'), 'select public.get_crisis_card()::text')::jsonb) ? 'helplines')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S56 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 6 then raise exception 'VACUOUS TEST: the sabotage flipped % of 6 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
