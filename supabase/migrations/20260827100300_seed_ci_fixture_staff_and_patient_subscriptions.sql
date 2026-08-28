-- Local/CI-only fix-forward, NOT a functional migration -- test-support
-- fixtures for packages/db/tests.
--
-- packages/db/tests has never been run against a genuinely fresh database
-- before this sprint (`supabase db reset` never completed successfully
-- until now, see the migration history immediately preceding this one) --
-- it was developed and spot-checked against the live project, which has
-- years of accumulated real patient/staff data. Running the suite for the
-- first time against a fresh replay surfaced that a large share of its
-- failures share one root cause: no migration or seed file has ever created
-- a clinician/care_coordinator/admin/hmo_admin/corporate_admin-role profile,
-- or given a test patient an active paid subscription -- both of which many
-- tests assume already exist, either via an explicit "no clinician account"
-- guard, or, worse, silently via an RLS no-op when a NULL profile id is used
-- as a JWT `sub`.
--
-- Part 1 seeds one profile per non-patient role, all in the direct-consumer
-- org, so any test doing `select id from profiles where role = 'x' limit 1`
-- finds a real row instead of NULL. The clinician fixture also gets a
-- linked, active, license-verified clinical_staff row (tier_1 -- no
-- indemnity required at that tier, see clinical_staff_active_requires_
-- verification / enforce_clinical_staff_indemnity) so is_org_staff()/
-- tier-authority checks resolve for it too. A second clinician profile
-- (no clinical_staff row -- individual tests that need one build their own,
-- e.g. emergency_escalation_tier_gate.sql) covers tests that need 3+
-- distinct clinician/admin profiles to build a multi-tier fixture against
-- (that test's own header explains why it must be clinician/admin roles
-- specifically, not just "not a patient"). Guarded to be a genuine no-op on
-- live: skips entirely once any profile with one of these roles already
-- exists in the org, which is always true there.
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_clinician uuid;
  v_clinician2 uuid;
  v_care_coordinator uuid;
  v_admin uuid;
  v_corporate_admin uuid;
  v_hmo_admin uuid;
begin
  if exists (
    select 1 from public.profiles
    where organisation_id = v_org
      and role in ('clinician', 'care_coordinator', 'admin', 'corporate_admin', 'hmo_admin')
  ) then
    return;
  end if;

  v_clinician := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clinician, 'ci-fixture-clinician@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'clinician', full_name = 'CI Fixture Clinician'
    where id = v_clinician;

  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at,
    credential_type, credential_number
  ) values (
    v_org, v_clinician, 'CI Fixture Clinician', 'tier_1', true, now(),
    'MDCN', 'CI-FIXTURE-CLINICIAN-0001'
  );

  v_clinician2 := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clinician2, 'ci-fixture-clinician-2@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'clinician', full_name = 'CI Fixture Clinician 2'
    where id = v_clinician2;

  v_care_coordinator := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_care_coordinator, 'ci-fixture-care-coordinator@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'care_coordinator', full_name = 'CI Fixture Care Coordinator'
    where id = v_care_coordinator;

  v_admin := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'ci-fixture-admin@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'admin', full_name = 'CI Fixture Admin'
    where id = v_admin;

  v_corporate_admin := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_corporate_admin, 'ci-fixture-corporate-admin@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'corporate_admin', full_name = 'CI Fixture Corporate Admin'
    where id = v_corporate_admin;

  v_hmo_admin := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_hmo_admin, 'ci-fixture-hmo-admin@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'hmo_admin', full_name = 'CI Fixture HMO Admin'
    where id = v_hmo_admin;
end $$;

-- ---------------------------------------------------------------------------
-- Part 2: an active paid subscription for the two existing CI/QA fixture
-- patients (20260706084838_seed_ci_fixture_patient_profile.sql,
-- 20260820183247_seed_qa_test_patient_account_for_real_patient_ids_
-- exclusion.sql), so the vitals-red-flag paid-plan gate
-- (20260810022401_gate_vitals_red_flag_escalation_to_paid_plans.sql) has a
-- genuinely paid patient to test against -- the exact fixture shape
-- packages/db/tests/vitals_red_flag_plan_gate.sql already self-provisions
-- and passes with today.
--
-- Looked up by feature-array membership, not a hardcoded plan code: plan
-- code/price/is_active have churned repeatedly per CLAUDE.md's own standing
-- notes, and private.patient_has_feature_access() never checks
-- subscription_plans.is_active at all -- only the subscription row's own
-- status and the plan's features array -- so a plan that's since been
-- deactivated for new signups still grants access through an existing
-- subscription, and this lookup doesn't need to filter on is_active either.
--
-- Scoped to the two specific known fixture patient ids, not "every patient
-- profile lacking a subscription" -- those ids never exist on live (both
-- fixtures are themselves guarded CI-only inserts), so this is a genuine
-- no-op there by construction, not just by the not-exists guard below.
do $$
declare
  v_plan uuid;
begin
  select id into v_plan
    from public.subscription_plans
    where 'vitals_red_flag_doctor_escalation' = any(features)
    limit 1;

  if v_plan is null then
    raise notice 'no subscription_plans row grants vitals_red_flag_doctor_escalation; skipping fixture subscription';
    return;
  end if;

  insert into public.subscriptions (organisation_id, subscriber_id, plan_id, status)
  select p.organisation_id, p.id, v_plan, 'active'
  from public.profiles p
  where p.id in (
    '00000000-0000-0000-0000-0000000000f2',
    '00000000-0000-0000-0000-0000000000f3'
  )
  and p.organisation_id is not null
  and not exists (
    select 1 from public.subscriptions s
    where s.subscriber_id = p.id and s.status in ('active', 'trialing')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Part 3: three named QA patient accounts, by exact email address.
--
-- 5 packages/db/tests files (acting_for_someone.sql,
-- medication_logs_acting_for.sql, sponsor_care_status_and_funding.sql,
-- supporter_accounts.sql, supporter_reporting.sql) look these three up by
-- exact email -- `patient.complete.test@tarragon.test`,
-- `patient.diaspora.test@tarragon.test`, `patient.free.test@tarragon.test`
-- -- as three distinct patient identities to build supporter/sponsor
-- relationships against. These are real named accounts from the 2026-07-29
-- QA seed batch (project_qa_test_accounts_20260727 -- 23 accounts, 9
-- role='patient') that, like every other piece of that batch encountered
-- so far in this sprint, was never created by any migration -- it exists on
-- live only because it was seeded directly, out of band.
--
-- Each guarded independently by exact email, so this is a genuine no-op on
-- live (all three already exist there) regardless of whether the other two
-- do.
do $$
declare
  v_email text;
  v_id uuid;
begin
  foreach v_email in array array[
    'patient.complete.test@tarragon.test',
    'patient.diaspora.test@tarragon.test',
    'patient.free.test@tarragon.test'
  ]
  loop
    if not exists (select 1 from auth.users where email = v_email) then
      v_id := gen_random_uuid();
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_id, v_email, 'x', now(), '{}', '{}');
    end if;
  end loop;
end $$;
