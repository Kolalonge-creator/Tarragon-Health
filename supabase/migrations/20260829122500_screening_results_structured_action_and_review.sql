-- Tarragon Health — Result Lifecycle §58.11/§58.15: a structured action
-- type (the six named next-steps the spec lists) alongside the existing
-- free-text screening_results.follow_up_action detail, plus the
-- "Reviewed by Dr X" / "Patient informed" attribution the spec's action-
-- tracking chain (§58.15: Result -> Reviewed by Dr X -> Action -> Patient
-- informed -> Recall created) needs and that screening_results didn't carry
-- before now (follow_up_action alone recorded WHAT was decided, never WHO
-- decided it, WHEN, or whether the patient was actually told).
--
-- follow_up_action stays exactly as-is (free-text detail, e.g. "Repeat FBC
-- in 3 months" or "Start metformin 500mg") — action_type is the governed
-- category alongside it, not a replacement.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'result_action_type') then
    create type public.result_action_type as enum (
      'repeat_test', 'medication_change', 'appointment', 'specialist_referral',
      'monitoring', 'no_action'
    );
  end if;
end $$;

alter table public.screening_results
  add column if not exists action_type public.result_action_type,
  add column if not exists action_repeat_due_date date,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists patient_informed_by uuid references public.profiles (id) on delete set null,
  add column if not exists patient_informed_at timestamptz;

comment on column public.screening_results.action_type is
  'Structured next-step category (Result Lifecycle §58.11) alongside the free-text follow_up_action detail. Set once via setScreeningResultFollowUpAction — app-layer gated to an active clinical_staff row, same as follow_up_action itself.';
comment on column public.screening_results.action_repeat_due_date is
  'Required when action_type = repeat_test — enforced by enforce_screening_result_action_fields below, not merely by the form. Drives automatic result_recalls creation (see 20260829122600_result_recalls.sql).';

-- ---------------------------------------------------------------------------
-- Server-derived, frozen-after-set attribution — the same discipline as
-- lab_result_documents.reviewed_by/reviewed_at
-- (private.enforce_lab_result_document_update): a client can request the
-- stamp (by setting action_type / patient_informed_at to a non-null value)
-- but can never choose who gets recorded as having done it, and once set
-- the record cannot be silently reassigned to someone else by a later
-- UPDATE.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_screening_result_action_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- reviewed_by/reviewed_at: stamped the moment an action_type is first
  -- recorded (that is the clinical judgement call this table exists to
  -- capture — see §58.15), then frozen. A correction to WHICH action was
  -- chosen stays possible (doctors do revise a plan); who is on record as
  -- having reviewed the result in the first place does not change hands.
  if new.action_type is not null and old.action_type is null then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  elsif old.reviewed_at is not null then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  else
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;

  if new.action_type = 'repeat_test' and new.action_repeat_due_date is null then
    raise exception 'A repeat_test action requires action_repeat_due_date' using errcode = '22023';
  end if;

  -- patient_informed_at: a clinician-confirmed "the patient has been told
  -- about this result/action" signal — distinct from the result simply
  -- being readable in the patient's own dashboard the instant it's
  -- inserted (Result Lifecycle §58.19: delivered must not be conflated
  -- with managed). Settable once, frozen after — see the same reasoning as
  -- lab_result_documents.interpretation_sent_at.
  if new.patient_informed_at is not null and old.patient_informed_at is null then
    new.patient_informed_by := coalesce((select auth.uid()), new.patient_informed_by);
    new.patient_informed_at := now();
  elsif old.patient_informed_at is not null then
    new.patient_informed_by := old.patient_informed_by;
    new.patient_informed_at := old.patient_informed_at;
  else
    new.patient_informed_by := null;
    new.patient_informed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists screening_results_enforce_action_fields on public.screening_results;
create trigger screening_results_enforce_action_fields
  before update on public.screening_results
  for each row execute function private.enforce_screening_result_action_fields();

revoke all on function private.enforce_screening_result_action_fields() from public;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'result_action_type') then
    raise exception 'result_action_type enum was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'screening_results'
      and column_name in ('action_type', 'action_repeat_due_date', 'reviewed_by', 'reviewed_at',
                           'patient_informed_by', 'patient_informed_at')
    having count(*) = 6
  ) then
    raise exception 'screening_results is missing one or more of the new action/review columns';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'screening_results_enforce_action_fields'
  ) then
    raise exception 'screening_results_enforce_action_fields trigger was not created';
  end if;
end $$;
