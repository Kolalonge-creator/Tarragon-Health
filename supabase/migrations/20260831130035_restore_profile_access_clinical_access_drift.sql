-- Recovered 2026-09-03 (full-platform audit) from supabase_migrations.schema_migrations:
-- this migration was applied live as version 20260831130035 but existed in no commit on any
-- branch (the session that applied it never committed the file). Committed here verbatim so
-- the applied SQL has a home in git; the release-integrity migration-drift check flags this
-- class as UNTRACED. Do not re-apply.

-- Tarragon Health — restore profile_access.clinical_access (live drift).
--
-- Found while verifying an unrelated feature (20260831125116_since_last_
-- visit_summary.sql's test): inserting a care_messages row currently fails
-- live with "column pa.clinical_access does not exist" — from BOTH
-- private.enforce_care_message_author() (20260731181318_care_messages_
-- three_way.sql) and private.after_care_message_insert()
-- (20260731182348_care_message_notification_recipient_kind.sql), each of
-- which references public.profile_access.clinical_access unconditionally.
-- This means every care_messages insert is currently broken in production —
-- the in-app patient<->care-team channel CLAUDE.md calls out as the real,
-- working two-way channel (superseding WhatsApp) is down.
--
-- Root cause: 20260731181143_sponsor_clinical_access_consent.sql IS recorded
-- as applied in supabase_migrations.schema_migrations, and its own closing
-- self-test asserts the column/trigger/policies existed at apply time — so
-- something removed them afterward outside the migration system (same class
-- of drift CLAUDE.md's standing lessons warn about, possibly connected to
-- the 2026-07-29 rebuild that's separately known to have emptied other
-- live state — see project_catalogue_lost_in_rebuild memory). Not fully
-- root-caused here; flagging for the founder rather than guessing further.
--
-- Fix: re-apply that migration's body verbatim (it was already fully
-- idempotent — `add column if not exists`, `create or replace`, `drop ...
-- if exists` + create) as a new migration, so schema_migrations reflects
-- what's actually live going forward.
--
-- One adjustment to the original's own closing self-test: a LATER migration
-- (care graph unification, 20260807010837 era) added a second, overloaded
-- private.can_read_clinical(uuid, care_access_category) used correctly by
-- care_messages/care_message_threads' INSERT policies to let a
-- 'messaging'-category grantee send a message — a different, legitimate
-- access category, not a violation of this migration's "read only" invariant
-- for the original single-argument can_read_clinical(uuid). The original
-- test's `like '%can_read_clinical%'` predates that overload and can't tell
-- the two apart, so it now false-positives on real, correct code. Narrowed
-- to match only the single-argument call shape (no comma inside the parens).

alter table public.profile_access
  add column if not exists clinical_access boolean not null default false,
  add column if not exists clinical_access_updated_at timestamptz;

comment on column public.profile_access.clinical_access is
  'The record owner has approved this grantee seeing their health information. Read only: every write policy on every clinical table still requires the patient themselves or org staff. Set only by the owner, enforced by private.enforce_clinical_access_consent_owner.';

create or replace function private.enforce_clinical_access_consent_owner()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.clinical_access := false;
    new.clinical_access_updated_at := null;
    return new;
  end if;

  if new.clinical_access is distinct from old.clinical_access then
    if v_uid is null or v_uid is distinct from old.profile_id then
      raise exception
        'only the person whose record it is may change who can see their health information'
        using errcode = '42501';
    end if;
    new.clinical_access_updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists profile_access_clinical_consent on public.profile_access;
create trigger profile_access_clinical_consent
  before insert or update on public.profile_access
  for each row execute function private.enforce_clinical_access_consent_owner();

create or replace function private.can_read_clinical(p_patient uuid)
returns boolean
language sql
stable
set search_path to ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and pa.clinical_access
  );
$$;

drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists care_plans_select on public.care_plans;
create policy care_plans_select on public.care_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists screening_schedules_select on public.screening_schedules;
create policy screening_schedules_select on public.screening_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists patient_risk_scores_select on public.patient_risk_scores;
create policy patient_risk_scores_select on public.patient_risk_scores
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

do $$
declare
  v_read int;
  v_write int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profile_access' and column_name = 'clinical_access'
  ) then
    raise exception 'FAIL: profile_access.clinical_access still missing after restore';
  end if;

  select count(*) into v_read
  from pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and tablename in ('vitals_readings', 'care_plans', 'medications',
                      'screening_schedules', 'lab_orders', 'patient_risk_scores')
    and qual like '%can_read_clinical%';
  if v_read <> 6 then
    raise exception 'FAIL: expected 6 consent-gated read policies, found %', v_read;
  end if;

  -- Single-argument can_read_clinical(patient) only — the two-argument
  -- can_read_clinical(patient, category) overload legitimately gates
  -- care_messages/care_message_threads' INSERT policies for a
  -- 'messaging'-category grantee; see this migration's header note.
  select count(*) into v_write
  from pg_policies
  where schemaname = 'public'
    and cmd <> 'SELECT'
    and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'can_read_clinical\([^,()]*\)';
  if v_write > 0 then
    raise exception 'FAIL: single-argument can_read_clinical must never gate a write policy, found %', v_write;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'profile_access_clinical_consent' and not tgisinternal
  ) then
    raise exception 'FAIL: consent-owner trigger missing';
  end if;

  raise notice 'PASS: profile_access.clinical_access + consent trigger + 6 read policies restored';
end $$;

