-- ============================================================================
-- Pathway red-flag attestation (TH-CP-OB-001 §26) — gap closure.
--
-- Every doctor attests, on joining and annually, that they will practise
-- non-stigmatising person-first care, and that they KNOW and will act on the
-- red flags — especially the eating-disorder / mental-health flags, where the
-- correct action is to PAUSE weight-loss treatment and refer. The signed
-- attestation is retained and audited.
--
-- Generic across pathways (keyed by protocol_slug) so diabetes / hypertension
-- can reuse it. `clinical_staff_id` is SERVER-DERIVED from the caller's own
-- clinical_staff row — a doctor can only attest for themselves.
-- ============================================================================

create table if not exists public.pathway_attestations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  protocol_slug     text not null,
  pathway_version   integer not null default 1,
  statement         text not null,
  attested_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (clinical_staff_id, protocol_slug, pathway_version)
);

create index if not exists pathway_attestations_org_idx
  on public.pathway_attestations (organisation_id, protocol_slug);
create index if not exists pathway_attestations_staff_idx
  on public.pathway_attestations (clinical_staff_id);

-- --- forge-proof self-attestation --------------------------------------------
-- The signer is resolved from the caller's own clinical_staff row; a caller
-- with no active clinical_staff row cannot attest. clinical_staff_id and
-- organisation_id are overwritten from the resolved staff record.
create or replace function private.stamp_pathway_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_org   uuid;
begin
  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
  limit 1;

  if v_staff is null then
    raise exception 'Only an active clinician can sign a pathway attestation'
      using errcode = 'check_violation';
  end if;

  new.clinical_staff_id := v_staff;
  new.organisation_id := v_org;
  return new;
end;
$$;

drop trigger if exists pathway_attestations_stamp on public.pathway_attestations;
create trigger pathway_attestations_stamp
  before insert on public.pathway_attestations
  for each row execute function private.stamp_pathway_attestation();

-- --- RLS ---------------------------------------------------------------------
alter table public.pathway_attestations enable row level security;

-- Org-staff (incl. admins for audit) read attestations in their org.
drop policy if exists pathway_attestations_select on public.pathway_attestations;
create policy pathway_attestations_select on public.pathway_attestations
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Insert gated to org-staff; the trigger further restricts to the caller's own
-- clinical_staff identity (no attesting on another's behalf).
drop policy if exists pathway_attestations_insert on public.pathway_attestations;
create policy pathway_attestations_insert on public.pathway_attestations
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- No update / delete grant — attestations are an immutable signed record.
grant select, insert on public.pathway_attestations to authenticated;
