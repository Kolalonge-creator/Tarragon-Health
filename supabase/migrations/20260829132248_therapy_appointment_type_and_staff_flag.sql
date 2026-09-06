-- Tarragon Health — Mental Health & Wellbeing Platform (Module 46 §46.8: an
-- in-house therapy pathway, on explicit ask). Tarragon already employs/
-- contracts its own clinical staff and delivers care over telemedicine
-- without owning a clinic (video consultations for doctors) — this reuses
-- that exact model for therapists rather than building a new booking
-- system: a therapist is a clinical_staff member whose own availability
-- rules (provider_availability_rules, already self-service via
-- AvailabilityRulesManager) include the new 'therapy' appointment type, and
-- a patient books them through the existing general-purpose appointment
-- engine (get_available_appointment_slots / hold_appointment_slot /
-- confirm_appointment_booking — 20260828000528 onward) with zero new
-- booking logic. This does not touch the specialist-matching/referral
-- guardrail (CLINICAL_NETWORK_SPEC.md §3): that pathway remains for
-- referring OUT to an external/specialist psychiatrist when in-house
-- capacity or fit isn't right (see refer_patient_to_specialist,
-- 20260829094000) — this migration is the separate, in-house alternative.

alter type public.appointment_type add value if not exists 'therapy';

-- Organisational/directory flag only — booking correctness is already fully
-- governed by which appointment_types a clinician's own availability rules
-- declare (provider_availability_rules.appointment_types), not this column.
-- This exists so admin can see/toggle who is a therapist without relying on
-- free-text `specialty` string-matching.
alter table public.clinical_staff
  add column offers_therapy_sessions boolean not null default false;

create index clinical_staff_offers_therapy_sessions_idx
  on public.clinical_staff (organisation_id) where offers_therapy_sessions;

comment on column public.clinical_staff.offers_therapy_sessions is
  'Module 46 §46.8: marks this clinical_staff member as one of Tarragon''s in-house therapists, for admin/directory display. Does not itself gate booking — a patient can only actually book them for a therapy slot once they have published provider_availability_rules that include the therapy appointment_type.';

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'appointment_type' and e.enumlabel = 'therapy'
  ) then
    raise exception 'appointment_type is missing therapy';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_staff' and column_name = 'offers_therapy_sessions'
  ) then
    raise exception 'clinical_staff.offers_therapy_sessions was not created';
  end if;

  raise notice 'PASS: therapy appointment_type + clinical_staff.offers_therapy_sessions installed';
end $$;
