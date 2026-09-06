-- Patient Health Record architecture review, round 3 — general imaging
-- (spec §1.14/§81.2 "Imaging"). docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md
-- §1.14 found imaging "MOSTLY MISSING": ECG has a full, purpose-built
-- three-table pipeline that is explicitly ECG-only by its own migration
-- comment, and everything else (X-ray, ultrasound, CT, MRI, mammogram) only
-- appears as screening-bundle line items inside the lab_orders flow with
-- nowhere for the actual report/image to land. The spec itself says
-- "initially, storing the report may be sufficient" — that review flagged
-- this as additive and low-risk, "mirrors the lab/ECG document pattern".
--
-- DESIGN: one table, not the ECG pipeline's three — a report/image genuinely
-- needs a doctor to read it (same as a raw lab result), so this mirrors
-- lab_result_documents (20260720120100) almost exactly, including the
-- automatic clinician_review alert on upload. Unlike patient_documents
-- (20260829221812, the OTHER new table this pass adds), which deliberately
-- skips that alert — a scanned vaccination card doesn't need doctor triage,
-- an imaging report does, same reasoning the lab pipeline already applies.
--
-- Deliberately NOT a second imaging_orders table: modality/body-region
-- ordering already happens as a lab_orders line item per the existing
-- screening-bundle flow (confirmed in the prior review) — lab_order_id below
-- links to that when one exists, optional because a patient can also upload
-- an old/external imaging report with no Tarragon order behind it at all.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'imaging_modality') then
    create type public.imaging_modality as enum (
      'xray', 'ultrasound', 'ct_scan', 'mri', 'mammogram', 'dexa', 'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'imaging_report_source') then
    create type public.imaging_report_source as enum (
      'patient', 'lab_liaison', 'clinician', 'admin'
    );
  end if;
end $$;

create table public.imaging_reports (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  -- A screening-bundle ultrasound/mammogram line item may have an order on
  -- file; an externally-obtained scan may not.
  lab_order_id       uuid references public.lab_orders (id) on delete set null,
  modality           public.imaging_modality not null,
  body_region        text,
  study_description  text,
  -- storage.objects path (bucket 'imaging-reports'), never a public URL.
  file_path          text not null,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint,
  source             public.imaging_report_source not null,
  uploaded_by        uuid references public.profiles (id) on delete set null,
  study_date         date,
  note               text,
  reviewed_by        uuid references public.profiles (id) on delete set null,
  reviewed_at        timestamptz,
  findings_summary   text,
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index imaging_reports_patient_idx on public.imaging_reports (patient_id, created_at desc);
create index imaging_reports_org_idx on public.imaging_reports (organisation_id);
create index imaging_reports_lab_order_idx on public.imaging_reports (lab_order_id);
create index imaging_reports_unreviewed_idx on public.imaging_reports (organisation_id, created_at)
  where reviewed_at is null;

create trigger imaging_reports_set_updated_at
  before update on public.imaging_reports
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — identical shape to lab_result_documents.
-- ---------------------------------------------------------------------------
alter table public.imaging_reports enable row level security;

create policy imaging_reports_select on public.imaging_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy imaging_reports_insert on public.imaging_reports
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
  );

create policy imaging_reports_update on public.imaging_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.imaging_reports to authenticated;
revoke delete on public.imaging_reports from authenticated;
revoke all on public.imaging_reports from anon;

-- ---------------------------------------------------------------------------
-- Private storage bucket (mirrors lab-result-documents; larger size limit —
-- imaging exports run bigger than a lab PDF).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imaging-reports',
  'imaging-reports',
  false,
  20971520, -- 20 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'application/dicom']
)
on conflict (id) do nothing;

create policy "imaging report patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imaging-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "imaging report patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imaging-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "imaging report patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'imaging-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'imaging-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "imaging report patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'imaging-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: derive uploaded_by, raise a clinician_review alert, notify,
-- audit. Mirrors private.handle_lab_result_document() exactly.
-- ---------------------------------------------------------------------------
create or replace function private.handle_imaging_report_insert()
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
  new.findings_summary := null;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Imaging report uploaded — review needed',
    format(
      '%s imaging report uploaded (%s)%s. Review and record any clinical finding.',
      new.modality, new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, 'whatsapp', 'imaging_report_available',
        jsonb_build_object('modality', new.modality::text)),
      (new.organisation_id, new.patient_id, 'email', 'imaging_report_available',
        jsonb_build_object('modality', new.modality::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'imaging_report.uploaded',
    'imaging_reports',
    new.id,
    jsonb_build_object('modality', new.modality::text, 'source', new.source::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

create trigger imaging_reports_on_insert
  before insert on public.imaging_reports
  for each row execute function private.handle_imaging_report_insert();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: upload-time facts immutable, server-derive review stamp.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_imaging_report_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.file_path           := old.file_path;
  new.source              := old.source;
  new.uploaded_by         := old.uploaded_by;
  new.clinician_alert_id  := old.clinician_alert_id;
  new.created_at          := old.created_at;

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

create trigger imaging_reports_update_guard
  before update on public.imaging_reports
  for each row execute function private.enforce_imaging_report_update();

-- ---------------------------------------------------------------------------
-- Timeline: imaging_report_uploaded on insert.
-- ---------------------------------------------------------------------------
create or replace function private.timeline_from_imaging_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'imaging_report_uploaded',
    'imaging_reports', new.id,
    'Imaging report uploaded',
    replace(new.modality::text, '_', ' ') || coalesce(' · ' || nullif(new.body_region, ''), ''),
    new.created_at,
    private.timeline_staff_from_profile(new.uploaded_by, new.organisation_id),
    jsonb_build_object('modality', new.modality)
  );
  return new;
end;
$$;

create trigger imaging_reports_timeline
  after insert on public.imaging_reports
  for each row execute function private.timeline_from_imaging_report();

-- ---------------------------------------------------------------------------
-- Attach the two existing generic clinical-core triggers directly.
-- ---------------------------------------------------------------------------
create trigger audit_row_change_trg
  after insert or update or delete on public.imaging_reports
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.imaging_reports
  for each row execute function private.capture_record_correction();

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'imaging_reports') then
    raise exception 'FAIL: imaging_reports table was not created';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'imaging_reports' and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: imaging_reports is missing audit_row_change_trg';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'imaging_reports' and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: imaging_reports is missing capture_record_correction_trg';
  end if;

  raise notice 'PASS: imaging_reports — table, storage, RLS, alert, timeline, and audit wiring installed';
end $$;
