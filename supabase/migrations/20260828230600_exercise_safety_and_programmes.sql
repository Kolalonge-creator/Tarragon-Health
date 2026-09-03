-- Lifestyle Management Platform §18.5/§18.6 — exercise programmes + safety.
--
-- Gap found by audit: no PAR-Q-style pre-exercise screen anywhere, and no
-- graded exercise-programme catalogue (lpe_content_blocks/lpe_goal_templates
-- exist but the seeded content is generic, not beginner-walking/cardio/
-- mobility/chronic-disease-specific structured programmes). Spec §18.6 is
-- explicit: "It should never assume exercise is always safe for everyone" —
-- so the gate below is enforced by a DB trigger, not just a UI check that a
-- direct API call could skip, matching this codebase's "RLS/DB enforces,
-- app never bypasses" posture.
--
-- Clinical judgement stays null-gated exactly like doctor_tier/reviewed_by
-- elsewhere: cleared_for_intensive starts false and is NEVER inferred from
-- the screen's own answers — only a clinician sets it, via reviewed_by/
-- reviewed_at, same pattern as obesity_assessments.clinical_status.

create type public.exercise_programme_category as enum (
  'beginner_walking', 'weight_management', 'cardiovascular_fitness', 'mobility', 'chronic_disease_specific'
);

create type public.exercise_intensity_level as enum ('beginner', 'moderate', 'vigorous');

-- A lightweight PAR-Q-style pre-exercise screen. any_flag is derived, never
-- entered directly, so it can't drift from the answers it's computed from.
create table public.exercise_readiness_screens (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  chest_pain             boolean not null default false,
  dizziness_or_balance   boolean not null default false,
  joint_bone_problem     boolean not null default false,
  doctor_advised_limit   boolean not null default false,
  heart_or_bp_condition  boolean not null default false,
  other_concern          text,
  any_flag               boolean generated always as (
    chest_pain or dizziness_or_balance or joint_bone_problem or doctor_advised_limit or heart_or_bp_condition
  ) stored,
  reviewed_by            uuid references public.clinical_staff (id) on delete set null,
  reviewed_at            timestamptz,
  cleared_for_intensive  boolean not null default false,
  created_at             timestamptz not null default now(),
  constraint exercise_readiness_screens_clearance_needs_review
    check (not cleared_for_intensive or reviewed_by is not null)
);

comment on column public.exercise_readiness_screens.cleared_for_intensive is
  'A clinician''s explicit sign-off that this patient may start a vigorous programme, or a flagged moderate one. Defaults false and is only ever set by a clinician action — never inferred from any_flag, same null-gating discipline as clinical_staff.doctor_tier.';

create index exercise_readiness_screens_patient_idx on public.exercise_readiness_screens (patient_id, created_at desc);
create index exercise_readiness_screens_org_idx on public.exercise_readiness_screens (organisation_id);

alter table public.exercise_readiness_screens enable row level security;

create policy exercise_readiness_screens_select on public.exercise_readiness_screens
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
-- Patients submit their own screen; org staff may also record one (e.g. a
-- clinician completing it with the patient in a consult).
create policy exercise_readiness_screens_insert on public.exercise_readiness_screens
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id()
      and reviewed_by is null and cleared_for_intensive = false)
    or private.is_org_staff(organisation_id));
-- Only staff may update a screen — that's exactly the review/clearance step;
-- a patient's own past screen answers are a point-in-time record, not
-- self-editable after the fact.
create policy exercise_readiness_screens_update on public.exercise_readiness_screens
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.exercise_readiness_screens to authenticated;
revoke all on public.exercise_readiness_screens from anon;

-- Reference content catalogue (spec §18.5) — same "honest starter copy, a
-- clinician reviews/expands later" posture as lpe_content_blocks; every
-- seed row below ships with clinician_reviewed = false.
create table public.exercise_programmes (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique,
  title              text not null,
  category           public.exercise_programme_category not null,
  intensity_level    public.exercise_intensity_level not null,
  condition_tags     public.care_plan_condition[] not null default '{}',
  summary            text not null,
  -- Staged weekly structure, e.g. [{"week":1,"focus":"...","detail":"..."}]
  -- — the same "week-by-week" shape spec §18.12 describes.
  weekly_plan        jsonb not null default '[]',
  clinician_reviewed boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index exercise_programmes_category_idx on public.exercise_programmes (category);

create trigger set_updated_at before update on public.exercise_programmes
  for each row execute function private.set_updated_at();

alter table public.exercise_programmes enable row level security;

-- Reference content: anyone signed in can browse it; only admin can author.
create policy exercise_programmes_select on public.exercise_programmes
  for select to authenticated
  using (is_active or private.is_admin());
create policy exercise_programmes_all on public.exercise_programmes
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select on public.exercise_programmes to authenticated;
grant insert, update, delete on public.exercise_programmes to authenticated;
revoke all on public.exercise_programmes from anon;

create table public.patient_exercise_enrollments (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id     uuid not null references public.profiles (id) on delete cascade,
  programme_id   uuid not null references public.exercise_programmes (id) on delete restrict,
  status         text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create unique index patient_exercise_enrollments_active_uidx
  on public.patient_exercise_enrollments (patient_id, programme_id)
  where status = 'active';
create index patient_exercise_enrollments_patient_idx on public.patient_exercise_enrollments (patient_id);
create index patient_exercise_enrollments_org_idx on public.patient_exercise_enrollments (organisation_id);

alter table public.patient_exercise_enrollments enable row level security;

create policy patient_exercise_enrollments_select on public.patient_exercise_enrollments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_exercise_enrollments_insert on public.patient_exercise_enrollments
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id));
create policy patient_exercise_enrollments_update on public.patient_exercise_enrollments
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy patient_exercise_enrollments_delete on public.patient_exercise_enrollments
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_exercise_enrollments to authenticated;
revoke all on public.patient_exercise_enrollments from anon;

-- The actual safety gate (spec §18.6). A beginner programme (walking,
-- mobility) needs no screen — broadly safe for almost anyone. A moderate
-- programme needs a screen with no red flags, or an explicit clinician
-- clearance if it did flag one. A vigorous programme always needs explicit
-- clinician clearance, flagged or not — "more intensive" always means
-- "ask a clinician first", never "assume it's fine".
create or replace function private.enforce_exercise_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intensity public.exercise_intensity_level;
  v_clear_moderate boolean;
  v_clear_vigorous boolean;
begin
  select intensity_level into v_intensity
  from public.exercise_programmes
  where id = new.programme_id;

  if v_intensity is null or v_intensity = 'beginner' then
    return new;
  end if;

  select
    exists (
      select 1 from public.exercise_readiness_screens
      where patient_id = new.patient_id and (not any_flag or cleared_for_intensive)
    ),
    exists (
      select 1 from public.exercise_readiness_screens
      where patient_id = new.patient_id and cleared_for_intensive
    )
  into v_clear_moderate, v_clear_vigorous;

  if v_intensity = 'moderate' and not v_clear_moderate then
    raise exception
      'Complete an exercise readiness screen before starting a moderate-intensity programme (or, if it flags a concern, wait for your care team to clear it).';
  end if;

  if v_intensity = 'vigorous' and not v_clear_vigorous then
    raise exception
      'A vigorous-intensity programme needs your care team''s clearance first — complete the exercise readiness screen and a clinician will review it.';
  end if;

  return new;
end;
$$;

create trigger enforce_exercise_readiness_trg
  before insert on public.patient_exercise_enrollments
  for each row execute function private.enforce_exercise_readiness();

-- Starter catalogue (spec §18.5's own named examples), honest placeholder
-- content pending clinical review — same convention as the LPE's own seed.
insert into public.exercise_programmes (key, title, category, intensity_level, condition_tags, summary, weekly_plan, clinician_reviewed) values
(
  'beginner_walking_4wk', 'Beginner Walking', 'beginner_walking', 'beginner', '{}',
  'A gentle four-week on-ramp to daily walking, for anyone starting from very little activity.',
  '[{"week":1,"focus":"Get moving","detail":"10 minutes of easy walking, most days."},
    {"week":2,"focus":"Build the habit","detail":"15 minutes, most days, same time each day if you can."},
    {"week":3,"focus":"A little further","detail":"20 minutes, most days, at a comfortable pace."},
    {"week":4,"focus":"Steady rhythm","detail":"25-30 minutes, most days — you''re ready for a daily step goal."}]'::jsonb,
  false
),
(
  'weight_management_6wk', 'Weight Management Movement Plan', 'weight_management', 'moderate', '{obesity}',
  'Combines walking with light strength work to support a weight goal, alongside nutrition and behavioural goals.',
  '[{"week":1,"focus":"Foundation","detail":"20 minutes walking, 5 days/week."},
    {"week":2,"focus":"Add strength","detail":"Walking plus 2 short bodyweight strength sessions."},
    {"week":3,"focus":"Consistency","detail":"30 minutes walking, 5 days/week, 2 strength sessions."},
    {"week":4,"focus":"Push a little","detail":"Add one slightly brisker walk each week."},
    {"week":5,"focus":"Hold steady","detail":"Keep the routine, watch how it feels."},
    {"week":6,"focus":"Review","detail":"Check in with your care team on progress and next steps."}]'::jsonb,
  false
),
(
  'cardio_builder_6wk', 'Cardiovascular Fitness Builder', 'cardiovascular_fitness', 'vigorous', '{cardiovascular,hypertension}',
  'A graded plan to build heart-and-lung fitness — always requires a clinician''s clearance first given the intensity.',
  '[{"week":1,"focus":"Baseline","detail":"Brisk 15-minute walks, noting how you feel."},
    {"week":2,"focus":"Intervals begin","detail":"Alternate 2 minutes brisk, 1 minute easy, for 20 minutes."},
    {"week":3,"focus":"Longer sessions","detail":"25-30 minutes with intervals, 4 days/week."},
    {"week":4,"focus":"Add a harder day","detail":"One session with shorter, harder intervals."},
    {"week":5,"focus":"Consolidate","detail":"Keep the routine, focus on recovery between sessions."},
    {"week":6,"focus":"Reassess","detail":"Care-team check-in before progressing further."}]'::jsonb,
  false
),
(
  'mobility_4wk', 'Mobility & Flexibility', 'mobility', 'beginner', '{}',
  'Gentle daily stretching and joint-mobility work — a good starting point for anyone with stiffness or limited movement.',
  '[{"week":1,"focus":"Learn the moves","detail":"10 minutes of guided stretches, daily."},
    {"week":2,"focus":"Full routine","detail":"15 minutes, covering all major joints."},
    {"week":3,"focus":"Add balance","detail":"Simple standing balance work alongside stretching."},
    {"week":4,"focus":"Make it a habit","detail":"Keep the full routine going most days."}]'::jsonb,
  false
),
(
  'hypertension_strength_basics_6wk', 'Hypertension-Safe Strength Basics', 'chronic_disease_specific', 'moderate', '{hypertension}',
  'Light resistance training paced for someone managing blood pressure — needs a readiness screen given the added exertion.',
  '[{"week":1,"focus":"Learn the basics","detail":"Bodyweight squats, wall push-ups, seated rows with a band."},
    {"week":2,"focus":"Build reps","detail":"Same moves, slightly more repetitions."},
    {"week":3,"focus":"Add a session","detail":"3 sessions/week instead of 2."},
    {"week":4,"focus":"Steady load","detail":"Hold the routine, watch your BP readings on session days."},
    {"week":5,"focus":"Progress gently","detail":"Add light resistance if BP has stayed steady."},
    {"week":6,"focus":"Review","detail":"Care-team check-in on BP trend and next steps."}]'::jsonb,
  false
),
(
  'diabetes_walking_plus_6wk', 'Diabetes-Safe Walking Plus', 'chronic_disease_specific', 'moderate', '{diabetes}',
  'Walking paced around meals and glucose checks, for someone managing diabetes.',
  '[{"week":1,"focus":"Post-meal walks","detail":"10-minute walk after your largest meal."},
    {"week":2,"focus":"Build duration","detail":"15-20 minutes after meals, most days."},
    {"week":3,"focus":"Add a morning walk","detail":"Short morning walk plus the post-meal habit."},
    {"week":4,"focus":"Steady rhythm","detail":"30 minutes total most days, split across the day."},
    {"week":5,"focus":"Hold it","detail":"Keep the routine, note how it affects your readings."},
    {"week":6,"focus":"Review","detail":"Care-team check-in on glucose trend and next steps."}]'::jsonb,
  false
);

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'exercise_readiness_screens') then
    raise exception 'FAIL: exercise_readiness_screens was not created';
  end if;
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'exercise_programmes') then
    raise exception 'FAIL: exercise_programmes was not created';
  end if;
  if (select count(*) from public.exercise_programmes) < 6 then
    raise exception 'FAIL: exercise_programmes starter catalogue did not seed';
  end if;
  raise notice 'PASS: exercise safety + programmes — tables, RLS, readiness gate installed';
end $$;
