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
