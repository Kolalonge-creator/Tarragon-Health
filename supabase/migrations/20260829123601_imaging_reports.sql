-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 6/9:
-- structured imaging report (spec §59.10) + the abnormal-imaging pathway
-- (spec §59.13) plugged into the SAME diagnostic safety loop as lab results
-- (spec §59.15 acceptance criterion).
--
-- This is the core of the whole platform's safety guarantee, so the design
-- choices are deliberately conservative:
--
-- 1. imaging_reports is ALWAYS a human-authored/confirmed record. `ai_assisted`
--    is a provenance flag only -- if AI tooling drafted or suggested any of
--    this content, the draft lived in imaging_ai_assist_drafts (part 8) and
--    a clinician confirmed/copied it here; nothing writes this table
--    directly from a model. Same "AI drafts, never decides" governance as
--    case_briefs (20260730121004) and lab_report_extractions
--    (20260803144056), just enforced one level up: AI never gets a write
--    path to this table AT ALL, rather than to this table gated by a status
--    column, because a radiologist's report is exactly the kind of output
--    spec §59.11 says "should not silently become the definitive clinical
--    report."
--
-- 2. The abnormal pathway does NOT touch private.handle_abnormal_screening_result()
--    or the screening_results/screening_upgrades tables at all -- per the
--    established convention (see 20260828014055's header: "editing 9+ live
--    clinical-safety trigger functions... would be a materially riskier
--    change than this feature needs"), this is a brand-new, independent
--    trigger on a brand-new table that inserts into the same unified
--    clinician_alerts inbox everything else lands in. type_code/category
--    are always set explicitly here (never left to
--    classify_and_assign_clinician_alert()'s default-guessing case
--    expression) so there is no ambiguity about how an imaging finding is
--    classified.
--
-- 3. Severity->SLA mapping mirrors the LIVE abnormal-screening-result code
--    exactly (private.handle_abnormal_screening_result, most recently
--    rewritten by 20260716090000_severity_driven_alert_urgency.sql):
--    critical/emergency = 2 hour SLA, urgent/urgent_escalation = 24 hour SLA.
--    NOTE this is 2h/24h, not the "4-hour contact SLA" wording still in
--    CLAUDE.md's Non-Negotiable Business Rules -- per that same file's own
--    "verify against live code, the archive is not current" instruction,
--    the live trigger code is followed here, not the older prose.
--
-- 4. Every report insert raises a review alert -- abnormal or not -- so
--    "Clinical review" (§59.7's final workflow step) is never optional or
--    silent, exactly matching how ecg_report_documents/lab_result_documents
--    always raise a routine review alert on upload even when nothing is
--    wrong yet.
--
-- Multiple rows per order are allowed (report_status preliminary -> final,
-- or an amendment) via supersedes_report_id, rather than one mutable "the"
-- report row -- a radiology report being corrected after the fact needs its
-- own history, not a silently overwritten field.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.imaging_report_status as enum ('preliminary', 'final', 'amended');

create type public.imaging_finding_urgency as enum ('routine', 'clinically_significant', 'urgent', 'critical');

create type public.imaging_report_source as enum ('patient', 'provider_portal', 'clinician', 'admin');

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table public.imaging_reports (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  imaging_order_id      uuid not null references public.imaging_orders (id) on delete restrict,
  modality              public.imaging_modality not null,
  body_region           text not null,
  study_date            date not null,
  radiologist_id        uuid references public.imaging_provider_staff (id) on delete restrict,
  radiologist_name      text,
  findings              text not null,
  impression            text not null,
  report_status         public.imaging_report_status not null default 'preliminary',
  is_abnormal           boolean not null default false,
  urgency               public.imaging_finding_urgency not null default 'routine',
  ai_assisted           boolean not null default false,
  dicom_study_instance_uid text,
  dicom_accession_number   text,
  pacs_url              text,
  document_id           uuid references public.imaging_report_documents (id) on delete set null,
  source                public.imaging_report_source not null,
  uploaded_by           uuid references public.profiles (id) on delete restrict,
  clinician_alert_id    uuid references public.clinician_alerts (id) on delete set null,
  reviewed_by           uuid references public.profiles (id) on delete restrict,
  reviewed_at           timestamptz,
  review_note           text,
  supersedes_report_id  uuid references public.imaging_reports (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint imaging_reports_findings_not_blank check (length(btrim(findings)) > 0),
  constraint imaging_reports_impression_not_blank check (length(btrim(impression)) > 0)
);

create index imaging_reports_patient_idx on public.imaging_reports (patient_id, created_at desc);
create index imaging_reports_org_idx on public.imaging_reports (organisation_id, created_at desc);
create index imaging_reports_order_idx on public.imaging_reports (imaging_order_id);
create index imaging_reports_unreviewed_idx
  on public.imaging_reports (organisation_id, created_at) where reviewed_at is null;
create index imaging_reports_abnormal_idx
  on public.imaging_reports (organisation_id, created_at) where is_abnormal;

create trigger imaging_reports_set_updated_at
  before update on public.imaging_reports
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. clinician_alerts traceability column (mirrors screening_result_id /
--    vital_reading_id -- purely additive, does not touch any existing
--    trigger function or the classify/assign default-guessing logic).
-- ---------------------------------------------------------------------------
alter table public.clinician_alerts
  add column imaging_report_id uuid references public.imaging_reports (id) on delete set null;

create index clinician_alerts_imaging_report_idx
  on public.clinician_alerts (imaging_report_id) where imaging_report_id is not null;

-- ---------------------------------------------------------------------------
-- 4. RLS -- staff write (a structured report is filed by a clinician
--    reviewing an upload, or entered directly), patient/staff read.
-- ---------------------------------------------------------------------------
alter table public.imaging_reports enable row level security;

create policy imaging_reports_select on public.imaging_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy imaging_reports_insert on public.imaging_reports
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy imaging_reports_update on public.imaging_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.imaging_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT: derive uploaded_by, raise the review/abnormal alert,
--    advance the parent order, notify the patient (generic, non-alarming).
-- ---------------------------------------------------------------------------
create or replace function private.handle_imaging_report_abnormal_pathway()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id  uuid;
  v_level     public.alert_level;
  v_esc_level smallint;
  v_sla       interval;
  v_order_org uuid;
  v_order_patient uuid;
begin
  select organisation_id, patient_id into v_order_org, v_order_patient
  from public.imaging_orders where id = new.imaging_order_id;

  if v_order_org is null then
    raise exception 'imaging_orders row % not found', new.imaging_order_id;
  end if;
  if v_order_org <> new.organisation_id or v_order_patient <> new.patient_id then
    raise exception 'imaging_reports.organisation_id/patient_id must match the referenced imaging_orders row';
  end if;

  if new.uploaded_by is null then
    new.uploaded_by := (select auth.uid());
  end if;
  new.reviewed_by := null;
  new.reviewed_at := null;

  if not new.is_abnormal then
    v_level := 'routine'; v_esc_level := 1; v_sla := null;
  elsif new.urgency = 'critical' then
    v_level := 'emergency'; v_esc_level := 4; v_sla := interval '2 hours';
  elsif new.urgency = 'urgent' then
    v_level := 'urgent_escalation'; v_esc_level := 3; v_sla := interval '24 hours';
  else
    v_level := 'clinician_review'; v_esc_level := 2; v_sla := null;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, category, type_code,
     escalation_level, sla_due_at, imaging_report_id)
  values (
    new.organisation_id, new.patient_id, v_level, 'open',
    case when new.is_abnormal
      then format('Abnormal imaging finding — %s %s', new.modality::text, new.body_region)
      else format('Imaging report filed — %s %s (review needed)', new.modality::text, new.body_region)
    end,
    format('%s%s', new.impression, case when new.is_abnormal then ' Requires clinician review and patient follow-up per the abnormal-imaging pathway.' else '' end),
    'clinical', 'abnormal_result', v_esc_level,
    case when v_sla is not null then now() + v_sla else null end,
    new.id
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  update public.imaging_orders
  set status = 'reported'
  where id = new.imaging_order_id and status not in ('reported', 'result_returned', 'reviewed', 'cancelled');

  -- Generic, non-alarming notification -- never states abnormal/urgent
  -- status directly (matches the brand voice rule against fear-based
  -- urgency, and the existing abnormal-result pathway's own posture of
  -- routing to a clinician first rather than alarming the patient
  -- automatically). Reuses the existing 'result_document_available'
  -- template rather than registering a new one (Meta WhatsApp template
  -- approval is a slow, separately-tracked process -- see CLAUDE.md).
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  values
    (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available', jsonb_build_object('source', 'imaging_report')),
    (new.organisation_id, new.patient_id, 'email', 'result_document_available', jsonb_build_object('source', 'imaging_report'));

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.uploaded_by, 'imaging_report.filed', 'imaging_reports', new.id,
    jsonb_build_object('is_abnormal', new.is_abnormal, 'urgency', new.urgency::text, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

create trigger imaging_reports_on_insert
  before insert on public.imaging_reports
  for each row execute function private.handle_imaging_report_abnormal_pathway();

-- ---------------------------------------------------------------------------
-- 6. BEFORE UPDATE: freeze filing-time facts, server-derive the review stamp
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
  new.imaging_order_id   := old.imaging_order_id;
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
  end if;

  return new;
end;
$$;

create trigger imaging_reports_update_guard
  before update on public.imaging_reports
  for each row execute function private.enforce_imaging_report_update();

-- ---------------------------------------------------------------------------
-- 7. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.imaging_reports', 'SELECT') then
    raise exception 'imaging_reports: authenticated SELECT grant did not take';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts' and column_name = 'imaging_report_id'
  ) then
    raise exception 'clinician_alerts.imaging_report_id was not added';
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.imaging_reports'::regclass
      and con.contype = 'f'
      and a.attname in ('uploaded_by', 'reviewed_by')
      and con.confdeltype <> 'r'
  ) then
    raise exception 'imaging_reports: uploaded_by/reviewed_by must be ON DELETE RESTRICT';
  end if;

  raise notice 'PASS: imaging_reports + abnormal-imaging pathway in place';
end $$;
