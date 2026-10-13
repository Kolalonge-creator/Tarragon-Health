-- ===========================================================================
-- Proof: 20261007112207_s38e_sponsor_cohorts_and_triage_accuracy.sql (v5 S38, Module 22.4, 22.6, 22.9; INV-10, INV-13, I9).
--
-- SPONSORS
--   1. Only an admin creates a cohort; the code has the right shape; an organisation that is not an hmo, corporate or ngo cannot be a sponsor.
--   2. Joining: a good code joins; an unknown, expired, closed and full code give the SAME answer; a repeat join is "already"; ten bad tries stop even a
--      good code for an hour; a non-patient and a dependent cannot join.
--   3. Consent: not available while the draft text is not current; once current it is recorded in patient_consents (accepted), a second cohort adds no
--      second row, withdrawing from the last one writes the withdrawal, leaving ends sharing.
--   4. The report is aggregate only: it counts only members who agreed, never a test account; a small group is withheld whole; the "how many agreed"
--      figure is withheld when the people who did not agree would be a small group; exact numbers when large enough; engagement and adherence separate;
--      refused for a patient and a clinician; every run and export is audited.
-- TRIAGE
--   5. With the switch off nothing can be recorded; a review needs the clinician who completed the task; impossible pairs and duplicates are refused;
--      the list shows no patient identity; the report keeps draft-rule-set reviews and test accounts out, shows coverage, withholds a small group and the
--      next smallest, and is refused for a clinician.
--   6. SABOTAGE: the consent filter removed from the sponsor report (a non-consenting member must then appear) and the completer check removed from the
--      triage review (another clinician must then succeed); both checks must flip.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temp table s38e_results (check_name text, observed text, expected text, verdict text);
grant all on s38e_results to public;

create function pg_temp.mkuser(p_role text, p_state text default 'Lagos', p_dependent boolean default false) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's38e-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, state, sex, date_of_birth, is_dependent_account)
  values (v, v_org, p_role::public.user_role, 'S38e ' || p_role, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), p_state, 'female', date '1975-05-05', p_dependent)
  on conflict (id) do update set role = excluded.role, state = excluded.state, is_dependent_account = excluded.is_dependent_account;
  return v;
end $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;

-- builds a completed task from a graded event, completed by the given clinician
create function pg_temp.mktask(p_patient uuid, p_grade text, p_shadow boolean, p_clin uuid, p_test boolean default false) returns uuid language plpgsql as $f$
  declare v_ev uuid; v_t uuid; v_rs record;
  begin
    select id, code, version into v_rs from public.triage_rule_sets order by created_at limit 1;
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values ((select id from public.organisations order by created_at limit 1), p_patient, 'observation', gen_random_uuid(), p_grade, v_rs.id, v_rs.code, v_rs.version,
            case when p_shadow then 'draft' else 'approved' end,
            case when p_grade = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end, p_shadow, p_test, gen_random_uuid()::text) returning id into v_ev;
    perform set_config('tarragon.task_transition', 'on', true);   -- the proof stands in for the queue functions that create tasks
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, completed_at, outcome, triage_event_id, is_test)
    values ((select id from public.organisations order by created_at limit 1), 'amber_bp_review', 1, 4, 4, p_patient, 'senior_medical_officer', now(), 'completed', now(), '{"done":true}'::jsonb, v_ev, p_test) returning id into v_t;
    perform set_config('tarragon.task_transition', 'off', true);
    insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, ended_at, end_reason, is_test)
    values ((select id from public.organisations order by created_at limit 1), v_t, p_clin, now() + interval '1 hour', now(), 'completed', p_test);
    return v_t;
  end $f$;


create function pg_temp.rev(p_clin uuid, p_task uuid, p_agree text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.record_triage_review(p_task, p_agree);
  execute 'reset role';
end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_sp uuid; v_ngo uuid; v_clinic uuid;
  adm uuid; clin uuid; clin2 uuid; v_dep uuid; v_coach uuid; v_cohort uuid; v_cohort2 uuid; v_code text; v_code2 text;
  v_r jsonb; v_r2 jsonb; v_n integer; v_txt text; i integer; p uuid; pts uuid[] := '{}'; v_nonc uuid; v_test uuid;
  v_ver integer := (select version from public.outcome_config where is_active); v_cat timestamptz; v_v2 uuid;
  v_draft uuid; v_rs record; v_ev uuid; v_task uuid; pl uuid; pk uuid; pr uuid; ptest uuid; psh uuid; k integer; v_ok boolean;
begin
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '1') where is_active;   -- the sponsor's own floor then decides
  insert into public.organisations (name, type) values ('S38e Sponsor Corp', 'corporate') returning id into v_sp;
  insert into public.organisations (name, type) values ('S38e Clinic', 'clinic') returning id into v_clinic;
  update public.organisations set min_cohort_size = 5 where id = v_sp;
  adm := pg_temp.mkuser('admin'); clin := pg_temp.mkuser('clinician'); clin2 := pg_temp.mkuser('clinician'); v_coach := pg_temp.mkuser('patient');
  v_dep := pg_temp.mkuser('patient', 'Lagos', true);

  -- =============================== 1. cohorts ===============================
  perform pg_temp.as_user(clin);  execute 'set local role authenticated';
  begin perform public.admin_create_sponsor_cohort(v_sp, 'Acme staff', current_date - 1, current_date + 60, 100); insert into s38e_results values ('1a a clinician cannot create a cohort', 'created', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38e_results values ('1a a clinician cannot create a cohort', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.admin_create_sponsor_cohort(v_sp, 'Acme staff', current_date - 1, current_date + 60, 100);
  begin perform public.admin_create_sponsor_cohort(v_clinic, 'Wrong kind', current_date - 1, current_date + 60, 100); insert into s38e_results values ('1c a clinic cannot be a sponsor', 'created', 'refused', 'FAIL');
  exception when sqlstate '22023' then insert into s38e_results values ('1c a clinic cannot be a sponsor', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  v_cohort := (v_r ->> 'id')::uuid; v_code := v_r ->> 'code';
  insert into s38e_results values ('1b the code is 8 characters from the safe alphabet', v_code, 'matches', case when v_code ~ '^[A-HJ-NP-Z2-9]{8}$' then 'PASS' else 'FAIL' end);

  -- =============================== 2. joining ===============================
  -- expired, closed and full cohorts
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r2 := public.admin_create_sponsor_cohort(v_sp, 'Full one', current_date - 1, current_date + 60, 1); v_cohort2 := (v_r2 ->> 'id')::uuid; v_code2 := v_r2 ->> 'code';
  execute 'reset role';
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses) values (v_org, v_sp, 'Old one', 'ZZZZZZZ2', current_date - 30, current_date - 1, 50);
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, status) values (v_org, v_sp, 'Shut one', 'ZZZZZZZ3', current_date - 30, current_date + 30, 50, 'closed');

  p := pg_temp.mkuser('patient'); pts := pts || p;
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  v_r := public.join_cohort(v_code);
  insert into s38e_results values ('2a a good code joins', (v_r ->> 'ok') || '/' || (v_r ->> 'status') || '/' || (v_r ->> 'sponsor'), 'true/joined/S38e Sponsor Corp', case when v_r ->> 'ok' = 'true' and v_r ->> 'status' = 'joined' then 'PASS' else 'FAIL' end);
  v_r := public.join_cohort(lower(substr(v_code, 1, 4) || '-' || substr(v_code, 5)));
  insert into s38e_results values ('2b a repeat (in any case, with a dash) is "already"', v_r ->> 'status', 'already', case when v_r ->> 'status' = 'already' then 'PASS' else 'FAIL' end);
  execute 'reset role';
  select uses into v_n from public.sponsor_cohorts where id = v_cohort;
  insert into s38e_results values ('2c uses went up by one, not two', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  -- the full cohort: first patient takes the one place, second is refused
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.join_cohort(v_code2);
  execute 'reset role';
  pk := pg_temp.mkuser('patient');
  perform pg_temp.as_user(pk);  execute 'set local role authenticated';
  v_r := public.join_cohort(v_code2);                 -- full
  v_r2 := public.join_cohort('NOSUCHCODE');           -- unknown
  insert into s38e_results values ('2d a full code and an unknown code give the same answer', v_r::text || '=' || v_r2::text, '{"ok": false}={"ok": false}', case when v_r = v_r2 and v_r = '{"ok": false}'::jsonb then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('2e an expired code and a closed code give that same answer too', (public.join_cohort('ZZZZZZZ2') = v_r and public.join_cohort('ZZZZZZZ3') = v_r)::text, 'true',
    case when public.join_cohort('ZZZZZZZ2') = v_r and public.join_cohort('ZZZZZZZ3') = v_r then 'PASS' else 'FAIL' end);
  -- ten failures so far (1 full, 1 unknown, 2 expired/closed, 2 more evaluations above = 6); push to 10 then a good code must fail
  for i in 1..6 loop perform public.join_cohort('NOPE' || i); end loop;
  v_r := public.join_cohort(v_code);
  execute 'reset role';
  insert into s38e_results values ('2f ten bad tries stop even a good code for an hour', v_r::text, '{"ok": false}', case when v_r = '{"ok": false}'::jsonb then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user(clin);  execute 'set local role authenticated';
  v_r := public.join_cohort(v_code);
  execute 'reset role';
  insert into s38e_results values ('2g a clinician cannot join a cohort', v_r::text, '{"ok": false}', case when v_r = '{"ok": false}'::jsonb then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(v_dep);  execute 'set local role authenticated';
  v_r := public.join_cohort(v_code);
  execute 'reset role';
  insert into s38e_results values ('2h a dependent account cannot join', v_r::text, '{"ok": false}', case when v_r = '{"ok": false}'::jsonb then 'PASS' else 'FAIL' end);

  -- leaving and coming back does not use another place
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.leave_cohort(v_cohort);
  v_r := public.join_cohort(v_code);
  execute 'reset role';
  select uses into v_n from public.sponsor_cohorts where id = v_cohort;
  insert into s38e_results values ('2i leave and rejoin: still one place used, and the person is back in', (v_r ->> 'status') || '/' || v_n, 'joined/1', case when v_r ->> 'status' = 'joined' and v_n = 1 then 'PASS' else 'FAIL' end);
  -- the one place of the full cohort is held by p; a returning member gets back in even though it is full, a newcomer does not
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.leave_cohort(v_cohort2);
  v_r := public.join_cohort(v_code2);
  execute 'reset role';
  insert into s38e_results values ('2j a returning member re-enters a full programme', v_r ->> 'status', 'joined', case when v_r ->> 'status' = 'joined' then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.cohort_join_attempts where organisation_id is null;
  insert into s38e_results values ('2k failed tries carry their organisation', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);

  -- =============================== 3. consent ===============================
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  v_r := public.set_cohort_reporting_consent(v_cohort, true);
  execute 'reset role';
  insert into s38e_results values ('3a consent is not available while the text is a draft', coalesce(v_r ->> 'reason', 'none'), 'not_available', case when v_r ->> 'reason' = 'not_available' then 'PASS' else 'FAIL' end);
  update public.consent_versions set is_current = true where consent_type = 'sponsor_reporting' and version = '2026-10-07-draft';   -- as counsel will, in the proof only
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  v_r := public.set_cohort_reporting_consent(v_cohort, true);
  execute 'reset role';
  select count(*) into v_n from public.patient_consents where patient_id = p and consent_type = 'sponsor_reporting' and action = 'accepted';
  insert into s38e_results values ('3b consent is recorded once in patient_consents', (v_r ->> 'ok') || '/' || v_n, 'true/1', case when v_r ->> 'ok' = 'true' and v_n = 1 then 'PASS' else 'FAIL' end);
  select consented_at into v_cat from public.profile_cohorts where patient_id = p and cohort_id = v_cohort and left_at is null;
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.set_cohort_reporting_consent(v_cohort, true);   -- again: nothing changes
  execute 'reset role';
  select count(*) into v_n from public.audit_log where actor_id = p and action = 'sponsor.consent_given';
  insert into s38e_results values ('3b2 agreeing again changes nothing: same date, one audit row', ((select consented_at = v_cat from public.profile_cohorts where patient_id = p and cohort_id = v_cohort and left_at is null))::text || '/' || v_n, 'true/1',
    case when (select consented_at = v_cat from public.profile_cohorts where patient_id = p and cohort_id = v_cohort and left_at is null) and v_n = 1 then 'PASS' else 'FAIL' end);
  -- a second cohort for the same person: no second acceptance row
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.join_cohort(v_code2);   -- already holds the one place of cohort2
  v_r := public.set_cohort_reporting_consent(v_cohort2, true);
  execute 'reset role';
  select count(*) into v_n from public.patient_consents where patient_id = p and consent_type = 'sponsor_reporting' and action = 'accepted';
  insert into s38e_results values ('3c a second cohort adds no second acceptance row', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.set_cohort_reporting_consent(v_cohort2, false);
  execute 'reset role';
  select count(*) into v_n from public.patient_consents where patient_id = p and consent_type = 'sponsor_reporting' and action = 'withdrawn';
  insert into s38e_results values ('3d withdrawing from one of two keeps the global consent in force', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.set_cohort_reporting_consent(v_cohort2, false);   -- already off: no new event
  execute 'reset role';
  select count(*) into v_n from public.audit_log where actor_id = p and action = 'sponsor.consent_withdrawn';
  insert into s38e_results values ('3d2 withdrawing when nothing was shared logs nothing new', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(p);  execute 'set local role authenticated';
  perform public.leave_cohort(v_cohort);
  execute 'reset role';
  select count(*) into v_n from public.patient_consents where patient_id = p and consent_type = 'sponsor_reporting' and action = 'withdrawn';
  select (left_at is not null and not reporting_consent)::text into v_txt from public.profile_cohorts where patient_id = p and cohort_id = v_cohort;
  insert into s38e_results values ('3e leaving the last consenting cohort writes the withdrawal and ends sharing', v_n || '/' || v_txt, '1/true', case when v_n = 1 and v_txt = 'true' then 'PASS' else 'FAIL' end);

  -- =============================== 4. the report ===============================
  -- 10 consenting members (5 controlled, 5 with too few readings), 1 member who did not agree, 1 test account that did. All in one cohort.
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.admin_create_sponsor_cohort(v_sp, 'Report cohort', current_date - 1, current_date + 60, 100);
  execute 'reset role';
  v_cohort := (v_r ->> 'id')::uuid; v_code := v_r ->> 'code'; pts := '{}';
  for i in 1..10 loop
    p := pg_temp.mkuser('patient'); pts := pts || p;
    perform pg_temp.as_user(p);  execute 'set local role authenticated';
    perform public.join_cohort(v_code); perform public.set_cohort_reporting_consent(v_cohort, true);
    execute 'reset role';
    insert into public.outcome_snapshots (organisation_id, patient_id, day, anchor_date, window_start, window_end, bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d, bp_status, controlled, target_sys, target_dia, target_source, config_version)
    values (v_org, p, 90, date '2026-06-10', date '2026-09-02', date '2026-09-08',
            case when i <= 5 then 130 end, case when i <= 5 then 80 end, case when i <= 5 then 4 else 1 end,
            case when i <= 5 then 'controlled' else 'insufficient_data' end, case when i <= 5 then true end, 140, 90, 'default', v_ver);
    if i <= 5 then
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values (v_org, p, 'blood_pressure', 130, 80, now() - interval '3 days', 'device');
    end if;
  end loop;
  v_nonc := pg_temp.mkuser('patient');
  perform pg_temp.as_user(v_nonc);  execute 'set local role authenticated';
  perform public.join_cohort(v_code);
  execute 'reset role';
  insert into public.outcome_snapshots (organisation_id, patient_id, day, anchor_date, window_start, window_end, bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d, bp_status, controlled, target_sys, target_dia, target_source, config_version)
  values (v_org, v_nonc, 90, date '2026-06-10', date '2026-09-02', date '2026-09-08', 170, 100, 4, 'uncontrolled', false, 140, 90, 'default', v_ver);
  v_test := pg_temp.mkuser('patient');
  perform set_config('request.jwt.claims', '', true);   -- a service context: only an admin or service may flag a test account
  update public.profiles set is_test = true where id = v_test;
  perform pg_temp.as_user(v_test);  execute 'set local role authenticated';
  perform public.join_cohort(v_code); perform public.set_cohort_reporting_consent(v_cohort, true);
  execute 'reset role';
  insert into public.outcome_snapshots (organisation_id, patient_id, day, anchor_date, window_start, window_end, bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d, bp_status, controlled, target_sys, target_dia, target_source, config_version, is_test)
  values (v_org, v_test, 90, date '2026-06-10', date '2026-09-02', date '2026-09-08', 120, 78, 4, 'controlled', true, 140, 90, 'default', v_ver, true);

  perform pg_temp.as_user(clin);  execute 'set local role authenticated';
  begin perform public.sponsor_outcome_report(v_cohort); insert into s38e_results values ('4a a clinician is refused the sponsor report', 'ran', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38e_results values ('4a a clinician is refused the sponsor report', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  perform pg_temp.as_user(pts[1]);  execute 'set local role authenticated';
  begin perform public.sponsor_outcome_report(v_cohort); insert into s38e_results values ('4b a patient is refused the sponsor report', 'ran', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38e_results values ('4b a patient is refused the sponsor report', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  insert into s38e_results values ('4c anon cannot execute the report', has_function_privilege('anon', 'public.sponsor_outcome_report(uuid,date,date)', 'EXECUTE')::text, 'false',
    case when not has_function_privilege('anon', 'public.sponsor_outcome_report(uuid,date,date)', 'EXECUTE') then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.sponsor_outcome_report(v_cohort);
  execute 'reset role';
  insert into s38e_results values ('4d the figures count only members who agreed: strict 50.0 of 10, among measured 100.0, missing 50.0',
    (v_r #>> '{bp_control_90d,n}') || '/' || (v_r #>> '{bp_control_90d,controlled}') || '/' || (v_r #>> '{bp_control_90d,rate_strict_pct}') || '/' || (v_r #>> '{bp_control_90d,rate_among_measured_pct}') || '/' || (v_r #>> '{bp_control_90d,missing_pct}'),
    '10/5/50.0/100.0/50.0', case when (v_r #>> '{bp_control_90d,n}') = '10' and (v_r #>> '{bp_control_90d,controlled}') = '5' and (v_r #>> '{bp_control_90d,rate_strict_pct}')::numeric = 50.0
      and (v_r #>> '{bp_control_90d,rate_among_measured_pct}')::numeric = 100.0 and (v_r #>> '{bp_control_90d,missing_pct}')::numeric = 50.0 then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('4e the member who did not agree and the test account are in no figure (no uncontrolled, no 11th person)', (v_r #>> '{bp_control_90d,uncontrolled}') || '/' || (v_r #>> '{bp_control_90d,n}'), '0/10',
    case when (v_r #>> '{bp_control_90d,uncontrolled}') = '0' and (v_r #>> '{bp_control_90d,n}') = '10' then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('4f how many agreed is withheld because the one who did not agree would be a small group', coalesce(v_r #>> '{members,suppressed}', 'null'), 'true',
    case when v_r #>> '{members,suppressed}' = 'true' then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('4g engagement is its own measure (5 of 10 logged in 30 days)', coalesce(v_r #>> '{engagement_separate,logged_a_reading_in_30_days_pct}', 'null'), '50.0',
    case when (v_r #>> '{engagement_separate,logged_a_reading_in_30_days_pct}')::numeric = 50.0 then 'PASS' else 'FAIL' end);
  v_txt := v_r::text;
  insert into s38e_results values ('4h the report names no individual', (v_txt ~* 'patient_id|full_name|phone|@example|subject')::text, 'false', case when v_txt !~* 'patient_id|full_name|phone|@example|subject' then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('4i the sponsor floor (5) was used, not the platform floor (1)', v_r ->> 'minimum_cell', '5', case when v_r ->> 'minimum_cell' = '5' then 'PASS' else 'FAIL' end);

  -- the one who did not agree now agrees: nobody is left out, so how many agreed can be shown
  perform pg_temp.as_user(v_nonc);  execute 'set local role authenticated';
  perform public.set_cohort_reporting_consent(v_cohort, true);
  execute 'reset role';
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.sponsor_outcome_report(v_cohort);
  execute 'reset role';
  insert into s38e_results values ('4j with everyone agreed the member count is shown (11 of 11) and the new person is counted (n 11)',
    coalesce(v_r #>> '{members,agreed_to_share}', 'null') || '/' || (v_r #>> '{bp_control_90d,n}'), '11/11',
    case when v_r #>> '{members,agreed_to_share}' = '11' and v_r #>> '{bp_control_90d,n}' = '11' then 'PASS' else 'FAIL' end);
  -- the lone uncontrolled person is a category of 1 (below 5): the whole cohort is withheld, so he cannot be worked out
  insert into s38e_results values ('4k a category of one person (1 uncontrolled, floor 5) withholds the whole cohort', coalesce(v_r #>> '{bp_control_90d,suppressed}', 'null') || '/' || coalesce(v_r #>> '{bp_control_90d,reason}', 'null'), 'true/small_cell',
    case when v_r #>> '{bp_control_90d,suppressed}' = 'true' and v_r #>> '{bp_control_90d,reason}' = 'small_cell' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(v_nonc);  execute 'set local role authenticated';
  perform public.set_cohort_reporting_consent(v_cohort, false);
  execute 'reset role';

  -- six members withdraw: only 4 agreed, under the floor of 5
  for i in 1..6 loop
    perform pg_temp.as_user(pts[i]);  execute 'set local role authenticated';
    perform public.set_cohort_reporting_consent(v_cohort, false);
    execute 'reset role';
  end loop;
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.sponsor_outcome_report(v_cohort);
  execute 'reset role';
  insert into s38e_results values ('4l with 4 agreed (floor 5) no figure is shown at all', coalesce(v_r #>> '{bp_control_90d,suppressed}', 'null') || '/' || coalesce(v_r #>> '{bp_control_90d,reason}', 'null') || '/' || coalesce(v_r #>> '{engagement_separate,suppressed}', 'null'), 'true/under_minimum/true',
    case when v_r #>> '{bp_control_90d,suppressed}' = 'true' and v_r #>> '{bp_control_90d,reason}' = 'under_minimum' and v_r #>> '{engagement_separate,suppressed}' = 'true' then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.audit_log where actor_id = adm and action = 'sponsor.outcome_report';
  insert into s38e_results values ('4m every report run is audited', v_n::text, '3', case when v_n = 3 then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  perform public.log_sponsor_export(v_cohort, null, null);
  execute 'reset role';
  select count(*) into v_n from public.audit_log where actor_id = adm and action = 'sponsor.outcome_export';
  insert into s38e_results values ('4n an export is audited', v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);

  -- the text changes: members who agreed to the old wording drop out of the report and show as not sharing until they agree again
  for i in 1..6 loop perform pg_temp.as_user(pts[i]);  execute 'set local role authenticated'; perform public.set_cohort_reporting_consent(v_cohort, true); execute 'reset role'; end loop;
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.sponsor_outcome_report(v_cohort);
  execute 'reset role';
  insert into s38e_results values ('4o (before) with 10 agreed on the text in force the figures show', coalesce(v_r #>> '{bp_control_90d,n}', 'null'), '10', case when v_r #>> '{bp_control_90d,n}' = '10' then 'PASS' else 'FAIL' end);
  update public.consent_versions set is_current = false where consent_type = 'sponsor_reporting' and is_current;
  insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional) values ('sponsor_reporting', '2026-10-08-v2', 'Share group figures with a programme', 'Wider wording for the proof.', true, true) returning id into v_v2;
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.sponsor_outcome_report(v_cohort);
  execute 'reset role';
  insert into s38e_results values ('4o a changed consent text takes everyone out of the figures until they agree again', coalesce(v_r #>> '{bp_control_90d,reason}', 'null'), 'under_minimum', case when v_r #>> '{bp_control_90d,reason}' = 'under_minimum' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(pts[1]);  execute 'set local role authenticated';
  select (c ->> 'reporting_consent') into v_txt from jsonb_array_elements(public.my_cohorts()) c where c ->> 'cohort_id' = v_cohort::text;
  execute 'reset role';
  insert into s38e_results values ('4p the member sees "not sharing" for the old wording', v_txt, 'false', case when v_txt = 'false' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(pts[1]);  execute 'set local role authenticated';
  v_r := public.set_cohort_reporting_consent(v_cohort, true);
  execute 'reset role';
  select (consent_version_id = v_v2) into v_ok from public.profile_cohorts where patient_id = pts[1] and cohort_id = v_cohort and left_at is null;
  insert into s38e_results values ('4q agreeing again records the new wording', (v_r ->> 'ok') || '/' || v_ok, 'true/true', case when v_r ->> 'ok' = 'true' and v_ok then 'PASS' else 'FAIL' end);

  -- =============================== 5. triage agreement ===============================
  select id, code, version into v_rs from public.triage_rule_sets order by created_at limit 1;
  pl := pg_temp.mkuser('patient', 'Lagos'); pk := pg_temp.mkuser('patient', 'Kano'); pr := pg_temp.mkuser('patient', 'Rivers');
  ptest := pg_temp.mkuser('patient', 'Lagos');
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set is_test = true where id = ptest;
  psh := pg_temp.mkuser('patient', 'Lagos');

  -- switch off: nothing can be recorded and the list says so
  v_task := pg_temp.mktask(pl, 'green', false, clin);
  perform pg_temp.as_user(clin);  execute 'set local role authenticated';
  v_r := public.record_triage_review(v_task, 'right');
  v_r2 := public.clinician_triage_review_list();
  execute 'reset role';
  insert into s38e_results values ('5a with the switch off nothing is recorded and the list is "not_available"', (v_r ->> 'status') || '/' || (v_r2 ->> 'status'), 'not_available/not_available',
    case when v_r ->> 'status' = 'not_available' and v_r2 ->> 'status' = 'not_available' then 'PASS' else 'FAIL' end);
  update public.platform_switches set is_on = true where key = 'triage_agreement_capture';
  select count(*) into v_n from public.triage_reviews;
  insert into s38e_results values ('5b nothing was written while it was off', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);

  perform pg_temp.as_user(clin2);  execute 'set local role authenticated';
  v_r := public.record_triage_review(v_task, 'right');
  execute 'reset role';
  insert into s38e_results values ('5c a clinician who did not complete the task gets "not_found"', v_r ->> 'status', 'not_found', case when v_r ->> 'status' = 'not_found' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(clin);  execute 'set local role authenticated';
  begin perform public.record_triage_review(v_task, 'should_have_been_lower'); insert into s38e_results values ('5d "should have been lower" on a green grade is refused', 'ok', 'refused', 'FAIL');
  exception when sqlstate '22023' then insert into s38e_results values ('5d "should have been lower" on a green grade is refused', 'refused', 'refused', 'PASS'); end;
  begin perform public.record_triage_review(v_task, 'maybe'); insert into s38e_results values ('5e an unknown answer is refused', 'ok', 'refused', 'FAIL');
  exception when sqlstate '22023' then insert into s38e_results values ('5e an unknown answer is refused', 'refused', 'refused', 'PASS'); end;
  v_r := public.record_triage_review(v_task, 'right');
  v_r2 := public.record_triage_review(v_task, 'should_have_been_higher');
  execute 'reset role';
  insert into s38e_results values ('5f the owner records it once; a second try is "already_reviewed"', (v_r ->> 'status') || '/' || (v_r2 ->> 'status'), 'ok/already_reviewed',
    case when v_r ->> 'status' = 'ok' and v_r2 ->> 'status' = 'already_reviewed' then 'PASS' else 'FAIL' end);
  begin update public.triage_reviews set agreement = 'right'; insert into s38e_results values ('5g a review cannot be rewritten', 'updated', 'refused', 'FAIL');
  exception when others then insert into s38e_results values ('5g a review cannot be rewritten', sqlerrm, 'triage_reviews_append_only', case when sqlerrm = 'triage_reviews_append_only' then 'PASS' else 'FAIL' end); end;

  -- the rest: green 5 (3 right 2 higher), amber 6 (4 right 2 lower), red 2 (2 right). v_task already counts as a green right (Lagos).
  -- Kano: 1 green right. Rivers: 2 red right. Lagos: the rest.
  for k in 1..2 loop perform pg_temp.rev(clin, pg_temp.mktask(pl, 'green', false, clin), 'should_have_been_higher'); end loop;   -- 2 green higher (Lagos)
  perform pg_temp.rev(clin, pg_temp.mktask(pl, 'green', false, clin), 'right');   -- green right (Lagos) #2
  perform pg_temp.rev(clin, pg_temp.mktask(pk, 'green', false, clin), 'right');   -- green right (Kano) #3
  for k in 1..4 loop perform pg_temp.rev(clin, pg_temp.mktask(pl, 'amber', false, clin), 'right'); end loop;
  for k in 1..2 loop perform pg_temp.rev(clin, pg_temp.mktask(pl, 'amber', false, clin), 'should_have_been_lower'); end loop;
  for k in 1..2 loop perform pg_temp.rev(clin, pg_temp.mktask(pr, 'red', false, clin), 'right'); end loop;
  -- 2 reviews of a grade from a draft rule set, 1 by a test account (both must stay out of every figure)
  for k in 1..2 loop perform pg_temp.rev(clin, pg_temp.mktask(psh, 'amber', true, clin), 'should_have_been_higher'); end loop;
  perform pg_temp.rev(clin, pg_temp.mktask(ptest, 'amber', false, clin, true), 'should_have_been_higher');
  -- 3 completed tasks nobody has reviewed yet
  for k in 1..3 loop perform pg_temp.mktask(pl, 'amber', false, clin); end loop;

  perform pg_temp.as_user(clin);  execute 'set local role authenticated';
  v_r := public.clinician_triage_review_list();
  execute 'reset role';
  insert into s38e_results values ('5h the list shows the 3 unreviewed tasks, with no patient identity', jsonb_array_length(v_r -> 'rows') || '/' || ((v_r -> 'rows')::text ~* 'patient|name|phone')::text, '3/false',
    case when jsonb_array_length(v_r -> 'rows') = 3 and (v_r -> 'rows')::text !~* 'patient|name|phone' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(clin2);  execute 'set local role authenticated';
  v_r := public.clinician_triage_review_list();
  execute 'reset role';
  insert into s38e_results values ('5i another clinician''s list is empty', jsonb_array_length(v_r -> 'rows')::text, '0', case when jsonb_array_length(v_r -> 'rows') = 0 then 'PASS' else 'FAIL' end);

  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '2') where is_active;
  perform pg_temp.as_user(clin);  execute 'set local role authenticated';
  begin perform public.triage_accuracy_report(); insert into s38e_results values ('5j a clinician is refused the accuracy report', 'ran', 'refused', 'FAIL');
  exception when insufficient_privilege then insert into s38e_results values ('5j a clinician is refused the accuracy report', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.triage_accuracy_report(current_date - 1, current_date + 1);
  execute 'reset role';
  insert into s38e_results values ('5k overall: 13 reviewed, 9 right (69.2), 2 higher (15.4), 2 lower (15.4); draft and test reviews left out',
    (v_r #>> '{overall,reviewed}') || '/' || (v_r #>> '{overall,agree_pct}') || '/' || (v_r #>> '{overall,should_have_been_higher_pct}') || '/' || (v_r #>> '{overall,should_have_been_lower_pct}'),
    '13/69.2/15.4/15.4', case when (v_r #>> '{overall,reviewed}') = '13' and (v_r #>> '{overall,agree_pct}')::numeric = 69.2 and (v_r #>> '{overall,should_have_been_higher_pct}')::numeric = 15.4
      and (v_r #>> '{overall,should_have_been_lower_pct}')::numeric = 15.4 then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('5l by grade: green 5 reviewed 60.0 agree; amber 6 reviewed 66.7; red 2 reviewed 100.0',
    (select string_agg((g ->> 'reviewed') || ':' || (g ->> 'agree_pct'), ',' order by g ->> 'graded_as') from jsonb_array_elements(v_r -> 'by_grade') g),
    '6:66.7,5:60.0,2:100.0', case when (select string_agg((g ->> 'reviewed') || ':' || (g ->> 'agree_pct'), ',' order by g ->> 'graded_as') from jsonb_array_elements(v_r -> 'by_grade') g) = '6:66.7,5:60.0,2:100.0' then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('5m coverage is honest: 13 reviewed of 16 tasks that could have been (81.3, not low)', (v_r #>> '{coverage,reviewed}') || '/' || (v_r #>> '{coverage,completed_tasks_from_a_grade}') || '/' || (v_r #>> '{coverage,reviewed_pct}') || '/' || (v_r #>> '{coverage,low_coverage}'),
    '13/16/81.3/false', case when (v_r #>> '{coverage,reviewed}') = '13' and (v_r #>> '{coverage,completed_tasks_from_a_grade}') = '16' and (v_r #>> '{coverage,reviewed_pct}')::numeric = 81.3 and (v_r #>> '{coverage,low_coverage}') = 'false' then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('5n draft-rule-set reviews are counted apart (2), not in any figure', coalesce(v_r ->> 'draft_rule_set_reviews', 'null'), '2', case when v_r ->> 'draft_rule_set_reviews' = '2' then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('5o by state: Kano (1 review) withheld, Rivers (the next smallest) withheld too, Lagos shown',
    (select (c ->> 'suppressed') from jsonb_array_elements(v_r #> '{by,state}') c where c ->> 'key' = 'Kano') || '/' || (select (c ->> 'suppressed') from jsonb_array_elements(v_r #> '{by,state}') c where c ->> 'key' = 'Rivers') || '/' || (select coalesce(c ->> 'suppressed', 'shown') from jsonb_array_elements(v_r #> '{by,state}') c where c ->> 'key' = 'Lagos'),
    'true/true/shown', case when (select (c ->> 'suppressed') from jsonb_array_elements(v_r #> '{by,state}') c where c ->> 'key' = 'Kano') = 'true' and (select (c ->> 'suppressed') from jsonb_array_elements(v_r #> '{by,state}') c where c ->> 'key' = 'Rivers') = 'true'
      and (select coalesce(c ->> 'suppressed', 'shown') from jsonb_array_elements(v_r #> '{by,state}') c where c ->> 'key' = 'Lagos') = 'shown' then 'PASS' else 'FAIL' end);
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r2 := public.triage_accuracy_report(current_date + 5, current_date + 6);
  execute 'reset role';
  insert into s38e_results values ('5p2 a range with no completed tasks counts no reviews (reviews follow the task date)', coalesce(v_r2 #>> '{overall,suppressed}', 'null') || '/' || coalesce(v_r2 #>> '{coverage,suppressed}', 'null'), 'true/true',
    case when v_r2 #>> '{overall,suppressed}' = 'true' and v_r2 #>> '{coverage,suppressed}' = 'true' then 'PASS' else 'FAIL' end);
  insert into s38e_results values ('5p the report says what it is not (agreement, not diagnostic accuracy)', ((v_r ->> 'what_this_is') ~ 'not diagnostic accuracy')::text, 'true', case when (v_r ->> 'what_this_is') ~ 'not diagnostic accuracy' then 'PASS' else 'FAIL' end);

  -- =============================== 6. SABOTAGE ===============================
  -- (a) the consent filter removed from the sponsor report: the member who did NOT agree must then appear in the figures
  update public.outcome_config set config = jsonb_set(config, '{min_cell}', '1') where is_active;
  for i in 1..10 loop   -- everyone agrees again (on the new wording) so the real report shows its figures
    perform pg_temp.as_user(pts[i]);  execute 'set local role authenticated'; perform public.set_cohort_reporting_consent(v_cohort, true); execute 'reset role';
  end loop;
  select pg_get_functiondef('private.sponsor_report_aggregate(uuid,date,date)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'select patient_id from _s38e_members where agreed and private.sponsor_consent_in_force(patient_id)', 'select patient_id from _s38e_members');
  if v_txt = pg_get_functiondef('private.sponsor_report_aggregate(uuid,date,date)'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.sponsor_outcome_report(v_cohort);
  execute 'reset role';
  insert into s38e_results values ('6a0 (real) the member who does not agree is not in the figures', coalesce(v_r #>> '{bp_control_90d,uncontrolled}', 'null') || '/' || coalesce(v_r #>> '{bp_control_90d,suppressed}', 'null'), '0/false',
    case when (v_r #>> '{bp_control_90d,uncontrolled}') = '0' then 'PASS' else 'FAIL' end);
  execute v_txt;
  perform pg_temp.as_user(adm);  execute 'set local role authenticated';
  v_r := public.sponsor_outcome_report(v_cohort);
  execute 'reset role';
  insert into s38e_results values ('6a SABOTAGE: without the consent filter the non-agreeing member appears (4e would FAIL)', coalesce(v_r #>> '{bp_control_90d,uncontrolled}', coalesce(v_r #>> '{bp_control_90d,reason}', 'null')), 'not 0',
    case when coalesce(v_r #>> '{bp_control_90d,uncontrolled}', 'x') <> '0' then 'PASS' else 'FAIL' end);

  -- (b) the completer check removed from record_triage_review: another clinician must then succeed
  v_task := pg_temp.mktask(pl, 'amber', false, clin);
  select pg_get_functiondef('public.record_triage_review(uuid,text)'::regprocedure) into v_txt;
  v_txt := replace(v_txt, 'if not found or not exists (select 1 from public.task_claims c where c.task_id = p_task and c.clinician_id = v_uid and c.end_reason = ''completed'') then', 'if not found then');
  if v_txt = pg_get_functiondef('public.record_triage_review(uuid,text)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute v_txt;
  perform pg_temp.as_user(clin2);  execute 'set local role authenticated';
  v_r := public.record_triage_review(v_task, 'right');
  execute 'reset role';
  insert into s38e_results values ('6b SABOTAGE: without the completer check another clinician can review (5c would FAIL)', v_r ->> 'status', 'ok', case when v_r ->> 'status' = 'ok' then 'PASS' else 'FAIL' end);
end $$;

select * from s38e_results order by check_name;

do $$
begin
  if exists (select 1 from s38e_results where verdict = 'FAIL') then
    raise exception 'S38e proof: % check(s) FAILED', (select count(*) from s38e_results where verdict = 'FAIL');
  end if;
end $$;

rollback;
