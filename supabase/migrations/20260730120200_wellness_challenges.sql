-- Wellness gamification, part 3: time-boxed challenges. Scoped to metrics the
-- platform can actually measure today from logged activity — deliberately
-- NOT step-count/MVPA challenges, since consumer wearables are still
-- schema-scaffolded/dormant (no real provider credentials — see the Device &
-- Wearable Integration section of CLAUDE.md). When wearables go live, a
-- 'wearable_steps' metric can be added the same way as any other.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'wellness_challenge_metric') then
    create type public.wellness_challenge_metric as enum
      ('vitals_logs', 'meal_logs', 'adherence_checkins', 'lpe_tasks', 'education_lessons');
  end if;
  if not exists (select 1 from pg_type where typname = 'wellness_challenge_status') then
    create type public.wellness_challenge_status as enum ('active', 'completed', 'expired');
  end if;
end $$;

create table public.wellness_challenges (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  title         text not null,
  description   text,
  metric        public.wellness_challenge_metric not null,
  target_count  integer not null check (target_count > 0),
  duration_days integer not null check (duration_days > 0),
  points_reward integer not null default 0 check (points_reward >= 0),
  badge_id      uuid references public.wellness_badges (id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.patient_challenge_enrolments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  challenge_id    uuid not null references public.wellness_challenges (id) on delete restrict,
  status          public.wellness_challenge_status not null default 'active',
  started_at      timestamptz not null default now(),
  target_end_at   timestamptz not null,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index patient_challenge_enrolments_patient_idx
  on public.patient_challenge_enrolments (patient_id, status);
-- At most one active enrolment per patient per challenge at a time.
create unique index patient_challenge_enrolments_one_active
  on public.patient_challenge_enrolments (patient_id, challenge_id) where status = 'active';

drop trigger if exists wellness_challenges_set_updated_at on public.wellness_challenges;
create trigger wellness_challenges_set_updated_at
  before update on public.wellness_challenges
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Shared progress counter — used by both the patient-facing progress RPC and
-- the nightly completion sweep, so there is exactly one place metric ->
-- source-table mapping lives.
-- ---------------------------------------------------------------------------
create or replace function private.wellness_challenge_metric_count(
  p_patient uuid,
  p_metric public.wellness_challenge_metric,
  p_from timestamptz,
  p_to timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_count integer;
begin
  if p_metric = 'vitals_logs' then
    select count(*) into v_count from public.vitals_readings
      where patient_id = p_patient and created_at between p_from and p_to;
  elsif p_metric = 'meal_logs' then
    select count(*) into v_count from public.nutrition_log_entries
      where patient_id = p_patient and logged_at between p_from and p_to;
  elsif p_metric = 'adherence_checkins' then
    select count(*) into v_count from public.medication_adherence_checkins
      where patient_id = p_patient and status = 'responded'
        and responded_at between p_from and p_to;
  elsif p_metric = 'lpe_tasks' then
    select count(*) into v_count from public.lpe_task_instances
      where patient_id = p_patient and status = 'done'
        and completed_at between p_from and p_to;
  elsif p_metric = 'education_lessons' then
    select count(*) into v_count from public.health_education_progress
      where patient_id = p_patient and status = 'understood'
        and updated_at between p_from and p_to;
  else
    v_count := 0;
  end if;
  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

create or replace function public.enrol_in_wellness_challenge(p_challenge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_challenge public.wellness_challenges%rowtype;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select * into v_challenge from public.wellness_challenges
    where id = p_challenge_id and is_active;
  if not found then raise exception 'That challenge isn''t available right now.'; end if;
  select organisation_id into v_org from public.profiles where id = v_caller;
  if v_org is null then raise exception 'profile has no organisation'; end if;

  insert into public.patient_challenge_enrolments
    (organisation_id, patient_id, challenge_id, target_end_at)
  values (v_org, v_caller, p_challenge_id, now() + make_interval(days => v_challenge.duration_days))
  returning id into v_id;

  return v_id;
exception when unique_violation then
  raise exception 'You already have this challenge active.';
end;
$$;

create or replace function public.wellness_challenge_progress(p_enrolment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrol public.patient_challenge_enrolments%rowtype;
  v_challenge public.wellness_challenges%rowtype;
  v_count integer;
begin
  select * into v_enrol from public.patient_challenge_enrolments where id = p_enrolment_id;
  if not found then raise exception 'not found'; end if;
  if v_enrol.patient_id <> auth.uid() and not private.is_org_staff(v_enrol.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_challenge from public.wellness_challenges where id = v_enrol.challenge_id;
  v_count := private.wellness_challenge_metric_count(
    v_enrol.patient_id, v_challenge.metric, v_enrol.started_at, least(now(), v_enrol.target_end_at));

  return jsonb_build_object('progress', v_count, 'target', v_challenge.target_count);
end;
$$;

revoke execute on function public.enrol_in_wellness_challenge(uuid) from public, anon;
revoke execute on function public.wellness_challenge_progress(uuid) from public, anon;
grant execute on function public.enrol_in_wellness_challenge(uuid) to authenticated;
grant execute on function public.wellness_challenge_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Nightly sweep: complete or expire every active enrolment. Completion pays
-- the challenge's points + (if set) its badge directly — challenge_completions
-- criteria badges still pick it up too via check_and_award_wellness_badges,
-- called inside award_wellness_points.
-- ---------------------------------------------------------------------------
create or replace function private.evaluate_wellness_challenges()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer;
begin
  for v_row in
    select e.*, c.metric, c.target_count, c.points_reward, c.badge_id
    from public.patient_challenge_enrolments e
    join public.wellness_challenges c on c.id = e.challenge_id
    where e.status = 'active'
  loop
    v_count := private.wellness_challenge_metric_count(
      v_row.patient_id, v_row.metric, v_row.started_at, least(now(), v_row.target_end_at));

    if v_count >= v_row.target_count then
      update public.patient_challenge_enrolments
        set status = 'completed', completed_at = now()
        where id = v_row.id;

      perform private.award_wellness_points(
        v_row.patient_id, v_row.points_reward, 'challenge_completed',
        'patient_challenge_enrolments', v_row.id);

      if v_row.badge_id is not null then
        insert into public.patient_wellness_badges (organisation_id, patient_id, badge_id)
        values (v_row.organisation_id, v_row.patient_id, v_row.badge_id)
        on conflict (patient_id, badge_id) do nothing;
      end if;
    elsif now() > v_row.target_end_at then
      update public.patient_challenge_enrolments
        set status = 'expired'
        where id = v_row.id;
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'wellness-challenges-evaluate-daily',
  '20 3 * * *',
  $$select private.evaluate_wellness_challenges();$$
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.wellness_challenges enable row level security;
alter table public.patient_challenge_enrolments enable row level security;

create policy wellness_challenges_select on public.wellness_challenges
  for select to authenticated using (is_active or private.is_admin());
create policy wellness_challenges_write on public.wellness_challenges
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- Read-only for authenticated; every write happens inside the definer RPCs/
-- cron above (no INSERT/UPDATE policy — a patient can't hand-edit progress).
create policy patient_challenge_enrolments_select on public.patient_challenge_enrolments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.wellness_challenges to authenticated;
grant select on public.patient_challenge_enrolments to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: 3 starter challenges built from metrics the platform already logs.
-- ---------------------------------------------------------------------------
insert into public.wellness_challenges (code, title, description, metric, target_count, duration_days, points_reward) values
  ('vitals_week',   '5-Day Vitals Streak', 'Log a vitals reading on 5 different days this week.', 'vitals_logs', 5, 7, 100),
  ('meal_week',     'Meal Log Week',       'Log 5 meals this week.',                                'meal_logs', 5, 7, 100),
  ('learn_3',       'Learn 3 Lessons',     'Complete 3 health education lessons.',                  'education_lessons', 3, 14, 150)
on conflict (code) do nothing;
