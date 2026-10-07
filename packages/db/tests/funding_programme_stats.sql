-- ===========================================================================
-- Verification: 20260923010941_funding_programme_stats
--
-- The gap this closes: the ngo_funded_cohort module's own description
-- ("aggregate small-cell-suppressed programme reporting") was never built --
-- an ngo_admin or superadmin had no way to see programme utilisation
-- (invited/claimed/expired/revoked counts, capacity remaining) without
-- reading individual funding_programme_invitations rows directly.
--
-- This script proves:
--   * an ngo_admin of the programme's own organisation gets correct
--     invited/expired/revoked/claimed counts;
--   * a same-org caller who is NOT ngo_admin (an ordinary patient) is
--     refused;
--   * a sabotage run -- calling as ngo_admin of a DIFFERENT ngo
--     organisation -- confirms the authorisation check discriminates by the
--     programme's own organisation rather than admitting any ngo_admin.
--
-- Fixtures are self-built (two fresh NGO orgs, a programme, three
-- invitations in distinct terminal/non-terminal states), never selected
-- from live data. Every simulated-session check runs via
-- set_config('request.jwt.claim.sub', ...) + role 'authenticated', so the
-- function's EXECUTE grant is genuinely exercised, not bypassed as postgres.
-- The module is flipped on for the duration of this rolled-back transaction
-- only (platform_modules.is_enabled) -- this function itself does not gate
-- on the module (it's a pure aggregate read over rows that can only exist if
-- the module was on when they were created), but the fixtures need a real
-- programme row, and create_funding_programme would otherwise refuse.
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table fps_fixture(k text primary key, v uuid) on commit drop;
create temporary table fps_result(check_name text, observed text, expected text, verdict text) on commit drop;
grant select, insert on fps_fixture, fps_result to authenticated;

do $$
declare
  v_org_ngo      uuid := gen_random_uuid();
  v_org_ngo_b    uuid := gen_random_uuid();
  v_ngo_admin    uuid := gen_random_uuid();
  v_ngo_admin_b  uuid := gen_random_uuid();
  v_stranger     uuid := gen_random_uuid();
  v_product      uuid;
  v_programme    uuid;
  v_inv1 uuid := gen_random_uuid();
  v_inv2 uuid := gen_random_uuid();
  v_inv3 uuid := gen_random_uuid();
  v_any_admin_profile uuid;
begin
  select id into v_any_admin_profile from public.profiles where role = 'admin' limit 1;
  if v_any_admin_profile is null then
    raise exception 'no admin profile available -- cannot run this test';
  end if;

  update public.platform_modules
     set is_enabled = true, enabled_at = now(),
         enabled_by = v_any_admin_profile, activation_note = 'funding_programme_stats.sql proof (rolled back)'
   where key = 'ngo_funded_cohort';

  insert into public.organisations (id, name, type) values
    (v_org_ngo, 'FPS Test NGO', 'ngo'),
    (v_org_ngo_b, 'FPS Test NGO B', 'ngo')
  on conflict (id) do nothing;

  select id into v_product from public.service_products where is_active and currency = 'NGN' order by price_kobo limit 1;
  if v_product is null then
    raise exception 'no active NGN service product available -- cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_ngo_admin, 'fps-ngo-admin@example.invalid', 'x', now(), '{}', '{}'),
    (v_ngo_admin_b, 'fps-ngo-admin-b@example.invalid', 'x', now(), '{}', '{}'),
    (v_stranger, 'fps-stranger@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_ngo_admin, v_org_ngo, 'ngo_admin', 'FPS NGO Admin'),
    (v_ngo_admin_b, v_org_ngo_b, 'ngo_admin', 'FPS NGO Admin B'),
    (v_stranger, v_org_ngo, 'patient', 'FPS Stranger')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.funding_programmes (organisation_id, service_product_id, name, contract_reference, funded_unit_cap, created_by)
  values (v_org_ngo, v_product, 'FPS Test Programme', 'CR-FPS-1', 10, v_ngo_admin)
  returning id into v_programme;

  insert into public.funding_programme_invitations (id, funding_programme_id, full_name, phone, status, invited_by, expires_at)
  values
    (v_inv1, v_programme, 'Invitee One', '+2348010000001', 'invited', v_ngo_admin, now() + interval '30 days'),
    (v_inv2, v_programme, 'Invitee Two', '+2348010000002', 'expired', v_ngo_admin, now() - interval '1 day'),
    (v_inv3, v_programme, 'Invitee Three', '+2348010000003', 'revoked', v_ngo_admin, now() + interval '30 days');

  insert into fps_fixture values
    ('org_ngo', v_org_ngo), ('programme', v_programme),
    ('ngo_admin', v_ngo_admin), ('ngo_admin_b', v_ngo_admin_b), ('stranger', v_stranger);
end $$;

-- ==========================================================================
-- 1. ngo_admin of the owning org gets correct counts.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from fps_fixture where k = 'ngo_admin');
  v_prog  uuid := (select v from fps_fixture where k = 'programme');
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  select public.get_funding_programme_stats(v_prog) into v_result;

  insert into fps_result values ('ngo_admin sees correct invited count', coalesce(v_result->>'invited', 'null'), '1', case when v_result->>'invited' = '1' then 'PASS' else 'FAIL' end);
  insert into fps_result values ('ngo_admin sees correct expired count', coalesce(v_result->>'expired', 'null'), '1', case when v_result->>'expired' = '1' then 'PASS' else 'FAIL' end);
  insert into fps_result values ('ngo_admin sees correct revoked count', coalesce(v_result->>'revoked', 'null'), '1', case when v_result->>'revoked' = '1' then 'PASS' else 'FAIL' end);
  insert into fps_result values ('ngo_admin sees correct claimed count', coalesce(v_result->>'claimed', 'null'), '0', case when v_result->>'claimed' = '0' then 'PASS' else 'FAIL' end);
  -- unitsCommitted/unitsRemaining must count invited+claimed+expired (every
  -- status except revoked), matching invite_to_funding_programme's own cap
  -- predicate exactly (status <> 'revoked') -- fixture has 1 invited + 0
  -- claimed + 1 expired + 1 revoked, so committed=2 (NOT 1, which is what
  -- the pre-code-review version of this function would have returned by
  -- only counting invited+claimed), remaining = 10 - 2 = 8.
  insert into fps_result values ('unitsCommitted counts invited+claimed+expired, not just invited+claimed', coalesce(v_result->>'unitsCommitted', 'null'), '2', case when v_result->>'unitsCommitted' = '2' then 'PASS' else 'FAIL' end);
  insert into fps_result values ('unitsRemaining matches the real invite-cap predicate', coalesce(v_result->>'unitsRemaining', 'null'), '8', case when v_result->>'unitsRemaining' = '8' then 'PASS' else 'FAIL' end);

  if v_result->>'invited' is distinct from '1'
     or v_result->>'expired' is distinct from '1'
     or v_result->>'revoked' is distinct from '1'
     or v_result->>'claimed' is distinct from '0'
     or v_result->>'unitsCommitted' is distinct from '2'
     or v_result->>'unitsRemaining' is distinct from '8' then
    raise exception 'HOLE OPEN: stats counts wrong, got %', v_result;
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 2. A same-org caller who is not ngo_admin is refused.
-- ==========================================================================
do $$
declare
  v_stranger uuid := (select v from fps_fixture where k = 'stranger');
  v_prog uuid := (select v from fps_fixture where k = 'programme');
  v_refused boolean := false;
begin
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.get_funding_programme_stats(v_prog);
  exception when sqlstate '42501' then
    v_refused := true;
  end;

  insert into fps_result values ('a same-org non-ngo_admin patient is refused', v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end);
  if not v_refused then
    raise exception 'HOLE OPEN: a non-ngo_admin, non-admin caller read programme stats';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 3. SABOTAGE: ngo_admin of a DIFFERENT ngo organisation is refused --
--    confirms the check discriminates by the programme's own org.
-- ==========================================================================
do $$
declare
  v_admin_b uuid := (select v from fps_fixture where k = 'ngo_admin_b');
  v_prog uuid := (select v from fps_fixture where k = 'programme');
  v_refused boolean := false;
begin
  perform set_config('request.jwt.claim.sub', v_admin_b::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.get_funding_programme_stats(v_prog);
  exception when sqlstate '42501' then
    v_refused := true;
  end;

  insert into fps_result values ('SABOTAGE: ngo_admin of a different org is refused', v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end);
  if not v_refused then
    raise exception 'HOLE OPEN: an ngo_admin of an unrelated org read this programme''s stats';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ==========================================================================
-- 4. SABOTAGE: with the module disabled, even the programme's own ngo_admin
--    is refused -- confirms this function is not a hole through the module
--    gate every write RPC on this table already checks
--    (private.assert_module_enabled('ngo_funded_cohort')). The pre-code-
--    review version of this function omitted this check entirely.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from fps_fixture where k = 'ngo_admin');
  v_prog  uuid := (select v from fps_fixture where k = 'programme');
  v_refused boolean := false;
begin
  update public.platform_modules set is_enabled = false where key = 'ngo_funded_cohort';

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.get_funding_programme_stats(v_prog);
  exception when sqlstate '23514' then
    v_refused := true;
  end;

  insert into fps_result values ('SABOTAGE: module disabled refuses even the owning ngo_admin', v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end);
  if not v_refused then
    raise exception 'HOLE OPEN: get_funding_programme_stats does not check the module-enabled gate every other RPC on this schema checks';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

select check_name, observed, expected, verdict from fps_result order by verdict desc, check_name;

rollback;
