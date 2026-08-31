-- Tarragon Health — the care graph, part 1: an access log.
--
-- profile_access has been a good consent model and a poor consent PRODUCT. A
-- patient could see the list of people holding a grant (CareVisibilityList)
-- and could flip health visibility per person, but nothing anywhere recorded
-- what a grant was ever USED for. "Your daughter can see your medications" is
-- a permission. "Your daughter looked at your record on Tuesday" is a fact,
-- and it is the fact that makes the permission feel governed rather than
-- surrendered.
--
-- That gap matters more here than in most products, because of who the
-- grantees are. A grantee is usually the person paying, frequently senior in
-- the family, and always harder to say no to than a stranger would be. A
-- consent switch with no audit trail asks an elderly patient to police a
-- relationship from memory. This table means they do not have to.
--
-- WHAT GOES IN
--
--   Lifecycle    Every create/change/removal of a profile_access row, written
--                by trigger, not by the application. The log cannot drift from
--                the grants because the grants are what write it.
--
--   Use          A grantee opening a consented surface (the care receipt, a
--                supported person's health summary) or acting on the record
--                (paying a bill, requesting a refill). Written by the
--                SECURITY DEFINER functions that serve those surfaces, via
--                private.log_care_access.
--
-- WHAT STAYS OUT
--
--   Anything clinical. `scope` is a fixed vocabulary of surface names
--   ('care_receipt', 'health_summary', …), never a record, a value or a
--   reason. The log says a supporter read the health summary; it does not
--   restate the health summary. Asserted at the bottom of this file.
--
--   The patient's own activity, and org staff activity. This is a log of
--   DELEGATED access specifically. Staff access is governed by RLS and the
--   clinical record's own attribution (reviewed_by/reviewed_at); folding it in
--   here would bury the four rows a patient actually needs to see under a
--   hundred they do not.
--
-- Row counts before this migration: profile_access 0, care_access_requests 1.
-- Nothing to backfill — the log starts empty and is complete from here, which
-- is the only honest state for an audit log to start in.

-- --- vocabulary --------------------------------------------------------------
create type public.care_access_event_kind as enum (
  -- lifecycle, written by trigger from profile_access
  'granted',
  'permission_changed',
  'clinical_access_granted',
  'clinical_access_withdrawn',
  'revoked',
  -- use, written by the definer functions that serve delegated surfaces
  'record_viewed',
  'receipt_generated',
  'acted_for'
);

comment on type public.care_access_event_kind is
  'What happened to, or was done with, a delegated access grant. Lifecycle kinds are written only by the profile_access triggers; use kinds only by private.log_care_access.';

-- --- the log -----------------------------------------------------------------
create table public.care_access_events (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  -- Whose record this is about. The person who gets to read the whole log.
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  -- Who did it. For lifecycle rows written by a trigger during an
  -- unauthenticated path (a seed, an admin script) auth.uid() can be null, so
  -- this is nullable rather than defaulted to a lie.
  actor_profile_id  uuid references public.profiles (id) on delete set null,
  -- Who the grant is about, when that differs from the actor: an owner
  -- revoking someone else's access is actor = owner, subject = grantee.
  subject_profile_id uuid references public.profiles (id) on delete set null,
  kind              public.care_access_event_kind not null,
  -- Fixed surface vocabulary. See care_access_events_scope_known below.
  scope             text,
  occurred_at       timestamptz not null default now(),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.care_access_events is
  'Append-only record of delegated access to a patient record: who was granted it, who changed it, and what they did with it. Never contains clinical content — see the scope CHECK and the assertion block in 20260807010107_care_access_events.sql.';

comment on column public.care_access_events.scope is
  'Which delegated surface was used, from a fixed vocabulary. Never free text about the record itself.';

-- The vocabulary is a CHECK, not a convention, so a future caller cannot pass
-- 'BP 156/96 viewed' and turn an access log into a clinical leak.
alter table public.care_access_events
  add constraint care_access_events_scope_known check (
    scope is null or scope in (
      'care_receipt',       -- the proof-of-care receipt
      'health_summary',     -- readings/medications/what is due next
      'care_status',        -- is anyone reviewing this: counts and dates only
      'billing',            -- payable orders, plan funding
      'refill_request',     -- turned a due refill into a payable order
      'booking',            -- booked or paid for care
      'messaging'           -- took part in a care-team conversation
    )
  );

create index care_access_events_patient_idx
  on public.care_access_events (patient_id, occurred_at desc);
create index care_access_events_actor_idx
  on public.care_access_events (actor_profile_id, occurred_at desc);

-- --- append-only, structurally ------------------------------------------------
-- No UPDATE or DELETE policy is defined below, which already stops every
-- authenticated caller. This trigger additionally stops the SECURITY DEFINER
-- functions in this codebase (which bypass RLS) and any future admin path, so
-- "append-only" is a property of the table rather than of the policy set that
-- currently happens to sit on it. Same reasoning as patient_timeline.
create or replace function private.care_access_events_append_only()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  raise exception 'care_access_events is append-only; a % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

create trigger care_access_events_no_update
  before update or delete on public.care_access_events
  for each row execute function private.care_access_events_append_only();

-- --- who may read it ----------------------------------------------------------
alter table public.care_access_events enable row level security;

-- The patient reads everything about their own record. A grantee reads only
-- what they themselves did — enough to answer "what have I looked at", never
-- enough to watch a sibling. That asymmetry is deliberate: the log exists to
-- give the patient oversight of their supporters, not supporters oversight of
-- each other.
create policy care_access_events_select on public.care_access_events
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or actor_profile_id = (select auth.uid())
    or private.is_admin()
  );

-- No INSERT policy on purpose. Writes come only from the trigger and from
-- private.log_care_access, both SECURITY DEFINER. An application that could
-- write its own audit rows is not running an audit log.

-- RLS restricts rows; it does not grant table access, and a table created by a
-- later migration does not inherit the project-creation grant. Explicit.
grant select on public.care_access_events to authenticated;
revoke select on public.care_access_events from anon;

-- --- the one writer -----------------------------------------------------------
-- Exception-guarded for the same reason the sponsor spend receipt is: this is
-- called inside transactions that do real work (a payment, a refill request).
-- A failure to log must never be the reason a patient's medication order does
-- not get created. A missing log line is a defect; a lost order is a broken
-- product. The failure is not silent to operators — it goes to the server log.
create or replace function private.log_care_access(
  p_patient   uuid,
  p_kind      public.care_access_event_kind,
  p_scope     text default null,
  p_metadata  jsonb default '{}'::jsonb,
  p_actor     uuid default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := coalesce(p_actor, (select auth.uid()));
  v_org   uuid;
begin
  -- The patient acting on their own record is not delegated access, and org
  -- staff access is governed and attributed elsewhere. Neither belongs here.
  if v_actor is null or v_actor = p_patient then
    return;
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then
    return;
  end if;

  insert into public.care_access_events
    (organisation_id, patient_id, actor_profile_id, subject_profile_id, kind, scope, metadata)
  values
    (v_org, p_patient, v_actor, v_actor, p_kind, p_scope, coalesce(p_metadata, '{}'::jsonb));
exception
  when others then
    raise warning 'care access log failed for patient % (%): %', p_patient, p_kind, sqlerrm;
end;
$$;

revoke all on function private.log_care_access(uuid, public.care_access_event_kind, text, jsonb, uuid) from public;

-- --- lifecycle rows come from the grants themselves ----------------------------
-- Writing these from the application would mean every future code path that
-- touches profile_access has to remember to log. Writing them from a trigger
-- means it cannot forget. respond_to_care_access_request, addChildDependentAction,
-- the admin path and anything not yet written are all covered by construction.
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
    v_meta := jsonb_build_object('permission_level', new.permission_level);
  elsif tg_op = 'DELETE' then
    v_kind := 'revoked';
    v_meta := jsonb_build_object('permission_level', old.permission_level);
  elsif new.clinical_access is distinct from old.clinical_access then
    v_kind := case when new.clinical_access
                then 'clinical_access_granted'::public.care_access_event_kind
                else 'clinical_access_withdrawn'::public.care_access_event_kind end;
    v_meta := jsonb_build_object('permission_level', new.permission_level);
  elsif new.permission_level is distinct from old.permission_level then
    v_kind := 'permission_changed';
    v_meta := jsonb_build_object(
      'from', old.permission_level, 'permission_level', new.permission_level
    );
  else
    -- A touch that changed neither the level nor the visibility (updated_at
    -- alone). Nothing happened worth telling the patient about.
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

create trigger profile_access_log_lifecycle
  after insert or update or delete on public.profile_access
  for each row execute function private.log_profile_access_lifecycle();

-- --- the migration is the test -------------------------------------------------
do $$
declare
  v_org uuid;
  v_a uuid;
  v_b uuid;
  v_grant uuid;
  v_count int;
begin
  -- No write policy may ever exist on an append-only log.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'care_access_events' and cmd <> 'SELECT'
  ) then
    raise exception 'care_access_events must have no write policy';
  end if;

  -- authenticated must be able to reach the table at all (the grant lesson).
  if not has_table_privilege('authenticated', 'public.care_access_events', 'SELECT') then
    raise exception 'authenticated cannot select care_access_events';
  end if;

  if has_table_privilege('anon', 'public.care_access_events', 'SELECT') then
    raise exception 'anon must not reach the access log';
  end if;

  -- The scope vocabulary must actually reject free text, or it is decoration.
  select id into v_org from public.organisations limit 1;
  select id into v_a from public.profiles where organisation_id = v_org limit 1;
  select id into v_b from public.profiles where organisation_id = v_org and id <> v_a limit 1;

  if v_org is null or v_a is null or v_b is null then
    raise warning 'skipping behavioural assertions: need an org and two profiles';
    return;
  end if;

  begin
    insert into public.care_access_events (organisation_id, patient_id, kind, scope)
    values (v_org, v_a, 'record_viewed', 'BP 156/96');
    raise exception 'the scope CHECK did not reject free text';
  exception
    when check_violation then null;
  end;

  -- Clear the decks so the counts below can only come from the trigger, not
  -- from something that was already there. Deliberately sabotage-checked
  -- (trigger narrowed to `after update`) before this migration was applied:
  -- the block failed with "expected 1 granted event, found 0", so it
  -- discriminates rather than passing vacuously.
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_a, v_b, 'view', v_a)
  returning id into v_grant;

  select count(*) into v_count
    from public.care_access_events
   where patient_id = v_a and subject_profile_id = v_b and kind = 'granted';
  if v_count <> 1 then
    raise exception 'expected 1 granted event, found %', v_count;
  end if;

  update public.profile_access set permission_level = 'manage' where id = v_grant;
  select count(*) into v_count
    from public.care_access_events
   where patient_id = v_a and kind = 'permission_changed';
  if v_count <> 1 then
    raise exception 'expected 1 permission_changed event, found %', v_count;
  end if;

  delete from public.profile_access where id = v_grant;
  select count(*) into v_count
    from public.care_access_events
   where patient_id = v_a and kind = 'revoked';
  if v_count <> 1 then
    raise exception 'expected 1 revoked event, found %', v_count;
  end if;

  -- Append-only must hold against a superuser-equivalent path, not just RLS.
  begin
    update public.care_access_events set scope = 'billing' where patient_id = v_a;
    raise exception 'care_access_events accepted an UPDATE';
  exception
    when insufficient_privilege then null;
  end;

  -- Leave the database as we found it. The append-only trigger blocks DELETE,
  -- so it is disabled for exactly this cleanup and restored immediately.
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;
end $$;
