-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 7/9:
-- incidental findings follow-up / recall tracking (spec §59.12).
--
-- "A major safety feature" per the spec -- a finding unrelated to the
-- original indication (e.g. a CT ordered for one reason turns up an
-- unrelated abnormality) must never depend on someone remembering to chase
-- it up. Reuses clinician_alerts.imaging_report_id (part 6) rather than
-- adding a second traceability column -- an incidental finding always
-- belongs to exactly one imaging_reports row, so the existing link is
-- sufficient to locate it from the alert.

create type public.imaging_incidental_finding_status as enum (
  'open', 'follow_up_scheduled', 'recalled', 'resolved', 'dismissed'
);

create table public.imaging_incidental_findings (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  imaging_report_id   uuid not null references public.imaging_reports (id) on delete cascade,
  description         text not null,
  is_urgent           boolean not null default false,
  status              public.imaging_incidental_finding_status not null default 'open',
  follow_up_due_date  date,
  follow_up_task_note text,
  recalled_at         timestamptz,
  recall_reason       text,
  resolved_by         uuid references public.profiles (id) on delete restrict,
  resolved_at         timestamptz,
  resolution_note     text,
  clinician_alert_id  uuid references public.clinician_alerts (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint imaging_incidental_findings_description_not_blank check (length(btrim(description)) > 0),
  constraint imaging_incidental_findings_recall_requires_reason
    check (status <> 'recalled' or recall_reason is not null),
  constraint imaging_incidental_findings_closure_requires_note
    check (status not in ('resolved', 'dismissed') or resolution_note is not null)
);

create index imaging_incidental_findings_patient_idx on public.imaging_incidental_findings (patient_id, created_at desc);
create index imaging_incidental_findings_org_idx on public.imaging_incidental_findings (organisation_id, created_at desc);
create index imaging_incidental_findings_report_idx on public.imaging_incidental_findings (imaging_report_id);
create index imaging_incidental_findings_open_idx
  on public.imaging_incidental_findings (organisation_id, follow_up_due_date)
  where status in ('open', 'follow_up_scheduled');

create trigger imaging_incidental_findings_set_updated_at
  before update on public.imaging_incidental_findings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS -- staff-identified only (a clinician reviewing a report notes an
-- incidental finding); patient reads their own.
-- ---------------------------------------------------------------------------
alter table public.imaging_incidental_findings enable row level security;

create policy imaging_incidental_findings_select on public.imaging_incidental_findings
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy imaging_incidental_findings_insert on public.imaging_incidental_findings
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy imaging_incidental_findings_update on public.imaging_incidental_findings
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.imaging_incidental_findings to authenticated;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: derive organisation/patient from the parent report, raise
-- a follow-up alert (urgent findings escalate like the abnormal pathway).
-- ---------------------------------------------------------------------------
create or replace function private.handle_imaging_incidental_finding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_level    public.alert_level;
  v_esc      smallint;
  v_sla      interval;
  v_report_org uuid;
  v_report_patient uuid;
begin
  select organisation_id, patient_id into v_report_org, v_report_patient
  from public.imaging_reports where id = new.imaging_report_id;

  if v_report_org is null then
    raise exception 'imaging_reports row % not found', new.imaging_report_id;
  end if;
  -- Raising on a caller-supplied mismatch (rather than silently
  -- overwriting) means this does not depend on BEFORE-trigger-vs-RLS
  -- evaluation ordering -- see the identical reasoning in
  -- private.handle_imaging_safety_questionnaire().
  if new.organisation_id is not null and new.organisation_id <> v_report_org then
    raise exception 'imaging_incidental_findings.organisation_id must match the referenced imaging_reports row';
  end if;
  if new.patient_id is not null and new.patient_id <> v_report_patient then
    raise exception 'imaging_incidental_findings.patient_id must match the referenced imaging_reports row';
  end if;
  new.organisation_id := v_report_org;
  new.patient_id := v_report_patient;

  if new.is_urgent then
    v_level := 'urgent_escalation'; v_esc := 3; v_sla := interval '24 hours';
  else
    v_level := 'clinician_review'; v_esc := 2; v_sla := null;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, category, type_code,
     escalation_level, sla_due_at, imaging_report_id)
  values (
    new.organisation_id, new.patient_id, v_level, 'open',
    'Incidental imaging finding — follow-up needed',
    new.description, 'clinical', 'abnormal_result', v_esc,
    case when v_sla is not null then now() + v_sla else null end,
    new.imaging_report_id
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, (select auth.uid()), 'imaging_incidental_finding.created',
    'imaging_incidental_findings', new.id,
    jsonb_build_object('is_urgent', new.is_urgent, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

create trigger imaging_incidental_findings_on_insert
  before insert on public.imaging_incidental_findings
  for each row execute function private.handle_imaging_incidental_finding();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: freeze filing-time facts, server-derive resolution/recall
-- ---------------------------------------------------------------------------
create or replace function private.stamp_imaging_incidental_finding_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id   := old.organisation_id;
  new.patient_id        := old.patient_id;
  new.imaging_report_id := old.imaging_report_id;
  new.clinician_alert_id := old.clinician_alert_id;
  new.created_at        := old.created_at;

  if new.status = 'recalled' and old.recalled_at is null then
    new.recalled_at := now();
  elsif old.recalled_at is not null then
    new.recalled_at := old.recalled_at;
  end if;

  if new.status in ('resolved', 'dismissed') and old.resolved_at is null then
    new.resolved_by := (select auth.uid());
    new.resolved_at := now();
  elsif old.resolved_at is not null then
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  end if;

  return new;
end;
$$;

create trigger imaging_incidental_findings_stamp_lifecycle
  before update on public.imaging_incidental_findings
  for each row execute function private.stamp_imaging_incidental_finding_lifecycle();

do $$
begin
  if not has_table_privilege('authenticated', 'public.imaging_incidental_findings', 'SELECT') then
    raise exception 'imaging_incidental_findings: authenticated SELECT grant did not take';
  end if;
  if exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.imaging_incidental_findings'::regclass
      and con.contype = 'f'
      and a.attname = 'resolved_by'
      and con.confdeltype <> 'r'
  ) then
    raise exception 'imaging_incidental_findings: resolved_by must be ON DELETE RESTRICT';
  end if;
  raise notice 'PASS: imaging_incidental_findings in place';
end $$;
