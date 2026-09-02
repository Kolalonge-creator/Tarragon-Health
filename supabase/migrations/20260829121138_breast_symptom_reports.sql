-- Tarragon Health — Women's Health platform, part 6: breast health symptom
-- reporting (§44.11).
--
-- Breast *screening* (imaging eligibility/reminders/booking/results/
-- follow-up) already runs end to end through the existing screening ladder
-- (screen_types 'breast_imaging', activated 20260811223330; screening_
-- schedules/screening_results/screening_upgrades). §44.11 separately asks
-- for symptom reporting distinguished from screening -- a patient noticing a
-- lump or discharge is not "due for a mammogram", it is a possible
-- investigation trigger right now. breast_symptom_reports is therefore its
-- own small table (deliberately not folded into screening_schedules, which
-- means "due for a routine screen", a different clinical situation), whose
-- insert raises a clinical clinician_review alert routing to assessment --
-- diagnostic referral, if the reviewing clinician decides one is warranted,
-- uses the existing specialist_referrals pipeline (specialist_type 'ob_gyn'
-- or 'oncologist' as appropriate; referral_reason is free text, no schema
-- change needed there).

create type public.breast_symptom_type as enum (
  'lump', 'pain', 'nipple_discharge', 'skin_change', 'nipple_change', 'swelling', 'other'
);

create table if not exists public.breast_symptom_reports (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  symptom_types      public.breast_symptom_type[] not null,
  laterality         text check (laterality in ('left', 'right', 'both', 'unsure')),
  duration_note      text,
  notes              text,
  clinician_alert_id uuid references public.clinician_alerts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint breast_symptom_reports_symptom_types_not_empty check (array_length(symptom_types, 1) > 0)
);

create index if not exists breast_symptom_reports_patient_idx
  on public.breast_symptom_reports (patient_id, created_at desc);
create index if not exists breast_symptom_reports_org_idx
  on public.breast_symptom_reports (organisation_id);

drop trigger if exists breast_symptom_reports_set_updated_at on public.breast_symptom_reports;
create trigger breast_symptom_reports_set_updated_at
  before update on public.breast_symptom_reports
  for each row execute function private.set_updated_at();

alter table public.breast_symptom_reports enable row level security;

drop policy if exists breast_symptom_reports_select on public.breast_symptom_reports;
create policy breast_symptom_reports_select on public.breast_symptom_reports
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = breast_symptom_reports.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

drop policy if exists breast_symptom_reports_insert on public.breast_symptom_reports;
create policy breast_symptom_reports_insert on public.breast_symptom_reports
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = breast_symptom_reports.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

-- No patient update policy — like emergency_events, this is a triggered
-- clinical report; only org staff amend it (e.g. adding assessment notes).
drop policy if exists breast_symptom_reports_staff_update on public.breast_symptom_reports;
create policy breast_symptom_reports_staff_update on public.breast_symptom_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.breast_symptom_reports to authenticated;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: raise a clinical clinician_review alert and record it on the
-- row, mirroring handle_emergency_event's own clinician_alert_id assignment.
-- ---------------------------------------------------------------------------
create or replace function private.handle_breast_symptom_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  v_alert_id := private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'clinician_review',
    'Breast symptom reported',
    format('Reported: %s.%s%s',
      array_to_string(new.symptom_types, ', '),
      case when new.laterality is not null then ' Side: ' || new.laterality || '.' else '' end,
      case when new.duration_note is not null then ' Duration: ' || new.duration_note || '.' else '' end),
    'clinical', 'symptom_escalation'
  );
  new.clinician_alert_id := v_alert_id;
  return new;
end;
$$;

revoke all on function private.handle_breast_symptom_report() from public, anon;

drop trigger if exists breast_symptom_reports_raise_alert on public.breast_symptom_reports;
create trigger breast_symptom_reports_raise_alert
  before insert on public.breast_symptom_reports
  for each row execute function private.handle_breast_symptom_report();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'breast_symptom_reports') then
    raise exception 'breast_symptom_reports table was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'breast_symptom_reports_raise_alert' and tgrelid = 'public.breast_symptom_reports'::regclass and not tgisinternal) then
    raise exception 'breast_symptom_reports_raise_alert trigger was not created';
  end if;
  if has_table_privilege('anon', 'public.breast_symptom_reports', 'SELECT') then
    raise exception 'anon must not have access to breast_symptom_reports';
  end if;
  raise notice 'PASS: breast_symptom_reports installed';
end $$;
