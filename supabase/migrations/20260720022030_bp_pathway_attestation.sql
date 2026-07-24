-- Tarragon Health — Hypertension pathway H17: doctor competency + annual
-- red-flag attestation (TH-CP-HTN-001 §14.7, §23).
--
-- A doctor must recognise and act on the §14 red flags, attested on joining and
-- annually. clinical_staff_attestations (introduced by the clinical-staff
-- attestation work already applied to the shared remote) is the home for this,
-- versioned by a text attestation_version string. This migration is written to
-- be SELF-CONTAINED on a fresh main-dev checkout (create-if-not-exists matching
-- the deployed shape) while being a no-op against the shared remote where the
-- table already exists — and it deliberately does NOT touch that table's
-- existing RLS policies. It adds the pathway-attestation gate helper and pins
-- the HTN red-flag attestation version.

create table if not exists public.clinical_staff_attestations (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  clinical_staff_id   uuid not null references public.clinical_staff (id) on delete cascade,
  attestation_version text not null,
  attested_at         timestamptz not null default now(),
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);

alter table public.clinical_staff_attestations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinical_staff_attestations'
  ) then
    create policy clinical_staff_attestations_read on public.clinical_staff_attestations
      for select to authenticated using (private.is_org_staff(organisation_id));
    create policy clinical_staff_attestations_write on public.clinical_staff_attestations
      for all to authenticated
      using (private.is_org_staff(organisation_id))
      with check (private.is_org_staff(organisation_id));
    grant select, insert, update, delete on public.clinical_staff_attestations to authenticated;
  end if;
end $$;

create or replace function private.has_current_pathway_attestation(p_staff uuid, p_version text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff_attestations a
    where a.clinical_staff_id = p_staff
      and a.attestation_version = p_version
      and (a.expires_at is null or a.expires_at > now())
  );
$$;

comment on function private.has_current_pathway_attestation(uuid, text) is
  'True if the clinical_staff member holds a current attestation of the given version. HTN red-flag attestation version = ''htn-red-flags-v1'' (TH-CP-HTN-001 §14.7/§23).';
