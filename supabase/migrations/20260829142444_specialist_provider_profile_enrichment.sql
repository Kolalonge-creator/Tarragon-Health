-- Tarragon Health
-- Specialist Network & Provider Platform — specialist_providers profile
-- enrichment. This is the referral-network catalogue table (Tier 5/external
-- specialists a clinician refers a patient out to), not clinical_staff (the
-- employed Tier 1-5 ladder) — see docs/CLINICAL_NETWORK_SPEC.md §1 for why
-- those stay two separate models. Adds the profile fields the incoming
-- Specialist Network spec asks for that this table never carried:
-- subspecialty, qualifications, years_of_experience, clinical_interests, and
-- a descriptive provider_tier.
--
-- provider_tier is nullable and never inferred/defaulted — same principle
-- CLAUDE.md states for clinical_staff.doctor_tier ("Never infer or default a
-- doctor_tier in code"): an unset tier means an admin still needs to
-- classify the row. It is purely descriptive/filterable, never a
-- pricing/ranking signal — no scoring or automated matching is added by
-- this migration, per the CLINICAL_NETWORK_SPEC.md §3 guardrail.
--
-- Allied-professional specialist_type values (physiotherapist specifically)
-- are deliberately NOT added here: docs/Tarragon_Health_Master_Operating_
-- Plan_v4.md gates "Physiotherapy / rehab providers" referral pathway as
-- Phase 3, which conflicts with CLINICAL_NETWORK_SPEC.md §4's Phase-1
-- framing for the same thing (dietetics/psychiatry/psychology already exist
-- as specialist_type values with no such conflict). That disagreement is a
-- founder call, not this migration's to resolve.

create type public.specialist_provider_tier as enum (
  'primary_care',
  'specialist',
  'subspecialist',
  'allied_professional'
);

alter table public.specialist_providers
  add column if not exists subspecialty text,
  add column if not exists qualifications text[] not null default '{}',
  add column if not exists years_of_experience smallint,
  add column if not exists clinical_interests text[] not null default '{}',
  add column if not exists provider_tier public.specialist_provider_tier;

alter table public.specialist_providers
  add constraint specialist_providers_years_of_experience_range
    check (years_of_experience is null or (years_of_experience between 0 and 80));

comment on column public.specialist_providers.provider_tier is
  'Descriptive classification for the specialist directory (primary_care/specialist/subspecialist/allied_professional) — never inferred/defaulted, an admin must set it explicitly, same principle as clinical_staff.doctor_tier. Not a pricing/ranking signal.';
comment on column public.specialist_providers.qualifications is
  'Free-text list, e.g. {"MBBS", "FWACS", "MSc Cardiology"} — display-only. Checked during the verification pipeline (specialist_verification_stage), not independently validated against a registry API.';
comment on column public.specialist_providers.clinical_interests is
  'Free-text list of areas of clinical focus within the specialty, e.g. {"interventional cardiology", "heart failure"} — display-only, patient/clinician-facing context, not a matching signal.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'specialist_providers' and column_name = 'provider_tier'
  ) then
    raise exception 'specialist_providers.provider_tier was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'specialist_providers' and column_name = 'years_of_experience'
  ) then
    raise exception 'specialist_providers.years_of_experience was not created';
  end if;
end $$;
