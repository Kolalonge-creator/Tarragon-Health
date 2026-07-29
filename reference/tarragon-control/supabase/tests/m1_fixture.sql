-- M1 RLS exit-test fixture.
-- Idempotent (ON CONFLICT DO NOTHING, fixed UUIDs) — safe to re-run against
-- a fresh staging project after supabase/migrations/*.sql have been applied.
--
-- Shape: one organisation, one clinician, two unrelated patients (A has an
-- active enrolment + a needs_review classification so the shared exception
-- queue and coordinator-assignment paths are both exercised; B has neither,
-- to prove cross-patient isolation).

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111101', 'authenticated', 'authenticated', 'patient.a@fixture.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111102', 'authenticated', 'authenticated', 'patient.b.unrelated@fixture.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111103', 'authenticated', 'authenticated', 'clinician.a@fixture.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111104', 'authenticated', 'authenticated', 'coordinator.a@fixture.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111105', 'authenticated', 'authenticated', 'institution.a@fixture.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111106', 'authenticated', 'authenticated', 'ops.a@fixture.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111107', 'authenticated', 'authenticated', 'superadmin.a@fixture.test', '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into profiles (id, role, full_name) values
  ('11111111-1111-1111-1111-111111111101', 'patient', 'Fixture Patient A'),
  ('11111111-1111-1111-1111-111111111102', 'patient', 'Fixture Patient B Unrelated'),
  ('11111111-1111-1111-1111-111111111103', 'clinician', 'Fixture Clinician A'),
  ('11111111-1111-1111-1111-111111111104', 'coordinator', 'Fixture Coordinator A'),
  ('11111111-1111-1111-1111-111111111105', 'institution_admin', 'Fixture Institution Admin A'),
  ('11111111-1111-1111-1111-111111111106', 'ops_admin', 'Fixture Ops Admin A'),
  ('11111111-1111-1111-1111-111111111107', 'superadmin', 'Fixture Superadmin A')
on conflict (id) do nothing;

insert into organisations (id, name, contact_email) values
  ('22222222-2222-2222-2222-222222222201', 'Fixture Employer Ltd', 'hr@fixture-employer.test')
on conflict (id) do nothing;

insert into programmes (code, display_name) values ('control', 'Control')
on conflict (code) do nothing;

insert into patients (id, profile_id, date_of_birth, sex_at_birth) values
  ('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111101', '1985-01-01', 'female'),
  ('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111102', '1990-01-01', 'male')
on conflict (id) do nothing;

insert into clinicians (id, profile_id, mdcn_number, mdcn_expiry, active) values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111103', 'MDCN-FIXTURE-001', '2030-01-01', true)
on conflict (id) do nothing;

insert into enrolments (id, patient_id, programme_code, organisation_id, status, started_at, assigned_coordinator_id)
select '77777777-7777-7777-7777-777777777701', '33333333-3333-3333-3333-333333333301', 'control', '22222222-2222-2222-2222-222222222201', 'active', now(), '11111111-1111-1111-1111-111111111104'
where not exists (select 1 from enrolments where id = '77777777-7777-7777-7777-777777777701');

insert into protocol_configs (id, code, version, ruleset, effective_from, approved_by, approved_at) values
  ('55555555-5555-5555-5555-555555555501', 'who_hearts', 'v0-provisional', '{"note":"conservative placeholder"}'::jsonb, now(), '44444444-4444-4444-4444-444444444401', now())
on conflict (id) do nothing;

insert into readings (id, patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail) values
  ('66666666-6666-6666-6666-666666666601', '33333333-3333-3333-3333-333333333301', 'bp', 150, 95, 'mmHg', now(), 'patient_manual', 'fixture-manual-entry')
on conflict (id) do nothing;

insert into triage_classifications (id, patient_id, reading_id, classification, protocol_config_id, rule_fired)
select '88888888-8888-8888-8888-888888888801', '33333333-3333-3333-3333-333333333301', '66666666-6666-6666-6666-666666666601', 'needs_review', '55555555-5555-5555-5555-555555555501', 'bp_needs_review_fixture'
where not exists (select 1 from triage_classifications where id = '88888888-8888-8888-8888-888888888801');
