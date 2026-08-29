-- Tarragon Health — Vaccination & Immunisation Engine, gap closure 3/3
--
-- Spec §43.11: a patient can report a reaction/fever/pain/other symptom
-- following a dose, and "potentially significant events should route to
-- appropriate clinical review." Nothing in this area existed before this
-- migration.
--
-- Reuses the alert infrastructure built 2026-08-28 rather than inventing a
-- parallel review queue: a significant report raises a real clinician_alerts
-- row via the shared private.raise_clinician_alert() helper, tagged with the
-- existing 'symptom_escalation' alert_type_code ("a patient self-reported a
-- danger symptom" — an exact fit; see alert_rules' own governance entry for
-- that type) rather than widening the alert_type_code enum, which the
-- alert-system migrations assert has exactly 16 values. This means the
-- report inherits severity/dedup/ownership assignment, the ack-timeout
-- escalation ladder, and WhatsApp delivery automatically, and surfaces in
-- whatever inbox already renders clinician_alerts — no new clinician queue
-- needed.
--
-- "Significant" is a deterministic threshold, same philosophy as every other
-- red-flag rule on this platform: severe severity, or any allergic-reaction
-- symptom, at any severity (an allergic reaction can escalate fast even when
-- initially reported as mild/moderate).

create type public.vaccination_adverse_event_severity as enum ('mild', 'moderate', 'severe');

create type public.vaccination_adverse_event_symptom as enum (
  'pain_at_site', 'swelling_at_site', 'redness_at_site', 'fever',
  'allergic_reaction', 'fatigue', 'headache', 'nausea', 'other'
);

create table public.vaccination_adverse_events (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  vaccination_record_id   uuid not null references public.vaccination_records (id) on delete cascade,
  -- Server-derived below — never trusted from the caller.
  reported_by             uuid references public.profiles (id) on delete set null,
  symptoms                public.vaccination_adverse_event_symptom[] not null,
  severity                public.vaccination_adverse_event_severity not null,
  description             text,
  onset_at                timestamptz,
  reported_at             timestamptz not null default now(),
  -- Set by the alert-raising trigger below when the report is significant;
  -- null for a mild/moderate report that never generated one.
  alert_id                uuid references public.clinician_alerts (id) on delete set null,
  -- Null-gated clinical review attribution — same shape as
  -- vaccination_records.verified_by/verified_at (docs/CLINICAL_TRUST_MODEL_SPEC.md §2).
  reviewed_by             uuid references public.profiles (id) on delete set null,
  reviewed_at             timestamptz,
  clinical_note           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint vaccination_adverse_events_symptoms_not_empty check (array_length(symptoms, 1) > 0),
  constraint vaccination_adverse_events_description_length
    check (description is null or char_length(description) between 1 and 1000),
  constraint vaccination_adverse_events_clinical_note_length
    check (clinical_note is null or char_length(clinical_note) between 1 and 1000)
);

create index vaccination_adverse_events_patient_idx
  on public.vaccination_adverse_events (patient_id, reported_at desc);
create index vaccination_adverse_events_org_idx
  on public.vaccination_adverse_events (organisation_id);
create index vaccination_adverse_events_record_idx
  on public.vaccination_adverse_events (vaccination_record_id);

create trigger vaccination_adverse_events_set_updated_at
  before update on public.vaccination_adverse_events
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Structural guardrails
-- ---------------------------------------------------------------------------

-- reported_by is stamped server-side, and the vaccination_record_id a
-- reporter names must actually belong to the patient_id they're reporting
-- as — RLS scopes patient_id but doesn't cross-check the FK, so this closes
-- that gap defensively (e.g. a caregiver session naming a dose that belongs
-- to a different managed profile).
create or replace function private.enforce_vaccination_adverse_event_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.reported_by := (select auth.uid());

  if not exists (
    select 1 from public.vaccination_records vr
    where vr.id = new.vaccination_record_id and vr.profile_id = new.patient_id
  ) then
    raise exception 'vaccination_record_id does not belong to patient_id' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger vaccination_adverse_events_enforce_report
  before insert on public.vaccination_adverse_events
  for each row execute function private.enforce_vaccination_adverse_event_report();

-- Clinical review attribution: only a clinical-tier care-team member may set
-- reviewed_by/at/clinical_note (mirrors enforce_vaccination_verification's
-- is_clinical_tier gate — a Care Coordinator can prepare/triage but a doctor
-- documents the review, since the UI will render this via the same
-- "Reviewed by Dr. X" null-gated pattern used everywhere else).
create or replace function private.enforce_vaccination_adverse_event_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- OLD is unassigned on INSERT — a patient's own report must not be able to
  -- arrive pre-reviewed, which a column-diff against OLD alone would miss.
  if tg_op = 'INSERT' then
    if new.reviewed_by is not null or new.reviewed_at is not null or new.clinical_note is not null then
      raise exception 'A new adverse event report cannot be submitted pre-reviewed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.clinical_note is distinct from old.clinical_note then
    if new.reviewed_by is not null and not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can document review of an adverse event report'
        using errcode = '42501';
    end if;
    if new.reviewed_by is not null then
      new.reviewed_by := (select auth.uid());
      if new.reviewed_at is null then
        new.reviewed_at := now();
      end if;
    else
      new.reviewed_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger vaccination_adverse_events_enforce_review
  before insert or update on public.vaccination_adverse_events
  for each row execute function private.enforce_vaccination_adverse_event_review();

-- ---------------------------------------------------------------------------
-- Significant-event routing into the existing alert inbox
-- ---------------------------------------------------------------------------
create or replace function private.raise_vaccination_adverse_event_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_vaccine_name text;
  v_significant boolean;
begin
  v_significant := new.severity = 'severe' or 'allergic_reaction' = any(new.symptoms);
  if not v_significant then
    return new;
  end if;

  select c.name into v_vaccine_name
  from public.vaccination_records vr
  join public.vaccination_catalog c on c.id = vr.vaccination_catalog_id
  where vr.id = new.vaccination_record_id;

  v_alert_id := private.raise_clinician_alert(
    new.organisation_id, new.patient_id,
    case
      when new.severity = 'severe' and 'allergic_reaction' = any(new.symptoms) then 'emergency'
      else 'urgent_escalation'
    end,
    'Vaccination adverse event reported',
    format('%s reaction reported after %s: %s.%s',
      initcap(new.severity::text), coalesce(v_vaccine_name, 'a vaccination'),
      array_to_string(new.symptoms::text[], ', '),
      case when new.description is not null then ' Patient note: ' || new.description else '' end),
    'clinical', 'symptom_escalation'
  );

  update public.vaccination_adverse_events set alert_id = v_alert_id where id = new.id;

  return new;
end;
$$;

create trigger vaccination_adverse_events_raise_alert
  after insert on public.vaccination_adverse_events
  for each row execute function private.raise_vaccination_adverse_event_alert();

-- ---------------------------------------------------------------------------
-- RLS — same authority shape as vaccination_records: patient (self) or a
-- 'manage'-level caregiver may report; any grantee (view or manage) plus org
-- staff may read; only staff may update (the review fields; a patient's
-- report itself is never editable after submission) or delete.
-- ---------------------------------------------------------------------------
alter table public.vaccination_adverse_events enable row level security;

create policy vaccination_adverse_events_select on public.vaccination_adverse_events
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_adverse_events.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy vaccination_adverse_events_insert on public.vaccination_adverse_events
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_adverse_events.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy vaccination_adverse_events_update on public.vaccination_adverse_events
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy vaccination_adverse_events_delete on public.vaccination_adverse_events
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.vaccination_adverse_events to authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vaccination_adverse_event_severity') then
    raise exception 'vaccination_adverse_event_severity enum was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'vaccination_adverse_event_symptom') then
    raise exception 'vaccination_adverse_event_symptom enum was not created';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'vaccination_adverse_events') then
    raise exception 'vaccination_adverse_events table was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vaccination_adverse_events_raise_alert'
      and tgrelid = 'public.vaccination_adverse_events'::regclass and not tgisinternal
  ) then
    raise exception 'vaccination_adverse_events_raise_alert trigger was not created';
  end if;
  if has_table_privilege('anon', 'public.vaccination_adverse_events', 'SELECT') then
    raise exception 'FAIL: anon can read vaccination_adverse_events';
  end if;
  raise notice 'PASS: vaccination_adverse_events table + significant-event alert routing installed';
end $$;
