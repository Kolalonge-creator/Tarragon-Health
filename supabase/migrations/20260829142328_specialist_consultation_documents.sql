-- Tarragon Health — Specialist Care Coordination & Continuity Engine, part 1/7
-- specialist_consultation_documents (raw upload of a specialist's report)
--
-- WHY: specialist_referrals has always had free text only for what a
-- specialist sends back (treatment_plan_note, manually transcribed by org
-- staff per 20260716100000's own comment — "specialists have no platform
-- login"). Nothing structured survives the visit: no diagnosis, no coded
-- recommendations, nothing a follow-up engine could act on. This is the
-- "specialist writes report -> nobody follows the plan" gap the coordination
-- module exists to close.
--
-- Mirrors ecg_report_documents (20260814193521) almost exactly — same
-- reasoning for keeping this a GENUINELY SEPARATE table rather than a "kind"
-- column on an existing document table: the extraction schema (diagnosis/
-- recommendations/medications/investigations/follow-up interval) is entirely
-- different from a lab analyte row or an ECG parameter block, and needs its
-- own worklist. One structural difference from the ECG table: this one
-- anchors to a specific specialist_referrals row (referral_id NOT NULL)
-- rather than standing alone, since a consultation report only means
-- anything in the context of the referral it closes the loop on.
--
-- SCOPE: this migration only stores the upload. Extraction is the next
-- migration (specialist_consultation_extractions) — uploading a document
-- here is never auto-parsed into anything; a clinician reviews and
-- deliberately confirms, exactly like the lab and ECG pipelines.
--
-- organisation_id/patient_id are SERVER-DERIVED from referral_id (never
-- client-supplied) — see private.handle_specialist_consultation_document
-- below — so a client can never tag an upload onto a referral it doesn't
-- belong to.

-- ---------------------------------------------------------------------------
-- 1. Source of an uploaded document
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'specialist_consultation_document_source') then
    create type public.specialist_consultation_document_source as enum (
      'patient',          -- the patient uploaded the report the specialist gave them
      'care_coordinator', -- a Care Coordinator uploaded on the patient's behalf (logistics, not a clinical write)
      'clinician',        -- a clinician uploaded on the patient's behalf
      'admin'             -- an admin uploaded on the patient's behalf
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table if not exists public.specialist_consultation_documents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  referral_id        uuid not null references public.specialist_referrals (id) on delete cascade,
  -- storage.objects path (bucket 'specialist-consultation-reports'), never a
  -- public URL. Viewed by staff only through a short-lived signed URL minted
  -- server-side.
  file_path          text not null,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint,
  source             public.specialist_consultation_document_source not null,
  -- Server-derived (never trusted from the client). For a service-role staff
  -- upload (auth.uid() null) it is passed explicitly by the server action.
  uploaded_by        uuid references public.profiles (id) on delete restrict,
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

create index if not exists specialist_consultation_documents_patient_idx
  on public.specialist_consultation_documents (patient_id, created_at desc);
create index if not exists specialist_consultation_documents_org_idx
  on public.specialist_consultation_documents (organisation_id, created_at desc);
create index if not exists specialist_consultation_documents_referral_idx
  on public.specialist_consultation_documents (referral_id);
-- Clinician worklist: documents still awaiting review.
create index if not exists specialist_consultation_documents_unreviewed_idx
  on public.specialist_consultation_documents (organisation_id, created_at)
  where reviewed_at is null;

drop trigger if exists specialist_consultation_documents_set_updated_at on public.specialist_consultation_documents;
create trigger specialist_consultation_documents_set_updated_at
  before update on public.specialist_consultation_documents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — patient sees/uploads own; org staff see/upload for any org patient
-- ---------------------------------------------------------------------------
-- Care-Coordinator write guardrail (upload yes — logistics, not a clinical
-- write — review/confirm no) is enforced by the confirm RPC in the next
-- migration, not a new RLS helper, matching ecg_report_documents' posture.
alter table public.specialist_consultation_documents enable row level security;

drop policy if exists specialist_consultation_documents_select on public.specialist_consultation_documents;
create policy specialist_consultation_documents_select on public.specialist_consultation_documents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists specialist_consultation_documents_insert on public.specialist_consultation_documents;
create policy specialist_consultation_documents_insert on public.specialist_consultation_documents
  for insert to authenticated
  with check (
    -- organisation_id/patient_id are re-derived from referral_id by the
    -- BEFORE INSERT trigger below before this check runs, so this evaluates
    -- against the server-corrected row, not whatever the client sent.
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
  );

-- Only org staff may update (the clinician-review stamp). Patients never update.
drop policy if exists specialist_consultation_documents_update on public.specialist_consultation_documents;
create policy specialist_consultation_documents_update on public.specialist_consultation_documents
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.specialist_consultation_documents to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Private storage bucket (mirrors 'ecg-reports')
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'specialist-consultation-reports',
  'specialist-consultation-reports',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

-- Path convention: '<patient_id>/<uuid>.<ext>'. A patient may read/write only
-- objects under their own uid folder; staff uploads write under the
-- *patient's* folder via the service-role client server-side; staff reads
-- happen through a short-lived signed URL minted server-side.
drop policy if exists "specialist consultation doc patient insert" on storage.objects;
create policy "specialist consultation doc patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'specialist-consultation-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "specialist consultation doc patient select" on storage.objects;
create policy "specialist consultation doc patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'specialist-consultation-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "specialist consultation doc patient update" on storage.objects;
create policy "specialist consultation doc patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'specialist-consultation-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'specialist-consultation-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "specialist consultation doc patient delete" on storage.objects;
create policy "specialist consultation doc patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'specialist-consultation-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT: derive organisation_id/patient_id from the referral,
--    derive uploaded_by, flag for clinician review, notify
-- ---------------------------------------------------------------------------
create or replace function private.handle_specialist_consultation_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral public.specialist_referrals%rowtype;
  v_alert_id uuid;
begin
  select * into v_referral from public.specialist_referrals where id = new.referral_id;
  if v_referral.id is null then
    raise exception 'Referral not found' using errcode = '23503';
  end if;

  -- Never trust client-supplied scope: always the referral's own.
  new.organisation_id := v_referral.organisation_id;
  new.patient_id := v_referral.patient_id;

  if new.source = 'patient' and v_referral.patient_id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'A patient may only upload a report against their own referral' using errcode = '42501';
  end if;

  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  -- A freshly uploaded document is never pre-reviewed.
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  -- Flag for a clinician to review. escalation_level 2 = routine review, NOT
  -- an emergency Priority-1 — nothing about an upload alone is ever treated
  -- as clinically urgent; only a clinician's own read of it can be.
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Specialist report uploaded — review needed',
    format(
      'A specialist consultation report was uploaded for referral %s (%s)%s. Review it, confirm or correct the extracted plan, and it will be filed against the referral.',
      v_referral.referral_number,
      new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  -- Tell the patient their report is on file — but only when someone ELSE
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
    'specialist_consultation_document.uploaded',
    'specialist_consultation_documents',
    new.id,
    jsonb_build_object('referral_id', new.referral_id, 'source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

drop trigger if exists specialist_consultation_documents_on_insert on public.specialist_consultation_documents;
create trigger specialist_consultation_documents_on_insert
  before insert on public.specialist_consultation_documents
  for each row execute function private.handle_specialist_consultation_document();

-- ---------------------------------------------------------------------------
-- 6. BEFORE UPDATE: server-derive the clinician-review attribution
-- ---------------------------------------------------------------------------
create or replace function private.enforce_specialist_consultation_document_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Upload-time facts are immutable after insert.
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.referral_id        := old.referral_id;
  new.file_path           := old.file_path;
  new.source              := old.source;
  new.uploaded_by         := old.uploaded_by;
  new.clinician_alert_id  := old.clinician_alert_id;
  new.created_at          := old.created_at;

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

drop trigger if exists specialist_consultation_documents_update_guard on public.specialist_consultation_documents;
create trigger specialist_consultation_documents_update_guard
  before update on public.specialist_consultation_documents
  for each row execute function private.enforce_specialist_consultation_document_update();

-- ---------------------------------------------------------------------------
-- 7. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.specialist_consultation_documents', 'SELECT') then
    raise exception 'specialist_consultation_documents: authenticated SELECT grant did not take';
  end if;
  if not has_table_privilege('authenticated', 'public.specialist_consultation_documents', 'INSERT') then
    raise exception 'specialist_consultation_documents: authenticated INSERT grant did not take';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'specialist-consultation-reports' and public = false
  ) then
    raise exception 'specialist_consultation_documents: specialist-consultation-reports bucket missing or public';
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.specialist_consultation_documents'::regclass
      and con.contype = 'f'
      and a.attname in ('uploaded_by', 'reviewed_by')
      and con.confdeltype <> 'r'
  ) then
    raise exception 'specialist_consultation_documents: uploaded_by/reviewed_by must be ON DELETE RESTRICT';
  end if;
end $$;
