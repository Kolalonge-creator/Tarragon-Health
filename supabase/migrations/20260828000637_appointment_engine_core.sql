-- Tarragon Health — Appointment Engine, Phase 2 (core appointment object + prevention)
--
-- Generalises public.appointments into the 10.2 appointment object and wires
-- 10.6 double-booking prevention. See 20260828000528_appointment_engine_types
-- for why this table (not a new one) is the right extension point.
--
-- Double-booking prevention: every other slot-booking path in this codebase
-- (book_video_consult_slot, accept_video_visit_request) relies on a manual
-- `select ... for update` row lock plus a plain unique constraint. That works
-- for fixed, pre-published one-row-per-slot tables, but appointments have
-- variable duration and no pre-published slot row to lock — the correct,
-- idiomatic Postgres primitive for "no two rows for the same clinician may
-- have overlapping time ranges" is a GiST EXCLUDE constraint (tstzrange
-- overlap + clinician equality), enforced by the database itself under
-- concurrency without the caller needing to lock anything first. This is new
-- territory for this codebase (no EXCLUDE constraint exists anywhere yet)
-- and is deliberately introduced here rather than another for-update loop.

do $$
declare
  v_existing integer;
begin
  select count(*) into v_existing from public.appointments;
  if v_existing > 0 then
    raise exception 'public.appointments has % existing row(s) — this migration assumes it is unused (confirmed 0 in docs/CLINICAL_NETWORK_SPEC.md and at authoring time); review before widening it', v_existing;
  end if;
end $$;

alter table public.appointments
  add column appointment_type       public.appointment_type not null,
  add column consultation_method    public.appointment_consultation_method not null,
  add column ends_at                timestamptz not null,
  add column service                text,
  add column location               text,
  add column payment_status         public.appointment_payment_status not null default 'not_required',
  add column is_high_priority       boolean not null default false,
  add column specialist_referral_id uuid references public.specialist_referrals (id) on delete set null,
  add column care_plan_id           uuid references public.care_plans (id) on delete set null,
  add column video_consultation_id  uuid references public.video_consultations (id) on delete set null,
  add column booked_by              uuid references public.profiles (id) on delete set null,
  add column hold_expires_at        timestamptz,
  add column confirmed_at           timestamptz,
  add column checked_in_at          timestamptz,
  add column started_at             timestamptz,
  add column completed_at           timestamptz,
  add column cancelled_at           timestamptz,
  add column cancelled_by           uuid references public.profiles (id) on delete set null,
  add column cancellation_reason    text,
  add column no_show_marked_at      timestamptz,
  add column rescheduled_from_id    uuid references public.appointments (id) on delete set null;

alter table public.appointments
  add constraint appointments_time_valid check (ends_at > scheduled_for),
  add constraint appointments_hold_requires_expiry
    check (status <> 'held' or hold_expires_at is not null),
  add constraint appointments_terminal_cancel_has_timestamp
    check (status not in ('cancelled', 'patient_cancelled', 'provider_cancelled') or cancelled_at is not null),
  add constraint appointments_completed_has_timestamp
    check (status <> 'completed' or completed_at is not null),
  add constraint appointments_no_show_has_timestamp
    check (status <> 'no_show' or no_show_marked_at is not null);

comment on column public.appointments.service is
  'Free-text description of what is being booked ("Diabetes follow-up", "Fasting lipid panel") — deliberately not a catalogue FK yet; laboratory/imaging appointment_type rows are the scheduled draw/scan slot, not the lab_orders test-selection/results pipeline, which stays separate.';
comment on column public.appointments.is_high_priority is
  'Set by the booking path when this appointment is linked to an urgent/priority specialist_referral or an abnormal-result-triggered context — drives a tighter reminder cadence, not a different RLS/authority rule.';

-- 10.6 double-booking prevention. NULLs (clinician_id not yet assigned) are
-- never considered equal by an EXCLUDE constraint, so unassigned rows are
-- correctly exempted rather than falsely colliding with each other.
alter table public.appointments
  add constraint appointments_no_provider_overlap
  exclude using gist (
    clinician_id with =,
    tstzrange(scheduled_for, ends_at, '[)') with &&
  )
  where (
    status not in ('cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled')
  );

create index appointments_clinician_time_idx on public.appointments (clinician_id, scheduled_for);
create index appointments_org_status_idx on public.appointments (organisation_id, status);
create index appointments_patient_time_idx on public.appointments (patient_id, scheduled_for desc);
create index appointments_type_idx on public.appointments (appointment_type);
create index appointments_hold_expiry_idx on public.appointments (hold_expires_at) where status = 'held';
create index appointments_specialist_referral_idx on public.appointments (specialist_referral_id) where specialist_referral_id is not null;
create index appointments_care_plan_idx on public.appointments (care_plan_id) where care_plan_id is not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'appointment_type'
  ) then
    raise exception 'appointments.appointment_type missing after migration';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass and conname = 'appointments_no_provider_overlap'
  ) then
    raise exception 'appointments_no_provider_overlap exclusion constraint missing after migration';
  end if;

  raise notice 'PASS: appointments generalised into the universal appointment object with double-booking prevention';
end $$;
