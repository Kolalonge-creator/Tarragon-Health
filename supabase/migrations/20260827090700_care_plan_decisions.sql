-- Tarragon Health — Care Management Engine, step 7
--
-- care_plan_decisions: shared decision-making has never had anywhere to
-- live on this platform. Spec §3.17:
--
--   "The care plan should record: recommended option, alternatives, patient
--    preference, agreed plan, reason for decision. This helps create
--    genuinely patient-centred care."
--
-- Deliberately its own table rather than columns bolted onto care_plans or
-- care_plan_goals — a decision can stand alone ("which medication class to
-- start", "home BP monitor vs. clinic-only checks") without necessarily
-- being scoped to one specific goal, and a plan accumulates several of these
-- over its lifetime, not just one. decided_by is stamped server-side at
-- insert from the caller's own clinical_staff row, same null-gated
-- "ReviewedByDoctor" attribution rule as everywhere else on this platform —
-- never trusted from the client, and left null (rather than blocking the
-- insert) for an org-staff caller with no clinical_staff record, exactly
-- like stamp_care_plan_review_prompt_action's own tolerance for that case.

create table public.care_plan_decisions (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  care_plan_id        uuid references public.care_plans (id) on delete set null,
  goal_id             uuid references public.care_plan_goals (id) on delete set null,
  recommended_option  text not null,
  alternatives        jsonb not null default '[]'::jsonb,
  patient_preference  text,
  agreed_plan         text not null,
  reason              text,
  decided_by          uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index care_plan_decisions_patient_idx on public.care_plan_decisions (patient_id, created_at desc);
create index care_plan_decisions_org_idx on public.care_plan_decisions (organisation_id);
create index care_plan_decisions_care_plan_idx on public.care_plan_decisions (care_plan_id);

-- Append-only record of what was actually decided and why — no update/delete
-- policy, same "correcting a mistake means recording a new decision, not
-- editing history" discipline as protocol_versions.
create or replace function private.stamp_care_plan_decision_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select id into new.decided_by
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;
  return new;
end;
$$;

create trigger care_plan_decisions_stamp_author
  before insert on public.care_plan_decisions
  for each row execute function private.stamp_care_plan_decision_author();

alter table public.care_plan_decisions enable row level security;

create policy care_plan_decisions_select on public.care_plan_decisions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy care_plan_decisions_insert on public.care_plan_decisions
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

grant select, insert on public.care_plan_decisions to authenticated;
