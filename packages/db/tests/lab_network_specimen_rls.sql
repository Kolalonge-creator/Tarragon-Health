-- ===========================================================================
-- Verification: the Laboratory Network & Diagnostic Services Platform
-- migration series (20260829122804 through 20260829123733) — specifically
-- that lab_specimens is correctly isolated per lab_partner, and that the
-- ownership check inside lab_partner_update_specimen_status/
-- lab_partner_reject_specimen genuinely refuses a caller who is not the
-- owning lab partner (including a caller who is not a lab_partner at all).
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
--
-- WHY THIS TEST EXISTS. A local, hand-built dependency-check harness (no
-- live Supabase project was reachable in the session that wrote this
-- migration series) caught a real bug during a functional smoke test: all
-- three of lab_partner_update_specimen_status, lab_partner_reject_specimen,
-- and assign_home_phlebotomist originally wrote their ownership check as
-- `if x is null or x <> private.lab_partner_provider() then raise` — which
-- looks like a refusal, but under SQL's three-valued logic, `<>` against a
-- NULL private.lab_partner_provider() (any caller who is not a lab partner
-- at all — the normal case for a patient or clinician) makes the whole
-- condition NULL, and PL/pgSQL's `if null then` does not raise. The
-- exception was silently skipped for exactly the caller it exists to
-- refuse. Fixed before any of this reached a real database; this test is
-- the permanent, re-runnable proof that stays true — same spirit as
-- lab_partner_rls.sql's own "confirmed to discriminate" discipline.
-- CONFIRMED TO DISCRIMINATE: reverting lab_partner_update_specimen_status's
-- ownership check to the buggy `x is null or x <> lab_partner_provider()`
-- form and re-running this file makes check 4 fail loudly (observed
-- `false` instead of `true`) while every other check still passes — the
-- bug is caught, not papered over by an unrelated failure. Check 5 covers
-- the same bug in lab_partner_reject_specimen and would fail the same way
-- if that function's check were reverted too.
--
-- Same pattern as lab_partner_rls.sql/scoped_access_roles_rls.sql/
-- m1_invariant_and_rls_suite.sql: set_config('request.jwt.claims', ...) +
-- set role authenticated simulates a real client session; running as the
-- connecting superuser would silently bypass RLS via table ownership.
-- ===========================================================================

begin;

create temporary table lab_network_result(
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
  v_lp_a       uuid;
  v_lp_b       uuid;
  v_patient    uuid;
  v_staff      uuid;
  v_clin       uuid;
  v_order_a    uuid;
  v_specimen_a uuid;
  v_specimen_b uuid;
  v_recollect  uuid;
  n_visible    int;
  n_status     text;
  n_status_after_collect text;
  n_recollect_count int;
  v_refused_3  boolean := false;
  v_refused_4  boolean := false;
  v_refused_5  boolean := false;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures (as the connecting superuser, RLS bypassed)
  -- ------------------------------------------------------------------------
  insert into public.lab_providers (name, is_active, contact_email, contact_phone)
    values ('VERIFY Lab Network A', true, 'ops@verify-lab-a.ng', '+2348030000201') returning id into v_lab_a;
  insert into public.lab_providers (name, is_active, contact_email, contact_phone)
    values ('VERIFY Lab Network B', true, 'ops@verify-lab-b.ng', '+2348030000202') returning id into v_lab_b;

  select id into v_patient from public.profiles
    where role = 'patient' and organisation_id = v_org order by id limit 1;
  select id into v_clin from public.profiles
    where role = 'clinician' and organisation_id = v_org order by id limit 1;
  if v_patient is null or v_clin is null then
    raise exception 'fixtures unavailable: need 1 patient and 1 clinician in org 0001';
  end if;

  -- Two lab_partner accounts, one per lab — reuses two distinct
  -- partner-employee accounts, same repurposing pattern as lab_partner_rls.sql.
  select id into v_lp_a from public.profiles where role = 'pharmacist' order by id limit 1;
  select id into v_lp_b from public.profiles where role = 'pharmacist' and id <> v_lp_a order by id limit 1;
  if v_lp_a is null or v_lp_b is null then
    raise exception 'fixtures unavailable: need 2 partner-employee accounts to repurpose';
  end if;
  update public.profiles set role = 'lab_partner', organisation_id = v_org, lab_provider_id = v_lab_a where id = v_lp_a;
  update public.profiles set role = 'lab_partner', organisation_id = v_org, lab_provider_id = v_lab_b where id = v_lp_b;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at, verified_by)
  values
    (v_org, v_clin, 'VERIFY Lab Network Ordering Clinician', 'tier_2', true, now(), v_patient)
  returning id into v_staff;

  -- One partner-billed order routed to Lab A, with the tarragon_negotiated
  -- cost the not-below-cost trigger requires.
  insert into public.lab_orders
    (organisation_id, patient_id, provider_id, partner_cost_provider_id, status, origin, ordered_by,
     fulfilment, total_kobo, partner_cost_kobo)
  values
    (v_org, v_patient, v_lab_a, v_lab_a, 'payment_confirmed', 'clinically_triggered', v_staff,
     'partner', 500000, 400000)
  returning id into v_order_a;

  -- The order-ready trigger (private.create_lab_specimen_on_order_ready)
  -- should already have created exactly one specimen for it.
  select id into v_specimen_a from public.lab_specimens where lab_order_id = v_order_a;
  if v_specimen_a is null then
    raise exception 'lab_orders_create_specimen trigger did not create a specimen for a payment_confirmed partner order';
  end if;

  -- A second, unrelated specimen belonging to Lab B, for the cross-lab
  -- isolation check — inserted directly since it needs no real order.
  insert into public.lab_specimens (organisation_id, lab_order_id, patient_id, provider_id)
    values (v_org, v_order_a, v_patient, v_lab_b) returning id into v_specimen_b;

  -- ------------------------------------------------------------------------
  -- Check 1-2: Lab A partner's own session
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_lp_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_visible from public.lab_specimens; -- RLS-scoped: only Lab A's own
  perform public.lab_partner_update_specimen_status(v_specimen_a, 'collected');
  select status::text into n_status_after_collect from public.lab_specimens where id = v_specimen_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 3: Lab B partner tries to advance LAB A's specimen — must refuse.
  -- Result rows are inserted only after switching back to the postgres role
  -- (the temp table is owned by that connection, and `authenticated` has no
  -- grant on it — same reason lab_partner_rls.sql inserts its own results
  -- only once every session's queries are done).
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_lp_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.lab_partner_update_specimen_status(v_specimen_a, 'in_transit');
  exception when others then
    if sqlerrm like '%not authorized%' then v_refused_3 := true; else raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 4: the patient (not a lab_partner at all — lab_partner_provider()
  -- is NULL for them) tries to advance the specimen — the exact bug found
  -- and fixed. Must refuse, not silently succeed.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.lab_partner_update_specimen_status(v_specimen_a, 'in_transit');
  exception when others then
    if sqlerrm like '%not authorized%' then v_refused_4 := true; else raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 5: same NULL-bypass check against lab_partner_reject_specimen.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.lab_partner_reject_specimen(v_specimen_a, 'insufficient_sample', 'test');
  exception when others then
    if sqlerrm like '%not authorized%' then v_refused_5 := true; else raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 6-7: Lab A partner rejects their own specimen — must succeed and
  -- open a chained recollection.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_lp_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select id into v_recollect from public.lab_partner_reject_specimen(v_specimen_a, 'insufficient_sample', 'clot in tube');
  perform set_config('role', 'postgres', true);

  select status::text into n_status from public.lab_specimens where id = v_specimen_a;
  select count(*) into n_recollect_count from public.lab_specimens
    where recollection_of = v_specimen_a and status = 'pending_collection';

  -- ------------------------------------------------------------------------
  -- Results
  -- ------------------------------------------------------------------------
  insert into lab_network_result values
    (1, 'Lab A partner sees only its own specimens via RLS (1, not 2)',
        '1', n_visible::text, case when n_visible = 1 then 'PASS' else 'FAIL' end),
    (2, 'Lab A partner CAN advance its own specimen (collected)',
        'collected', n_status_after_collect, case when n_status_after_collect = 'collected' then 'PASS' else 'FAIL' end),
    (3, 'Lab B partner refused when advancing Lab A''s specimen',
        'true', v_refused_3::text, case when v_refused_3 then 'PASS' else 'FAIL' end),
    (4, 'A non-lab_partner caller (NULL lab_partner_provider()) refused, not silently allowed',
        'true', v_refused_4::text, case when v_refused_4 then 'PASS' else 'FAIL' end),
    (5, 'A non-lab_partner caller refused by lab_partner_reject_specimen too',
        'true', v_refused_5::text, case when v_refused_5 then 'PASS' else 'FAIL' end),
    (6, 'Rejected specimen''s own status is ''rejected''',
        'rejected', (select status::text from public.lab_specimens where id = v_specimen_a),
        case when (select status::text from public.lab_specimens where id = v_specimen_a) = 'rejected' then 'PASS' else 'FAIL' end),
    (7, 'Exactly one pending_collection recollection specimen chained via recollection_of',
        '1', n_recollect_count::text, case when n_recollect_count = 1 then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from lab_network_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from lab_network_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'lab-network specimen RLS/authorization verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
