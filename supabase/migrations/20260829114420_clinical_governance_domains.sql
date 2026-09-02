-- Tarragon Health — Clinical Governance & Patient Safety spec §31.3.
--
-- "Tarragon should establish a formal clinical governance function
-- responsible for: clinical standards, patient safety, protocol approval,
-- clinical content, escalation policies, incident review, quality
-- improvement, AI clinical governance, medication safety, referral
-- pathways." No software gap this migration can close on its own — a
-- governance BOARD is an organisational function, not a database table, and
-- this migration does not pretend otherwise. What was missing, and is a
-- real, closeable gap, is the specific thing §31.18's acceptance criteria
-- keeps asking for across the whole spec: "who is accountable" for a given
-- governance area, answerable by a query rather than only by asking around.
-- This is that roster — one row per domain, naming who currently owns it.
--
-- Confirmed as a genuine gap before writing this: no table anywhere in the
-- schema maps a governance domain to an accountable person.
-- clinical_staff.is_clinical_director is the closest existing proxy, but it
-- is a single all-domains authority flag, not a per-domain assignment —
-- one Director does not necessarily personally own AI governance AND
-- medication safety AND referral pathways at a larger org, and nothing
-- records who actually does.
--
-- Deliberately NOT a workflow/approval table (that would be §31.6, which
-- this codebase's governance-config tables — escalation_slas, alert_rules,
-- cv_risk_config, vaccination_schedule — already ship a considered,
-- established alternative to: active-but-unsigned, signed later, never
-- blocked pending signature; see those migrations' own comments). This is
-- just a roster: nine domains, one row each, an accountable clinical_staff
-- member per row (nullable — an unassigned domain is a real, visible gap
-- rather than a guess, matching the platform's existing "never infer or
-- default a doctor_tier" discipline for exactly this kind of accountability
-- field).

create type public.clinical_governance_domain as enum (
  'clinical_standards', 'patient_safety', 'protocol_approval', 'clinical_content',
  'escalation_policies', 'incident_review', 'quality_improvement',
  'ai_clinical_governance', 'medication_safety', 'referral_pathways'
);

create table public.clinical_governance_domain_owners (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  domain            public.clinical_governance_domain not null,
  accountable_staff uuid references public.clinical_staff (id) on delete set null,
  notes             text,
  assigned_by       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint clinical_governance_domain_owners_one_row_per_domain unique (organisation_id, domain)
);

comment on table public.clinical_governance_domain_owners is
  'Spec §31.3/§31.18: which clinical_staff member is currently accountable for each governance domain. One row per domain per org, upserted (never duplicated) as ownership changes — this is current status, not a history log; clinical_staff itself already carries whatever audit trail exists for staff changes. accountable_staff is nullable on purpose: an unassigned domain should be visible as a gap, never silently defaulted to someone.';
comment on column public.clinical_governance_domain_owners.accountable_staff is
  'Nullable — never inferred or defaulted, same discipline as clinical_staff.doctor_tier. A null row means this domain genuinely has no assigned owner yet.';

create index clinical_governance_domain_owners_org_idx
  on public.clinical_governance_domain_owners (organisation_id);

alter table public.clinical_governance_domain_owners enable row level security;

-- Same posture as clinical_staff itself: any org staff may read and write
-- (matching "who manages the clinical_staff roster" precedent); the app
-- layer gates the actual admin UI to admins. No clinical judgement is made
-- by writing this table, so it does not need the stricter Clinical-
-- Director-only gate protocol_versions/alert_rules use for signing.
create policy clinical_governance_domain_owners_select on public.clinical_governance_domain_owners
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy clinical_governance_domain_owners_insert on public.clinical_governance_domain_owners
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy clinical_governance_domain_owners_update on public.clinical_governance_domain_owners
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No DELETE policy: an org either reassigns a domain (UPDATE) or leaves it
-- unassigned (accountable_staff = null) — a domain that stops being tracked
-- at all is a governance regression, not a row to discard.

grant select, insert, update on public.clinical_governance_domain_owners to authenticated;
revoke delete on public.clinical_governance_domain_owners from authenticated;

create or replace function private.enforce_clinical_governance_domain_owner_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.assigned_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

comment on function private.enforce_clinical_governance_domain_owner_attribution() is
  'assigned_by is always the caller who made the current assignment, never client-supplied — same discipline as every other attribution column on this platform.';

create trigger clinical_governance_domain_owners_set_attribution
  before insert or update on public.clinical_governance_domain_owners
  for each row execute function private.enforce_clinical_governance_domain_owner_attribution();

revoke all on function private.enforce_clinical_governance_domain_owner_attribution() from public;

do $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'clinical_governance_domain_owners'
  ) then
    raise exception 'clinical_governance_domain_owners missing after migration';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinical_governance_domain_owners' and cmd = 'DELETE'
  ) then
    raise exception 'clinical_governance_domain_owners must have no DELETE policy';
  end if;

  if not has_table_privilege('authenticated', 'public.clinical_governance_domain_owners', 'INSERT') then
    raise exception 'authenticated lacks INSERT on clinical_governance_domain_owners';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_governance_domain_owners', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on clinical_governance_domain_owners';
  end if;

  raise notice 'PASS: clinical_governance_domain_owners table + RLS + attribution trigger present, no DELETE anywhere';
end $$;
