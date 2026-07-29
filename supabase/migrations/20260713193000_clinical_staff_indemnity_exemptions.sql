-- Tarragon Health
-- Indemnity-requirement exemptions — lets ops explicitly waive the
-- clinical_staff_active_requires_indemnity gate at three granularities:
-- one named clinical_staff record, one role org-wide (e.g. all Escalation
-- Doctors), or the whole organisation. This is a deliberate, admin-only,
-- audited bypass of a compliance gate (docs/CLINICAL_TRUST_MODEL_SPEC.md
-- §5 — "this is what actually protects them") — every exemption records
-- who granted it and, for org/role exemptions, why.
--
-- The previous CHECK constraint (clinical_staff_active_requires_indemnity,
-- 20260713183000) can only see the row being written — it has no way to
-- look up an org- or role-level exemption in another table, so it's
-- replaced here with a trigger that implements the same core rule plus the
-- exemption lookups. errcode 23514 (check_violation) is raised explicitly
-- so callers checking for that error class see no behavior change.

alter table public.clinical_staff drop constraint clinical_staff_active_requires_indemnity;

-- Per-record exemption. indemnity_exempt_by is required whenever
-- indemnity_exempt is set (an exemption always has a named admin who
-- granted it) and can never equal the record's own profile_id — same
-- anti-self-serve pattern as clinical_staff_no_self_verification.
alter table public.clinical_staff
  add column indemnity_exempt boolean not null default false,
  add column indemnity_exempt_by uuid references public.profiles (id) on delete set null;

alter table public.clinical_staff
  add constraint clinical_staff_indemnity_exempt_requires_grantor
  check (not indemnity_exempt or indemnity_exempt_by is not null);

alter table public.clinical_staff
  add constraint clinical_staff_no_self_indemnity_exemption
  check (indemnity_exempt_by is null or profile_id is null or indemnity_exempt_by <> profile_id);

-- Org-wide (role is null) or whole-role exemptions. One active row per
-- scope per org, enforced by the two partial unique indexes below.
create table public.clinical_staff_indemnity_exemptions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  role            public.clinical_staff_role,
  reason          text,
  exempted_by     uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now()
);

create unique index clinical_staff_indemnity_exemptions_org_wide_idx
  on public.clinical_staff_indemnity_exemptions (organisation_id) where role is null;
create unique index clinical_staff_indemnity_exemptions_role_idx
  on public.clinical_staff_indemnity_exemptions (organisation_id, role) where role is not null;

alter table public.clinical_staff_indemnity_exemptions enable row level security;

-- Any org staff can see the org's current exemptions (transparency into
-- why a director/doctor is active without cover on file); only admins can
-- grant or revoke one — admin is a platform-wide role in this system
-- (private.is_admin() has no org parameter, matching how it's already used
-- elsewhere), so no additional org check is needed on top of it.
create policy clinical_staff_indemnity_exemptions_select on public.clinical_staff_indemnity_exemptions
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy clinical_staff_indemnity_exemptions_insert on public.clinical_staff_indemnity_exemptions
  for insert to authenticated
  with check (private.is_admin());

create policy clinical_staff_indemnity_exemptions_delete on public.clinical_staff_indemnity_exemptions
  for delete to authenticated
  using (private.is_admin());

-- No update policy: revoke by deleting and re-granting if terms change,
-- so there's never an ambiguous "who last edited this exemption and why."

grant select, insert, delete on public.clinical_staff_indemnity_exemptions to authenticated;

create or replace function private.enforce_clinical_staff_indemnity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.active or new.role not in ('clinical_director', 'escalation_doctor') then
    return new;
  end if;

  if new.indemnity_exempt then
    return new;
  end if;

  if exists (
    select 1 from public.clinical_staff_indemnity_exemptions e
    where e.organisation_id = new.organisation_id
      and (e.role is null or e.role = new.role)
  ) then
    return new;
  end if;

  if new.indemnity_expires_at is null or new.indemnity_expires_at <= now() then
    raise exception 'clinical_staff: % requires current indemnity cover, an individual exemption, or an org/role exemption before activation', new.full_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger clinical_staff_enforce_indemnity
  before insert or update on public.clinical_staff
  for each row execute function private.enforce_clinical_staff_indemnity();
