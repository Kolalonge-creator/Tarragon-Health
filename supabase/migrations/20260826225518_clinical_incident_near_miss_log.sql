-- Tarragon Health
-- Item 6 of a 2026-08-26 indemnity/liability audit: "a structured incident/
-- near-miss log in the clinician console, feeding governance review ... a
-- working safety-management system is the best proxy insurers have for
-- future frequency/severity, and it's cheap to build now." Confirmed as a
-- genuine gap before writing this: the only "incident" table in the codebase
-- is data_breach_incidents (20260731015650), which is an NDPA-notification
-- log for admins -- unrelated to clinical incidents/near-misses. CLAUDE.md's
-- Tier 3 "standing QA/spot-audit" responsibility (Clinical Tier Ladder) had
-- no corresponding built feature at all.
--
-- Deliberately modelled on data_breach_incidents' own shape (severity/status
-- CHECK constraints rather than a new enum type, no DELETE policy -- a closed
-- report is retained as evidence a near-miss was actually looked at, not
-- quietly discardable), but with different write access: ANYONE on the org
-- staff can FILE a report -- a Care Coordinator noticing a near-miss and
-- reporting it is exactly the safety culture this table exists to enable,
-- and filing one is not among the three actions CLAUDE.md restricts a Care
-- Coordinator from (medications, escalation resolution, protocol signing).
-- Reviewing/closing one is a clinical judgment and is gated to clinical tier,
-- server-derived the same way case_review_actions/escalations already are --
-- never client-supplied, and a closed report is terminal (no re-deciding).

create table public.clinical_incident_reports (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete cascade,
  patient_id              uuid references public.profiles (id) on delete set null,

  reported_by             uuid references public.profiles (id) on delete restrict,
  reported_at             timestamptz not null default now(),
  occurred_at             timestamptz,

  category                text not null check (category in (
    'medication_error', 'misdiagnosis_risk', 'escalation_delay',
    'communication_breakdown', 'ai_recommendation_error',
    'protocol_deviation', 'documentation_error', 'other'
  )),
  -- 'near_miss' is its own severity, not a status: no actual harm reached the
  -- patient, and that distinction is the whole point of a near-miss log --
  -- collapsing it into 'low' would erase the signal insurers most want.
  severity                text not null check (severity in ('near_miss', 'low', 'medium', 'high', 'critical')),
  description             text not null check (length(btrim(description)) > 0),
  immediate_action_taken  text,
  contributing_factors    text,

  status                  text not null default 'open' check (status in ('open', 'under_review', 'action_planned', 'closed')),

  reviewed_by_staff       uuid references public.clinical_staff (id) on delete restrict,
  reviewed_by_tier        public.doctor_tier,
  reviewed_at             timestamptz,
  review_outcome          text,

  corrective_action       text,
  closed_by_staff         uuid references public.clinical_staff (id) on delete restrict,
  closed_at               timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint clinical_incident_reports_review_requires_reviewer check (
    status not in ('under_review', 'action_planned', 'closed')
    or (reviewed_by_staff is not null and reviewed_at is not null)
  ),
  constraint clinical_incident_reports_closed_requires_outcome check (
    status <> 'closed'
    or (
      closed_by_staff is not null and closed_at is not null
      and review_outcome is not null and length(btrim(review_outcome)) > 0
      and corrective_action is not null and length(btrim(corrective_action)) > 0
    )
  ),
  constraint clinical_incident_reports_open_is_clean check (
    status <> 'open'
    or (reviewed_by_staff is null and reviewed_at is null and closed_by_staff is null and closed_at is null)
  )
);

comment on table public.clinical_incident_reports is
  'Clinical incident / near-miss log feeding governance review (Clinical Tier Ladder''s Tier 3 standing QA/spot-audit responsibility). Any org staff member may file one; reviewing or closing one is a clinical act, server-attributed to the caller''s own clinical_staff record, never client-supplied. A closed report is terminal.';
comment on column public.clinical_incident_reports.severity is
  '''near_miss'' means no harm reached the patient -- kept distinct from ''low'' deliberately, since that distinction is the signal a governance reviewer or underwriter is looking for.';

create index clinical_incident_reports_org_status_idx
  on public.clinical_incident_reports (organisation_id, status, reported_at desc);
create index clinical_incident_reports_patient_idx
  on public.clinical_incident_reports (patient_id) where patient_id is not null;

alter table public.clinical_incident_reports enable row level security;

create policy clinical_incident_reports_select on public.clinical_incident_reports
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy clinical_incident_reports_insert on public.clinical_incident_reports
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- Broad here, narrowed by the trigger below -- same "RLS admits, trigger
-- narrows" shape as case_review_actions/enforce_medication_confirm_only.
create policy clinical_incident_reports_update on public.clinical_incident_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No DELETE policy: a report, once filed, is retained -- same discipline as
-- data_breach_incidents.

grant select, insert, update on public.clinical_incident_reports to authenticated;

-- alter-default-privileges (20260731232749) grants authenticated
-- select/insert/update/delete on every new table by default. This table's
-- own no-DELETE-policy design (a filed report is retained, matching
-- data_breach_incidents) means DELETE should never be reachable even at the
-- raw privilege level, not just left absent as an RLS policy -- same
-- explicit-revoke discipline as case_review_actions.
revoke delete on public.clinical_incident_reports from authenticated;

create trigger clinical_incident_reports_set_updated_at
  before update on public.clinical_incident_reports
  for each row execute function private.set_updated_at();

create or replace function private.enforce_clinical_incident_report_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
  v_is_director boolean;
begin
  if tg_op = 'INSERT' then
    -- Never trust who the client claims filed it, or what state it starts in.
    new.reported_by := (select auth.uid());
    new.reported_at := coalesce(new.reported_at, now());
    new.status := 'open';
    new.reviewed_by_staff := null;
    new.reviewed_by_tier := null;
    new.reviewed_at := null;
    new.review_outcome := null;
    new.corrective_action := null;
    new.closed_by_staff := null;
    new.closed_at := null;
    return new;
  end if;

  -- No re-deciding a closed report -- it is the permanent record that a
  -- near-miss was looked at, not a draft.
  if old.status = 'closed' then
    raise exception 'This incident report is closed and cannot be edited further. File a new report if something new needs recording.'
      using errcode = '42501';
  end if;

  -- Reporter/filing fields are never retroactively rewritable by anyone.
  new.reported_by := old.reported_by;
  new.reported_at := old.reported_at;

  -- Non-clinical edits (description, immediate_action_taken, contributing
  -- factors, or simply adding detail while still 'open') need no clinical
  -- authority -- any org staff, including a Care Coordinator, may add to a
  -- report they or a colleague filed.
  if new.status = old.status then
    return new;
  end if;

  -- Moving into review, action-planning, or closing IS a clinical judgment.
  select id, doctor_tier, is_clinical_director into v_staff_id, v_tier, v_is_director
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
  limit 1;

  if v_staff_id is null or v_tier = 'care_coordinator' then
    raise exception 'Only a clinical-tier member of the care team can move an incident report into review or close it. A Care Coordinator can file a report and add detail, but cannot review or close one.'
      using errcode = '42501';
  end if;

  new.reviewed_by_staff := v_staff_id;
  new.reviewed_by_tier := v_tier;
  new.reviewed_at := now();

  if new.status = 'closed' then
    if new.review_outcome is null or length(btrim(new.review_outcome)) = 0
       or new.corrective_action is null or length(btrim(new.corrective_action)) = 0 then
      raise exception 'Closing an incident report needs a review outcome and a corrective action (or an explicit "no action needed" statement), so a closed report always says what was found and what changed.';
    end if;
    new.closed_by_staff := v_staff_id;
    new.closed_at := now();
  end if;

  return new;
end;
$$;

comment on function private.enforce_clinical_incident_report_attribution() is
  'INSERT: forces reported_by/reported_at/status server-side. UPDATE: blocks editing a closed report, keeps filing attribution immutable, and requires clinical tier (Care Coordinator excluded) plus a stated outcome/corrective action to move a report into review or close it.';

create trigger clinical_incident_reports_enforce_attribution
  before insert or update on public.clinical_incident_reports
  for each row execute function private.enforce_clinical_incident_report_attribution();

revoke all on function private.enforce_clinical_incident_report_attribution() from public;

do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'clinical_incident_reports'
  ) then
    raise exception 'clinical_incident_reports missing after migration';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinical_incident_reports' and cmd = 'DELETE'
  ) then
    raise exception 'clinical_incident_reports must have no DELETE policy -- a filed report is retained';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.clinical_incident_reports'::regclass
      and tgname = 'clinical_incident_reports_enforce_attribution'
      and not tgisinternal
  ) then
    raise exception 'clinical_incident_reports attribution trigger missing';
  end if;

  if not has_table_privilege('authenticated', 'public.clinical_incident_reports', 'INSERT') then
    raise exception 'authenticated lacks INSERT on clinical_incident_reports';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_incident_reports', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on clinical_incident_reports';
  end if;

  raise notice 'PASS: clinical_incident_reports table + RLS + attribution trigger present, no DELETE anywhere';
end $$;
