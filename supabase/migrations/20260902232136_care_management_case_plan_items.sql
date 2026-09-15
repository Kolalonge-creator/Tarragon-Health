-- Tarragon Health — Chronic Disease Case Management (Module 74), part 2/5:
-- case goals + the Problem→Goal→Intervention→Owner→Deadline→Outcome case
-- plan (74.5/74.6).
--
-- Deliberately NOT a new parallel table. care_plan_goals/care_plan_interventions
-- (20260827205255, built two days before this series) already model exactly
-- this shape — a description + status for goals, a description + frequency +
-- status for interventions, both already versioned/RLS'd/patient-readable.
-- Forking a second "case goal"/"case plan item" table here would repeat the
-- same one-source-of-truth mistake CLAUDE.md's Annual Health Review rule and
-- that migration's own header both warn against.
--
-- Instead: care_plan_id becomes optional and a new case_id becomes its
-- sibling (a goal/intervention belongs to exactly one of a condition-level
-- care_plan or a cross-condition care_management_case, enforced by the CHECK
-- below) — and care_plan_interventions gains the four columns 74.6's chain
-- needs that a condition-level intervention never carried: problem (the
-- "Problem" step — what this row is addressing), goal_id (links the
-- "Intervention" row to the specific "Goal" row it serves), owner_id (WHO is
-- responsible — 74.6's "Owner"), deadline ("Deadline"), outcome ("Outcome").
-- A single care_plan_interventions row scoped to a case therefore carries
-- the full Problem→Goal→Intervention→Owner→Deadline→Outcome chain: problem +
-- goal_id (→ the linked goal's description) + description (the
-- intervention itself) + owner_id + deadline + outcome.
--
-- Condition-level interventions (case_id null) are entirely unaffected —
-- the four new columns stay null for every existing row and every existing
-- write path (care-plan-management-section.tsx never sets them).

alter table public.care_plan_goals
  alter column care_plan_id drop not null,
  add column if not exists case_id uuid references public.care_management_cases (id) on delete cascade;

alter table public.care_plan_goals
  add constraint care_plan_goals_scope_check
  check (care_plan_id is not null or case_id is not null);

create index if not exists care_plan_goals_case_idx on public.care_plan_goals (case_id) where case_id is not null;

alter table public.care_plan_interventions
  alter column care_plan_id drop not null,
  add column if not exists case_id uuid references public.care_management_cases (id) on delete cascade,
  add column if not exists problem text,
  add column if not exists goal_id uuid references public.care_plan_goals (id) on delete set null,
  add column if not exists owner_id uuid references public.clinical_staff (id) on delete set null,
  add column if not exists deadline date,
  add column if not exists outcome text;

alter table public.care_plan_interventions
  add constraint care_plan_interventions_scope_check
  check (care_plan_id is not null or case_id is not null);

alter table public.care_plan_interventions
  add constraint care_plan_interventions_problem_length check (problem is null or char_length(problem) <= 500);
alter table public.care_plan_interventions
  add constraint care_plan_interventions_outcome_length check (outcome is null or char_length(outcome) <= 1000);

create index if not exists care_plan_interventions_case_idx on public.care_plan_interventions (case_id) where case_id is not null;
create index if not exists care_plan_interventions_owner_idx on public.care_plan_interventions (owner_id) where owner_id is not null;
-- 74.6 "outstanding actions" query (close_care_management_case's gate, part
-- 3): a case-scoped intervention with no recorded outcome yet.
create index if not exists care_plan_interventions_case_outstanding_idx
  on public.care_plan_interventions (case_id)
  where case_id is not null and status = 'active' and outcome is null;

comment on column public.care_plan_interventions.problem is
  '74.6 case plan chain, case-scoped rows only (case_id not null): the problem this intervention addresses. Null for condition-level (care_plan_id) rows.';
comment on column public.care_plan_interventions.goal_id is
  '74.6 case plan chain: links this intervention to the care_plan_goals row it serves. Nullable — a case plan item need not always trace to a formally-tracked goal.';
comment on column public.care_plan_interventions.owner_id is
  '74.6 case plan chain: who owns this action. clinical_staff, not profiles, matching the attribution pattern used throughout this codebase (reviewed_by, recorded_by).';
comment on column public.care_plan_interventions.outcome is
  '74.6 case plan chain: recorded when the intervention concludes. A case-scoped intervention with status=active and outcome still null counts as an OUTSTANDING action for close_care_management_case''s gate (74.14).';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_goals'
      and column_name = 'care_plan_id' and is_nullable = 'NO'
  ) then
    raise exception 'care_plan_goals.care_plan_id is still NOT NULL';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_interventions' and column_name = 'owner_id'
  ) then
    raise exception 'care_plan_interventions.owner_id was not added';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'care_plan_interventions_scope_check'
  ) then
    raise exception 'care_plan_interventions_scope_check was not created';
  end if;
  raise notice 'PASS: care_plan_goals/care_plan_interventions extended for case scoping + 74.6 chain columns';
end $$;
