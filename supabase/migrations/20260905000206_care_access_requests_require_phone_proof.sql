-- Tarragon Health — close a proven PHI disclosure: any authenticated account
-- could read ANY other account's full profiles row given only its UUID.
--
-- THE HOLE (confirmed live, in a rolled-back transaction, before this file
-- was written):
--
--   care_access_requests_insert (20260730025553) admitted any INSERT where
--     initiated_by = auth.uid()
--     and (profile_id = auth.uid() or counterparty_user_id = auth.uid())
--   — no organisation predicate, no consent, no proof of any prior
--   relationship whatsoever. An attacker inserts
--     {profile_id: <victim uuid>, counterparty_user_id: self,
--      initiated_by: self, status: 'pending'}
--   satisfying it through the SECOND disjunct: "I am asking to manage that
--   stranger's record."
--
--   profiles_select_pending_care_access (20260730032315) then OR's that
--   freshly-forged pending row into profiles' SELECT surface, handing over
--   full_name, phone, date_of_birth, is_pregnant, next_of_kin_phone,
--   emergency_contact_name/_phone/_relationship and patient_number. NDPR
--   personal data including a pregnancy flag, self-serve, one INSERT.
--
--   20260730025553's own comment argued the defence was that
--   "find_profile_by_phone already requires an exact same-org phone match
--   before either side can be named." That is true of the UI, and only of
--   the UI. PostgREST's INSERT endpoint is directly reachable from a browser
--   with the anon key; the policy carried no such constraint. This migration
--   makes the assumption real, in the database, on every path.
--
-- THE FIX, in three parts:
--
--   1. public.request_care_access(...) — the ONLY way an end user may create
--      a care access request. It takes a PHONE NUMBER, never a profile
--      UUID, and resolves the other party itself through the existing
--      public.find_profile_by_phone (exact phone, same organisation,
--      role = 'patient'). A caller who does not already know the other
--      person's phone number cannot name them at all, which is precisely the
--      constraint the original comment assumed. This mirrors what both real
--      call sites already did in application code
--      (nominateNextOfKinAction / createEldercareAccessRequestAction both
--      call find_profile_by_phone and then insert the id it returned) — the
--      rule simply moves out of the app and into the database, where it
--      cannot be bypassed by talking to PostgREST directly.
--
--   2. private.guard_care_access_request_insert() — a BEFORE INSERT trigger,
--      so the invariant holds on EVERY path into the table, not just the RPC.
--      It re-checks initiator identity and party membership (what the policy
--      used to do), adds the same-organisation + role='patient' constraint
--      find_profile_by_phone imposes, and requires a transaction-local
--      marker that only request_care_access sets. A direct INSERT — from a
--      forged PostgREST call, or from some future careless server action —
--      fails closed with 42501 rather than quietly minting an unlock.
--
--   3. The permissive INSERT policy and the table-level INSERT grant are
--      both removed from `authenticated`. RLS restricts rows; the grant is
--      what makes the command reachable at all, so both have to go (see
--      CLAUDE.md's standing lesson on grants vs. RLS). request_care_access
--      is SECURITY DEFINER and therefore does not need either.
--
-- profiles_select_pending_care_access is deliberately LEFT IN PLACE. It is
-- still a whole-row read, which RLS cannot narrow to columns, but its
-- reachability is now bounded exactly as its author believed it already was:
-- a pending row can only exist between two same-organisation patients where
-- one of them proved knowledge of the other's phone number. Narrowing the
-- read itself to just full_name would mean replacing the embedded
-- profiles joins on /patient/family with an RPC, which is a separate,
-- larger change; it is recorded here as the remaining residual rather than
-- half-done.
--
-- Rows affected: zero. `select count(*) from public.care_access_requests
-- where status = 'pending'` returned 0 on the live project when this was
-- written, so there is no data conversion step — this is a purely structural
-- change. (Worth noting for anyone testing: the QA fixtures
-- patient.familyowner.test / patient.familymember.test both carry a NULL
-- phone, so find_profile_by_phone cannot resolve them and the *existing*
-- shipped UI flow could not create a request for them either. This migration
-- does not regress anything that works today.)

-- ---------------------------------------------------------------------------
-- 1. The BEFORE INSERT guard.
-- ---------------------------------------------------------------------------

create or replace function private.guard_care_access_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_other      uuid;
  v_caller_org uuid;
  v_other_org  uuid;
  v_other_role public.user_role;
  v_verified   text;
begin
  -- No end-user session: a migration, a seed, packages/db/tests, or the
  -- service role. RLS never applied to any of those either — this trigger is
  -- the guard on the authenticated surface, not a substitute for trusting
  -- the service role, which is trusted by definition everywhere else in this
  -- codebase.
  if v_uid is null then
    return new;
  end if;

  if new.initiated_by is distinct from v_uid then
    raise exception 'A care access request must be initiated by the signed-in account'
      using errcode = '42501';
  end if;

  if new.profile_id is distinct from v_uid and new.counterparty_user_id is distinct from v_uid then
    raise exception 'You can only propose a care access relationship you are part of'
      using errcode = '42501';
  end if;

  v_other := case
    when new.profile_id = v_uid then new.counterparty_user_id
    else new.profile_id
  end;

  -- The constraint find_profile_by_phone imposes, restated where it cannot be
  -- skipped: the other party must be a patient in the caller's own
  -- organisation. This alone does not close the hole on a single-organisation
  -- deployment, which is why the phone proof below exists too.
  select organisation_id into v_caller_org from public.profiles where id = v_uid;
  select organisation_id, role into v_other_org, v_other_role
    from public.profiles where id = v_other;

  if v_caller_org is null
     or v_other_org is null
     or v_other_org is distinct from v_caller_org
     or v_other_role is distinct from 'patient' then
    raise exception 'That account cannot be named on a care access request'
      using errcode = '42501';
  end if;

  -- Phone proof. public.request_care_access sets this transaction-local
  -- marker to the id it resolved from a phone number, immediately before
  -- inserting. Nothing else sets it, and a client cannot: set_config is not
  -- reachable over PostgREST, and `authenticated` holds no INSERT on this
  -- table any more regardless.
  v_verified := current_setting('tarragon.care_access_verified_party', true);
  if v_verified is distinct from v_other::text then
    raise exception 'Care access requests must be created through public.request_care_access(), which resolves the other person from their phone number'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.guard_care_access_request_insert() is
  'Fails closed on any authenticated INSERT into care_access_requests that did not come through public.request_care_access. Closes the 20260730025553 disclosure where a forged pending row unlocked a stranger''s whole profiles row via profiles_select_pending_care_access.';

drop trigger if exists care_access_requests_guard_insert on public.care_access_requests;
create trigger care_access_requests_guard_insert
  before insert on public.care_access_requests
  for each row execute function private.guard_care_access_request_insert();

-- ---------------------------------------------------------------------------
-- 2. The only end-user creation path.
-- ---------------------------------------------------------------------------

create or replace function public.request_care_access(
  p_phone            text,
  p_permission_level public.profile_access_level,
  p_direction        text,
  p_relationship     text default null,
  p_permissions      public.caregiver_permission[] default null,
  p_expires_at       timestamptz default null
)
returns public.care_access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_other   uuid;
  v_request public.care_access_requests;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if p_direction not in ('offer_my_record', 'request_their_record') then
    raise exception 'Unknown direction %', p_direction using errcode = '22023';
  end if;

  -- The whole point: the caller names a phone number, never a profile id.
  -- find_profile_by_phone is STABLE SECURITY DEFINER and already restricts to
  -- an exact phone match on a role = 'patient' profile in the CALLER's own
  -- organisation (auth.uid() is unchanged inside a SECURITY DEFINER call, so
  -- it scopes to the real caller, not to postgres).
  select f.id into v_other
  from public.find_profile_by_phone(p_phone) f
  limit 1;

  if v_other is null or v_other = v_uid then
    raise exception 'We could not find a Tarragon account on that number in your organisation'
      using errcode = 'P0002';
  end if;

  perform set_config('tarragon.care_access_verified_party', v_other::text, true);

  if p_direction = 'offer_my_record' then
    insert into public.care_access_requests
      (profile_id, counterparty_user_id, initiated_by,
       permission_level, relationship, permissions, expires_at)
    values
      (v_uid, v_other, v_uid, p_permission_level, p_relationship, p_permissions, p_expires_at)
    returning * into v_request;
  else
    insert into public.care_access_requests
      (profile_id, counterparty_user_id, initiated_by,
       permission_level, relationship, permissions, expires_at)
    values
      (v_other, v_uid, v_uid, p_permission_level, p_relationship, p_permissions, p_expires_at)
    returning * into v_request;
  end if;

  perform set_config('tarragon.care_access_verified_party', '', true);

  return v_request;
end;
$$;

comment on function public.request_care_access(text, public.profile_access_level, text, text, public.caregiver_permission[], timestamptz) is
  'Creates a pending care_access_requests row from the other party''s PHONE NUMBER. The only path an authenticated user has into that table: naming a profile UUID directly is refused by private.guard_care_access_request_insert. p_direction is ''offer_my_record'' (the caller offers access to their own record) or ''request_their_record'' (the caller asks for access to the other person''s). Either way the OTHER party must still accept via respond_to_care_access_request before any profile_access row exists.';

-- anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant —
-- `revoke ... from public` is the revoke that actually removes it. Both kept,
-- matching this codebase's settled convention.
revoke all on function public.request_care_access(text, public.profile_access_level, text, text, public.caregiver_permission[], timestamptz) from public;
revoke execute on function public.request_care_access(text, public.profile_access_level, text, text, public.caregiver_permission[], timestamptz) from anon;
grant execute on function public.request_care_access(text, public.profile_access_level, text, text, public.caregiver_permission[], timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Remove the direct INSERT surface entirely.
--     The policy is what admitted the forged row; the grant is what made the
--     command reachable in the first place. Both go — RLS restricts rows, it
--     does not grant table access, and vice versa.
-- ---------------------------------------------------------------------------

drop policy if exists care_access_requests_insert on public.care_access_requests;
revoke insert on public.care_access_requests from authenticated;
revoke insert on public.care_access_requests from anon;

-- ---------------------------------------------------------------------------
-- 4. Prove it, rather than hope it.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'care_access_requests'
      and policyname = 'care_access_requests_insert'
  ) then
    raise exception 'BROKEN: care_access_requests_insert still exists';
  end if;

  if has_table_privilege('authenticated', 'public.care_access_requests', 'INSERT') then
    raise exception 'BROKEN: authenticated still holds INSERT on care_access_requests';
  end if;

  if has_table_privilege('anon', 'public.care_access_requests', 'INSERT') then
    raise exception 'BROKEN: anon still holds INSERT on care_access_requests';
  end if;

  -- SELECT must survive: both parties still need to read their own pending
  -- rows, and respond_to_care_access_request's callers read them first.
  if not has_table_privilege('authenticated', 'public.care_access_requests', 'SELECT') then
    raise exception 'BROKEN: authenticated lost SELECT on care_access_requests';
  end if;
  if not has_table_privilege('authenticated', 'public.care_access_requests', 'UPDATE') then
    raise exception 'BROKEN: authenticated lost UPDATE on care_access_requests (cancel path)';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.care_access_requests'::regclass
      and tgname = 'care_access_requests_guard_insert'
      and not tgisinternal
  ) then
    raise exception 'BROKEN: care_access_requests_guard_insert trigger missing';
  end if;

  if not has_function_privilege('authenticated', 'public.request_care_access(text, public.profile_access_level, text, text, public.caregiver_permission[], timestamptz)', 'EXECUTE') then
    raise exception 'BROKEN: authenticated cannot execute request_care_access';
  end if;

  if has_function_privilege('anon', 'public.request_care_access(text, public.profile_access_level, text, text, public.caregiver_permission[], timestamptz)', 'EXECUTE') then
    raise exception 'BROKEN: anon can execute request_care_access';
  end if;
end $$;
