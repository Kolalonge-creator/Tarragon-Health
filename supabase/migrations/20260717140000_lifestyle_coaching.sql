-- Tarragon Health — Lifestyle Coaching pathway (bundled with obesity programme)
--
-- Lifestyle coaching is an ENGAGEMENT LAYER that lives inside chronic
-- programmes (obesity/HTN/diabetes) and is entitlement-gated at the app layer
-- to complete/family/parentcare tiers + a lifestyle-coaching add-on for
-- essential patients (see 20260717141000_lifestyle_coaching_entitlement.sql).
-- Obesity itself needs NO new schema — it is a care_plans row (condition
-- 'obesity' already in the enum) with its review already scheduled by the
-- existing medication_review engine (obesity cadence = 6mo). This migration
-- only adds the lifestyle behaviour-change tables the founder's flow needs:
--   Assessment → Goals → Diet programme → Exercise programme →
--   Weight (reads vitals_readings, NOT duplicated) → Sleep → Stress →
--   Progress review.
--
-- Patterns reused verbatim (no new pattern invented):
--   • check-in scheduling + daily reminder cron  → medication_adherence_checkins
--   • rolling review + server-derived reviewed_by → medication_reviews
--   • RLS (patient-owner + private.is_org_staff)  → every patient-owned table
-- All idempotent-guarded.

-- ============================================================================
-- Enums
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'lifestyle_domain') then
    create type public.lifestyle_domain as enum
      ('diet', 'exercise', 'weight', 'sleep', 'stress');
  end if;
  if not exists (select 1 from pg_type where typname = 'lifestyle_programme_domain') then
    create type public.lifestyle_programme_domain as enum ('diet', 'exercise');
  end if;
  if not exists (select 1 from pg_type where typname = 'lifestyle_goal_status') then
    create type public.lifestyle_goal_status as enum ('active', 'achieved', 'abandoned');
  end if;
  if not exists (select 1 from pg_type where typname = 'lifestyle_enrolment_status') then
    create type public.lifestyle_enrolment_status as enum ('enrolled', 'completed', 'withdrawn');
  end if;
  if not exists (select 1 from pg_type where typname = 'lifestyle_checkin_status') then
    create type public.lifestyle_checkin_status as enum ('pending', 'responded', 'skipped');
  end if;
  if not exists (select 1 from pg_type where typname = 'lifestyle_review_status') then
    create type public.lifestyle_review_status as enum ('pending', 'completed', 'cancelled');
  end if;
end $$;

-- ============================================================================
-- 1. Assessments — baseline capture (re-takeable; latest row is current)
-- ============================================================================
create table if not exists public.lifestyle_assessments (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  activity_minutes_weekly integer check (activity_minutes_weekly >= 0),
  sleep_hours_nightly   numeric(3,1) check (sleep_hours_nightly >= 0 and sleep_hours_nightly <= 24),
  stress_level          smallint check (stress_level between 1 and 5),
  diet_quality          smallint check (diet_quality between 1 and 5),
  smokes                boolean,
  alcohol_units_weekly  integer check (alcohol_units_weekly >= 0),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists lifestyle_assessments_patient_idx
  on public.lifestyle_assessments (patient_id, created_at desc);
create index if not exists lifestyle_assessments_org_idx
  on public.lifestyle_assessments (organisation_id);

-- ============================================================================
-- 2. Goals — SMART goals per domain (covers weight/sleep/stress flow nodes)
-- ============================================================================
create table if not exists public.lifestyle_goals (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  domain          public.lifestyle_domain not null,
  title           text not null,
  target_value    numeric,
  target_unit     text,
  target_date     date,
  status          public.lifestyle_goal_status not null default 'active',
  notes           text,
  achieved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists lifestyle_goals_patient_idx
  on public.lifestyle_goals (patient_id, status);
create index if not exists lifestyle_goals_org_idx
  on public.lifestyle_goals (organisation_id);

-- ============================================================================
-- 3. Programmes — global diet/exercise template catalogue (admin-managed)
--    No organisation_id: a shared catalogue like chronic_condition_programmes.
-- ============================================================================
create table if not exists public.lifestyle_programmes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  domain         public.lifestyle_programme_domain not null,
  name           text not null,
  description    text,
  duration_weeks integer check (duration_weeks > 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================================
-- 4. Programme enrolments — patient ↔ template
-- ============================================================================
create table if not exists public.lifestyle_programme_enrolments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  programme_id    uuid not null references public.lifestyle_programmes (id) on delete restrict,
  status          public.lifestyle_enrolment_status not null default 'enrolled',
  notes           text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id, programme_id)
);
create index if not exists lifestyle_enrolments_patient_idx
  on public.lifestyle_programme_enrolments (patient_id, status);
create index if not exists lifestyle_enrolments_org_idx
  on public.lifestyle_programme_enrolments (organisation_id);

-- ============================================================================
-- 5. Check-ins — scheduled adherence prompts, answered IN-APP (cron reminds)
-- ============================================================================
create table if not exists public.lifestyle_checkins (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  programme_enrolment_id uuid not null references public.lifestyle_programme_enrolments (id) on delete cascade,
  title                 text not null,
  status                public.lifestyle_checkin_status not null default 'pending',
  due_date              date not null,
  response              text,
  reminder_sent_at      timestamptz,
  responded_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (programme_enrolment_id, title)
);
create index if not exists lifestyle_checkins_patient_idx
  on public.lifestyle_checkins (patient_id, status, due_date);
create index if not exists lifestyle_checkins_org_idx
  on public.lifestyle_checkins (organisation_id, status, due_date);

-- ============================================================================
-- 6. Reviews — periodic progress review (doctor/coordinator touchpoint)
--    Null-gated attribution: reviewed_by set server-side at completion only.
-- ============================================================================
create table if not exists public.lifestyle_reviews (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  status           public.lifestyle_review_status not null default 'pending',
  due_date         date not null,
  completed_at     timestamptz,
  reviewed_by      uuid references public.clinical_staff (id) on delete set null,
  notes            text,
  reminder_sent_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists lifestyle_reviews_patient_idx
  on public.lifestyle_reviews (patient_id);
create index if not exists lifestyle_reviews_org_status_idx
  on public.lifestyle_reviews (organisation_id, status, due_date);
-- At most one pending review per patient — the rolling scheduler relies on this.
create unique index if not exists lifestyle_reviews_one_pending_per_patient
  on public.lifestyle_reviews (patient_id) where status = 'pending';

-- ============================================================================
-- updated_at triggers
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'lifestyle_assessments','lifestyle_goals','lifestyle_programmes',
    'lifestyle_programme_enrolments','lifestyle_checkins','lifestyle_reviews'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.lifestyle_assessments            enable row level security;
alter table public.lifestyle_goals                  enable row level security;
alter table public.lifestyle_programmes             enable row level security;
alter table public.lifestyle_programme_enrolments   enable row level security;
alter table public.lifestyle_checkins               enable row level security;
alter table public.lifestyle_reviews                enable row level security;

-- --- assessments: patient self-manages; org staff read/manage ---------------
drop policy if exists lifestyle_assessments_select on public.lifestyle_assessments;
create policy lifestyle_assessments_select on public.lifestyle_assessments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists lifestyle_assessments_insert on public.lifestyle_assessments;
create policy lifestyle_assessments_insert on public.lifestyle_assessments
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );
drop policy if exists lifestyle_assessments_update on public.lifestyle_assessments;
create policy lifestyle_assessments_update on public.lifestyle_assessments
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- --- goals: patient self-manages; org staff read/manage ---------------------
drop policy if exists lifestyle_goals_select on public.lifestyle_goals;
create policy lifestyle_goals_select on public.lifestyle_goals
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists lifestyle_goals_insert on public.lifestyle_goals;
create policy lifestyle_goals_insert on public.lifestyle_goals
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );
drop policy if exists lifestyle_goals_update on public.lifestyle_goals;
create policy lifestyle_goals_update on public.lifestyle_goals
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- --- programmes: catalogue — any signed-in user reads active; admin writes ---
drop policy if exists lifestyle_programmes_select on public.lifestyle_programmes;
create policy lifestyle_programmes_select on public.lifestyle_programmes
  for select to authenticated
  using (is_active or private.is_admin());
drop policy if exists lifestyle_programmes_write on public.lifestyle_programmes;
create policy lifestyle_programmes_write on public.lifestyle_programmes
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- --- enrolments: patient self-enrols; org staff read/manage -----------------
drop policy if exists lifestyle_enrolments_select on public.lifestyle_programme_enrolments;
create policy lifestyle_enrolments_select on public.lifestyle_programme_enrolments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists lifestyle_enrolments_insert on public.lifestyle_programme_enrolments;
create policy lifestyle_enrolments_insert on public.lifestyle_programme_enrolments
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );
drop policy if exists lifestyle_enrolments_update on public.lifestyle_programme_enrolments;
create policy lifestyle_enrolments_update on public.lifestyle_programme_enrolments
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- --- check-ins: patient reads + responds; staff manage; insert staff/trigger -
drop policy if exists lifestyle_checkins_select on public.lifestyle_checkins;
create policy lifestyle_checkins_select on public.lifestyle_checkins
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists lifestyle_checkins_insert on public.lifestyle_checkins;
create policy lifestyle_checkins_insert on public.lifestyle_checkins
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists lifestyle_checkins_update on public.lifestyle_checkins;
create policy lifestyle_checkins_update on public.lifestyle_checkins
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- --- reviews: patient reads own; staff manage -------------------------------
drop policy if exists lifestyle_reviews_select on public.lifestyle_reviews;
create policy lifestyle_reviews_select on public.lifestyle_reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists lifestyle_reviews_insert on public.lifestyle_reviews;
create policy lifestyle_reviews_insert on public.lifestyle_reviews
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists lifestyle_reviews_update on public.lifestyle_reviews;
create policy lifestyle_reviews_update on public.lifestyle_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.lifestyle_assessments to authenticated;
grant select, insert, update on public.lifestyle_goals to authenticated;
grant select, insert, update, delete on public.lifestyle_programmes to authenticated;
grant select, insert, update on public.lifestyle_programme_enrolments to authenticated;
grant select, insert, update on public.lifestyle_checkins to authenticated;
grant select, insert, update on public.lifestyle_reviews to authenticated;

-- ============================================================================
-- Scheduler: enrolling in a programme schedules 4 in-app check-ins
--   (Day 3 kickoff, Week 2, Month 1, Month 3) — mirrors medication check-ins.
-- ============================================================================
create or replace function private.schedule_lifestyle_checkins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'enrolled' then
    return new;
  end if;

  insert into public.lifestyle_checkins
    (organisation_id, patient_id, programme_enrolment_id, title, due_date)
  values
    (new.organisation_id, new.patient_id, new.id, 'Getting started',      current_date + 3),
    (new.organisation_id, new.patient_id, new.id, 'Two weeks in',         current_date + 14),
    (new.organisation_id, new.patient_id, new.id, 'One month check-in',   current_date + 30),
    (new.organisation_id, new.patient_id, new.id, 'Three month progress', current_date + 90)
  on conflict (programme_enrolment_id, title) do nothing;

  return new;
end;
$$;

drop trigger if exists lifestyle_enrolments_schedule_checkins on public.lifestyle_programme_enrolments;
create trigger lifestyle_enrolments_schedule_checkins
  after insert on public.lifestyle_programme_enrolments
  for each row execute function private.schedule_lifestyle_checkins();

-- ============================================================================
-- Scheduler: a patient's first assessment OR enrolment schedules a progress
--   review (fixed 3-month cadence); completing one rolls the next.
-- ============================================================================
create or replace function private.ensure_lifestyle_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_patient uuid;
begin
  v_org := new.organisation_id;
  v_patient := new.patient_id;

  if not exists (
    select 1 from public.lifestyle_reviews
    where patient_id = v_patient and status = 'pending'
  ) then
    insert into public.lifestyle_reviews (organisation_id, patient_id, due_date)
    values (v_org, v_patient, current_date + interval '3 months')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists lifestyle_assessments_ensure_review on public.lifestyle_assessments;
create trigger lifestyle_assessments_ensure_review
  after insert on public.lifestyle_assessments
  for each row execute function private.ensure_lifestyle_review();

drop trigger if exists lifestyle_enrolments_ensure_review on public.lifestyle_programme_enrolments;
create trigger lifestyle_enrolments_ensure_review
  after insert on public.lifestyle_programme_enrolments
  for each row execute function private.ensure_lifestyle_review();

-- Completing a review rolls the next one (3-month cadence). Uses the same
-- server-derived reviewed_by rule as medication_reviews.
create or replace function private.stamp_lifestyle_review_completion()
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

drop trigger if exists lifestyle_reviews_stamp_completion on public.lifestyle_reviews;
create trigger lifestyle_reviews_stamp_completion
  before update on public.lifestyle_reviews
  for each row execute function private.stamp_lifestyle_review_completion();

create or replace function private.roll_lifestyle_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.lifestyle_reviews
    where patient_id = new.patient_id and status = 'pending'
  ) then
    insert into public.lifestyle_reviews (organisation_id, patient_id, due_date)
    values (new.organisation_id, new.patient_id, current_date + interval '3 months')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists lifestyle_reviews_roll_next on public.lifestyle_reviews;
create trigger lifestyle_reviews_roll_next
  after update on public.lifestyle_reviews
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.roll_lifestyle_review();

-- ============================================================================
-- Daily reminder crons (WhatsApp/SMS is reminder-only; entry is in-app)
--   Templates lifestyle_checkin_due / lifestyle_review_due need Meta approval;
--   fall back to SMS meanwhile (same as other pathway templates).
-- ============================================================================
create or replace function private.queue_lifestyle_checkin_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select id, organisation_id, patient_id, title
    from public.lifestyle_checkins
    where status = 'pending'
      and reminder_sent_at is null
      and due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'lifestyle_checkin_due',
           jsonb_build_object('title', title)
    from due
    returning id
  )
  update public.lifestyle_checkins c
    set reminder_sent_at = now()
  from due where c.id = due.id;
$$;

create or replace function private.queue_lifestyle_review_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with due as (
    select id, organisation_id, patient_id, due_date
    from public.lifestyle_reviews
    where status = 'pending'
      and reminder_sent_at is null
      and due_date - interval '7 days' <= current_date
      and due_date >= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select organisation_id, patient_id, 'whatsapp', 'pending', 'lifestyle_review_due',
           jsonb_build_object('due_date', due_date)
    from due
    returning id
  )
  update public.lifestyle_reviews r
    set reminder_sent_at = now()
  from due where r.id = due.id;
$$;

select cron.schedule(
  'lifestyle-checkin-reminders-daily', '40 6 * * *',
  $$select private.queue_lifestyle_checkin_reminders();$$);
select cron.schedule(
  'lifestyle-review-reminders-daily', '50 6 * * *',
  $$select private.queue_lifestyle_review_reminders();$$);

-- ============================================================================
-- Seed: two starter programme templates (one diet, one exercise)
-- ============================================================================
insert into public.lifestyle_programmes (code, domain, name, description, duration_weeks, is_active) values
  ('balanced-plate-12wk', 'diet',
   'Balanced Plate — 12 weeks',
   'A gradual, culturally-familiar eating plan built around portion balance, less added sugar and salt, and more vegetables and fibre. Reviewed with your care team.',
   12, true),
  ('move-more-8wk', 'exercise',
   'Move More — 8 weeks',
   'A beginner-friendly activity plan that builds from short daily walks to a sustainable weekly movement routine, paced to your starting fitness.',
   8, true)
on conflict (code) do nothing;
