-- Tarragon Health — Alert System infrastructure, part 6/6: snooze creates a
-- real future task (8.10's "snoozing must require an appropriate reason and
-- create a future task" -- the reason side was already enforced by part
-- 2b's clinician_alerts_snooze_requires_reason CHECK; this is the task
-- side).
--
-- Mirrors care_outreach_tasks (20260723010019) rather than reusing it
-- directly: that table's own status enum (open/in_progress/contacted/
-- resolved/dismissed) and unique-active-per-(patient,trigger_type) index
-- carry outreach-specific semantics ("has a coordinator contacted this
-- patient") that don't fit "come back and look at this alert again on this
-- date" -- a new, narrower, purpose-fit status enum avoids stretching
-- borrowed semantics to cover a different concept.

create type public.alert_follow_up_status as enum ('open', 'done', 'dismissed');

create table public.alert_follow_up_tasks (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  clinician_alert_id  uuid not null references public.clinician_alerts (id) on delete cascade,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  due_at              timestamptz not null,
  reason              text not null,
  status              public.alert_follow_up_status not null default 'open',
  created_by          uuid references public.clinical_staff (id) on delete restrict,
  resolved_by         uuid references public.clinical_staff (id) on delete restrict,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.alert_follow_up_tasks is
  'The future task a snooze (8.10) is required to create. One row per snooze; due_at mirrors clinician_alerts.snoozed_until at creation time but is independent afterward so re-snoozing does not retroactively rewrite a task someone may already be tracking.';

create index alert_follow_up_tasks_org_status_idx
  on public.alert_follow_up_tasks (organisation_id, status, due_at);
create index alert_follow_up_tasks_alert_idx
  on public.alert_follow_up_tasks (clinician_alert_id);

create trigger alert_follow_up_tasks_set_updated_at
  before update on public.alert_follow_up_tasks
  for each row execute function private.set_updated_at();

alter table public.alert_follow_up_tasks enable row level security;

create policy alert_follow_up_tasks_select on public.alert_follow_up_tasks
  for select to authenticated using (private.is_org_staff(organisation_id));

create policy alert_follow_up_tasks_update on public.alert_follow_up_tasks
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, update on public.alert_follow_up_tasks to authenticated;

create or replace function private.stamp_alert_follow_up_resolution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status in ('done', 'dismissed') and old.status = 'open' then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.resolved_by := v_staff_id;
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif old.status in ('done', 'dismissed') then
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger alert_follow_up_tasks_stamp_resolution
  before update on public.alert_follow_up_tasks
  for each row execute function private.stamp_alert_follow_up_resolution();

create or replace function private.stamp_clinician_alert_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  if new.status = 'acknowledged' and old.status <> 'acknowledged'
     and new.responsible_clinician_id is null and v_staff_id is not null then
    new.responsible_clinician_id := v_staff_id;
    new.assigned_at := coalesce(new.assigned_at, now());
  end if;

  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_by := v_staff_id;
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif old.status in ('resolved', 'closed') then
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  end if;

  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_by := v_staff_id;
    new.closed_at := coalesce(new.closed_at, now());
  elsif old.status = 'closed' then
    new.closed_by := old.closed_by;
    new.closed_at := old.closed_at;
  end if;

  if new.snoozed_until is distinct from old.snoozed_until then
    if new.snoozed_until is not null and old.status in ('resolved', 'closed') then
      raise exception 'Cannot snooze a resolved or closed alert' using errcode = '23514';
    end if;

    if new.snoozed_until is not null then
      new.snoozed_by := v_staff_id;
      new.status := 'snoozed';

      insert into public.alert_follow_up_tasks
        (organisation_id, clinician_alert_id, patient_id, due_at, reason, created_by)
      values
        (new.organisation_id, new.id, new.patient_id, new.snoozed_until, new.snooze_reason, v_staff_id);
    else
      new.snoozed_by := null;
      new.snooze_reason := null;
      if old.status = 'snoozed' then
        new.status := 'open';
      end if;
    end if;
  elsif old.snoozed_until is not null then
    new.snoozed_by := old.snoozed_by;
  end if;

  return new;
end;
$$;

comment on function private.stamp_clinician_alert_lifecycle() is
  'BEFORE UPDATE on clinician_alerts. Server-derives responsible_clinician_id (self-assign on first acknowledge if unowned), resolved_by/resolved_at, closed_by/closed_at, and snoozed_by from the caller''s own active clinical_staff record -- never client-supplied, never re-stamped by a later unrelated edit. Snoozing also creates a real alert_follow_up_tasks row (8.10). Un-snoozing (snoozed_until cleared) returns status to ''open'' unconditionally rather than restoring a remembered pre-snooze status, a deliberate simplification: the clinician re-acknowledges if needed.';

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='alert_follow_up_tasks') then
    raise exception 'alert_follow_up_tasks was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'clinician_alerts_stamp_lifecycle'
      and tgrelid = 'public.clinician_alerts'::regclass and not tgisinternal
  ) then
    raise exception 'clinician_alerts_stamp_lifecycle trigger is missing after redefinition';
  end if;
  raise notice 'PASS: alert_follow_up_tasks in place, snooze->task wiring installed on the existing lifecycle trigger';
end $$;
