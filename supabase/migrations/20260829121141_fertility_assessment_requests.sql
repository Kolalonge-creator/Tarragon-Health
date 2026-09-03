-- Tarragon Health — Women's Health platform, part 8: fertility (§44.13).
--
-- §44.13 asks for "appropriate assessment pathways ... laboratory
-- coordination ... specialist referral", and explicitly warns against
-- presenting fertility prediction as certainty (matching the discipline
-- lib/rules/cycle-nudges.ts already established for cycle estimates).
--
-- Deliberately does NOT add a patient-self-service fertility lab-test
-- catalogue or a new matching/booking engine — CLAUDE.md is explicit that
-- "a full specialist-matching engine" and "patient-initiated wellness
-- testing catalogue" are Phase 2/3, not to be built without an explicit ask,
-- and a self-bookable fertility panel would be exactly that. Instead this is
-- a thin status tracker over machinery that already exists: the patient logs
-- an enquiry here; "laboratory coordination" and "specialist referral" both
-- happen through the existing clinician-mediated paths (clinician-originated
-- lab orders, and specialist_referrals with specialist_type 'ob_gyn' — the
-- closest existing bucket, referral_reason is free text already) once a
-- clinician has actually seen the patient, exactly like every other
-- clinician-originated order on the platform. appointment_id/
-- specialist_referral_id are set once those steps happen, so the patient can
-- see where their request stands without the platform inventing a new
-- booking/matching surface.

create table if not exists public.fertility_assessment_requests (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  trying_duration_months  smallint check (trying_duration_months >= 0),
  concern_notes           text,
  status                  text not null default 'requested'
                            check (status in ('requested', 'education_provided', 'consult_booked', 'referred', 'closed')),
  appointment_id          uuid references public.appointments (id) on delete set null,
  specialist_referral_id  uuid references public.specialist_referrals (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists fertility_assessment_requests_patient_idx
  on public.fertility_assessment_requests (patient_id, created_at desc);
create index if not exists fertility_assessment_requests_org_idx
  on public.fertility_assessment_requests (organisation_id);

drop trigger if exists fertility_assessment_requests_set_updated_at on public.fertility_assessment_requests;
create trigger fertility_assessment_requests_set_updated_at
  before update on public.fertility_assessment_requests
  for each row execute function private.set_updated_at();

alter table public.fertility_assessment_requests enable row level security;

-- Access-control correction (2026-09-02, pre-launch security review): removed
-- the caregiver EXISTS branch that originally sat here -- ANY profile_access
-- grantee could read a patient's fertility assessment request regardless of
-- category. This table was never applied live, so the fix is made directly
-- rather than shipped-then-patched. Matches PR #330's own fertility_
-- assessments table, which shipped with patient + org staff only from the
-- start -- this table is the same domain (fertility) and should not be less
-- protected than its sibling.
drop policy if exists fertility_assessment_requests_select on public.fertility_assessment_requests;
create policy fertility_assessment_requests_select on public.fertility_assessment_requests
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

-- Patient can only ever create the initial request at status 'requested' —
-- progressing it (education_provided/consult_booked/referred/closed, and
-- linking appointment_id/specialist_referral_id) is staff-only, so a patient
-- can never spoof "I've been referred".
drop policy if exists fertility_assessment_requests_insert on public.fertility_assessment_requests;
create policy fertility_assessment_requests_insert on public.fertility_assessment_requests
  for insert to authenticated
  with check (
    (
      patient_id = (select auth.uid())
      and organisation_id = private.current_org_id()
      and status = 'requested'
      and appointment_id is null
      and specialist_referral_id is null
    )
    or private.is_org_staff(organisation_id)
  );

drop policy if exists fertility_assessment_requests_update on public.fertility_assessment_requests;
create policy fertility_assessment_requests_update on public.fertility_assessment_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert on public.fertility_assessment_requests to authenticated;
grant update on public.fertility_assessment_requests to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fertility_assessment_requests') then
    raise exception 'fertility_assessment_requests table was not created';
  end if;
  if has_table_privilege('anon', 'public.fertility_assessment_requests', 'SELECT') then
    raise exception 'anon must not have access to fertility_assessment_requests';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fertility_assessment_requests'
      and policyname = 'fertility_assessment_requests_select' and coalesce(qual,'') ilike '%profile_access%'
  ) then
    raise exception 'fertility_assessment_requests_select must not reference profile_access -- patient + org staff only';
  end if;
  raise notice 'PASS: fertility_assessment_requests installed';
end $$;
