-- Tarragon Health — Appointment Engine, Phase 7 (facility integration, types)
--
-- Physical Consultation & Facility Appointment Orchestration. The Appointment
-- Engine (20260828*) generalised public.appointments into the universal
-- scheduling object but never linked it to public.facilities (the existing
-- admin-maintained clinic/hospital/lab/pharmacy/... directory,
-- 20260706084934_facilities_booking_requests.sql) — every appointment_type
-- row today carries only a free-text `location`. This phase closes that gap:
-- 69.5's Referral/Service -> Facility -> Clinician -> Date -> Time -> Payment
-- -> Confirmation pipeline.
--
-- facility_type gains three values this directory never needed before now
-- (clinic, diagnostic_centre, specialist_centre) — the existing six
-- (hospital/lab/pharmacy/radiology/optician/vaccination_centre) don't cover
-- a generic outpatient clinic or a dedicated diagnostic/specialist centre
-- (69.2). Same "schema/data drop-in-ready but nothing shows until ops adds a
-- real row" posture as the wearable cloud providers: adding the enum values
-- creates zero visible rows by itself (there are no rows of these new types
-- yet), so this does not reopen the patient-facing facility directory the
-- founder suspended 2026-08-03
-- (20260803160537_facilities_suspended_pending_accreditation.sql) — that
-- suspension is about the six existing lab/hospital-type rows and stands
-- untouched; nothing here re-verifies or re-activates a single row.
--
-- appointment_status gains 'called' — 69.8 queue management wants a distinct
-- "called for consultation" step between checked-in/waiting and in-progress.
-- Checked-in and waiting are deliberately modelled as the same state
-- (checked_in IS the waiting-room state — see the queue migration's
-- get_facility_queue_today()) rather than adding a fifth enum value for
-- "waiting", since the two only ever differ by "the queue hasn't gotten to
-- them yet", not by anything the state machine needs to enforce differently.
--
-- Split into its own migration (types only) for the same reason as
-- 20260828000528: a newly added enum value cannot safely be referenced by
-- DDL in the same transaction/file that adds it.

alter type public.facility_type add value if not exists 'clinic';
alter type public.facility_type add value if not exists 'diagnostic_centre';
alter type public.facility_type add value if not exists 'specialist_centre';

alter type public.appointment_status add value if not exists 'called';

do $$
begin
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'facility_type') <> 9 then
    raise exception 'facility_type does not have the expected 9 values after widening';
  end if;
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'appointment_status') <> 15 then
    raise exception 'appointment_status does not have the expected 15 values after widening';
  end if;
  raise notice 'PASS: facility_type and appointment_status widened for facility integration';
end $$;
