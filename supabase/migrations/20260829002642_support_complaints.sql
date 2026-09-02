-- Tarragon Health — Patient Support & Service Centre, part 7/8: complaints governance workflow.
--
-- §24.14's exact seven-stage pipeline (Complaint -> Acknowledged -> Assigned
-- -> Investigated -> Response -> Resolution -> Governance review), plus
-- §24.15: a complaint indicating potential patient harm can become a formal
-- clinical/safety incident. That link targets clinical_incident_reports
-- (20260826225518) — the only clinical-incident table in the codebase, per
-- its own header comment — rather than inventing a second one.
--
-- Deliberately staff-owned once filed, unlike support_tickets: a patient
-- may file and read their own complaint but not edit it afterward (no
-- UPDATE policy for the patient at all) — governance workflows in this
-- codebase (clinical_incident_reports, data_breach_incidents) are
-- consistently staff/governance-controlled records, not patient-editable
-- ones. category/severity-style fields are plain text + CHECK, same choice
-- clinical_incident_reports made over a new enum type, for the same reason
-- (a short, stable, non-reused value set).
--
-- 'governance_review' is terminal — the record of oversight having
-- happened, not a draft (same "closed report is terminal" discipline as
-- clinical_incident_reports/care_message_threads).

create table public.complaints (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  related_ticket_id  uuid references public.support_tickets (id) on delete set null,

  category           text not null check (category in (
    'clinical_care', 'billing', 'communication', 'appointment_service',
    'pharmacy_service', 'laboratory_service', 'data_privacy', 'other'
  )),
  description        text not null check (length(btrim(description)) > 0),

  status             public.complaint_status not null default 'received',
  created_by         uuid references public.profiles (id) on delete set null,

  acknowledged_by    uuid references public.profiles (id) on delete set null,
  acknowledged_at    timestamptz,

  assigned_to        uuid references public.profiles (id) on delete set null,
  assigned_at        timestamptz,

  investigated_by    uuid references public.profiles (id) on delete set null,
  investigated_at    timestamptz,
  investigation_note text,

  response_by        uuid references public.profiles (id) on delete set null,
  response_at        timestamptz,
  response_note      text,

  resolved_by        uuid references public.profiles (id) on delete set null,
  resolved_at        timestamptz,
  resolution_note    text,

  governance_reviewed_by uuid references public.profiles (id) on delete set null,
  governance_reviewed_at timestamptz,
  governance_note         text,

  -- §24.15: set by escalate_complaint_to_incident() when this complaint
  -- indicated potential patient harm. Null-gated, same discipline as
  -- support_tickets.escalated_alert_id.
  incident_report_id uuid references public.clinical_incident_reports (id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint complaints_ack_requires_stamp check (
    status not in ('acknowledged', 'assigned', 'investigating', 'response_sent', 'resolved', 'governance_review')
    or (acknowledged_by is not null and acknowledged_at is not null)
  ),
  constraint complaints_assigned_requires_stamp check (
    status not in ('assigned', 'investigating', 'response_sent', 'resolved', 'governance_review')
    or (assigned_to is not null and assigned_at is not null)
  ),
  constraint complaints_investigated_requires_stamp check (
    status not in ('investigating', 'response_sent', 'resolved', 'governance_review')
    or (investigated_by is not null and investigated_at is not null
        and investigation_note is not null and length(btrim(investigation_note)) > 0)
  ),
  constraint complaints_response_requires_stamp check (
    status not in ('response_sent', 'resolved', 'governance_review')
    or (response_by is not null and response_at is not null
        and response_note is not null and length(btrim(response_note)) > 0)
  ),
  constraint complaints_resolved_requires_stamp check (
    status not in ('resolved', 'governance_review')
    or (resolved_by is not null and resolved_at is not null
        and resolution_note is not null and length(btrim(resolution_note)) > 0)
  ),
  constraint complaints_governance_requires_stamp check (
    status <> 'governance_review'
    or (governance_reviewed_by is not null and governance_reviewed_at is not null)
  )
);

comment on table public.complaints is
  'The §24.14 complaints governance workflow: Complaint(received) -> Acknowledged -> Assigned -> Investigated(investigating) -> Response(response_sent) -> Resolution(resolved) -> Governance review. Staff-owned once filed (no patient UPDATE policy). A complaint indicating potential patient harm can become a formal clinical_incident_reports row via escalate_complaint_to_incident() (§24.15).';

create index complaints_org_status_idx
  on public.complaints (organisation_id, status, created_at desc);
create index complaints_patient_idx
  on public.complaints (patient_id, created_at desc);

alter table public.complaints enable row level security;

create policy complaints_select on public.complaints
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy complaints_insert on public.complaints
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Staff-only UPDATE — a filed complaint is not patient-editable (see header).
create policy complaints_update on public.complaints
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No DELETE policy — a filed complaint is retained, same discipline as
-- clinical_incident_reports/data_breach_incidents.
grant select, insert, update on public.complaints to authenticated;
revoke delete on public.complaints from authenticated;

create trigger complaints_set_updated_at
  before update on public.complaints
  for each row execute function private.set_updated_at();

create or replace function private.can_review_complaint_governance(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
    or exists (
      select 1 from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = org
        and active
        and is_clinical_director
    );
$$;

comment on function private.can_review_complaint_governance(uuid) is
  'Gate for the terminal §24.14 "Governance review" step: an admin, or the org''s Clinical Director. Deliberately narrower than private.can_handle_support_escalation (any clinical tier) — governance sign-off is a senior/administrative act, not a clinical-judgment one.';

revoke all on function private.can_review_complaint_governance(uuid) from public;
revoke all on function private.can_review_complaint_governance(uuid) from anon;

create or replace function private.enforce_complaint_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if tg_op = 'INSERT' then
    select organisation_id into v_org from public.profiles where id = new.patient_id;
    if v_org is null then
      raise exception 'patient has no organisation on file';
    end if;
    new.organisation_id := v_org;

    if not private.is_org_staff(v_org) and new.patient_id is distinct from v_uid then
      raise exception 'not authorised to file a complaint for this patient' using errcode = '42501';
    end if;

    new.created_by := v_uid;
    new.status := 'received';
    new.acknowledged_by := null; new.acknowledged_at := null;
    new.assigned_to := null; new.assigned_at := null;
    new.investigated_by := null; new.investigated_at := null; new.investigation_note := null;
    new.response_by := null; new.response_at := null; new.response_note := null;
    new.resolved_by := null; new.resolved_at := null; new.resolution_note := null;
    new.governance_reviewed_by := null; new.governance_reviewed_at := null; new.governance_note := null;
    new.incident_report_id := null;
    return new;
  end if;

  -- UPDATE (RLS already restricts this to org staff; a patient has no
  -- UPDATE policy on this table at all).
  if old.status = 'governance_review' then
    raise exception 'this complaint has completed governance review and is closed to further changes';
  end if;

  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if new.status = 'governance_review' and old.status is distinct from 'governance_review'
     and not private.can_review_complaint_governance(old.organisation_id) then
    raise exception 'only an admin or the Clinical Director can complete governance review' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_complaint_write() from public;

create trigger complaints_enforce_write
  before insert or update on public.complaints
  for each row execute function private.enforce_complaint_write();

-- Transition RPC — the intended write path (same "RLS admits broadly, this
-- is the real gate" posture as advance_support_ticket_status). Stamps the
-- milestone fields for whichever stage p_to is.
create or replace function public.advance_complaint_status(
  p_complaint_id uuid,
  p_to public.complaint_status,
  p_note text default null,
  p_assignee_id uuid default null
)
returns public.complaints
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.complaints;
  v_valid boolean := false;
  v_uid uuid := (select auth.uid());
begin
  select * into v_c from public.complaints where id = p_complaint_id for update;
  if v_c.id is null then
    raise exception 'complaint not found';
  end if;
  if not private.is_org_staff(v_c.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_c.status = 'governance_review' then
    raise exception 'this complaint has completed governance review and is closed to further changes';
  end if;

  if p_to = 'acknowledged' then
    v_valid := v_c.status = 'received';
  elsif p_to = 'assigned' then
    v_valid := v_c.status in ('received', 'acknowledged');
    if v_valid and p_assignee_id is null then
      raise exception 'assigning a complaint needs an assignee';
    end if;
  elsif p_to = 'investigating' then
    v_valid := v_c.status in ('acknowledged', 'assigned');
    if v_valid and (p_note is null or length(btrim(p_note)) = 0) then
      raise exception 'closing out the investigation step needs a note on what was found';
    end if;
  elsif p_to = 'response_sent' then
    v_valid := v_c.status = 'investigating';
    if v_valid and (p_note is null or length(btrim(p_note)) = 0) then
      raise exception 'sending a response needs the response text recorded';
    end if;
  elsif p_to = 'resolved' then
    v_valid := v_c.status = 'response_sent';
    if v_valid and (p_note is null or length(btrim(p_note)) = 0) then
      raise exception 'resolving a complaint needs a resolution note';
    end if;
  elsif p_to = 'governance_review' then
    v_valid := v_c.status = 'resolved';
    if v_valid and not private.can_review_complaint_governance(v_c.organisation_id) then
      raise exception 'only an admin or the Clinical Director can complete governance review' using errcode = '42501';
    end if;
  else
    raise exception 'unsupported target status: %', p_to;
  end if;

  if not v_valid then
    raise exception 'cannot move complaint from % to %', v_c.status, p_to;
  end if;

  update public.complaints set
    status = p_to,
    acknowledged_by = case when p_to = 'acknowledged' then v_uid else acknowledged_by end,
    acknowledged_at = case when p_to = 'acknowledged' then now() else acknowledged_at end,
    assigned_to = case when p_to = 'assigned' then p_assignee_id else assigned_to end,
    assigned_at = case when p_to = 'assigned' then now() else assigned_at end,
    investigated_by = case when p_to = 'investigating' then v_uid else investigated_by end,
    investigated_at = case when p_to = 'investigating' then now() else investigated_at end,
    investigation_note = case when p_to = 'investigating' then p_note else investigation_note end,
    response_by = case when p_to = 'response_sent' then v_uid else response_by end,
    response_at = case when p_to = 'response_sent' then now() else response_at end,
    response_note = case when p_to = 'response_sent' then p_note else response_note end,
    resolved_by = case when p_to = 'resolved' then v_uid else resolved_by end,
    resolved_at = case when p_to = 'resolved' then now() else resolved_at end,
    resolution_note = case when p_to = 'resolved' then p_note else resolution_note end,
    governance_reviewed_by = case when p_to = 'governance_review' then v_uid else governance_reviewed_by end,
    governance_reviewed_at = case when p_to = 'governance_review' then now() else governance_reviewed_at end,
    governance_note = case when p_to = 'governance_review' then p_note else governance_note end
  where id = p_complaint_id
  returning * into v_c;

  return v_c;
end;
$$;

comment on function public.advance_complaint_status(uuid, public.complaint_status, text, uuid) is
  'The §24.14 seven-stage complaint transition RPC. Validates the specific from/to move, requires the stage''s note (or assignee) when the spec implies one, stamps that stage''s *_by/*_at server-side, and gates the terminal governance_review step to private.can_review_complaint_governance().';

revoke execute on function public.advance_complaint_status(uuid, public.complaint_status, text, uuid) from public, anon;
grant execute on function public.advance_complaint_status(uuid, public.complaint_status, text, uuid) to authenticated;

-- §24.15: a complaint indicating potential patient harm becomes a formal
-- clinical incident. Any org staff may file (matches
-- clinical_incident_reports' own "anyone on staff may file" posture) —
-- clinical_incident_reports' own trigger stamps reported_by/at/status
-- server-side regardless of what this RPC passes.
create or replace function public.escalate_complaint_to_incident(
  p_complaint_id uuid,
  p_category text,
  p_severity text,
  p_description text
)
returns public.complaints
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.complaints;
  v_incident_id uuid;
begin
  select * into v_c from public.complaints where id = p_complaint_id for update;
  if v_c.id is null then
    raise exception 'complaint not found';
  end if;
  if not private.is_org_staff(v_c.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_c.incident_report_id is not null then
    raise exception 'this complaint has already been escalated into a clinical incident report';
  end if;

  insert into public.clinical_incident_reports
    (organisation_id, patient_id, category, severity, description)
  values (
    v_c.organisation_id,
    v_c.patient_id,
    p_category,
    p_severity,
    format('Escalated from complaint %s: %s', p_complaint_id, p_description)
  )
  returning id into v_incident_id;

  update public.complaints set incident_report_id = v_incident_id
    where id = p_complaint_id
    returning * into v_c;

  return v_c;
end;
$$;

comment on function public.escalate_complaint_to_incident(uuid, text, text, text) is
  'The §24.15 "complaint -> formal clinical/safety incident" link: files a real clinical_incident_reports row (the only clinical-incident table in the codebase) and links it back via complaints.incident_report_id. Gated to org staff, same posture as filing an incident report directly.';

revoke execute on function public.escalate_complaint_to_incident(uuid, text, text, text) from public, anon;
grant execute on function public.escalate_complaint_to_incident(uuid, text, text, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'complaints') then
    raise exception 'complaints was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'complaints' and cmd = 'DELETE'
  ) then
    raise exception 'complaints must have no DELETE policy — a filed complaint is retained';
  end if;
  if has_table_privilege('authenticated', 'public.complaints', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on complaints';
  end if;
  if has_function_privilege('anon', 'public.advance_complaint_status(uuid, public.complaint_status, text, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute advance_complaint_status';
  end if;
  if has_function_privilege('anon', 'public.escalate_complaint_to_incident(uuid, text, text, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute escalate_complaint_to_incident';
  end if;
  if has_function_privilege('anon', 'private.can_review_complaint_governance(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.can_review_complaint_governance';
  end if;
  raise notice 'PASS: complaints table + governance transition RPCs + incident escalation in place, anon denied';
end $$;
