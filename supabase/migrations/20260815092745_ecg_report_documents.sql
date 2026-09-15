-- Tarragon Health — ECG report documents (raw upload of a 12-lead ECG printout)
--
-- WHY: this is the ECG analogue of lab_result_documents (20260720120100) — a
-- patient (or lab_liaison/clinician/admin on their behalf) uploads a photo or
-- PDF of a 12-lead ECG. Kept as a GENUINELY SEPARATE table set from the lab
-- pipeline (ecg_report_documents/ecg_report_extractions/ecg_parameter_readings,
-- not a "kind" column bolted onto lab_result_documents/lab_report_extractions)
-- because the extraction schema is entirely different (rate/intervals/axis vs.
-- analyte rows) and needs its own worklist and review UI — same reasoning
-- already applied to keep wearable_readings separate from vitals_readings.
--
-- SCOPE: this table only stores the upload. Parameter EXTRACTION is a later
-- migration (ecg_report_extractions) — mirroring lab_result_documents vs.
-- lab_report_extractions, uploading a document here is NEVER auto-parsed into
-- anything on its own; a clinician reviews and a deliberate confirm action
-- files the parameters, exactly like the lab pipeline.
--
-- 12-LEAD ONLY: lead count can't be verified with certainty from a photo, so
-- this is enforced at the copy layer (patient-facing upload instructions) and
-- at the extraction-prompt layer (ecg-reports/extract.ts flags a document that
-- doesn't look like a 12-lead printout via unreadable_reason), never here.
--
-- Design mirrors lab_result_documents exactly:
--   * Private storage bucket + patient-own-folder policies + server-signed URLs
--     for staff.
--   * A staff/patient upload raises a `clinician_review` alert (escalation_level
--     2, routine — NOT the emergency/Priority-1 tier reserved for the
--     abnormal-result pipeline) so it surfaces even outside the screen-order
--     checklist worklist.
--   * uploaded_by / reviewed_by are server-derived, never client-trusted.
--   * Attribution FKs use ON DELETE RESTRICT per the provenance-hardening
--     convention (20260730120000) — nullable (legitimately unset until
--     actioned), but once set, never silently erased by a referenced-row
--     delete. patient_id is the record's subject, not an attribution column,
--     so it keeps ON DELETE CASCADE like lab_result_documents.patient_id does.

-- ---------------------------------------------------------------------------
-- 1. Source of an uploaded document
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ecg_report_document_source') then
    create type public.ecg_report_document_source as enum (
      'patient',      -- the patient uploaded their own ECG
      'lab_liaison',  -- the Lab Liaison Officer uploaded one on the patient's behalf
      'clinician',    -- a clinician uploaded on the patient's behalf
      'admin'         -- an admin uploaded on the patient's behalf
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table if not exists public.ecg_report_documents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  -- The Screen-tier lab_orders row this ECG fulfils, if uploaded from that
  -- worklist. Nullable — an ECG can also be uploaded ahead of/without an order.
  lab_order_id       uuid references public.lab_orders (id) on delete set null,
  -- storage.objects path (bucket 'ecg-reports'), never a public URL. Viewed by
  -- staff only through a short-lived signed URL minted server-side.
  file_path          text not null,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint,
  source             public.ecg_report_document_source not null,
  -- Server-derived (never trusted from the client). For a service-role staff
  -- upload (auth.uid() null) it is passed explicitly by the server action.
  uploaded_by        uuid references public.profiles (id) on delete restrict,
  -- Free-text context from the uploader, e.g. "Done at Synlab, 12 Aug".
  note               text,
  -- Null-gated clinician-review attribution (docs/CLINICAL_TRUST_MODEL_SPEC.md
  -- §2): set once, server-derived, when a clinician marks the document reviewed.
  reviewed_by        uuid references public.profiles (id) on delete restrict,
  reviewed_at        timestamptz,
  review_note        text,
  -- The clinician_review alert this upload raised (set by the insert trigger).
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists ecg_report_documents_patient_idx
  on public.ecg_report_documents (patient_id, created_at desc);
create index if not exists ecg_report_documents_org_idx
  on public.ecg_report_documents (organisation_id, created_at desc);
create index if not exists ecg_report_documents_lab_order_idx
  on public.ecg_report_documents (lab_order_id);
-- Clinician worklist: documents still awaiting review.
create index if not exists ecg_report_documents_unreviewed_idx
  on public.ecg_report_documents (organisation_id, created_at)
  where reviewed_at is null;

drop trigger if exists ecg_report_documents_set_updated_at on public.ecg_report_documents;
create trigger ecg_report_documents_set_updated_at
  before update on public.ecg_report_documents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — patient sees/uploads own; org staff see/upload for any org patient
-- ---------------------------------------------------------------------------
-- Care-Coordinator write guardrail (read yes, upload no) is enforced at the
-- app/server-action layer, matching lab_result_documents — not a new RLS
-- helper. Org staff INSERT is deliberately broad at the RLS level.
alter table public.ecg_report_documents enable row level security;

drop policy if exists ecg_report_documents_select on public.ecg_report_documents;
create policy ecg_report_documents_select on public.ecg_report_documents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists ecg_report_documents_insert on public.ecg_report_documents;
create policy ecg_report_documents_insert on public.ecg_report_documents
  for insert to authenticated
  with check (
    -- A patient may only insert their OWN ECG, tagged as such.
    (patient_id = (select auth.uid()) and source = 'patient')
    -- Org staff may insert for any patient in their organisation.
    or private.is_org_staff(organisation_id)
  );

-- Only org staff may update (the clinician-review stamp). Patients never update.
drop policy if exists ecg_report_documents_update on public.ecg_report_documents;
create policy ecg_report_documents_update on public.ecg_report_documents
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.ecg_report_documents to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Private storage bucket (mirrors 'lab-result-documents')
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ecg-reports',
  'ecg-reports',
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
drop policy if exists "ecg report doc patient insert" on storage.objects;
create policy "ecg report doc patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ecg-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "ecg report doc patient select" on storage.objects;
create policy "ecg report doc patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ecg-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "ecg report doc patient update" on storage.objects;
create policy "ecg report doc patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'ecg-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'ecg-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "ecg report doc patient delete" on storage.objects;
create policy "ecg report doc patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ecg-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT: derive uploaded_by, flag for clinician review, notify
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so a patient-initiated row can raise the staff-owned
-- clinician_alerts row (same pattern as private.handle_lab_result_document),
-- and so uploaded_by can be server-derived rather than trusted.
create or replace function private.handle_ecg_report_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  -- A freshly uploaded document is never pre-reviewed.
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  -- Flag for a clinician to review. escalation_level 2 = routine review, NOT
  -- an emergency Priority-1 — nothing about an upload alone is ever treated as
  -- clinically urgent; only a clinician's own read of it can be.
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    '12-lead ECG uploaded — review needed',
    format(
      'A 12-lead ECG was uploaded (%s)%s. Review the tracing, confirm or correct the extracted parameters, and record a result. (Uploading a file does not itself create a screening result.)',
      new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  -- Tell the patient their ECG is on file — but only when someone ELSE
  -- uploaded it. Notification layer only; never gates anything. Reuses the
  -- existing 'result_document_available' template rather than registering a
  -- new one (WhatsApp/Meta template approval is a slow, separately-tracked
  -- process — see CLAUDE.md's notification-templates status note).
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
    'ecg_report_document.uploaded',
    'ecg_report_documents',
    new.id,
    jsonb_build_object('source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

drop trigger if exists ecg_report_documents_on_insert on public.ecg_report_documents;
create trigger ecg_report_documents_on_insert
  before insert on public.ecg_report_documents
  for each row execute function private.handle_ecg_report_document();

-- ---------------------------------------------------------------------------
-- 6. BEFORE UPDATE: server-derive the clinician-review attribution
-- ---------------------------------------------------------------------------
create or replace function private.enforce_ecg_report_document_update()
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

drop trigger if exists ecg_report_documents_update_guard on public.ecg_report_documents;
create trigger ecg_report_documents_update_guard
  before update on public.ecg_report_documents
  for each row execute function private.enforce_ecg_report_document_update();

-- ---------------------------------------------------------------------------
-- 7. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.ecg_report_documents', 'SELECT') then
    raise exception 'ecg_report_documents: authenticated SELECT grant did not take';
  end if;
  if not has_table_privilege('authenticated', 'public.ecg_report_documents', 'INSERT') then
    raise exception 'ecg_report_documents: authenticated INSERT grant did not take';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'ecg-reports' and public = false
  ) then
    raise exception 'ecg_report_documents: ecg-reports bucket missing or public';
  end if;

  -- The three attribution FKs must be RESTRICT, not SET NULL, per the
  -- provenance-hardening convention — this table is new, so it must be
  -- written correctly from the start rather than needing a later sweep.
  if exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.ecg_report_documents'::regclass
      and con.contype = 'f'
      and a.attname in ('uploaded_by', 'reviewed_by')
      and con.confdeltype <> 'r'
  ) then
    raise exception 'ecg_report_documents: uploaded_by/reviewed_by must be ON DELETE RESTRICT';
  end if;
end $$;
