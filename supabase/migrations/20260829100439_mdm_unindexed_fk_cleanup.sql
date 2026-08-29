-- Tarragon Health — Health Data Architecture & MDM: unindexed-FK cleanup.

create index if not exists data_quality_findings_resolved_by_idx
  on public.data_quality_findings (resolved_by) where resolved_by is not null;

create index if not exists data_retention_policies_reviewed_by_idx
  on public.data_retention_policies (reviewed_by) where reviewed_by is not null;

create index if not exists patient_match_candidates_reviewed_by_idx
  on public.patient_match_candidates (reviewed_by) where reviewed_by is not null;

create index if not exists superseded_source_values_attempted_by_idx
  on public.superseded_source_values (attempted_by) where attempted_by is not null;

create index if not exists superseded_source_values_organisation_idx
  on public.superseded_source_values (organisation_id) where organisation_id is not null;

create index if not exists unit_conversions_to_unit_idx
  on public.unit_conversions (to_unit_id);
