-- The one sanctioned way to approve an AI guardrail or an AI knowledge source.
--
-- Why: ai_guardrails (67 rows) and ai_knowledge_sources (5 rows) carry approved_by / approved_at, and every row was still
-- unapproved on 2026-10-30. There was no function to approve one and no screen that did it. The only write path was the
-- `ai_*_write` RLS policy (any admin can update any column), which would let anyone stamp approved_by directly, with nothing on the
-- record about who looked at what. Approval is a human clinical judgement (docs/AI_GOVERNANCE_SPEC.md: "Never seed ... a
-- knowledge-source approval"), so a route that anyone or anything can use to stamp it is the wrong shape. This adds the right one.
--
-- What it adds:
--   1. public.approve_ai_guardrails(uuid[], text) and public.approve_ai_knowledge_sources(uuid[], text). Only an ACTIVE Chief
--      Medical Officer can call them (looked up from auth.uid() on clinical_staff, the same test approve_ai_system_version uses for
--      high-risk systems). They stamp approved_by (the CMO's clinical_staff row) and approved_at, write one audit_log row per item
--      with the note, skip rows already approved (so a second click is harmless), and refuse an unknown id outright so a stale
--      page cannot half-apply. Bulk by design: a person reviews 67 rules on one screen, not 67 pages.
--   2. A guard trigger on both tables. Approval columns can be set only through those two functions: a direct INSERT or UPDATE that
--      sets approved_by / approved_at is refused, so an admin session, a seed script or a future migration cannot pre-approve a row.
--   3. The same trigger drops an approval when the substance of the row changes (description, enforcement, config and so on for a
--      guardrail; title, citation label, source and so on for a knowledge source). The CMO approved that exact text; an edited rule
--      must be looked at again. Switching a row off, or moving its review date, does not drop the approval.
--
-- What it deliberately does not do: it does not change ai_release_gate / the 40.20 "guardrails" criterion (that counts active
-- guardrails, not approved ones), it does not approve anything, and it does not touch runtime enforcement (ai_guardrails_for still
-- returns every active guardrail whether approved or not, so nothing that was blocking stops blocking). Approving only records the
-- CMO's review; the knowledge-source reader already returns approved sources only, so approving one is what lets an answer cite it.
--
-- Limit worth stating: the guard stops every application path (PostgREST, RPC, an admin session). The database owner role can still
-- run any SQL; that is outside what a trigger can prevent, and is covered by the rule in CLAUDE.md that an agent never stamps an
-- approval.

create or replace function private.guard_ai_approval_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignore text[] := array['approved_by', 'approved_at', 'is_active', 'updated_at', 'review_due_on'];
  v_route  boolean := coalesce(current_setting('tarragon.ai_approval_route', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if (new.approved_by is not null or new.approved_at is not null) then
      raise exception '% rows cannot be created already approved. Approval is recorded by the Chief Medical Officer through the approval function.', tg_table_name
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    if not v_route then
      raise exception 'Approval on % can only be recorded by the Chief Medical Officer through the approval function.', tg_table_name
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- The approved text changed: the approval no longer describes this row.
  if old.approved_at is not null
     and (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

comment on function private.guard_ai_approval_columns() is
  'Approval on ai_guardrails / ai_knowledge_sources is set only by approve_ai_guardrails / approve_ai_knowledge_sources (which raise the tarragon.ai_approval_route flag for their own transaction). Refuses a pre-approved insert and any direct change to approved_by / approved_at, and drops an approval when the row''s substance is edited.';

revoke all on function private.guard_ai_approval_columns() from public, anon;

create trigger ai_guardrails_approval_guard
  before insert or update on public.ai_guardrails
  for each row execute function private.guard_ai_approval_columns();

create trigger ai_knowledge_sources_approval_guard
  before insert or update on public.ai_knowledge_sources
  for each row execute function private.guard_ai_approval_columns();

-- The active CMO behind the caller, or an exception. Shared by both approval functions.
create or replace function private.require_cmo_for_ai_approval()
returns table (staff_id uuid, org_id uuid, actor_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'not authorised: sign in first' using errcode = '42501';
  end if;

  return query
    select cs.id, cs.organisation_id, v_actor
    from public.clinical_staff cs
    where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
    limit 1;

  if not found then
    raise exception 'not authorised: only an active Chief Medical Officer can approve AI guardrails and knowledge sources'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_cmo_for_ai_approval() from public, anon;

create or replace function public.approve_ai_guardrails(p_ids uuid[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_org   uuid;
  v_actor uuid;
  v_found integer;
  v_done  integer;
begin
  select r.staff_id, r.org_id, r.actor_id into v_staff, v_org, v_actor from private.require_cmo_for_ai_approval() r;

  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'pick at least one guardrail to approve';
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'approve at most 200 guardrails at a time';
  end if;

  select count(*) into v_found from public.ai_guardrails where id = any (p_ids);
  if v_found <> (select count(distinct x) from unnest(p_ids) as x) then
    raise exception 'one or more of those guardrails no longer exists; reload the page and try again';
  end if;

  perform set_config('tarragon.ai_approval_route', 'on', true);

  with approved as (
    update public.ai_guardrails
       set approved_by = v_staff, approved_at = now()
     where id = any (p_ids) and approved_at is null
    returning id, ai_system_id, rule_code
  ), logged as (
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    select v_org, v_actor, 'ai_guardrail.approved', 'ai_guardrails', a.id,
           jsonb_build_object('rule_code', a.rule_code, 'ai_system_id', a.ai_system_id,
                              'signed_by_clinical_staff', v_staff, 'note', nullif(btrim(coalesce(p_note, '')), ''))
    from approved a
    returning 1
  )
  select count(*) into v_done from logged;

  perform set_config('tarragon.ai_approval_route', '', true);
  return v_done;
end;
$$;

comment on function public.approve_ai_guardrails(uuid[], text) is
  'Chief Medical Officer only. Records the CMO''s approval of the listed AI guardrails (approved_by = their clinical_staff row), one audit_log row each; already-approved rows are skipped. Returns how many were newly approved.';

create or replace function public.approve_ai_knowledge_sources(p_ids uuid[], p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_org   uuid;
  v_actor uuid;
  v_found integer;
  v_done  integer;
begin
  select r.staff_id, r.org_id, r.actor_id into v_staff, v_org, v_actor from private.require_cmo_for_ai_approval() r;

  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'pick at least one knowledge source to approve';
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'approve at most 200 knowledge sources at a time';
  end if;

  select count(*) into v_found from public.ai_knowledge_sources where id = any (p_ids);
  if v_found <> (select count(distinct x) from unnest(p_ids) as x) then
    raise exception 'one or more of those knowledge sources no longer exists; reload the page and try again';
  end if;

  perform set_config('tarragon.ai_approval_route', 'on', true);

  with approved as (
    update public.ai_knowledge_sources
       set approved_by = v_staff, approved_at = now()
     where id = any (p_ids) and approved_at is null
    returning id, ai_system_id, source_code
  ), logged as (
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    select v_org, v_actor, 'ai_knowledge_source.approved', 'ai_knowledge_sources', a.id,
           jsonb_build_object('source_code', a.source_code, 'ai_system_id', a.ai_system_id,
                              'signed_by_clinical_staff', v_staff, 'note', nullif(btrim(coalesce(p_note, '')), ''))
    from approved a
    returning 1
  )
  select count(*) into v_done from logged;

  perform set_config('tarragon.ai_approval_route', '', true);
  return v_done;
end;
$$;

comment on function public.approve_ai_knowledge_sources(uuid[], text) is
  'Chief Medical Officer only. Records the CMO''s approval of the listed AI knowledge sources, one audit_log row each; already-approved rows are skipped. Returns how many were newly approved. Approving a source is what lets an AI answer cite it.';

-- anon inherits EXECUTE through PUBLIC, so the revoke is from public (not from anon).
revoke all on function public.approve_ai_guardrails(uuid[], text) from public, anon;
revoke all on function public.approve_ai_knowledge_sources(uuid[], text) from public, anon;
grant execute on function public.approve_ai_guardrails(uuid[], text) to authenticated;
grant execute on function public.approve_ai_knowledge_sources(uuid[], text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.approve_ai_guardrails(uuid[], text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.approve_ai_knowledge_sources(uuid[], text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.require_cmo_for_ai_approval()', 'EXECUTE') then
    raise exception 'anon can execute an AI approval function';
  end if;
  if not has_function_privilege('authenticated', 'public.approve_ai_guardrails(uuid[], text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute approve_ai_guardrails';
  end if;
  if exists (select 1 from public.ai_guardrails where approved_at is not null)
     or exists (select 1 from public.ai_knowledge_sources where approved_at is not null) then
    raise exception 'an AI guardrail or knowledge source is already approved; this migration must not change approval state';
  end if;
end $$;
