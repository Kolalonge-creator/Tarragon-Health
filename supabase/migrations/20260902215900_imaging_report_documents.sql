-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 5/9:
-- imaging report documents (raw upload of a scan report PDF/photo).
--
-- Mirrors ecg_report_documents (20260814193521) and lab_result_documents
-- (20260720120100) exactly -- this is the practical near-term path given
-- the self-arranged-only fulfilment posture (part 1/3's header): the
-- patient takes their imaging order to any facility, pays them directly,
-- and uploads the resulting report themselves (same as the currently-active
-- breast_imaging/mammography self-arranged screen_types). Uploading a
-- document here is NEVER auto-parsed into a clinical imaging_reports row on
-- its own -- a clinician reviews the raw upload and a deliberate action
-- files the structured imaging_reports row (part 6), exactly like the lab/
-- ECG document-vs-extraction split.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'imaging_report_document_source') then
    create type public.imaging_report_document_source as enum (
      'patient', 'clinician', 'admin', 'provider_portal'
    );
  end if;
end $$;

create table public.imaging_report_documents (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  imaging_order_id   uuid references public.imaging_orders (id) on delete set null,
  file_path          text not null,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint,
  source             public.imaging_report_document_source not null,
  uploaded_by        uuid references public.profiles (id) on delete restrict,
  note               text,
  reviewed_by        uuid references public.profiles (id) on delete restrict,
  reviewed_at        timestamptz,
  review_note        text,
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index imaging_report_documents_patient_idx on public.imaging_report_documents (patient_id, created_at desc);
create index imaging_report_documents_org_idx on public.imaging_report_documents (organisation_id, created_at desc);
create index imaging_report_documents_order_idx on public.imaging_report_documents (imaging_order_id);
create index imaging_report_documents_unreviewed_idx
  on public.imaging_report_documents (organisation_id, created_at)
  where reviewed_at is null;

create trigger imaging_report_documents_set_updated_at
  before update on public.imaging_report_documents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.imaging_report_documents enable row level security;

create policy imaging_report_documents_select on public.imaging_report_documents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy imaging_report_documents_insert on public.imaging_report_documents
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
  );

create policy imaging_report_documents_update on public.imaging_report_documents
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.imaging_report_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Private storage bucket (mirrors 'ecg-reports' / 'lab-result-documents')
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imaging-reports', 'imaging-reports', false, 20971520, -- 20 MB (scan reports can carry embedded images)
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create policy "imaging report doc patient insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'imaging-reports' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "imaging report doc patient select" on storage.objects
  for select to authenticated
  using (bucket_id = 'imaging-reports' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "imaging report doc patient update" on storage.objects
  for update to authenticated
  using (bucket_id = 'imaging-reports' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'imaging-reports' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "imaging report doc patient delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'imaging-reports' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: derive uploaded_by, raise a routine review alert, notify
-- ---------------------------------------------------------------------------
create or replace function private.handle_imaging_report_document()
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

  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, category, type_code, escalation_level)
  values (
    new.organisation_id, new.patient_id, 'clinician_review', 'open',
    'Imaging report uploaded — review needed',
    format(
      'An imaging report was uploaded (%s)%s. Review the report, confirm findings, and file a structured result. (Uploading a file does not itself create an imaging_reports record.)',
      new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    'clinical', 'abnormal_result', 2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available', jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available', jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.uploaded_by, 'imaging_report_document.uploaded', 'imaging_report_documents', new.id,
    jsonb_build_object('source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

create trigger imaging_report_documents_on_insert
  before insert on public.imaging_report_documents
  for each row execute function private.handle_imaging_report_document();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: server-derive the review stamp, freeze upload-time facts
-- ---------------------------------------------------------------------------
create or replace function private.enforce_imaging_report_document_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.file_path          := old.file_path;
  new.source             := old.source;
  new.uploaded_by        := old.uploaded_by;
  new.clinician_alert_id := old.clinician_alert_id;
  new.created_at         := old.created_at;

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

create trigger imaging_report_documents_update_guard
  before update on public.imaging_report_documents
  for each row execute function private.enforce_imaging_report_document_update();

-- ---------------------------------------------------------------------------
-- Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.imaging_report_documents', 'SELECT') then
    raise exception 'imaging_report_documents: authenticated SELECT grant did not take';
  end if;
  if not exists (select 1 from storage.buckets where id = 'imaging-reports' and public = false) then
    raise exception 'imaging_report_documents: imaging-reports bucket missing or public';
  end if;
  if exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.imaging_report_documents'::regclass
      and con.contype = 'f'
      and a.attname in ('uploaded_by', 'reviewed_by')
      and con.confdeltype <> 'r'
  ) then
    raise exception 'imaging_report_documents: uploaded_by/reviewed_by must be ON DELETE RESTRICT';
  end if;
  raise notice 'PASS: imaging_report_documents in place';
end $$;
