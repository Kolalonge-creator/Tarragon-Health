-- ============================================================================
-- Metabolic / bariatric surgery referral (TH-CP-OB-001 §14) — gap closure.
--
-- Tarragon's role is to IDENTIFY candidates, refer, and support before/after —
-- not to perform or replace specialist care. This is a self-contained,
-- status-tracked referral artifact (a candidate progresses through work-up →
-- scheduled → completed over months). It deliberately does NOT wire the
-- deferred specialist-matching engine; it can optionally link a
-- specialist_referrals row if one is later created.
--
-- Eligibility (§14.1) is computed by the TS classifier
-- (apps/web/src/lib/obesity/classify.ts: bariatricReferralEligible) and the
-- criterion met is stored for audit. `referred_by` is server-stamped from the
-- caller's clinical_staff row (forge-proof).
-- ============================================================================

do $$ begin
  create type public.bariatric_referral_status as enum
    ('proposed','referred','workup','scheduled','completed','declined','not_eligible');
exception when duplicate_object then null; end $$;

create table if not exists public.bariatric_referrals (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  referred_by           uuid references public.clinical_staff (id) on delete set null,
  obesity_assessment_id uuid references public.obesity_assessments (id) on delete set null,
  bmi                   numeric(4,1),
  -- Which §14.1 criterion was met (audit trail): bmi_ge_40 /
  -- bmi_ge_35_with_complication / bmi_30_34_uncontrolled_t2dm.
  criteria              jsonb not null default '[]'::jsonb,
  eligible              boolean not null default false,
  status                public.bariatric_referral_status not null default 'proposed',
  specialist_referral_id uuid references public.specialist_referrals (id) on delete set null,
  notes                 text,
  referred_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists bariatric_referrals_patient_idx
  on public.bariatric_referrals (patient_id, referred_at desc);
create index if not exists bariatric_referrals_org_status_idx
  on public.bariatric_referrals (organisation_id, status);

drop trigger if exists bariatric_referrals_set_updated_at on public.bariatric_referrals;
create trigger bariatric_referrals_set_updated_at
  before update on public.bariatric_referrals
  for each row execute function private.set_updated_at();

-- Server-stamp the referring clinician (never trusted from the client).
create or replace function private.stamp_bariatric_referral_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff uuid;
begin
  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = new.organisation_id
    and cs.active
  limit 1;
  if tg_op = 'INSERT' then
    new.referred_by := v_staff;
  end if;
  return new;
end;
$$;

drop trigger if exists bariatric_referrals_stamp_staff on public.bariatric_referrals;
create trigger bariatric_referrals_stamp_staff
  before insert on public.bariatric_referrals
  for each row execute function private.stamp_bariatric_referral_staff();

-- --- RLS ---------------------------------------------------------------------
alter table public.bariatric_referrals enable row level security;

drop policy if exists bariatric_referrals_select on public.bariatric_referrals;
create policy bariatric_referrals_select on public.bariatric_referrals
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists bariatric_referrals_insert on public.bariatric_referrals;
create policy bariatric_referrals_insert on public.bariatric_referrals
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists bariatric_referrals_update on public.bariatric_referrals;
create policy bariatric_referrals_update on public.bariatric_referrals
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.bariatric_referrals to authenticated;
