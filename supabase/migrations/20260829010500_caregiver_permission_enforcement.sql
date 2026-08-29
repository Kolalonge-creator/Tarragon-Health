-- Caregiver Proxy Access, part 2: expiry enforcement, granular helpers, and
-- the audit trail that tells the two apart.
--
-- Expiry is enforced by construction rather than by teaching every RLS
-- policy and RPC on the platform a new clause. Every one of them already
-- asks "does a profile_access row exist for this pair", inline or through
-- private.can_act_for / private.can_read_clinical — none of them cache the
-- answer. So private.expire_stale_profile_access deleting a row once its
-- expires_at has passed makes that grant disappear everywhere at once, with
-- a staleness window bounded by the cron cadence below, and zero changes to
-- any of the ~40 policies and functions that already read this table. The
-- two centralised helpers additionally get an expiry check of their own, so
-- the paths that already call them close that window immediately rather
-- than waiting for the next sweep.
--
-- Granular permission is the opposite shape: it cannot be centralised the
-- same way, because the ~10 call sites that check permission_level = 'manage'
-- today do not know what they are being asked to authorise (a booking, a
-- payment, a message) unless told. This migration adds the vocabulary both
-- helpers now accept; 20260829013000 spends it at the call sites that most
-- directly match the nine capabilities in the spec this closes.

-- --- 1. can_act_for: expiry, and a permission-aware overload ------------------
create or replace function private.can_act_for(p_beneficiary uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = (select auth.uid())
       and pa.permission_level = 'manage'
       and (pa.expires_at is null or pa.expires_at > now())
  );
$$;

create or replace function private.can_act_for(p_beneficiary uuid, p_permission public.caregiver_permission)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = (select auth.uid())
       and pa.permission_level = 'manage'
       and (pa.expires_at is null or pa.expires_at > now())
       and (pa.permissions is null or p_permission = any(pa.permissions))
  );
$$;

revoke all on function private.can_act_for(uuid, public.caregiver_permission) from public;
grant execute on function private.can_act_for(uuid, public.caregiver_permission) to authenticated;

-- The app needs to ask the same question the policies ask, same reasoning as
-- the existing single-argument public.can_act_for.
create or replace function public.can_act_for(p_beneficiary uuid, p_permission public.caregiver_permission)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.can_act_for(p_beneficiary, p_permission);
$$;

revoke all on function public.can_act_for(uuid, public.caregiver_permission) from public;
revoke all on function public.can_act_for(uuid, public.caregiver_permission) from anon;
grant execute on function public.can_act_for(uuid, public.caregiver_permission) to authenticated;

-- --- 2. can_read_clinical: expiry, and a permission-aware overload ------------
-- Byte-identical to the live definition (20260731185243) apart from the
-- expires_at clause, so the is_dependent_account branch — a guardian's
-- 'manage' grant standing in for a child with no login of their own — is
-- preserved exactly.
create or replace function private.can_read_clinical(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (pa.expires_at is null or pa.expires_at > now())
      and (
        pa.clinical_access
        or (pa.permission_level = 'manage' and p.is_dependent_account)
      )
  );
$$;

create or replace function private.can_read_clinical(p_patient uuid, p_permission public.caregiver_permission)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (pa.expires_at is null or pa.expires_at > now())
      and (pa.permissions is null or p_permission = any(pa.permissions))
      and (
        pa.clinical_access
        or (pa.permission_level = 'manage' and p.is_dependent_account)
      )
  );
$$;

revoke all on function private.can_read_clinical(uuid, public.caregiver_permission) from public;
grant execute on function private.can_read_clinical(uuid, public.caregiver_permission) to authenticated;

-- --- 3. A request can propose a scope and a duration --------------------------
-- Same body as the live 20260730025553 definition, plus carrying permissions
-- and expires_at from the request into the grant it creates or refreshes.
create or replace function public.respond_to_care_access_request(
  p_request_id uuid,
  p_accept boolean
)
returns public.care_access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.care_access_requests;
  v_acceptor uuid;
begin
  select * into v_request
  from public.care_access_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been responded to';
  end if;

  v_acceptor := case
    when v_request.initiated_by = v_request.profile_id then v_request.counterparty_user_id
    else v_request.profile_id
  end;

  if (select auth.uid()) is distinct from v_acceptor then
    raise exception 'Only the other party may respond to this request'
      using errcode = '42501';
  end if;

  if p_accept then
    insert into public.profile_access
      (profile_id, grantee_user_id, permission_level, granted_by, permissions, expires_at)
    values
      (v_request.profile_id, v_request.counterparty_user_id, v_request.permission_level,
       v_request.profile_id, v_request.permissions, v_request.expires_at)
    on conflict (profile_id, grantee_user_id)
    do update set
      permission_level = excluded.permission_level,
      permissions = excluded.permissions,
      expires_at = excluded.expires_at,
      updated_at = now();

    update public.care_access_requests
    set status = 'accepted', responded_by = (select auth.uid()), responded_at = now()
    where id = p_request_id
    returning * into v_request;
  else
    update public.care_access_requests
    set status = 'declined', responded_by = (select auth.uid()), responded_at = now()
    where id = p_request_id
    returning * into v_request;
  end if;

  return v_request;
end;
$$;

revoke all on function public.respond_to_care_access_request(uuid, boolean) from public;
revoke execute on function public.respond_to_care_access_request(uuid, boolean) from anon;
grant execute on function public.respond_to_care_access_request(uuid, boolean) to authenticated;

-- --- 4. Lifecycle log: tell "ran out" from "taken back", and log the scope ----
-- Same trigger shape as the live 20260807010452 definition. Two changes:
-- DELETE now distinguishes 'expired' (the row's own expires_at had already
-- passed) from 'revoked' (anything else — a patient or grantee choosing to
-- end it early); and a permissions-array-only change is now also logged as
-- 'permission_changed', alongside the existing level/clinical_access cases.
create or replace function private.log_profile_access_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_org    uuid;
  v_actor  uuid := (select auth.uid());
  v_owner  uuid;
  v_other  uuid;
  v_kind   public.care_access_event_kind;
  v_meta   jsonb;
begin
  v_owner := coalesce(new.profile_id, old.profile_id);
  v_other := coalesce(new.grantee_user_id, old.grantee_user_id);

  select organisation_id into v_org from public.profiles where id = v_owner;
  if v_org is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_kind := 'granted';
    v_meta := jsonb_build_object(
      'permission_level', new.permission_level,
      'permissions', to_jsonb(new.permissions),
      'expires_at', new.expires_at
    );
  elsif tg_op = 'DELETE' then
    v_kind := case when old.expires_at is not null and old.expires_at <= now()
                then 'expired'::public.care_access_event_kind
                else 'revoked'::public.care_access_event_kind end;
    v_meta := jsonb_build_object(
      'permission_level', old.permission_level,
      'permissions', to_jsonb(old.permissions),
      'expires_at', old.expires_at
    );
  elsif new.clinical_access is distinct from old.clinical_access then
    v_kind := case when new.clinical_access
                then 'clinical_access_granted'::public.care_access_event_kind
                else 'clinical_access_withdrawn'::public.care_access_event_kind end;
    v_meta := jsonb_build_object('permission_level', new.permission_level);
  elsif new.permission_level is distinct from old.permission_level
     or new.permissions is distinct from old.permissions
     or new.expires_at is distinct from old.expires_at then
    v_kind := 'permission_changed';
    v_meta := jsonb_build_object(
      'from', old.permission_level, 'permission_level', new.permission_level,
      'permissions', to_jsonb(new.permissions), 'previous_permissions', to_jsonb(old.permissions),
      'expires_at', new.expires_at, 'previous_expires_at', old.expires_at
    );
  else
    -- A touch that changed none of the above (updated_at alone). Nothing
    -- happened worth telling the patient about.
    return coalesce(new, old);
  end if;

  begin
    insert into public.care_access_events
      (organisation_id, patient_id, actor_profile_id, subject_profile_id, kind, metadata)
    values
      (v_org, v_owner, v_actor, v_other, v_kind, v_meta);
  exception
    when others then
      raise warning 'care access lifecycle log failed for grant on % (%): %', v_owner, v_kind, sqlerrm;
  end;

  return coalesce(new, old);
end;
$$;

-- --- 5. The sweep --------------------------------------------------------------
-- A plain DELETE. The trigger above does the logging; this function's whole
-- job is to make an expired row stop existing, which is what makes it stop
-- being found by every policy and RPC that reads this table.
create or replace function private.expire_stale_profile_access()
returns void
language sql
security definer
set search_path to ''
as $$
  delete from public.profile_access
   where expires_at is not null and expires_at <= now();
$$;

comment on function private.expire_stale_profile_access() is
  'Deletes any profile_access grant past its expires_at. The DELETE is itself what withdraws the access (every RLS policy and RPC re-checks profile_access live); the profile_access_log_lifecycle trigger records it as an ''expired'' care_access_events row. Scheduled every 15 minutes below — that cadence is the staleness window between a grant expiring and it actually stopping working.';

select cron.schedule(
  'expire-profile-access',
  '*/15 * * * *',
  $$select private.expire_stale_profile_access();$$
);

-- --- 6. The migration is the test ----------------------------------------------
do $$
declare
  v_org uuid;
  v_a uuid;
  v_b uuid;
  v_grant uuid;
  v_kind public.care_access_event_kind;
  v_meta jsonb;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_a from public.profiles where organisation_id = v_org limit 1;
  select id into v_b from public.profiles where organisation_id = v_org and id <> v_a limit 1;

  if v_org is null or v_a is null or v_b is null then
    raise warning 'skipping behavioural assertions: need an org and two profiles';
    return;
  end if;

  -- Clean slate for the assertions below.
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;
  delete from public.profile_access where profile_id = v_a and grantee_user_id = v_b;

  -- A grant scoped to book_appointments only must refuse manage_payments, and
  -- keep allowing book_appointments — checked as a simulated session (v_b),
  -- not the unauthenticated superuser context this block otherwise runs in,
  -- so a stray auth.uid() IS NULL cannot make either branch pass vacuously.
  insert into public.profile_access
    (profile_id, grantee_user_id, permission_level, granted_by, permissions)
  values
    (v_a, v_b, 'manage', v_a, array['book_appointments']::public.caregiver_permission[])
  returning id into v_grant;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if private.can_act_for(v_a, 'manage_payments'::public.caregiver_permission) then
    raise exception 'a grant scoped to book_appointments must not also authorise manage_payments';
  end if;
  if not private.can_act_for(v_a, 'book_appointments'::public.caregiver_permission) then
    raise exception 'a grant scoped to book_appointments must authorise book_appointments';
  end if;

  reset role;

  -- A legacy grant (permissions IS NULL) must keep authorising every
  -- capability — same simulated-session discipline as above.
  update public.profile_access set permissions = null where id = v_grant;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if not private.can_act_for(v_a, 'manage_payments'::public.caregiver_permission) then
    raise exception 'a legacy grant (permissions IS NULL) must still authorise every capability';
  end if;

  reset role;

  -- Clear the events accumulated so far (granted, permission_changed x2) so
  -- the next assertion can look for its own event unambiguously. occurred_at
  -- defaults to now(), which is constant for the whole of this transaction —
  -- every event inserted in this block shares one timestamp, so "most
  -- recent" ordering cannot tell them apart and this block must isolate each
  -- phase by clearing rather than by sorting.
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;

  -- Expiry: a grant already past its own expires_at must not be findable by
  -- can_act_for even before the sweep runs (defence in depth), and the sweep
  -- itself must delete it and log it as 'expired', not 'revoked'.
  --
  -- Simulate time passing without waiting: move created_at back so a fresh
  -- expires_at is already behind now(), which the check constraint still
  -- allows since expires_at > created_at holds.
  update public.profile_access
     set created_at = now() - interval '1 hour',
         expires_at = now() - interval '30 minutes'
   where id = v_grant;

  if exists (
    select 1 from public.profile_access
     where id = v_grant and expires_at > now()
  ) then
    raise exception 'test setup did not actually produce an expired grant';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if private.can_act_for(v_a, 'book_appointments'::public.caregiver_permission) then
    raise exception 'an expired grant must not authorise anything even before the sweep runs';
  end if;

  reset role;

  -- The update above (setting expires_at) itself logged a permission_changed
  -- event, sharing this transaction's now(). Clear it so the event left by
  -- the sweep below is the only one and needs no ordering to find.
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;

  perform private.expire_stale_profile_access();

  if exists (select 1 from public.profile_access where id = v_grant) then
    raise exception 'expire_stale_profile_access left an expired grant in place';
  end if;

  select kind, metadata into v_kind, v_meta
    from public.care_access_events
   where patient_id = v_a and subject_profile_id = v_b
   order by occurred_at desc limit 1;

  if v_kind <> 'expired' then
    raise exception 'expected the sweep to log ''expired'', logged %', v_kind;
  end if;
  if v_meta->>'permission_level' is null then
    raise exception 'expired event lost its permission_level in metadata';
  end if;

  -- A manual delete of a grant that has NOT expired must still log 'revoked'.
  -- Cleared first, same reasoning as above: this transaction's now() cannot
  -- order this event after the 'expired' one still sitting in the log.
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_a, v_b, 'view', v_a)
  returning id into v_grant;
  delete from public.profile_access where id = v_grant;

  select kind into v_kind
    from public.care_access_events
   where patient_id = v_a and subject_profile_id = v_b
   order by occurred_at desc limit 1;
  if v_kind <> 'revoked' then
    raise exception 'a live grant deleted before its expiry must log ''revoked'', logged %', v_kind;
  end if;

  -- Leave the database as we found it.
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;
end $$;
