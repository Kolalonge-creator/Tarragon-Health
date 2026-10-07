-- S78c proof: the clinician workload dashboard (spec 23.21) and a clinician's own reliability signal (spec 23.20).
-- Migration *_s78c_clinician_workload_and_own_reliability.sql. One rolled-back transaction proves:
--   1. The CMO reads the dashboard: claims, completed, hand-backs, median and 90th percentile minutes, overdue are right for fixture claims;
--      rows are by name (no ranking), carry no patient reference, and a test clinician's work and a test claim are excluded.
--   2. Every read is audited (audit_log workload_dashboard.read, with the actor).
--   3. Refused (42501): an administrator, an ordinary clinician, a patient, anon.
--   4. my_reliability_signal returns the caller's own score and counts only; a patient is refused; two clinicians see their own, different figures.
--   5. SABOTAGE: replace the gate with "any signed-in user"; the administrator would then read it, so the refusal check would have failed.
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
  values (v, 's78c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S78c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en')
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician', p_test);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S78c ' || p_label, 'MDCN', 'S78C-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, p_test);
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_a uuid; v_b uuid; v_t uuid; v_pt uuid; i integer; v_task uuid; v_claim uuid; v_d jsonb; v_row jsonb; v_sig jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false);
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', false);
  v_a := pg_temp.mkdoc(v_org, v_admin, 'a-alpha', 'senior_medical_officer', false);
  v_b := pg_temp.mkdoc(v_org, v_admin, 'b-beta', 'senior_medical_officer', false);
  v_t := pg_temp.mkdoc(v_org, v_admin, 'c-test', 'senior_medical_officer', true);
  v_pt := pg_temp.mkuser(v_org, 'patient', 'patient', false);

  -- Clinician A: three completed claims of 10, 20 and 100 minutes, one claim that expired, two hand-backs, one claim open and past due.
  -- Clinician B: one completed claim of 5 minutes. Clinician C (test): one completed claim that must not appear.
  set local session_replication_role = replica;
  for i in 1..9 loop
    insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, claimed_by, claimed_at, claim_expires_at, is_test, created_at)
      values (v_org, 'symptom_review', 1, 5, 5, v_pt, 'medical_officer', now() - interval '1 hour', case when i = 9 then 'claimed' else 'open' end::public.clinical_task_state,
              case when i = 9 then v_a end, case when i = 9 then now() - interval '2 hours' end, case when i = 9 then now() + interval '1 hour' end, false, now() - interval '3 days') returning id into v_task;
    insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
    select v_org, v_task,
           case when i <= 4 then v_a when i = 5 then v_b when i = 6 then v_t else v_a end,
           now() - interval '2 days',
           now() - interval '2 days' + interval '30 minutes',
           case when i = 9 then null else now() - interval '2 days' + (case i when 1 then interval '10 minutes' when 2 then interval '20 minutes' when 3 then interval '100 minutes' when 4 then interval '5 minutes' when 5 then interval '5 minutes' else interval '5 minutes' end) end,
           case when i = 4 then 'expired' when i = 9 then null when i in (7, 8) then 'handed_back' else 'completed' end,
           false;
  end loop;
  insert into public.task_handbacks (organisation_id, task_id, clinician_id, reason_code, is_test)
    select v_org, task_id, clinician_id, 'technical_problem', false from public.task_claims where clinician_id = v_a and end_reason = 'handed_back';
  set local session_replication_role = origin;

  -- 1. The CMO's read -------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  v_d := public.clinician_workload_dashboard(30);
  perform pg_temp.back();
  select r into v_row from jsonb_array_elements(v_d -> 'clinicians') r where r ->> 'clinician_id' = v_a::text;
  perform pg_temp.rec('A: claims (3 completed, 1 expired, 2 handed back, 1 open)', '7', v_row ->> 'claims');
  perform pg_temp.rec('A: completed', '3', v_row ->> 'completed');
  perform pg_temp.rec('A: hand-backs', '2', v_row ->> 'handbacks');
  perform pg_temp.rec('A: median minutes (10, 20, 100)', '20.0', v_row ->> 'median_minutes');
  perform pg_temp.rec('A: 90th percentile minutes (interpolated between 20 and 100)', '84.0', v_row ->> 'p90_minutes');
  perform pg_temp.rec('A: one task claimed now and past due', '1', v_row ->> 'overdue');
  select r into v_row from jsonb_array_elements(v_d -> 'clinicians') r where r ->> 'clinician_id' = v_b::text;
  perform pg_temp.rec('B: one completed claim of 5 minutes', '1,5.0,5.0,0', (v_row ->> 'completed') || ',' || (v_row ->> 'median_minutes') || ',' || (v_row ->> 'p90_minutes') || ',' || (v_row ->> 'overdue'));
  perform pg_temp.rec('a test clinician is excluded', '0', (select count(*)::text from jsonb_array_elements(v_d -> 'clinicians') r where r ->> 'clinician_id' = v_t::text));
  perform pg_temp.rec('rows are by name, not by any measure', 'S78c a-alpha,S78c b-beta', (select string_agg(r ->> 'name', ',' order by ord) from jsonb_array_elements(v_d -> 'clinicians') with ordinality as t(r, ord)));
  perform pg_temp.rec('no patient reference anywhere in the answer', 'false', (v_d::text ~* ('patient|' || v_pt::text))::text);

  -- 2. Audited ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('the read is audited with the actor', '1', (select count(*)::text from public.audit_log where action = 'workload_dashboard.read' and actor_id = v_cmo));

  -- 3. Who is refused -------------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an administrator is refused', '42501', pg_temp.try('select public.clinician_workload_dashboard(30)'));
  perform pg_temp.back();
  perform pg_temp.act(v_a);
  perform pg_temp.rec('an ordinary clinician is refused', '42501', pg_temp.try('select public.clinician_workload_dashboard(30)'));
  perform pg_temp.back();
  perform pg_temp.act(v_pt);
  perform pg_temp.rec('a patient is refused', '42501', pg_temp.try('select public.clinician_workload_dashboard(30)'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon is refused', '42501', pg_temp.try('select public.clinician_workload_dashboard(30)'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('a bad window is refused', '22023', pg_temp.try('select public.clinician_workload_dashboard(0)'));
  perform pg_temp.back();
  perform pg_temp.rec('refused reads are not audited as reads', '1', (select count(*)::text from public.audit_log where action = 'workload_dashboard.read'));

  -- 4. A clinician's own signal ---------------------------------------------------------------------------------------------------------
  insert into public.clinician_reliability_events (organisation_id, clinician_id, kind, good, weight, config_version, is_test)
    values (v_org, v_a, 'completed_on_time', 1, 1, 1, false), (v_org, v_a, 'completed_on_time', 1, 1, 1, false), (v_org, v_a, 'completed_late', 0.5, 1, 1, false),
           (v_org, v_a, 'claim_expired', 0, 1, 1, false), (v_org, v_a, 'handed_back_other', 0.5, 1, 1, false), (v_org, v_b, 'completed_on_time', 1, 1, 1, false);
  perform pg_temp.act(v_a);
  v_sig := public.my_reliability_signal();
  perform pg_temp.back();
  perform pg_temp.rec('A sees their own counts', '2,1,1,1', (v_sig ->> 'completed_on_time') || ',' || (v_sig ->> 'completed_late') || ',' || (v_sig ->> 'claims_expired') || ',' || (v_sig ->> 'handed_back'));
  perform pg_temp.act(v_b);
  v_sig := public.my_reliability_signal();
  perform pg_temp.back();
  perform pg_temp.rec('B sees only their own, different counts', '1,0,0,0', (v_sig ->> 'completed_on_time') || ',' || (v_sig ->> 'completed_late') || ',' || (v_sig ->> 'claims_expired') || ',' || (v_sig ->> 'handed_back'));
  perform pg_temp.rec('the answer carries no other clinician, rank or position', 'false', (v_sig::text ~* 'rank|position|percentile|better|worse|colleague')::text);
  perform pg_temp.act(v_pt);
  perform pg_temp.rec('a patient has no reliability signal', '42501', pg_temp.try('select public.my_reliability_signal()'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon has no reliability signal', '42501', pg_temp.try('select public.my_reliability_signal()'));
  perform pg_temp.back();

  -- 5. SABOTAGE: open the gate to any signed-in user --------------------------------------------------------------------------------------
  create or replace function private.cmo_of(p_org uuid) returns boolean language sql stable as $f$ select true $f$;
  perform pg_temp.act(v_admin);
  insert into results values ('sabotaged', 'an administrator is refused', '42501', pg_temp.try('select public.clinician_workload_dashboard(30)'));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S78c proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage step did not change the matching check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
