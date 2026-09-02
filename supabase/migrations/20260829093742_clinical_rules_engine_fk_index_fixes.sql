-- Tarragon Health — Clinical Rules & Care Protocol Engine, part 5b: two FK
-- covering indexes flagged by get_advisors (performance) after part 1/2
-- shipped: clinical_rules.approved_by and clinical_rule_suppressions.patient_id
-- were each missing a covering index, matching the "uncovered FK index"
-- performance-finding pattern already fixed once elsewhere on this project.

create index clinical_rules_approved_by_idx on public.clinical_rules (approved_by) where approved_by is not null;
create index clinical_rule_suppressions_patient_idx on public.clinical_rule_suppressions (patient_id) where patient_id is not null;
