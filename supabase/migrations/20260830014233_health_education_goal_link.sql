-- Tarragon Health — Health Education: wire the learn -> goal -> track loop
-- (§79.14). REVERSAL of docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md §1
-- locked decision #2 ("behaviour change is NOT a schema concept") — done on
-- explicit founder confirmation (2026-08-30). The original objection was
-- that asserting behaviour changed would be an unverifiable clinical claim;
-- that concern is respected by NOT adding a new claim anywhere — this only
-- wires education content to the platform's EXISTING, already-governed goal
-- system (`care_plan_goals`, patient-proposable, clinician-approved,
-- tracked via its own open/achieved/abandoned status), the same way a
-- clinician- or protocol-sourced goal already works. No new table, no new
-- "behaviour changed" flag — just a pointer to which lesson inspired a
-- goal a patient chose to propose.
--
-- Reconciliation note: `care_plan_goals` was NOT built by this migration
-- sequence — it already existed live with a patient-propose RLS policy
-- (`care_plan_goals_patient_propose_insert`: patient_id=self, status=
-- 'proposed', source='patient', approved_by/at null) that already covers
-- exactly this use case. This migration only adds the missing link column;
-- no new RLS is needed because the existing policy doesn't reference the
-- new column at all.

alter table public.care_plan_goals
  add column if not exists source_content_id uuid references public.health_education_content (id) on delete set null;

create index if not exists care_plan_goals_source_content_idx
  on public.care_plan_goals (source_content_id) where source_content_id is not null;

comment on column public.care_plan_goals.source_content_id is
  'Health-education lesson that prompted this goal, if any (§79.14 learn -> goal -> track loop). Null for clinician/protocol/LPE-originated goals.';
