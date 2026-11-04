-- Clinical document engine, step 1: one intake record for every uploaded clinical document, starting with the two lab file
-- stores. Design: docs/plans/clinical-document-engine-2026-11-04.md (sections 3, 8 and 11 step 1); decisions CDE-01 to CDE-07.
--
-- WHAT THIS ADDS (all additive; nothing existing is dropped or rewritten):
--   1. public.clinical_document_kinds: the document taxonomy (spec 3.2). Reference data, an operational setting under G-01
--      (versioned through the audit trigger, a change note, no signature). An admin can add a subtype without a code change; a
--      new PIPELINE still needs code, on purpose, because each pipeline has its own extraction schema and safety rules.
--   2. public.clinical_documents: one row per uploaded document, whichever door it came in by. Created by triggers on the
--      existing stores (lab_result_documents: the patient's own upload; lab_result_files: an S27 team or partner file), so every
--      current upload path (web, mobile, replace, team, partner portal) is covered without touching its code. Carries the one
--      status the spec lists, who uploaded it and through which channel, the file fingerprint, and whether the patient may see it.
--   3. public.clinical_document_jobs: one row per automatic-reading attempt (written from lab_report_extractions), so retries
--      are counted and a failure is visible.
--   4. Duplicate refusal: the same file (SHA-256) already in the same patient's record is refused, whoever uploads it. The
--      fingerprint is computed by the server that receives the file, never trusted from the browser.
--   5. public.ops_exception_queue gains a 'documents' domain: a report the reader could not read, or one stuck while being read,
--      is an operational exception until a person deals with it. Redefined from the LIVE body (the repo copy in
--      20260930094618 is stale: live already carries the home-delivery removal), with only the new branch added.
--   6. public.team_submit_lab_result passes the server-computed fingerprint to the S27 file insert. Redefined from its live body.
--
-- SAFETY PROPERTIES (proved in packages/db/tests/cde1_clinical_document_intake.sql, with sabotage):
--   * Status is DERIVED from the real facts (extraction outcome, review, release, supersession) by one function, never set by a
--     client. A failed or uncertain reading can only move a document toward a person: failed -> processing_failed (ops queue),
--     unready or low-confidence rows -> awaiting_verification. Nothing here can mark anything "normal".
--   * Patient visibility mirrors the source table exactly: a patient sees their own upload, and a team-supplied file only once
--     released (S27 INV-03). The intake row has no values, findings or notes; the uploader sees the status of their own uploads.
--   * No client can insert, update or delete an intake or job row: only the SECURITY DEFINER triggers write them.
--   * Clinical alerting is unchanged: the existing upload alert, S27 release machine and abnormal-result engine still decide.
--
-- Live counts before this migration (2026-11-04): lab_result_documents 0, lab_result_files 0, every other document table 0.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Taxonomy
-- ---------------------------------------------------------------------------------------------------------------------------
create table public.clinical_document_kinds (
  code            text primary key check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  parent_code     text references public.clinical_document_kinds (code) on delete restrict,
  label           text not null check (length(btrim(label)) > 0),
  -- The processing pipeline a document of this kind goes to. Null on a grouping node: a document classified only that far
  -- needs a more specific type before it can be processed.
  pipeline        text check (pipeline in ('lab', 'ecg', 'imaging', 'mammography', 'pathology', 'cervical', 'narrative')),
  -- Which clinical-access category a reader needs (care_access_category). Cervical, HPV, pelvic and obstetric kinds are
  -- reproductive_health, which break-glass never opens (private.has_emergency_access).
  access_category public.care_access_category not null default 'labs_results',
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  change_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint clinical_document_kinds_parent_prefix check (parent_code is null or code like parent_code || '.%')
);

create trigger clinical_document_kinds_set_updated_at before update on public.clinical_document_kinds
  for each row execute function private.set_updated_at();
create trigger audit_row_change_trg after insert or delete or update on public.clinical_document_kinds
  for each row execute function private.audit_row_change();

insert into public.clinical_document_kinds (code, parent_code, label, pipeline, access_category, sort_order) values
  ('lab',                          null,          'Laboratory results',        'lab',         'labs_results', 10),
  ('lab.haematology',              'lab',         'Haematology',               'lab',         'labs_results', 11),
  ('lab.biochemistry',             'lab',         'Biochemistry',              'lab',         'labs_results', 12),
  ('lab.endocrinology',            'lab',         'Endocrinology',             'lab',         'labs_results', 13),
  ('lab.microbiology',             'lab',         'Microbiology',              'lab',         'labs_results', 14),
  ('lab.immunology',               'lab',         'Immunology',                'lab',         'labs_results', 15),
  ('lab.urinalysis',               'lab',         'Urinalysis',                'lab',         'labs_results', 16),
  ('lab.histopathology',           'lab',         'Histopathology',            'pathology',   'labs_results', 17),
  ('lab.cytology',                 'lab',         'Cytology',                  'pathology',   'labs_results', 18),
  ('imaging',                      null,          'Diagnostic imaging',        'imaging',     'labs_results', 20),
  ('imaging.ultrasound',           'imaging',     'Ultrasound',                'imaging',     'labs_results', 21),
  ('imaging.ultrasound.abdomen',   'imaging.ultrasound', 'Abdominal ultrasound', 'imaging',  'labs_results', 22),
  ('imaging.ultrasound.pelvic',    'imaging.ultrasound', 'Pelvic ultrasound',  'imaging',     'reproductive_health', 23),
  ('imaging.ultrasound.obstetric', 'imaging.ultrasound', 'Obstetric ultrasound', 'imaging',  'reproductive_health', 24),
  ('imaging.ultrasound.breast',    'imaging.ultrasound', 'Breast ultrasound',  'imaging',     'labs_results', 25),
  ('imaging.mammography',          'imaging',     'Mammography',               'mammography', 'labs_results', 26),
  ('imaging.xray',                 'imaging',     'X-ray',                     'imaging',     'labs_results', 27),
  ('imaging.ct',                   'imaging',     'CT scan',                   'imaging',     'labs_results', 28),
  ('imaging.mri',                  'imaging',     'MRI scan',                  'imaging',     'labs_results', 29),
  ('imaging.other',                'imaging',     'Other imaging',             'imaging',     'labs_results', 30),
  ('cardiology',                   null,          'Heart tests',               null,          'labs_results', 40),
  ('cardiology.ecg',               'cardiology',  '12-lead ECG',               'ecg',         'labs_results', 41),
  ('cardiology.holter',            'cardiology',  'Holter (ambulatory ECG)',   'narrative',   'labs_results', 42),
  ('cardiology.echo',              'cardiology',  'Echocardiogram',            'imaging',     'labs_results', 43),
  ('cardiology.stress_test',       'cardiology',  'Exercise stress test',      'narrative',   'labs_results', 44),
  ('screening',                    null,          'Cancer screening',          null,          'labs_results', 50),
  ('screening.cervical',           'screening',   'Cervical screening',        'cervical',    'reproductive_health', 51),
  ('screening.hpv',                'screening',   'HPV test',                  'cervical',    'reproductive_health', 52),
  ('screening.breast',             'screening',   'Breast screening',          'mammography', 'labs_results', 53),
  ('screening.colorectal',         'screening',   'Bowel (colorectal) screening', 'narrative', 'labs_results', 54),
  ('screening.prostate',           'screening',   'Prostate screening (PSA)',  'lab',         'labs_results', 55),
  ('screening.other',              'screening',   'Other screening',           'narrative',   'labs_results', 56),
  ('reports',                      null,          'Other reports',             'narrative',   'medical_history', 60),
  ('reports.specialist',           'reports',     'Specialist report',         'narrative',   'medical_history', 61),
  ('reports.discharge',            'reports',     'Discharge summary',         'narrative',   'medical_history', 62),
  ('reports.consultation',         'reports',     'Consultation notes',        'narrative',   'medical_history', 63),
  ('reports.endoscopy',            'reports',     'Endoscopy report',          'narrative',   'medical_history', 64),
  ('reports.colonoscopy',          'reports',     'Colonoscopy report',        'narrative',   'medical_history', 65),
  ('reports.medication',           'reports',     'Medication report',         'narrative',   'medications',     66),
  ('reports.other',                'reports',     'Other medical document',    'narrative',   'medical_history', 67);

alter table public.clinical_document_kinds enable row level security;
-- Reference data with no patient information: every signed-in account may read it (the upload form lists it).
create policy clinical_document_kinds_read on public.clinical_document_kinds for select to authenticated using (true);
create policy clinical_document_kinds_admin_insert on public.clinical_document_kinds for insert to authenticated
  with check (private.is_admin());
create policy clinical_document_kinds_admin_update on public.clinical_document_kinds for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.clinical_document_kinds from anon;
grant select, insert, update on public.clinical_document_kinds to authenticated;
-- Never deleted: a kind in use is deactivated (is_active = false), so history keeps its label.
revoke delete on public.clinical_document_kinds from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Fingerprint columns on the two existing lab file stores (nullable: older paths and partner uploads may not send one)
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.lab_result_documents add column content_sha256 text
  constraint lab_result_documents_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$');
alter table public.lab_result_files add column content_sha256 text
  constraint lab_result_files_content_sha256_format check (content_sha256 ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. The intake record
-- ---------------------------------------------------------------------------------------------------------------------------
create table public.clinical_documents (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  -- How it arrived. 'lab_liaison' is kept for the legacy role (0 accounts; CDE-03 moved the work to care coordinators).
  upload_channel      text not null check (upload_channel in
                        ('patient_app', 'care_coordinator', 'lab_liaison', 'clinician', 'admin', 'partner_integration', 'manual_entry', 'other')),
  uploaded_by         uuid references public.profiles (id) on delete restrict,
  -- Where the investigation was done, independent of who uploaded it (spec 10). Filled from step 2 onwards.
  source_facility_id  uuid references public.lab_providers (id) on delete restrict,
  source_facility_name text,
  investigation_date  date,
  kind_code           text not null references public.clinical_document_kinds (code) on delete restrict,
  kind_source         text not null check (kind_source in ('pipeline', 'uploader', 'ai', 'rules', 'confirmed')),
  access_category     public.care_access_category not null,
  status              text not null check (status in
                        ('uploaded', 'processing', 'processed', 'awaiting_verification', 'doctor_review_required', 'reviewed',
                         'processing_failed', 'superseded')),
  status_reason       text,
  status_changed_at   timestamptz not null default now(),
  visible_to_patient  boolean not null default false,
  -- Set once a newer upload replaces this one and never cleared (a later review changes the status, not this). The duplicate
  -- refusal ignores a replaced file, so the patient can upload it again after replacing it by mistake.
  is_superseded       boolean not null default false,
  content_sha256      text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type           text,
  file_count          integer not null default 1 check (file_count >= 1),
  -- The specialised row this document became. Step 1: always one of the two lab stores.
  routed_table        text not null check (routed_table in ('lab_result_documents', 'lab_result_files')),
  routed_id           uuid not null,
  extraction_attempts integer not null default 0,
  failed_attempts     integer not null default 0,
  last_error          text,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint clinical_documents_routed_once unique (routed_table, routed_id)
);

create index clinical_documents_patient_idx on public.clinical_documents (patient_id, created_at desc);
create index clinical_documents_org_status_idx on public.clinical_documents (organisation_id, status, status_changed_at);
create index clinical_documents_uploader_idx on public.clinical_documents (uploaded_by, created_at desc);
-- Backstop for the duplicate refusal in private.cde_open_intake (a race between two simultaneous uploads of one file).
create unique index clinical_documents_one_file_per_patient
  on public.clinical_documents (patient_id, content_sha256)
  where content_sha256 is not null and not is_superseded;

create trigger clinical_documents_set_updated_at before update on public.clinical_documents
  for each row execute function private.set_updated_at();

alter table public.clinical_documents enable row level security;
create policy clinical_documents_select on public.clinical_documents for select to authenticated using (
  (patient_id = (select auth.uid()) and visible_to_patient)
  -- A staff uploader (care coordinator, clinician, admin) sees the status of their own uploads, never a value: the intake row has
  -- none. Not for a patient, whose visibility must mirror the source tables exactly (visible_to_patient).
  or (uploaded_by = (select auth.uid()) and patient_id <> (select auth.uid()))
  or private.staff_may_read(patient_id, organisation_id, access_category)
);
revoke all on public.clinical_documents from anon;
grant select on public.clinical_documents to authenticated;
-- Explicit, because the public schema's default ACL grants authenticated more than SELECT on a new table.
revoke insert, update, delete, truncate on public.clinical_documents from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Reading attempts
-- ---------------------------------------------------------------------------------------------------------------------------
create table public.clinical_document_jobs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  document_id     uuid not null references public.clinical_documents (id) on delete cascade,
  step            text not null check (step in ('extract')),
  outcome         text not null check (outcome in ('succeeded', 'failed')),
  error           text,
  model_id        text,
  created_at      timestamptz not null default now()
);
create index clinical_document_jobs_document_idx on public.clinical_document_jobs (document_id, created_at);

alter table public.clinical_document_jobs enable row level security;
-- Staff only: an error string is technical and is never shown to a patient.
create policy clinical_document_jobs_select on public.clinical_document_jobs for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category));
revoke all on public.clinical_document_jobs from anon;
grant select on public.clinical_document_jobs to authenticated;
revoke insert, update, delete, truncate on public.clinical_document_jobs from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Status: derived from the facts, in one place
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function private.cde_refresh(p_routed_table text, p_routed_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cd public.clinical_documents;
  v_status text;
  v_reason text;
  v_visible boolean := false;
  d public.lab_result_documents;
  e public.lab_report_extractions;
  r public.lab_results;
  v_unready boolean;
  v_superseded boolean := false;
begin
  select * into v_cd from public.clinical_documents where routed_table = p_routed_table and routed_id = p_routed_id;
  if not found then return; end if;

  if p_routed_table = 'lab_result_documents' then
    select * into d from public.lab_result_documents where id = p_routed_id;
    if not found then return; end if;
    select * into e from public.lab_report_extractions where document_id = p_routed_id;
    v_superseded := d.superseded_by_document_id is not null;
    -- Mirrors lab_result_documents_select + lab_result_documents_hide_replaced exactly.
    v_visible := (d.source = 'patient' or d.reviewed_at is not null)
                 and (d.superseded_by_document_id is null or d.reviewed_at is not null);
    if d.superseded_by_document_id is not null and d.reviewed_at is null then
      v_status := 'superseded'; v_reason := 'Replaced by a newer upload';
    elsif d.reviewed_at is not null or e.status = 'confirmed' then
      v_status := 'reviewed';
    elsif e.status = 'failed' then
      v_status := 'processing_failed'; v_reason := left(coalesce(e.error_message, 'The automatic reader failed'), 300);
    elsif e.id is null then
      -- Not read yet. A patient's own PDF or photo is read automatically straight after upload; anything else waits for a person.
      if d.source = 'patient' and coalesce(d.mime_type, '') in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic') then
        v_status := 'processing';
      elsif d.clinician_alert_id is not null then
        v_status := 'doctor_review_required';
      else
        v_status := 'awaiting_verification';
      end if;
    else
      -- extracted or discarded: a draft exists (or was thrown away) and no clinician has filed it yet.
      select exists (
        select 1 from jsonb_array_elements(coalesce(e.rows, '[]'::jsonb)) x
        where coalesce(x ->> 'status', '') <> 'ready' or coalesce(x ->> 'confidence', 'low') = 'low'
      ) or jsonb_array_length(coalesce(e.rows, '[]'::jsonb)) = 0 or e.status = 'discarded'
      into v_unready;
      if d.clinician_alert_id is not null then
        v_status := 'doctor_review_required';
      elsif v_unready then
        v_status := 'awaiting_verification';
        v_reason := 'Some values could not be read with confidence';
      else
        v_status := 'processed';
      end if;
    end if;
  else
    -- An S27 file: its status is the status of the result it belongs to (the latest, if corrected). Patient visibility mirrors
    -- the lab_results patient read policy exactly: not withdrawn, and released, or added by the patient and not withheld.
    select * into r from public.lab_results where document_id = p_routed_id order by created_at desc limit 1;
    if not found then
      v_status := 'uploaded';
    else
      v_visible := r.withdrawn_at is null
                   and (r.release_state = 'released' or (r.submitted_by_kind = 'patient' and r.release_state <> 'withheld'));
      if r.withdrawn_at is not null then
        v_status := 'reviewed'; v_reason := 'Withdrawn by a clinician';
      elsif r.release_state in ('awaiting_review', 'clinician_disclosure_required') then
        v_status := 'doctor_review_required';
      else
        v_status := 'reviewed'; -- released, or withheld by a clinician
      end if;
    end if;
  end if;

  update public.clinical_documents
     set status = v_status,
         status_reason = v_reason,
         status_changed_at = case when status is distinct from v_status then now() else status_changed_at end,
         visible_to_patient = v_visible,
         is_superseded = is_superseded or v_superseded,
         extraction_attempts = (select count(*) from public.clinical_document_jobs j where j.document_id = v_cd.id),
         failed_attempts = (select count(*) from public.clinical_document_jobs j
                             where j.document_id = v_cd.id and j.outcome = 'failed'
                               and j.created_at > coalesce((select max(s.created_at) from public.clinical_document_jobs s
                                                             where s.document_id = v_cd.id and s.outcome = 'succeeded'), '-infinity')),
         last_error = (select j.error from public.clinical_document_jobs j where j.document_id = v_cd.id order by j.created_at desc limit 1)
   where id = v_cd.id;
end;
$function$;

-- Opens the intake row for a newly stored file, refusing a file already in this patient's record.
create or replace function private.cde_open_intake(
  p_org uuid, p_patient uuid, p_channel text, p_uploaded_by uuid, p_sha text, p_mime text,
  p_routed_table text, p_routed_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing uuid;
begin
  if p_sha is not null then
    select id into v_existing from public.clinical_documents
     where patient_id = p_patient and content_sha256 = p_sha and not is_superseded
     limit 1;
    if v_existing is not null then
      raise exception 'clinical_document_duplicate'
        using errcode = '23505',
              detail = 'This file is already in this patient''s record.',
              hint = v_existing::text;
    end if;
  end if;

  insert into public.clinical_documents (organisation_id, patient_id, upload_channel, uploaded_by, kind_code, kind_source,
      access_category, status, content_sha256, mime_type, routed_table, routed_id, is_test)
  values (p_org, p_patient, p_channel, p_uploaded_by, 'lab', 'pipeline', 'labs_results', 'uploaded', p_sha, p_mime,
      p_routed_table, p_routed_id, coalesce((select is_test from public.profiles where id = p_patient), false));

  perform private.cde_refresh(p_routed_table, p_routed_id);
end;
$function$;

-- lab_result_documents: a patient's own upload (and the older staff document path)
create or replace function private.cde_on_lab_result_document()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    perform private.cde_open_intake(new.organisation_id, new.patient_id,
      case new.source::text
        when 'patient' then 'patient_app'
        when 'lab_liaison' then 'lab_liaison'
        when 'clinician' then 'clinician'
        when 'admin' then 'admin'
        when 'lab_partner' then 'partner_integration'
        else 'other'
      end,
      new.uploaded_by, new.content_sha256, new.mime_type, 'lab_result_documents', new.id);
  else
    perform private.cde_refresh('lab_result_documents', new.id);
  end if;
  return null;
end;
$function$;

create trigger cde_intake_on_insert after insert on public.lab_result_documents
  for each row execute function private.cde_on_lab_result_document();
create trigger cde_refresh_on_update after update of reviewed_at, superseded_by_document_id, clinician_alert_id
  on public.lab_result_documents for each row execute function private.cde_on_lab_result_document();

-- lab_report_extractions: every write of a reading outcome is an attempt
create or replace function private.cde_on_lab_report_extraction()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cd uuid;
begin
  select id into v_cd from public.clinical_documents
   where routed_table = 'lab_result_documents' and routed_id = new.document_id;
  if v_cd is null then return null; end if;
  if new.status in ('extracted', 'failed') then
    insert into public.clinical_document_jobs (organisation_id, patient_id, document_id, step, outcome, error, model_id)
    values (new.organisation_id, new.patient_id, v_cd, 'extract',
            case when new.status = 'failed' then 'failed' else 'succeeded' end,
            case when new.status = 'failed' then left(coalesce(new.error_message, 'unknown error'), 500) end,
            new.model_id);
  end if;
  perform private.cde_refresh('lab_result_documents', new.document_id);
  return null;
end;
$function$;

create trigger cde_refresh_on_extraction after insert or update of status on public.lab_report_extractions
  for each row execute function private.cde_on_lab_report_extraction();

-- lab_result_files: an S27 team or partner file. The fingerprint arrives through team_submit_lab_result (below).
create or replace function private.cde_lab_result_file_fingerprint()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.content_sha256 := coalesce(new.content_sha256, nullif(current_setting('tarragon.upload_sha256', true), ''));
  return new;
end;
$function$;

create trigger cde_fingerprint before insert on public.lab_result_files
  for each row execute function private.cde_lab_result_file_fingerprint();

create or replace function private.cde_on_lab_result_file()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.cde_open_intake(new.organisation_id, new.patient_id,
    coalesce((select case p.role::text
                       when 'patient' then 'patient_app'
                       when 'care_coordinator' then 'care_coordinator'
                       when 'lab_liaison' then 'lab_liaison'
                       when 'clinician' then 'clinician'
                       when 'admin' then 'admin'
                       when 'lab_partner' then 'partner_integration'
                       else 'other'
                     end
                from public.profiles p where p.id = new.uploaded_by), 'partner_integration'),
    new.uploaded_by, new.content_sha256, new.mime_type, 'lab_result_files', new.id);
  return null;
end;
$function$;

create trigger cde_intake_on_insert after insert on public.lab_result_files
  for each row execute function private.cde_on_lab_result_file();

-- lab_results: release, withholding and corrections move the file's status
create or replace function private.cde_on_lab_result()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.document_id is not null then
    perform private.cde_refresh('lab_result_files', new.document_id);
  end if;
  return null;
end;
$function$;

create trigger cde_refresh_on_lab_result after insert or update of release_state, document_id, withdrawn_at on public.lab_results
  for each row execute function private.cde_on_lab_result();

revoke all on function private.cde_refresh(text, uuid) from public;
revoke all on function private.cde_open_intake(uuid, uuid, text, uuid, text, text, text, uuid) from public;
revoke all on function private.cde_on_lab_result_document() from public;
revoke all on function private.cde_on_lab_report_extraction() from public;
revoke all on function private.cde_lab_result_file_fingerprint() from public;
revoke all on function private.cde_on_lab_result_file() from public;
revoke all on function private.cde_on_lab_result() from public;
-- The private schema's default ACL makes every new function authenticated-executable (by design, for RLS helpers). These two
-- are not RLS helpers: only the triggers above call them, so no client role may.
revoke all on function private.cde_refresh(text, uuid) from authenticated;
revoke all on function private.cde_open_intake(uuid, uuid, text, uuid, text, text, text, uuid) from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. The S27 team path carries the server-computed fingerprint. Redefined from the live body; the only change is the two
--    set_config lines around the submit call and the format check.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.team_submit_lab_result(p_patient uuid, p_order uuid, p_panel text, p_items jsonb, p_file jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v uuid := (select auth.uid()); r public.user_role; v_out jsonb;
begin
  select role into r from public.profiles where id = v;
  if r is null or r not in ('admin', 'lab_liaison', 'clinician') then raise exception 'This action is for the care team' using errcode = '42501'; end if;
  if not private.is_org_staff((select organisation_id from public.profiles where id = p_patient)) and r <> 'lab_liaison' then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if r = 'clinician' and not private.clinician_has_patient_access(p_patient) then raise exception 'Not permitted' using errcode = '42501'; end if;
  if r = 'lab_liaison' and (select organisation_id from public.profiles where id = p_patient) is distinct from private.current_org_id() then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_file is not null and (p_file ->> 'content_sha256') is not null and (p_file ->> 'content_sha256') !~ '^[0-9a-f]{64}$' then
    raise exception 'lab_file_hash_invalid' using errcode = '22023';
  end if;
  perform set_config('tarragon.upload_sha256', coalesce(p_file ->> 'content_sha256', ''), true);
  v_out := private.submit_lab_result(p_patient, p_order, p_panel, p_items, p_file, 'tarragon_team', v, null);
  perform set_config('tarragon.upload_sha256', '', true);
  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 7a. Registries: data handling (S39d) and how staff may read (S39b / INV-12)
-- ---------------------------------------------------------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('clinical_documents', 'patient_id', 'clinical_record', 'review', true, false,
        'One intake record per uploaded clinical document: channel, kind, status, file fingerprint, routing (CDE step 1). No values or findings. Class assigned by the migration author, not yet reviewed by the CMO and DPO.'),
       ('clinical_document_jobs', 'patient_id', 'clinical_record', 'review', false, false,
        'Automatic-reading attempts for an uploaded document (outcome, technical error, model). Staff-only operational record. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('clinical_documents', 'tied', 'patient_id', 'labs_results', null),
       ('clinical_document_jobs', 'tied', 'patient_id', 'labs_results', null)
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 7. The automatic retry sweep (apps/web/src/app/api/cron/clinical-document-retry) in the owner registry
-- ---------------------------------------------------------------------------------------------------------------------------
insert into public.automations (name, kind, schedule, source_ref) values
  ('vercel:clinical-document-retry', 'vercel_cron', '15 7 * * *', '/api/cron/clinical-document-retry')
on conflict (name) do nothing;
insert into public.automation_jobs (job_name, schedule, source)
values ('/api/cron/clinical-document-retry', '15 7 * * *', 'vercel') on conflict (job_name) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 8. Ops exception queue: the 'documents' domain (live body, one branch added before INCIDENTS)
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_exception_queue(p_domain text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not private.can_view_ops_console() then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.severity_rank, q.age_hours desc)
    from (
      select * from (
        -- ---------------------------------------------------------------
        -- ALERTS (30.12) — unacknowledged clinical alerts, worst first.
        -- ---------------------------------------------------------------
        select
          'alerts'::text                                        as domain,
          a.id                                                  as entity_id,
          'clinician_alert'::text                               as entity_type,
          case
            when a.level = 'emergency' then 'critical'
            when a.sla_due_at is not null and a.sla_due_at < now() then 'urgent'
            when a.level = 'urgent_escalation' then 'urgent'
            else 'high'
          end                                                   as severity,
          case
            when a.level = 'emergency' then 1
            when a.sla_due_at is not null and a.sla_due_at < now() then 2
            when a.level = 'urgent_escalation' then 2
            else 3
          end                                                   as severity_rank,
          a.title                                               as headline,
          case
            when a.sla_due_at is not null and a.sla_due_at < now()
              then 'Past its contact SLA and still unacknowledged.'
            else 'Awaiting clinician acknowledgement.'
          end                                                   as detail,
          p.full_name                                           as subject_name,
          a.patient_id                                          as subject_id,
          a.created_at                                          as opened_at,
          round(extract(epoch from (now() - a.created_at)) / 3600.0, 1) as age_hours,
          a.sla_due_at                                          as due_at,
          '/clinician'::text                             as href
        from public.clinician_alerts a
        left join public.profiles p on p.id = a.patient_id
        where a.status = 'open'
          and (a.level <> 'routine' or a.created_at < now() - interval '24 hours')

        union all

        -- ---------------------------------------------------------------
        -- APPOINTMENTS (30.8) — booking requests nobody has answered, and
        -- scheduled appointments whose time has passed with no outcome
        -- recorded (the no-show / never-happened gap).
        -- ---------------------------------------------------------------
        select
          'appointments', b.id, 'booking_request',
          case when b.created_at < now() - interval '48 hours' then 'urgent' else 'high' end,
          case when b.created_at < now() - interval '48 hours' then 2 else 3 end,
          'Booking request unanswered',
          'Requested ' || b.service_type || ' for ' || to_char(b.requested_date, 'DD Mon') || '.',
          p.full_name, b.profile_id, b.created_at,
          round(extract(epoch from (now() - b.created_at)) / 3600.0, 1),
          b.created_at + interval '24 hours',
          '/admin/bookings'
        from public.booking_requests b
        left join public.profiles p on p.id = b.profile_id
        where b.status = 'requested'
          and b.created_at < now() - interval '12 hours'

        union all

        select
          'appointments', ap.id, 'appointment',
          'high', 3,
          'Appointment outcome not recorded',
          'Scheduled time has passed and it is still marked scheduled — complete it or mark the no-show.',
          p.full_name, ap.patient_id, ap.scheduled_for,
          round(extract(epoch from (now() - ap.scheduled_for)) / 3600.0, 1),
          ap.scheduled_for + interval '24 hours',
          '/clinician/appointments'
        from public.appointments ap
        left join public.profiles p on p.id = ap.patient_id
        where ap.status = 'scheduled'
          and ap.scheduled_for < now() - interval '12 hours'

        union all

        -- ---------------------------------------------------------------
        -- REFERRALS (30.9) — raised but never booked, or booked with the
        -- appointment date behind us and no completion.
        -- ---------------------------------------------------------------
        select
          'referrals', r.id, 'specialist_referral',
          case when r.created_at < now() - interval '7 days' then 'urgent' else 'high' end,
          case when r.created_at < now() - interval '7 days' then 2 else 3 end,
          'Referral awaiting booking',
          r.specialist_type::text || ' referral has had no booking confirmed.',
          p.full_name, r.patient_id, r.created_at,
          round(extract(epoch from (now() - r.created_at)) / 3600.0, 1),
          r.created_at + interval '72 hours',
          '/clinician/referrals'
        from public.specialist_referrals r
        left join public.profiles p on p.id = r.patient_id
        where r.status = 'pending'
          and r.created_at < now() - interval '48 hours'

        union all

        select
          'referrals', r.id, 'specialist_referral',
          'high', 3,
          'Specialist report overdue',
          'The appointment date has passed and the referral has not been completed.',
          p.full_name, r.patient_id, r.appointment_date,
          round(extract(epoch from (now() - r.appointment_date)) / 3600.0, 1),
          r.appointment_date + interval '7 days',
          '/clinician/referrals'
        from public.specialist_referrals r
        left join public.profiles p on p.id = r.patient_id
        where r.status in ('booked', 'confirmed')
          and r.appointment_date is not null
          and r.appointment_date < now() - interval '7 days'

        union all

        -- ---------------------------------------------------------------
        -- LABORATORY (30.10) — orders stuck before a result.
        -- ---------------------------------------------------------------
        select
          'laboratory', lo.id, 'lab_order',
          case when lo.ordered_at < now() - interval '7 days' then 'urgent' else 'high' end,
          case when lo.ordered_at < now() - interval '7 days' then 2 else 3 end,
          case lo.status
            when 'ordered' then 'Sample not collected'
            when 'sample_collected' then 'Sample collected, no result'
            else 'Result delayed'
          end,
          'Lab order has been open since ' || to_char(lo.ordered_at at time zone 'Africa/Lagos', 'DD Mon') || '.',
          p.full_name, lo.patient_id, lo.ordered_at,
          round(extract(epoch from (now() - lo.ordered_at)) / 3600.0, 1),
          lo.ordered_at + interval '72 hours',
          '/clinician/orders'
        from public.lab_orders lo
        left join public.profiles p on p.id = lo.patient_id
        where lo.status in ('ordered', 'sample_collected', 'processing')
          and lo.ordered_at < now() - interval '3 days'

        union all

        -- ---------------------------------------------------------------
        -- PHARMACY (30.11) — orders that have not reached the patient.
        -- ---------------------------------------------------------------
        select
          'pharmacy', po.id, 'pharmacy_order',
          case when po.requested_at < now() - interval '5 days' then 'urgent' else 'high' end,
          case when po.requested_at < now() - interval '5 days' then 2 else 3 end,
          case po.status
            when 'requested' then 'Prescription not confirmed by pharmacy'
            when 'confirmed' then 'Confirmed but not dispensed'
            when 'dispensed' then 'Dispensed but not collected'
            else 'Dispensed but not collected'
          end,
          'Medication order has not reached the patient.',
          p.full_name, po.patient_id, po.requested_at,
          round(extract(epoch from (now() - po.requested_at)) / 3600.0, 1),
          po.requested_at + interval '48 hours',
          '/admin/settings/partners/pharmacies'
        from public.pharmacy_orders po
        left join public.profiles p on p.id = po.patient_id
        where po.status in ('requested', 'confirmed', 'dispensed')
          and po.requested_at < now() - interval '2 days'

        union all

        -- ---------------------------------------------------------------
        -- PAYMENTS (30.14) — reconciliation exceptions and webhook errors.
        -- ---------------------------------------------------------------
        select
          'payments', f.id, 'payment_reconciliation_flag',
          case when f.flag_type = 'amount_mismatch' then 'urgent' else 'high' end,
          case when f.flag_type = 'amount_mismatch' then 2 else 3 end,
          'Reconciliation exception: ' || replace(f.flag_type, '_', ' '),
          'Provider reference ' || f.provider_reference || ' does not match our ledger.',
          null, null, f.detected_at,
          round(extract(epoch from (now() - f.detected_at)) / 3600.0, 1),
          f.detected_at + interval '72 hours',
          '/finance/reconciliation'
        from public.payment_reconciliation_flags f
        where f.status = 'open'

        union all

        select
          'payments', pt.id, 'payment_transaction',
          'high', 3,
          'Payment webhook failed',
          'Paystack/Stripe event could not be processed: ' || left(pt.error, 120),
          null, null, pt.created_at,
          round(extract(epoch from (now() - pt.created_at)) / 3600.0, 1),
          pt.created_at + interval '24 hours',
          '/finance'
        from public.payment_transactions pt
        where pt.error is not null
          and pt.processed_at is null
          and pt.created_at > now() - interval '30 days'

        union all

        -- ---------------------------------------------------------------
        -- DOCUMENTS (clinical document engine, step 1): an uploaded report
        -- the automatic reader could not read, or one stuck while being read.
        -- A person has to read it; it must never sit unseen.
        -- ---------------------------------------------------------------
        select
          'documents', cd.id, 'clinical_document',
          case when cd.status_changed_at < now() - interval '24 hours' then 'urgent' else 'high' end,
          case when cd.status_changed_at < now() - interval '24 hours' then 2 else 3 end,
          case cd.status
            when 'processing_failed' then 'Uploaded report could not be read'
            else 'Uploaded report stuck while being read'
          end,
          case cd.status
            when 'processing_failed' then 'The automatic reader failed ' || cd.failed_attempts::text || ' time(s). A person needs to read the original.'
            else 'Still marked as being read after 30 minutes.'
          end,
          p.full_name, cd.patient_id, cd.status_changed_at,
          round(extract(epoch from (now() - cd.status_changed_at)) / 3600.0, 1),
          cd.status_changed_at + interval '24 hours',
          '/clinician/patients/' || cd.patient_id::text
        from public.clinical_documents cd
        left join public.profiles p on p.id = cd.patient_id
        where cd.status = 'processing_failed'
           or (cd.status = 'processing' and cd.status_changed_at < now() - interval '30 minutes')

        union all

        -- ---------------------------------------------------------------
        -- INCIDENTS (30.18) — anything past its own SLA.
        -- ---------------------------------------------------------------
        select
          'incidents', i.id, 'ops_incident',
          case when i.severity = 'sev1' then 'critical' else 'urgent' end,
          case when i.severity = 'sev1' then 1 else 2 end,
          i.reference || ' — ' || i.title,
          case
            when i.acknowledged_at is null then 'Not acknowledged and past its acknowledgement SLA.'
            else 'Past its resolution SLA.'
          end,
          null, null, i.detected_at,
          round(extract(epoch from (now() - i.detected_at)) / 3600.0, 1),
          case when i.acknowledged_at is null then i.ack_due_at else i.resolve_due_at end,
          '/admin/ops/incidents/' || i.id::text
        from public.ops_incidents i
        where i.status <> 'closed'
          and (
            (i.acknowledged_at is null and i.ack_due_at < now())
            or (i.resolved_at is null and i.resolve_due_at < now())
          )

        union all

        -- ---------------------------------------------------------------
        -- PROVIDERS (30.5) — clinical staff who can be routed work but whose
        -- licence has never been verified. A governance exception, and one
        -- that belongs on the same queue as everything else precisely
        -- because it is nobody's daily habit to go looking for it.
        -- ---------------------------------------------------------------
        select
          'providers', cs.id, 'clinical_staff',
          'urgent', 2,
          'Clinical staff licence unverified',
          'This staff record is active but has never had its licence verified.',
          pr.full_name, cs.profile_id, cs.created_at,
          round(extract(epoch from (now() - cs.created_at)) / 3600.0, 1),
          cs.created_at + interval '7 days',
          '/admin/settings/clinical-staff'
        from public.clinical_staff cs
        left join public.profiles pr on pr.id = cs.profile_id
        where cs.active
          and cs.license_verified_at is null
      ) src
      where p_domain is null or p_domain = 'all' or src.domain = p_domain
      order by src.severity_rank, src.age_hours desc
      limit v_limit
    ) q
  ), '[]'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 9. Self-checks
-- ---------------------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  f text;
begin
  foreach t in array array['clinical_documents', 'clinical_document_jobs', 'clinical_document_kinds'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception '% must not be readable by anon', t; end if;
  end loop;
  foreach t in array array['clinical_documents', 'clinical_document_jobs'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception '% must have no client write path', t;
    end if;
  end loop;
  foreach f in array array['private.cde_refresh(text,uuid)', 'private.cde_open_intake(uuid,uuid,text,uuid,text,text,text,uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '% must not be executable by a client', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.team_submit_lab_result(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'team_submit_lab_result must not be executable by anon';
  end if;
  if (select count(*) from public.clinical_document_kinds) < 40 then raise exception 'taxonomy seed missing'; end if;
end $$;

-- The analytics views are rebuilt when a base table gains columns (oq39_analytics_clean_views_drift proof).
select private.rebuild_analytics_clean_views();
