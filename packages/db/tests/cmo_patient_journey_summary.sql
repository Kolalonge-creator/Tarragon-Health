-- CMO Clinical Operations, slice 1 proof: public.cmo_patient_journey_summary().
-- Migration *_cmo_patient_journey_summary.sql. One rolled-back transaction proves:
--   1. The CMO's figures move by exactly the fixture: two real patients (one through every stage, one stuck at several), and a
--      test patient whose rows must not count anywhere. Deltas against a baseline, so existing data does not matter.
--   2. The CMO counts patients they are NOT tied to (the reason this is SECURITY DEFINER): the CMO has no care-team row, alert,
--      escalation or appointment for either fixture patient.
--   3. The answer carries no patient identity (no fixture patient id or name appears in it).
--   4. Refused (42501): an administrator, an ordinary clinician, a patient, anon.
--   5. SABOTAGE: replace the CMO gate with "any signed-in user"; the ordinary clinician would then read it.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cmojourney-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CmoJourney ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en')
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician', false);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'CmoJourney ' || p_label, 'MDCN', 'CMOJ-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, false);
  return v;
end $f$;
create function pg_temp.summary(p_cmo uuid) returns jsonb language plpgsql as
$f$ declare v jsonb; begin perform pg_temp.act(p_cmo); v := public.cmo_patient_journey_summary(); perform pg_temp.back(); return v; end $f$;
create function pg_temp.delta(p_before jsonb, p_after jsonb, p_path text[]) returns text language sql as
$$ select ((p_after #>> p_path)::numeric - coalesce((p_before #>> p_path)::numeric, 0))::text $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_coord uuid; v_p1 uuid; v_p2 uuid; v_t uuid; v_o1 uuid;
  v_before jsonb; v_after jsonb; p uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false);
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkdoc(v_org, v_admin, 'doctor', 'senior_medical_officer');
  v_coord := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator', false);

  v_before := pg_temp.summary(v_cmo);

  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient', false);
  v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient', false);
  -- Created as an ordinary patient, then flagged as a test account with triggers off (private.guard_is_test_flag only lets an admin
  -- or a service context set the flag, and this script runs as neither).
  v_t := pg_temp.mkuser(v_org, 'ptest', 'patient', false);

  set local session_replication_role = replica;
  update public.profiles set is_test = true where id = v_t;
  -- P1 and the test patient go through every stage; P2 is stuck: not onboarded, a result outstanding, an upload unreviewed, a
  -- follow-up overdue, a draft care plan.
  foreach p in array array[v_p1, v_t] loop
    update public.profiles set created_at = now() - interval '10 days', onboarding_completed_at = now() - interval '8 days' where id = p;
    insert into public.care_team_assignment (organisation_id, patient_id, care_coordinator_id) values (v_org, p, v_coord);
    insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, p, 'hypertension', 'active');
    insert into public.lab_orders (organisation_id, patient_id, status, ordered_at, resulted_at)
      values (v_org, p, 'resulted', now() - interval '5 days', now() - interval '2 days') returning id into v_o1;
    insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, source, reviewed_at, reviewed_by)
      values (v_org, p, v_o1, 'cmoj/' || p || '.pdf', 'clinician', now() - interval '1 day', v_doc);
    insert into public.clinical_follow_ups (organisation_id, patient_id, kind, owner_id, due_at, created_by, state, outcome, outcome_reason, closed_at, closed_by, is_test, created_at)
      values (v_org, p, 'follow_up', v_doc, now() + interval '3 days', v_doc, 'closed', 'done', 'patient seen and plan agreed', now() - interval '1 hour', v_doc, p = v_t, now() - interval '1 day');
  end loop;
  update public.profiles set created_at = now() - interval '6 days', onboarding_completed_at = null where id = v_p2;
  insert into public.care_plans (organisation_id, patient_id, condition, status, created_at) values (v_org, v_p2, 'diabetes', 'draft', now() - interval '4 days');
  insert into public.lab_orders (organisation_id, patient_id, status, ordered_at) values (v_org, v_p2, 'ordered', now() - interval '9 days');
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source, created_at) values (v_org, v_p2, 'cmoj/p2.pdf', 'patient', now() - interval '3 days');
  insert into public.clinical_follow_ups (organisation_id, patient_id, kind, owner_id, due_at, created_by, state, created_at)
    values (v_org, v_p2, 'follow_up', v_doc, now() - interval '2 days', v_doc, 'open', now() - interval '7 days');
  set local session_replication_role = origin;

  v_after := pg_temp.summary(v_cmo);

  perform pg_temp.rec('registered +2 (test patient excluded)', '2', pg_temp.delta(v_before, v_after, '{stages,registered}'));
  perform pg_temp.rec('onboarded +1', '1', pg_temp.delta(v_before, v_after, '{stages,onboarded}'));
  perform pg_temp.rec('with coordinator +1', '1', pg_temp.delta(v_before, v_after, '{stages,with_coordinator}'));
  perform pg_temp.rec('care plan approved +1 (draft is not approved)', '1', pg_temp.delta(v_before, v_after, '{stages,care_plan_approved}'));
  perform pg_temp.rec('investigation ordered +2', '2', pg_temp.delta(v_before, v_after, '{stages,investigation_ordered}'));
  perform pg_temp.rec('result received +2 (resulted order, or an upload)', '2', pg_temp.delta(v_before, v_after, '{stages,result_received}'));
  perform pg_temp.rec('result reviewed +1', '1', pg_temp.delta(v_before, v_after, '{stages,result_reviewed}'));
  perform pg_temp.rec('follow-up raised +2', '2', pg_temp.delta(v_before, v_after, '{stages,follow_up_raised}'));
  perform pg_temp.rec('follow-up all closed +1', '1', pg_temp.delta(v_before, v_after, '{stages,follow_up_all_closed}'));
  perform pg_temp.rec('awaiting onboarding +1', '1', pg_temp.delta(v_before, v_after, '{awaiting,onboarding,count}'));
  perform pg_temp.rec('awaiting care plan approval +1', '1', pg_temp.delta(v_before, v_after, '{awaiting,care_plan_approval,count}'));
  perform pg_temp.rec('awaiting investigation result +1', '1', pg_temp.delta(v_before, v_after, '{awaiting,investigation_result,count}'));
  perform pg_temp.rec('awaiting doctor review +1', '1', pg_temp.delta(v_before, v_after, '{awaiting,doctor_review,count}'));
  perform pg_temp.rec('follow-ups open +1', '1', pg_temp.delta(v_before, v_after, '{awaiting,follow_up_open,count}'));
  perform pg_temp.rec('follow-ups overdue +1', '1', pg_temp.delta(v_before, v_after, '{awaiting,follow_up_overdue,count}'));
  perform pg_temp.rec('patients with no coordinator +1', '1', pg_temp.delta(v_before, v_after, '{awaiting,no_coordinator,count}'));
  perform pg_temp.rec('oldest awaiting result is at least 9 days', 'true', ((v_after #>> '{awaiting,investigation_result,oldest_days}')::numeric >= 9)::text);
  perform pg_temp.rec('the CMO is tied to neither fixture patient', 'false',
      (exists (select 1 from public.care_team_assignment where patient_id in (v_p1, v_p2) and v_cmo in (clinician_id, clinical_director_id, care_coordinator_id)))::text);
  perform pg_temp.rec('no patient id or name in the answer', 'false',
      (v_after::text ~* (v_p1::text || '|' || v_p2::text || '|CmoJourney'))::text);

  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an administrator is refused', '42501', pg_temp.try('select public.cmo_patient_journey_summary()'));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('an ordinary clinician is refused', '42501', pg_temp.try('select public.cmo_patient_journey_summary()'));
  perform pg_temp.back();
  perform pg_temp.act(v_p1);
  perform pg_temp.rec('a patient is refused', '42501', pg_temp.try('select public.cmo_patient_journey_summary()'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon is refused', '42501', pg_temp.try('select public.cmo_patient_journey_summary()'));
  perform pg_temp.back();

  -- SABOTAGE: an ungated function (any signed-in user) must be caught by the ordinary-clinician check above.
  create or replace function private.cmo_of(p_org uuid) returns boolean language sql stable as $f$ select true $f$;
  perform pg_temp.act(v_doc);
  insert into results values ('sabotaged', 'an ordinary clinician is refused', '42501', pg_temp.try('select public.cmo_patient_journey_summary()'));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'CMO journey proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage step did not change the matching check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
