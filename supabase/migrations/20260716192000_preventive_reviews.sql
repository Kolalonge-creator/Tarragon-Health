-- Tarragon Health — Preventive Health Pathway, Gap 3
-- preventive_reviews: the "periodic health review" step, a clinician touchpoint
-- for a patient enrolled in a preventive programme. Structurally the prevention
-- analogue of medication_reviews and follows the same rules exactly:
--   • one pending review per enrolment; due_date driven by the programme's
--     review_cadence_months.
--   • enrolling schedules the first review; completing rolls the next (the
--     "periodic health review → repeat" loop in the pathway diagram).
--   • reviewed_by/completed_at stamped server-side from the caller's
--     clinical_staff row — never client-supplied (same null-gated
--     "ReviewedByDoctor" attribution rule as escalations/medication reviews).
--
-- Reuses the medication_review_status enum (pending/completed/cancelled) — the
-- lifecycle is identical, no need for a parallel enum.

create table if not exists public.preventive_reviews (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  enrolment_id      uuid not null references public.preventive_programme_enrolments (id) on delete cascade,
  status            public.medication_review_status not null default 'pending',
  due_date          date not null,
  completed_at      timestamptz,
  reviewed_by       uuid references public.clinical_staff (id) on delete set null,
  notes             text,
  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists preventive_reviews_patient_idx
  on public.preventive_reviews (patient_id);
create index if not exists preventive_reviews_org_status_idx
  on public.preventive_reviews (organisation_id, status, due_date);
create unique index if not exists preventive_reviews_one_pending_per_enrolment
  on public.preventive_reviews (enrolment_id) where status = 'pending';

drop trigger if exists preventive_reviews_set_updated_at on public.preventive_reviews;
create trigger preventive_reviews_set_updated_at
  before update on public.preventive_reviews
  for each row execute function private.set_updated_at();

alter table public.preventive_reviews enable row level security;

drop policy if exists preventive_reviews_select on public.preventive_reviews;
create policy preventive_reviews_select on public.preventive_reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists preventive_reviews_insert on public.preventive_reviews;
create policy preventive_reviews_insert on public.preventive_reviews
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists preventive_reviews_update on public.preventive_reviews;
create policy preventive_reviews_update on public.preventive_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.preventive_reviews to authenticated;

-- --- completion attribution (server-derived reviewed_by) ---------------------
create or replace function private.stamp_preventive_review_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff_id;
  end if;
  return new;
end;
$$;

drop trigger if exists preventive_reviews_stamp_completion on public.preventive_reviews;
create trigger preventive_reviews_stamp_completion
  before update on public.preventive_reviews
  for each row execute function private.stamp_preventive_review_completion();

-- --- scheduler: enrolling schedules a review; completing rolls the next -------
create or replace function private.ensure_preventive_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months integer;
  v_enrolment public.preventive_programme_enrolments%rowtype;
begin
  if tg_table_name = 'preventive_programme_enrolments' then
    v_enrolment := new;
  else
    select * into v_enrolment
    from public.preventive_programme_enrolments where id = new.enrolment_id;
  end if;

  if v_enrolment.status <> 'enrolled' then
    return new;
  end if;

  select review_cadence_months into v_months
  from public.preventive_programmes where id = v_enrolment.programme_id;
  v_months := coalesce(v_months, 12);

  if not exists (
    select 1 from public.preventive_reviews
    where enrolment_id = v_enrolment.id and status = 'pending'
  ) then
    insert into public.preventive_reviews (organisation_id, patient_id, enrolment_id, due_date)
    values (
      v_enrolment.organisation_id,
      v_enrolment.patient_id,
      v_enrolment.id,
      current_date + (v_months || ' months')::interval
    );
  end if;

  return new;
end;
$$;

-- Enrolling (or creating an enrolled row) schedules the first review.
drop trigger if exists preventive_enrolments_ensure_review on public.preventive_programme_enrolments;
create trigger preventive_enrolments_ensure_review
  after insert or update of status on public.preventive_programme_enrolments
  for each row when (new.status = 'enrolled')
  execute function private.ensure_preventive_review();

-- Completing a review rolls the next at the programme cadence.
drop trigger if exists preventive_reviews_roll_next on public.preventive_reviews;
create trigger preventive_reviews_roll_next
  after update on public.preventive_reviews
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.ensure_preventive_review();

-- --- daily reminder cron -----------------------------------------------------
create or replace function private.queue_preventive_review_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select r.*
    from public.preventive_reviews r
    where r.status = 'pending'
      and r.reminder_sent_at is null
      and r.due_date - interval '7 days' <= current_date
      and r.due_date >= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'preventive_review_due',
      jsonb_build_object('due_date', due_date)
    from due
    returning id
  )
  update public.preventive_reviews r
    set reminder_sent_at = now()
  from due
  where r.id = due.id;
$$;

select cron.schedule(
  'preventive-review-reminders-daily',
  '30 6 * * *',
  $$select private.queue_preventive_review_reminders();$$
);
