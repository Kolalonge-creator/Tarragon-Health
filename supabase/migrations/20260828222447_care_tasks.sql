-- Tarragon Health — Care Management Engine, step 3
--
-- care_tasks: the platform has never had a first-class, patient-facing task
-- with a real status lifecycle and named ownership. Spec §3.7-§3.9:
--
--   "Every care-plan action becomes a task. Task fields: task, patient,
--    owner, priority, due date, recurrence, status, escalation, completion
--    evidence... Tasks can belong to: patient, doctor, care coordinator,
--    specialist, pharmacist, laboratory, system. This creates
--    accountability."
--
-- This is deliberately additive, not a replacement for the specialised
-- due-date systems that already exist and work (medication_reviews,
-- medication_adherence_checkins, screening_schedules, appointments) — those
-- keep their own tables because each carries domain-specific columns a
-- generic task can't hold. care_tasks is for the goal-linked, care-plan
-- checklist items §3.7 describes (a weekly BP reading, a lifestyle-programme
-- step, "complete laboratory testing") that had nowhere to live at all.
--
-- Write path is deliberately asymmetric. Org staff (clinician, care
-- coordinator — see the Care Coordinator write-access rule in CLAUDE.md,
-- which explicitly does NOT exclude tasks/logistics) get a normal RLS-gated
-- UPDATE. A patient gets none: a raw PostgREST PATCH against this table
-- would let them set completed_by/escalation_stage/priority alongside
-- status, so a patient can only ever move their own task through
-- public.complete_care_task() below — the same "RPC only for a constrained
-- patient write" idiom this codebase already uses (confirm_screening_done
-- and friends) rather than a column-level privilege trick.

do $$ begin
  create type public.care_task_owner_role as enum
    ('patient', 'clinician', 'care_coordinator', 'specialist', 'pharmacist', 'laboratory', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.care_task_status as enum (
    'not_started', 'scheduled', 'in_progress', 'completed',
    'missed', 'cancelled', 'unable_to_complete', 'expired'
  );
exception when duplicate_object then null; end $$;

-- §3.14's escalation chain, tracked per task so the nightly engine (a later
-- migration in this series) knows how far a given overdue task has already
-- climbed and never re-sends the same rung twice.
do $$ begin
  create type public.care_task_escalation_stage as enum
    ('none', 'reminded', 'coordinator_notified', 'clinical_review');
exception when duplicate_object then null; end $$;

create table public.care_tasks (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  -- Nullable on purpose: a task belongs to the PATIENT first (so a
  -- multimorbid patient's tasks read as one unified list, §3.15), the
  -- condition-specific care_plan second.
  care_plan_id        uuid references public.care_plans (id) on delete set null,
  goal_id             uuid references public.care_plan_goals (id) on delete set null,
  title               text not null,
  description         text,
  owner_role          public.care_task_owner_role not null default 'patient',
  -- A specific person, when known. Null for a role-based-but-unassigned task
  -- (e.g. owner_role='laboratory' with no named lab liaison) or owner_role='system'.
  owner_id            uuid references public.profiles (id) on delete set null,
  -- 1 = act first, 3 = routine — same convention as care_outreach_tasks.priority.
  priority            smallint not null default 2 check (priority between 1 and 3),
  due_at              timestamptz,
  recurrence          text check (recurrence is null or recurrence in ('daily', 'weekly', 'monthly')),
  status              public.care_task_status not null default 'not_started',
  escalation_stage    public.care_task_escalation_stage not null default 'none',
  completion_evidence jsonb not null default '{}'::jsonb,
  -- Populated only when status = 'unable_to_complete' — §3.8: "'Unable to
  -- complete' is important because it can trigger support."
  unable_reason       text,
  completed_at        timestamptz,
  completed_by        uuid references public.profiles (id) on delete set null,
  -- Free text, not an enum: 'programme_template' | 'clinician' |
  -- 'care_coordinator' | 'patient' | 'system' — provenance only, not a gate.
  source              text not null default 'clinician',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index care_tasks_patient_idx on public.care_tasks (patient_id, status, due_at);
create index care_tasks_org_status_idx on public.care_tasks (organisation_id, status, due_at);
create index care_tasks_care_plan_idx on public.care_tasks (care_plan_id);
create index care_tasks_goal_idx on public.care_tasks (goal_id);
-- The overdue-scan the escalation engine runs nightly filters on exactly
-- this shape; partial index keeps it cheap regardless of table growth.
create index care_tasks_overdue_idx on public.care_tasks (due_at)
  where status in ('not_started', 'scheduled', 'in_progress');

create trigger care_tasks_set_updated_at
  before update on public.care_tasks
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Completion/reopen attribution — server-derived, unconditionally overwritten
-- regardless of caller, same idiom as stamp_medication_review_completion.
-- Also resets escalation_stage once a task reaches a resolved state, so a
-- task that was climbing the escalation ladder and then got completed
-- doesn't linger flagged in the exception/escalation worklists.
-- ---------------------------------------------------------------------------
create or replace function private.stamp_care_task_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := (select auth.uid());
  elsif new.status <> 'completed' and old.status = 'completed' then
    new.completed_at := null;
    new.completed_by := null;
  end if;

  if new.status <> 'unable_to_complete' then
    new.unable_reason := null;
  end if;

  if new.status in ('completed', 'cancelled') then
    new.escalation_stage := 'none';
  end if;

  return new;
end;
$$;

create trigger care_tasks_stamp_transition
  before update on public.care_tasks
  for each row execute function private.stamp_care_task_transition();

-- ---------------------------------------------------------------------------
-- Recurrence — closing a recurring task's current occurrence rolls the next
-- one, same "rolling cadence" idiom as private.ensure_medication_review(),
-- so a routine like "Record BP three times per week" keeps regenerating
-- itself without a clinician re-creating it every week. Rolls on the FIRST
-- terminal outcome for that occurrence (completed, missed, expired, or
-- unable_to_complete) — a missed week must not silently break the series,
-- which is exactly the kind of gap that would force a human back into the
-- loop the engine is meant to run without one. 'cancelled' deliberately does
-- NOT roll: that means a clinician stopped the recurring series itself.
--
-- The OLD-status guard matters: without it, a task already rolled by its
-- not_started -> missed transition would roll AGAIN if the patient later
-- completes that same (now-late) occurrence, since missed -> completed is
-- also "a terminal outcome" by the new-status test alone. Requiring OLD to
-- have been non-terminal makes the roll fire exactly once per occurrence,
-- on whichever terminal state it reaches first.
-- ---------------------------------------------------------------------------
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
    owner_role, owner_id, priority, due_at, recurrence, source
  ) values (
    new.organisation_id, new.patient_id, new.care_plan_id, new.goal_id, new.title, new.description,
    new.owner_role, new.owner_id, new.priority, v_next_due, new.recurrence, new.source
  );

  return new;
end;
$$;

create trigger care_tasks_roll_recurring
  after update on public.care_tasks
  for each row
  when (
    old.status not in ('completed', 'missed', 'expired', 'unable_to_complete', 'cancelled')
    and new.status in ('completed', 'missed', 'expired', 'unable_to_complete')
    and new.recurrence is not null
  )
  execute function private.roll_recurring_care_task();

-- ---------------------------------------------------------------------------
-- RLS — patient reads own tasks only; every write for a patient-owned task
-- goes through public.complete_care_task() below, never a raw UPDATE. Org
-- staff (including care_coordinator — logistics, not excluded by the
-- medications/escalation/protocol write-access rule) get full CRUD.
-- ---------------------------------------------------------------------------
alter table public.care_tasks enable row level security;

create policy care_tasks_select on public.care_tasks
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy care_tasks_insert on public.care_tasks
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy care_tasks_update on public.care_tasks
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy care_tasks_delete on public.care_tasks
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- complete_care_task — the ONLY way a patient moves their own task. Validates
-- ownership and restricts which transitions a patient may make (they may
-- start, complete, or flag a task as unable to complete; they may never
-- cancel one outright, mark it 'missed'/'expired' themselves, or touch a
-- task that isn't theirs or that a clinician already closed).
-- ---------------------------------------------------------------------------
create or replace function public.complete_care_task(
  p_task_id uuid,
  p_status public.care_task_status,
  p_evidence jsonb default null,
  p_unable_reason text default null
)
returns public.care_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.care_tasks%rowtype;
begin
  select * into v_task from public.care_tasks where id = p_task_id;

  if v_task.id is null then
    raise exception 'Task not found';
  end if;
  if v_task.patient_id <> (select auth.uid()) then
    raise exception 'not authorised: this is not your task';
  end if;
  if p_status not in ('in_progress', 'completed', 'unable_to_complete') then
    raise exception 'A patient may only mark a task in_progress, completed, or unable_to_complete';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'This task is already closed';
  end if;

  update public.care_tasks
    set status = p_status,
        completion_evidence = coalesce(p_evidence, completion_evidence),
        unable_reason = case when p_status = 'unable_to_complete' then p_unable_reason else null end
    where id = p_task_id
    returning * into v_task;

  return v_task;
end;
$$;

revoke all on function public.complete_care_task(uuid, public.care_task_status, jsonb, text) from public;
grant execute on function public.complete_care_task(uuid, public.care_task_status, jsonb, text) to authenticated;
