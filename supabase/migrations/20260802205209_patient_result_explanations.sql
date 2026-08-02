-- AI-drafted, patient-facing "help me understand this" explanations.
-- Same fail-open / never-decides discipline as case_briefs (20260730121004),
-- extended to the patient side per the founder's explicit ask (2026-07-31):
-- "AI as infinite patient-facing staff", never doctor-facing only.
--
-- Keyed by (patient_id, kind, subject_key, language) rather than a specific
-- row id -- an explanation always covers the patient's LATEST value for that
-- kind+key (risk score type / lab analyte code / vital type), matching how
-- RiskSignalsCard/LipidProfileCard already present "latest" data. This also
-- makes caching trivial: a past reading never changes, so once generated an
-- explanation is reused indefinitely for that exact (patient, kind, key,
-- language) tuple -- no repeat Anthropic spend for a patient re-reading the
-- same card.
--
-- No insert/update/delete policy at all, same as case_briefs -- every write
-- goes through the service-role generator (lib/patient-explainer/generate.ts).
-- A compromised patient/clinician session can neither write nor overwrite an
-- explanation.

create table if not exists public.patient_result_explanations (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id),
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  kind               text not null check (kind in ('risk_score', 'lab_analyte', 'vitals')),
  subject_key        text not null,
  language           text not null default 'en' check (language in ('en', 'pcm', 'yo', 'ha', 'ig')),
  status             text not null check (status in ('generated', 'failed')),
  model_id           text,
  explanation_text   text,
  input_snapshot     jsonb not null default '{}'::jsonb,
  error_message      text,
  generated_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (patient_id, kind, subject_key, language)
);

create index if not exists patient_result_explanations_org_idx
  on public.patient_result_explanations (organisation_id);

alter table public.patient_result_explanations enable row level security;

create policy patient_result_explanations_select on public.patient_result_explanations
  for select using (
    patient_id = auth.uid()
    or private.is_org_staff(organisation_id)
  );

-- Deliberately no insert/update/delete policy -- service-role only, same
-- shape as case_briefs.

-- Same M1-sprint-class gap this codebase has hit repeatedly: RLS restricts
-- rows, it does not grant table access at all. A table added via a plain
-- migration (not project creation) needs the base grant explicitly.
grant select on public.patient_result_explanations to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.patient_result_explanations', 'SELECT') then
    raise exception 'patient_result_explanations: authenticated grant did not take';
  end if;
end $$;
