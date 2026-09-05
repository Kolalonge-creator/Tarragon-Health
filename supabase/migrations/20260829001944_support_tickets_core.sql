-- Tarragon Health — Patient Support & Service Centre, part 3/8: support_tickets core.
--
-- The ticket table + its state machine (§24.4/§24.5). Shape deliberately
-- mirrors clinician_alerts (organisation_id, category/priority/status,
-- assigned_to + assigned_at, resolution fields, closed fields, created_at/
-- updated_at) rather than diverging gratuitously — same "RLS admits
-- broadly, a trigger narrows" idiom used throughout this codebase
-- (clinical_incident_reports, case_review_actions, care_messages).
--
-- State transitions go through advance_support_ticket_status()/
-- assign_support_ticket() below (same "transition RPC, not raw UPDATE"
-- pattern as public.advance_appointment_status), which is the intended
-- write path — but the CHECK constraints on the table are the real
-- backstop, since RLS still permits a raw staff UPDATE. escalated_alert_id
-- (§24.7/24.8's clinical-escalation link) is deliberately NOT added here —
-- it needs its own authority gate (private.can_handle_support_escalation),
-- added in part 5 by redefining the trigger below via CREATE OR REPLACE,
-- the same layering convention already used for
-- private.stamp_clinician_alert_lifecycle / private.handle_abnormal_screening_result.
--
-- No DELETE policy: a filed ticket is retained, same discipline as
-- clinical_incident_reports/data_breach_incidents.

create table public.support_tickets (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,

  category          public.support_ticket_category not null,
  priority          public.support_ticket_priority not null default 'normal',
  status            public.support_ticket_status not null default 'new',
  channel           public.support_ticket_channel not null default 'in_app',

  subject           text not null check (length(btrim(subject)) > 0),
  description       text not null check (length(btrim(description)) > 0),

  created_by        uuid references public.profiles (id) on delete set null,

  assigned_to       uuid references public.profiles (id) on delete set null,
  assigned_at       timestamptz,

  -- Stamped when the first staff reply lands on the ticket (part 4's
  -- comments trigger) — the §24.13 "response time" metric.
  first_response_at timestamptz,

  -- Technical escalation ladder (§24.9): 1 = Tier 1 support, 2 = Tier 2,
  -- 3 = Engineering. Meaningless outside category = 'technical'.
  technical_tier    smallint not null default 1 check (technical_tier between 1 and 3),

  resolution_note   text,
  resolved_by       uuid references public.profiles (id) on delete set null,
  resolved_at       timestamptz,

  closed_by         uuid references public.profiles (id) on delete set null,
  closed_at         timestamptz,

  -- Post-resolution patient CSAT (§24.13's "satisfaction" metric). Left once,
  -- by the patient, only after the ticket is resolved/closed.
  satisfaction_score   smallint check (satisfaction_score between 1 and 5),
  satisfaction_comment text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint support_tickets_technical_tier_only_for_technical check (
    category = 'technical' or technical_tier = 1
  ),
  constraint support_tickets_resolution_requires_note check (
    status not in ('resolved', 'closed')
    or (resolution_note is not null and length(btrim(resolution_note)) > 0)
  ),
  constraint support_tickets_resolved_requires_stamp check (
    status not in ('resolved', 'closed')
    or (resolved_by is not null and resolved_at is not null)
  ),
  constraint support_tickets_closed_requires_stamp check (
    status <> 'closed' or (closed_by is not null and closed_at is not null)
  ),
  constraint support_tickets_satisfaction_requires_resolved check (
    satisfaction_score is null or status in ('resolved', 'closed')
  )
);

comment on table public.support_tickets is
  'Patient Support & Service Centre ticketing (spec §24). One row per support request, categorised (§24.2), prioritised (§24.6), and carried through the §24.5 New->Assigned->In progress->Awaiting patient->Resolved->Closed lifecycle via advance_support_ticket_status(). A ticket that reads as a real medical emergency never reaches this table at all — the app-layer intake flow routes it into emergency_events instead (see the support_ticket_intake emergency_source value).';

create index support_tickets_patient_idx
  on public.support_tickets (patient_id, created_at desc);
create index support_tickets_org_status_idx
  on public.support_tickets (organisation_id, status, priority desc, created_at desc);
create index support_tickets_assigned_idx
  on public.support_tickets (assigned_to) where assigned_to is not null;
create index support_tickets_open_idx
  on public.support_tickets (organisation_id, created_at)
  where status not in ('resolved', 'closed');

alter table public.support_tickets enable row level security;

create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.support_tickets to authenticated;
revoke delete on public.support_tickets from authenticated;

create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function private.set_updated_at();

create or replace function private.enforce_support_ticket_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_is_staff boolean;
begin
  if tg_op = 'INSERT' then
    -- Never trust a client-supplied organisation_id — resolve it from the
    -- patient's own profile so a ticket can't be filed into an org the
    -- patient doesn't belong to.
    select organisation_id into v_org from public.profiles where id = new.patient_id;
    if v_org is null then
      raise exception 'patient has no organisation on file';
    end if;
    new.organisation_id := v_org;

    if not private.is_org_staff(v_org) and new.patient_id is distinct from v_uid then
      raise exception 'not authorised to file a ticket for this patient' using errcode = '42501';
    end if;

    new.created_by := v_uid;
    new.status := 'new';
    new.assigned_to := null;
    new.assigned_at := null;
    new.first_response_at := null;
    new.resolution_note := null;
    new.resolved_by := null;
    new.resolved_at := null;
    new.closed_by := null;
    new.closed_at := null;
    new.satisfaction_score := null;
    new.satisfaction_comment := null;
    if new.category <> 'technical' then
      new.technical_tier := 1;
    end if;
    return new;
  end if;

  -- UPDATE
  v_org := old.organisation_id;
  v_is_staff := private.is_org_staff(v_org);

  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if not v_is_staff then
    if old.patient_id is distinct from v_uid then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    if new.category is distinct from old.category
       or new.priority is distinct from old.priority
       or new.status is distinct from old.status
       or new.channel is distinct from old.channel
       or new.subject is distinct from old.subject
       or new.description is distinct from old.description
       or new.assigned_to is distinct from old.assigned_to
       or new.assigned_at is distinct from old.assigned_at
       or new.technical_tier is distinct from old.technical_tier
       or new.resolution_note is distinct from old.resolution_note
       or new.resolved_by is distinct from old.resolved_by
       or new.resolved_at is distinct from old.resolved_at
       or new.closed_by is distinct from old.closed_by
       or new.closed_at is distinct from old.closed_at
    then
      raise exception 'only your care team can change ticket routing/status fields' using errcode = '42501';
    end if;

    if new.satisfaction_score is distinct from old.satisfaction_score
       or new.satisfaction_comment is distinct from old.satisfaction_comment then
      if old.status not in ('resolved', 'closed') then
        raise exception 'a satisfaction rating can only be left once the ticket is resolved or closed';
      end if;
      if old.satisfaction_score is not null then
        raise exception 'a satisfaction rating has already been recorded for this ticket';
      end if;
    end if;

    return new;
  end if;

  -- Org staff: prefer advance_support_ticket_status()/assign_support_ticket()
  -- (attribution stamped there), but still stamp forged/omitted attribution
  -- here as a backstop against a raw UPDATE.
  if new.status is distinct from old.status then
    if new.status in ('resolved', 'closed') and new.resolved_by is null then
      new.resolved_by := v_uid;
      new.resolved_at := coalesce(new.resolved_at, now());
    end if;
    if new.status = 'closed' and new.closed_by is null then
      new.closed_by := v_uid;
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_at is not distinct from old.assigned_at then
    new.assigned_at := case when new.assigned_to is not null then now() else null end;
  end if;
  if new.category <> 'technical' then
    new.technical_tier := 1;
  end if;
  -- satisfaction_score/comment are patient-only fields even for staff.
  new.satisfaction_score := old.satisfaction_score;
  new.satisfaction_comment := old.satisfaction_comment;

  return new;
end;
$$;

revoke all on function private.enforce_support_ticket_write() from public;

create trigger support_tickets_enforce_write
  before insert or update on public.support_tickets
  for each row execute function private.enforce_support_ticket_write();

-- Transition RPC (§24.5's exact six-state pipeline). SECURITY DEFINER so
-- attribution can be stamped consistently regardless of caller privileges;
-- authority is still explicitly checked inline (is_org_staff), same shape
-- as public.advance_appointment_status.
create or replace function public.advance_support_ticket_status(
  p_ticket_id uuid,
  p_to public.support_ticket_status,
  p_note text default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets;
  v_valid boolean := false;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket not found';
  end if;
  if not private.is_org_staff(v_ticket.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_ticket.status = 'closed' then
    raise exception 'this ticket is closed — file a new one if the issue continues';
  end if;

  if p_to = 'assigned' then
    v_valid := v_ticket.status = 'new';
  elsif p_to = 'in_progress' then
    v_valid := v_ticket.status in ('new', 'assigned', 'awaiting_patient', 'resolved');
  elsif p_to = 'awaiting_patient' then
    v_valid := v_ticket.status in ('assigned', 'in_progress');
  elsif p_to = 'resolved' then
    v_valid := v_ticket.status in ('assigned', 'in_progress', 'awaiting_patient');
    if v_valid and (p_note is null or length(btrim(p_note)) = 0) then
      raise exception 'resolving a ticket needs a resolution note';
    end if;
  elsif p_to = 'closed' then
    v_valid := v_ticket.status = 'resolved';
  else
    raise exception 'unsupported target status: %', p_to;
  end if;

  if not v_valid then
    raise exception 'cannot move ticket from % to %', v_ticket.status, p_to;
  end if;

  update public.support_tickets set
    status = p_to,
    resolution_note = case when p_to = 'resolved' then p_note else resolution_note end,
    resolved_by = case when p_to = 'resolved' then (select auth.uid()) else resolved_by end,
    resolved_at = case when p_to = 'resolved' then now() else resolved_at end,
    closed_by = case when p_to = 'closed' then (select auth.uid()) else closed_by end,
    closed_at = case when p_to = 'closed' then now() else closed_at end
  where id = p_ticket_id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

comment on function public.advance_support_ticket_status(uuid, public.support_ticket_status, text) is
  'The §24.5 ticket state-machine transition RPC. Validates the specific from/to move is legal, requires a resolution note when moving to resolved, and stamps resolved_by/at, closed_by/at server-side. Preferred over a raw UPDATE (RLS still permits one; the table''s own CHECK constraints are the backstop).';

revoke execute on function public.advance_support_ticket_status(uuid, public.support_ticket_status, text) from public, anon;
grant execute on function public.advance_support_ticket_status(uuid, public.support_ticket_status, text) to authenticated;

-- Assignment RPC — sets/clears assigned_to, and auto-advances a brand-new
-- ticket to 'assigned' the same way a human worklist would.
create or replace function public.assign_support_ticket(
  p_ticket_id uuid,
  p_assignee_id uuid
)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket not found';
  end if;
  if not private.is_org_staff(v_ticket.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_ticket.status = 'closed' then
    raise exception 'this ticket is closed — file a new one if the issue continues';
  end if;

  if p_assignee_id is not null and not exists (
    select 1 from public.profiles
    where id = p_assignee_id
      and role <> 'patient'
      and (role = 'admin' or organisation_id = v_ticket.organisation_id)
  ) then
    raise exception 'assignee is not a member of this organisation''s staff';
  end if;

  update public.support_tickets set
    assigned_to = p_assignee_id,
    assigned_at = case when p_assignee_id is not null then now() else null end,
    status = case when p_assignee_id is not null and status = 'new' then 'assigned' else status end
  where id = p_ticket_id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

comment on function public.assign_support_ticket(uuid, uuid) is
  'Assigns (or unassigns, with a null assignee) a ticket to an org-staff member. Auto-advances a brand-new ticket to ''assigned'' — the same "assigning it is what moves it off New" behaviour a human worklist would have.';

revoke execute on function public.assign_support_ticket(uuid, uuid) from public, anon;
grant execute on function public.assign_support_ticket(uuid, uuid) to authenticated;

-- Technical escalation ladder (§24.9): Tier 1 support -> Tier 2 -> Engineering.
create or replace function public.bump_support_ticket_technical_tier(p_ticket_id uuid)
returns public.support_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.support_tickets;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if v_ticket.id is null then
    raise exception 'ticket not found';
  end if;
  if not private.is_org_staff(v_ticket.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_ticket.category <> 'technical' then
    raise exception 'only a technical-category ticket has a technical escalation tier';
  end if;
  if v_ticket.technical_tier >= 3 then
    raise exception 'this ticket is already at the top of the technical escalation ladder (Engineering)';
  end if;

  update public.support_tickets set technical_tier = technical_tier + 1
  where id = p_ticket_id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

comment on function public.bump_support_ticket_technical_tier(uuid) is
  '§24.9''s technical escalation ladder: 1 = Tier 1 support, 2 = Tier 2, 3 = Engineering. One-way — matches the spec''s "Patient issue -> Tier 1 -> Tier 2 -> Engineering" flow.';

revoke execute on function public.bump_support_ticket_technical_tier(uuid) from public, anon;
grant execute on function public.bump_support_ticket_technical_tier(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'support_tickets') then
    raise exception 'support_tickets was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_tickets' and cmd = 'DELETE'
  ) then
    raise exception 'support_tickets must have no DELETE policy — a filed ticket is retained';
  end if;
  if has_table_privilege('authenticated', 'public.support_tickets', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on support_tickets';
  end if;
  if not has_table_privilege('authenticated', 'public.support_tickets', 'INSERT') then
    raise exception 'authenticated lacks INSERT on support_tickets';
  end if;
  if has_function_privilege('anon', 'public.advance_support_ticket_status(uuid, public.support_ticket_status, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute advance_support_ticket_status';
  end if;
  if has_function_privilege('anon', 'public.assign_support_ticket(uuid, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute assign_support_ticket';
  end if;
  if has_function_privilege('anon', 'public.bump_support_ticket_technical_tier(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute bump_support_ticket_technical_tier';
  end if;
  raise notice 'PASS: support_tickets table + RLS + lifecycle trigger + transition RPCs in place, anon denied';
end $$;
