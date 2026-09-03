-- ===========================================================================
-- Verification: Caregiver Proxy Access granular permissions + temporary
-- access (20260829001500 / 20260829010500 / 20260829013000).
--
-- Covers what the migrations' own self-tests do not: that a proposed scope
-- and duration on care_access_requests actually survives the accept path
-- (respond_to_care_access_request) into a real profile_access grant, both on
-- a fresh insert and on an on-conflict refresh of an existing grant; that
-- private.can_read_clinical's permission-aware overload narrows a
-- clinical_access grant the same way private.can_act_for narrows a manage
-- grant; and that the narrowing actually holds at the RPC a caregiver calls
-- (sponsor_book_care), not only at the helper function underneath it.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table cgp_fixture(k text primary key, v uuid) on commit drop;
create temporary table cgp_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org      uuid;
  v_owner    uuid := gen_random_uuid();
  v_grantee  uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type) values ('CGP Test Org', 'clinic')
    returning id into v_org;
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_owner,   'cgp-test-owner@example.invalid',   'x', now(), '{}', '{}'),
    (v_grantee, 'cgp-test-grantee@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_owner, v_org, 'patient', 'CGP Test Owner');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_grantee, v_org, 'patient', 'CGP Test Grantee');

  insert into cgp_fixture(k, v) values ('org', v_org), ('owner', v_owner), ('grantee', v_grantee);
end $$;

-- ==========================================================================
-- 1. respond_to_care_access_request carries permissions + expires_at from a
--    fresh request into a fresh grant.
-- ==========================================================================
do $$
declare
  v_owner   uuid := (select v from cgp_fixture where k = 'owner');
  v_grantee uuid := (select v from cgp_fixture where k = 'grantee');
  v_request uuid;
  v_expires timestamptz := now() + interval '7 days';
  v_row     public.profile_access;
begin
  insert into public.care_access_requests
    (profile_id, counterparty_user_id, initiated_by, permission_level, relationship, permissions, expires_at)
  values
    (v_owner, v_grantee, v_owner, 'manage', 'child',
     array['book_appointments', 'view_medication']::public.caregiver_permission[], v_expires)
  returning id into v_request;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.respond_to_care_access_request(v_request, true);
  reset role;

  select * into v_row from public.profile_access
   where profile_id = v_owner and grantee_user_id = v_grantee;

  insert into cgp_result values (
    'fresh grant carries permissions',
    coalesce(array_to_string(v_row.permissions, ','), 'NULL'),
    'book_appointments,view_medication',
    case when v_row.permissions = array['book_appointments', 'view_medication']::public.caregiver_permission[]
         then 'PASS' else 'FAIL' end
  );
  if v_row.permissions is distinct from array['book_appointments', 'view_medication']::public.caregiver_permission[] then
    raise exception 'BROKEN: respond_to_care_access_request did not carry permissions onto a fresh grant, got %', v_row.permissions;
  end if;

  insert into cgp_result values (
    'fresh grant carries expires_at',
    coalesce(v_row.expires_at::text, 'NULL'),
    v_expires::text,
    case when v_row.expires_at = v_expires then 'PASS' else 'FAIL' end
  );
  if v_row.expires_at is distinct from v_expires then
    raise exception 'BROKEN: respond_to_care_access_request did not carry expires_at onto a fresh grant, got %', v_row.expires_at;
  end if;
end $$;

-- ==========================================================================
-- 2. A second request between the same two people, accepted again, refreshes
--    the EXISTING grant's permissions/expires_at via the on-conflict path —
--    not just the insert path exercised above.
-- ==========================================================================
do $$
declare
  v_owner   uuid := (select v from cgp_fixture where k = 'owner');
  v_grantee uuid := (select v from cgp_fixture where k = 'grantee');
  v_request uuid;
  v_row     public.profile_access;
begin
  insert into public.care_access_requests
    (profile_id, counterparty_user_id, initiated_by, permission_level, relationship, permissions, expires_at)
  values
    (v_owner, v_grantee, v_owner, 'manage', 'child',
     array['manage_payments']::public.caregiver_permission[], null)
  returning id into v_request;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.respond_to_care_access_request(v_request, true);
  reset role;

  select * into v_row from public.profile_access
   where profile_id = v_owner and grantee_user_id = v_grantee;

  insert into cgp_result values (
    'refreshed grant replaces permissions',
    coalesce(array_to_string(v_row.permissions, ','), 'NULL'),
    'manage_payments',
    case when v_row.permissions = array['manage_payments']::public.caregiver_permission[]
         then 'PASS' else 'FAIL' end
  );
  if v_row.permissions is distinct from array['manage_payments']::public.caregiver_permission[] then
    raise exception 'BROKEN: the on-conflict refresh did not replace permissions on the existing grant, got %', v_row.permissions;
  end if;

  insert into cgp_result values (
    'refreshed grant clears expires_at back to permanent',
    coalesce(v_row.expires_at::text, 'NULL'),
    'NULL',
    case when v_row.expires_at is null then 'PASS' else 'FAIL' end
  );
  if v_row.expires_at is not null then
    raise exception 'BROKEN: the on-conflict refresh did not clear expires_at, got %', v_row.expires_at;
  end if;
end $$;

-- ==========================================================================
-- 3. can_read_clinical(patient, permission): a clinical_access grant scoped
--    to view_results only must authorise view_results and refuse
--    communicate_with_care_team.
-- ==========================================================================
do $$
declare
  v_owner   uuid := (select v from cgp_fixture where k = 'owner');
  v_grantee uuid := (select v from cgp_fixture where k = 'grantee');
  v_allowed boolean;
  v_refused boolean;
begin
  update public.profile_access
     set clinical_access = true,
         permissions = array['view_results']::public.caregiver_permission[]
   where profile_id = v_owner and grantee_user_id = v_grantee;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_allowed := private.can_read_clinical(v_owner, 'view_results'::public.caregiver_permission);
  v_refused := private.can_read_clinical(v_owner, 'communicate_with_care_team'::public.caregiver_permission);
  reset role;

  insert into cgp_result values (
    'view_results-scoped grant authorises view_results',
    v_allowed::text, 'true', case when v_allowed then 'PASS' else 'FAIL' end
  );
  if not v_allowed then
    raise exception 'BROKEN: a grant scoped to view_results did not authorise view_results';
  end if;

  insert into cgp_result values (
    'view_results-scoped grant refuses communicate_with_care_team',
    v_refused::text, 'false', case when not v_refused then 'PASS' else 'FAIL' end
  );
  if v_refused then
    raise exception 'BROKEN: a grant scoped to view_results also authorised communicate_with_care_team';
  end if;
end $$;

-- ==========================================================================
-- 4. End to end at the RPC a caregiver actually calls: sponsor_book_care
--    must refuse a grant that does not carry book_appointments, and succeed
--    once it does — not merely the can_act_for helper underneath it.
-- ==========================================================================
do $$
declare
  v_owner   uuid := (select v from cgp_fixture where k = 'owner');
  v_grantee uuid := (select v from cgp_fixture where k = 'grantee');
  v_bundle  uuid;
  v_refused boolean := false;
begin
  update public.profile_access
     set permission_level = 'manage',
         permissions = array['manage_payments']::public.caregiver_permission[]
   where profile_id = v_owner and grantee_user_id = v_grantee;

  select id into v_bundle from public.panel_bundles where self_bookable limit 1;
  if v_bundle is null then
    raise warning 'skipping sponsor_book_care behavioural check: no self_bookable panel_bundles in this environment';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    begin
      perform public.sponsor_book_care(v_owner, (select code from public.panel_bundles where id = v_bundle));
    exception
      when insufficient_privilege then v_refused := true;
    end;
    reset role;

    insert into cgp_result values (
      'sponsor_book_care refuses a grant without book_appointments',
      v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end
    );
    if not v_refused then
      raise exception 'BROKEN: sponsor_book_care let a manage_payments-only grant book care';
    end if;

    update public.profile_access
       set permissions = array['manage_payments', 'book_appointments']::public.caregiver_permission[]
     where profile_id = v_owner and grantee_user_id = v_grantee;

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_grantee::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.sponsor_book_care(v_owner, (select code from public.panel_bundles where id = v_bundle));
    reset role;

    insert into cgp_result values (
      'sponsor_book_care succeeds once book_appointments is granted',
      'no exception raised', 'no exception raised', 'PASS'
    );
  end if;
end $$;

select * from cgp_result order by check_name;

do $$
begin
  if exists (select 1 from cgp_result where verdict <> 'PASS') then
    raise exception 'caregiver_granular_permissions.sql: at least one check FAILed — see cgp_result above';
  end if;
end $$;

rollback;
