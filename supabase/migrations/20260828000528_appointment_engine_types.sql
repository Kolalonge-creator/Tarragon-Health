-- Tarragon Health — Appointment Engine, Phase 1 (types)
--
-- Generalises scheduling beyond the single-purpose paths that exist today
-- (consult_availability_slots + video_consultations for telemedicine
-- "general checkins" only; video_visit_requests for the paid on-demand
-- product). public.appointments (20260705211129_chronic_disease.sql) has
-- been live and unused by any app code since Sprint 1 — docs/
-- CLINICAL_NETWORK_SPEC.md §4.4/4.5 called it dead code and said "do not
-- resurrect it, extend the slot-based system instead". That guidance
-- predates 20260827203759_my_provider_performance_rpc.sql, which already
-- reads public.appointments.status/clinician_id/scheduled_for for
-- consultations_completed/consultations_cancelled — a live RPC now depends
-- on this table meaning something real. Rather than leave that RPC
-- permanently querying an table nothing ever writes to, this generalises
-- public.appointments itself into the universal scheduling record (GP,
-- specialist, nurse, dietitian, physiotherapist, laboratory, imaging,
-- vaccination, physical clinic, telemedicine, follow-up, procedure),
-- keeping every existing column name (clinician_id, scheduled_for, status)
-- so that RPC and any future reader stay correct without a rewrite.
--
-- video_consultations/consult_availability_slots/video_visit_requests are
-- untouched — the paid on-demand video-visit product keeps its own
-- economics. A telemedicine appointment booked through this new engine
-- optionally links to a video_consultations row (added next migration) so
-- the existing Zoom-join UI keeps working; the two systems are not merged.
--
-- Split into its own migration (types only) because a newly added enum
-- value cannot safely be referenced by DDL in the same transaction/file
-- that adds it — every migration after this one is free to use these.

create extension if not exists btree_gist with schema extensions;

-- 10.1 appointment types
create type public.appointment_type as enum (
  'gp', 'specialist', 'nurse', 'dietitian', 'physiotherapist',
  'laboratory', 'imaging', 'vaccination', 'physical_clinic',
  'telemedicine', 'follow_up', 'procedure'
);

-- 10.2 consultation method
create type public.appointment_consultation_method as enum (
  'telemedicine', 'in_person'
);

-- 10.2 payment status. Most appointment types here are covered by the
-- patient's plan (not_required); pending/paid/refund_due/refunded/waived
-- exist for the appointment types that do carry a direct charge, without
-- committing this migration to any specific price or which types those are
-- — that is a founder/business decision, not a schema question (see
-- CLAUDE.md "do not treat any specific price... as current").
create type public.appointment_payment_status as enum (
  'not_required', 'pending', 'paid', 'refund_due', 'refunded', 'waived'
);

-- 10.3 appointment states. 'scheduled' is the pre-existing default and is
-- kept for enum/back-compat only (zero live rows reference it) — new code
-- writes 'booked' instead, which maps cleanly onto the spec's
-- Available -> Held -> Booked -> Confirmed -> Checked-in -> In progress ->
-- Completed pipeline plus its alternate terminal states.
alter type public.appointment_status add value if not exists 'held';
alter type public.appointment_status add value if not exists 'booked';
alter type public.appointment_status add value if not exists 'confirmed';
alter type public.appointment_status add value if not exists 'checked_in';
alter type public.appointment_status add value if not exists 'in_progress';
alter type public.appointment_status add value if not exists 'rescheduled';
alter type public.appointment_status add value if not exists 'provider_cancelled';
alter type public.appointment_status add value if not exists 'patient_cancelled';
alter type public.appointment_status add value if not exists 'failed';
alter type public.appointment_status add value if not exists 'expired';

do $$
begin
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'appointment_status') <> 14 then
    raise exception 'appointment_status does not have the expected 14 values after widening';
  end if;
end $$;
