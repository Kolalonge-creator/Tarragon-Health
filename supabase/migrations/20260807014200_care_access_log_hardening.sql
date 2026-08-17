-- Two defects in 20260807010452, both found by
-- packages/db/tests/care_graph_and_receipt.sql rather than in production.
--
-- 1. THE APPEND-ONLY LOG WAS WRITABLE AT THE PRIVILEGE LEVEL.
--
-- That migration granted SELECT and asserted that no write POLICY existed, and
-- both of those were true. What it did not check is the table PRIVILEGE, and
-- this project fixed the "a migration-created table has no grants" problem at
-- the root with an `alter default privileges ... to authenticated` migration
-- during the 2026-08-01 sweep. That fix does its job a little too well: every
-- table created by a later migration now arrives with INSERT, UPDATE and
-- DELETE granted to authenticated, whether or not it wants them.
--
-- Nothing was actually at risk — RLS was enabled with no write policy, so a
-- write found no rows and inserted nothing. But that makes append-only a
-- property of the policy set, and the whole argument for a separate audit table
-- is that it is a property of the TABLE. It also produced a genuinely confusing
-- failure mode: a DELETE by the patient returned success having deleted nothing,
-- rather than being refused, which is exactly the "looks like a wrong zero, not
-- an error" shape this codebase has been bitten by before.
--
-- Worth carrying forward: after the default-privileges fix, `grant select` on a
-- new table is not the same as "only select". A table that should be read-only
-- has to revoke.
--
-- 2. THE LOG WAS TOO NOISY TO READ.
--
-- private.log_care_access wrote a row per call, and the receipt is a page: one
-- sponsor opening it, scrolling and refreshing produced eight rows in the test
-- alone. An access log a patient cannot skim is not oversight, it is a wall,
-- and the first thing a wall does is stop being read. Repeat use of the SAME
-- surface by the SAME person is now folded into one row per hour.
--
-- Deliberately not deduplicated: the lifecycle kinds (granted, revoked, consent
-- given or withdrawn). Those are discrete events, each one is a decision
-- somebody made, and two of them an hour apart is a fact the patient should
-- see twice. They are written by the profile_access trigger, which this does
-- not touch.

-- --- 1. read-only means read-only ------------------------------------------------
revoke insert, update, delete, truncate on public.care_access_events from authenticated;
revoke insert, update, delete, truncate on public.care_access_events from anon;

-- --- 2. one row per person, per surface, per hour ----------------------------------
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

  -- Collapse a browsing session into one line. Not race-free — two concurrent
  -- requests can both miss and both insert — and deliberately left that way: a
  -- unique index would need an immutable expression over occurred_at and a
  -- generated column to carry it, which is a lot of machinery to avoid the
  -- occasional duplicate row in an activity log. An extra line is a cosmetic
  -- defect here; a lock on the hot path of a patient's medication order is not.
  if exists (
    select 1 from public.care_access_events e
     where e.patient_id = p_patient
       and e.actor_profile_id = v_actor
       and e.kind = p_kind
       and e.scope is not distinct from p_scope
       and e.occurred_at > now() - interval '1 hour'
  ) then
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

-- --- the migration is the test ------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- The check 20260807010452 should have made. Privilege, not policy.
  select string_agg(privilege_type, ', ' order by privilege_type) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'care_access_events'
     and grantee = 'authenticated' and privilege_type <> 'SELECT';
  if v_bad is not null then
    raise exception 'authenticated still holds % on the append-only access log', v_bad;
  end if;

  if not has_table_privilege('authenticated', 'public.care_access_events', 'SELECT') then
    raise exception 'authenticated must still be able to read its own access log';
  end if;

  if has_table_privilege('anon', 'public.care_access_events', 'SELECT') then
    raise exception 'anon must not reach the access log';
  end if;

  -- The dedupe must apply to use, and must NOT apply to lifecycle. The
  -- lifecycle kinds are written by the profile_access trigger, which has no
  -- dedupe branch at all — assert that stays true, since folding two real
  -- consent decisions into one row would be a worse defect than the noise.
  if pg_get_functiondef('private.log_profile_access_lifecycle()'::regprocedure)
       like '%interval ''1 hour''%' then
    raise exception 'lifecycle events must never be deduplicated';
  end if;

  if pg_get_functiondef('private.log_care_access(uuid,public.care_access_event_kind,text,jsonb,uuid)'::regprocedure)
       not like '%interval ''1 hour''%' then
    raise exception 'log_care_access has lost its dedupe window';
  end if;
end $$;
