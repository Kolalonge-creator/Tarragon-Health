-- Nigerian Nutrition Intelligence — professional nutrition pathway (spec
-- 19.11): nutrition risk -> dietitian referral -> consultation -> plan.
--
-- A self-contained, status-tracked referral artifact — same shape as
-- bariatric_referrals (metabolic-surgery referral). Deliberately does NOT
-- wire the deferred specialist-matching engine; it can optionally link a
-- specialist_referrals row (specialist_type = 'dietetics') once a human
-- turns it into a real bookable referral.
--
-- Unlike bariatric_referrals (clinician-authored from a formal assessment),
-- a patient can self-request nutrition support directly — this pathway
-- starts from "a patient (or the app's own coaching heuristics) notices a
-- pattern," not only from a clinician-run assessment, so `requested_by` is
-- nullable and there is no server-stamping trigger forcing a clinical_staff
-- row to exist.

do $$ begin
  create type public.nutrition_referral_status as enum
    ('requested', 'scheduled', 'consultation_complete', 'plan_issued', 'declined', 'not_applicable');
exception when duplicate_object then null; end $$;

create table if not exists public.nutrition_referrals (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  -- Null when the patient self-requested; set when a clinician/coordinator
  -- initiated it on the patient's behalf.
  requested_by            uuid references public.clinical_staff (id) on delete set null,
  reason                  text not null,
  -- Which coaching heuristic(s) suggested this, for context, e.g.
  -- ["ckd_condition", "sustained_high_sodium_pattern"] — see
  -- lib/nutrition/referral-risk.ts. Informational only, never a diagnosis.
  risk_factors            jsonb not null default '[]'::jsonb,
  status                  public.nutrition_referral_status not null default 'requested',
  specialist_referral_id  uuid references public.specialist_referrals (id) on delete set null,
  notes                   text,
  requested_at            timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists nutrition_referrals_patient_idx
  on public.nutrition_referrals (patient_id, requested_at desc);
create index if not exists nutrition_referrals_org_status_idx
  on public.nutrition_referrals (organisation_id, status);

drop trigger if exists nutrition_referrals_set_updated_at on public.nutrition_referrals;
create trigger nutrition_referrals_set_updated_at
  before update on public.nutrition_referrals
  for each row execute function private.set_updated_at();

alter table public.nutrition_referrals enable row level security;

drop policy if exists nutrition_referrals_select on public.nutrition_referrals;
create policy nutrition_referrals_select on public.nutrition_referrals
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists nutrition_referrals_insert on public.nutrition_referrals;
create policy nutrition_referrals_insert on public.nutrition_referrals
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists nutrition_referrals_update on public.nutrition_referrals;
create policy nutrition_referrals_update on public.nutrition_referrals
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.nutrition_referrals to authenticated;
