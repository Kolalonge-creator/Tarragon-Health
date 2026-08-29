-- Tarragon Health — Provider Quality & Performance Management, part 2/6:
-- §29.4 structured patient feedback on a provider.
--
-- §29.4 asks for structured feedback on punctuality, communication,
-- professionalism, and overall experience. public.consultation_feedback
-- (20260828000328) already carries three of those four, one row per completed
-- video consultation, immutable, with organisation_id/patient_id forced
-- server-side. This migration extends that table rather than creating a
-- parallel provider_feedback one:
--   * professionalism_rating is the one §29.4 dimension genuinely missing.
--   * clinician_id is the gap that mattered more — feedback existed but was
--     attached to nothing a provider scorecard could roll it up by, which is
--     why 20260827203759 hardcodes patient_feedback_available=false.
--   * appointment_id widens the table past video-only, since §29.1 counts
--     punctuality and appointment completion for in-person/phone bookings the
--     video path never covered.
-- A second feedback table would have split "what patients said about a
-- provider" across two sources of truth for no gain, exactly the failure mode
-- the wearables/vitals rule in CLAUDE.md warns about.
--
-- ATTRIBUTION IS DERIVED, NEVER CLIENT-SUPPLIED, AND MAY BE NULL.
-- video_consultations has no clinician column at all (checked: only
-- initiated_by, which is whoever opened the record — often the patient, on a
-- patient-initiated request). The real answer lives in one of two places, in
-- this precedence order:
--   1. consult_availability_slots.clinician_profile_id, for the slot booked
--      against this consultation — the clinician who published the slot.
--   2. video_visit_requests.accepted_by -> clinical_staff.profile_id, for a
--      request accepted by a named doctor.
-- Where neither exists (a consultation created by another path entirely) the
-- attribution is genuinely unknown, and clinician_id stays null. That row's
-- ratings still count towards the organisation, and are simply excluded from
-- any per-provider figure — the same null-gated discipline the platform
-- already applies to reviewed_by/reviewed_at, applied to blame rather than
-- to credit. Part 6 reports the unattributed share alongside the rate so a
-- reader can see how complete the attribution is instead of assuming 100%.
--
-- WHAT THIS TABLE STILL DOES NOT HOLD: any clinical-quality signal. §29.4 is
-- explicit that "clinical complaints should have a separate formal pathway" —
-- that is part 3 (provider_complaints), and a patient who wants to raise a
-- clinical concern is routed there, not into a 1-5 star field. The original
-- migration's comment made the same commitment; widening the table does not
-- weaken it.

alter table public.consultation_feedback
  add column professionalism_rating smallint check (professionalism_rating between 1 and 5),
  add column appointment_id uuid references public.appointments (id) on delete cascade,
  add column clinician_id uuid references public.profiles (id) on delete set null;

comment on column public.consultation_feedback.professionalism_rating is
  '§29.4 professionalism dimension. Optional like the other sub-ratings — only overall_rating is required.';
comment on column public.consultation_feedback.appointment_id is
  'Set instead of video_consultation_id when the feedback is about a booked appointment (in-person, phone, or any non-video consultation_method). Exactly one of the two source columns is set — see consultation_feedback_one_source.';
comment on column public.consultation_feedback.clinician_id is
  'The provider this feedback is about, derived server-side by private.enforce_consultation_feedback_scope and never client-supplied. NULL when the source record carries no resolvable clinician (video_consultations has no clinician column; some consultations are created by paths that record neither a booked slot nor an accepting doctor). A null here means "unattributed", never "no provider involved" — per-provider figures exclude it and report the unattributed share separately.';

-- Widening the source: video_consultation_id was NOT NULL and is now one of
-- two mutually exclusive sources. Existing rows all carry it, so no backfill
-- is needed for the check to hold.
alter table public.consultation_feedback
  alter column video_consultation_id drop not null;

alter table public.consultation_feedback
  add constraint consultation_feedback_one_source check (
    (video_consultation_id is not null and appointment_id is null)
    or (video_consultation_id is null and appointment_id is not null)
  );

-- video_consultation_id already has consultation_feedback_one_per_consult;
-- a unique index treats NULLs as distinct, so appointment-sourced rows do not
-- collide with each other there and need their own.
create unique index consultation_feedback_one_per_appointment
  on public.consultation_feedback (appointment_id) where appointment_id is not null;

create index consultation_feedback_clinician_idx
  on public.consultation_feedback (clinician_id, created_at desc) where clinician_id is not null;

-- ---------------------------------------------------------------------------
-- Attribution resolver
-- ---------------------------------------------------------------------------

create or replace function private.video_consultation_clinician(p_consultation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.clinician_profile_id
     from public.consult_availability_slots s
     where s.booked_consultation_id = p_consultation_id
     limit 1),
    (select cs.profile_id
     from public.video_visit_requests r
     join public.clinical_staff cs on cs.id = r.accepted_by
     where r.video_consultation_id = p_consultation_id
     limit 1)
  );
$$;

comment on function private.video_consultation_clinician(uuid) is
  'Best-available clinician attribution for a video consultation: the published slot''s owner first, then the doctor who accepted the visit request. Returns NULL when neither exists — video_consultations itself has no clinician column, and this function will not guess one from initiated_by (which is frequently the patient).';

revoke all on function private.video_consultation_clinician(uuid) from public;

-- ---------------------------------------------------------------------------
-- Scope trigger, rewritten for two sources
-- ---------------------------------------------------------------------------

create or replace function private.enforce_consultation_feedback_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consult record;
  v_appt    record;
begin
  if new.video_consultation_id is not null then
    select id, organisation_id, patient_id, status into v_consult
    from public.video_consultations
    where id = new.video_consultation_id;

    if v_consult.id is null then
      raise exception 'consultation not found';
    end if;
    if v_consult.patient_id <> (select auth.uid()) then
      raise exception 'you can only leave feedback for your own consultation'
        using errcode = '42501';
    end if;
    if v_consult.status <> 'completed' then
      raise exception 'feedback can only be left once the consultation is completed';
    end if;

    -- Client-supplied scope is never trusted -- always re-derived from the
    -- consultation itself. clinician_id joins that rule: a patient must not
    -- be able to aim their rating at a doctor who was not on the call.
    new.organisation_id := v_consult.organisation_id;
    new.patient_id := v_consult.patient_id;
    new.clinician_id := private.video_consultation_clinician(v_consult.id);

  elsif new.appointment_id is not null then
    select id, organisation_id, patient_id, status, clinician_id into v_appt
    from public.appointments
    where id = new.appointment_id;

    if v_appt.id is null then
      raise exception 'appointment not found';
    end if;
    if v_appt.patient_id <> (select auth.uid()) then
      raise exception 'you can only leave feedback for your own appointment'
        using errcode = '42501';
    end if;
    if v_appt.status <> 'completed' then
      raise exception 'feedback can only be left once the appointment is completed';
    end if;

    new.organisation_id := v_appt.organisation_id;
    new.patient_id := v_appt.patient_id;
    -- appointments.clinician_id is nullable (an unassigned booking); a null
    -- here is carried through as unattributed rather than rejected, since the
    -- patient's experience of the visit is still real and still counts for
    -- the organisation.
    new.clinician_id := v_appt.clinician_id;

  else
    -- Unreachable through the check constraint, kept so a future source
    -- column added without updating this trigger fails loudly instead of
    -- silently storing client-supplied scope.
    raise exception 'feedback must reference either a video consultation or an appointment';
  end if;

  return new;
end;
$$;

comment on function private.enforce_consultation_feedback_scope() is
  'Forces organisation_id/patient_id/clinician_id from the referenced video_consultations or appointments row, and requires the caller be that record''s own patient on a completed visit -- never client-supplied. clinician_id may legitimately end up NULL (unattributed); see the column comment.';

-- ---------------------------------------------------------------------------
-- Backfill attribution for feedback that already exists
-- ---------------------------------------------------------------------------

update public.consultation_feedback f
  set clinician_id = private.video_consultation_clinician(f.video_consultation_id)
  where f.video_consultation_id is not null and f.clinician_id is null;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad integer;
  v_sourceless_accepted boolean;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consultation_feedback'
      and column_name = 'professionalism_rating'
  ) then
    raise exception 'FAIL: consultation_feedback.professionalism_rating missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.consultation_feedback'::regclass
      and conname = 'consultation_feedback_one_source'
  ) then
    raise exception 'FAIL: consultation_feedback_one_source check missing';
  end if;

  -- The widening must not have created a way to write a row with no source.
  -- The FAIL is raised OUTSIDE the block that catches the expected error --
  -- a raise inside it would be swallowed by its own handler and the
  -- assertion would pass vacuously.
  v_sourceless_accepted := false;
  begin
    insert into public.consultation_feedback (organisation_id, patient_id, overall_rating)
    values (gen_random_uuid(), gen_random_uuid(), 5);
    v_sourceless_accepted := true;
  exception
    when others then
      null; -- expected: the scope trigger rejects a row with neither source
  end;
  if v_sourceless_accepted then
    raise exception 'FAIL: a sourceless consultation_feedback row was accepted';
  end if;

  -- Still immutable: no UPDATE/DELETE policy may have been introduced.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'consultation_feedback' and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: consultation_feedback gained an UPDATE/DELETE policy';
  end if;

  -- §29.4: no clinical-quality field may have crept in with this widening.
  select count(*) into v_bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'consultation_feedback'
    and (column_name like '%diagnos%' or column_name like '%outcome%'
         or column_name like '%clinical_quality%' or column_name like '%accuracy%');
  if v_bad > 0 then
    raise exception 'FAIL: consultation_feedback holds a clinical-quality field — §29.4 routes clinical concerns to the complaints pathway instead';
  end if;

  raise notice 'PASS: consultation_feedback carries professionalism + derived clinician attribution across video and appointment sources, still immutable, still free of clinical-quality fields';
end $$;
