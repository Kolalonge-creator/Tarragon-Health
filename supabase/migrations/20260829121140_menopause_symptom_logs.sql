-- Tarragon Health — Women's Health platform, part 7: menopause (§44.12).
--
-- reproductive_health_profiles already carries perimenopausal/menopausal as
-- life_stage values with a nudge ("care-team conversation"). This adds the
-- actual symptom log the spec asks for (hot flashes, mood, sleep, etc. with
-- severity) — patient-writable, informational, same discipline as the
-- menstrual cycle tracker's own clinical flags. "Lifestyle support" and
-- "clinical consultation" are
-- existing health_education content + the existing appointment engine (no
-- schema needed); "treatment monitoring" reuses the existing medications /
-- medication_logs tables (HRT is an ordinary prescribed medication) rather
-- than a parallel tracker.
--
-- One deterministic, well-established clinical rule IS worth a real alert
-- here: postmenopausal bleeding always warrants assessment (it is a standard
-- endometrial-cancer red flag, not merely "a symptom to note"), so any log
-- with postmenopausal_bleeding = true raises a clinical clinician_review
-- alert the same way breast_symptom_reports does.

create type public.menopause_symptom_type as enum (
  'hot_flashes', 'night_sweats', 'sleep_disturbance', 'mood_changes',
  'vaginal_dryness', 'joint_aches', 'brain_fog', 'other'
);

create table if not exists public.menopause_symptom_logs (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  symptom_types            public.menopause_symptom_type[] not null default '{}',
  severity                 smallint check (severity between 0 and 10),
  postmenopausal_bleeding  boolean not null default false,
  notes                    text,
  logged_at                date not null default current_date,
  clinician_alert_id       uuid references public.clinician_alerts (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint menopause_symptom_logs_has_content
    check (array_length(symptom_types, 1) > 0 or postmenopausal_bleeding)
);

create index if not exists menopause_symptom_logs_patient_idx
  on public.menopause_symptom_logs (patient_id, logged_at desc);
create index if not exists menopause_symptom_logs_org_idx
  on public.menopause_symptom_logs (organisation_id);

drop trigger if exists menopause_symptom_logs_set_updated_at on public.menopause_symptom_logs;
create trigger menopause_symptom_logs_set_updated_at
  before update on public.menopause_symptom_logs
  for each row execute function private.set_updated_at();

alter table public.menopause_symptom_logs enable row level security;

-- Access-control correction (2026-09-02, pre-launch security review): removed
-- the caregiver EXISTS branches (SELECT/INSERT/UPDATE) that originally sat
-- here -- ANY profile_access grantee could read, and any 'manage'-level
-- grantee could write, a patient's menopause symptom log regardless of
-- category. This table was never applied live, so the fix is made directly
-- rather than shipped-then-patched. Matches PR #330's precedent for this
-- kind of sensitive symptom log (see breast_symptom_reports' identical
-- correction, same reasoning): patient + org staff only, no caregiver
-- visibility -- postmenopausal bleeding already always raises a
-- clinician_review alert regardless, so the care team sees it either way.
drop policy if exists menopause_symptom_logs_select on public.menopause_symptom_logs;
create policy menopause_symptom_logs_select on public.menopause_symptom_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists menopause_symptom_logs_insert on public.menopause_symptom_logs;
create policy menopause_symptom_logs_insert on public.menopause_symptom_logs
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists menopause_symptom_logs_update on public.menopause_symptom_logs;
create policy menopause_symptom_logs_update on public.menopause_symptom_logs
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  )
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select, insert, update on public.menopause_symptom_logs to authenticated;

create or replace function private.handle_menopause_symptom_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.postmenopausal_bleeding then
    new.clinician_alert_id := private.raise_clinician_alert(
      new.organisation_id, new.patient_id, 'clinician_review',
      'Postmenopausal bleeding reported',
      format('Patient reported bleeding on %s. Postmenopausal bleeding always warrants clinical assessment.%s',
        new.logged_at,
        case when new.notes is not null then ' Note: ' || new.notes else '' end),
      'clinical', 'symptom_escalation'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.handle_menopause_symptom_log() from public, anon;

drop trigger if exists menopause_symptom_logs_raise_alert on public.menopause_symptom_logs;
create trigger menopause_symptom_logs_raise_alert
  before insert on public.menopause_symptom_logs
  for each row execute function private.handle_menopause_symptom_log();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'menopause_symptom_logs') then
    raise exception 'menopause_symptom_logs table was not created';
  end if;
  if has_table_privilege('anon', 'public.menopause_symptom_logs', 'SELECT') then
    raise exception 'anon must not have access to menopause_symptom_logs';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'menopause_symptom_logs'
      and policyname like '%_select' and coalesce(qual,'') ilike '%profile_access%'
  ) then
    raise exception 'menopause_symptom_logs_select must not reference profile_access -- patient + org staff only';
  end if;
  raise notice 'PASS: menopause_symptom_logs installed';
end $$;
