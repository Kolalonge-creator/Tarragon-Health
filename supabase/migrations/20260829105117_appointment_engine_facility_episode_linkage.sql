-- Tarragon Health — Appointment Engine, Phase 7 (episode linkage)
--
-- 69.16 acceptance criteria: "a physical appointment should be part of the
-- same clinical episode as the referral and care plan, rather than an
-- isolated booking transaction." appointments.specialist_referral_id/
-- care_plan_id already exist (20260828000637) so a physical appointment
-- already links *backward* into its referral/care-plan episode. Two gaps
-- remain, both closed here:
--
-- 1. 69.15 "Consultation -> Clinical note" — clinical_encounter_notes
--    (20260827201504) has optional links to video_consultation_id/
--    async_consult_id/escalation_id, already covers encounter_type
--    'in_person', but has no way to point back at the appointment it
--    documents. appointment_id closes that, following the exact same
--    "optional, independent, no forced coupling" reasoning that table's own
--    migration comment already applies to its other three link columns.
--
-- 2. specialist_referrals.appointment_date/booking_confirmed_at/status are a
--    legacy manual flow (apps/web/src/lib/queries/specialist-referrals.ts's
--    useSetReferralAppointment — a clinician types in a date and clicks
--    confirm) that predates the Appointment Engine and was never wired to
--    it, despite appointments.specialist_referral_id existing since
--    20260828000637. A patient who books a physical appointment against
--    their own referral through the new engine (69.5's Referral -> Facility
--    -> Clinician -> ... pipeline) would otherwise see their referral sit at
--    status 'pending' forever even though a real appointment exists. The
--    trigger below bridges that: it only ever moves a referral OUT of
--    'pending', and only when the linking appointment reaches booked/
--    confirmed — it can never overwrite a referral a clinician has already
--    manually booked/confirmed/completed/declined through the older flow,
--    so the two paths cannot clobber each other. This is a mechanical field
--    sync, not the guardrailed matching/ranking engine (CLAUDE.md,
--    docs/CLINICAL_NETWORK_SPEC.md §3) — no scoring, no provider selection,
--    just keeping one existing legacy field truthful.

alter table public.clinical_encounter_notes
  add column appointment_id uuid references public.appointments (id) on delete set null;

create index clinical_encounter_notes_appointment_idx
  on public.clinical_encounter_notes (appointment_id) where appointment_id is not null;

comment on column public.clinical_encounter_notes.appointment_id is
  '69.15/69.16: links a signed encounter note back to the appointment (physical or telemedicine) it documents, so a physical consultation carries the same documentation trail as any other encounter type rather than being an isolated booking transaction. Optional and independent of video_consultation_id/async_consult_id/escalation_id — no CHECK ties encounter_type to this column, same reasoning as the table''s original migration comment.';

create or replace function private.sync_referral_appointment_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.specialist_referrals
    set appointment_date = new.scheduled_for,
        booking_confirmed_at = coalesce(booking_confirmed_at, now()),
        status = 'booked'
    where id = new.specialist_referral_id
      and status = 'pending';
  return new;
end;
$$;

comment on function private.sync_referral_appointment_date() is
  '69.16: bridges the legacy specialist_referrals.appointment_date/status (manually set via useSetReferralAppointment) to the Appointment Engine. Only ever moves a referral out of ''pending'' — never overwrites a referral already booked/confirmed/completed/declined through the older manual flow.';

drop trigger if exists appointments_sync_referral_appointment_date on public.appointments;
create trigger appointments_sync_referral_appointment_date
  after insert or update on public.appointments
  for each row
  when (new.specialist_referral_id is not null and new.status in ('booked', 'confirmed'))
  execute function private.sync_referral_appointment_date();

revoke all on function private.sync_referral_appointment_date() from public;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_encounter_notes' and column_name = 'appointment_id'
  ) then
    raise exception 'clinical_encounter_notes.appointment_id missing after migration';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'appointments_sync_referral_appointment_date'
      and not tgisinternal
  ) then
    raise exception 'appointments_sync_referral_appointment_date trigger missing';
  end if;
  raise notice 'PASS: appointment <-> encounter note + referral episode linkage in place';
end $$;
