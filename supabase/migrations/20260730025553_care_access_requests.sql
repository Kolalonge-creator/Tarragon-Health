-- Tarragon Health — consent for next-of-kin (view) and eldercare (manage)
-- access is now a two-sided accept, not a one-sided grant.
--
-- profile_access has always let the record OWNER unilaterally insert a grant
-- (profile_access_insert requires profile_id = auth.uid()) — nominating a
-- next of kin by phone number silently handed out 'view' access with no
-- notice to the grantee at all, and there was no path for granting 'manage'
-- between two adults who each already hold their own account (eldercare —
-- an adult child helping run an elderly parent's bookings/meds), only the
-- child-with-no-login case built by addChildDependentAction.
--
-- care_access_requests is a proposal that only becomes a real profile_access
-- row once the correct party accepts it:
--
--   owner offers    profile_id (the record owner) names counterparty_user_id
--                    as the intended grantee. The counterparty must accept —
--                    creating the request is the owner's own consent, taking
--                    on read/write responsibility for someone else's record
--                    needs the other person's too.
--   counterparty
--   requests         counterparty_user_id names profile_id (someone else's
--                    record) and asks to be granted access to it — e.g. "I
--                    want to help manage my mother's care." The record OWNER
--                    must accept, because nobody may be granted access to a
--                    record without that record's own owner agreeing, no
--                    matter who asked first.
--
-- Either shape works for either permission_level: a next-of-kin 'view'
-- request is normally owner-offered; an eldercare 'manage' request may run
-- either way, since either the elder or the adult child may be the one who
-- actually opens the app first.

create type public.care_access_request_status as enum (
  'pending',
  'accepted',
  'declined',
  'cancelled'
);

create table public.care_access_requests (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  counterparty_user_id  uuid not null references public.profiles (id) on delete cascade,
  initiated_by          uuid not null references public.profiles (id) on delete cascade,
  permission_level      public.profile_access_level not null,
  relationship          text,
  status                public.care_access_request_status not null default 'pending',
  responded_by          uuid references public.profiles (id) on delete set null,
  responded_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint care_access_requests_no_self check (profile_id <> counterparty_user_id),
  constraint care_access_requests_initiator_is_party check (
    initiated_by = profile_id or initiated_by = counterparty_user_id
  )
);

-- One open proposal about a given person's record, between the same two
-- people, at a time — not one per (owner, counterparty, level), so a second
-- request must wait for the first to be accepted, declined or cancelled.
create unique index care_access_requests_one_pending_per_pair
  on public.care_access_requests (profile_id, counterparty_user_id)
  where status = 'pending';

create index care_access_requests_profile_idx on public.care_access_requests (profile_id);
create index care_access_requests_counterparty_idx on public.care_access_requests (counterparty_user_id);

create trigger care_access_requests_set_updated_at
  before update on public.care_access_requests
  for each row execute function private.set_updated_at();

alter table public.care_access_requests enable row level security;

create policy care_access_requests_select on public.care_access_requests
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or counterparty_user_id = (select auth.uid())
    or private.is_admin()
  );

-- Either named party may create the proposal, but only naming themselves as
-- initiator and only as one of the two people the request is actually about
-- — nobody can propose a relationship between two other people.
create policy care_access_requests_insert on public.care_access_requests
  for insert to authenticated
  with check (
    initiated_by = (select auth.uid())
    and (profile_id = (select auth.uid()) or counterparty_user_id = (select auth.uid()))
  );

-- Withdrawing your own still-pending proposal is a plain client update.
-- Accepting or declining is deliberately NOT done this way — see
-- respond_to_care_access_request below — because acceptance has a side
-- effect (writing profile_access) that must be re-validated server-side,
-- including re-checking which party is actually allowed to accept.
create policy care_access_requests_update_cancel on public.care_access_requests
  for update to authenticated
  using (initiated_by = (select auth.uid()) and status = 'pending')
  with check (initiated_by = (select auth.uid()) and status = 'cancelled');

grant select, insert, update on public.care_access_requests to authenticated;

-- ---------------------------------------------------------------------------
-- respond_to_care_access_request — the only path that turns a pending
-- request into a real profile_access grant. SECURITY DEFINER because the
-- owner-offers direction needs the COUNTERPARTY to accept, and accepting
-- writes a profile_access row with profile_id = the OWNER, not the caller —
-- a plain RLS insert (profile_access_insert requires profile_id = auth.uid())
-- cannot do that. Ownership/role is re-verified in-body against the request
-- row itself, not trusted from the caller, same pattern as
-- set_pharmacy_order_delivery_address / accept_video_visit_request.
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

  -- Whoever did NOT initiate is the one who must respond: creating the
  -- request already counts as the initiator's own consent.
  v_acceptor := case
    when v_request.initiated_by = v_request.profile_id then v_request.counterparty_user_id
    else v_request.profile_id
  end;

  if (select auth.uid()) is distinct from v_acceptor then
    raise exception 'Only the other party may respond to this request'
      using errcode = '42501';
  end if;

  if p_accept then
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
    values (v_request.profile_id, v_request.counterparty_user_id, v_request.permission_level, v_request.profile_id)
    on conflict (profile_id, grantee_user_id)
    do update set permission_level = excluded.permission_level, updated_at = now();

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

-- `revoke ... from public` is the fix that actually removes anon's inherited
-- EXECUTE (anon holds no direct grant of its own — it inherits from the
-- PUBLIC pseudo-role, so `revoke ... from anon` alone is a no-op). Both
-- revokes kept for defence in depth, matching the corrected convention this
-- codebase settled on in the lab_partner build (2026-07-27).
revoke all on function public.respond_to_care_access_request(uuid, boolean) from public;
revoke execute on function public.respond_to_care_access_request(uuid, boolean) from anon;
grant execute on function public.respond_to_care_access_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications. Both in_app only — this is a family-consent action, not a
-- clinical reminder/alert/confirmation, so it stays off WhatsApp/SMS per the
-- same founder correction that moved the health-education unlock nudge to
-- in_app (20260724000000): no Edge Function redeploy or Meta template needed.

create or replace function private.notify_care_access_request_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acceptor uuid;
  v_acceptor_org uuid;
  v_initiator_name text;
  v_template text;
begin
  v_acceptor := case
    when new.initiated_by = new.profile_id then new.counterparty_user_id
    else new.profile_id
  end;

  select organisation_id into v_acceptor_org from public.profiles where id = v_acceptor;
  select full_name into v_initiator_name from public.profiles where id = new.initiated_by;

  v_template := case
    when new.permission_level = 'manage' then 'care_access_manage_request'
    else 'care_access_view_request'
  end;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    v_acceptor_org,
    v_acceptor,
    'in_app',
    'pending',
    v_template,
    jsonb_build_object(
      'request_id', new.id,
      'initiator_name', coalesce(v_initiator_name, 'Someone'),
      'permission_level', new.permission_level,
      'direction', case when new.initiated_by = new.profile_id then 'offered' else 'requested' end
    )
  );

  return new;
end;
$$;

create trigger care_access_requests_notify_created
  after insert on public.care_access_requests
  for each row execute function private.notify_care_access_request_created();

create or replace function private.notify_care_access_request_responded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initiator_org uuid;
  v_responder_name text;
  v_responder_id uuid;
begin
  if old.status is distinct from 'pending' or new.status not in ('accepted', 'declined') then
    return new;
  end if;

  v_responder_id := case
    when new.initiated_by = new.profile_id then new.counterparty_user_id
    else new.profile_id
  end;

  select organisation_id into v_initiator_org from public.profiles where id = new.initiated_by;
  select full_name into v_responder_name from public.profiles where id = v_responder_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    v_initiator_org,
    new.initiated_by,
    'in_app',
    'pending',
    'care_access_request_' || new.status,
    jsonb_build_object(
      'request_id', new.id,
      'responder_name', coalesce(v_responder_name, 'They'),
      'permission_level', new.permission_level
    )
  );

  return new;
end;
$$;

create trigger care_access_requests_notify_responded
  after update on public.care_access_requests
  for each row execute function private.notify_care_access_request_responded();
