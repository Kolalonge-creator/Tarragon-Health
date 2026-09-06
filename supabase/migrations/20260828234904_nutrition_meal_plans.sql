-- Nigerian Nutrition Intelligence — 7-day meal planner (spec 19.8).
--
-- Each generation is a new, immutable row — "regenerate" just creates
-- another one; the UI shows the most recent by generated_at. `plan` is null
-- when generation failed (ai_status='failed') so the patient sees a plain
-- "couldn't generate this" rather than a broken empty plan.
--
-- Same "coaching guidance, never clinical" convention as nutrition_log_entries:
-- this never feeds patient_risk_scores/escalation and is never attributed to
-- a doctor. CKD patients never get a generated row at all (see
-- lib/nutrition/meal-plan-generate.ts) — CKD nutrition is complex enough
-- that a generic generated plan is exactly the "overly restrictive generic
-- recommendation" spec 19.6 says not to produce; those patients are pointed
-- at the dietitian-referral pathway (nutrition_referrals) instead, so no
-- CKD-specific row shape is needed here.

create table if not exists public.nutrition_meal_plans (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  generated_at      timestamptz not null default now(),
  -- Snapshot of the care_plan_condition values considered at generation time
  -- (conditions can change later; this records what actually shaped the plan).
  conditions        jsonb not null default '[]'::jsonb,
  budget_tier       public.food_cost_tier,
  preferences_note  text,
  -- Shape: { days: [{ day, meals: { breakfast/lunch/dinner/snack: [{food_code,
  -- food_name, quantity, unit, grams, rationale}] }, analysis: {...} }],
  -- summary, notes }. Every food_code/grams/analysis figure is validated and
  -- recomputed server-side against nigerian_foods — never trusted as the
  -- model's own arithmetic (see meal-plan-validate.ts). Null when generation
  -- failed.
  plan              jsonb,
  ai_status         text not null default 'generated'
                      check (ai_status in ('generated', 'unavailable', 'failed')),
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists nutrition_meal_plans_patient_idx
  on public.nutrition_meal_plans (patient_id, generated_at desc);
create index if not exists nutrition_meal_plans_org_idx
  on public.nutrition_meal_plans (organisation_id);

drop trigger if exists nutrition_meal_plans_set_updated_at on public.nutrition_meal_plans;
create trigger nutrition_meal_plans_set_updated_at
  before update on public.nutrition_meal_plans
  for each row execute function private.set_updated_at();

alter table public.nutrition_meal_plans enable row level security;

drop policy if exists nutrition_meal_plans_select on public.nutrition_meal_plans;
create policy nutrition_meal_plans_select on public.nutrition_meal_plans
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists nutrition_meal_plans_insert on public.nutrition_meal_plans;
create policy nutrition_meal_plans_insert on public.nutrition_meal_plans
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

-- No update policy: a generated plan is immutable — regenerating creates a
-- new row rather than editing an old one, so there is nothing to correct in
-- place (unlike nutrition_log_entries, where a patient adjusts their own
-- carb estimate after the fact).
grant select, insert on public.nutrition_meal_plans to authenticated;
