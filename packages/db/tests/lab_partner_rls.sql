-- ===========================================================================
-- Verification: a lab_partner account reads zero patient rows directly, while
-- still being able to do its actual job, after
-- 20260729234618_harden_is_org_staff_exclude_lab_partner.sql.
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data; it
-- always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/scoped_access_roles_rls.sql and
-- m1_invariant_and_rls_suite.sql):
--   set_config('request.jwt.claims', ...) + set role authenticated
-- simulates a real client session. Running as the connecting superuser would
-- silently bypass RLS via table ownership — the role switch is what makes this
-- a real test.
--
-- WHY EVERY NEGATIVE IS PAIRED WITH A POSITIVE. A lab_partner reading 0
-- lab_orders proves nothing on its own: an account blocked from everything
-- would score the same, and so would an empty table (the platform database was
-- rebuilt on 2026-07-29 and lab_orders/lab_providers/clinical_staff are all
-- empty). So this script:
--   * seeds two real orders inside the transaction, routed to two DIFFERENT
--     labs, and
--   * pairs each refusal with a control in the same transaction — the same
--     rows ARE visible to a real clinician (check 5/6), and the lab partner CAN
--     still reach its own order through its RPC (check 3/4).
--
-- CONFIRMED TO DISCRIMINATE. Re-run with lab_partner removed from
-- private.is_org_staff's exclusion list (i.e. the state the un-renumbered
-- 20260727004500 migration would have left) and checks 1 and 2 fail loudly:
-- the lab partner reads 2 lab_orders and 30 profiles instead of 0 and 1. That
-- is the live PHI exposure this migration closes, observed rather than argued.
--
-- Results are returned as a table (db query does not surface RAISE NOTICE),
-- and the script raises at the end if any check failed, so it cannot pass
-- silently.
-- ===========================================================================

begin;

create temporary table lab_partner_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_lab_a      uuid;
  v_lab_b      uuid;
  v_lp         uuid;
  v_clin       uuid;
  v_pat_a      uuid;
  v_pat_b      uuid;
  v_staff      uuid;
  v_order_a    uuid;
  v_order_b    uuid;
  n_orders     int;
  n_profiles   int;
  n_rpc        int;
  n_rpc_own    int;
  n_rpc_b      int;
  n_clin_ord   int;
  n_clin_prof  int;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures (as the connecting superuser, RLS bypassed)
  -- ------------------------------------------------------------------------
  insert into public.lab_providers (name) values ('VERIFY Lab A') returning id into v_lab_a;
  insert into public.lab_providers (name) values ('VERIFY Lab B') returning id into v_lab_b;

  -- Two real patients in org 0001.
  select id into v_pat_a from public.profiles
    where role = 'patient' and organisation_id = v_org order by id limit 1;
  select id into v_pat_b from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_pat_a order by id limit 1;

  -- A real care-team account: the CONTROL. Everything the lab partner is
  -- refused below must be visible to this session, or the negative proves
  -- nothing.
  select id into v_clin from public.profiles
    where role = 'clinician' and organisation_id = v_org order by id limit 1;

  if v_pat_a is null or v_pat_b is null or v_clin is null then
    raise exception 'fixtures unavailable: need 2 patients and 1 clinician in org 0001';
  end if;

  -- The lab partner. A fresh `supabase db reset` has no pre-existing
  -- partner-employee account to repurpose (only clinician/care_coordinator/
  -- admin/corporate_admin/hmo_admin are seeded by 20260827100300_seed_ci_
  -- fixture_staff_and_patient_subscriptions.sql), so self-provision one:
  -- insert a fresh auth.users row (on_auth_user_created defaults it to
  -- role='patient' in the direct-consumer org) then point it at Lab A,
  -- keeping organisation_id set to a REAL org — that non-null org id is
  -- precisely the misconfiguration the admin provisioning UI allows (its
  -- "Organisation (optional)" field does not distinguish by role), and
  -- precisely what used to satisfy private.is_org_staff.
  v_lp := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_lp, 'verify.lab-partner@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles
     set role = 'lab_partner', organisation_id = v_org, lab_provider_id = v_lab_a
   where id = v_lp;

  -- An active clinical_staff row to own the orders: enforce_lab_order_origin
  -- refuses a clinically_triggered order without one. Tier 2 and not a clinical
  -- director, so the indemnity activation trigger does not apply.
  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, doctor_tier, active,
     license_verified_at, verified_by)
  values
    (v_org, v_clin, 'VERIFY Ordering Clinician', 'tier_2', true, now(), v_pat_a)
  returning id into v_staff;

  -- One order routed to the partner's OWN lab, one to a competitor's. Both ids
  -- are captured HERE, as superuser, so the cross-lab checks below compare
  -- against real values rather than against an RLS-scoped subquery — such a
  -- subquery returns nothing inside the partner's own session and would make
  -- the isolation check pass vacuously.
  --
  -- fulfilment = 'partner' is required here: the table default, 'self_arranged'
  -- (since 20260803124833_self_arranged_lab_fulfilment.sql), cannot name a
  -- provider_id at all (private.enforce_lab_order_origin rejects it outright).
  -- No panel_bundle_id/pricing/region setup is needed to go with it, though:
  -- these orders are origin = 'clinically_triggered', not 'patient_initiated',
  -- so enforce_lab_order_origin's self-bookable/schedule branch and
  -- enforce_lab_order_region's gate never run for them (both only apply to the
  -- patient_initiated branch); and private.set_lab_order_computed_price (the
  -- trigger that would compute total_kobo/partner_cost_kobo for a partner
  -- order) itself no-ops whenever panel_bundle_id is null, which it is here —
  -- this file is proving RLS isolation between two lab-partner-linked staff
  -- accounts, not money, so total_kobo staying at its 0 default is correct.
  insert into public.lab_orders
    (organisation_id, patient_id, provider_id, status, origin, ordered_by, fulfilment)
  values (v_org, v_pat_a, v_lab_a, 'payment_confirmed', 'clinically_triggered', v_staff, 'partner')
  returning id into v_order_a;
  insert into public.lab_orders
    (organisation_id, patient_id, provider_id, status, origin, ordered_by, fulfilment)
  values (v_org, v_pat_b, v_lab_b, 'payment_confirmed', 'clinically_triggered', v_staff, 'partner')
  returning id into v_order_b;

  -- ------------------------------------------------------------------------
  -- The lab partner's own session
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_lp, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_orders   from public.lab_orders;
  select count(*) into n_profiles from public.profiles;
  select count(*) into n_rpc      from public.lab_partner_orders();
  select count(*) into n_rpc_own  from public.lab_partner_orders() where order_id = v_order_a;
  select count(*) into n_rpc_b    from public.lab_partner_orders() where order_id = v_order_b;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- The control session: a real clinician in the same organisation
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_clin_ord  from public.lab_orders;
  select count(*) into n_clin_prof from public.profiles;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------------
  -- Results
  -- ------------------------------------------------------------------------
  insert into lab_partner_result values
    (1, 'lab_partner: direct read of lab_orders',
        '0', n_orders::text,
        case when n_orders = 0 then 'PASS' else 'FAIL' end),
    (2, 'lab_partner: direct read of profiles (own row only)',
        '1', n_profiles::text,
        case when n_profiles = 1 then 'PASS' else 'FAIL' end),
    (3, 'CONTROL — lab_partner CAN still work: lab_partner_orders() RPC',
        '1', n_rpc::text,
        case when n_rpc = 1 then 'PASS' else 'FAIL' end),
    (4, 'CONTROL — the RPC returns its own Lab A order',
        '1', n_rpc_own::text,
        case when n_rpc_own = 1 then 'PASS' else 'FAIL' end),
    (5, 'cross-lab isolation: the RPC does NOT return Lab B''s order',
        '0', n_rpc_b::text,
        case when n_rpc_b = 0 then 'PASS' else 'FAIL' end),
    (6, 'CONTROL — clinician reads both lab_orders directly',
        '2', n_clin_ord::text,
        case when n_clin_ord = 2 then 'PASS' else 'FAIL' end),
    (7, 'CONTROL — clinician reads the organisation''s profiles directly',
        '>1', n_clin_prof::text,
        case when n_clin_prof > 1 then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from lab_partner_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from lab_partner_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'lab_partner RLS verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
