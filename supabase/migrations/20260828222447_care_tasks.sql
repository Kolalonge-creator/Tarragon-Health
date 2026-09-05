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

do $$ begin
  create type public.care_task_escalation_stage as enum
    ('none', 'reminded', 'coordinator_notified', 'clinical_review');
exception when duplicate_object then null; end $$;

create table public.care_tasks (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  care_plan_id        uuid references public.care_plans (id) on delete set null,
  goal_id             uuid references public.care_plan_goals (id) on delete set null,
  title               text not null,
  description         text,
  owner_role          public.care_task_owner_role not null default 'patient',
  owner_id            uuid references public.profiles (id) on delete set null,
  priority            smallint not null default 2 check (priority between 1 and 3),
  due_at              timestamptz,
  recurrence          text check (recurrence is null or recurrence in ('daily', 'weekly', 'monthly')),
  status              public.care_task_status not null default 'not_started',
  escalation_stage    public.care_task_escalation_stage not null default 'none',
  completion_evidence jsonb not null default '{}'::jsonb,
  unable_reason       text,
  completed_at        timestamptz,
  completed_by        uuid references public.profiles (id) on delete set null,
  source              text not null default 'clinician',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index care_tasks_patient_idx on public.care_tasks (patient_id, status, due_at);
create index care_tasks_org_status_idx on public.care_tasks (organisation_id, status, due_at);
create index care_tasks_care_plan_idx on public.care_tasks (care_plan_id);
create index care_tasks_goal_idx on public.care_tasks (goal_id);
create index care_tasks_overdue_idx on public.care_tasks (due_at)
  where status in ('not_started', 'scheduled', 'in_progress');

create trigger care_tasks_set_updated_at
  before update on public.care_tasks
  for each row execute function private.set_updated_at();

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
