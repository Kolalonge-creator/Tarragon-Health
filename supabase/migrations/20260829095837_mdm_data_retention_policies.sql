-- Tarragon Health — Health Data Architecture & MDM (spec §34.16)
-- Data retention: "Different categories of information may require
-- different retention periods. Retention policies should be configurable
-- and governed by applicable Nigerian legal and regulatory requirements."
--
-- WHY THIS SHIPS AS A GOVERNANCE TABLE, NOT A DELETION JOB
-- CLAUDE.md's own standing follow-ups list NDPC (Nigeria Data Protection
-- Commission) registration and a DPO appointment as still-open founder
-- items — there is no confirmed Nigerian legal retention period for any
-- category on this platform yet, clinical records least of all. Writing a
-- specific number of months into this migration would be inventing a
-- regulatory fact this build has no authority to assert, and a scheduled
-- job that actually DELETES clinical history based on a guessed number
-- would risk destroying data this platform's own record_corrections/
-- audit_log machinery exists specifically to never lose (§34.10: "Do not
-- casually delete clinical history"). So: retention_period_months is
-- nullable and seeded null for every category below except the two where
-- a period is a pure internal/technical decision, not a legal one. This
-- satisfies §34.16's actual requirement — retention policy is now
-- CONFIGURABLE DATA an admin/DPO can fill in once real guidance exists —
-- without fabricating the guidance itself or building an auto-delete path
-- ahead of that guidance existing.
--
-- CATEGORIES are the platform's own real data groupings (grepped from the
-- actual table list, not invented) — see governing_tables on each seeded
-- row.

create table public.data_retention_policies (
  id                        uuid primary key default gen_random_uuid(),
  category                  text not null unique,
  description               text not null,
  governing_tables          text[] not null default '{}',
  retention_period_months   integer,
  legal_basis               text not null,
  is_active                 boolean not null default true,
  reviewed_at               timestamptz,
  reviewed_by               uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint data_retention_policies_period_positive check (retention_period_months is null or retention_period_months > 0)
);

comment on table public.data_retention_policies is
  '§34.16 retention governance — configurable per data category. retention_period_months is deliberately null wherever no confirmed Nigerian legal/regulatory basis exists yet (see this migration''s header); an admin/DPO fills in a real number once one does, which is exactly what "configurable" means here.';

create trigger data_retention_policies_set_updated_at
  before update on public.data_retention_policies
  for each row execute function private.set_updated_at();

insert into public.data_retention_policies (category, description, governing_tables, retention_period_months, legal_basis) values
  (
    'clinical_records',
    'Diagnoses, allergies, medications, vitals, lab results, care plans, screening results, and every other clinically-authored record.',
    array['patient_conditions','patient_allergies','medications','vitals_readings','lab_analyte_readings','lab_result_documents','screening_results','care_plans','patient_blood_profile','patient_diabetes_profile','patient_cardiovascular_profile','escalations','clinician_alerts','emergency_events','vaccination_records'],
    null,
    'No confirmed Nigerian statutory period yet — pending NDPC registration/DPO appointment (open founder item, see CLAUDE.md). Nigerian medical-records practice conventionally favours long-term/life-of-patient retention; nothing here is deleted absent explicit future policy.'
  ),
  (
    'audit_and_correction_trails',
    'Row-change audit history, correction records, superseded-source-value history, duplicate-patient review history, and data-quality findings — the platform''s own provenance/history machinery (§34.8/§34.9/§34.10/§34.14).',
    array['audit_log','record_corrections','superseded_source_values','patient_match_candidates','data_quality_findings'],
    null,
    'Tied to the retention of the clinical/financial record each trail documents — cannot outlive (or be deleted independently of) what it audits. No confirmed end date; see clinical_records/financial_records rows.'
  ),
  (
    'financial_records',
    'Journal entries, bills, settlements, payment transactions, wallet ledger, and commission records.',
    array['finance_journal_entries','finance_bills','finance_settlements','payment_transactions','wallet_ledger','commissions','finance_capitation_receipts'],
    null,
    'Nigerian tax and companies law commonly expect multi-year retention of financial records, but the exact period has not been confirmed by counsel yet — open founder item alongside the Care Voucher structuring opinion (see CLAUDE.md).'
  ),
  (
    'consent_and_legal_records',
    'Patient consent grants/versions and identity verification records.',
    array['patient_consents','consent_versions','identity_verifications'],
    null,
    'Consent proof must outlive the consent itself for as long as the action it authorised could be challenged — no confirmed period pending NDPC/DPO guidance.'
  ),
  (
    'communications',
    'In-app care-team messaging and platform notifications (§ Non-Negotiable Business Rules: in-app is the working two-way channel).',
    array['care_messages','care_message_threads','notifications','support_messages'],
    null,
    'No confirmed period yet; treated as part of the clinical record trail where a message concerns clinical care.'
  ),
  (
    'marketing_and_analytics',
    'Marketing site leads and product web-event analytics — the one category where retention is a product/ops decision, not a clinical or statutory one, so a real default is set rather than left null.',
    array['leads','web_events'],
    36,
    'Internal product/ops decision (not a clinical or statutory requirement) — a lead or analytics event with no activity in 3 years has no ongoing business purpose. Revisit if NDPC guidance sets a shorter mandatory ceiling.'
  )
on conflict (category) do nothing;

-- ---------------------------------------------------------------------------
-- Read-side helper: what's configured, and (once a real period exists)
-- what actually exceeds it. Built now so the moment retention_period_
-- months is filled in for real, this has something to check against —
-- not gated behind a future migration.
-- ---------------------------------------------------------------------------

create or replace function public.data_retention_policy_summary()
returns table (
  category                text,
  retention_period_months integer,
  status                  text,
  legal_basis             text,
  governing_tables        text[]
)
language sql
stable
set search_path = ''
as $$
  select
    p.category,
    p.retention_period_months,
    case when p.retention_period_months is null then 'no_period_configured' else 'period_configured' end,
    p.legal_basis,
    p.governing_tables
  from public.data_retention_policies p
  where p.is_active
  order by p.category;
$$;

comment on function public.data_retention_policy_summary is
  '§34.16 read-side summary of configured retention policy per category. Does not identify or delete any expired record — see this migration''s header for why no deletion job exists yet.';

-- ---------------------------------------------------------------------------
-- RLS — same shape as reference_concepts/screen_types: readable by every
-- authenticated user (retention policy is not itself PHI and staff across
-- the platform benefit from being able to see it), admin-only write.
-- ---------------------------------------------------------------------------

alter table public.data_retention_policies enable row level security;

create policy data_retention_policies_select on public.data_retention_policies
  for select to authenticated using (true);
create policy data_retention_policies_insert on public.data_retention_policies
  for insert to authenticated with check (private.is_admin());
create policy data_retention_policies_update on public.data_retention_policies
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy data_retention_policies_delete on public.data_retention_policies
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.data_retention_policies to authenticated;
revoke all on public.data_retention_policies from anon;
revoke execute on function public.data_retention_policy_summary() from public;
grant execute on function public.data_retention_policy_summary() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.data_retention_policies;
  if v_count < 6 then
    raise exception 'FAIL: expected at least 6 seeded retention categories, found %', v_count;
  end if;

  -- The core §34.16 promise: every clinical/financial/consent category is
  -- explicitly UNRESOLVED (null period) rather than carrying an invented
  -- number, so nothing downstream can mistake a placeholder for policy.
  if exists (
    select 1 from public.data_retention_policies
    where category in ('clinical_records', 'financial_records', 'consent_and_legal_records')
      and retention_period_months is not null
  ) then
    raise exception 'FAIL: a clinical/financial/consent category has a retention_period_months value where none has been legally confirmed';
  end if;

  if has_table_privilege('anon', 'public.data_retention_policies', 'SELECT') then
    raise exception 'FAIL: anon still holds SELECT on public.data_retention_policies';
  end if;
  if has_function_privilege('anon', 'public.data_retention_policy_summary()', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.data_retention_policy_summary';
  end if;
end;
$$;
