-- Tarragon Health — Document & Clinical Record Management, part 1/5: the registry.
--
-- WHY THIS TABLE EXISTS AT ALL
--
-- Tarragon already stores files, but only ever as a private column hanging off
-- whichever feature happened to need one: lab_result_documents (20260720120100),
-- ecg_report_documents (20260814193521), vaccination certificates, meal photos,
-- avatars, clinical-staff photos. Six buckets, three of them clinical, each with
-- its own lifecycle, its own review stamp, its own RLS and its own idea of what
-- "available" means. docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.21 named the
-- consequence: there is nowhere to put a discharge summary, a referral letter, a
-- specialist report, an insurance document or an ID, and no single place a
-- patient or a doctor can ask "what documents does this record contain?".
--
-- This is that place. It is a REGISTRY, not a replacement: the two existing
-- clinical pipelines keep their purpose-built tables (they carry structured
-- extraction and interpretation state this table has no business duplicating),
-- and register here through source_table/source_id — the same read-time link
-- patient_timeline already uses. No file is moved and no existing policy is
-- touched by this migration.
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   * No DELETE. A clinical document is archived, never deleted (§35.17), so
--     there is no delete policy and no delete grant — the same structural
--     choice as audit_log and patient_timeline.
--   * No office formats. The allowed MIME list is PDF and images only. A .docx
--     or .xlsm is a macro-carrying executable as far as a document store is
--     concerned, and §35.16 asks for the opposite of that.
--   * No client-settable status. Every lifecycle move is made by the trigger
--     and RPCs in part 2; the insert guard there forces a new row back to
--     'uploaded' whatever the client asked for.
--
-- Parts: 1 registry (this file), 2 lifecycle/versioning, 3 sharing + access
-- audit, 4 OCR/classification + search, 5 retention.

-- ---------------------------------------------------------------------------
-- 1. Vocabulary
-- ---------------------------------------------------------------------------

-- §35.2. One value per document type the module names, plus 'other' so an
-- unanticipated upload lands somewhere honest instead of being mislabelled as
-- the nearest clinical type.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_document_type') then
    create type public.patient_document_type as enum (
      'laboratory_report',
      'imaging_report',
      'referral_letter',
      'consultation_note',
      'prescription',
      'discharge_summary',
      'consent_form',
      'invoice',
      'insurance_document',
      'identification_document',
      'clinical_photograph',
      'other'
    );
  end if;
end $$;

-- §35.5. Clinical and administrative documents get different permissions, so
-- the split has to be a column the RLS policy can read — not a convention.
-- It is DERIVED from document_type (generated column below) rather than passed
-- in, because a caller that could label an ID card 'clinical' would be choosing
-- its own audience.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_document_category') then
    create type public.patient_document_category as enum ('clinical', 'administrative');
  end if;
end $$;

-- §35.4 lifecycle, plus one state the spec's diagram does not name:
-- 'rejected'. §35.16 requires an upload to be scanned and validated BEFORE it
-- is made available, which means the failure branch has to exist somewhere. A
-- rejected row is kept (the patient must be told their upload failed, and a
-- repeatedly-failing uploader is itself a signal) but never becomes readable.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_document_status') then
    create type public.patient_document_status as enum (
      -- Reserved for a future presigned-upload flow (row created before the
      -- file lands). No code path in this pass produces a 'created' row —
      -- every upload here follows the same client-uploads-to-storage-then-
      -- inserts-the-row shape every existing document pipeline in this
      -- codebase already uses (lab_result_documents, ecg_report_documents) —
      -- kept in the vocabulary for §35.4 parity and so it is not a breaking
      -- change to add real support for it later.
      'created',
      'uploaded',    -- file stored, not yet scanned/validated
      'validated',   -- scan clean and metadata complete
      'available',   -- readable by its audience
      'superseded',  -- a newer version exists (§35.14) — still readable
      'archived',    -- retained but out of the working record (§35.17)
      'rejected'     -- failed scan or validation; never becomes readable
    );
  end if;
end $$;

-- §35.3 confidentiality classification. Three levels, each with a meaning the
-- RLS policy actually enforces (see private.patient_document_readable):
--   standard   — the normal audience for the document's category.
--   restricted — narrowed to the people who need clinical or administrative
--                authority: a clinical tier for a clinical document, an admin
--                for an administrative one. Care Coordinators and back-office
--                finance accounts drop out.
--   patient_private — the patient's own upload, kept to themselves and whoever
--                they explicitly share it with. Staff cannot see it at all.
--                Only ever set by the patient on their own document, and never
--                available to a staff-sourced upload (enforced in part 2).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_document_confidentiality') then
    create type public.patient_document_confidentiality as enum (
      'standard',
      'restricted',
      'patient_private'
    );
  end if;
end $$;

-- §35.3 source: where the document came from, which is not the same question as
-- who uploaded it (uploaded_by) or who wrote it (author_name/author_profile_id).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_document_source') then
    create type public.patient_document_source as enum (
      'patient',           -- the patient (or a caregiver acting for them)
      'clinician',         -- Tarragon care-team doctor
      'care_coordinator',  -- Tarragon non-clinical staff
      'admin',
      'lab_liaison',       -- emailed partner-lab result, filed by the liaison
      'partner_lab',
      'external_provider', -- a hospital/specialist outside Tarragon
      'system'             -- generated by the platform (an invoice, a report)
    );
  end if;
end $$;

-- §35.16. The gate between 'uploaded' and 'validated'.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'patient_document_scan_status') then
    create type public.patient_document_scan_status as enum (
      'pending',   -- stored, not yet scanned
      'clean',
      'rejected',  -- the scanner or the content check said no
      'error'      -- the scanner could not reach a verdict; NOT a pass
    );
  end if;
end $$;

-- §35.11 — a document arriving is a record event like any other, so it belongs
-- on the existing patient_timeline spine rather than in a second feed.
-- Added here, used by part 2's trigger (a new enum value cannot be used in the
-- transaction that adds it).
alter type public.timeline_event_type add value if not exists 'document_added';

-- ---------------------------------------------------------------------------
-- 2. The registry
-- ---------------------------------------------------------------------------
create table if not exists public.patient_documents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,

  -- --- classification -----------------------------------------------------
  document_type      public.patient_document_type not null,
  -- Derived, never passed in. See the category enum's comment above. The CASE
  -- is inlined rather than calling a helper so the expression stays immutable
  -- and the column can be STORED.
  category           public.patient_document_category
                       generated always as (
                         case
                           when document_type in (
                             'invoice',
                             'insurance_document',
                             'identification_document',
                             'consent_form'
                           ) then 'administrative'::public.patient_document_category
                           else 'clinical'::public.patient_document_category
                         end
                       ) stored,
  confidentiality    public.patient_document_confidentiality not null default 'standard',
  source             public.patient_document_source not null,

  -- --- what it is ---------------------------------------------------------
  title              text not null,
  description        text,
  -- §35.3 "author": the person or organisation that WROTE the document. An
  -- external author has no Tarragon profile, so both shapes exist and both are
  -- nullable — an unknown author is null, never a placeholder string.
  author_profile_id  uuid references public.profiles (id) on delete set null,
  author_name        text,
  author_organisation text,
  -- §35.3 "date": when the document was issued/authored, which is routinely
  -- weeks before it was uploaded. Nullable: a photographed letter often has no
  -- legible date, and guessing one would be worse than admitting it.
  document_date      date,

  -- --- the file -----------------------------------------------------------
  -- storage.objects path in bucket 'patient-documents', never a public URL.
  -- Null only while status = 'created' (see the CHECK below).
  file_path          text,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint check (file_size_bytes is null or file_size_bytes > 0),
  -- §35.15 integrity protection. Computed server-side from the bytes actually
  -- stored, so a later read can prove the file is the one that was validated.
  checksum_sha256    text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),

  -- --- lifecycle (§35.4) --------------------------------------------------
  status             public.patient_document_status not null default 'uploaded',
  uploaded_by        uuid references public.profiles (id) on delete set null,
  uploaded_at        timestamptz not null default now(),
  -- §35.16 scan gate.
  scan_status        public.patient_document_scan_status not null default 'pending',
  scan_detail        text,
  scanned_at         timestamptz,
  -- Null-gated validation attribution (docs/CLINICAL_TRUST_MODEL_SPEC.md §2):
  -- set once, server-derived. validated_by stays null for the automatic
  -- content/scan validation path — an unattended check must never render as a
  -- person having checked it.
  validated_by       uuid references public.profiles (id) on delete set null,
  validated_at       timestamptz,
  available_at       timestamptz,
  archived_at        timestamptz,
  archived_by        uuid references public.profiles (id) on delete set null,
  archive_reason     text,
  rejected_reason    text,

  -- --- versioning (§35.14) ------------------------------------------------
  -- All versions of one document share document_family_id; version counts from
  -- 1. supersedes_id/superseded_by_id make the chain walkable in both
  -- directions. Both versions remain traceable — a correction never edits or
  -- deletes the version it corrects.
  document_family_id uuid not null default gen_random_uuid(),
  version            integer not null default 1 check (version >= 1),
  supersedes_id      uuid references public.patient_documents (id) on delete restrict,
  superseded_by_id   uuid references public.patient_documents (id) on delete restrict,
  supersede_reason   text,

  -- --- links out ----------------------------------------------------------
  -- The purpose-built pipeline row this document is the file for, when it has
  -- one ('lab_result_documents', 'ecg_report_documents', …). Read-time link
  -- only, exactly like patient_timeline.source_table/source_id — this table is
  -- never the source of truth for another table's state.
  source_table       text,
  source_id          uuid,
  -- §35.7: a PDF must not be the only representation of structured clinical
  -- information. When the document has been transcribed into structured rows,
  -- this points at them; when it has not, requires_structured_capture (below)
  -- keeps it visible as an outstanding piece of work rather than a silent gap.
  structured_record_table text,
  structured_record_id    uuid,

  -- --- retention (§35.17; policy machinery lands in part 5) ---------------
  retention_until    date,
  retention_basis    text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A row with no file is only legitimate before the upload completes.
  constraint patient_documents_file_present_when_live check (
    status = 'created' or file_path is not null
  ),
  -- Nothing is readable until it has been scanned clean. This is the §35.16
  -- promise expressed as a constraint rather than as a hope about call order.
  constraint patient_documents_available_requires_clean_scan check (
    status not in ('validated', 'available', 'superseded', 'archived')
    or scan_status = 'clean'
  ),
  -- Version 1 is the head of its own family; every later version points back.
  constraint patient_documents_version_chain check (
    (version = 1 and supersedes_id is null)
    or (version > 1 and supersedes_id is not null)
  ),
  constraint patient_documents_no_self_supersede check (
    supersedes_id is distinct from id and superseded_by_id is distinct from id
  ),
  -- A rejected upload must say why; an archived one must too (§35.17 asks for
  -- retention decisions to be traceable, not silent).
  constraint patient_documents_rejected_has_reason check (
    status <> 'rejected' or rejected_reason is not null
  )
);

-- §35.7. A laboratory or imaging report whose numbers exist only inside a PDF
-- is the failure mode that section warns about; this column is what makes the
-- gap queryable (see the partial index below and the clinician worklist).
alter table public.patient_documents
  add column if not exists requires_structured_capture boolean
    generated always as (
      document_type in ('laboratory_report', 'imaging_report')
    ) stored;

-- One live head per version family: at most one row per family that nothing
-- supersedes and that has not been archived or rejected.
create unique index if not exists patient_documents_family_version_uniq
  on public.patient_documents (document_family_id, version);

-- Read paths. Patient library and clinician chart both sort newest-first.
create index if not exists patient_documents_patient_idx
  on public.patient_documents (patient_id, document_date desc nulls last, uploaded_at desc);
create index if not exists patient_documents_org_idx
  on public.patient_documents (organisation_id, uploaded_at desc);
create index if not exists patient_documents_type_idx
  on public.patient_documents (patient_id, document_type);
create index if not exists patient_documents_family_idx
  on public.patient_documents (document_family_id, version desc);
create index if not exists patient_documents_source_idx
  on public.patient_documents (source_table, source_id)
  where source_table is not null;
-- Ops worklist: anything stuck before 'available'.
create index if not exists patient_documents_pending_idx
  on public.patient_documents (organisation_id, uploaded_at)
  where status in ('created', 'uploaded', 'validated');
-- §35.7 worklist: a report with no structured counterpart yet.
create index if not exists patient_documents_awaiting_structured_idx
  on public.patient_documents (organisation_id, uploaded_at)
  where requires_structured_capture and structured_record_id is null;

drop trigger if exists patient_documents_set_updated_at on public.patient_documents;
create trigger patient_documents_set_updated_at
  before update on public.patient_documents
  for each row execute function private.set_updated_at();

comment on table public.patient_documents is
  'The platform''s document registry (Module 35). One row per version of one document. Never deleted — archived. Lifecycle, versioning and every state move belong to the triggers/RPCs in the parts 2-5 migrations; nothing here is client-settable except the descriptive metadata.';
comment on column public.patient_documents.category is
  'Derived from document_type, never passed in — a caller that could label an ID card clinical would be choosing its own audience. Drives the RLS split in private.patient_document_readable (§35.5).';
comment on column public.patient_documents.source_table is
  'The purpose-built pipeline row this document is the file for (lab_result_documents, ecg_report_documents, …). A read-time link, exactly like patient_timeline''s — this table never owns another table''s state.';
comment on column public.patient_documents.structured_record_id is
  '§35.7. Where the structured representation of this document lives, once one exists. Null on a laboratory/imaging report means the numbers are still trapped in a PDF; requires_structured_capture keeps that visible.';
comment on column public.patient_documents.checksum_sha256 is
  '§35.15 integrity protection. SHA-256 of the bytes as stored, computed server-side at upload. A later read can prove the file is the one that was validated.';

-- ---------------------------------------------------------------------------
-- 3. The read predicate (§35.5) — one definition, reused by RLS and by the
--    file-access RPC in part 3, so the two can never drift apart.
-- ---------------------------------------------------------------------------
--
-- Audience, by (category, confidentiality):
--
--                    standard                     restricted
--   clinical         care team (is_org_staff)     clinical tiers 1-5 / CD only
--   administrative   admin + finance              admin only
--
--   patient_private  the patient, plus anyone they explicitly share with
--                    (the share leg is added by part 3, which extends the
--                    policy rather than redefining this function)
--
-- The patient always reads their own record, whatever the classification, and
-- a caregiver holding a clinical-access grant (private.can_read_clinical) reads
-- clinical/standard documents with them — the same consent model every other
-- patient-scoped table uses. A caregiver does NOT inherit restricted or
-- administrative documents: a delegated grant is for taking part in care, not
-- for the patient's ID card or a document narrowed to a doctor.
create or replace function private.can_access_administrative_documents(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin', 'finance')
      and (role = 'admin' or organisation_id = org)
  );
$$;

comment on function private.can_access_administrative_documents(uuid) is
  'Who may read an administrative document (invoice, insurance, ID, consent form). Deliberately NOT private.is_org_staff: a care-team clinician has no business in a patient''s ID card, and finance — excluded from is_org_staff by 20260729194127 precisely because it reaches data through narrow paths — needs invoices and insurance and nothing else. This is that narrow path, granted by name.';

create or replace function private.patient_document_readable(
  p_patient          uuid,
  p_org              uuid,
  p_category         public.patient_document_category,
  p_confidentiality  public.patient_document_confidentiality
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- The patient's own record is always their own.
    p_patient = (select auth.uid())
    or case
         when p_confidentiality = 'patient_private' then
           -- Nobody but the patient, by classification. Sharing adds its own
           -- leg to the policy in part 3; it does not widen this predicate.
           false
         when p_category = 'administrative' then
           private.can_access_administrative_documents(p_org)
           and p_confidentiality = 'standard'
           -- 'restricted' administrative (an ID document) is admin-only:
           or (p_confidentiality = 'restricted' and private.is_admin())
         when p_confidentiality = 'restricted' then
           private.is_clinical_tier(p_org)
         else
           private.is_org_staff(p_org)
           or private.can_read_clinical(p_patient)
       end;
$$;

comment on function private.patient_document_readable(uuid, uuid, public.patient_document_category, public.patient_document_confidentiality) is
  'The single §35.5 audience rule for a patient document, shared by the RLS SELECT policy and by the file-access RPC so a signed URL can never be minted for someone the row itself would not have shown. Read-only by construction: it must never gate a write policy (see the assertion in part 2).';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.patient_documents enable row level security;

drop policy if exists patient_documents_select on public.patient_documents;
create policy patient_documents_select on public.patient_documents
  for select to authenticated
  using (
    private.patient_document_readable(patient_id, organisation_id, category, confidentiality)
  );

-- INSERT. A patient files into their own record and must label it as theirs;
-- staff file for any patient in their organisation. Which staff may file WHAT
-- (a Care Coordinator must never author a clinical judgment) stays an
-- app/server-action gate, matching the standing platform pattern for
-- medications and protocol signing rather than inventing a new RLS helper.
drop policy if exists patient_documents_insert on public.patient_documents;
create policy patient_documents_insert on public.patient_documents
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
    or (category = 'administrative' and private.can_access_administrative_documents(organisation_id))
  );

-- UPDATE. Deliberately narrow, and narrowed further by the update guard in
-- part 2: the only fields anyone may change through this policy are the
-- descriptive ones. Lifecycle moves go through the SECURITY DEFINER RPCs.
drop policy if exists patient_documents_update on public.patient_documents;
create policy patient_documents_update on public.patient_documents
  for update to authenticated
  using (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
    or (category = 'administrative' and private.can_access_administrative_documents(organisation_id))
  )
  with check (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
    or (category = 'administrative' and private.can_access_administrative_documents(organisation_id))
  );

-- No DELETE policy and no delete grant: archived, never deleted (§35.17).
-- A freshly created table needs its own table-level grant — RLS restricts rows,
-- it does not grant access (see reference_authenticated_table_grants_root_cause).
grant select, insert, update on public.patient_documents to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Storage (§35.15)
-- ---------------------------------------------------------------------------
-- Private bucket, PDF and images only. No office formats: a .docx/.xlsm is a
-- macro carrier, and §35.16 asks for the opposite of that. 25 MB covers a
-- multi-page scanned discharge summary; anything larger is a scanning problem,
-- not a document.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-documents',
  'patient-documents',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/tiff'
  ]
)
on conflict (id) do nothing;

-- Path convention: '<patient_id>/<document_id>.<ext>'. A patient may read and
-- write only under their own uid folder. Staff uploads write under the
-- PATIENT's folder through the service-role client server-side (this policy
-- forbids it directly), and staff reads happen through a short-lived signed URL
-- minted server-side after the RLS-confirmed row read — identical to
-- 'lab-result-documents' (20260720120100). There is deliberately no patient
-- DELETE policy here: the registry never deletes, so neither does the bucket.
drop policy if exists "patient document patient insert" on storage.objects;
create policy "patient document patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "patient document patient select" on storage.objects;
create policy "patient document patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'patient-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
