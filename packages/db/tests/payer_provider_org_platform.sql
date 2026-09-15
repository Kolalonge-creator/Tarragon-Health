-- ===========================================================================
-- Verification: modules 27 (insurer/payer platform) and 28 (provider
-- organisation platform) ship fully built but genuinely dormant, and their
-- two new account roles never leak into private.is_org_staff() — the same
-- kind of live, behavioural proof packages/db/tests/lab_partner_rls.sql and
-- scoped_access_roles_rls.sql already established for the earlier partner
-- roles, extended to payer_admin/provider_org_staff.
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor. Wrapped in BEGIN/ROLLBACK.
--
-- WHY EVERY NEGATIVE IS PAIRED WITH A POSITIVE — same discipline as
-- lab_partner_rls.sql: a payer_admin reading 0 rows from a patient table
-- proves nothing on its own unless a real clinician reading real rows is
-- shown right next to it, and unless the same payer_admin CAN do its actual
-- job once properly seated and the module is switched on.
--
-- UNLIKE lab_partner_rls.sql, this file never does `set_config('role',
-- 'authenticated', ...)`. Every check here asks a boolean predicate
-- function (is_org_staff/is_payer_admin_for/is_provider_org_staff_for) or a
-- SECURITY DEFINER RPC for its answer, rather than reading raw table rows
-- under enforced RLS — so all it needs is auth.uid() resolving correctly via
-- request.jwt.claims, evaluated with the connecting (owner) role's full
-- privileges throughout. That matters mechanically, not just stylistically:
-- schema `private` grants no USAGE to `authenticated`, so a fresh, ad hoc
-- `select private.is_org_staff(...)` run AS authenticated is refused with
-- "permission denied for schema private" — the exact error this file hit
-- during authoring. RLS policies calling the same function work today only
-- because a policy's qualifying expression is resolved once, as the
-- (privileged) role that ran CREATE POLICY, and reused by OID thereafter;
-- they are not re-parsed under the querying role at runtime. A test that
-- wants to prove ROW VISIBILITY (not just a predicate's return value) still
-- needs the real role switch, same as lab_partner_rls.sql.
-- ===========================================================================

begin;

create temporary table platform_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_clin       uuid;
  v_payer_login uuid;
  v_provider_login uuid;
  v_insurer    uuid;
  v_provider_org uuid;
  v_provider_org_row uuid;

  n_clin_org_staff        boolean;
  n_payer_org_staff       boolean;
  n_provider_org_staff    boolean;
  n_payer_admin_dormant   boolean;
  n_payer_admin_live      boolean;
  n_provider_staff_dormant boolean;
  n_provider_staff_live_module_only boolean;
  n_provider_staff_live_both boolean;
  n_dashboard_below_floor jsonb;
  n_dashboard_above_floor jsonb;
  v_admin uuid;
begin
  select id into v_clin from public.profiles where role = 'clinician' and organisation_id = v_org limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_clin is null or v_admin is null then
    raise exception 'fixtures unavailable: need a clinician in org 0001 and an admin';
  end if;

  -- Repurpose one existing account each as the payer_admin / provider_org_staff
  -- under test, same fixture-reuse idiom as lab_partner_rls.sql. Both keep
  -- organisation_id = v_org — the REAL misconfiguration the admin
  -- provisioning UI allows and precisely what an is_org_staff leak would
  -- exploit.
  select id into v_payer_login from public.profiles where role = 'pharmacist' limit 1;
  select id into v_provider_login from public.profiles where role = 'lab_liaison' limit 1;
  if v_payer_login is null or v_provider_login is null then
    raise exception 'fixtures unavailable: need a pharmacist and a lab_liaison account to repurpose';
  end if;
  update public.profiles set role = 'payer_admin', organisation_id = v_org where id = v_payer_login;
  update public.profiles set role = 'provider_org_staff', organisation_id = v_org where id = v_provider_login;

  -- ------------------------------------------------------------------------
  -- Part 1 — is_org_staff exclusion (I9-style leak check)
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  n_clin_org_staff := private.is_org_staff(v_org);

  perform set_config('request.jwt.claims', json_build_object('sub', v_payer_login, 'role', 'authenticated')::text, true);
  n_payer_org_staff := private.is_org_staff(v_org);

  perform set_config('request.jwt.claims', json_build_object('sub', v_provider_login, 'role', 'authenticated')::text, true);
  n_provider_org_staff := private.is_org_staff(v_org);
  perform set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------------
  -- Part 2 — payer_platform dormancy: a real, seated payer_admin still
  -- fails is_payer_admin_for while the module is off, and passes once it's
  -- switched on. Module state is restored to off at the end regardless of
  -- outcome (this whole block is inside the transaction that gets rolled
  -- back anyway, but the ordering below also leaves it off along the way).
  -- ------------------------------------------------------------------------
  insert into public.insurers (name, is_active, onboarding_status)
    values ('VERIFY Test Insurer', false, 'configuring')
    returning id into v_insurer;
  insert into public.payer_administrators (insurer_id, profile_id, payer_role)
    values (v_insurer, v_payer_login, 'owner');

  perform set_config('request.jwt.claims', json_build_object('sub', v_payer_login, 'role', 'authenticated')::text, true);
  n_payer_admin_dormant := private.is_payer_admin_for(v_insurer);
  perform set_config('request.jwt.claims', '', true);

  update public.platform_modules
     set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'test'
   where key = 'payer_platform';

  perform set_config('request.jwt.claims', json_build_object('sub', v_payer_login, 'role', 'authenticated')::text, true);
  n_payer_admin_live := private.is_payer_admin_for(v_insurer);

  -- While we're live, prove the suppression floor on payer_dashboard_analytics
  -- actually discriminates: 0 verified members must suppress; enough members
  -- (reusing every patient in org 0001, however many that is, all pointed at
  -- this insurer) must not, PROVIDED the org has at least min_cohort_size
  -- patients — if it doesn't, both calls legitimately return suppressed and
  -- that is recorded as such rather than forced into a false pass.
  select public.payer_dashboard_analytics(v_insurer) into n_dashboard_below_floor;

  update public.insurers set min_cohort_size = 5 where id = v_insurer;
  insert into public.insurance_policies (organisation_id, patient_id, insurer_id, member_id, status, verified_at, verified_by)
    select v_org, p.id, v_insurer, 'MBR-' || substr(p.id::text, 1, 8), 'active', now(), v_admin
    from public.profiles p where p.role = 'patient' and p.organisation_id = v_org
    limit 10;
  select public.payer_dashboard_analytics(v_insurer) into n_dashboard_above_floor;

  perform set_config('request.jwt.claims', '', true);
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null where key = 'payer_platform';

  -- ------------------------------------------------------------------------
  -- Part 3 — provider_org_platform dormancy has TWO independent gates: the
  -- platform-wide module switch AND this specific organisation's
  -- is_operational. Proves module-on-but-org-not-operational still refuses.
  -- ------------------------------------------------------------------------
  insert into public.organisations (name, type) values ('VERIFY Provider Org', 'provider_org') returning id into v_provider_org;
  insert into public.provider_organisations (organisation_id, org_type, legal_name, onboarding_status)
    values (v_provider_org, 'clinic', 'VERIFY Provider Org Ltd', 'configuring')
    returning id into v_provider_org_row;
  insert into public.provider_org_members (organisation_id, profile_id, org_role)
    values (v_provider_org, v_provider_login, 'owner');

  perform set_config('request.jwt.claims', json_build_object('sub', v_provider_login, 'role', 'authenticated')::text, true);
  n_provider_staff_dormant := private.is_provider_org_staff_for(v_provider_org);
  perform set_config('request.jwt.claims', '', true);

  update public.platform_modules
     set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'test'
   where key = 'provider_org_platform';

  perform set_config('request.jwt.claims', json_build_object('sub', v_provider_login, 'role', 'authenticated')::text, true);
  n_provider_staff_live_module_only := private.is_provider_org_staff_for(v_provider_org);
  perform set_config('request.jwt.claims', '', true);

  update public.provider_organisations
     set onboarding_status = 'active', is_operational = true, activated_at = now(), activated_by = v_admin
   where id = v_provider_org_row;

  perform set_config('request.jwt.claims', json_build_object('sub', v_provider_login, 'role', 'authenticated')::text, true);
  n_provider_staff_live_both := private.is_provider_org_staff_for(v_provider_org);
  perform set_config('request.jwt.claims', '', true);

  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null where key = 'provider_org_platform';

  -- ------------------------------------------------------------------------
  -- Results
  -- ------------------------------------------------------------------------
  insert into platform_result values
    (1, 'CONTROL — clinician satisfies is_org_staff for its own org',
        'true', n_clin_org_staff::text, case when n_clin_org_staff then 'PASS' else 'FAIL' end),
    (2, 'payer_admin does NOT satisfy is_org_staff',
        'false', n_payer_org_staff::text, case when not n_payer_org_staff then 'PASS' else 'FAIL' end),
    (3, 'provider_org_staff does NOT satisfy is_org_staff',
        'false', n_provider_org_staff::text, case when not n_provider_org_staff then 'PASS' else 'FAIL' end),
    (4, 'seated payer_admin refused while payer_platform is dormant',
        'false', n_payer_admin_dormant::text, case when not n_payer_admin_dormant then 'PASS' else 'FAIL' end),
    (5, 'same payer_admin admitted once payer_platform is switched on',
        'true', n_payer_admin_live::text, case when n_payer_admin_live then 'PASS' else 'FAIL' end),
    (6, 'payer_dashboard_analytics suppresses below the cohort floor',
        'true', (n_dashboard_below_floor ->> 'suppressed'),
        case when (n_dashboard_below_floor ->> 'suppressed')::boolean then 'PASS' else 'FAIL' end),
    (7, 'payer_dashboard_analytics reports real figures above the cohort floor',
        'false', (n_dashboard_above_floor ->> 'suppressed'),
        case when (n_dashboard_above_floor ->> 'suppressed')::boolean = false then 'PASS' else 'FAIL' end),
    (8, 'seated provider_org_staff refused while provider_org_platform is dormant',
        'false', n_provider_staff_dormant::text, case when not n_provider_staff_dormant then 'PASS' else 'FAIL' end),
    (9, 'module on but organisation not operational still refuses',
        'false', n_provider_staff_live_module_only::text,
        case when not n_provider_staff_live_module_only then 'PASS' else 'FAIL' end),
    (10, 'module on AND organisation operational admits the seat',
        'true', n_provider_staff_live_both::text, case when n_provider_staff_live_both then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from platform_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from platform_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'payer/provider-org platform verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
