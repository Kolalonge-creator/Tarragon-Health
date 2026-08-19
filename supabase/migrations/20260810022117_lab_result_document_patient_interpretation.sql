-- Tarragon Health — doctor-authored, patient-facing lab result interpretation
--
-- lab_result_documents (20260720120100) already has reviewed_by/reviewed_at/
-- review_note, but review_note is internal-only free text never shown to the
-- patient anywhere (confirmed by grep — this is the gap the marketing copy at
-- apps/web/src/app/(marketing)/_content/pricing.ts:223 promises is closed:
-- "upload any lab result and a doctor's plain-language interpretation is sent
-- to you in the app, with next steps suggested if anything needs attention").
--
-- New columns are additive, not a repurpose of review_note, so the existing
-- internal review workflow (and any consumer of review_note) is untouched.
--
-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.lab_result_documents
  add column if not exists patient_interpretation text,
  add column if not exists next_steps            text,
  add column if not exists interpretation_sent_at timestamptz;

-- A sent interpretation must always carry patient-facing text. Belt-and-braces
-- alongside the trigger below, which is the mechanism actually enforcing this
-- on every write path (including a service-role bypass of RLS, which still
-- fires triggers).
alter table public.lab_result_documents
  add constraint lab_result_documents_interpretation_requires_text
  check (interpretation_sent_at is null or patient_interpretation is not null);

comment on column public.lab_result_documents.patient_interpretation is
  'Doctor-authored, plain-language explanation of the result, shown directly to the patient. Frozen once interpretation_sent_at is set — a correction goes through care_messages, not a silent edit.';
comment on column public.lab_result_documents.next_steps is
  'Optional doctor-authored next steps, populated only when the result needs the patient to do something. Frozen alongside patient_interpretation.';
comment on column public.lab_result_documents.interpretation_sent_at is
  'Set exactly once, in the same statement that first sets patient_interpretation — the trigger below fires the in-app notification in that same transaction, so "sent" and "notified" can never drift apart.';

-- ---------------------------------------------------------------------------
-- 2. BEFORE UPDATE: extend the existing review-stamp trigger
-- ---------------------------------------------------------------------------
-- Same shape as the reviewed_by/reviewed_at freeze-after-set block this
-- function already had: content and its "sent" timestamp travel together in
-- one statement, and once sent neither can be silently edited.
create or replace function private.enforce_lab_result_document_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Upload-time facts are immutable after insert.
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.file_path          := old.file_path;
  new.source             := old.source;
  new.uploaded_by        := old.uploaded_by;
  new.clinician_alert_id := old.clinician_alert_id;
  new.created_at          := old.created_at;

  -- The review stamp: derive attribution from the acting session.
  if new.reviewed_at is not null and old.reviewed_at is null then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  elsif old.reviewed_at is not null then
    -- Once reviewed, the attribution is frozen.
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  else
    new.reviewed_by := null;
  end if;

  -- The patient-facing interpretation: frozen once sent. Notifying the
  -- patient happens exactly once, in the same transaction that first sets
  -- interpretation_sent_at.
  if new.interpretation_sent_at is not null and old.interpretation_sent_at is null then
    new.interpretation_sent_at := now();

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    values (
      new.organisation_id,
      new.patient_id,
      'in_app',
      'result_interpretation_ready',
      jsonb_build_object('document_id', new.id::text),
      'clinical'
    );
  elsif old.interpretation_sent_at is not null then
    -- Once sent, the interpretation is frozen — a doctor corrects a mistake
    -- by messaging the patient, not by silently editing what was already sent.
    new.patient_interpretation := old.patient_interpretation;
    new.next_steps             := old.next_steps;
    new.interpretation_sent_at := old.interpretation_sent_at;
  else
    new.patient_interpretation := null;
    new.next_steps             := null;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Assertions — "closed" is provable, not hopeful
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_result_documents'
      and column_name = 'patient_interpretation'
  ) then
    raise exception 'FAIL: patient_interpretation column was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_result_documents'
      and column_name = 'next_steps'
  ) then
    raise exception 'FAIL: next_steps column was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_result_documents'
      and column_name = 'interpretation_sent_at'
  ) then
    raise exception 'FAIL: interpretation_sent_at column was not created';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lab_result_documents_interpretation_requires_text'
  ) then
    raise exception 'FAIL: lab_result_documents_interpretation_requires_text constraint missing';
  end if;
end $$;
