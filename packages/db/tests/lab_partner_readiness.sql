-- ===========================================================================
-- Verification: lab-partner-readiness build (2026-07-30) —
--   1. facilities self-service RLS (facilities_insert_lab_partner /
--      facilities_update_lab_partner, 20260730215206)
--   2. lab_provider_turnaround_stats / lab_partner_turnaround_stats
--      (20260730215234)
--   3. admin_link_lab_partner (20260730215245)
--
-- Run via `supabase db query --linked -f <this file>` or the SQL editor.
-- Wrapped in BEGIN/ROLLBACK — always leaves the database exactly as found.
--
-- Pattern (same as packages/db/tests/lab_partner_rls.sql): set_config +
-- `set role authenticated` simulates a real client session; running as the
-- connecting superuser would silently bypass RLS via table ownership.
-- Existing spare accounts (pharmacist, lab_liaison, analyst) are repurposed
-- transiently for the duration of this rolled-back transaction, same as the
-- existing lab_partner_rls.sql test does.
-- ===========================================================================

begin;

create temporary table readiness_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org          uuid := '00000000-0000-0000-0000-000000000001';
  v_lab_a        uuid;
  v_lab_b        uuid;
  v_lp_a         uuid; -- lab_partner A account (repurposed pharmacist)
  v_lp_b         uuid; -- lab_partner B account (repurposed lab_liaison)
  v_unlinked     uuid; -- a fresh lab_partner login with no lab yet (repurposed analyst)
  v_admin        uuid;
  v_patient      uuid;
  v_facility_a   uuid;
  v_facility_b   uuid;
  v_order_a      uuid;
  n              int;
  rows_affected  int;
  own_id         uuid;
  raised_code    text;
  n_stats_rows   int;
  n_own_row      numeric;
  n_admin_result numeric;
begin
  -- --------------------------------------------------------------------
  -- Fixtures (as the connecting superuser, RLS bypassed)
  -- --------------------------------------------------------------------
  insert into public.lab_providers (name) values ('READINESS Lab A') returning id into v_lab_a;
  insert into public.lab_providers (name) values ('READINESS Lab B') returning id into v_lab_b;

  select id into v_lp_a from public.profiles where role = 'pharmacist' limit 1;
  select id into v_lp_b from public.profiles where role = 'lab_liaison' limit 1;
  select id into v_unlinked from public.profiles where role = 'analyst' limit 1;
  select id into v_admin from public.profiles where role = 'admin' order by id limit 1;
  select id into v_patient from public.profiles where role = 'patient' order by id limit 1;

  if v_lp_a is null or v_lp_b is null or v_unlinked is null or v_admin is null or v_patient is null then
    raise exception 'fixtures unavailable: need a pharmacist, lab_liaison, analyst, admin and patient account';
  end if;

  update public.profiles set role = 'lab_partner', organisation_id = v_org, lab_provider_id = v_lab_a where id = v_lp_a;
  update public.profiles set role = 'lab_partner', organisation_id = v_org, lab_provider_id = v_lab_b where id = v_lp_b;
  update public.profiles set role = 'lab_partner', organisation_id = null, lab_provider_id = null where id = v_unlinked;

  -- A pre-existing facility for Lab B, owned as superuser, so the
  -- cross-lab update-isolation check has a real row to fail against.
  insert into public.facilities (name, type, state, city, lab_provider_id)
    values ('READINESS Lab B Branch', 'lab', 'Lagos', 'Ikeja', v_lab_b)
    returning id into v_facility_b;

  -- =====================================================================
  -- Part 1 — facilities self-service RLS
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_lp_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1. Lab A can insert its own facility.
  insert into public.facilities (name, type, state, city, lab_provider_id)
    values ('READINESS Lab A Branch', 'lab', 'Lagos', 'Yaba', v_lab_a)
    returning id into v_facility_a;

  insert into readiness_result values (1, 'lab_partner A: insert own-lab facility', 'succeeds', 'succeeded', 'PASS');

  -- 2. Lab A CANNOT insert a facility claiming to belong to Lab B.
  raised_code := null;
  begin
    insert into public.facilities (name, type, state, city, lab_provider_id)
      values ('READINESS Sabotage Branch', 'lab', 'Lagos', 'Ikeja', v_lab_b);
    raised_code := 'no_error';
  exception when insufficient_privilege then
    raised_code := 'insufficient_privilege';
  end;
  insert into readiness_result values (2, 'lab_partner A: insert claiming Lab B is blocked',
    'insufficient_privilege', raised_code, case when raised_code = 'insufficient_privilege' then 'PASS' else 'FAIL' end);

  -- 3. Lab A can update its own facility.
  update public.facilities set contact_phone = '+2348030009999' where id = v_facility_a;
  get diagnostics rows_affected = row_count;
  insert into readiness_result values (3, 'lab_partner A: update own facility', '1', rows_affected::text,
    case when rows_affected = 1 then 'PASS' else 'FAIL' end);

  -- 4. Lab A cannot update Lab B's facility (RLS USING clause hides the
  -- row entirely, so this affects 0 rows rather than raising).
  update public.facilities set contact_phone = '+2348030000000' where id = v_facility_b;
  get diagnostics rows_affected = row_count;
  insert into readiness_result values (4, 'lab_partner A: update Lab B facility affects 0 rows',
    '0', rows_affected::text, case when rows_affected = 0 then 'PASS' else 'FAIL' end);

  -- 5. lab_partner_own_provider_id() resolves to the caller's own lab.
  select public.lab_partner_own_provider_id() into own_id;
  insert into readiness_result values (5, 'lab_partner A: lab_partner_own_provider_id() = Lab A',
    v_lab_a::text, own_id::text, case when own_id = v_lab_a then 'PASS' else 'FAIL' end);

  -- 6. lab_provider_turnaround_stats() is admin/RBAC-only — a lab_partner
  -- (no partners.labs.manage grant) is refused.
  raised_code := null;
  begin
    perform count(*) from public.lab_provider_turnaround_stats();
    raised_code := 'no_error';
  exception when insufficient_privilege then
    raised_code := 'insufficient_privilege';
  end;
  insert into readiness_result values (6, 'lab_partner A: lab_provider_turnaround_stats() refused',
    'insufficient_privilege', raised_code, case when raised_code = 'insufficient_privilege' then 'PASS' else 'FAIL' end);

  perform set_config('role', 'postgres', true);

  -- =====================================================================
  -- Part 2 — CONTROL: a different lab partner (Lab B) cannot touch Lab A's
  -- brand-new facility either.
  -- =====================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_lp_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  update public.facilities set is_active = false where id = v_facility_a;
  get diagnostics rows_affected = row_count;
  insert into readiness_result values (7, 'CONTROL — lab_partner B: update Lab A facility affects 0 rows',
    '0', rows_affected::text, case when rows_affected = 0 then 'PASS' else 'FAIL' end);

  perform set_config('role', 'postgres', true);

  -- =====================================================================
  -- Part 3 — turnaround stats correctness (as superuser, seed one resulted
  -- order for Lab A only, then check both RPCs)
  -- =====================================================================
  insert into public.lab_orders
    (organisation_id, patient_id, provider_id, status, origin,
     payment_confirmed_at, resulted_at)
  values
    (v_org, v_patient, v_lab_a, 'resulted', 'patient_initiated',
     now() - interval '30 hours', now())
  returning id into v_order_a;

  -- 8. Admin sees the scorecard across both labs; Lab A shows 1 resulted
  -- order (still suppressed — below the n=5 floor).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_stats_rows from public.lab_provider_turnaround_stats() where provider_id in (v_lab_a, v_lab_b);
  insert into readiness_result values (8, 'admin: lab_provider_turnaround_stats() sees both test labs',
    '2', n_stats_rows::text, case when n_stats_rows = 2 then 'PASS' else 'FAIL' end);

  select orders_resulted into n_own_row from public.lab_provider_turnaround_stats() where provider_id = v_lab_a;
  insert into readiness_result values (9, 'admin: Lab A shows exactly 1 resulted order',
    '1', n_own_row::text, case when n_own_row = 1 then 'PASS' else 'FAIL' end);

  perform set_config('role', 'postgres', true);

  -- 10. Lab A's own self-view shows its 1 order; Lab B's self-view shows 0
  -- (isolation — the RPC must not leak Lab A's numbers into Lab B's view).
  perform set_config('request.jwt.claims', json_build_object('sub', v_lp_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select orders_resulted into n_own_row from public.lab_partner_turnaround_stats();
  perform set_config('role', 'postgres', true);
  insert into readiness_result values (10, 'lab_partner A: own turnaround stats show 1 order',
    '1', n_own_row::text, case when n_own_row = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_lp_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select orders_resulted into n_own_row from public.lab_partner_turnaround_stats();
  perform set_config('role', 'postgres', true);
  insert into readiness_result values (11, 'lab_partner B: own turnaround stats show 0 (isolation)',
    '0', coalesce(n_own_row, 0)::text, case when coalesce(n_own_row, 0) = 0 then 'PASS' else 'FAIL' end);

  -- =====================================================================
  -- Part 4 — admin_link_lab_partner
  -- =====================================================================
  -- 12. A non-admin (patient) is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  raised_code := null;
  begin
    perform public.admin_link_lab_partner(v_unlinked, v_lab_a);
    raised_code := 'no_error';
  exception when insufficient_privilege then
    raised_code := 'insufficient_privilege';
  end;
  perform set_config('role', 'postgres', true);
  insert into readiness_result values (12, 'patient: admin_link_lab_partner refused',
    'insufficient_privilege', raised_code, case when raised_code = 'insufficient_privilege' then 'PASS' else 'FAIL' end);

  -- 13. Admin cannot link a non-lab_partner profile (the patient account).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  raised_code := null;
  begin
    perform public.admin_link_lab_partner(v_patient, v_lab_a);
    raised_code := 'no_error';
  exception when others then
    get stacked diagnostics raised_code = returned_sqlstate;
  end;
  insert into readiness_result values (13, 'admin: cannot link a non-lab_partner profile',
    '22023', raised_code, case when raised_code = '22023' then 'PASS' else 'FAIL' end);

  -- 14. Admin links the unlinked lab_partner login to Lab A.
  perform public.admin_link_lab_partner(v_unlinked, v_lab_a);
  perform set_config('role', 'postgres', true);

  select lab_provider_id into own_id from public.profiles where id = v_unlinked;
  insert into readiness_result values (14, 'admin: admin_link_lab_partner sets lab_provider_id',
    v_lab_a::text, own_id::text, case when own_id = v_lab_a then 'PASS' else 'FAIL' end);

  -- 15. An audit_log row was written for the link action.
  select count(*) into n from public.audit_log
    where action = 'lab_partner.linked' and entity_id = v_unlinked;
  insert into readiness_result values (15, 'admin_link_lab_partner writes an audit_log row',
    '>=1', n::text, case when n >= 1 then 'PASS' else 'FAIL' end);

end $$;

select ord, verdict, check_name, expected, observed
from readiness_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from readiness_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'lab-partner-readiness verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
