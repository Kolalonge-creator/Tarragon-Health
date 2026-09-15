-- Sexual & Reproductive Health platform, 7/8: sexual dysfunction (spec
-- §47.10 — erectile dysfunction, painful intercourse, libido concerns,
-- ejaculation problems), connected to underlying cardiometabolic/psychological
-- health per the spec's own instruction.
--
-- Shape is byte-for-byte the same discipline as mental_health_screens: a
-- short validated instrument, scored server-side, read by patient + org
-- staff only, never itself a diagnosis. One table for all four concern types
-- (instrument distinguishes them) rather than four near-identical tables.
--
-- cardiometabolic_flag is the "connects to underlying health assessment"
-- requirement made concrete: a moderate/severe score sets it true, and the
-- app nudges the patient toward the EXISTING CV-risk questionnaire
-- (risk-assessment-form.tsx / risk_questionnaire_configs) rather than this
-- module inventing a second risk engine.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'sexual_health_severity_band') then
    create type public.sexual_health_severity_band as enum ('none_minimal', 'mild', 'moderate', 'severe');
  end if;
end $$;

create table if not exists public.sexual_health_screens (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  instrument            text not null check (instrument in ('iief5', 'fsfi_pain', 'libido_brief', 'pe_diagnostic_tool')),
  total_score           integer not null,
  severity_band         public.sexual_health_severity_band not null,
  cardiometabolic_flag  boolean not null default false,
  item_responses        jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists sexual_health_screens_patient_idx
  on public.sexual_health_screens (patient_id, created_at desc);

comment on table public.sexual_health_screens is
  'Validated sexual-dysfunction screens (spec §47.10): iief5 (erectile function), fsfi_pain (painful intercourse), libido_brief (low libido), pe_diagnostic_tool (premature ejaculation). Engagement/triage signal for the care team, never a diagnosis — same discipline as mental_health_screens. Written by the service role only.';

alter table public.sexual_health_screens enable row level security;

drop policy if exists sexual_health_screens_select on public.sexual_health_screens;
create policy sexual_health_screens_select on public.sexual_health_screens
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.sexual_health_screens to authenticated;
revoke all on public.sexual_health_screens from anon;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sexual_health_screens') then
    raise exception 'FAIL: sexual_health_screens was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sexual_health_screens' and cmd = 'INSERT'
  ) then
    raise exception 'FAIL: sexual_health_screens must have no client-facing INSERT policy (service-role write only)';
  end if;
  raise notice 'PASS: sexual_health_screens installed';
end $$;
