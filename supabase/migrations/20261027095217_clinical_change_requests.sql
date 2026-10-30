-- Clinical change control (audit G-12, spec D.4 "clinical safety incident reporting, root-cause review and change control").
--
-- Gap. clinical_incident_reports and ai_safety_incidents record that something went wrong, and protocol_versions / triage_rule_sets /
-- ai_governed_prompts record each new version, but nothing ties the two together: no record says "this rule changed BECAUSE of that
-- incident, here is what was assessed and tested, and the Chief Medical Officer (not the author) approved it". Both incident tables
-- have 0 rows, so the loop has never been exercised.
--
-- What this adds. public.clinical_change_requests: one row per proposed change to a governed clinical object (triage rule set,
-- protocol, AI prompt, AI system setting, education content, knowledge source, symptom knowledge base, other), naming the object and
-- the from / to versions, the trigger (an incident, an audit finding, a scheduled review), an impact assessment and a test plan.
-- Shaped like a predetermined change control plan: what changes, who is affected, how it was tested, who approved.
--
-- Rules, all in the database so no screen can bypass them:
--   * rows are written only by three functions (propose, decide, mark applied); no client can insert, update or delete;
--   * only the Chief Medical Officer decides, and never on a change they proposed themselves (separation of duties, a CHECK as well
--     as a check in the function);
--   * a trigger incident is required for trigger kinds that name one, so "caused by an incident" cannot be claimed with no incident;
--   * the states only move forward: proposed -> approved | rejected, approved -> applied. Rejected and applied rows are final;
--   * every step writes the audit log.
-- This records and gates a decision. It does not itself change any rule set, prompt or protocol: those are still signed through their
-- own screens (CMO sign-off hub). Nothing here approves, signs or seeds anything on anyone's behalf.
--
-- Count first: no existing rows are touched (new table). ROLLBACK: drop the three functions, then drop table public.clinical_change_requests.

create table public.clinical_change_requests (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  object_type             text not null check (object_type in (
    'triage_rule_set', 'protocol', 'ai_prompt', 'ai_system', 'education_content', 'knowledge_source', 'symptom_knowledge_base', 'other'
  )),
  object_ref              text not null check (btrim(object_ref) <> ''),
  from_version            text,
  to_version              text,
  trigger_kind            text not null check (trigger_kind in ('clinical_incident', 'ai_safety_incident', 'audit_finding', 'scheduled_review', 'other')),
  clinical_incident_id    uuid references public.clinical_incident_reports (id) on delete restrict,
  ai_incident_id          uuid references public.ai_safety_incidents (id) on delete restrict,
  summary                 text not null check (char_length(btrim(summary)) between 10 and 2000),
  impact_assessment       text not null check (char_length(btrim(impact_assessment)) between 10 and 4000),
  test_plan               text not null check (char_length(btrim(test_plan)) between 10 and 4000),
  status                  text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'applied')),
  requested_by            uuid not null references public.profiles (id) on delete restrict,
  requested_at            timestamptz not null default now(),
  decided_by              uuid references public.profiles (id) on delete restrict,
  decided_at              timestamptz,
  decision_note           text,
  applied_by              uuid references public.profiles (id) on delete restrict,
  applied_at              timestamptz,
  applied_note            text,
  is_test                 boolean not null default false,
  created_at              timestamptz not null default now(),

  constraint clinical_change_requests_incident_named check (
    (trigger_kind <> 'clinical_incident' or clinical_incident_id is not null)
    and (trigger_kind <> 'ai_safety_incident' or ai_incident_id is not null)
  ),
  constraint clinical_change_requests_decision_complete check (
    (status = 'proposed' and decided_by is null and decided_at is null)
    or (status in ('approved', 'rejected', 'applied') and decided_by is not null and decided_at is not null)
  ),
  constraint clinical_change_requests_applied_complete check (
    (status = 'applied' and applied_by is not null and applied_at is not null)
    or (status <> 'applied' and applied_by is null and applied_at is null)
  ),
  -- separation of duties: the person who proposed a change is never the person who decides it
  constraint clinical_change_requests_decider_not_requester check (decided_by is null or decided_by <> requested_by),
  constraint clinical_change_requests_rejection_needs_reason check (status <> 'rejected' or char_length(btrim(coalesce(decision_note, ''))) >= 5)
);

create index clinical_change_requests_status_idx on public.clinical_change_requests (organisation_id, status, requested_at desc);
create index clinical_change_requests_object_idx on public.clinical_change_requests (object_type, object_ref);

alter table public.clinical_change_requests enable row level security;

-- Readable by the Chief Medical Officer, an admin, and the person who proposed it. Nobody writes the table directly.
create policy clinical_change_requests_read on public.clinical_change_requests
  for select to authenticated
  using (
    organisation_id = (select private.current_org_id())
    and (private.is_cmo_user((select auth.uid())) or private.is_admin() or requested_by = (select auth.uid()))
  );

revoke all on public.clinical_change_requests from public, anon, authenticated;
grant select on public.clinical_change_requests to authenticated;

comment on table public.clinical_change_requests is
  'Change control for governed clinical objects (audit G-12). Written only by propose_clinical_change, decide_clinical_change and mark_clinical_change_applied. The CMO decides and never on their own proposal. Records the decision; it does not itself change a rule set, prompt or protocol.';

-- ---------------------------------------------------------------------------
-- A row only moves forward, and its identity and reasons never change
-- ---------------------------------------------------------------------------
create function private.clinical_change_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a change request is never deleted' using errcode = '55000';
  end if;
  if new.organisation_id is distinct from old.organisation_id or new.object_type is distinct from old.object_type
     or new.object_ref is distinct from old.object_ref or new.from_version is distinct from old.from_version
     or new.to_version is distinct from old.to_version or new.trigger_kind is distinct from old.trigger_kind
     or new.clinical_incident_id is distinct from old.clinical_incident_id or new.ai_incident_id is distinct from old.ai_incident_id
     or new.summary is distinct from old.summary or new.impact_assessment is distinct from old.impact_assessment
     or new.test_plan is distinct from old.test_plan or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at then
    raise exception 'what was proposed cannot be edited after it is proposed' using errcode = '55000';
  end if;
  if not ((old.status = 'proposed' and new.status in ('approved', 'rejected'))
       or (old.status = 'approved' and new.status = 'applied')
       or (old.status = new.status and old.status = 'proposed')) then
    raise exception 'a change request cannot go from % to %', old.status, new.status using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger clinical_change_requests_guard
  before update or delete on public.clinical_change_requests
  for each row execute function private.clinical_change_requests_guard();

-- ---------------------------------------------------------------------------
-- Propose: an active clinician or an admin
-- ---------------------------------------------------------------------------
create function public.propose_clinical_change(
  p_object_type text,
  p_object_ref text,
  p_from_version text,
  p_to_version text,
  p_trigger_kind text,
  p_clinical_incident uuid,
  p_ai_incident uuid,
  p_summary text,
  p_impact_assessment text,
  p_test_plan text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (private.is_admin() or exists (select 1 from public.clinical_staff s where s.profile_id = v_uid and s.active and s.status = 'active')) then
    raise exception 'only an active clinician or an admin may propose a clinical change' using errcode = '42501';
  end if;
  select p.organisation_id, coalesce(p.is_test, false) into v_org, v_test from public.profiles p where p.id = v_uid;
  if v_org is null then raise exception 'no organisation' using errcode = '22023'; end if;

  -- An incident that is named must belong to the same organisation; a change cannot cite another organisation's incident.
  if p_clinical_incident is not null and not exists (select 1 from public.clinical_incident_reports r where r.id = p_clinical_incident and r.organisation_id = v_org) then
    raise exception 'that clinical incident was not found' using errcode = '22023';
  end if;
  if p_ai_incident is not null and not exists (select 1 from public.ai_safety_incidents i where i.id = p_ai_incident and i.organisation_id = v_org) then
    raise exception 'that AI safety incident was not found' using errcode = '22023';
  end if;

  insert into public.clinical_change_requests (
    organisation_id, object_type, object_ref, from_version, to_version, trigger_kind, clinical_incident_id, ai_incident_id,
    summary, impact_assessment, test_plan, requested_by, is_test
  ) values (
    v_org, p_object_type, btrim(p_object_ref), nullif(btrim(p_from_version), ''), nullif(btrim(p_to_version), ''), p_trigger_kind,
    p_clinical_incident, p_ai_incident, btrim(p_summary), btrim(p_impact_assessment), btrim(p_test_plan), v_uid, v_test
  ) returning id into v_id;

  perform private.log_audit('clinical_change.proposed', 'clinical_change_requests', v_id,
    jsonb_build_object('object_type', p_object_type, 'object_ref', btrim(p_object_ref), 'trigger_kind', p_trigger_kind));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Decide: the Chief Medical Officer, never on their own proposal
-- ---------------------------------------------------------------------------
create function public.decide_clinical_change(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.clinical_change_requests%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not private.is_cmo_user(v_uid) then
    raise exception 'only the Chief Medical Officer may decide a clinical change' using errcode = '42501';
  end if;
  select * into r from public.clinical_change_requests where id = p_id for update;
  if not found or r.organisation_id is distinct from (select private.current_org_id()) then
    raise exception 'that change request was not found' using errcode = '22023';
  end if;
  if r.requested_by = v_uid then
    raise exception 'separation of duties: you proposed this change, so someone else must decide it' using errcode = '42501';
  end if;
  if r.status <> 'proposed' then
    raise exception 'this change request has already been decided (%)', r.status using errcode = '55000';
  end if;
  if p_approve is not true and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'a rejection needs a reason' using errcode = '22023';
  end if;

  update public.clinical_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  perform private.log_audit(case when p_approve then 'clinical_change.approved' else 'clinical_change.rejected' end,
    'clinical_change_requests', p_id, jsonb_build_object('object_type', r.object_type, 'object_ref', r.object_ref));
end;
$$;

-- ---------------------------------------------------------------------------
-- Mark applied: records that the approved change was actually put into effect (the rule set, prompt or protocol itself is signed elsewhere)
-- ---------------------------------------------------------------------------
create function public.mark_clinical_change_applied(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.clinical_change_requests%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not (private.is_cmo_user(v_uid) or private.is_admin()) then
    raise exception 'only the Chief Medical Officer or an admin may mark a change applied' using errcode = '42501';
  end if;
  select * into r from public.clinical_change_requests where id = p_id for update;
  if not found or r.organisation_id is distinct from (select private.current_org_id()) then
    raise exception 'that change request was not found' using errcode = '22023';
  end if;
  if r.status <> 'approved' then
    raise exception 'only an approved change can be marked applied (this one is %)', r.status using errcode = '55000';
  end if;

  update public.clinical_change_requests
     set status = 'applied', applied_by = v_uid, applied_at = now(), applied_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  perform private.log_audit('clinical_change.applied', 'clinical_change_requests', p_id,
    jsonb_build_object('object_type', r.object_type, 'object_ref', r.object_ref));
end;
$$;

-- anon inherits EXECUTE through PUBLIC, so revoke from PUBLIC (CLAUDE.md: re-check live with has_function_privilege)
revoke all on function public.propose_clinical_change(text, text, text, text, text, uuid, uuid, text, text, text) from public, anon;
revoke all on function public.decide_clinical_change(uuid, boolean, text) from public, anon;
revoke all on function public.mark_clinical_change_applied(uuid, text) from public, anon;
grant execute on function public.propose_clinical_change(text, text, text, text, text, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.decide_clinical_change(uuid, boolean, text) to authenticated;
grant execute on function public.mark_clinical_change_applied(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.decide_clinical_change(uuid, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.propose_clinical_change(text, text, text, text, text, uuid, uuid, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_clinical_change_applied(uuid, text)', 'EXECUTE') then
    raise exception 'a clinical change function is callable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_change_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_change_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_change_requests', 'DELETE')
     or has_table_privilege('anon', 'public.clinical_change_requests', 'SELECT') then
    raise exception 'clinical_change_requests is writable by a client role or readable by anon';
  end if;
end $$;
