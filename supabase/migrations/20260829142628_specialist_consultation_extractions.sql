-- Tarragon Health — Specialist Care Coordination & Continuity Engine, part 2/7
-- specialist_consultation_extractions — AI-drafted structured read of a
-- specialist's report.
--
-- WHY: the module's whole point (see the spec's "critical strategic point")
-- is that a specialist's plan must turn into tracked, owned actions instead
-- of sitting as prose nobody follows. That starts with getting the plan out
-- of a photo/PDF and into structured fields: diagnosis, recommendations,
-- medications mentioned, investigations mentioned, follow-up interval.
--
-- AI DRAFTS, NEVER DECIDES. Identical discipline to lab_report_extractions
-- and ecg_report_extractions: a row here is a DRAFT shown to a clinician side
-- by side with the original document. Confirming it is a deliberate human
-- act (the next migration's RPC) that files treatment_plan_received_at on
-- the referral and creates specialist_referral_action_items — nothing in
-- this table is a clinical record on its own, and nothing here writes a
-- medication to any prescribing table (see the header note on the confirm
-- RPC for why that stays a human, in-app act).
--
-- DELIBERATELY NOT PATIENT-READABLE, same reasoning as lab_report_extractions
-- and ecg_report_extractions: an unconfirmed machine transcription of a
-- consultation about someone's own health must not reach them before a
-- clinician has looked at it.
--
-- No insert/update/delete policy at all — every write goes through the
-- service-role generator (lib/specialist-reports/extraction-actions.ts) or
-- the confirm RPC (next migration).

create table if not exists public.specialist_consultation_extractions (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  referral_id              uuid not null references public.specialist_referrals (id) on delete cascade,
  -- One live extraction per document. Re-running replaces it rather than
  -- accumulating drafts a reviewer would have to choose between.
  document_id              uuid not null unique
                             references public.specialist_consultation_documents (id) on delete cascade,
  status                   text not null
                             check (status in ('extracted', 'failed', 'confirmed', 'discarded')),
  model_id                 text,
  -- Date of consultation as printed on the report, normalised. Used for
  -- treatment_plan_received_at fallback if genuinely earlier than upload.
  report_date              date,
  specialist_name_on_report text,
  facility_name_on_report  text,
  -- Name printed on the report, kept ONLY to warn a reviewer when it does not
  -- look like the patient whose record this is being filed into. Never shown
  -- to the patient, never used as identity.
  patient_name_on_report   text,
  diagnosis                text,
  -- ExtractedRecommendation[]: {description, action_type, suggested_due_days, confidence}.
  -- action_type is one of the specialist_referral_action_item_type values —
  -- validated on confirm, not here, so a low-confidence/unmapped type is
  -- still visible to the reviewer rather than silently dropped.
  recommendations          jsonb not null default '[]'::jsonb,
  -- Informational only — medications mentioned in the report, as printed.
  -- NEVER auto-filed to any prescribing table; a clinician who wants to act
  -- on one starts a new prescription through the existing medication flow,
  -- same as reading any other free-text clinical document.
  medications_mentioned    jsonb not null default '[]'::jsonb,
  investigations_mentioned jsonb not null default '[]'::jsonb,
  follow_up_interval_days  integer,
  -- Set when the model could not read the document at all (too blurred,
  -- cropped, or not a consultation report).
  unreadable_reason        text,
  error_message            text,
  -- Which recommendations the reviewer actually accepted into action items —
  -- kept for audit: the difference between what the model proposed and what
  -- a human filed.
  confirmed_recommendation_indexes jsonb not null default '[]'::jsonb,
  confirmed_by             uuid references public.profiles (id) on delete restrict,
  confirmed_at             timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists specialist_consultation_extractions_patient_idx
  on public.specialist_consultation_extractions (patient_id, created_at desc);
create index if not exists specialist_consultation_extractions_org_idx
  on public.specialist_consultation_extractions (organisation_id);
create index if not exists specialist_consultation_extractions_referral_idx
  on public.specialist_consultation_extractions (referral_id);
create index if not exists specialist_consultation_extractions_pending_idx
  on public.specialist_consultation_extractions (organisation_id, status)
  where status = 'extracted';

alter table public.specialist_consultation_extractions enable row level security;

create policy specialist_consultation_extractions_select on public.specialist_consultation_extractions
  for select using (private.is_org_staff(organisation_id));

-- Deliberately no insert/update/delete policy — service-role/RPC only.

grant select on public.specialist_consultation_extractions to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.specialist_consultation_extractions', 'SELECT') then
    raise exception 'specialist_consultation_extractions: authenticated SELECT grant did not take';
  end if;

  -- The real write boundary is RLS POLICY presence, not the table-level
  -- GRANT — this project's default-privileges setup auto-provisions INSERT/
  -- UPDATE/DELETE to `authenticated` on every new table (confirmed live per
  -- ecg_report_extractions' own self-verification note), and RLS denies by
  -- default when no policy matches the command regardless of the table-level
  -- grant. So the assertion that matters is "no insert/update/delete POLICY
  -- exists", not "no insert/update/delete GRANT exists".
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'specialist_consultation_extractions'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'specialist_consultation_extractions: must have no insert/update/delete policy — service-role/RPC only';
  end if;

  -- A patient must NOT be able to read an unconfirmed transcription of their
  -- own consultation. Assert the select policy really is org-staff-only.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'specialist_consultation_extractions'
      and qual like '%auth.uid()%'
  ) then
    raise exception 'specialist_consultation_extractions: select policy must not admit the patient directly';
  end if;
end $$;
