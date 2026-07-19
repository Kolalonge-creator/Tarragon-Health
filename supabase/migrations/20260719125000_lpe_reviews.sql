-- ============================================================================
-- LPE Phase 4 (follow-up) — periodic lifestyle review worklist (spec §12).
-- Mirrors preventive_reviews: enrolling schedules the first review; completing
-- one rolls the next at the condition cadence; reviewed_by is server-derived
-- (never client-supplied); a daily cron enqueues reminders.
-- ============================================================================
create table if not exists public.lpe_reviews (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  enrollment_id     uuid not null references public.lpe_enrollments (id) on delete cascade,
  status            public.medication_review_status not null default 'pending',
  due_date          date not null,
  completed_at      timestamptz,
  reviewed_by       uuid references public.clinical_staff (id) on delete set null,
  notes             text,
  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists lpe_reviews_org_status_idx
  on public.lpe_reviews (organisation_id, status, due_date);
create unique index if not exists lpe_reviews_one_pending_idx
  on public.lpe_reviews (enrollment_id) where status = 'pending';

drop trigger if exists lpe_reviews_set_updated_at on public.lpe_reviews;
create trigger lpe_reviews_set_updated_at
  before update on public.lpe_reviews
  for each row execute function private.set_updated_at();

alter table public.lpe_reviews enable row level security;
drop policy if exists lpe_reviews_select on public.lpe_reviews;
create policy lpe_reviews_select on public.lpe_reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists lpe_reviews_insert on public.lpe_reviews;
create policy lpe_reviews_insert on public.lpe_reviews
  for insert to authenticated with check (private.is_org_staff(organisation_id));
drop policy if exists lpe_reviews_update on public.lpe_reviews;
create policy lpe_reviews_update on public.lpe_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
grant select, insert, update on public.lpe_reviews to authenticated;

-- Cadence (months) by condition.
create or replace function private.lpe_review_cadence_months(p_condition public.care_plan_condition)
returns integer language sql immutable as $$
  select case p_condition
    when 'obesity' then 3
    when 'diabetes' then 3
    when 'hypertension' then 6
    else 3 end;
$$;

-- Completion attribution — server-derived reviewed_by (forge-proof).
create or replace function private.stamp_lpe_review_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_staff uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select id into v_staff from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = new.organisation_id and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff;
  end if;
  return new;
end;
$$;
drop trigger if exists lpe_reviews_stamp_completion on public.lpe_reviews;
create trigger lpe_reviews_stamp_completion
  before update on public.lpe_reviews
  for each row execute function private.stamp_lpe_review_completion();

-- Scheduler: enrolling schedules the first review; completing rolls the next.
create or replace function private.ensure_lpe_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_enr public.lpe_enrollments%rowtype;
  v_months integer;
begin
  if tg_table_name = 'lpe_enrollments' then
    v_enr := new;
  else
    select * into v_enr from public.lpe_enrollments where id = new.enrollment_id;
  end if;

  -- Only schedule for live programmes.
  if v_enr.status not in ('active','maintenance') then
    return new;
  end if;

  v_months := private.lpe_review_cadence_months(v_enr.condition);

  if not exists (
    select 1 from public.lpe_reviews where enrollment_id = v_enr.id and status = 'pending'
  ) then
    insert into public.lpe_reviews (organisation_id, patient_id, enrollment_id, due_date)
    values (v_enr.organisation_id, v_enr.patient_id, v_enr.id,
            (current_date + (v_months || ' months')::interval)::date);
  end if;
  return new;
end;
$$;

drop trigger if exists lpe_enrollments_ensure_review on public.lpe_enrollments;
create trigger lpe_enrollments_ensure_review
  after insert on public.lpe_enrollments
  for each row execute function private.ensure_lpe_review();

drop trigger if exists lpe_reviews_roll_next on public.lpe_reviews;
create trigger lpe_reviews_roll_next
  after update on public.lpe_reviews
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.ensure_lpe_review();

-- Daily reminder cron — enqueue a notification for reviews due within 3 days.
create or replace function private.queue_lpe_review_reminders()
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select r.organisation_id, r.patient_id, 'whatsapp', 'lifestyle_review_due',
         jsonb_build_object('review_id', r.id, 'due_date', r.due_date)
  from public.lpe_reviews r
  where r.status = 'pending'
    and r.reminder_sent_at is null
    and r.due_date <= current_date + 3;

  update public.lpe_reviews
    set reminder_sent_at = now()
    where status = 'pending' and reminder_sent_at is null and due_date <= current_date + 3;
end;
$$;

select cron.schedule(
  'lpe-review-reminders-daily',
  '55 6 * * *',
  $$select private.queue_lpe_review_reminders();$$
);
