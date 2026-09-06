-- Sexual & Reproductive Health platform, 6/8: fertility (spec §47.9 —
-- education, preconception advice, fertility assessment, relevant tests,
-- specialist referral).
--
-- A short structured self-report (mirrors sti_risk_checks/mental_health_
-- screens), scored deterministically server-side, that recommends one of:
-- education only, preconception-advice content, a baseline lab panel (reuses
-- the existing lab-ordering system — no new test catalogue needed, the
-- relevant panels like hba1c/tft/fbc already exist), or a specialist
-- referral. A referral is a plain public.specialist_referrals row (existing
-- primitive, reused as-is) — this is a recommendation record, never a
-- matching/ranking engine, consistent with this platform's standing
-- guardrail against building the full specialist-matching pipeline.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'fertility_recommended_action') then
    create type public.fertility_recommended_action as enum (
      'education_only', 'preconception_advice', 'baseline_labs', 'specialist_referral'
    );
  end if;
end $$;

create table if not exists public.fertility_assessments (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  trying_duration_months integer,
  responses             jsonb not null default '{}'::jsonb,
  recommended_action    public.fertility_recommended_action not null,
  specialist_referral_id uuid references public.specialist_referrals (id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists fertility_assessments_patient_idx
  on public.fertility_assessments (patient_id, created_at desc);

comment on table public.fertility_assessments is
  'Structured, deterministic fertility self-assessment (spec §47.9). Never a diagnosis. recommended_action is computed server-side (apps/web/src/lib/rules/fertility-assessment.ts) from duration-trying + risk-factor responses (standard 12-months-under-35 / 6-months-35-plus referral threshold), never client-supplied.';

alter table public.fertility_assessments enable row level security;

drop policy if exists fertility_assessments_select on public.fertility_assessments;
create policy fertility_assessments_select on public.fertility_assessments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.fertility_assessments to authenticated;
revoke all on public.fertility_assessments from anon;

-- No client insert policy — written via the service role from a trusted
-- Server Action (same tamper-resistance as sti_risk_checks/mental_health_
-- screens): the recommended_action must never be something a client can
-- forge, since a 'specialist_referral' outcome opens a real referral row.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'fertility_assessments') then
    raise exception 'FAIL: fertility_assessments was not created';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fertility_assessments' and cmd = 'INSERT'
  ) then
    raise exception 'FAIL: fertility_assessments must have no client-facing INSERT policy (service-role write only)';
  end if;
  raise notice 'PASS: fertility_assessments installed';
end $$;
