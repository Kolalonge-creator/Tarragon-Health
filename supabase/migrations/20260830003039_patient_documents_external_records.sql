-- Patient Health Record architecture review, round 3 — generic external
-- record document table (spec §1.21: discharge summaries, prescriptions,
-- vaccination cards, specialist letters — "patients should eventually be
-- able to upload or connect external records"). docs/PATIENT_HEALTH_RECORD_
-- ARCHITECTURE.md §1.21 found only two purpose-built pipelines exist today
-- (lab_result_documents, ecg_report_documents), no generic path for anything
-- else. This is a genuine prerequisite for §1.22 (record reconciliation) —
-- a discrepancy needs two things to compare, and this is the "external
-- record" half.
--
-- DESIGN: mirrors lab_result_documents (20260720120100) as closely as the
-- generic case allows — same private-bucket + patient-own-folder storage
-- pattern, same source-of-uploader enum shape, same server-derived
-- attribution. Deliberately DIFFERENT from lab_result_documents in one way:
-- no automatic clinician_alerts row on upload. A raw lab result needs doctor
-- interpretation to become clinically actionable; a scanned vaccination card
-- or an old discharge summary does not carry that same urgency — per the
-- spec's own framing for imaging ("initially, storing the report may be
-- sufficient"), the same logic applies here. reviewed_by/reviewed_at stay
-- available for a clinician who chooses to annotate one, but nothing forces
-- the review workflow the lab pipeline needs.
--
-- Real extraction/matching (the "Extract -> Match -> Potential duplicate?"
-- steps in spec §1.15/§81.15) is explicitly NOT built here — no OCR/parsing
-- engine exists anywhere on this platform, and building one is far outside
-- an additive schema pass. What this table gives §1.22 is a real row to
-- point a conflict at.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'patient_document_type') then
    create type public.patient_document_type as enum (
      'discharge_summary',
      'prescription',
      'vaccination_card',
      'specialist_letter',
      'previous_hospital_record',
      'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'patient_document_source') then
    create type public.patient_document_source as enum (
      'patient', 'lab_liaison', 'clinician', 'admin'
    );
  end if;
end $$;

create table public.patient_documents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  document_type      public.patient_document_type not null,
  -- storage.objects path (bucket 'patient-documents'), never a public URL.
  file_path          text not null,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint,
  source             public.patient_document_source not null,
  -- Server-derived (never trusted from the client) — same rule as
  -- lab_result_documents.uploaded_by.
  uploaded_by        uuid references public.profiles (id) on delete set null,
  document_date      date,
  note               text,
  reviewed_by        uuid references public.profiles (id) on delete set null,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index patient_documents_patient_idx on public.patient_documents (patient_id, created_at desc);
create index patient_documents_org_idx on public.patient_documents (organisation_id);
create index patient_documents_type_idx on public.patient_documents (document_type);

create trigger patient_documents_set_updated_at
  before update on public.patient_documents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — same shape as lab_result_documents: patient sees/uploads own; org
-- staff see/upload for any org patient. The Care-Coordinator non-clinical
-- write guardrail is enforced at the app/server-action layer, matching the
-- existing medications/protocols/lab-document pattern.
-- ---------------------------------------------------------------------------
alter table public.patient_documents enable row level security;

create policy patient_documents_select on public.patient_documents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy patient_documents_insert on public.patient_documents
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
  );

create policy patient_documents_update on public.patient_documents
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_documents to authenticated;
revoke delete on public.patient_documents from authenticated;
revoke all on public.patient_documents from anon;

-- ---------------------------------------------------------------------------
-- Private storage bucket (mirrors lab-result-documents)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-documents',
  'patient-documents',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

-- Path convention: '<patient_id>/<uuid>.<ext>' — identical rule to
-- lab-result-documents. Staff uploads write under the patient's folder via
-- the service-role client server-side; staff reads happen through a
-- short-lived signed URL minted server-side after an RLS-confirmed row read.
create policy "patient doc patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "patient doc patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "patient doc patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "patient doc patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: derive uploaded_by, clear review fields
-- ---------------------------------------------------------------------------
create or replace function private.handle_patient_document_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'patient_document.uploaded',
    'patient_documents',
    new.id,
    jsonb_build_object('document_type', new.document_type::text, 'source', new.source::text)
  );

  return new;
end;
$$;

create trigger patient_documents_on_insert
  before insert on public.patient_documents
  for each row execute function private.handle_patient_document_insert();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: upload-time facts immutable, server-derive review stamp
-- ---------------------------------------------------------------------------
create or replace function private.enforce_patient_document_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id := old.organisation_id;
  new.patient_id      := old.patient_id;
  new.file_path       := old.file_path;
  new.source          := old.source;
  new.uploaded_by     := old.uploaded_by;
  new.created_at       := old.created_at;

  if new.reviewed_at is not null and old.reviewed_at is null then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  elsif old.reviewed_at is not null then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  else
    new.reviewed_by := null;
  end if;

  return new;
end;
$$;

create trigger patient_documents_update_guard
  before update on public.patient_documents
  for each row execute function private.enforce_patient_document_update();

-- ---------------------------------------------------------------------------
-- Timeline: document_uploaded on insert.
-- ---------------------------------------------------------------------------
create or replace function private.timeline_from_patient_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'document_uploaded',
    'patient_documents', new.id,
    'Document added to your record',
    replace(new.document_type::text, '_', ' ') || coalesce(' · ' || nullif(new.original_filename, ''), ''),
    new.created_at,
    private.timeline_staff_from_profile(new.uploaded_by, new.organisation_id),
    jsonb_build_object('document_type', new.document_type, 'source', new.source)
  );
  return new;
end;
$$;

create trigger patient_documents_timeline
  after insert on public.patient_documents
  for each row execute function private.timeline_from_patient_document();

-- ---------------------------------------------------------------------------
-- Attach the two existing generic clinical-core triggers directly (both
-- audit_row_change_trg and capture_record_correction_trg pre-date this
-- table).
-- ---------------------------------------------------------------------------
create trigger audit_row_change_trg
  after insert or update or delete on public.patient_documents
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.patient_documents
  for each row execute function private.capture_record_correction();

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_documents') then
    raise exception 'FAIL: patient_documents table was not created';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'patient_documents' and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: patient_documents is missing audit_row_change_trg';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'patient_documents' and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: patient_documents is missing capture_record_correction_trg';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'patient_documents'
      and grantee = 'authenticated' and privilege_type = 'DELETE'
  ) then
    raise exception 'FAIL: authenticated still has DELETE on patient_documents';
  end if;

  raise notice 'PASS: patient_documents_external_records — table, storage, RLS, timeline, and audit wiring installed';
end $$;
