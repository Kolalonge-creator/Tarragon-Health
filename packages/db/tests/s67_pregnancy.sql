-- ===========================================================================
-- S67 proof (module 16, pregnancy). Run after the four S67 migrations are applied (CI replays them; a human may run
-- `BEGIN; <the four migration files>; <this file>` against a throwaway database). Wrapped in BEGIN/ROLLBACK.
--
-- Proves:
--   A. pregnancies history: a second pregnancy is possible; one active at a time; patient_pregnancy follows (both directions);
--      the backfill carries a pregnant row; `pregnancy.recorded` is emitted with ids only; risk flags are the care team's.
--   B. access: patient, tied-org clinician and a category-granted caregiver read; a caregiver with NO category grant, a caregiver
--      with a manage grant but no category, an emergency record-access grantee, a sponsor/stranger, an employer administrator and a
--      clinician of another organisation are all REFUSED on every S67 table; a caregiver may not write; anon has no access.
--   C. kick counter and contraction timer: a "go today" / go-now sign raises ONE emergency event; an ordinary result raises none;
--      a repeat inside an hour adds none; client ids make a replay a no-op.
--   D. antenatal schedule generator: idempotent, never overwrites a person's row, refuses an ended pregnancy.
--   E. birth plan: money is a kobo plan note (bigint), bad phone numbers refused, one plan per pregnancy.
--   F. guard: maternal_enabled exists, is OFF, has no log or attestation row, and cannot be switched on (no conditions met).
--   G. bp_care_triage v4 exists as a draft; no S67 object is executable by anon.
--   SABOTAGE: the pregnancies SELECT policy is opened to everyone and the stranger-refusal check must flip; then restored.
-- Test data is all is_test.
-- ===========================================================================
begin;

create temporary table s67_result(check_name text, observed text, expected text, verdict text) on commit drop;
create or replace function pg_temp.check_eq(p_name text, p_observed text, p_expected text) returns void language plpgsql as $$
begin
  insert into s67_result values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;
create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $$
declare
  v_org uuid; v_org2 uuid;
  v_patient uuid := gen_random_uuid();   v_cg_none uuid := gen_random_uuid();   v_cg_manage uuid := gen_random_uuid();
  v_cg_cat uuid := gen_random_uuid();    v_stranger uuid := gen_random_uuid();  v_employer uuid := gen_random_uuid();
  v_clin uuid := gen_random_uuid();      v_clin_other uuid := gen_random_uuid(); v_emerg uuid := gen_random_uuid();
  v_grant_cat uuid;
  v_preg1 uuid; v_preg2 uuid; v_n bigint; v_t text; v_ok boolean; v_state text;
  v_tables text[] := array['pregnancies', 'kick_counts', 'contractions', 'birth_plans'];
  v_who uuid[]; v_label text[]; i int; j int;
  v_event_payload jsonb;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'no organisation exists'; end if;
  insert into public.organisations (name, type) values ('S67 other org', 'clinic') returning id into v_org2;

  insert into auth.users (id, email) values
    (v_patient, 's67.patient@example.com'), (v_cg_none, 's67.cgnone@example.com'), (v_cg_manage, 's67.cgmanage@example.com'),
    (v_cg_cat, 's67.cgcat@example.com'), (v_stranger, 's67.sponsor@example.com'), (v_employer, 's67.employer@example.com'),
    (v_clin, 's67.clin@example.com'), (v_clin_other, 's67.clinother@example.com'), (v_emerg, 's67.emerg@example.com');
  insert into public.profiles (id, organisation_id, role, full_name, is_test) values
    (v_patient, v_org, 'patient', 'S67 Patient', true), (v_cg_none, v_org, 'patient', 'S67 CG none', true),
    (v_cg_manage, v_org, 'patient', 'S67 CG manage', true), (v_cg_cat, v_org, 'patient', 'S67 CG cat', true),
    (v_stranger, v_org, 'patient', 'S67 Sponsor', true), (v_employer, v_org, 'corporate_admin', 'S67 Employer', true),
    (v_clin, v_org, 'clinician', 'S67 Clinician', true), (v_clin_other, v_org2, 'clinician', 'S67 Other clinician', true),
    (v_emerg, v_org, 'patient', 'S67 Emergency requester', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true;

  -- caregiver grants: manage with no category; manage + reproductive_health
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_patient, v_cg_manage, 'manage', v_patient);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_patient, v_cg_cat, 'manage', v_patient) returning id into v_grant_cat;
  insert into public.profile_access_categories (profile_access_id, category) values (v_grant_cat, 'reproductive_health');
  -- an emergency record-access grant (break-glass) for the requester
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (v_emerg, v_org, v_patient, v_org, 'S67 proof', now() + interval '1 hour');

  ---------------------------------------------------------------------------
  -- A. history
  ---------------------------------------------------------------------------
  perform pg_temp.as_user(v_patient);
  insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, lmp, edd) values (v_org, v_patient, 0, current_date - 140, current_date + 140) returning id into v_preg1;
  reset role;
  perform pg_temp.check_eq('A1 a patient starts a pregnancy; source and recorded_by are stamped by the database',
    (select source || ':' || (recorded_by = v_patient)::text || ':' || is_test::text || ':' || pregnancy_number from public.pregnancies where id = v_preg1), 'patient:true:true:1');
  perform pg_temp.check_eq('A2 the projection patient_pregnancy follows (pregnant, dates copied)',
    (select is_pregnant::text || ':' || (last_menstrual_period_date = current_date - 140)::text from public.patient_pregnancy where patient_id = v_patient), 'true:true');
  perform pg_temp.check_eq('A3 pregnancy.recorded was emitted once, ids only',
    (select count(*) from public.domain_events where event_type = 'pregnancy.recorded' and aggregate_id = v_preg1)::text, '1');
  select payload into v_event_payload from public.domain_events where event_type = 'pregnancy.recorded' and aggregate_id = v_preg1;
  perform pg_temp.check_eq('A3b the event payload carries only the pregnancy id and state', (select string_agg(k, ',' order by k) from jsonb_object_keys(v_event_payload) k), 'pregnancy_id,state');

  begin
    perform pg_temp.as_user(v_patient);
    insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, lmp) values (v_org, v_patient, 0, current_date - 10);
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('A4 a second ACTIVE pregnancy is refused', v_ok::text, 'true');

  begin
    perform pg_temp.as_user(v_patient);
    update public.pregnancies set risk_flags = array['previous_pre_eclampsia'] where id = v_preg1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('A5 a patient cannot set risk flags (care team only)', v_ok::text, 'true');

  perform pg_temp.as_user(v_clin);
  update public.pregnancies set risk_flags = array['previous_pre_eclampsia'] where id = v_preg1;
  reset role;
  perform pg_temp.check_eq('A6 a clinician of the organisation can; projection high_risk follows',
    (select (cardinality(p.risk_flags) = 1)::text || ':' || pp.high_risk::text from public.pregnancies p join public.patient_pregnancy pp using (patient_id) where p.id = v_preg1), 'true:true');

  -- end it, then a SECOND pregnancy for the same patient
  perform pg_temp.as_user(v_clin);
  update public.pregnancies set state = 'delivered', outcome = 'live_birth', outcome_date = current_date where id = v_preg1;
  reset role;
  perform pg_temp.check_eq('A7 ending the pregnancy clears is_pregnant and high_risk on the projection',
    (select is_pregnant::text || ':' || high_risk::text from public.patient_pregnancy where patient_id = v_patient), 'false:false');
  perform pg_temp.as_user(v_patient);
  insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, lmp, edd) values (v_org, v_patient, 0, current_date - 30, current_date + 250) returning id into v_preg2;
  reset role;
  perform pg_temp.check_eq('A8 a SECOND pregnancy is recorded with number 2, history keeps both',
    (select count(*)::text || ':' || max(pregnancy_number) from public.pregnancies where patient_id = v_patient), '2:2');
  perform pg_temp.check_eq('A8b the projection shows the new pregnancy', (select is_pregnant::text from public.patient_pregnancy where patient_id = v_patient), 'true');
  begin
    perform pg_temp.as_user(v_patient);
    update public.pregnancies set state = 'active', outcome = null where id = v_preg1;
    v_ok := false;
  exception when insufficient_privilege or unique_violation then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('A9 a patient cannot reopen an ended pregnancy', v_ok::text, 'true');

  -- direct write by an older writer (patient_pregnancy) reaches the history; a new patient
  declare v_p2 uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email) values (v_p2, 's67.legacy@example.com');
    insert into public.profiles (id, organisation_id, role, full_name, is_test) values (v_p2, v_org, 'patient', 'S67 Legacy', true) on conflict (id) do nothing;
    insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant, estimated_due_date) values (v_org, v_p2, true, current_date + 100);
    perform pg_temp.check_eq('A10 an older writer to patient_pregnancy creates the active history row',
      (select count(*)::text || ':' || coalesce(max(state), '') from public.pregnancies where patient_id = v_p2), '1:active');
    update public.patient_pregnancy set is_pregnant = false where patient_id = v_p2;
    perform pg_temp.check_eq('A11 switching it off ends the history row (unspecified outcome)',
      (select state from public.pregnancies where patient_id = v_p2), 'ended_unspecified');
  end;

  ---------------------------------------------------------------------------
  -- Fixtures for the access checks: one row per S67 table for the patient's current pregnancy
  ---------------------------------------------------------------------------
  perform pg_temp.as_user(v_patient);
  insert into public.kick_counts (organisation_id, patient_id, pregnancy_id, client_id, started_at, result, config_version, source)
  values (v_org, v_patient, v_preg2, gen_random_uuid(), now(), 'target_reached', 1, 'patient');
  insert into public.contractions (organisation_id, patient_id, pregnancy_id, client_id, started_at, pattern, result, config_version, source)
  values (v_org, v_patient, v_preg2, gen_random_uuid(), now(), 'standard', 'keep_timing', 1, 'patient');
  insert into public.birth_plans (organisation_id, patient_id, pregnancy_id, place_of_birth, money_plan_kobo, source)
  values (v_org, v_patient, v_preg2, 'General Hospital', 15000000, 'patient');
  reset role;

  ---------------------------------------------------------------------------
  -- B. who can read what
  ---------------------------------------------------------------------------
  v_who   := array[v_patient, v_clin, v_cg_cat, v_cg_none, v_cg_manage, v_emerg, v_stranger, v_employer, v_clin_other];
  v_label := array['the patient', 'a clinician of the organisation', 'a caregiver WITH the reproductive_health grant', 'a caregiver with no grant at all',
                   'a caregiver with manage but NO category grant', 'an emergency record-access grantee (break-glass)', 'a sponsor or any unrelated person',
                   'an employer administrator', 'a clinician of another organisation'];
  for i in 1 .. array_length(v_who, 1) loop
    for j in 1 .. array_length(v_tables, 1) loop
      perform pg_temp.as_user(v_who[i]);
      execute format('select count(*) from public.%I where patient_id = $1', v_tables[j]) into v_n using v_patient;
      reset role;
      perform pg_temp.check_eq('B ' || v_label[i] || ' reading ' || v_tables[j], v_n::text,
        case when i <= 3 then case when v_tables[j] = 'pregnancies' then '2' else '1' end else '0' end);
    end loop;
  end loop;

  -- writes: a caregiver (even with the category grant) cannot write; a stranger cannot write
  foreach v_t in array array['pregnancies', 'kick_counts', 'birth_plans'] loop
    begin
      perform pg_temp.as_user(v_cg_cat);
      if v_t = 'pregnancies' then
        update public.pregnancies set lmp = current_date - 5 where id = v_preg2;
        get diagnostics v_n = row_count;
      elsif v_t = 'kick_counts' then
        insert into public.kick_counts (organisation_id, patient_id, client_id, started_at, result, config_version, source) values (v_org, v_patient, gen_random_uuid(), now(), 'stopped', 1, 'patient');
        v_n := 1;
      else
        update public.birth_plans set place_of_birth = 'changed by caregiver' where patient_id = v_patient;
        get diagnostics v_n = row_count;
      end if;
    exception when others then v_n := 0;
    end;
    reset role;
    perform pg_temp.check_eq('B a caregiver with the category grant cannot write ' || v_t, v_n::text, '0');
  end loop;

  perform pg_temp.check_eq('B anon has no table privilege on any S67 table',
    (select count(*) from unnest(v_tables || array['pregnancy_content']) t where has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE'))::text, '0');
  perform pg_temp.check_eq('B no S67 policy mentions the emergency read-through',
    (select count(*) from pg_policies where schemaname = 'public' and tablename = any (v_tables) and coalesce(qual, '') || coalesce(with_check, '') ilike '%has_emergency_access%')::text, '0');

  ---------------------------------------------------------------------------
  -- C. alerts from the kick counter and contraction timer
  ---------------------------------------------------------------------------
  select count(*) into v_n from public.emergency_events where patient_id = v_patient and source = 'pregnancy_symptom_checklist';
  perform pg_temp.check_eq('C0 ordinary sessions raised no emergency event', v_n::text, '0');

  perform pg_temp.as_user(v_patient);
  insert into public.kick_counts (organisation_id, patient_id, pregnancy_id, client_id, started_at, result, result_reason, config_version, source, reported_less)
  values (v_org, v_patient, v_preg2, gen_random_uuid(), now(), 'contact_today', 'reported_less_movement', 1, 'patient', true);
  reset role;
  perform pg_temp.check_eq('C1 a contact-today kick card raises ONE emergency event',
    (select count(*)::text from public.emergency_events where patient_id = v_patient and source = 'pregnancy_symptom_checklist'), '1');

  perform pg_temp.as_user(v_patient);
  insert into public.contractions (organisation_id, patient_id, pregnancy_id, client_id, started_at, pattern, result, result_reason, instant_signs, config_version, source)
  values (v_org, v_patient, v_preg2, gen_random_uuid(), now(), 'standard', 'go_now', 'instant_sign', array['waters_break'], 1, 'patient');
  reset role;
  perform pg_temp.check_eq('C2 a second card inside the hour adds no second alert',
    (select count(*)::text from public.emergency_events where patient_id = v_patient and source = 'pregnancy_symptom_checklist'), '1');

  update public.emergency_events set created_at = now() - interval '2 hours' where patient_id = v_patient;
  perform pg_temp.as_user(v_patient);
  insert into public.contractions (organisation_id, patient_id, pregnancy_id, client_id, started_at, pattern, result, result_reason, config_version, source)
  values (v_org, v_patient, v_preg2, gen_random_uuid(), now(), 'standard', 'go_now', 'pattern', 1, 'patient');
  reset role;
  perform pg_temp.check_eq('C3 the 5-1-1 labour pattern is a go-now card but NOT an emergency alert',
    (select count(*)::text from public.emergency_events where patient_id = v_patient and created_at > now() - interval '1 hour'), '0');

  perform pg_temp.as_user(v_patient);
  insert into public.contractions (organisation_id, patient_id, pregnancy_id, client_id, started_at, pattern, result, result_reason, config_version, source)
  values (v_org, v_patient, v_preg2, gen_random_uuid(), now(), 'standard', 'go_now', 'before_term', 1, 'patient');
  reset role;
  perform pg_temp.check_eq('C4 contractions before 37 weeks raise the alert',
    (select count(*)::text from public.emergency_events where patient_id = v_patient and created_at > now() - interval '1 hour'), '1');

  begin
    perform pg_temp.as_user(v_patient);
    insert into public.kick_counts (organisation_id, patient_id, client_id, started_at, result, config_version, source) values (v_org, v_patient, gen_random_uuid(), now(), 'contact_today', 1, 'patient');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('C5 a contact-today result must carry its reason', v_ok::text, 'true');

  declare v_cid uuid := gen_random_uuid();
  begin
    perform pg_temp.as_user(v_patient);
    insert into public.kick_counts (organisation_id, patient_id, client_id, started_at, result, config_version, source) values (v_org, v_patient, v_cid, now(), 'stopped', 1, 'patient');
    begin
      insert into public.kick_counts (organisation_id, patient_id, client_id, started_at, result, config_version, source) values (v_org, v_patient, v_cid, now(), 'stopped', 1, 'patient');
      v_ok := false;
    exception when unique_violation then v_ok := true;
    end;
    reset role;
    perform pg_temp.check_eq('C6 the same client id twice is a duplicate (a replay from the phone is a no-op)', v_ok::text, 'true');
  end;

  ---------------------------------------------------------------------------
  -- D. antenatal schedule
  ---------------------------------------------------------------------------
  perform pg_temp.as_user(v_patient);
  select public.generate_antenatal_schedule(v_preg2, array[1, 2, 3], array[12, 20, 26], 1) into v_n;
  perform pg_temp.check_eq('D1 the generator inserts the planned contacts', v_n::text, '3');
  select public.generate_antenatal_schedule(v_preg2, array[1, 2, 3, 4], array[12, 20, 26, 30], 1) into v_n;
  perform pg_temp.check_eq('D2 run again with one more contact it adds only the new one (idempotent)', v_n::text, '1');
  reset role;
  update public.antenatal_visits set findings = 'person wrote this', status = 'completed' where pregnancy_id = v_preg2 and visit_number = 1;
  perform pg_temp.as_user(v_patient);
  select public.generate_antenatal_schedule(v_preg2, array[1], array[13], 2) into v_n;
  reset role;
  perform pg_temp.check_eq('D3 the generator never overwrites a row a person has changed',
    (select status::text || ':' || target_week::text || ':' || findings from public.antenatal_visits where pregnancy_id = v_preg2 and visit_number = 1), 'completed:12:person wrote this');
  perform pg_temp.check_eq('D4 generated rows are stamped system and is_test',
    (select string_agg(distinct source || ':' || is_test::text, ',') from public.antenatal_visits where pregnancy_id = v_preg2 and visit_number > 1), 'system:true');
  begin
    perform pg_temp.as_user(v_patient);
    perform public.generate_antenatal_schedule(v_preg1, array[1], array[12], 1);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('D5 an ended pregnancy gets no schedule', v_ok::text, 'true');
  begin
    perform pg_temp.as_user(v_stranger);
    perform public.generate_antenatal_schedule(v_preg2, array[7], array[38], 1);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('D6 a stranger cannot generate a schedule for someone else', v_ok::text, 'true');
  begin
    perform pg_temp.as_user(v_patient);
    perform public.antenatal_schedule_review_prompt(v_preg2);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('D7 the review prompt is for staff only', v_ok::text, 'true');
  perform pg_temp.as_user(v_clin);
  perform pg_temp.check_eq('D8 staff get a prompt', (public.antenatal_schedule_review_prompt(v_preg2) ->> 'pregnancy_id'), v_preg2::text);
  reset role;
  perform pg_temp.check_eq('D8b the staff read of the prompt is audit-logged (INV-10)',
    (select count(*)::text from public.audit_log where entity_type = 'antenatal_schedule_review_prompt' and entity_id = v_preg2), '1');

  ---------------------------------------------------------------------------
  -- E. birth plan
  ---------------------------------------------------------------------------
  begin
    perform pg_temp.as_user(v_patient);
    update public.birth_plans set blood_donor_phone = '0803 123 4567' where pregnancy_id = v_preg2;
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('E1 a phone number must be E.164', v_ok::text, 'true');
  perform pg_temp.check_eq('E2 the money plan is a bigint of kobo',
    (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'birth_plans' and column_name = 'money_plan_kobo'), 'bigint');
  begin
    perform pg_temp.as_user(v_patient);
    insert into public.birth_plans (organisation_id, patient_id, pregnancy_id, source) values (v_org, v_patient, v_preg2, 'patient');
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  reset role;
  perform pg_temp.check_eq('E3 one plan per pregnancy', v_ok::text, 'true');
  perform pg_temp.check_eq('E4 no column of the birth plan holds a balance or a wallet',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'birth_plans' and column_name ~* '(balance|wallet|topup|top_up)'), '0');

  ---------------------------------------------------------------------------
  -- F. go-live guard and G. rule set
  ---------------------------------------------------------------------------
  perform pg_temp.check_eq('F1 maternal_enabled exists and is OFF', (select is_on::text from public.go_live_guards where key = 'maternal_enabled'), 'false');
  perform pg_temp.check_eq('F2 no log, attestation or sign-off row was written for it',
    ((select count(*) from public.go_live_guard_log where guard_key = 'maternal_enabled') + (select count(*) from public.go_live_attestations where guard_key = 'maternal_enabled'))::text, '0');
  perform pg_temp.check_eq('F3 its conditions are four and the three that need a signature are unmet',
    (select count(*)::text || ':' || count(*) filter (where (c ->> 'met')::boolean and c ->> 'source' <> 'switch') from jsonb_array_elements(private.go_live_conditions('maternal_enabled', v_org)) c), '4:0');
  begin
    update public.go_live_guards set is_on = true where key = 'maternal_enabled';
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check_eq('F4 a bare update cannot switch it on', v_ok::text, 'true');
  perform pg_temp.check_eq('G1 bp_care_triage v4 exists as an unapproved draft with rule BP-P6',
    (select status || ':' || (rules -> 'rules' @> '[{"id":"BP-P6"}]'::jsonb)::text from public.triage_rule_sets where code = 'bp_care_triage' and version = 4), 'draft:true');
  perform pg_temp.check_eq('G2 v4 was not approved by this migration',
    (select (approved_by is null and approved_at is null)::text from public.triage_rule_sets where code = 'bp_care_triage' and version = 4), 'true');
  perform pg_temp.check_eq('G3 anon cannot execute any S67 function',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname in ('generate_antenatal_schedule', 'antenatal_schedule_review_prompt', 'pregnancy_staff_may_read',
        'pregnancy_caregiver_may_read', 'pregnancy_may_write') and has_function_privilege('anon', p.oid, 'EXECUTE'))::text, '0');
  perform pg_temp.check_eq('G4 the server context reads the three new symptom values',
    (pg_get_functiondef('public.triage_context_for_observation(uuid, text, integer)'::regprocedure) like '%''convulsion''%')::text, 'true');

  ---------------------------------------------------------------------------
  -- SABOTAGE: open the pregnancies SELECT policy to everyone; the stranger check must flip (observed non-zero), then restore.
  ---------------------------------------------------------------------------
  drop policy pregnancies_select on public.pregnancies;
  create policy pregnancies_select on public.pregnancies for select to authenticated using (true);
  perform pg_temp.as_user(v_stranger);
  select count(*) into v_n from public.pregnancies where patient_id = v_patient;
  reset role;
  perform pg_temp.check_eq('SABOTAGE with the policy opened, the stranger DOES read (so check B is not vacuous)', (v_n > 0)::text, 'true');
  drop policy pregnancies_select on public.pregnancies;
  create policy pregnancies_select on public.pregnancies for select to authenticated
    using (patient_id = (select auth.uid()) or private.pregnancy_staff_may_read(organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
  perform pg_temp.as_user(v_stranger);
  select count(*) into v_n from public.pregnancies where patient_id = v_patient;
  reset role;
  perform pg_temp.check_eq('SABOTAGE restored: the stranger reads nothing again', v_n::text, '0');
end $$;

select check_name, observed, expected, verdict from s67_result order by check_name;

do $$
begin
  if exists (select 1 from s67_result where verdict <> 'PASS') then
    raise exception 'S67 proof: % check(s) failed', (select count(*) from s67_result where verdict <> 'PASS');
  end if;
end $$;

rollback;
