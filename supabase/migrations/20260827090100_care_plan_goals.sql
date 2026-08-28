-- Tarragon Health — Care Management Engine, step 2
--
-- care_plan_goals already exists, created live yesterday by
-- 20260827205255_care_plan_management.sql (Care Team / Provider Workspace
-- §5.14) — organisation_id/patient_id/care_plan_id/description/status
-- ('open'/'achieved'/'abandoned')/created_by/created_at/resolved_at, no
-- measurable-target concept, no patient-proposal path. This migration
-- EXTENDS that live table rather than recreating it (confirmed 0 live rows
-- before writing this — nothing to migrate, but the table/enum/RLS/grants
-- already exist and a second CREATE TABLE would simply fail).
--
-- Spec §3.6/§3.16/§3.17 needs three things the live table doesn't have yet:
--
--   "Goals should be specific, measurable, time-bound, clinically
--    appropriate... Patients should be able to set goals... Clinicians can
--    approve or modify goals where clinically relevant... The care plan
--    should record: recommended option, alternatives, patient preference,
--    agreed plan, reason for decision."
--
-- (shared decision-making fields land in care_plan_decisions, a later
-- migration in this series, kept separate because a decision can stand
-- alone — e.g. "which medication class" — without necessarily being tied to
-- one goal row.)
--
-- Status vocabulary: kept as the LIVE table's own ('open'/'achieved'/
-- 'abandoned'), not this feature's original ('active' in place of 'open') —
-- apps/web/src/app/(dashboard)/clinician/patients/[patientId]/
-- care-plan-management-section.tsx already ships filtering on
-- status === "open" (merged 2026-08-27, live in production); introducing a
-- second, parallel 'active' value with the same meaning as 'open' would
-- silently orphan that existing UI's filter and create exactly the kind of
-- duplicate-meaning enum this codebase's own engineering discipline warns
-- against. Only 'proposed' is genuinely new (§3.16's patient-goal-proposal
-- state) — nothing live has ever produced a proposed goal.
--
-- Source distinguishes WHO originated the goal — 'protocol' for the
-- automatically-generated defaults a programme template proposes (§3.5's
-- hybrid model), 'clinician' for one a doctor writes directly, 'patient' for
-- one a patient proposes themselves (§3.16). A patient-sourced goal starts
-- 'proposed' and can only ever be inserted at that status — approving it
-- (moving it to 'open') is a clinical decision same as every other
-- clinician-attribution surface on this platform: null-gated, server-stamped,
-- never client-supplied (see stamp_medication_review_completion,
-- stamp_care_plan_review_prompt_action for the same idiom).

alter type public.care_plan_goal_status add value if not exists 'proposed';

do $$ begin
  create type public.care_plan_goal_source as enum
    ('protocol', 'clinician', 'patient');
exception when duplicate_object then null; end $$;

alter table public.care_plan_goals
  -- Measurable target, kept structured rather than folded into prose so a
  -- dashboard can show real progress (e.g. metric='bp_readings_per_week',
  -- target_value=3, target_unit='readings'). All nullable: a goal like
  -- "stop smoking" is specific and time-bound without a numeric target.
  add column if not exists metric       text,
  add column if not exists target_value numeric,
  add column if not exists target_unit  text,
  add column if not exists target_date  date,
  add column if not exists source       public.care_plan_goal_source not null default 'clinician',
  add column if not exists proposed_by  uuid references public.profiles (id) on delete set null,
  add column if not exists approved_by  uuid references public.clinical_staff (id) on delete set null,
  add column if not exists approved_at  timestamptz,
  add column if not exists updated_at   timestamptz not null default now();

create index if not exists care_plan_goals_patient_status_idx on public.care_plan_goals (patient_id, status);

drop trigger if exists care_plan_goals_set_updated_at on public.care_plan_goals;
create trigger care_plan_goals_set_updated_at
  before update on public.care_plan_goals
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Approval attribution — server-derived, same rule as every other
-- "reviewed/approved by" column on this platform: never trust the client.
-- Fires on the transition INTO 'open' regardless of who performed the
-- update (a protocol-sourced goal inserted directly as 'open' never passes
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
  if new.status = 'open' and old.status is distinct from 'open' then
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

drop trigger if exists care_plan_goals_stamp_approval on public.care_plan_goals;
create trigger care_plan_goals_stamp_approval
  before update on public.care_plan_goals
  for each row execute function private.stamp_care_plan_goal_approval();

-- ---------------------------------------------------------------------------
-- RLS — the live table already has care_plan_goals_select (patient own /
-- org staff / consented sponsor via can_read_clinical — a superset of what
-- this feature needs, left untouched) and care_plan_goals_write ("for all",
-- org-staff-only — still covers every staff insert/update/delete). The only
-- gap is §3.16's patient self-proposal path: ADD a second, narrower INSERT
-- policy alongside the existing one rather than replacing it — Postgres ORs
-- multiple permissive policies for the same command, so org staff keep
-- their existing unrestricted insert and a patient gains exactly one more:
-- proposing a goal for themselves, and only ever in the shape this check
-- clause allows.
-- ---------------------------------------------------------------------------
drop policy if exists care_plan_goals_patient_propose_insert on public.care_plan_goals;
create policy care_plan_goals_patient_propose_insert on public.care_plan_goals
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and status = 'proposed'
    and source = 'patient'
    and approved_by is null
    and approved_at is null
  );

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'care_plan_goal_status' and e.enumlabel = 'proposed'
  ) then
    raise exception 'care_plan_goal_status.proposed was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_goals' and column_name = 'metric'
  ) then
    raise exception 'care_plan_goals.metric was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_goals' and column_name = 'source'
  ) then
    raise exception 'care_plan_goals.source was not added';
  end if;
  if not exists (
    select 1 from pg_policy where polname = 'care_plan_goals_patient_propose_insert'
      and polrelid = 'public.care_plan_goals'::regclass
  ) then
    raise exception 'care_plan_goals_patient_propose_insert policy was not created';
  end if;
  raise notice 'PASS: care_plan_goals extended (metric/target/source/proposal columns, proposed status, patient-propose insert policy)';
end $$;
