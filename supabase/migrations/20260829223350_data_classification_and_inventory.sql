-- Tarragon Health
-- Data Governance gap-closure, item 1 of 7 (§87.2/§87.3/§87.4/§87.5 of the
-- 2026-08-29 governance/safety spec audit). Confirmed live before writing
-- this: no data_classification enum, no inventory table, anywhere. Sparked
-- by re-checking data_retention_policies (built by another fleet session,
-- confirmed real and seeded 6 categories with a legal_basis) -- this
-- migration cross-references it directly rather than duplicating the
-- retention concept.
--
-- Pragmatic coverage, not every table: seeds the ~20 highest-sensitivity
-- tables (patient identity, clinical records, safety/governance tables this
-- pass itself built) rather than attempting all ~250+ tables on the
-- project -- the classification scheme and the registry mechanism are the
-- deliverable; exhaustive coverage is a live-maintained follow-up, not a
-- one-time migration's job.

create type public.data_classification as enum (
  'public', 'internal', 'confidential', 'sensitive_health', 'highly_restricted'
);

create table public.table_classifications (
  id                uuid primary key default gen_random_uuid(),
  schema_name       text not null default 'public',
  table_name        text not null,
  classification    public.data_classification not null,
  purpose            text not null check (length(btrim(purpose)) > 0),
  retention_category text references public.data_retention_policies (category) on delete set null,
  sharing_note      text,
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint table_classifications_unique_table unique (schema_name, table_name)
);

comment on table public.table_classifications is
  'Data classification + purpose + retention-linkage registry, docs spec §87.2/§87.3/§87.4. Deliberately not exhaustive -- seeded for the highest-sensitivity tables, extended as new ones are added. retention_category FKs to data_retention_policies.category (built earlier the same day by another session).';

alter table public.table_classifications enable row level security;

create policy table_classifications_select on public.table_classifications
  for select to authenticated
  using (true);

create policy table_classifications_write on public.table_classifications
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.table_classifications to authenticated;

create trigger table_classifications_set_updated_at
  before update on public.table_classifications
  for each row execute function private.set_updated_at();

insert into public.table_classifications (table_name, classification, purpose, retention_category, sharing_note) values
  ('profiles', 'confidential', 'Core identity/account record for every platform user.', 'clinical_records', 'Never shared externally without explicit patient consent or a care_access_events-logged authorisation.'),
  ('vitals_readings', 'sensitive_health', 'Patient-logged or device-synced clinical measurements (BP, glucose, weight, SpO2, etc.) driving the escalation pipeline.', 'clinical_records', 'Shared with the AI case-brief pipeline (input_snapshot) and, on request, exported to the patient (Health Passport).'),
  ('medications', 'sensitive_health', 'Active/historical medication record, drives drug-safety checks.', 'clinical_records', 'Never shared externally except via a patient-initiated export or an authorised referral summary.'),
  ('screening_results', 'sensitive_health', 'Prevention/screening results, including sensitive test types (HIV, hepatitis, cancer).', 'clinical_records', 'The abnormal-result pipeline is the only automated external touchpoint (edge function to the assigned doctor).'),
  ('lab_analyte_readings', 'sensitive_health', 'Structured lab values extracted from uploaded reports.', 'clinical_records', 'Not shared externally; feeds internal clinical-decision-support views only.'),
  ('clinical_encounter_notes', 'sensitive_health', 'Signed clinical documentation of a consultation.', 'clinical_records', 'Never shared externally; identity-confirmation-gated to finalize (§89.4).'),
  ('clinical_incident_reports', 'highly_restricted', 'Clinical safety incident/near-miss log -- names specific patients and staff in a governance-review context.', 'clinical_records', 'Org-staff readable; never shared externally.'),
  ('safeguarding_concerns', 'highly_restricted', 'Child/vulnerable-adult safeguarding concern log.', 'clinical_records', 'Restricted to Tier 3+/Clinical Director + reporter (§89.12); never shared externally under any circumstance without a statutory safeguarding referral, which is out of this platform''s scope.'),
  ('escalations', 'sensitive_health', 'Clinical escalation/case record, including resolution notes.', 'clinical_records', 'Never shared externally.'),
  ('clinician_alerts', 'sensitive_health', 'The clinical-safety alert pipeline''s working record.', 'clinical_records', 'Never shared externally.'),
  ('emergency_events', 'highly_restricted', 'Emergency/danger-symptom event record, may trigger next-of-kin contact.', 'clinical_records', 'Emergency contact is notified per the patient''s own on-file consent (emergency_contact_consent).'),
  ('consent_versions', 'internal', 'The consent text itself -- not personal data, but the legal record of what patients agreed to.', 'consent_and_legal_records', 'Publicly viewable (marketing site /privacy, /terms) by design.'),
  ('patient_consents', 'confidential', 'Record of which consent version each patient accepted, and when.', 'consent_and_legal_records', 'Never shared externally; the DSAR export surfaces a patient''s own consent history to themselves.'),
  ('care_access_events', 'confidential', 'Audit trail of who accessed or was granted access to a patient''s record.', 'audit_and_correction_trails', 'Never shared externally; this table IS the sharing-audit mechanism for other tables.'),
  ('record_corrections', 'confidential', 'Before/after audit trail for corrected clinical data.', 'audit_and_correction_trails', 'Never shared externally.'),
  ('identity_verifications', 'highly_restricted', 'KYC identity documents/verification status (NIN/BVN).', 'consent_and_legal_records', 'Never shared externally except where required for a specific regulated transaction (e.g. Health Wallet KYC tier).'),
  ('data_breach_incidents', 'highly_restricted', 'NDPA breach-notification tracking, may itself describe a PHI exposure.', 'audit_and_correction_trails', 'Shared only with the NDPC (breach notification) and affected data subjects, per the breach-notification runbook.'),
  ('ai_interaction_log', 'sensitive_health', 'Record of patient interactions with AI systems (case briefs, symptom triage, coach).', 'clinical_records', 'The underlying content may be shared with the AI vendor (Anthropic) per case_briefs.input_snapshot -- see docs/legal/dpia-ai-case-briefs.md.'),
  ('patient_receipts', 'confidential', 'Financial transaction record tied to a specific patient.', 'financial_records', 'Shared with the payment processor (Paystack/Stripe) at transaction time only.'),
  ('leads', 'internal', 'Marketing-site contact-form submissions.', 'marketing_and_analytics', 'Never shared externally except where the lead explicitly requests a callback via a named partner.');

do $$
begin
  if not exists (select 1 from pg_type where typname = 'data_classification') then
    raise exception 'data_classification enum was not created';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'table_classifications') then
    raise exception 'table_classifications missing after migration';
  end if;
  if (select count(*) from public.table_classifications) < 15 then
    raise exception 'table_classifications seed looks incomplete -- expected at least 15 rows';
  end if;
  raise notice 'PASS: data_classification + table_classifications created and seeded (% rows)', (select count(*) from public.table_classifications);
end $$;
