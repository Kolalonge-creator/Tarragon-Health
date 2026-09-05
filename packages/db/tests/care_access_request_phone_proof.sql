-- ===========================================================================
-- Verification: care_access_requests can no longer be forged into a
-- self-serve read of a stranger's profiles row (20260905000206).
--
-- The hole this guards against, in full: care_access_requests_insert
-- (20260730025553) admitted any INSERT where initiated_by = auth.uid() and
-- the caller was one of the two named parties. Naming a stranger as
-- profile_id satisfied that through its second disjunct, and the resulting
-- pending row was then OR'd into profiles' SELECT surface by
-- profiles_select_pending_care_access (20260730032315) — disclosing
-- full_name, phone, date_of_birth, is_pregnant, next_of_kin_phone, the
-- emergency contact fields and patient_number to any authenticated account
-- that knew a profile UUID.
--
-- What is checked here, and why each case earns its place:
--   1. A forged INSERT as `authenticated` is refused (the table-level grant
--      is gone).
--   2. The same forged row is refused even with grants and RLS bypassed —
--      i.e. private.guard_care_access_request_insert, not just the missing
--      grant, is doing real work. This is the case a grant-only fix would
--      pass vacuously.
--   3. The attacker cannot reach the victim through the RPC either, because
--      the RPC resolves the other party from a PHONE NUMBER they do not know.
--   4. The attacker still cannot read the victim's profiles row.
--   5. The legitimate next-of-kin flow (owner offers, by phone) still
--      creates a request, the named acceptor can still read the initiator's
--      profile — the whole reason profiles_select_pending_care_access exists
--      — and accepting still produces a real profile_access grant.
--   6. The eldercare 'request_their_record' direction, with permissions and
--      an expiry, still works.
--   7. Sabotage: with the guard trigger dropped, case 2 comes back. If this
--      one ever reports STILL REFUSED, the suite has stopped discriminating
--      and cases 1-4 mean nothing.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table carp_fixture(k text primary key, v uuid) on commit drop;
create temporary table carp_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;
grant insert, select on carp_result to authenticated;

do $$
declare
  v_org      uuid;
  v_victim   uuid := gen_random_uuid();
  v_kin      uuid := gen_random_uuid();
  v_attacker uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type) values ('CARP Test Org', 'clinic')
    returning id into v_org;
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_victim,   'carp-victim@example.invalid',   'x', now(), '{}', '{}'),
    (v_kin,      'carp-kin@example.invalid',      'x', now(), '{}', '{}'),
    (v_attacker, 'carp-attacker@example.invalid', 'x', now(), '{}', '{}');

  -- `on conflict do update` rather than a plain insert: a trigger on
  -- auth.users already provisions the profiles row, so a bare insert here
  -- dies on profiles_pkey.
  --
  -- The victim carries the exact columns the disclosure exposed, so a
  -- regression shows up as real PHI rather than as an empty row.
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_pregnant)
  values (v_victim, v_org, 'patient', 'CARP Victim', '+2348039000101', '1988-04-02', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth, is_pregnant = excluded.is_pregnant;

  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v_kin, v_org, 'patient', 'CARP Kin', '+2348039000102')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, phone = excluded.phone;

  -- Same organisation as the victim: the attacker is an ordinary fellow
  -- patient, not a cross-tenant outsider. That is the harder case.
  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v_attacker, v_org, 'patient', 'CARP Attacker', '+2348039000103')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, phone = excluded.phone;

  insert into carp_fixture(k, v)
  values ('org', v_org), ('victim', v_victim), ('kin', v_kin), ('attacker', v_attacker);
end $$;

-- ==========================================================================
-- 1. Forged INSERT as `authenticated` — the path a browser with the anon key
--    actually has.
-- ==========================================================================
do $$
declare
  v_victim   uuid := (select v from carp_fixture where k = 'victim');
  v_attacker uuid := (select v from carp_fixture where k = 'attacker');
  v_msg      text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.care_access_requests
      (profile_id, counterparty_user_id, initiated_by, permission_level, status)
    values (v_victim, v_attacker, v_attacker, 'manage', 'pending');
  exception when others then
    v_msg := sqlstate;
  end;
  reset role;

  insert into carp_result values (
    'forged INSERT as authenticated is refused',
    coalesce('refused ' || v_msg, 'INSERTED'),
    'refused',
    case when v_msg is not null then 'PASS' else 'FAIL' end
  );
  if v_msg is null then
    raise exception 'BROKEN: an authenticated account forged a care_access_requests row naming a stranger';
  end if;
end $$;

-- ==========================================================================
-- 2. Same forged row with grants and RLS bypassed — only the BEFORE INSERT
--    guard can refuse it. Without this case, case 1 would still pass if the
--    trigger were deleted and only the grant revoke survived.
-- ==========================================================================
do $$
declare
  v_victim   uuid := (select v from carp_fixture where k = 'victim');
  v_attacker uuid := (select v from carp_fixture where k = 'attacker');
  v_msg      text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  begin
    insert into public.care_access_requests
      (profile_id, counterparty_user_id, initiated_by, permission_level, status)
    values (v_victim, v_attacker, v_attacker, 'manage', 'pending');
  exception when others then
    v_msg := sqlstate;
  end;

  insert into carp_result values (
    'forged row refused by the trigger alone (grants bypassed)',
    coalesce('refused ' || v_msg, 'INSERTED'),
    'refused 42501',
    case when v_msg = '42501' then 'PASS' else 'FAIL' end
  );
  if v_msg is distinct from '42501' then
    raise exception 'BROKEN: private.guard_care_access_request_insert did not refuse a forged row, got %', coalesce(v_msg, 'no error');
  end if;
end $$;

-- ==========================================================================
-- 3. The RPC is no help to the attacker: it takes a phone number, and the
--    victim's is not one they can guess from a UUID.
-- ==========================================================================
do $$
declare
  v_attacker uuid := (select v from carp_fixture where k = 'attacker');
  v_msg      text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_care_access('+2340000000000', 'manage', 'request_their_record', 'friend');
  exception when others then
    v_msg := sqlstate;
  end;
  reset role;

  insert into carp_result values (
    'RPC with an unknown phone number finds nobody',
    coalesce('refused ' || v_msg, 'CREATED'),
    'refused P0002',
    case when v_msg = 'P0002' then 'PASS' else 'FAIL' end
  );
  if v_msg is distinct from 'P0002' then
    raise exception 'BROKEN: request_care_access did not refuse an unknown phone number, got %', coalesce(v_msg, 'no error');
  end if;
end $$;

-- ==========================================================================
-- 4. The disclosure itself: the attacker must not be able to read the
--    victim's profiles row.
-- ==========================================================================
do $$
declare
  v_victim   uuid := (select v from carp_fixture where k = 'victim');
  v_attacker uuid := (select v from carp_fixture where k = 'attacker');
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles where id = v_victim;
  reset role;

  insert into carp_result values (
    'attacker cannot read the victim profiles row',
    n::text || ' rows',
    '0 rows',
    case when n = 0 then 'PASS' else 'FAIL' end
  );
  if n <> 0 then
    raise exception 'BROKEN: the attacker still reads the victim profiles row (% rows)', n;
  end if;
end $$;

-- ==========================================================================
-- 5. The legitimate next-of-kin flow, end to end. A fix that closed the hole
--    by breaking this would be no fix at all.
-- ==========================================================================
do $$
declare
  v_victim uuid := (select v from carp_fixture where k = 'victim');
  v_kin    uuid := (select v from carp_fixture where k = 'kin');
  v_req    public.care_access_requests;
  n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_victim::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_req := public.request_care_access('+2348039000102', 'view', 'offer_my_record', 'sibling');
  reset role;

  insert into carp_result values (
    'owner offers next-of-kin view by phone',
    'profile_id=' || (v_req.profile_id = v_victim)::text
      || ' counterparty=' || (v_req.counterparty_user_id = v_kin)::text
      || ' status=' || v_req.status,
    'profile_id=true counterparty=true status=pending',
    case when v_req.profile_id = v_victim
          and v_req.counterparty_user_id = v_kin
          and v_req.status = 'pending' then 'PASS' else 'FAIL' end
  );
  if v_req.profile_id <> v_victim or v_req.counterparty_user_id <> v_kin then
    raise exception 'BROKEN: request_care_access put the parties on the wrong sides of the row';
  end if;

  -- The named acceptor must still be able to read the initiator's profile —
  -- this is precisely what profiles_select_pending_care_access is for, and
  -- what the /patient/family pending list renders.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles where id = v_victim;
  reset role;

  insert into carp_result values (
    'named acceptor can still read the initiator profile',
    n::text || ' rows',
    '1 rows',
    case when n = 1 then 'PASS' else 'FAIL' end
  );
  if n <> 1 then
    raise exception 'BROKEN: the acceptor can no longer see who is asking (% rows)', n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.respond_to_care_access_request(v_req.id, true);
  reset role;

  select count(*) into n from public.profile_access
   where profile_id = v_victim and grantee_user_id = v_kin;

  insert into carp_result values (
    'accepting still creates the profile_access grant',
    n::text || ' grants',
    '1 grants',
    case when n = 1 then 'PASS' else 'FAIL' end
  );
  if n <> 1 then
    raise exception 'BROKEN: the accept path no longer produces a grant (% rows)', n;
  end if;
end $$;

-- ==========================================================================
-- 6. The eldercare direction, carrying permissions and an expiry.
-- ==========================================================================
do $$
declare
  v_victim uuid := (select v from carp_fixture where k = 'victim');
  v_kin    uuid := (select v from carp_fixture where k = 'kin');
  v_req    public.care_access_requests;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_req := public.request_care_access(
    '+2348039000101', 'manage', 'request_their_record', 'child',
    array['book_appointments']::public.caregiver_permission[],
    now() + interval '30 days');
  reset role;

  insert into carp_result values (
    'eldercare request_their_record keeps its scope and expiry',
    'profile_id=' || (v_req.profile_id = v_victim)::text
      || ' perms=' || coalesce(array_to_string(v_req.permissions, ','), 'NULL')
      || ' expires=' || (v_req.expires_at is not null)::text,
    'profile_id=true perms=book_appointments expires=true',
    case when v_req.profile_id = v_victim
          and v_req.counterparty_user_id = v_kin
          and v_req.permissions = array['book_appointments']::public.caregiver_permission[]
          and v_req.expires_at is not null then 'PASS' else 'FAIL' end
  );
  if v_req.profile_id <> v_victim
     or v_req.permissions is distinct from array['book_appointments']::public.caregiver_permission[]
     or v_req.expires_at is null then
    raise exception 'BROKEN: the eldercare direction lost its parties, scope or expiry';
  end if;
end $$;

-- ==========================================================================
-- 7. Sabotage. Drop the guard and the attack must return — otherwise cases
--    1-4 above are passing for some other reason and prove nothing.
-- ==========================================================================
do $$
declare
  v_victim   uuid := (select v from carp_fixture where k = 'victim');
  v_attacker uuid := (select v from carp_fixture where k = 'attacker');
  v_msg      text;
  v_ok       boolean := false;
begin
  execute 'drop trigger care_access_requests_guard_insert on public.care_access_requests';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker::text, 'role', 'authenticated')::text, true);
  begin
    insert into public.care_access_requests
      (profile_id, counterparty_user_id, initiated_by, permission_level, status)
    values (v_victim, v_attacker, v_attacker, 'manage', 'pending');
    v_ok := true;
  exception when others then
    v_msg := sqlstate || ' ' || sqlerrm;
  end;

  execute 'create trigger care_access_requests_guard_insert
             before insert on public.care_access_requests
             for each row execute function private.guard_care_access_request_insert()';

  insert into carp_result values (
    'SABOTAGE: with the guard dropped the forged row lands again',
    case when v_ok then 'INSERTED' else 'refused ' || v_msg end,
    'INSERTED',
    case when v_ok then 'PASS' else 'FAIL' end
  );
  if not v_ok then
    raise exception 'VACUOUS SUITE: the forged INSERT is refused even with the guard dropped (%) — cases 1-4 are not testing what they claim', v_msg;
  end if;
end $$;

select * from carp_result;

rollback;
