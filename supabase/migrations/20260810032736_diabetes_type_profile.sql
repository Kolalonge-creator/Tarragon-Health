-- ===========================================================================
-- Diabetes Clinical Pathway — patient diabetes type (Type 1 / Type 2 / other)
-- ---------------------------------------------------------------------------
-- Nothing on the platform today records WHICH diabetes a patient has. That
-- matters clinically: the metformin-first ladder assumes type 2, "never stop
-- insulin" is unconditional in type 1, and the G25 suspected-type-1 heuristic
-- (glucose-red-flags.ts::suspectsType1) is a young/lean-patient GUESS that
-- should stand down once a clinician has actually confirmed the type.
--
-- Split into two columns, not one, so the honest-null pattern used elsewhere
-- (reviewed_by/reviewed_at, doctor_tier) holds here too:
--   * patient_reported_type — the patient's own account of their diagnosis.
--     Real information (a type-1 patient has known this since diagnosis,
--     usually in childhood), available immediately, but self-report.
--   * confirmed_type / confirmed_by / confirmed_at — a clinician's own
--     confirmation. Never inferred, never defaulted; unset means "needs a
--     clinician to confirm", same principle as doctor_tier.
-- Effective type for clinical logic is coalesce(confirmed_type,
-- patient_reported_type) — confirmed wins when present.
--
-- Patients can only ever write patient_reported_type (via the
-- set_patient_reported_diabetes_type RPC below, security definer, so the
-- base table needs no patient-facing INSERT/UPDATE policy at all — same
-- shape as my_care_plan_clinicians()). Clinicians write confirmed_type
-- through a normal is_org_staff-gated policy, same as every other
-- clinician-authored diabetes table in this pathway.
-- ===========================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'diabetes_type') then
    create type public.diabetes_type as enum ('type_1', 'type_2', 'gestational', 'other');
  end if;
end $$;

create table if not exists public.patient_diabetes_profile (
  patient_id           uuid primary key references public.profiles (id) on delete cascade,
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_reported_type public.diabetes_type,
  confirmed_type       public.diabetes_type,
  confirmed_by         uuid references public.clinical_staff (id) on delete set null,
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists patient_diabetes_profile_org_idx
  on public.patient_diabetes_profile (organisation_id);

drop trigger if exists patient_diabetes_profile_set_updated_at on public.patient_diabetes_profile;
create trigger patient_diabetes_profile_set_updated_at
  before update on public.patient_diabetes_profile
  for each row execute function private.set_updated_at();

alter table public.patient_diabetes_profile enable row level security;

-- Read: patient sees their own row; org clinical staff see all in their org.
drop policy if exists patient_diabetes_profile_select on public.patient_diabetes_profile;
create policy patient_diabetes_profile_select on public.patient_diabetes_profile
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Write: staff only at the table level (confirmed_type is a clinical act).
-- The patient's own write path is the RPC below, not this policy.
drop policy if exists patient_diabetes_profile_insert on public.patient_diabetes_profile;
create policy patient_diabetes_profile_insert on public.patient_diabetes_profile
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
drop policy if exists patient_diabetes_profile_update on public.patient_diabetes_profile;
create policy patient_diabetes_profile_update on public.patient_diabetes_profile
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_diabetes_profile to authenticated;

-- ---------------------------------------------------------------------------
-- Patient self-report RPC. security definer so it can upsert a row the
-- patient has no direct table-level write access to, but it only ever
-- touches patient_reported_type for auth.uid()'s own row — confirmed_type/
-- confirmed_by/confirmed_at are never reachable from this function, so a
-- patient can self-report but never impersonate a clinical confirmation.
-- ---------------------------------------------------------------------------
create or replace function public.set_patient_reported_diabetes_type(p_type public.diabetes_type)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  if v_org is null then
    raise exception 'No organisation on file for this account';
  end if;

  insert into public.patient_diabetes_profile (patient_id, organisation_id, patient_reported_type)
  values ((select auth.uid()), v_org, p_type)
  on conflict (patient_id) do update
    set patient_reported_type = excluded.patient_reported_type;
end;
$$;

revoke all on function public.set_patient_reported_diabetes_type(public.diabetes_type) from public;
revoke all on function public.set_patient_reported_diabetes_type(public.diabetes_type) from anon;
grant execute on function public.set_patient_reported_diabetes_type(public.diabetes_type) to authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'diabetes_type') then
    raise exception 'diabetes_type enum was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_diabetes_profile'
  ) then
    raise exception 'patient_diabetes_profile table was not created';
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_patient_reported_diabetes_type'
  ) then
    raise exception 'set_patient_reported_diabetes_type was not created';
  end if;
end $$;
