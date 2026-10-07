-- S47 proof: risk-based HIV and hepatitis C, hepatitis B immunity, cervical HPV DNA milestones with the HIV care-team flag, packages
-- (migration *_s47_risk_based_hiv_hcv_cervical_hpv_dna_packages.sql). One rolled-back transaction.
-- Proves:
--   1. Rule set v3 is UNSIGNED, marks HIV and hepatitis C riskBased, carries the risk criteria (11 for hepatitis C from the Nigeria FMOH 2016 list, 2 for HIV)
--      and the cervical HPV DNA milestones 35 and 45. Serology v3 is the single active rule and keeps the anti-HBs threshold unconfirmed.
--   2. The scheduler no longer calendars HIV or hepatitis C for every adult; a self-reported or doctor-recorded criterion (valid 12 months, revocable)
--      or, for hepatitis C, living with HIV, does. An expired or revoked flag does not. A flag with an unknown criterion, from a stranger, from a
--      care coordinator or from anon is refused. A patient can still ORDER either test (the order path is not stricter).
--   3. Cervical: a 45-year-old woman is still scheduled (S45 acceptance under v3); ages 35 and 45 open a 5-year window, 40 and 50 do not; a result since the
--      birthday closes the window. A woman living with HIV is NOT scheduled; the care team is flagged once (idempotent), the event carries an id only, the
--      patient cannot read the flag, a tied doctor can list and resolve it, and a resolved flag is not raised again.
--   4. Hepatitis B: recorded immunity stops routine HBsAg (order path and calendar) unless a new exposure is on record.
--   5. Packages: no tier bundle holds hiv, hep_b or hep_c; the single tests and the blood-borne virus screen remain.
--   6. SABOTAGE: riskBased removed from the rule set, excludeWhenHiv removed, the qualifier forced true, and the criterion vocabulary opened.
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
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.state_as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
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
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'female', p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S46 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 30))::date, p_sex::public.sex, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'male', 40);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S46 ' || p_label, 'MDCN', 'S46-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
create function pg_temp.go_real(p_uid uuid) returns void language sql as $$ update public.profiles set is_test = false where id = p_uid $$;
create function pg_temp.guards_on(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;
create function pg_temp.mkpatient(p_label text, p_with_doc boolean default true) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient', 'female', 45);
  if p_with_doc then
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (pg_temp.f('org'), v, pg_temp.f('doc'), pg_temp.f('doc'));
  end if;
  return v;
end $f$;
create function pg_temp.sresult(p_pat uuid, p_code text, p_status text, p_age interval) returns void language sql as
$$ insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status, created_at)
   values (pg_temp.f('org'), p_pat, p_code, p_status::public.result_status, now() - p_age) $$;
create function pg_temp.scomp(p_pat uuid, p_code text, p_age interval) returns void language sql as
$$ insert into public.screening_completions (organisation_id, patient_id, screen_type_id, performed_date)
   values (pg_temp.f('org'), p_pat, (select id from public.screen_types where code = p_code), (now() - p_age)::date) $$;
create function pg_temp.excl(p_pat uuid, p_code text) returns text language sql as
$$ select coalesce((select e ->> 'reason' from jsonb_array_elements(private.compute_screening_order_exclusions(p_pat, pg_temp.f('org'), array[p_code])) e limit 1), 'none') $$;
-- one released lab result, items as jsonb [{code,num|text,unit,low,high,flag,sens}]
create function pg_temp.mkresult(p_pat uuid, p_released_at timestamptz, p_items jsonb) returns uuid language plpgsql as
$f$ declare v uuid; i jsonb; v_sens boolean;
begin
  v_sens := exists (select 1 from jsonb_array_elements(p_items) x where coalesce((x ->> 'sens')::boolean, false));
  insert into public.lab_results (organisation_id, patient_id, panel_code, panel_version_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (pg_temp.f('org'), p_pat, 'membership_annual', (select id from public.lab_panel_versions where panel_code = 'membership_annual' and is_active),
          'portal_entry', 'partner', case when v_sens then 'clinician_disclosure_required' else 'awaiting_review' end, p_released_at - interval '1 day', true)
  returning id into v;
  for i in select * from jsonb_array_elements(p_items) loop
    insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, ref_low, ref_high, flag, sensitive_positive, is_test)
    values (v, pg_temp.f('org'), p_pat, i ->> 'code', (i ->> 'num')::numeric, i ->> 'text', coalesce(i ->> 'unit', 'mg/dL'),
            (i ->> 'low')::numeric, (i ->> 'high')::numeric, i ->> 'flag', coalesce((i ->> 'sens')::boolean, false), true);
  end loop;
  update public.lab_results set release_state = 'released', released_at = p_released_at, reviewed_by = pg_temp.f('doc'),
         disclosure_attested = v_sens, disclosure_method = case when v_sens then 'in_person' end
   where id = v;
  return v;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'male', 40);
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'medical_officer', v_admin));
  -- S46c: the sign-off task is offered to an employed named doctor first; a contracted one pulls from the pool with an availability block
  update public.clinical_staff set employment_type = 'employed', indemnity_exempt = false, indemnity_exempt_by = null where profile_id = pg_temp.f('doc');
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cc', pg_temp.mkdoc(v_org, 'cc', 'care_coordinator', v_admin));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id, care_coordinator_id)
    select v_org, pg_temp.mkuser(v_org, 'ccpat', 'patient', 'female', 45), pg_temp.f('doc'), pg_temp.f('doc'), pg_temp.f('cc');
  perform pg_temp.setf('pat', pg_temp.mkpatient('pat'));
  perform pg_temp.setf('other', pg_temp.mkpatient('other'));
end $$;


create function pg_temp.sched_rows(p_pat uuid, p_code text) returns integer language sql as
$$ select count(*)::integer from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id where ss.patient_id = p_pat and st.code = p_code and ss.status = 'pending' $$;
create function pg_temp.mk(p_label text, p_age integer, p_sex text default 'female') returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient', p_sex, p_age);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (pg_temp.f('org'), v, pg_temp.f('doc'), pg_temp.f('doc'));
  return v;
end $f$;
create function pg_temp.run(p_pat uuid) returns text language sql as $$ select private.run_screening_scheduler(p_pat)::text $$;
create function pg_temp.flag_as(p_uid uuid, p_pat uuid, p_code text) returns text language sql as
$$ select pg_temp.sqlstate_as(p_uid, format('select public.record_screening_risk_flag(%L, %L)', p_pat, p_code)) $$;

-- 1. Rule data -------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('rule set v3 exists, unsigned and inactive', 'true',
    (select (approved_by is null and not is_active)::text from public.screening_rule_sets where version = 3));
  perform pg_temp.ck('v3 marks HIV and hepatitis C risk-based and keeps hepatitis B as it was', 'true,true,false',
    (select bool_or(x ->> 'code' = 'hiv' and (x ->> 'riskBased')::boolean)::text || ',' || bool_or(x ->> 'code' = 'hep_c' and (x ->> 'riskBased')::boolean)::text || ',' || bool_or(x ->> 'code' = 'hep_b' and coalesce((x ->> 'riskBased')::boolean, false))::text
       from public.screening_rule_sets s, jsonb_array_elements(s.config -> 'rules') x where s.version = 3));
  perform pg_temp.ck('v3 carries 11 hepatitis C criteria and 2 HIV criteria', '11,2',
    (select jsonb_array_length(config -> 'riskCriteria' -> 'hcv')::text || ',' || jsonb_array_length(config -> 'riskCriteria' -> 'hiv')::text from public.screening_rule_sets where version = 3));
  perform pg_temp.ck('v3 cervical is HPV DNA at 35 and 45 and excludes women living with HIV from auto-scheduling', 'hpv_dna,[35, 45],true',
    (select (x ->> 'method') || ',' || (x -> 'ageMilestones')::text || ',' || (x ->> 'excludeWhenHiv') from public.screening_rule_sets s, jsonb_array_elements(s.config -> 'rules') x where s.version = 3 and x ->> 'code' = 'cervical_smear'));
  perform pg_temp.ck('serology v3 is the single active rule and v2 is legacy', '3,1,legacy',
    (select (select version::text from public.serology_rule_versions where status = 'active') || ',' || (select count(*)::text from public.serology_rule_versions where status = 'active') || ',' || (select status from public.serology_rule_versions where version = 2)));
  perform pg_temp.ck('the anti-HBs threshold is 10 mIU/mL, PROPOSED and unconfirmed, and a titre alone never sets immunity', '10,proposed_unconfirmed,false,false',
    (select (config #>> '{antiHbs,thresholdMiuPerMl}') || ',' || (config #>> '{antiHbs,thresholdStatus}') || ',' || (config #>> '{antiHbs,numericTitreAloneSetsImmunity}') || ',' || private.anti_hbs_threshold_confirmed()::text
       from public.serology_rule_versions where status = 'active'));
end $$;

-- 2. HIV and hepatitis C by risk -----------------------------------------------------------------------------------------------------
do $$
declare plain uuid := pg_temp.mk('plain', 30); idu uuid := pg_temp.mk('idu', 30); act uuid := pg_temp.mk('active', 30); lh uuid := pg_temp.mk('lwh', 30);
        exp uuid := pg_temp.mk('expired', 30); rev uuid := pg_temp.mk('revoked', 30); doc uuid := pg_temp.f('doc'); cc uuid := pg_temp.f('cc'); stranger uuid := pg_temp.f('stranger');
        f uuid; r text;
begin
  perform pg_temp.run(plain); perform pg_temp.run(idu); perform pg_temp.run(act); perform pg_temp.run(lh); perform pg_temp.run(exp); perform pg_temp.run(rev);
  perform pg_temp.ck('control: the scheduler still works for an adult (hepatitis B is calendared)', '1', pg_temp.sched_rows(plain, 'hep_b')::text);
  perform pg_temp.ck('a plain adult with no risk is NOT calendared for HIV or hepatitis C', '0,0', pg_temp.sched_rows(plain, 'hiv')::text || ',' || pg_temp.sched_rows(plain, 'hep_c')::text);
  -- self-report (the patient acts for themselves)
  perform pg_temp.ck('a patient records their own risk reason', 'ok', pg_temp.flag_as(idu, idu, 'injecting_drug_use'));
  perform pg_temp.ck('...it is stored as patient_reported', 'patient_reported', (select basis from public.screening_risk_flags where patient_id = idu));
  perform pg_temp.ck('a patient records sexually active adult', 'ok', pg_temp.flag_as(act, act, 'sexually_active_adult'));
  delete from public.screening_schedules where patient_id in (idu, act);
  perform pg_temp.run(idu); perform pg_temp.run(act);
  perform pg_temp.ck('a hepatitis C reason calendars hepatitis C, not HIV', '1,0', pg_temp.sched_rows(idu, 'hep_c')::text || ',' || pg_temp.sched_rows(idu, 'hiv')::text);
  perform pg_temp.ck('an HIV reason calendars HIV, not hepatitis C', '1,0', pg_temp.sched_rows(act, 'hiv')::text || ',' || pg_temp.sched_rows(act, 'hep_c')::text);
  -- living with HIV qualifies for hepatitis C without any flag
  insert into public.patient_serology_status (organisation_id, patient_id, hiv_status) values (pg_temp.f('org'), lh, 'hiv_positive')
    on conflict (patient_id) do update set hiv_status = 'hiv_positive';
  delete from public.screening_schedules where patient_id = lh;
  perform pg_temp.run(lh);
  perform pg_temp.ck('living with HIV qualifies for hepatitis C on its own, and a positive HIV is not re-tested', '1,0', pg_temp.sched_rows(lh, 'hep_c')::text || ',' || pg_temp.sched_rows(lh, 'hiv')::text);
  -- expiry and revocation
  perform pg_temp.flag_as(exp, exp, 'prison_history'); perform pg_temp.flag_as(rev, rev, 'tattoo_or_scarification');
  update public.screening_risk_flags set expires_at = now() - interval '1 day' where patient_id = exp;
  perform pg_temp.ck('the patient revokes their own flag', 'true',
    pg_temp.q_as(rev, format('select public.revoke_screening_risk_flag(%L)::text', (select id from public.screening_risk_flags where patient_id = rev))));
  delete from public.screening_schedules where patient_id in (exp, rev);
  perform pg_temp.run(exp); perform pg_temp.run(rev);
  perform pg_temp.ck('an expired flag does not calendar hepatitis C', '0', pg_temp.sched_rows(exp, 'hep_c')::text);
  perform pg_temp.ck('a revoked flag does not calendar hepatitis C', '0', pg_temp.sched_rows(rev, 'hep_c')::text);
  -- refusals
  perform pg_temp.ck('an unknown criterion is refused', '22023', pg_temp.flag_as(plain, plain, 'because_i_said_so'));
  perform pg_temp.ck('a stranger patient cannot flag someone else', '42501', pg_temp.flag_as(idu, plain, 'injecting_drug_use'));
  perform pg_temp.ck('a care coordinator cannot record a flag', '42501', pg_temp.flag_as(cc, plain, 'injecting_drug_use'));
  perform pg_temp.ck('a doctor with no tie to the patient cannot', '42501', pg_temp.flag_as(stranger, plain, 'injecting_drug_use'));
  perform pg_temp.ck('anon cannot', '42501', pg_temp.try_anon(format('select public.record_screening_risk_flag(%L, %L)', plain, 'injecting_drug_use')));
  perform pg_temp.ck('a tied doctor records one', 'ok', pg_temp.flag_as(doc, plain, 'haemodialysis'));
  perform pg_temp.ck('...stored as clinician_recorded', 'clinician_recorded', (select basis from public.screening_risk_flags where patient_id = plain and criterion_code = 'haemodialysis'));
  -- reads
  perform pg_temp.ck('the patient reads their own flags', '1', pg_temp.q_as(idu, 'select count(*)::text from public.screening_risk_flags'));
  perform pg_temp.ck('another patient reads none', '0', pg_temp.q_as(act, format('select count(*)::text from public.screening_risk_flags where patient_id = %L', idu)));
  perform pg_temp.ck('a doctor cannot read the table directly', '0', pg_temp.q_as(doc, format('select count(*)::text from public.screening_risk_flags where patient_id = %L', plain)));
  perform pg_temp.ck('a tied doctor lists them through the audited function', '1', pg_temp.q_as(doc, format('select count(*)::text from public.clinician_list_screening_risk_flags(%L)', plain)));
  perform pg_temp.ck('...and the read is audited', '1', (select count(*)::text from public.audit_log where action = 'screening.risk_flags_read' and entity_id = plain));
  -- the order path is not stricter: a patient with no risk can still order any of the three
  perform pg_temp.ck('ability to order is kept: nothing is excluded for HIV, hepatitis B and hepatitis C for a plain adult', 'none,none,none',
    pg_temp.excl(act, 'hep_c') || ',' || pg_temp.excl(act, 'hep_b') || ',' || pg_temp.excl(idu, 'hiv'));
  perform pg_temp.setf('plain', plain); perform pg_temp.setf('idu', idu);
end $$;

-- 3. Cervical HPV DNA milestones and the HIV care-team flag ----------------------------------------------------------------------------
do $$
declare w35 uuid := pg_temp.mk('w35', 35); w40 uuid := pg_temp.mk('w40', 40); w45 uuid := pg_temp.mk('w45', 45); w49 uuid := pg_temp.mk('w49', 49); w50 uuid := pg_temp.mk('w50', 50);
        w45done uuid := pg_temp.mk('w45done', 45); w36done uuid := pg_temp.mk('w36done', 45); h uuid := pg_temp.mk('hivw', 45); m45 uuid := pg_temp.mk('m45', 45, 'male');
        doc uuid := pg_temp.f('doc'); stranger uuid := pg_temp.f('stranger'); cc uuid := pg_temp.f('cc'); fid uuid; n integer;
begin
  perform pg_temp.scomp(w45done, 'cervical_smear', interval '10 days');   -- after turning 45 (the 45th birthday was 30 days ago)
  perform pg_temp.scomp(w36done, 'cervical_smear', interval '3650 days'); -- about ten years ago: before turning 45
  perform pg_temp.run(w35); perform pg_temp.run(w40); perform pg_temp.run(w45); perform pg_temp.run(w49); perform pg_temp.run(w50);
  perform pg_temp.run(w45done); perform pg_temp.run(w36done); perform pg_temp.run(m45);
  perform pg_temp.ck('ACCEPTANCE (S45 under v3): a 45-year-old woman is scheduled for cervical screening', '1', pg_temp.sched_rows(w45, 'cervical_smear')::text);
  perform pg_temp.ck('a 35-year-old woman is scheduled', '1', pg_temp.sched_rows(w35, 'cervical_smear')::text);
  perform pg_temp.ck('a 40-year-old woman is not (between the milestones)', '0', pg_temp.sched_rows(w40, 'cervical_smear')::text);
  perform pg_temp.ck('a 49-year-old woman is still inside the 45 window', '1', pg_temp.sched_rows(w49, 'cervical_smear')::text);
  perform pg_temp.ck('a 50-year-old woman is not', '0', pg_temp.sched_rows(w50, 'cervical_smear')::text);
  perform pg_temp.ck('a man is not', '0', pg_temp.sched_rows(m45, 'cervical_smear')::text);
  -- (a completion also makes its own next-visit row through an existing trigger, so these two read the pure rule instead of the calendar rows)
  delete from public.screening_schedules where patient_id in (w36done, w45done);
  perform pg_temp.ck('a result since the 45th birthday closes the window', '0',
    (select count(*)::text from private.screening_due(w45done, (select id from public.screening_rule_sets where version = 3)) d where d.screen_type_code = 'cervical_smear'));
  delete from public.screening_schedules where patient_id in (w36done, w45done);   -- the completion trigger's own next-visit rows
  perform pg_temp.ck('(control) a result from before the 45th birthday does not', '1',
    (select count(*)::text from private.screening_due(w36done, (select id from public.screening_rule_sets where version = 3)) d where d.screen_type_code = 'cervical_smear'));
  -- living with HIV
  insert into public.patient_serology_status (organisation_id, patient_id, hiv_status) values (pg_temp.f('org'), h, 'hiv_positive')
    on conflict (patient_id) do update set hiv_status = 'hiv_positive';
  perform pg_temp.run(h);
  perform pg_temp.ck('a woman living with HIV is NOT auto-scheduled for cervical screening', '0', pg_temp.sched_rows(h, 'cervical_smear')::text);
  perform pg_temp.ck('...the care team is flagged, once', '1', (select count(*)::text from public.screening_care_team_flags where patient_id = h and resolved_at is null));
  perform pg_temp.run(h);
  perform pg_temp.ck('...a second run adds no second flag and no second event', '1,1',
    (select count(*)::text from public.screening_care_team_flags where patient_id = h) || ',' || (select count(*)::text from public.domain_events where event_type = 'screening.care_team_review_needed' and patient_id = h));
  perform pg_temp.ck('...the event carries an id and nothing else', 'screening_care_flag_id',
    (select string_agg(k, ',') from (select distinct jsonb_object_keys(payload) k from public.domain_events where event_type = 'screening.care_team_review_needed' and patient_id = h) x));
  perform pg_temp.ck('...the flag row carries no status word', 'false',
    ((select row_to_json(f)::text from public.screening_care_team_flags f where f.patient_id = h) ~* 'hiv|positive|status')::text);
  perform pg_temp.ck('...the patient cannot read it', '42501', pg_temp.sqlstate_as(h, 'select * from public.screening_care_team_flags'));
  perform pg_temp.ck('...a woman without HIV is never flagged', '0', (select count(*)::text from public.screening_care_team_flags where patient_id = w45));
  perform pg_temp.ck('a tied doctor lists the flag', '1', pg_temp.q_as(doc, format('select count(*)::text from public.clinician_list_screening_care_flags(%L)', h)));
  perform pg_temp.ck('a doctor with no tie is refused', '42501', pg_temp.sqlstate_as(stranger, format('select * from public.clinician_list_screening_care_flags(%L)', h)));
  select id into fid from public.screening_care_team_flags where patient_id = h;
  perform pg_temp.ck('a care coordinator cannot resolve it', '42501', pg_temp.sqlstate_as(cc, format('select public.resolve_screening_care_flag(%L, %L)', fid, 'reviewed')));
  perform pg_temp.ck('a note is required', '22023', pg_temp.sqlstate_as(doc, format('select public.resolve_screening_care_flag(%L, %L)', fid, '  ')));
  perform pg_temp.ck('a tied doctor resolves it', 'true', pg_temp.q_as(doc, format('select public.resolve_screening_care_flag(%L, %L)::text', fid, 'Discussed the cervical pathway with the patient.')));
  perform pg_temp.run(h);
  perform pg_temp.ck('a resolved flag is not raised again the next night', '0', (select count(*)::text from public.screening_care_team_flags where patient_id = h and resolved_at is null));
  perform pg_temp.setf('hivw', h); perform pg_temp.setf('w45', w45);
end $$;

-- 4. Hepatitis B: immunity stops routine HBsAg unless a new exposure is on record ------------------------------------------------------
do $$
declare p uuid := pg_temp.mk('immune', 30); q uuid := pg_temp.mk('immune_exp', 30); v_set uuid;
begin
  select id into v_set from public.screening_rule_sets where version = 3;
  perform pg_temp.mkresult(p, now(), '[{"code":"anti_hbs","text":"positive","unit":"none","flag":"positive"}]'::jsonb);
  perform pg_temp.mkresult(q, now(), '[{"code":"anti_hbs","text":"positive","unit":"none","flag":"positive"}]'::jsonb);
  perform pg_temp.ck('immune: routine HBsAg stops (order path)', 'terminal_serology_state', pg_temp.excl(p, 'hep_b'));
  perform pg_temp.ck('immune: routine HBsAg stops (calendar)', '0', (select count(*)::text from private.screening_due(p, v_set) d where d.screen_type_code = 'hep_b'));
  insert into public.patient_exposure_reports (organisation_id, patient_id, exposure_code, occurred_on, status, reported_at)
    values (pg_temp.f('org'), q, 'needlestick_or_sharps', current_date - 100, 'open', now() - interval '1 day');
  perform pg_temp.ck('immune but a new exposure is on record: the order path no longer says terminal', 'true',
    (pg_temp.excl(q, 'hep_b') <> 'terminal_serology_state')::text);
  perform pg_temp.ck('...and the calendar lists hepatitis B again', '1', (select count(*)::text from private.screening_due(q, v_set) d where d.screen_type_code = 'hep_b'));
end $$;

-- 5. Packages ---------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('no tier bundle holds HIV, hepatitis B or hepatitis C', '0',
    (select count(*)::text from public.panel_bundles where code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive') and test_codes && array['hiv', 'hep_b', 'hep_c']));
  perform pg_temp.ck('the tier bundle names are kept', '4',
    (select count(*)::text from public.panel_bundles where code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive')));
  perform pg_temp.ck('single tests and the blood-borne virus screen are still purchasable items', 'true',
    (select bool_and(test_codes <> '{}')::text from public.panel_bundles where code in ('single_hiv', 'single_hep_b', 'single_hep_c', 'blood_borne_virus_screen', 'know_your_basics')));
  perform pg_temp.ck('no tier bundle description promises universal blood-borne virus testing', '0',
    (select count(*)::text from public.panel_bundles where code in ('screen_essential', 'screen_core', 'screen_advanced', 'screen_comprehensive')
        and description ~* '(include|plus|and)[^.]*\m(hiv|hepatitis)' and description !~* 'when they apply'));
end $$;

-- 6. Sabotage --------------------------------------------------------------------------------------------------------------------------
-- A: riskBased stripped from rule set v3. A plain adult must then be calendared for hepatitis C (the real check flips).
do $$
declare p uuid := pg_temp.mk('sabA', 30);
begin
  update public.screening_rule_sets set config = jsonb_set(config, '{rules}', (select jsonb_agg(x - 'riskBased') from jsonb_array_elements(config -> 'rules') x)) where version = 3;
  perform pg_temp.run(p);
  insert into results values ('sabotaged', 'a plain adult with no risk is NOT calendared for HIV or hepatitis C', '0,0', pg_temp.sched_rows(p, 'hiv')::text || ',' || pg_temp.sched_rows(p, 'hep_c')::text);
end $$;
-- B: excludeWhenHiv removed. A woman living with HIV must then be scheduled.
do $$
declare p uuid := pg_temp.mk('sabB', 45);
begin
  insert into public.patient_serology_status (organisation_id, patient_id, hiv_status) values (pg_temp.f('org'), p, 'hiv_positive') on conflict (patient_id) do update set hiv_status = 'hiv_positive';
  update public.screening_rule_sets set config = jsonb_set(config, '{rules}', (select jsonb_agg(x - 'excludeWhenHiv') from jsonb_array_elements(config -> 'rules') x)) where version = 3;
  perform pg_temp.run(p);
  insert into results values ('sabotaged', 'a woman living with HIV is NOT auto-scheduled for cervical screening', '0', pg_temp.sched_rows(p, 'cervical_smear')::text);
end $$;
-- C: the qualifier forced true. Even an expired flag then calendars hepatitis C.
do $$
declare p uuid := pg_temp.mk('sabC', 30);
begin
  create or replace function private.screening_risk_qualifies(p_patient uuid, p_criteria jsonb, p_hiv text) returns boolean language sql stable as $f$ select true $f$;
  perform pg_temp.run(p);
  insert into results values ('sabotaged', 'a plain adult with no risk is NOT calendared for HIV or hepatitis C (qualifier)', '0,0', pg_temp.sched_rows(p, 'hiv')::text || ',' || pg_temp.sched_rows(p, 'hep_c')::text);
end $$;
-- D: the criterion vocabulary opened. An unknown reason must then be accepted.
do $$
begin
  create or replace function private.screening_risk_codes() returns text[] language sql stable as $f$ select array['because_i_said_so'] $f$;
  insert into results values ('sabotaged', 'an unknown criterion is refused', '22023', pg_temp.flag_as(pg_temp.f('plain'), pg_temp.f('plain'), 'because_i_said_so'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
