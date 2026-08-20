-- Tarragon Health — FHIR interoperability, part 1: provenance enum values.
--
-- A reading/allergy/medication that arrived via a partner's FHIR Bundle
-- import is a distinct provenance from every value these enums already
-- carry (manual, device, wearable, cgm, clinician, patient, specialist) —
-- none of them mean "an HMO or hospital told us this about the patient,
-- and one of our own clinicians reviewed and accepted it." Losing that
-- distinction would make an imported record indistinguishable from
-- something a clinician typed in by hand, which is not true and matters
-- for later audit ("where did this come from").
--
-- This is its own migration file, deliberately: Postgres will not let a
-- newly added enum value be used inside the same transaction that added
-- it, and Supabase runs each migration file as one transaction. The
-- tables/trigger that actually INSERT rows using 'fhir_import' live in the
-- next migration, which runs (and therefore commits) strictly after this
-- one.
--
-- vaccination_records carries no provenance column at all today (only
-- verification_status) — see the next migration's header for how an
-- imported Immunization's provenance is represented there instead.

alter type public.vital_source add value if not exists 'fhir_import';
alter type public.medication_source add value if not exists 'fhir_import';
alter type public.allergy_source add value if not exists 'fhir_import';

-- ---------------------------------------------------------------------------
-- Assertions — catalog existence only. Never insert using the new value
-- here; see the header for why that would fail.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'vital_source' and e.enumlabel = 'fhir_import'
  ) then
    raise exception 'vital_source is missing the fhir_import value';
  end if;

  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'medication_source' and e.enumlabel = 'fhir_import'
  ) then
    raise exception 'medication_source is missing the fhir_import value';
  end if;

  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'allergy_source' and e.enumlabel = 'fhir_import'
  ) then
    raise exception 'allergy_source is missing the fhir_import value';
  end if;
end $$;
