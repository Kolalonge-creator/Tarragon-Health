-- Tarragon Health — Patient onboarding, KYC (optional)
-- Identity verification (NIN / BVN / document), built vendor-agnostic and
-- gracefully-degrading (same posture as the wearable OAuth scaffolding): no
-- real KYC provider is wired yet, so a request is recorded as `pending` and
-- can be actioned either by a future provider webhook or by ops manual review.
--
-- Identity verification is NEVER a blocker for onboarding or any core action —
-- it's an additive trust signal (profiles.identity_verified_at). NDPR data
-- minimisation: we store only the last 4 digits of the ID number, never the
-- full NIN/BVN (the full value is passed to the provider transiently, never
-- persisted).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'identity_method') then
    create type public.identity_method as enum ('nin', 'bvn', 'document');
  end if;
  if not exists (select 1 from pg_type where typname = 'identity_verification_status') then
    create type public.identity_verification_status as enum ('pending', 'verified', 'failed');
  end if;
end;
$$;

alter table public.profiles
  add column if not exists identity_verified_at timestamptz;

create table if not exists public.identity_verifications (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  method           public.identity_method not null,
  status           public.identity_verification_status not null default 'pending',
  provider         text,
  reference        text,
  -- Only the last 4 digits are stored; the full NIN/BVN is never persisted.
  id_last4         text,
  metadata         jsonb not null default '{}'::jsonb,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint identity_verifications_id_last4_len check (id_last4 is null or char_length(id_last4) <= 4)
);

create index if not exists identity_verifications_patient_idx on public.identity_verifications (patient_id);
create index if not exists identity_verifications_org_idx on public.identity_verifications (organisation_id);

create trigger identity_verifications_set_updated_at
  before update on public.identity_verifications
  for each row execute function private.set_updated_at();

alter table public.identity_verifications enable row level security;

-- Patient reads own + org staff read.
drop policy if exists identity_verifications_select on public.identity_verifications;
create policy identity_verifications_select on public.identity_verifications
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Patient may lodge their own request, but only as 'pending' — they can never
-- self-assert a 'verified' status (that comes from the provider result /
-- ops review, written via the service-role client or by staff).
drop policy if exists identity_verifications_insert on public.identity_verifications;
create policy identity_verifications_insert on public.identity_verifications
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and status = 'pending');

-- Only org staff may update (ops manual verification); the provider result
-- path uses the service-role client which bypasses RLS.
drop policy if exists identity_verifications_staff_update on public.identity_verifications;
create policy identity_verifications_staff_update on public.identity_verifications
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.identity_verifications to authenticated;
