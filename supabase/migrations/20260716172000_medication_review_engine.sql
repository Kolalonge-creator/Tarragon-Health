-- Tarragon Health — medication review engine (medication pathway, Phase 6)
--
-- Every chronic-disease programme gets scheduled medication reviews at a
-- condition-specific cadence (pathway: HTN 6mo, diabetes 3mo, heart failure /
-- cardiovascular 3mo, CKD 3mo…). A review is a doctor touchpoint that assesses
-- control, side effects, adherence, lab monitoring, and dose adjustment.
--
-- Model:
--   • medication_review_cadences — reference map condition → interval_months.
--   • medication_reviews — one scheduled review per care plan, due_date driven
--     by the cadence, completed by a doctor (reviewed_by → clinical_staff, set
--     server-side at completion, never client-supplied — same null-gated
--     "ReviewedByDoctor" attribution rule as escalations).
--   • ensure_medication_review — activating a care plan schedules its first
--     review; completing one schedules the next (rolling cadence).
--   • queue_medication_review_reminders — daily cron enqueues a patient
--     reminder as the review comes due (same shape as refill reminders).
-- All idempotent-guarded.

-- --- cadence reference -------------------------------------------------------
create table if not exists public.medication_review_cadences (
  condition       public.care_plan_condition primary key,
  interval_months integer not null check (interval_months > 0)
);

insert into public.medication_review_cadences (condition, interval_months) values
  ('hypertension', 6),
  ('diabetes', 3),
  ('cardiovascular', 3),
  ('ckd', 3),
  ('obesity', 6),
  ('other', 6)
on conflict (condition) do update set interval_months = excluded.interval_months;

-- --- reviews table -----------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'medication_review_status') then
    create type public.medication_review_status as enum ('pending', 'completed', 'cancelled');
  end if;
end $$;

create table if not exists public.medication_reviews (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  care_plan_id      uuid not null references public.care_plans (id) on delete cascade,
  status            public.medication_review_status not null default 'pending',
  due_date          date not null,
  completed_at      timestamptz,
  reviewed_by       uuid references public.clinical_staff (id) on delete set null,
  notes             text,
  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists medication_reviews_patient_idx on public.medication_reviews (patient_id);
create index if not exists medication_reviews_org_status_idx on public.medication_reviews (organisation_id, status, due_date);
-- At most one pending review per care plan — the rolling scheduler relies on this.
create unique index if not exists medication_reviews_one_pending_per_plan
  on public.medication_reviews (care_plan_id) where status = 'pending';

drop trigger if exists medication_reviews_set_updated_at on public.medication_reviews;
create trigger medication_reviews_set_updated_at
  before update on public.medication_reviews
  for each row execute function private.set_updated_at();

alter table public.medication_reviews enable row level security;

-- Patient reads their own upcoming/past reviews; org staff manage.
drop policy if exists medication_reviews_select on public.medication_reviews;
create policy medication_reviews_select on public.medication_reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists medication_reviews_insert on public.medication_reviews;
create policy medication_reviews_insert on public.medication_reviews
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists medication_reviews_update on public.medication_reviews;
create policy medication_reviews_update on public.medication_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.medication_reviews to authenticated;

-- --- completion attribution (server-derived reviewed_by) ---------------------
-- On the transition into 'completed', stamp completed_at + reviewed_by from the
-- caller's own clinical_staff row. reviewed_by is never trusted from the client
-- (same rule as medications.last_confirmed_by) so "Reviewed by Dr X" can never
-- be forged. Reopening/other edits are untouched.
create or replace function private.stamp_medication_review_completion()
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

drop trigger if exists medication_reviews_stamp_completion on public.medication_reviews;
create trigger medication_reviews_stamp_completion
  before update on public.medication_reviews
  for each row execute function private.stamp_medication_review_completion();

-- --- scheduler: activating a plan schedules a review; completing rolls next ---
create or replace function private.ensure_medication_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months integer;
  v_care_plan public.care_plans%rowtype;
begin
  -- Resolve the care plan + its cadence.
  if tg_table_name = 'care_plans' then
    v_care_plan := new;
  else
    select * into v_care_plan from public.care_plans where id = new.care_plan_id;
  end if;

  if v_care_plan.status <> 'active' then
    return new;
  end if;

  select interval_months into v_months
  from public.medication_review_cadences where condition = v_care_plan.condition;
  v_months := coalesce(v_months, 6);

  -- Only schedule if there is no pending review already (unique index also guards).
  if not exists (
    select 1 from public.medication_reviews
    where care_plan_id = v_care_plan.id and status = 'pending'
  ) then
    insert into public.medication_reviews (organisation_id, patient_id, care_plan_id, due_date)
    values (
      v_care_plan.organisation_id,
      v_care_plan.patient_id,
      v_care_plan.id,
      current_date + (v_months || ' months')::interval
    );
  end if;

  return new;
end;
$$;

-- Activating (or creating active) a care plan schedules the first review.
drop trigger if exists care_plans_ensure_review on public.care_plans;
create trigger care_plans_ensure_review
  after insert or update of status on public.care_plans
  for each row when (new.status = 'active')
  execute function private.ensure_medication_review();

-- Completing a review rolls the next one at the condition cadence.
drop trigger if exists medication_reviews_roll_next on public.medication_reviews;
create trigger medication_reviews_roll_next
  after update on public.medication_reviews
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.ensure_medication_review();

-- --- daily reminder cron -----------------------------------------------------
create or replace function private.queue_medication_review_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select r.*
    from public.medication_reviews r
    where r.status = 'pending'
      and r.reminder_sent_at is null
      and r.due_date - interval '7 days' <= current_date
      and r.due_date >= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'medication_review_due',
      jsonb_build_object('due_date', due_date)
    from due
    returning id
  )
  update public.medication_reviews r
    set reminder_sent_at = now()
  from due
  where r.id = due.id;
$$;

select cron.schedule(
  'medication-review-reminders-daily',
  '20 6 * * *',
  $$select private.queue_medication_review_reminders();$$
);
