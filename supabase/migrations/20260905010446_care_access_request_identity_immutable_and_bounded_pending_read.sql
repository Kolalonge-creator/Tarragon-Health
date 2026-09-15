-- Tarragon Health — two residual holes left by 20260905000206, found by a
-- second adversarial pass over that migration.
--
-- HOLE 1 — a user could rewrite the IDENTITY of their own request at cancel
-- time. care_access_requests_update_cancel pins only initiated_by and
-- status = 'cancelled'. It pins neither party, nor the permission level, nor
-- the relationship. Proven live, in a rolled-back transaction:
--
--     update public.care_access_requests
--       set profile_id = '<an arbitrary third party>', status = 'cancelled'
--     where id = '<my own pending request>';   -- succeeded
--
-- Not a disclosure (profiles_select_pending_care_access requires the row to
-- still be 'pending', and this path forces 'cancelled'), but it fires the
-- responded notification at a stranger and leaves a permanently wrong audit
-- record of who asked whom for what. The comment in
-- cancelCareAccessRequestAction claiming "nothing else about the row is
-- reachable through this path" was true of that server action and false of a
-- direct PostgREST PATCH, which is the same mistake 20260730025553 made about
-- INSERT.
--
-- An RLS policy cannot express "unchanged" — WITH CHECK sees only the NEW
-- row, never OLD — so the immutability lives in a BEFORE UPDATE trigger, and
-- the policy is tightened alongside it as defence in depth. The trigger also
-- covers respond_to_care_access_request, which is SECURITY DEFINER and
-- therefore bypasses the policy entirely: it may still move status /
-- responded_by / responded_at, and may not touch either party.
--
-- HOLE 2 — the pending-read window was unbounded in time.
-- profiles_select_pending_care_access keys only on status = 'pending', and
-- the requester is the party who decides whether the row ever stops being
-- pending. So one accepted phone-number lookup bought a permanent, whole-row
-- read of the other person's profiles record (date_of_birth, is_pregnant,
-- next_of_kin_phone, the emergency contact fields, patient_number), for as
-- long as the other side simply never answered. A request nobody answers in
-- two weeks is not an active request; it is a stale unlock.
--
-- Two bounds are added:
--   * the read expires 14 days after the request was created, and never
--     outlives the request's own expires_at where one was set. Answering is
--     unaffected: respond_to_care_access_request is SECURITY DEFINER and
--     reads nothing through this policy, and care_access_requests_select is
--     untouched, so a request older than the window can still be accepted,
--     declined or cancelled. What lapses is the profile READ, not the
--     request.
--   * a caller may create at most 5 requests in any rolling 24 hours,
--     enforced in the same BEFORE INSERT guard that already requires the
--     phone proof, so it holds on every path rather than only in the RPC.
--     This bounds how fast the (phone number -> profile row) oracle can be
--     turned even by someone with a list of numbers.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. The read is still a whole-row read of
-- public.profiles: RLS grants rows, not columns, and the caller only ever
-- needs the other party's full_name (that is all /patient/family renders from
-- it). The real fix is to stop embedding profiles in that query at all and
-- return a name-only projection from an RPC, which would let this policy be
-- dropped outright rather than merely bounded. That is a change to
-- apps/web/src/app/(dashboard)/patient/family/page.tsx's two embedded
-- profiles joins plus a new SECURITY DEFINER reader, not a policy edit, and
-- it is recorded here as scoped-but-not-done rather than half-done.
-- public.find_profile_by_phone also remains an unthrottled membership oracle
-- for any authenticated caller (an exact phone match returns id + full_name),
-- and with exactly one live organisation its same-org predicate constrains
-- nothing today. The request cap below limits what that oracle can be
-- ESCALATED into; it does not throttle the lookup itself.
--
-- Rows affected: zero. `select count(*) from public.care_access_requests`
-- returned 0 on the live project when this was written, so nothing existing
-- changes status, loses a read, or needs converting.

-- ---------------------------------------------------------------------------
-- 1. Identity columns are immutable once the request exists.
-- ---------------------------------------------------------------------------

create or replace function private.guard_care_access_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Applies to every path, including the SECURITY DEFINER responder RPC and
  -- the service role. Nothing in this platform has a legitimate reason to
  -- move a request from one pair of people to another, or to raise the
  -- permission level of a request the other party has already seen: the way
  -- to change any of these is to withdraw the request and make a new one.
  if new.profile_id is distinct from old.profile_id
     or new.counterparty_user_id is distinct from old.counterparty_user_id
     or new.initiated_by is distinct from old.initiated_by
     or new.permission_level is distinct from old.permission_level
     or new.relationship is distinct from old.relationship
     or new.permissions is distinct from old.permissions
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A care access request cannot be re-pointed after it is created. Withdraw it and make a new one.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.guard_care_access_request_update() is
  'Freezes both parties, the permission level, the relationship, the permissions array and the expiry of a care_access_requests row. Only status/responded_by/responded_at/updated_at may move after creation. Closes the cancel-time rewrite that care_access_requests_update_cancel''s WITH CHECK could not express.';

drop trigger if exists care_access_requests_guard_update on public.care_access_requests;
create trigger care_access_requests_guard_update
  before update on public.care_access_requests
  for each row execute function private.guard_care_access_request_update();

-- ---------------------------------------------------------------------------
-- 2. The cancel policy, tightened. Defence in depth behind the trigger: this
--    alone cannot pin the parties (no OLD in WITH CHECK), but it can insist
--    the cancelling caller is still one of them.
-- ---------------------------------------------------------------------------

drop policy if exists care_access_requests_update_cancel on public.care_access_requests;
create policy care_access_requests_update_cancel on public.care_access_requests
  for update to authenticated
  using (
    initiated_by = (select auth.uid())
    and status = 'pending'
  )
  with check (
    initiated_by = (select auth.uid())
    and status = 'cancelled'
    and (
      profile_id = (select auth.uid())
      or counterparty_user_id = (select auth.uid())
    )
  );

comment on policy care_access_requests_update_cancel on public.care_access_requests is
  'Withdraw your own pending request. The caller must remain a named party on the row; private.guard_care_access_request_update is what actually holds the two parties and the permission level still, because WITH CHECK cannot see the old row.';

-- ---------------------------------------------------------------------------
-- 3. A bounded pending-read window.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select_pending_care_access on public.profiles;
create policy profiles_select_pending_care_access on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.care_access_requests car
      where car.status = 'pending'
        -- An unanswered request stops unlocking the other person's profile
        -- after two weeks. The request itself stays answerable.
        and car.created_at > (now() - interval '14 days')
        -- ...and a request that already carries its own expiry never
        -- outlives it.
        and (car.expires_at is null or car.expires_at > now())
        and (
          (car.profile_id = profiles.id and car.counterparty_user_id = (select auth.uid()))
          or
          (car.counterparty_user_id = profiles.id and car.profile_id = (select auth.uid()))
        )
    )
  );

comment on policy profiles_select_pending_care_access on public.profiles is
  'Lets the two parties of a live care access request see each other by name while it is open. Bounded to 14 days from creation and to the request''s own expires_at, because the requester controls whether a row ever stops being pending. Still a whole-row read: replacing it with a name-only RPC projection is the remaining residual, see 20260905010446.';

-- ---------------------------------------------------------------------------
-- 4. A cap on how many requests one account can create.
--     Re-creates the 20260905000206 guard with the cap added; everything
--     else in it is unchanged.
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
  v_recent     integer;
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

  -- Volume cap. Counted on created_at across ALL statuses, not on how many
  -- are currently pending: cancelling a request would otherwise free a slot
  -- immediately and the cap would bound nothing. A real person adds a
  -- next of kin or two; five in a day is already generous.
  select count(*) into v_recent
  from public.care_access_requests
  where initiated_by = v_uid
    and created_at > (now() - interval '24 hours');

  if v_recent >= 5 then
    raise exception 'You have sent several care access requests today already. Please try again tomorrow.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Prove it, rather than hope it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_check text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.care_access_requests'::regclass
      and tgname = 'care_access_requests_guard_update'
      and not tgisinternal
  ) then
    raise exception 'BROKEN: care_access_requests_guard_update trigger missing';
  end if;

  select pg_get_expr(pp.polwithcheck, pp.polrelid) into v_check
  from pg_policy pp
  where pp.polrelid = 'public.care_access_requests'::regclass
    and pp.polname = 'care_access_requests_update_cancel';

  if v_check is null or v_check not like '%counterparty_user_id%' then
    raise exception 'BROKEN: the cancel policy no longer requires the caller to be a party';
  end if;

  select pg_get_expr(pp.polqual, pp.polrelid) into v_check
  from pg_policy pp
  where pp.polrelid = 'public.profiles'::regclass
    and pp.polname = 'profiles_select_pending_care_access';

  if v_check is null or v_check not like '%14 days%' then
    raise exception 'BROKEN: the pending profiles read is unbounded in time again';
  end if;

  if pg_get_functiondef('private.guard_care_access_request_insert'::regproc) not like '%24 hours%' then
    raise exception 'BROKEN: the request creation cap is gone from the insert guard';
  end if;
end $$;
