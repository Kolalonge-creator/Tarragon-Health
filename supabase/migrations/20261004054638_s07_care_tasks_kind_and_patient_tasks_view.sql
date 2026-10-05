-- S07: care_tasks gains `kind` and `source_event_id`, and public.patient_tasks
-- exposes the patient's own tasks under the v5 name (decision OQ-65, founder
-- 2026-10-03: a view over care_tasks, no second task table).
--
-- Why a view and not a table: care_tasks already carries the RLS, the patient's
-- constrained completion RPC (complete_care_task), the escalation ladder and
-- the recurrence roll. A parallel patient_tasks table would be a second task
-- store that staff, recurrence and escalation never see. Same pattern S05 used
-- for observations, dose_events and the other v5 names.
--
-- Live state checked 2026-10-04 on koiplnmbgnqnbywhpjlf before writing this:
--   * care_tasks holds 0 rows (0 recurring), so there is no data conversion and
--     no existing row changes meaning; both new columns are nullable.
--   * no object named patient_tasks exists.
--   * the live private.roll_recurring_care_task() body matches
--     20260828222447_care_tasks.sql and omits `kind` from its INSERT.
--   * policies, grants and triggers on care_tasks match the original migration.
--   * no live migration newer than 20261002205313 (S06) was unrecognised.
--
-- Three changes:
--   1. kind (text, CHECK on the five v5 values, null allowed) and source_event_id
--      (uuid, no foreign key: the event table it will point at does not exist yet).
--   2. private.roll_recurring_care_task() is replaced so the next occurrence of a
--      recurring task copies `kind`. Without this a recurring "log blood pressure"
--      task would lose its kind after its first occurrence and silently drop off
--      the Today list (found in the S07 design review). source_event_id is NOT
--      copied: the next occurrence is a new occurrence, not the same event.
--   3. public.patient_tasks, security_invoker, limited to the caller's own rows AND
--      to tasks the patient owns (owner_role = 'patient'). A care-team-owned task
--      about her (for example a result review) stays readable on care_tasks as
--      today but is never put on the patient's Today list, because its title could
--      reveal an unreleased result (INV-03). A staff account reading the view sees
--      none of the org's tasks (it does not widen the staff-wide read care_tasks
--      already has; staff keep using the table). Read-only: authenticated gets
--      SELECT only. take_medicine is never stored here: S08 computes pending dose
--      slots (OQ-56).
--
-- Known follow-up (not changed here): the only producer of care_tasks rows is the
-- programme seeding function (20260828222526), which copies default_tasks JSON
-- and does not set kind, so seeded tasks keep kind null until the seeding function
-- and the programme templates carry a kind. The Today list needs that first.
--
-- No RLS policy, grant on care_tasks, or other trigger changes.

alter table public.care_tasks
  add column if not exists kind text,
  add column if not exists source_event_id uuid;

alter table public.care_tasks drop constraint if exists care_tasks_kind_check;
alter table public.care_tasks
  add constraint care_tasks_kind_check
  check (kind is null or kind in ('log_bp', 'take_medicine', 'book_test', 'join_consultation', 'read_lesson'));

comment on column public.care_tasks.kind is
  'v5 task kind (log_bp, take_medicine, book_test, join_consultation, read_lesson). Null for tasks created before S07 or with no v5 equivalent.';
comment on column public.care_tasks.source_event_id is
  'The domain event that produced this task, when there is one. Not a foreign key yet.';

-- Same body as the live function plus `kind` in the column list and values.
create or replace function private.roll_recurring_care_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next_due timestamptz;
  v_interval interval;
begin
  if new.recurrence is null then
    return new;
  end if;

  v_interval := case new.recurrence
    when 'daily' then interval '1 day'
    when 'weekly' then interval '1 week'
    when 'monthly' then interval '1 month'
  end;
  v_next_due := coalesce(new.due_at, now()) + v_interval;

  insert into public.care_tasks (
    organisation_id, patient_id, care_plan_id, goal_id, title, description,
    owner_role, owner_id, priority, due_at, recurrence, source, kind
  ) values (
    new.organisation_id, new.patient_id, new.care_plan_id, new.goal_id, new.title, new.description,
    new.owner_role, new.owner_id, new.priority, v_next_due, new.recurrence, new.source, new.kind
  );

  return new;
end;
$$;

-- The patient's own tasks under the v5 name. security_invoker: care_tasks RLS
-- decides, so this view can never show a row the caller could not already read.
create or replace view public.patient_tasks with (security_invoker = true) as
select
  t.id,
  t.patient_id,
  t.organisation_id,
  t.kind,
  t.title,
  t.priority,
  t.due_at,
  t.recurrence,
  t.owner_role,
  case t.status
    when 'completed' then 'done'
    when 'cancelled' then 'cancelled'
    when 'missed' then 'missed'
    when 'expired' then 'missed'
    when 'unable_to_complete' then 'unable'
    else 'open'
  end as state,
  t.status,
  t.source_event_id,
  t.care_plan_id,
  t.created_at,
  t.updated_at
from public.care_tasks t
where t.patient_id = (select auth.uid())
  and t.owner_role = 'patient';

comment on view public.patient_tasks is
  'v5 name for the caller''s own patient-owned care_tasks (read-only). state: open (not_started, scheduled, in_progress), done, cancelled, missed (missed, expired), unable. Patients move a task only through complete_care_task().';

-- A new relation needs its own grant (RLS restricts rows; it does not grant access).
-- Default privileges would also hand authenticated INSERT/UPDATE/DELETE on a new
-- view (checked on the live project), so revoke everything first and grant SELECT only.
revoke all on public.patient_tasks from public;
revoke all on public.patient_tasks from anon;
revoke all on public.patient_tasks from authenticated;
grant select on public.patient_tasks to authenticated;

-- Prove the structure rather than hope.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'care_tasks' and column_name = 'kind') then
    raise exception 'care_tasks.kind missing';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'care_tasks' and column_name = 'source_event_id') then
    raise exception 'care_tasks.source_event_id missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'care_tasks_kind_check' and conrelid = 'public.care_tasks'::regclass) then
    raise exception 'care_tasks_kind_check missing';
  end if;
  if pg_get_functiondef('private.roll_recurring_care_task()'::regprocedure) not like '%new.kind%' then
    raise exception 'recurrence trigger does not copy kind';
  end if;
  if not coalesce((select 'security_invoker=true' = any (reloptions)
                   from pg_class where oid = 'public.patient_tasks'::regclass), false) then
    raise exception 'patient_tasks is not security_invoker';
  end if;
  if has_table_privilege('anon', 'public.patient_tasks', 'SELECT') then
    raise exception 'anon can read patient_tasks';
  end if;
  if not has_table_privilege('authenticated', 'public.patient_tasks', 'SELECT') then
    raise exception 'authenticated cannot read patient_tasks';
  end if;
  if has_table_privilege('authenticated', 'public.patient_tasks', 'INSERT')
     or has_table_privilege('authenticated', 'public.patient_tasks', 'UPDATE')
     or has_table_privilege('authenticated', 'public.patient_tasks', 'DELETE') then
    raise exception 'authenticated can write through patient_tasks';
  end if;
end $$;
