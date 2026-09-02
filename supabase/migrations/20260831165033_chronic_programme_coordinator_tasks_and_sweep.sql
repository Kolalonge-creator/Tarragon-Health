-- Tarragon Health — 12-week two-track chronic-care programme, Phase 2 (sweep)
--
-- A missed occurrence is a LOGISTICS event ("chase this patient", "book this
-- test"), not a clinical-judgement one — Care Coordinator remit per the
-- Clinical Tier Ladder, never a clinician_alert. care_plan_review_prompts
-- was considered and rejected as the worklist to reuse: its
-- care_plan_review_trigger_event enum means "does the CARE PLAN need
-- changing", a different question a doctor answers, not "this logistics
-- step is overdue" a Coordinator handles — forcing this in would have meant
-- adding enum values that don't fit its taxonomy. A small dedicated table
-- is the honest fit.

create type public.chronic_coordinator_task_type as enum (
  'missed_lab_panel', 'missed_doctor_checkin', 'lab_panel_due_soon'
);
create type public.chronic_coordinator_task_status as enum ('open', 'done', 'dismissed');

create table public.chronic_programme_coordinator_tasks (
  id            uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id    uuid not null references public.profiles (id) on delete cascade,
  occurrence_id uuid not null references public.chronic_programme_schedule_occurrences (id) on delete cascade,
  task_type     public.chronic_coordinator_task_type not null,
  status        public.chronic_coordinator_task_status not null default 'open',
  done_by       uuid references public.profiles (id) on delete set null,
  done_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index chronic_coordinator_tasks_org_idx
  on public.chronic_programme_coordinator_tasks (organisation_id, status);
create unique index chronic_coordinator_tasks_one_open_per_occurrence
  on public.chronic_programme_coordinator_tasks (occurrence_id, task_type)
  where status = 'open';

alter table public.chronic_programme_coordinator_tasks enable row level security;

create policy chronic_coordinator_tasks_select on public.chronic_programme_coordinator_tasks
  for select to authenticated using (private.is_org_staff(organisation_id));
create policy chronic_coordinator_tasks_update on public.chronic_programme_coordinator_tasks
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, update on public.chronic_programme_coordinator_tasks to authenticated;
-- A from-scratch environment's base Supabase template grants table DML to
-- anon by default at CREATE TABLE time too -- revoke explicitly.
revoke all on public.chronic_programme_coordinator_tasks from anon;

-- Daily sweep, same idiom as private.queue_vitals_reminders(): a 7-day grace
-- window before "missed" (a non-punitive default matching the platform's
-- general tone, not same-day), then a Coordinator task. A doctor_checkin
-- occurrence approaching due with no booked appointment and no available
-- slot joins the waiting list rather than silently going missed (handled by
-- the pooled-booking migration, which runs after this one).
create or replace function private.sweep_chronic_programme_occurrences()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
begin
  for o in
    select * from public.chronic_programme_schedule_occurrences
    where status = 'pending' and due_date < current_date - interval '7 days'
  loop
    update public.chronic_programme_schedule_occurrences
      set status = 'missed', updated_at = now()
      where id = o.id;

    -- A missed programme_end_review is a clinical matter (the review still
    -- gets composed on demand from the clinician UI, late or not), not a
    -- Coordinator logistics task — no task raised for that occurrence type.
    if o.occurrence_type = 'lab_panel' then
      insert into public.chronic_programme_coordinator_tasks
        (organisation_id, patient_id, occurrence_id, task_type)
      values (o.organisation_id, o.patient_id, o.id, 'missed_lab_panel')
      on conflict (occurrence_id, task_type) where status = 'open' do nothing;
    elsif o.occurrence_type = 'doctor_checkin' then
      insert into public.chronic_programme_coordinator_tasks
        (organisation_id, patient_id, occurrence_id, task_type)
      values (o.organisation_id, o.patient_id, o.id, 'missed_doctor_checkin')
      on conflict (occurrence_id, task_type) where status = 'open' do nothing;
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'chronic-programme-occurrences-daily',
  '0 6 * * *',
  $$select private.sweep_chronic_programme_occurrences();$$
);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'chronic-programme-occurrences-daily') then
    raise exception 'chronic-programme-occurrences-daily cron job missing';
  end if;
  if has_table_privilege('anon', 'public.chronic_programme_coordinator_tasks', 'INSERT') then
    raise exception 'FAIL: anon must not be able to write chronic_programme_coordinator_tasks';
  end if;
  raise notice 'PASS: chronic programme coordinator tasks + daily sweep in place';
end $$;
