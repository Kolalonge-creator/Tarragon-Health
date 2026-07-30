-- Wellness gamification, part 2: wire points onto EXISTING tables. Every
-- trigger here is additive (AFTER INSERT/UPDATE) and calls
-- private.award_wellness_points, which never raises — a gamification bug can
-- never block a vitals reading, a meal log, or a check-in from saving.
--
-- Daily-capped events use a synthetic per-(patient, reason, day) dedupe id
-- fed into the same unique index private.award_wellness_points already
-- relies on, so the cap is enforced by the INSERT itself (atomic) rather than
-- a separate check-then-insert that would race under concurrent requests.
-- Discrete one-time achievements (a lesson completed, a goal achieved) dedupe
-- on the source row's own id instead — no daily cap, since re-triggering the
-- same row is the only way to double-pay and that's already closed.

create or replace function private.wellness_daily_dedupe_id(p_patient uuid, p_reason text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select md5(p_patient::text || ':' || p_reason || ':' || current_date::text)::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 1. Vitals logged (manual or device) — habit formation for the "Log today's
--    reading" core loop.
-- ---------------------------------------------------------------------------
create or replace function private.wellness_points_on_vitals_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.award_wellness_points(
    new.patient_id, 10, 'vitals_logged',
    'daily_cap', private.wellness_daily_dedupe_id(new.patient_id, 'vitals_logged'));
  return new;
end;
$$;

drop trigger if exists vitals_readings_wellness_points on public.vitals_readings;
create trigger vitals_readings_wellness_points
  after insert on public.vitals_readings
  for each row execute function private.wellness_points_on_vitals_logged();

-- ---------------------------------------------------------------------------
-- 2. Meal logged (nutrition_log_entries — the existing meal-log feature).
-- ---------------------------------------------------------------------------
create or replace function private.wellness_points_on_meal_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.award_wellness_points(
    new.patient_id, 10, 'meal_logged',
    'daily_cap', private.wellness_daily_dedupe_id(new.patient_id, 'meal_logged'));
  return new;
end;
$$;

drop trigger if exists nutrition_log_entries_wellness_points on public.nutrition_log_entries;
create trigger nutrition_log_entries_wellness_points
  after insert on public.nutrition_log_entries
  for each row execute function private.wellness_points_on_meal_logged();

-- ---------------------------------------------------------------------------
-- 3. Medication adherence check-in answered.
-- ---------------------------------------------------------------------------
create or replace function private.wellness_points_on_adherence_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'responded' and old.status is distinct from 'responded' then
    perform private.award_wellness_points(
      new.patient_id, 15, 'adherence_checkin_completed',
      'daily_cap', private.wellness_daily_dedupe_id(new.patient_id, 'adherence_checkin_completed'));
  end if;
  return new;
end;
$$;

drop trigger if exists medication_adherence_checkins_wellness_points on public.medication_adherence_checkins;
create trigger medication_adherence_checkins_wellness_points
  after update on public.medication_adherence_checkins
  for each row execute function private.wellness_points_on_adherence_checkin();

-- ---------------------------------------------------------------------------
-- 4. Health education lesson marked understood.
-- ---------------------------------------------------------------------------
create or replace function private.wellness_points_on_lesson_understood()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'understood'
     and (tg_op = 'INSERT' or old.status is distinct from 'understood')
  then
    perform private.award_wellness_points(
      new.patient_id, 20, 'education_lesson_completed',
      'health_education_progress', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists health_education_progress_wellness_points on public.health_education_progress;
create trigger health_education_progress_wellness_points
  after insert or update on public.health_education_progress
  for each row execute function private.wellness_points_on_lesson_understood();

-- ---------------------------------------------------------------------------
-- 5. Lifestyle Programme Engine task completed.
-- ---------------------------------------------------------------------------
create or replace function private.wellness_points_on_lpe_task_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform private.award_wellness_points(
      new.patient_id, 15, 'lpe_task_completed',
      'daily_cap', private.wellness_daily_dedupe_id(new.patient_id, 'lpe_task_completed'));
  end if;
  return new;
end;
$$;

drop trigger if exists lpe_task_instances_wellness_points on public.lpe_task_instances;
create trigger lpe_task_instances_wellness_points
  after update on public.lpe_task_instances
  for each row execute function private.wellness_points_on_lpe_task_done();

-- ---------------------------------------------------------------------------
-- 6. Lifestyle Programme Engine goal achieved — a real milestone, bigger
--    reward, no daily cap (dedupes on the goal instance's own id).
--    lpe_goal_instances has no direct patient_id — resolve via
--    programme_instance -> enrollment, same join every LPE query uses.
-- ---------------------------------------------------------------------------
create or replace function private.wellness_points_on_lpe_goal_achieved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
begin
  if new.status = 'achieved' and old.status is distinct from 'achieved' then
    select e.patient_id into v_patient
    from public.lpe_programme_instances pi
    join public.lpe_enrollments e on e.id = pi.enrollment_id
    where pi.id = new.programme_instance_id;

    if v_patient is not null then
      perform private.award_wellness_points(
        v_patient, 50, 'lpe_goal_achieved', 'lpe_goal_instances', new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lpe_goal_instances_wellness_points on public.lpe_goal_instances;
create trigger lpe_goal_instances_wellness_points
  after update on public.lpe_goal_instances
  for each row execute function private.wellness_points_on_lpe_goal_achieved();
