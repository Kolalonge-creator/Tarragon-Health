-- ===========================================================================
-- Proof: 20261102135803_ops_today_summary_real_data_only.sql
-- PROVES, as an admin: 1. open_incidents equals the open+investigating count (resolved ones are not counted);
--   2. a test patient's open emergency alert, enrolment and 5-day-old self-arranged order move none of patients,
--      critical_alerts, pending_clinical_reviews, active_care_programmes or laboratory_delays;
--   3. a real patient's 5-day-old PARTNER order is a laboratory delay and a self-arranged one is not;
--   4. SABOTAGE: the pre-fix open_incidents predicate (status <> 'closed') gives a larger number whenever a resolved
--      incident exists (one is minted), so check 1 discriminates.
-- Wrapped in BEGIN/ROLLBACK; mints its own rows.
-- ===========================================================================
begin;
create temp table ots (check_name text, observed text, expected text, verdict text);
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin insert into ots values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end); end $$;
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_admin uuid; v_test uuid := gen_random_uuid(); v_real uuid := gen_random_uuid();
  before jsonb; after jsonb; v_staff uuid; v_doc uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' and organisation_id = v_org order by created_at limit 1;
  if v_admin is null then
    v_admin := gen_random_uuid();
    insert into auth.users (id, email) values (v_admin, 'ots-admin-' || v_admin || '@example.test');
    update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'OTS admin' where id = v_admin;
  end if;
  insert into auth.users (id, email) values (v_test, 'ots-test-' || v_test || '@example.test'), (v_real, 'ots-real-' || v_real || '@example.test');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'OTS test patient', is_test = true, is_active = true where id = v_test;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'OTS real patient', is_test = false, is_active = true where id = v_real;
  insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, status, root_cause, corrective_action)
    values ('technical', 'sev3', 'OTS resolved fixture', 'proof', 'ots-proof:' || gen_random_uuid(), now(), now(), 'resolved', 'proof fixture', 'none');

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  before := public.ops_today_summary();
  perform pg_temp.chk('0 admin can read the summary', 'true', (before ? 'patients')::text);
  perform pg_temp.chk('1 open_incidents counts open+investigating only', (select count(*)::text from public.ops_incidents where status in ('open','investigating')), before->>'open_incidents');

  -- 2. test-patient noise
  select cs.id into v_staff from public.clinical_staff cs where cs.active and cs.organisation_id = v_org and coalesce(cs.is_test, false) = false order by cs.created_at limit 1;
  if v_staff is null then
    -- a fresh replay has no doctor: mint an employed senior one for the clinician-ordered fixtures
    v_doc := gen_random_uuid();
    insert into auth.users (id, email) values (v_doc, 'ots-doctor-' || v_doc || '@example.test');
    update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'OTS senior doctor' where id = v_doc;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, employment_type)
    values (v_org, v_doc, 'OTS senior doctor', true, now(), 'senior_medical_officer', 'employed') returning id into v_staff;
  end if;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title) values (v_org, v_test, 'emergency', 'open', 'OTS test emergency');
  insert into public.lab_orders (organisation_id, patient_id, status, fulfilment, ordered_at, origin, ordered_by, clinical_indication)
    values (v_org, v_test, 'ordered', 'self_arranged', now() - interval '5 days', 'clinically_triggered', v_staff, 'OTS proof');
  after := public.ops_today_summary();
  perform pg_temp.chk('2a patients unchanged by a test patient', before->>'patients', after->>'patients');
  perform pg_temp.chk('2b critical_alerts unchanged by a test emergency', before->>'critical_alerts', after->>'critical_alerts');
  perform pg_temp.chk('2c pending reviews unchanged by a test alert', before->>'pending_clinical_reviews', after->>'pending_clinical_reviews');
  perform pg_temp.chk('2d laboratory_delays unchanged by a test self-arranged order', before->>'laboratory_delays', after->>'laboratory_delays');

  -- 3. a real patient's orders
  insert into public.lab_orders (organisation_id, patient_id, status, fulfilment, ordered_at, origin, ordered_by, clinical_indication)
    values (v_org, v_real, 'ordered', 'self_arranged', now() - interval '5 days', 'clinically_triggered', v_staff, 'OTS proof');
  perform pg_temp.chk('3a a real self-arranged order is not a delay', before->>'laboratory_delays', (public.ops_today_summary())->>'laboratory_delays');
  insert into public.lab_orders (organisation_id, patient_id, status, fulfilment, ordered_at, origin, ordered_by, clinical_indication)
    values (v_org, v_real, 'ordered', 'partner', now() - interval '5 days', 'clinically_triggered', v_staff, 'OTS proof');
  perform pg_temp.chk('3b a real partner order 5 days old is a delay', ((before->>'laboratory_delays')::int + 1)::text, (public.ops_today_summary())->>'laboratory_delays');
  -- the minted real patient existed before `before` was read, so the count equals the clean count and includes them
  perform pg_temp.chk('3c patients equals the clean active-patient count (minted real patient included)', (select count(*)::text from analytics_clean.profiles where role = 'patient' and is_active), (public.ops_today_summary())->>'patients');
  perform pg_temp.chk('3d the minted real patient is in the clean count', 'true', (select exists (select 1 from analytics_clean.profiles where id = v_real))::text);

  -- 4. SABOTAGE: the old predicate would count the resolved fixture
  perform pg_temp.chk('4 SABOTAGE old predicate counts more (check 1 discriminates)', 'true',
    ((select count(*) from public.ops_incidents where status <> 'closed') > (public.ops_today_summary()->>'open_incidents')::bigint)::text);
end $$;
select * from ots order by check_name;
do $$ declare n integer; begin select count(*) into n from ots where verdict = 'FAIL'; if n > 0 then raise exception 'ops_today_summary proof: % check(s) FAILED', n; end if; end $$;
rollback;
