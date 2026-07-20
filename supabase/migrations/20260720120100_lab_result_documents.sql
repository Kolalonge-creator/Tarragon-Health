-- Tarragon Health — Lab result documents (raw PDF/image of a patient result)
--
-- Some partner labs never log into Tarragon; they email a patient's result to a
-- Tarragon inbox. A Lab Liaison Officer (see 20260720120000) uploads that file
-- into the correct patient's record. Patients can also upload their own result,
-- and clinicians/admins can upload on a patient's behalf. Once uploaded, the
-- document is viewable by the patient (own portal) and by org clinical staff,
-- and it is FLAGGED for a clinician to interpret.
--
-- This is a genuinely NEW object — the raw result file — separate from:
--   * lab_result_interpretations (structured ML/clinician verdicts), and
--   * screening_results (the abnormal-result Cat 2->1 pipeline events).
-- Uploading a document is NEVER auto-parsed into a screening_result: the
-- abnormal-result pipeline stays human-driven. A doctor reviews the uploaded
-- file and, if warranted, authors the screening_result themselves.
--
-- Design mirrors existing patterns:
--   * Private storage bucket + patient-own-folder policies + server-signed URLs
--     for staff — identical to 'vaccination-certificates' (20260717120000).
--   * A staff upload raises a `clinician_review` alert (escalation_level 2, NOT
--     emergency) — same shape as private.handle_hospital_admission.
--   * uploaded_by / reviewed_by are server-derived, never client-trusted — same
--     forge-proof rule as medications.last_confirmed_by / vaccination verified_by.

-- ---------------------------------------------------------------------------
-- 1. Source of an uploaded document
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lab_result_document_source') then
    create type public.lab_result_document_source as enum (
      'patient',      -- the patient uploaded their own result
      'lab_liaison',  -- the Lab Liaison Officer uploaded an emailed lab result
      'clinician',    -- a clinician/doctor uploaded on the patient's behalf
      'admin'         -- an admin uploaded on the patient's behalf
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table if not exists public.lab_result_documents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  -- An emailed result may have no order on file, so the link is optional.
  lab_order_id       uuid references public.lab_orders (id) on delete set null,
  -- storage.objects path (bucket 'lab-result-documents'), never a public URL.
  -- Viewed by staff only through a short-lived signed URL minted server-side.
  file_path          text not null,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint,
  source             public.lab_result_document_source not null,
  -- Who uploaded it — server-derived (never trusted from the client). For a
  -- service-role staff upload (auth.uid() null) it is passed explicitly.
  uploaded_by        uuid references public.profiles (id) on delete set null,
  -- Free-text context from the uploader, e.g. "Synlab · FBC · received 20 Jul".
  note               text,
  -- Null-gated clinician-review attribution (docs/CLINICAL_TRUST_MODEL_SPEC.md
  -- §2): set once, server-derived, when a clinician marks the document reviewed.
  reviewed_by        uuid references public.profiles (id) on delete set null,
  reviewed_at        timestamptz,
  review_note        text,
  -- The clinician_review alert this upload raised (set by the insert trigger).
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists lab_result_documents_patient_idx
  on public.lab_result_documents (patient_id, created_at desc);
create index if not exists lab_result_documents_org_idx
  on public.lab_result_documents (organisation_id, created_at desc);
create index if not exists lab_result_documents_lab_order_idx
  on public.lab_result_documents (lab_order_id);
-- Clinician worklist: documents still awaiting interpretation.
create index if not exists lab_result_documents_unreviewed_idx
  on public.lab_result_documents (organisation_id, created_at)
  where reviewed_at is null;

drop trigger if exists lab_result_documents_set_updated_at on public.lab_result_documents;
create trigger lab_result_documents_set_updated_at
  before update on public.lab_result_documents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — patient sees/uploads own; org staff see/upload for any org patient
-- ---------------------------------------------------------------------------
-- The Care-Coordinator non-clinical write guardrail (a coordinator may READ but
-- not upload) is enforced at the app/server-action layer, matching the existing
-- medications/protocols pattern — not a new RLS helper. Org staff INSERT here is
-- deliberately broad at the RLS level.
alter table public.lab_result_documents enable row level security;

drop policy if exists lab_result_documents_select on public.lab_result_documents;
create policy lab_result_documents_select on public.lab_result_documents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists lab_result_documents_insert on public.lab_result_documents;
create policy lab_result_documents_insert on public.lab_result_documents
  for insert to authenticated
  with check (
    -- A patient may only insert their OWN result, tagged as such.
    (patient_id = (select auth.uid()) and source = 'patient')
    -- Org staff may insert for any patient in their organisation.
    or private.is_org_staff(organisation_id)
  );

-- Only org staff may update (the clinician-review stamp). Patients never update.
drop policy if exists lab_result_documents_update on public.lab_result_documents;
create policy lab_result_documents_update on public.lab_result_documents
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.lab_result_documents to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Private storage bucket (mirrors 'vaccination-certificates')
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lab-result-documents',
  'lab-result-documents',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

-- Path convention: '<patient_id>/<uuid>.<ext>'. A patient may read/write only
-- objects under their own uid folder (patient self-upload). Staff uploads write
-- under the *patient's* folder via the service-role client server-side (the
-- own-folder policy forbids it directly); staff reads happen through a
-- short-lived signed URL minted server-side after an RLS-confirmed row read.
drop policy if exists "lab result doc patient insert" on storage.objects;
create policy "lab result doc patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lab-result-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "lab result doc patient select" on storage.objects;
create policy "lab result doc patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lab-result-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "lab result doc patient update" on storage.objects;
create policy "lab result doc patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'lab-result-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'lab-result-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "lab result doc patient delete" on storage.objects;
create policy "lab result doc patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'lab-result-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT: derive uploaded_by, flag for clinician review, notify
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so a patient-initiated row can raise the staff-owned
-- clinician_alerts row (same pattern as private.handle_hospital_admission),
-- and so uploaded_by can be server-derived rather than trusted.
create or replace function private.handle_lab_result_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  -- Server-derive the uploader from the session when there is one. A
  -- service-role staff upload (auth.uid() null) keeps the id passed by the
  -- server action; a patient/staff own-session insert can never spoof it.
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  -- A freshly uploaded document is never pre-reviewed.
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  -- Flag for a clinician to interpret. escalation_level 2 = routine review,
  -- NOT an emergency Priority-1 (that stays reserved for the abnormal-result
  -- pipeline, which a clinician drives after reading this file).
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Lab result document uploaded — review needed',
    format(
      'A lab result document was uploaded (%s)%s. Review and record any clinical finding. (Uploading a file does not itself create a screening result.)',
      new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  -- Tell the patient their result is available — but only when someone ELSE
  -- uploaded it (a patient who just uploaded their own doesn't need telling).
  -- Notification/confirmation layer only; never gates anything.
  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available',
        jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available',
        jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'lab_result_document.uploaded',
    'lab_result_documents',
    new.id,
    jsonb_build_object('source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

drop trigger if exists lab_result_documents_on_insert on public.lab_result_documents;
create trigger lab_result_documents_on_insert
  before insert on public.lab_result_documents
  for each row execute function private.handle_lab_result_document();

-- ---------------------------------------------------------------------------
-- 6. BEFORE UPDATE: server-derive the clinician-review attribution
-- ---------------------------------------------------------------------------
-- When a clinician marks a document reviewed, reviewed_by is derived from their
-- own session (never spoofable to another doctor), and reviewed_at defaults to
-- now(). The RLS UPDATE policy already restricts this to org staff; whether the
-- acting staff member is *clinical* (a doctor, not a Care Coordinator) is gated
-- in the server action, matching the vaccination-verification pattern. Every
-- upload-owned field is preserved.
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
  new.created_at         := old.created_at;

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

  return new;
end;
$$;

drop trigger if exists lab_result_documents_update_guard on public.lab_result_documents;
create trigger lab_result_documents_update_guard
  before update on public.lab_result_documents
  for each row execute function private.enforce_lab_result_document_update();
