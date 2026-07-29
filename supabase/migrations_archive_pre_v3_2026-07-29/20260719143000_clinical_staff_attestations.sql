-- Tarragon Health — Doctor red-flag attestation
--
-- Annual Health Check pathway TH-CP-AHC-001 §26: every doctor signs, on
-- joining and at least annually, that they will practise evidence-based
-- high-value screening, deliver sensitive results personally, act on every
-- red flag (§18), and never leave an abnormal result without a closed-loop
-- plan. Delivering a check is gated on a current attestation.
--
-- This is a SELF-ATTESTATION (the doctor signs it), distinct from the
-- admin-performed license VERIFICATION already on clinical_staff
-- (verified_by/license_verified_at). Append-only history so annual re-signing
-- is a new row, never an overwrite. The "gate on delivering a check" is
-- enforced app-side (like the Care Coordinator / protocol-signing gates),
-- reading private.has_current_attestation().

create table if not exists public.clinical_staff_attestations (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id   uuid not null references public.clinical_staff (id) on delete cascade,
  attestation_version text not null default 'AHC-2026-v1',
  attested_at         timestamptz not null default now(),
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now()
);

create index if not exists clinical_staff_attestations_staff_idx
  on public.clinical_staff_attestations (clinical_staff_id, expires_at desc);

-- Default a 1-year validity from attested_at when the caller doesn't set one,
-- so the app never has to compute the expiry itself.
create or replace function private.set_attestation_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.expires_at is null then
    new.expires_at := new.attested_at + interval '1 year';
  end if;
  return new;
end;
$$;

drop trigger if exists set_attestation_expiry on public.clinical_staff_attestations;
create trigger set_attestation_expiry
  before insert on public.clinical_staff_attestations
  for each row execute function private.set_attestation_expiry();

-- Is there a currently-valid attestation for this staff member?
create or replace function private.has_current_attestation(p_clinical_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinical_staff_attestations a
    where a.clinical_staff_id = p_clinical_staff_id
      and a.expires_at > now()
  );
$$;

alter table public.clinical_staff_attestations enable row level security;

-- Read: any org staff (admins see the badge; doctors see their own history).
create policy clinical_staff_attestations_select on public.clinical_staff_attestations
  for select using (private.is_org_staff(organisation_id));

-- Insert: a doctor may sign ONLY their own attestation, in their own org.
create policy clinical_staff_attestations_insert on public.clinical_staff_attestations
  for insert with check (
    organisation_id = private.current_org_id()
    and exists (
      select 1 from public.clinical_staff cs
      where cs.id = clinical_staff_id
        and cs.profile_id = auth.uid()
    )
  );

-- Append-only: no update/delete grant at all (mirrors protocol_versions).
