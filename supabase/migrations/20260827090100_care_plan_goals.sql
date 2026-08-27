-- Tarragon Health — Care Management Engine, step 2
--
-- care_plan_goals: the platform has never had a structured, trackable goal —
-- care_plans.target_ranges is a free-form jsonb blob with no status, no
-- owner, no way for a patient to propose one. Spec §3.6/§3.16/§3.17:
--
--   "Goals should be specific, measurable, time-bound, clinically
--    appropriate... Patients should be able to set goals... Clinicians can
--    approve or modify goals where clinically relevant... The care plan
--    should record: recommended option, alternatives, patient preference,
--    agreed plan, reason for decision."
--
-- This migration builds the goal record itself (shared decision-making
-- fields land in care_plan_decisions, a later migration in this series, kept
-- separate because a decision can stand alone — e.g. "which medication
-- class" — without necessarily being tied to one goal row).
--
-- Source distinguishes WHO originated the goal — 'protocol' for the
-- automatically-generated defaults a programme template proposes (§3.5's
-- hybrid model), 'clinician' for one a doctor writes directly, 'patient' for
-- one a patient proposes themselves (§3.16). A patient-sourced goal starts
-- 'proposed' and can only ever be inserted at that status — approving it
-- (moving it to 'active') is a clinical decision same as every other
-- clinician-attribution surface on this platform: null-gated, server-stamped,
-- never client-supplied (see stamp_medication_review_completion,
-- stamp_care_plan_review_prompt_action for the same idiom).

do $$ begin
  create type public.care_plan_goal_status as enum
    ('proposed', 'active', 'achieved', 'abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.care_plan_goal_source as enum
    ('protocol', 'clinician', 'patient');
exception when duplicate_object then null; end $$;

create table public.care_plan_goals (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  care_plan_id      uuid references public.care_plans (id) on delete set null,
  description       text not null,
  -- Measurable target, kept structured rather than folded into prose so a
  -- dashboard can show real progress (e.g. metric='bp_readings_per_week',
  -- target_value=3, target_unit='readings'). All nullable: a goal like
  -- "stop smoking" is specific and time-bound without a numeric target.
  metric            text,
  target_value      numeric,
  target_unit       text,
  target_date       date,
  status            public.care_plan_goal_status not null default 'active',
  source            public.care_plan_goal_source not null default 'clinician',
  proposed_by       uuid references public.profiles (id) on delete set null,
  approved_by       uuid references public.clinical_staff (id) on delete set null,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index care_plan_goals_patient_idx on public.care_plan_goals (patient_id, status);
create index care_plan_goals_org_idx on public.care_plan_goals (organisation_id);
create index care_plan_goals_care_plan_idx on public.care_plan_goals (care_plan_id);

create trigger care_plan_goals_set_updated_at
  before update on public.care_plan_goals
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Approval attribution — server-derived, same rule as every other
-- "reviewed/approved by" column on this platform: never trust the client.
-- Fires on the transition INTO 'active' regardless of who performed the
-- update (a protocol-sourced goal inserted directly as 'active' never passes
-- through this — approved_by stays null for it, which is correct: nobody
-- individually approved a protocol default, the programme did).
-- ---------------------------------------------------------------------------
create or replace function private.stamp_care_plan_goal_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.approved_by := v_staff_id;
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end;
$$;

create trigger care_plan_goals_stamp_approval
  before update on public.care_plan_goals
  for each row execute function private.stamp_care_plan_goal_approval();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.care_plan_goals enable row level security;

create policy care_plan_goals_select on public.care_plan_goals
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Org staff may create any goal (protocol-templated inserts run through the
-- SECURITY DEFINER seeding function, which bypasses RLS as the definer, same
-- as private.queue_care_outreach() already does against care_outreach_tasks).
-- A patient may ALSO insert — but only ever a 'proposed', 'patient'-sourced
-- goal for themselves; the check clause is the only thing standing between
-- this and a patient inserting an already-active, clinician-attributed goal.
create policy care_plan_goals_insert on public.care_plan_goals
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    or (
      patient_id = (select auth.uid())
      and status = 'proposed'
      and source = 'patient'
      and approved_by is null
      and approved_at is null
    )
  );

-- Approving/modifying a goal (including a patient's proposed one) is a care-
-- team action, not a patient one — matches §3.16 "Clinicians can approve or
-- modify goals where clinically relevant."
create policy care_plan_goals_update on public.care_plan_goals
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy care_plan_goals_delete on public.care_plan_goals
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_plan_goals to authenticated;
