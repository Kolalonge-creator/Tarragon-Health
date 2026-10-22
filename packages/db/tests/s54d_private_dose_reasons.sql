-- S54d proof (migration *_s54d_private_dose_reasons_and_nafdac_helper_guard.sql). Item 5: "I ran out, or cannot afford it this month".
-- One rolled-back transaction. Every role that must be refused is shown refused, and a control shows the allowed role allowed.
--  A. A private reason is moved out of the dose row into medication_dose_reasons (source and recorded_by from the dose event); a non-private
--     reason stays on the dose row; the dose row still reads for the supporter (control) but carries no reason.
--  B. Who reads the reason: the person (yes), a supporter with the medicines category (no, until the person opts in for THAT reason; yes after;
--     no again after withdrawal), another patient (no), anon (refused), a tied clinician directly (no), a tied clinician through the audited
--     read (yes, one audit row), an untied clinician (denied), a patient caller of the audited read (refused), a short reason (refused).
--  C. Nobody can write the new tables directly; sharing can be set only for a private reason, only by the person.
--  D. A ran-out reason raises no clinician alert and no outreach task by itself.
--  E. The NAFDAC helper guard exists and is OFF.
--  F. SABOTAGE: with the diverting trigger dropped the reason sits on the supporter-readable dose row (check A1 would FAIL); with the opt-in
--     predicate made permissive a supporter reads without opting in (check B2 would FAIL).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_q(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's54d-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;

-- Fixtures ----------------------------------------------------------------------------------------------------------------------------
\o /dev/null
do $$
declare v_org uuid; v_pat uuid; v_pat2 uuid; v_sup uuid; v_tied uuid; v_untied uuid; v_pa uuid; v_med uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'S54d Patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient', 'S54d Patient Two');
  v_sup := pg_temp.mkuser(v_org, 'sup', 'patient', 'S54d Supporter');
  v_tied := pg_temp.mkuser(v_org, 'tied', 'clinician', 'S54d Tied Doctor');
  v_untied := pg_temp.mkuser(v_org, 'untied', 'clinician', 'S54d Untied Doctor');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied, 'S54d Tied Doctor', true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'S54d Untied Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;
  -- the supporter holds the medicines category (view level); only the record's owner may set a category grant
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_sup, v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');
  perform set_config('request.jwt.claims', null, true);
  insert into public.medications (organisation_id, patient_id, drug_name) values (v_org, v_pat, 'S54d Fixture Tablet') returning id into v_med;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('sup', v_sup);
  perform pg_temp.setf('tied', v_tied); perform pg_temp.setf('untied', v_untied); perform pg_temp.setf('med', v_med);
end $$;
\o

-- A. The reason is diverted ------------------------------------------------------------------------------------------------------------
select pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.medication_logs (organisation_id, patient_id, medication_id, status, reason, scheduled_for_date, scheduled_time)
  values (%L, %L, %L, 'not_available', 'ran_out', current_date, '08:00') returning 1$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
select pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.medication_logs (organisation_id, patient_id, medication_id, status, reason, scheduled_for_date, scheduled_time)
  values (%L, %L, %L, 'skipped', 'felt_well', current_date, '13:00') returning 1$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
select pg_temp.ck('A', 'A1 the ran-out dose row carries no reason', 'null',
  coalesce((select reason from public.medication_logs where patient_id = pg_temp.f('pat') and scheduled_time = '08:00'), 'null'));
select pg_temp.ck('A', 'A2 the reason sits in medication_dose_reasons with the code, source and recorder', 'ran_out/patient/true',
  (select r.reason_code || '/' || r.source::text || '/' || (r.recorded_by = pg_temp.f('pat'))::text from public.medication_dose_reasons r
    join public.medication_logs l on l.id = r.medication_log_id where l.scheduled_time = '08:00' and l.patient_id = pg_temp.f('pat')));
select pg_temp.ck('A', 'A3 a non-private reason stays on the dose row and makes no reason row', 'felt_well/0',
  (select reason from public.medication_logs where patient_id = pg_temp.f('pat') and scheduled_time = '13:00') || '/' ||
  (select count(*)::text from public.medication_dose_reasons r join public.medication_logs l on l.id = r.medication_log_id where l.scheduled_time = '13:00' and l.patient_id = pg_temp.f('pat')));
select pg_temp.ck('A', 'A4 control: the supporter still reads both dose rows, and neither shows ran_out', '2/0',
  pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.medication_logs') || '/' ||
  pg_temp.q_as(pg_temp.f('sup'), $q$select count(*)::text from public.medication_logs where reason = 'ran_out'$q$));

-- B. Who reads the reason --------------------------------------------------------------------------------------------------------------
select pg_temp.ck('B', 'B1 the person reads it', '1', pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.medication_dose_reasons'));
select pg_temp.ck('B', 'B2 a supporter with the medicines category does not, before an opt-in', '0', pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.medication_dose_reasons'));
select pg_temp.ck('B', 'B3 another patient does not', '0', pg_temp.q_as(pg_temp.f('pat2'), 'select count(*)::text from public.medication_dose_reasons'));
select pg_temp.ck('B', 'B4 anon is refused', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.medication_dose_reasons'));
select pg_temp.ck('B', 'B5 a tied clinician reads nothing directly', '0', pg_temp.q_as(pg_temp.f('tied'), 'select count(*)::text from public.medication_dose_reasons'));
select pg_temp.ck('B', 'B6 an opt-in for a NON-private code is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), $q$select public.set_dose_reason_sharing('felt_well', true)::text$q$));
select pg_temp.q_as(pg_temp.f('pat'), $q$select public.set_dose_reason_sharing('ran_out', true)::text$q$);
select pg_temp.ck('B', 'B7 after the person opts in for ran_out, the supporter reads it', '1', pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.medication_dose_reasons'));
select pg_temp.q_as(pg_temp.f('pat'), $q$select public.set_dose_reason_sharing('ran_out', false)::text$q$);
select pg_temp.ck('B', 'B8 after withdrawal the supporter reads nothing again', '0', pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.medication_dose_reasons'));
select pg_temp.ck('B', 'B9 the supporter cannot read the person''s sharing choice', '0', pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.dose_reason_sharing'));
select pg_temp.ck('B', 'B10 the tied clinician reads it through the audited read', 'ok/1',
  pg_temp.q_as(pg_temp.f('tied'), format($q$select (public.read_dose_reasons_audited(%L, 'checking why a dose was missed')->>'status') || '/' || jsonb_array_length(public.read_dose_reasons_audited(%L, 'checking why a dose was missed')->'rows')$q$, pg_temp.f('pat'), pg_temp.f('pat'))));
select pg_temp.ck('B', 'B11 that read is audited', 'true',
  (select (count(*) >= 1)::text from public.audit_log where actor_id = pg_temp.f('tied') and action = 'staff.chart_read' and result = 'success'));
select pg_temp.ck('B', 'B12 an untied clinician is denied', 'denied',
  pg_temp.q_as(pg_temp.f('untied'), format($q$select public.read_dose_reasons_audited(%L, 'checking why a dose was missed')->>'status'$q$, pg_temp.f('pat'))));
select pg_temp.ck('B', 'B13 a patient caller is refused', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select public.read_dose_reasons_audited(%L, 'checking why a dose was missed')::text$q$, pg_temp.f('pat'))));
select pg_temp.ck('B', 'B14 a short reason is refused', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('tied'), format($q$select public.read_dose_reasons_audited(%L, 'short')::text$q$, pg_temp.f('pat'))));
select pg_temp.ck('B', 'B15 anon cannot call the audited read', 'ERR:42501',
  pg_temp.anon_q(format($q$select public.read_dose_reasons_audited(%L, 'checking why a dose was missed')::text$q$, pg_temp.f('pat'))));

-- C. No direct writes --------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('C', 'C1 a client cannot insert a reason row', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.medication_dose_reasons (medication_log_id, organisation_id, patient_id, reason_code) select id, organisation_id, patient_id, 'ran_out' from public.medication_logs where patient_id = %L and scheduled_time = '13:00' returning 1$q$, pg_temp.f('pat'))));
select pg_temp.ck('C', 'C2 a client cannot change a sharing row directly', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), $q$update public.dose_reason_sharing set share_with_supporters = true returning 1$q$));
-- the function only ever writes the CALLER's own choice, so a supporter calling it cannot open the person's reason
select pg_temp.q_as(pg_temp.f('sup'), $q$select public.set_dose_reason_sharing('ran_out', true)::text$q$);
select pg_temp.ck('C', 'C3 a supporter setting their own sharing choice does not open the person''s reason', '0/0',
  pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.medication_dose_reasons') || '/' ||
  (select count(*)::text from public.dose_reason_sharing where patient_id = pg_temp.f('pat') and share_with_supporters));

-- D. No alert by itself ------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('D', 'D1 a ran-out tap raised no clinician alert and no outreach task', '0/0',
  (select count(*)::text from public.clinician_alerts where patient_id = pg_temp.f('pat')) || '/' ||
  (select count(*)::text from public.care_outreach_tasks where patient_id = pg_temp.f('pat')));

-- E. The guard ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('E', 'E1 the NAFDAC helper guard exists and is off', 'false',
  (select is_on::text from public.go_live_guards where key = 'nafdac_verify_helper_enabled'));

-- F. SABOTAGE ------------------------------------------------------------------------------------------------------------------------------
drop trigger medication_logs_divert_private_reason on public.medication_logs;
select pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.medication_logs (organisation_id, patient_id, medication_id, status, reason, scheduled_for_date, scheduled_time)
  values (%L, %L, %L, 'not_available', 'ran_out', current_date, '19:00') returning 1$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('med')));
select pg_temp.ck('F', 'F1 SABOTAGE: without the diverting trigger the supporter reads ran_out on the dose row (so A1 and A4 would FAIL)', '1',
  pg_temp.q_as(pg_temp.f('sup'), $q$select count(*)::text from public.medication_logs where reason = 'ran_out'$q$));
create or replace function private.supporter_may_see_dose_reason(p_patient uuid, p_code text) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.ck('F', 'F2 SABOTAGE: with the opt-in predicate permissive a supporter reads without opting in (so B2 would FAIL)', '1',
  pg_temp.q_as(pg_temp.f('sup'), 'select count(*)::text from public.medication_dose_reasons'));

select phase, check_name, expected, actual from results where expected is distinct from actual order by phase, check_name;
do $$ declare v_bad text; begin
  select string_agg(phase || ' ' || check_name || ' expected=' || expected || ' actual=' || coalesce(actual, 'null'), E'\n') into v_bad from results where expected is distinct from actual;
  if v_bad is not null then raise exception E'HOLE OPEN:\n%', v_bad; end if;
end $$;
select phase, check_name, expected, actual, 'PASS' as verdict from results order by phase, check_name;
rollback;
