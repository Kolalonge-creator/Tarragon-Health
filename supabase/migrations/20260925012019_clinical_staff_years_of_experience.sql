-- Founder decision 2026-09-25: Nigerian patients don't recognise an MDCN/NMCN
-- registration number as a credibility signal. Patient-facing attribution
-- (ReviewedByDoctor and its siblings) switches from showing credential_type +
-- credential_number to specialty + years_of_experience. credential_type/
-- credential_number stay on clinical_staff unchanged for internal licence
-- verification only (docs/CLINICAL_TRUST_MODEL_SPEC.md §5) — this migration
-- only adds the new field, it does not touch the credential columns.
-- Mirrors specialist_providers.years_of_experience
-- (20260829142444_specialist_provider_profile_enrichment.sql).
alter table public.clinical_staff
  add column if not exists years_of_experience smallint;

alter table public.clinical_staff
  drop constraint if exists clinical_staff_years_of_experience_range;

alter table public.clinical_staff
  add constraint clinical_staff_years_of_experience_range
  check (years_of_experience is null or (years_of_experience between 0 and 80));

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_staff' and column_name = 'years_of_experience'
  ) then
    raise exception 'clinical_staff.years_of_experience was not created';
  end if;
end $$;
