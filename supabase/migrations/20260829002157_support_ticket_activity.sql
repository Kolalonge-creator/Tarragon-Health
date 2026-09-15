-- Tarragon Health — Patient Support & Service Centre, part 4/8: comments + status history.
--
-- Threaded, append-only replies on a ticket (same shape as care_messages,
-- 20260719110000: server-derived author identity, no client-settable
-- author_role, no UPDATE/DELETE policy). is_internal marks a staff-only
-- note (never visible to the patient) vs a real reply. A patient replying
-- to an 'awaiting_patient' ticket moves it back to 'in_progress'
-- automatically (the AFTER INSERT trigger below) — the one status
-- transition a patient may make directly, so
-- private.enforce_support_ticket_write() (part 3) is redefined first to
-- allow exactly that one edge, via CREATE OR REPLACE (same layering
-- convention already used for private.stamp_clinician_alert_lifecycle).
--
-- support_ticket_status_history is a plain audit trail (no client insert
-- path at all, populated only by the AFTER UPDATE trigger — same posture
-- as alert_deliveries) driving the §24.13 "resolution time"/"time in
-- status" analytics.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'support_ticket_comment_author') then
    create type public.support_ticket_comment_author as enum ('patient', 'staff');
  end if;
end $$;

-- Redefine to allow the one patient-initiated status transition described
-- above; everything else is unchanged from part 3.
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

    -- The one status change a patient may make directly: replying to an
    -- 'awaiting_patient' ticket reopens it. Every other status change is
    -- staff-only.
    if new.status is distinct from old.status then
      if not (old.status = 'awaiting_patient' and new.status = 'in_progress') then
        raise exception 'only your care team can change ticket status' using errcode = '42501';
      end if;
    end if;

    if new.category is distinct from old.category
       or new.priority is distinct from old.priority
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
  new.satisfaction_score := old.satisfaction_score;
  new.satisfaction_comment := old.satisfaction_comment;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- support_ticket_comments
-- ---------------------------------------------------------------------------
create table public.support_ticket_comments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  ticket_id         uuid not null references public.support_tickets (id) on delete cascade,
  author_profile_id uuid references public.profiles (id) on delete set null,
  author_role       public.support_ticket_comment_author not null,
  body              text not null check (length(btrim(body)) > 0),
  -- Staff-only note, never shown to the patient. Always false for a
  -- patient-authored comment (enforced by the trigger below).
  is_internal       boolean not null default false,
  created_at        timestamptz not null default now()
);

comment on table public.support_ticket_comments is
  'Threaded, append-only replies on a support ticket. author_role/author_profile_id are server-derived, never client-supplied (same discipline as care_messages). is_internal marks a staff-only note.';

create index support_ticket_comments_ticket_idx
  on public.support_ticket_comments (ticket_id, created_at);

alter table public.support_ticket_comments enable row level security;

create policy support_ticket_comments_select on public.support_ticket_comments
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (
      not is_internal
      and exists (
        select 1 from public.support_tickets t
        where t.id = ticket_id and t.patient_id = (select auth.uid())
      )
    )
  );

create policy support_ticket_comments_insert on public.support_ticket_comments
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.patient_id = (select auth.uid())
    )
  );

-- Append-only: no UPDATE/DELETE policy, same discipline as care_messages/
-- patient_timeline.
grant select, insert on public.support_ticket_comments to authenticated;
revoke update, delete on public.support_ticket_comments from authenticated;

create or replace function private.enforce_support_ticket_comment_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_status public.support_ticket_status;
begin
  select organisation_id, patient_id, status into v_org, v_patient, v_status
    from public.support_tickets where id = new.ticket_id;
  if v_org is null then
    raise exception 'ticket not found';
  end if;
  if v_status = 'closed' then
    raise exception 'this ticket is closed and no longer accepts replies';
  end if;

  if not private.is_org_staff(v_org) and v_uid is distinct from v_patient then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  new.organisation_id := v_org;
  new.author_profile_id := v_uid;
  if private.is_org_staff(v_org) then
    new.author_role := 'staff';
  else
    new.author_role := 'patient';
    new.is_internal := false;
  end if;
  return new;
end;
$$;

create trigger support_ticket_comments_enforce_author
  before insert on public.support_ticket_comments
  for each row execute function private.enforce_support_ticket_comment_author();

-- After a comment lands: a staff (non-internal) reply stamps first_response_at
-- once; a patient reply on an 'awaiting_patient' ticket reopens it.
create or replace function private.after_support_ticket_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_role = 'staff' and not new.is_internal then
    update public.support_tickets
      set first_response_at = coalesce(first_response_at, new.created_at)
      where id = new.ticket_id;
  elsif new.author_role = 'patient' then
    update public.support_tickets
      set status = 'in_progress'
      where id = new.ticket_id and status = 'awaiting_patient';
  end if;
  return new;
end;
$$;

create trigger support_ticket_comments_after_insert
  after insert on public.support_ticket_comments
  for each row execute function private.after_support_ticket_comment_insert();

-- ---------------------------------------------------------------------------
-- support_ticket_status_history — plain audit trail, no client insert path.
-- ---------------------------------------------------------------------------
create table public.support_ticket_status_history (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  ticket_id       uuid not null references public.support_tickets (id) on delete cascade,
  from_status     public.support_ticket_status,
  to_status       public.support_ticket_status not null,
  changed_by      uuid references public.profiles (id) on delete set null,
  note            text,
  created_at      timestamptz not null default now()
);

comment on table public.support_ticket_status_history is
  'Append-only audit trail of every support_tickets.status transition, populated only by the AFTER UPDATE trigger on support_tickets (no client insert path — same posture as alert_deliveries). Drives §24.13 response/resolution-time analytics.';

create index support_ticket_status_history_ticket_idx
  on public.support_ticket_status_history (ticket_id, created_at);

alter table public.support_ticket_status_history enable row level security;

create policy support_ticket_status_history_select on public.support_ticket_status_history
  for select to authenticated
  using (private.is_org_staff(organisation_id));

grant select on public.support_ticket_status_history to authenticated;
revoke insert, update, delete on public.support_ticket_status_history from authenticated;

create or replace function private.log_support_ticket_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.support_ticket_status_history
      (organisation_id, ticket_id, from_status, to_status, changed_by, note)
    values (
      new.organisation_id, new.id, old.status, new.status, (select auth.uid()),
      case when new.status = 'resolved' then new.resolution_note else null end
    );
  end if;
  return new;
end;
$$;

create trigger support_tickets_log_status_change
  after update on public.support_tickets
  for each row execute function private.log_support_ticket_status_change();

revoke all on function private.enforce_support_ticket_comment_author() from public;
revoke all on function private.after_support_ticket_comment_insert() from public;
revoke all on function private.log_support_ticket_status_change() from public;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'support_ticket_comments') then
    raise exception 'support_ticket_comments was not created';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'support_ticket_status_history') then
    raise exception 'support_ticket_status_history was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'support_ticket_comments' and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'support_ticket_comments must be append-only — no UPDATE/DELETE policy';
  end if;
  if has_table_privilege('authenticated', 'public.support_ticket_status_history', 'INSERT') then
    raise exception 'authenticated must not hold INSERT on support_ticket_status_history';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.support_tickets'::regclass
      and tgname = 'support_tickets_log_status_change'
      and not tgisinternal
  ) then
    raise exception 'support_tickets_log_status_change trigger missing';
  end if;
  raise notice 'PASS: support_ticket_comments + support_ticket_status_history in place, append-only, RLS correct';
end $$;
