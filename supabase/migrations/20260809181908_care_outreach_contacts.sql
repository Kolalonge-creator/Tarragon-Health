-- Care Coordinator outreach contact log.
--
-- The Care Coordinator portal design (Claude Design handoff, "Tarragon Health
-- Care Coordinator Portal") mocked up a "Messages" tab as a live, coordinator-
-- authored two-way WhatsApp chat. That's the exact pattern CLAUDE.md retired
-- 2026-07-30: two-way patient<->care-team conversation is in-app only, never
-- WhatsApp (a patient-trust gap, not a technical limitation) — see
-- care_messages/care_message_threads for the real in-app channel. Building a
-- coordinator-initiated live WhatsApp send would reopen that exact gap.
--
-- What a coordinator actually needs here is unchanged from the mock's intent:
-- a record of "I called/WhatsApp'd this patient, here's what happened" so the
-- next coordinator (or the same one, next week) isn't re-deriving outreach
-- history from memory. So this is a log, not a chat: append-only rows, no
-- live send, no inbound-reply capture. It complements care_outreach_tasks
-- (one row per open trigger, its outcome_note overwritten on each update) by
-- keeping every individual contact attempt, not just the latest one.
--
-- Row count checked first: care_outreach_tasks has rows in prod already (the
-- nightly queue_care_outreach engine), but this is a brand new table with
-- nothing to backfill.

create type public.outreach_contact_channel as enum ('call', 'whatsapp');

create table public.care_outreach_contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  -- Optional: which open worklist item this contact was about, if any. A
  -- coordinator may also log a general check-in with no open task.
  task_id          uuid references public.care_outreach_tasks (id) on delete set null,
  channel          public.outreach_contact_channel not null,
  note             text not null check (length(btrim(note)) > 0),
  -- Server-stamped below — never client-supplied, same reasoning as
  -- care_outreach_tasks.resolved_by: this is an attribution log, not a
  -- clinical-review claim, but it still must be tamper-proof.
  contacted_by     uuid not null references public.profiles (id) on delete restrict,
  contacted_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index care_outreach_contacts_patient_idx
  on public.care_outreach_contacts (patient_id, contacted_at desc);
create index care_outreach_contacts_org_recent_idx
  on public.care_outreach_contacts (organisation_id, contacted_at desc);
create index care_outreach_contacts_task_idx
  on public.care_outreach_contacts (task_id)
  where task_id is not null;

create or replace function private.stamp_outreach_contact_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.contacted_by := (select auth.uid());
  return new;
end;
$$;

create trigger care_outreach_contacts_stamp_author
  before insert on public.care_outreach_contacts
  for each row execute function private.stamp_outreach_contact_author();

alter table public.care_outreach_contacts enable row level security;

-- Same staff-only shape as care_outreach_tasks. Deliberately no update/update
-- or delete policy: this is an append-only log, not an editable note — a
-- correction is a new row, so the history of what was actually said/done
-- never quietly changes under a reader who already saw it.
create policy care_outreach_contacts_select on public.care_outreach_contacts
  for select to authenticated
  using (private.is_org_staff(organisation_id));
create policy care_outreach_contacts_insert on public.care_outreach_contacts
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

grant select, insert on public.care_outreach_contacts to authenticated;
-- Default privileges grant ALL on a freshly created table (the root-cause fix
-- documented in CLAUDE.md), which would otherwise leave UPDATE/DELETE
-- reachable even with no policy admitting them. RLS already blocks both (no
-- update/delete policy exists), but revoke the grant too so intent and
-- reality read the same way, not "safe by omission."
revoke update, delete on public.care_outreach_contacts from authenticated;

do $$
declare
  v_select_def text;
  v_insert_def text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'care_outreach_contacts'
  ) then
    raise exception 'care_outreach_contacts was not created';
  end if;

  if not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'care_outreach_contacts'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'authenticated is missing SELECT on care_outreach_contacts';
  end if;
  if not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'care_outreach_contacts'
      and grantee = 'authenticated' and privilege_type = 'INSERT'
  ) then
    raise exception 'authenticated is missing INSERT on care_outreach_contacts';
  end if;
  -- No UPDATE/DELETE grant expected — the log is append-only by design.
  if exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'care_outreach_contacts'
      and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'care_outreach_contacts should not be updatable/deletable by authenticated';
  end if;

  select pg_get_expr(polqual, polrelid) into v_select_def
  from pg_policy where polname = 'care_outreach_contacts_select';
  if v_select_def not like '%is_org_staff%' then
    raise exception 'care_outreach_contacts_select does not gate on is_org_staff';
  end if;

  select pg_get_expr(polwithcheck, polrelid) into v_insert_def
  from pg_policy where polname = 'care_outreach_contacts_insert';
  if v_insert_def not like '%is_org_staff%' then
    raise exception 'care_outreach_contacts_insert does not gate on is_org_staff';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'care_outreach_contacts_stamp_author'
  ) then
    raise exception 'contacted_by is not server-stamped';
  end if;
end;
$$;
