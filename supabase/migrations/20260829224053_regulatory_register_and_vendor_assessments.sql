-- Tarragon Health
-- Data Governance gap-closure, item 5 of 7 (§87.15 "regulatory register" /
-- §87.17 "vendor compliance" of the 2026-08-29 governance/safety spec
-- audit). Confirmed live before writing this: no such tables exist --
-- docs/legal/nigeria-regulatory-compliance-status.md is real and
-- substantive but static markdown, and ai_vendors (built by another fleet
-- session) covers AI vendors specifically but nothing else (Supabase,
-- Paystack, Stripe, Termii, WhatsApp Cloud API).
--
-- Seeded from that real compliance doc (dated 31 July 2026) and CLAUDE.md's
-- own architecture section -- nothing here is invented. The doc's own
-- disclaimer applies just as much to this table: a live register is not a
-- legal opinion, and "code_complete" describes an engineering control, not
-- a resolved regulatory question. Both tables are admin-only, unlike this
-- pass's other new governance tables (table_classifications is broadly
-- org-staff readable) -- specific regulatory-gap detail (e.g. "no CBN
-- authorisation exists") is sensitive business information, not something
-- every org-staff login needs visibility into.

create table public.regulatory_obligations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  regulator_or_law  text not null check (length(btrim(regulator_or_law)) > 0),
  obligation        text not null check (length(btrim(obligation)) > 0),
  status            text not null check (status in ('code_complete', 'documentation_complete', 'requires_external_action', 'not_applicable')),
  detail            text,
  owner             text,
  renewal_date      date,
  source_doc        text,
  last_reviewed_at  date not null default current_date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.regulatory_obligations is
  'Live regulatory register, docs spec §87.15. Seeded from docs/legal/nigeria-regulatory-compliance-status.md (31 July 2026) -- a working document, not a legal opinion; "code_complete" means a real engineering control exists, not that the underlying regulatory question is resolved. Re-verify against current code/legal-docs before trusting any specific row past its last_reviewed_at.';

create index regulatory_obligations_org_status_idx on public.regulatory_obligations (organisation_id, status);

alter table public.regulatory_obligations enable row level security;

create policy regulatory_obligations_all on public.regulatory_obligations
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.regulatory_obligations to authenticated;

create trigger regulatory_obligations_set_updated_at
  before update on public.regulatory_obligations
  for each row execute function private.set_updated_at();

insert into public.regulatory_obligations (organisation_id, regulator_or_law, obligation, status, detail, source_doc) values
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'Data Processing / Telehealth / Terms of Service consent text accurately describes the live platform', 'code_complete', 'Rewritten 31 Jul 2026, live in consent_versions.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'DPIA for general health-data processing', 'documentation_complete', 'docs/legal/dpia-health-data-processing.md -- not yet reviewed by counsel or a DPO.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'DPIA for AI-assisted case-brief processing (Anthropic)', 'documentation_complete', 'docs/legal/dpia-ai-case-briefs.md -- flagged as a genuinely new cross-border transfer.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'Breach-notification runbook + operational tracking', 'code_complete', 'docs/legal/breach-notification-runbook.md + /admin/settings/data-breach-incidents, automated 72h-deadline alert.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'Data Protection Officer appointed', 'requires_external_action', 'No DPO named -- needs a real person appointed.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'NDPC registration', 'requires_external_action', 'Status unconfirmed -- needs a filing with the NDPC.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'Lawful cross-border transfer mechanism for Supabase (eu-west-1)', 'requires_external_action', 'Single highest-priority open item in the whole review -- needs counsel to select and document a mechanism.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'Data-processing agreement with Anthropic', 'requires_external_action', 'Needed before the AI case-brief feature can be considered fully assessed.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'NDPC / Nigeria Data Protection Act 2023', 'Formal data-retention schedule', 'documentation_complete', 'data_retention_policies now exists (6 categories, seeded) -- founder/counsel sign-off on exact periods still open for most categories (retention_period_months is null except marketing_and_analytics).', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'CBN / fintech (Health Wallet)', 'CBN Payment Service Provider licence, or confirmed pass-through status', 'requires_external_action', 'Single highest-severity open item found in the review -- no CBN authorisation exists or has been sought.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'MDCN / clinical staffing', 'MDCN confirmation the five-tier clinical-authority split is compliant', 'requires_external_action', 'Never claimed as regulator-approved anywhere on the platform (standing rule) -- but also never actually sought.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'PCN / NAFDAC / facility licensing', 'Regulatory license tracking on every partner catalogue', 'code_complete', 'license_type/number/expires_at/verified_at on all 5 partner tables; nightly expiry alert, extended to a 90/60/30 cascade this pass (§87.16).', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'State-level telehealth registration', 'Whether the platform entity needs state-level telehealth registration', 'requires_external_action', 'Not investigated beyond flagging -- needs a real conversation with the relevant state Ministry of Health.', 'docs/legal/nigeria-regulatory-compliance-status.md'),
  ((select id from public.organisations limit 1), 'FCCPC / consumer protection', 'Pre-purchase auto-renewal / plan-change disclosure', 'code_complete', 'Present on onboarding, change-plan, and add-on actions.', 'docs/legal/nigeria-regulatory-compliance-status.md');

-- ---------------------------------------------------------------------------
-- Vendor assessments -- non-AI vendors. ai_vendors already covers the AI
-- vendor case comprehensively; this deliberately does not duplicate it.
-- ---------------------------------------------------------------------------

create table public.vendor_assessments (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete cascade,
  vendor_name             text not null check (length(btrim(vendor_name)) > 0),
  vendor_role             text not null,
  data_processed          text,
  data_location           text,
  security_review_summary text,
  security_reviewed_at    date,
  contractual_controls    text,
  subcontractors          text,
  incident_response_note  text,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.vendor_assessments is
  'Non-AI vendor compliance assessment, docs spec §87.17. ai_vendors (built earlier the same day by another session) already covers the AI-vendor case with the same shape; this covers the platform''s other core infrastructure vendors, seeded from CLAUDE.md''s own architecture section and the regulatory compliance doc.';

create index vendor_assessments_org_idx on public.vendor_assessments (organisation_id);

alter table public.vendor_assessments enable row level security;

create policy vendor_assessments_all on public.vendor_assessments
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.vendor_assessments to authenticated;

create trigger vendor_assessments_set_updated_at
  before update on public.vendor_assessments
  for each row execute function private.set_updated_at();

insert into public.vendor_assessments (organisation_id, vendor_name, vendor_role, data_processed, data_location, contractual_controls, is_active) values
  ((select id from public.organisations limit 1), 'Supabase', 'Postgres database, auth, storage, realtime -- the platform''s primary data store', 'All patient/clinical data', 'eu-west-1 (Ireland) -- Supabase has no Africa region; closest available to Nigeria', 'Standard Supabase DPA; lawful cross-border transfer mechanism still open (see regulatory_obligations).', true),
  ((select id from public.organisations limit 1), 'Paystack', 'NGN payment processing', 'Payment/transaction data, no clinical data', 'Nigeria', 'Standard Paystack merchant agreement.', true),
  ((select id from public.organisations limit 1), 'Stripe', 'GBP/USD diaspora payment processing', 'Payment/transaction data, no clinical data', 'EU/US (Stripe standard)', 'Standard Stripe merchant agreement.', true),
  ((select id from public.organisations limit 1), 'Termii', 'SMS fallback for notifications', 'Phone number + notification content (never clinical detail per content_class gating)', 'Nigeria', 'Sender-ID carrier approval pending -- see project memory on Termii/Meta template blocks.', true),
  ((select id from public.organisations limit 1), 'WhatsApp Cloud API (Meta)', 'Notification/reminder delivery + legacy inbound support chat', 'Phone number + notification content (never a required interface for core actions)', 'Meta infrastructure', 'WABA template management approval pending with Meta.', true),
  ((select id from public.organisations limit 1), 'Upstash', 'Redis cache/queue layer', 'Ephemeral cache data, no long-term clinical storage', 'Not yet confirmed', 'Standard Upstash terms -- no dedicated DPA review recorded yet.', true);

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'regulatory_obligations') then
    raise exception 'regulatory_obligations missing after migration';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'vendor_assessments') then
    raise exception 'vendor_assessments missing after migration';
  end if;
  if (select count(*) from public.regulatory_obligations) < 10 then
    raise exception 'regulatory_obligations seed looks incomplete';
  end if;
  if (select count(*) from public.vendor_assessments) < 5 then
    raise exception 'vendor_assessments seed looks incomplete';
  end if;
  raise notice 'PASS: regulatory_obligations (% rows) + vendor_assessments (% rows) created and seeded',
    (select count(*) from public.regulatory_obligations), (select count(*) from public.vendor_assessments);
end $$;
