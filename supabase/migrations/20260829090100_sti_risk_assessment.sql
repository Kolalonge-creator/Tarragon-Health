-- Sexual & Reproductive Health platform, 2/8: STI risk assessment (spec §47.3
-- "Risk assessment -> Testing recommendation/pathway").
--
-- This closes an already-shipped product promise, not new scope: the
-- Comprehensive Screen bundle (20260802212103) has advertised "an STI risk
-- assessment" since 2026-08-02, but no such table, RPC or UI has ever
-- existed anywhere in the repo (confirmed by a full-text search before
-- writing this) — the promise was never built.
--
-- Shape mirrors mental_health_screens exactly, for the same reasons: a short
-- structured self-report, scored deterministically server-side (never
-- trusted from the client), never itself a diagnosis, and read by the
-- patient + org staff only — no profile_access/sponsor visibility. That last
-- point is a deliberate, module-wide choice (see 20260829090700's header):
-- everything new in this module is confidential-by-default, even where an
-- existing sibling table (reproductive_health_profiles) is more open.
--
-- Scoring lives in apps/web/src/lib/rules/sti-risk-assessment.ts (pure,
-- unit-tested function) and is invoked from a trusted Next.js Server Action
-- that writes here via the service role — a client can never post a spoofed
-- risk_level, exactly the same tamper-resistance mental_health_screens has.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'sti_risk_level') then
    create type public.sti_risk_level as enum ('low', 'moderate', 'high');
  end if;
end $$;

create table if not exists public.sti_risk_checks (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  risk_level             public.sti_risk_level not null,
  symptom_flag           boolean not null default false,
  recommended_screen_codes text[] not null default '{}',
  responses              jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

create index if not exists sti_risk_checks_patient_idx
  on public.sti_risk_checks (patient_id, created_at desc);

comment on table public.sti_risk_checks is
  'Structured, deterministic sexual-health risk/symptom check (spec §47.3). Engagement/triage signal for the care team, never a diagnosis and never fed into unrelated risk/escalation scoring — same discipline as mental_health_screens. Written by the service role only; see submitStiRiskCheck server action.';

alter table public.sti_risk_checks enable row level security;

-- Read: the patient (their own) or org staff. No insert/update/delete grant —
-- rows are computed server-side and written via the service role, so a
-- client can never post a spoofed risk level. Append-only history.
drop policy if exists sti_risk_checks_select on public.sti_risk_checks;
create policy sti_risk_checks_select on public.sti_risk_checks
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.sti_risk_checks to authenticated;
revoke all on public.sti_risk_checks from anon;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sti_risk_checks') then
    raise exception 'FAIL: sti_risk_checks was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sti_risk_checks' and cmd = 'INSERT'
  ) then
    raise exception 'FAIL: sti_risk_checks must have no client-facing INSERT policy (service-role write only)';
  end if;
  raise notice 'PASS: sti_risk_checks installed, read-only to clients, service-role write only';
end $$;
