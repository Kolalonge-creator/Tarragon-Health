-- Tarragon Health
-- Clinical Governance gap-closure, item 2 of 6 (§88.11 "root-cause analysis"
-- — completing a PARTIAL item). Confirmed live before writing this:
-- clinical_incident_reports has contributing_factors (freetext, since
-- 2026-08-26) but no structured taxonomy -- the spec asks for human
-- factors / system design / training / communication / technical failure /
-- process failure as queryable categories, not just prose a governance
-- reviewer has to read one row at a time. contributing_factors is kept
-- exactly as-is (a real narrative still matters); this is additive.
--
-- Nullable, not required: root-causing is downstream of review, which is
-- itself optional until status moves past 'open' -- forcing this at file
-- time would ask a Care Coordinator filing a near-miss to diagnose a root
-- cause they may have no clinical standing to name. Same posture as
-- review_outcome/corrective_action, which are also nullable until closed.

alter table public.clinical_incident_reports
  add column root_cause_category text;

alter table public.clinical_incident_reports
  add constraint clinical_incident_reports_root_cause_category_check check (
    root_cause_category is null or root_cause_category in (
      'human_factors', 'system_design', 'training', 'communication', 'technical_failure', 'process_failure'
    )
  );

comment on column public.clinical_incident_reports.root_cause_category is
  'Structured RCA taxonomy per docs spec §88.11 -- human_factors/system_design/training/communication/technical_failure/process_failure. Nullable: set during review, not required to file. contributing_factors (freetext) is unchanged and still the narrative account; this is the queryable category alongside it.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_incident_reports' and column_name = 'root_cause_category'
  ) then
    raise exception 'clinical_incident_reports.root_cause_category missing';
  end if;
  if exists (select 1 from public.clinical_incident_reports where root_cause_category is not null) then
    raise exception 'unexpected: an existing row already has a root_cause_category value before this migration could have set one';
  end if;
  raise notice 'PASS: clinical_incident_reports.root_cause_category added, zero existing rows affected';
end $$;
