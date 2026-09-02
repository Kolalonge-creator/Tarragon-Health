-- Tarragon Health — Consultation System §9.9 (telephone consultation call
-- metadata), §9.14/9.15 (documentation + outcome).
--
-- clinical_encounter_notes (20260827201504) already covers reason/history/
-- examination/assessment/diagnosis/plan/follow_up_instructions and has an
-- 'encounter_type' that already includes 'phone'. Two additive gaps closed
-- here, both nullable columns on the same table rather than a parallel
-- per-channel documentation table:
--   1. §9.9 wants call start/completion/duration recorded for a telephone
--      consultation. video_consultations already tracks started_at/ended_at
--      for the video channel; phone has nothing. call_started_at/
--      call_ended_at give the same shape without inventing a whole
--      telephone_consultations table just to hold two timestamps — duration
--      is derived (call_ended_at - call_started_at), not stored, so it can
--      never drift from the two source timestamps.
--   2. §9.15 "every consultation should end with an outcome" — a finalized
--      (signed) note must record one of the outcome categories the spec
--      lists. Required only once finalized, same "draft is a work in
--      progress, finalized is the permanent record" discipline the table
--      already applies to authorship.

alter table public.clinical_encounter_notes
  add column outcome public.consultation_outcome,
  add column call_started_at timestamptz,
  add column call_ended_at timestamptz;

comment on column public.clinical_encounter_notes.outcome is
  'Consultation System §9.15 — required once the note is finalized. One of reassurance/continue_monitoring/treatment_started/treatment_changed/investigation_requested/referral/follow_up/emergency_escalation.';
comment on column public.clinical_encounter_notes.call_started_at is
  'Telephone consultation (§9.9) call start. Left null for video (see video_consultations.started_at) and in-person encounters.';
comment on column public.clinical_encounter_notes.call_ended_at is
  'Telephone consultation (§9.9) call completion. Duration is derived (call_ended_at - call_started_at), never stored separately.';

alter table public.clinical_encounter_notes
  add constraint clinical_encounter_notes_finalized_requires_outcome check (
    status <> 'finalized' or outcome is not null
  );

alter table public.clinical_encounter_notes
  add constraint clinical_encounter_notes_call_window_valid check (
    call_started_at is null or call_ended_at is null or call_ended_at >= call_started_at
  );

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_encounter_notes' and column_name = 'outcome'
  ) then
    raise exception 'clinical_encounter_notes.outcome missing after migration';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_encounter_notes'::regclass
      and conname = 'clinical_encounter_notes_finalized_requires_outcome'
  ) then
    raise exception 'clinical_encounter_notes_finalized_requires_outcome constraint missing';
  end if;

  raise notice 'PASS: clinical_encounter_notes outcome + call metadata columns present';
end $$;
