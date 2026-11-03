-- ===========================================================================
-- Verification: 20261103012142_resolve_patient_service_access_knows_membership
--
-- The defect: public.resolve_patient_service_access() (the read model behind
-- Home's "Self-tracking / Monitoring active" card) only knew service_purchases,
-- so a patient holding an active Membership Plus was told on Home that the
-- account "does not include a clinician monitoring service" while the Vitals
-- page, one tap away, told the same person "as a Member, a doctor is told when
-- a reading is dangerous".
--
-- This script proves:
--   * a patient with a current Membership resolves to 'membership_active',
--     carrying the tier and the end date;
--   * Membership wins over an active continuous-monitoring purchase;
--   * an ENDED Membership does not count (status falls back to self_tracking);
--   * a Membership whose ends_at has passed but is still inside the grace
--     window still counts (same predicate as public.my_membership);
--   * sabotage: ending the member's row inside the transaction flips the
--     answer, so the check discriminates on the membership rather than
--     passing because of something else on the account.
--
-- Fixtures are self-built. Every call runs as `authenticated` with a simulated
-- JWT subject. Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

alter table public.service_products drop constraint service_products_doctor_time_not_sellable;
update public.service_products set is_active = true where code in ('continuous_monitoring_90d');

create temporary table rpsam_fixture(k text primary key, v uuid) on commit drop;
create temporary table rpsam_result(check_name text, observed text, expected text, verdict text) on commit drop;
grant select, insert on rpsam_fixture, rpsam_result to authenticated;

do $$
declare
  v_org          uuid := gen_random_uuid();
  v_member       uuid := gen_random_uuid();
  v_member_mon   uuid := gen_random_uuid();
  v_ended        uuid := gen_random_uuid();
  v_grace        uuid := gen_random_uuid();
  v_monitoring_product uuid;
begin
  insert into public.organisations (id, name, type) values (v_org, 'RPSAM Test Org', 'direct_consumer');

  select id into v_monitoring_product from public.service_products
   where code like 'continuous_monitoring_%' order by is_active desc, price_kobo limit 1;
  if v_monitoring_product is null then
    raise exception 'no continuous_monitoring_%% product available -- cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_member, 'rpsam-member@example.invalid', 'x', now(), '{}', '{}'),
    (v_member_mon, 'rpsam-member-mon@example.invalid', 'x', now(), '{}', '{}'),
    (v_ended, 'rpsam-ended@example.invalid', 'x', now(), '{}', '{}'),
    (v_grace, 'rpsam-grace@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_member, v_org, 'patient', 'RPSAM Member'),
    (v_member_mon, v_org, 'patient', 'RPSAM Member With Monitoring'),
    (v_ended, v_org, 'patient', 'RPSAM Ended Member'),
    (v_grace, v_org, 'patient', 'RPSAM Grace Member')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  -- A current Membership Plus, bought, a year out.
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, tier, is_test)
  values (v_org, v_member, 'purchase', 'active', now() - interval '1 day', now() + interval '364 days', 'plus', true);

  -- A Membership AND an active continuous-monitoring purchase: Membership must win.
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, tier, is_test)
  values (v_org, v_member_mon, 'purchase', 'active', now() - interval '1 day', now() + interval '364 days', 'evergreen', true);
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_member_mon, v_member_mon, v_monitoring_product, 'active', 3000000, 'NGN', now(), now() + interval '90 days');

  -- An ended Membership: must not count.
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, tier, is_test, ended_at, ended_by, end_reason)
  values (v_org, v_ended, 'purchase', 'ended', now() - interval '400 days', now() - interval '35 days', 'plus', true, now() - interval '35 days', v_ended, 'test fixture: ended membership');

  -- Past its end date but inside the grace window: still a member, as my_membership says.
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, tier, is_test)
  values (v_org, v_grace, 'purchase', 'active', now() - interval '366 days', now() - interval '1 day', 'plus', true);

  insert into rpsam_fixture values ('member', v_member), ('member_mon', v_member_mon), ('ended', v_ended), ('grace', v_grace);
end $$;

create or replace function pg_temp.rpsam_status(p_patient uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_patient::text, true);
  perform set_config('role', 'authenticated', true);
  select public.resolve_patient_service_access(p_patient) into v;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
  return v;
end $$;

-- 1. A current Membership resolves to membership_active with tier and end date.
do $$
declare v jsonb := pg_temp.rpsam_status((select v from rpsam_fixture where k = 'member'));
begin
  insert into rpsam_result values ('current Membership Plus resolves to membership_active', coalesce(v->>'status','null'), 'membership_active',
    case when v->>'status' = 'membership_active' then 'PASS' else 'FAIL' end);
  insert into rpsam_result values ('membership_active carries the tier', coalesce(v->>'membershipTier','null'), 'plus',
    case when v->>'membershipTier' = 'plus' then 'PASS' else 'FAIL' end);
  insert into rpsam_result values ('membership_active carries an end date', case when v->>'membershipEndsAt' is null then 'null' else 'set' end, 'set',
    case when v->>'membershipEndsAt' is not null then 'PASS' else 'FAIL' end);
  if v->>'status' is distinct from 'membership_active' or v->>'membershipTier' is distinct from 'plus' or v->>'membershipEndsAt' is null then
    raise exception 'HOLE OPEN: a current Membership did not resolve to membership_active with tier and end date, got %', v;
  end if;
end $$;

-- 2. Membership wins over an active continuous-monitoring purchase.
do $$
declare v jsonb := pg_temp.rpsam_status((select v from rpsam_fixture where k = 'member_mon'));
begin
  insert into rpsam_result values ('Membership wins over an active monitoring purchase', coalesce(v->>'status','null'), 'membership_active',
    case when v->>'status' = 'membership_active' then 'PASS' else 'FAIL' end);
  insert into rpsam_result values ('monitoringExpiresAt is still reported alongside', case when v->>'monitoringExpiresAt' is null then 'null' else 'set' end, 'set',
    case when v->>'monitoringExpiresAt' is not null then 'PASS' else 'FAIL' end);
  if v->>'status' is distinct from 'membership_active' then
    raise exception 'HOLE OPEN: monitoring took priority over Membership, got %', v->>'status';
  end if;
end $$;

-- 3. An ended Membership does not count.
do $$
declare v jsonb := pg_temp.rpsam_status((select v from rpsam_fixture where k = 'ended'));
begin
  insert into rpsam_result values ('an ended Membership resolves to self_tracking', coalesce(v->>'status','null'), 'self_tracking',
    case when v->>'status' = 'self_tracking' then 'PASS' else 'FAIL' end);
  if v->>'status' is distinct from 'self_tracking' then
    raise exception 'HOLE OPEN: an ended Membership still counted, got %', v->>'status';
  end if;
end $$;

-- 4. Inside the grace window still counts (same predicate as my_membership).
do $$
declare v jsonb := pg_temp.rpsam_status((select v from rpsam_fixture where k = 'grace'));
begin
  insert into rpsam_result values ('a Membership inside its grace window still resolves to membership_active', coalesce(v->>'status','null'), 'membership_active',
    case when v->>'status' = 'membership_active' then 'PASS' else 'FAIL' end);
  if v->>'status' is distinct from 'membership_active' then
    raise exception 'HOLE OPEN: a Membership inside the grace window was not counted, got %', v->>'status';
  end if;
end $$;

-- 5. SABOTAGE: end the member's row and the answer must change.
do $$
declare
  v_member uuid := (select v from rpsam_fixture where k = 'member');
  v jsonb;
begin
  update public.patient_memberships
     set state = 'ended', ended_at = now(), ended_by = v_member, end_reason = 'sabotage step: ended inside the proof'
   where patient_id = v_member;
  v := pg_temp.rpsam_status(v_member);
  insert into rpsam_result values ('SABOTAGE: ending the Membership flips the status', coalesce(v->>'status','null'), 'self_tracking',
    case when v->>'status' = 'self_tracking' then 'PASS' else 'FAIL' end);
  if v->>'status' is distinct from 'self_tracking' then
    raise exception 'PROOF DOES NOT DISCRIMINATE: the status stayed % after the Membership was ended', v->>'status';
  end if;
end $$;

select check_name, observed, expected, verdict from rpsam_result order by verdict desc, check_name;

rollback;
