-- Tarragon Health, S15: clinician network data model and credentialing workflow.
-- Spec: docs/BUILD-SPEC-v5.md 7.1 and 7.2. Design: docs/design/S15.md.
--
-- What this adds (live `clinical_staff` is the spec's `clinicians`; it is extended, not replaced):
--   * clinician_applications and a database-enforced state machine (started ... active,
--     suspended, offboarded, rejected). state can only change through
--     private.apply_application_transition(); a direct UPDATE is refused by a trigger.
--   * clinician_documents (private bucket), clinician_checks, an append-only
--     transition log and an append-only document access log.
--   * competencies, clinician_competencies, training modules and progress, a scenario test
--     (scored in the database, answer key never leaves it), attempts with a retake cap.
--   * clinical_staff.status / credentialing_level / language / limits columns.
--   * expiry tracking for the MDCN practising licence and indemnity (D-10): notices at 90
--     days, 30 days and on the day (to the clinician and to reviewers), a short audited
--     grace period, and a nightly sweep that suspends on expiry.
--   * private.clinician_is_eligible(): the one function later sessions call before offering
--     a clinician any task, page or rota slot.
--
-- Safety rules this migration enforces, in the database not the app:
--   1. An applicant is never role = clinician before activation (private.is_org_staff()
--      admits any active non-patient role, so an early role flip would expose PHI).
--      activate_clinician() flips the role; suspend/offboard flips it back to patient.
--   2. Whoever verifies is never the applicant; the approver is an active Chief Medical
--      Officer who is not the applicant and (config) not a person who verified a check.
--   3. A suspended or offboarded clinician cannot be active (trigger).
--   4. Expiry sweep never suspends on a missing date (the two live staff rows carry none),
--      never suspends inside an audited grace period, and honours the existing indemnity
--      exemptions exactly as private.enforce_clinical_staff_indemnity() does.
--
-- Counts before this migration (live, 2026-10-06): clinical_staff 2 rows (one chief medical
-- officer, one senior medical officer), 0 test rows, no licence or indemnity dates on file.
-- No existing clinician is suspended or changed by this migration beyond receiving
-- status = 'active' and credentialing_level = 2.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.clinician_application_state as enum (
  'started', 'documents_submitted', 'checks_in_progress', 'training', 'test_passed',
  'approved_tier1', 'active', 'suspended', 'offboarded', 'rejected'
);

create type public.clinician_document_kind as enum (
  'mdcn_practising_licence',   -- the current-year MDCN annual practising licence
  'mdcn_portal_screenshot',    -- screenshot of the clinician's own MDCN portal profile page
  'graduation_certificate',    -- graduation licence / medical degree certificate
  'nysc_certificate',          -- NYSC discharge or exemption certificate
  'government_id',
  'indemnity_certificate',
  'cv',
  'mdcn_confirmation'          -- optional: a written confirmation from MDCN
);

create type public.credential_check_kind as enum (
  'licence', 'qualifications', 'identity', 'practice_years', 'referee_1', 'referee_2'
);

create type public.credential_check_result as enum ('pending', 'passed', 'failed');

create type public.clinician_status as enum ('active', 'suspended', 'offboarded');

-- ---------------------------------------------------------------------------
-- 2. Versioned configuration (PROPOSED values; mirrored as credentialing.rules in
--    packages/shared/src/proposed-config, a test keeps the two identical).
-- ---------------------------------------------------------------------------
create table public.credentialing_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index credentialing_config_one_active on public.credentialing_config (is_active) where is_active;

-- credentialing-rules-begin
insert into public.credentialing_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "min_practice_years": 2,
  "pass_percent": 80,
  "all_red_correct": true,
  "audited_task_count": 20,
  "referees_required": 2,
  "referee_independent_contact": true,
  "test_max_attempts": 3,
  "test_retake_cooldown_hours": 24,
  "test_scenarios_per_attempt": 10,
  "notice_windows_days": [90, 30, 0],
  "grace_max_days": 14,
  "separate_verifier_and_approver": true,
  "document_max_bytes": 8388608,
  "document_retention_years_after_offboarding": 7
}
$json$::jsonb);
-- credentialing-rules-end

alter table public.credentialing_config enable row level security;
create policy credentialing_config_read on public.credentialing_config
  for select to authenticated using (true);
revoke insert, update, delete on public.credentialing_config from authenticated;
revoke all on public.credentialing_config from anon;

create function private.credential_rule(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.credentialing_config where is_active order by version desc limit 1 $$;
revoke all on function private.credential_rule(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. clinical_staff additions
-- ---------------------------------------------------------------------------
alter table public.clinical_staff
  add column status               public.clinician_status not null default 'active',
  add column suspended_at         timestamptz,
  add column suspended_reason     text,
  add column credentialing_level  smallint,
  add column audited_task_count   integer not null default 0,
  add column max_concurrent_claims integer not null default 1,
  add column max_lead_patients    integer,
  add column languages            text[] not null default '{}',
  add column reliability_score    numeric;

alter table public.clinical_staff
  add constraint clinical_staff_credentialing_level_check check (credentialing_level is null or credentialing_level in (1, 2)),
  add constraint clinical_staff_max_concurrent_claims_check check (max_concurrent_claims >= 1),
  add constraint clinical_staff_audited_task_count_check check (audited_task_count >= 0);

comment on column public.clinical_staff.credentialing_level is
  'v5 credentialing level (1 = limited task types, first N tasks audited; 2 = full task types, on-call and lead eligible). NOT doctor_tier (the seniority ladder). Enforced by S16/S17, stored here as data (OQ-24).';
comment on column public.clinical_staff.status is
  'Credentialing lifecycle. active = may work (together with active = true); suspended and offboarded can never be active (trigger).';

-- Existing live clinicians: employed senior medical officer and the chief medical officer start at level 2.
update public.clinical_staff set credentialing_level = 2
  where credentialing_level is null and doctor_tier in ('senior_medical_officer', 'chief_medical_officer');

-- One live clinician per MDCN folio (reuse is the Nigerian forgery risk; see docs/research/S15.md).
create unique index clinical_staff_live_folio_unique
  on public.clinical_staff (upper(regexp_replace(credential_type, '\s', '', 'g')), upper(regexp_replace(credential_number, '\s', '', 'g')))
  where status <> 'offboarded' and credential_number is not null and credential_type is not null;

create function private.enforce_clinical_staff_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'active' and new.active then
    raise exception 'clinical_staff: a % clinician cannot be active; use reinstate_clinician()', new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger clinical_staff_enforce_status before insert or update on public.clinical_staff
  for each row execute function private.enforce_clinical_staff_status();
revoke all on function private.enforce_clinical_staff_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
create function private.credential_is_cmo() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.clinical_staff
    where profile_id = (select auth.uid()) and active and status = 'active' and doctor_tier = 'chief_medical_officer');
$$;

-- "Ops" is a capability, not an account role (OQ-24): an admin account or the active chief medical officer.
create function private.can_credential_review() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_admin() or private.credential_is_cmo(); $$;

create function private.credential_audit(p_org uuid, p_actor uuid, p_action text, p_entity_type text, p_entity_id uuid, p_event jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (p_org, p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_event, '{}'::jsonb));
$$;

create function private.credential_notify(p_recipient uuid, p_org uuid, p_subject text, p_message text, p_payload jsonb, p_email boolean default true)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
  values (p_recipient, p_org, 'in_app', 'credential_notice', coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('subject', p_subject, 'message', p_message), 'pending', 'non_clinical');
  if p_email then
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
    values (p_recipient, p_org, 'email', 'credential_notice', coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('subject', p_subject, 'message', p_message), 'pending', 'non_clinical');
  end if;
end;
$$;

create function private.credential_notify_reviewers(p_org uuid, p_subject text, p_message text, p_payload jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select p.id from public.profiles p where p.is_active and p.role = 'admin'
    union
    select cs.profile_id from public.clinical_staff cs where cs.profile_id is not null and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
  loop
    perform private.credential_notify(r.id, p_org, p_subject, p_message, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('audience', 'reviewer'), false);
  end loop;
end;
$$;

revoke all on function private.credential_is_cmo() from public, anon, authenticated;
revoke all on function private.can_credential_review() from public, anon, authenticated;
revoke all on function private.credential_audit(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.credential_notify(uuid, uuid, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function private.credential_notify_reviewers(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.credential_is_cmo() to authenticated;
grant execute on function private.can_credential_review() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tables
-- ---------------------------------------------------------------------------
create table public.clinician_applications (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  profile_id              uuid not null references public.profiles (id) on delete restrict,
  state                   public.clinician_application_state not null default 'started',
  employment_type         public.staff_employment_type not null default 'contracted',
  mdcn_folio              text,
  folio_flag              text check (folio_flag in ('in_use', 'previously_rejected', 'previously_suspended')),
  qualification           text,
  graduation_year         smallint,
  nysc_year               smallint,
  years_since_house_job   numeric(4, 1) check (years_since_house_job is null or years_since_house_job >= 0),
  specialties             text[] not null default '{}',
  languages               text[] not null default '{}',
  referees                jsonb not null default '[]'::jsonb,
  conflicts_declared_at   timestamptz,
  conflicts_declaration   jsonb,
  indemnity_insurer       text,
  indemnity_policy_number text,
  indemnity_expires_at    timestamptz,
  licence_expires_at      timestamptz,
  test_extra_attempts     integer not null default 0 check (test_extra_attempts >= 0),
  submitted_at            timestamptz,
  decided_at              timestamptz,
  rejected_reason         text,
  notes                   text,
  approved_by             uuid references public.profiles (id) on delete restrict,
  approved_at             timestamptz,
  clinical_staff_id       uuid references public.clinical_staff (id) on delete set null,
  is_test                 boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint clinician_applications_no_self_approval check (approved_by is null or approved_by <> profile_id)
);
create unique index clinician_applications_one_open_per_profile
  on public.clinician_applications (profile_id) where state not in ('rejected', 'offboarded');
create unique index clinician_applications_live_folio_unique
  on public.clinician_applications (upper(regexp_replace(mdcn_folio, '\s', '', 'g')))
  where mdcn_folio is not null and state not in ('rejected', 'offboarded');
create index clinician_applications_state_idx on public.clinician_applications (organisation_id, state);
create trigger clinician_applications_set_updated_at before update on public.clinician_applications
  for each row execute function private.set_updated_at();

create table public.clinician_application_transition_rules (
  from_state public.clinician_application_state not null,
  to_state   public.clinician_application_state not null,
  actor_kind text not null check (actor_kind in ('applicant', 'reviewer', 'cmo', 'system')),
  primary key (from_state, to_state)
);
insert into public.clinician_application_transition_rules (from_state, to_state, actor_kind) values
  ('started', 'documents_submitted', 'applicant'),
  ('documents_submitted', 'checks_in_progress', 'reviewer'),
  ('checks_in_progress', 'training', 'system'),
  ('training', 'test_passed', 'system'),
  ('test_passed', 'approved_tier1', 'cmo'),
  ('approved_tier1', 'active', 'reviewer'),
  ('active', 'suspended', 'reviewer'),
  ('suspended', 'active', 'reviewer'),
  ('active', 'offboarded', 'reviewer'),
  ('suspended', 'offboarded', 'reviewer'),
  ('started', 'rejected', 'reviewer'),
  ('documents_submitted', 'rejected', 'reviewer'),
  ('checks_in_progress', 'rejected', 'reviewer'),
  ('training', 'rejected', 'reviewer'),
  ('test_passed', 'rejected', 'reviewer'),
  ('approved_tier1', 'rejected', 'reviewer');

create table public.clinician_application_transitions (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  application_id uuid not null references public.clinician_applications (id) on delete cascade,
  from_state     public.clinician_application_state,
  to_state       public.clinician_application_state not null,
  actor_id       uuid references public.profiles (id) on delete set null,
  reason         text,
  is_test        boolean not null default false,
  created_at     timestamptz not null default now()
);
create index clinician_application_transitions_app_idx on public.clinician_application_transitions (application_id, created_at);

create table public.clinician_documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  owner_profile_id uuid not null references public.profiles (id) on delete restrict,
  application_id   uuid references public.clinician_applications (id) on delete set null,
  clinical_staff_id uuid references public.clinical_staff (id) on delete set null,
  kind             public.clinician_document_kind not null,
  storage_path     text not null unique,
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes > 0),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  expires_at       timestamptz,
  verified_by      uuid references public.profiles (id) on delete set null,
  verified_at      timestamptz,
  verification_note text,
  superseded_at    timestamptz,
  retain_until     date,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint clinician_documents_no_self_verification check (verified_by is null or verified_by <> owner_profile_id),
  constraint clinician_documents_has_owner_context check (application_id is not null or clinical_staff_id is not null)
);
create index clinician_documents_owner_idx on public.clinician_documents (owner_profile_id, kind) where superseded_at is null;
create index clinician_documents_app_idx on public.clinician_documents (application_id);

create table public.clinician_document_access_log (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  document_id    uuid not null references public.clinician_documents (id) on delete cascade,
  actor_id       uuid references public.profiles (id) on delete set null,
  is_owner       boolean not null,
  is_test        boolean not null default false,
  created_at     timestamptz not null default now()
);

create table public.clinician_checks (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  application_id       uuid not null references public.clinician_applications (id) on delete cascade,
  kind                 public.credential_check_kind not null,
  result               public.credential_check_result not null default 'pending',
  performed_by         uuid references public.profiles (id) on delete set null,
  performed_at         timestamptz,
  evidence_document_id uuid references public.clinician_documents (id) on delete set null,
  notes                text,
  details              jsonb not null default '{}'::jsonb,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (application_id, kind)
);

create table public.competencies (
  code        text primary key,
  label       text not null,
  description text not null,
  requires_level smallint not null default 1 check (requires_level in (1, 2)),
  is_active   boolean not null default true
);
insert into public.competencies (code, label, description, requires_level) values
  ('adult_general', 'Adult general care', 'General adult consultations within protocols.', 1),
  ('hypertension', 'Hypertension', 'Blood pressure care pathway.', 1),
  ('diabetes', 'Diabetes', 'Diabetes care pathway.', 1),
  ('result_review', 'Result review', 'Review of laboratory and device results.', 1),
  ('prescribing', 'Prescribing', 'Signing prescriptions and care plan changes.', 1),
  ('on_call', 'On call', 'Eligible for the on-call rota and red event pages.', 2),
  ('lead_clinician', 'Lead clinician', 'Eligible to be a named lead clinician for care pack patients.', 2);

create table public.clinician_competencies (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  competency_code   text not null references public.competencies (code),
  granted_by        uuid not null references public.profiles (id) on delete restrict,
  granted_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles (id) on delete set null,
  is_test           boolean not null default false
);
create unique index clinician_competencies_one_active on public.clinician_competencies (clinical_staff_id, competency_code) where revoked_at is null;

create table public.training_modules (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  code              text not null,
  version           integer not null default 1,
  title             text not null,
  summary           text not null default '',
  content           jsonb not null default '[]'::jsonb,
  estimated_minutes integer not null default 10,
  status            text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_by       uuid references public.profiles (id) on delete set null,
  approved_at       timestamptz,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (organisation_id, code, version),
  constraint training_modules_approved_has_approver check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table public.training_progress (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  application_id uuid not null references public.clinician_applications (id) on delete cascade,
  module_id      uuid not null references public.training_modules (id) on delete restrict,
  completed_at   timestamptz not null default now(),
  is_test        boolean not null default false,
  unique (application_id, module_id)
);

create table public.credential_test_cases (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  code             text not null,
  version          integer not null default 1,
  scenario         text not null,
  options          jsonb not null,
  correct_option_id text not null,
  is_red           boolean not null default false,
  rationale        text not null default '',
  status           text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (organisation_id, code, version),
  constraint credential_test_cases_approved_has_approver check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table public.credential_test_attempts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  application_id  uuid not null references public.clinician_applications (id) on delete cascade,
  attempt_number  integer not null,
  case_ids        uuid[] not null,
  answers         jsonb,
  score_percent   numeric(5, 2),
  red_total       integer,
  red_correct     integer,
  red_misses      jsonb,
  passed          boolean,
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  is_test         boolean not null default false,
  unique (application_id, attempt_number)
);

create table public.credential_grace_periods (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  kind              text not null check (kind in ('licence', 'indemnity')),
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz not null,
  reason            text not null check (length(btrim(reason)) >= 10),
  granted_by        uuid not null references public.profiles (id) on delete restrict,
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles (id) on delete set null,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index credential_grace_periods_staff_idx on public.credential_grace_periods (clinical_staff_id, kind) where revoked_at is null;

create table public.credential_expiry_notices (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id uuid not null references public.clinical_staff (id) on delete cascade,
  kind              text not null check (kind in ('licence', 'indemnity')),
  expires_on        date not null,
  window_days       integer not null,
  was_sent          boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (clinical_staff_id, kind, expires_on, window_days)
);

-- append-only logs
create function private.credential_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '% is append only', tg_table_name using errcode = '23514'; end; $$;
create trigger clinician_application_transitions_append_only before update or delete on public.clinician_application_transitions
  for each row execute function private.credential_append_only();
create trigger clinician_document_access_log_append_only before update or delete on public.clinician_document_access_log
  for each row execute function private.credential_append_only();
revoke all on function private.credential_append_only() from public, anon, authenticated;

-- application.state changes only through apply_application_transition()
create function private.guard_application_state() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state is distinct from old.state and coalesce(current_setting('tarragon.credential_transition', true), '') <> 'on' then
    raise exception 'clinician_applications.state can only change through the credentialing functions' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clinician_applications_guard_state before update on public.clinician_applications
  for each row execute function private.guard_application_state();
revoke all on function private.guard_application_state() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS and grants. Writes happen only inside SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
alter table public.clinician_applications enable row level security;
alter table public.clinician_application_transition_rules enable row level security;
alter table public.clinician_application_transitions enable row level security;
alter table public.clinician_documents enable row level security;
alter table public.clinician_document_access_log enable row level security;
alter table public.clinician_checks enable row level security;
alter table public.competencies enable row level security;
alter table public.clinician_competencies enable row level security;
alter table public.training_modules enable row level security;
alter table public.training_progress enable row level security;
alter table public.credential_test_cases enable row level security;
alter table public.credential_test_attempts enable row level security;
alter table public.credential_grace_periods enable row level security;
alter table public.credential_expiry_notices enable row level security;

create policy clinician_applications_select on public.clinician_applications for select to authenticated
  using (profile_id = (select auth.uid()) or private.can_credential_review());
create policy clinician_application_transition_rules_select on public.clinician_application_transition_rules for select to authenticated using (true);
create policy clinician_application_transitions_select on public.clinician_application_transitions for select to authenticated
  using (private.can_credential_review() or exists (
    select 1 from public.clinician_applications a where a.id = application_id and a.profile_id = (select auth.uid())));
create policy clinician_documents_select on public.clinician_documents for select to authenticated
  using (owner_profile_id = (select auth.uid()) or private.can_credential_review());
create policy clinician_document_access_log_select on public.clinician_document_access_log for select to authenticated
  using (private.can_credential_review());
create policy clinician_checks_select on public.clinician_checks for select to authenticated
  using (private.can_credential_review());
create policy competencies_select on public.competencies for select to authenticated using (true);
create policy clinician_competencies_select on public.clinician_competencies for select to authenticated
  using (private.can_credential_review() or exists (
    select 1 from public.clinical_staff cs where cs.id = clinical_staff_id and cs.profile_id = (select auth.uid())));
create policy training_modules_select on public.training_modules for select to authenticated
  using (status = 'approved' or private.can_credential_review());
create policy training_progress_select on public.training_progress for select to authenticated
  using (private.can_credential_review() or exists (
    select 1 from public.clinician_applications a where a.id = application_id and a.profile_id = (select auth.uid())));
-- test cases carry the answer key: reviewers only, never the applicant
create policy credential_test_cases_select on public.credential_test_cases for select to authenticated
  using (private.can_credential_review());
create policy credential_test_attempts_select on public.credential_test_attempts for select to authenticated
  using (private.can_credential_review());
create policy credential_grace_periods_select on public.credential_grace_periods for select to authenticated
  using (private.can_credential_review() or exists (
    select 1 from public.clinical_staff cs where cs.id = clinical_staff_id and cs.profile_id = (select auth.uid())));
create policy credential_expiry_notices_select on public.credential_expiry_notices for select to authenticated
  using (private.can_credential_review());

do $$
declare t text;
begin
  foreach t in array array[
    'clinician_applications', 'clinician_application_transition_rules', 'clinician_application_transitions',
    'clinician_documents', 'clinician_document_access_log', 'clinician_checks', 'competencies',
    'clinician_competencies', 'training_modules', 'training_progress', 'credential_test_cases',
    'credential_test_attempts', 'credential_grace_periods', 'credential_expiry_notices']
  loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Documents bucket: private; the web app uploads after a magic-byte check and
--    serves bytes only through an authenticated route that writes the access log.
--    No SELECT policy for authenticated, so no direct download or bearer link exists.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinician-documents', 'clinician-documents', false, 8388608,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Deliberately NO policy for authenticated on this bucket (no insert, select, update or delete). Files arrive only through
-- the web route, which checks the real file type from the first bytes, uploads with the service role, and then calls
-- register_clinician_document(), which confirms the object exists with the declared size and type. A signed-in user can
-- therefore neither store an unvetted file here nor fill the bucket with files that have no record.

-- ---------------------------------------------------------------------------
-- 8. Events (S10 bus). Ids only in payloads.
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('clinician.application_state_changed', 'A clinician application moved to a new state', 'S15', false),
  ('clinician.credential_expiring', 'A clinician licence or indemnity is close to expiry or expired', 'S15', false),
  ('clinician.suspended', 'A clinician was suspended and must leave queues, rotas and lead assignments', 'S15', false),
  ('clinician.reinstated', 'A suspended clinician was reinstated', 'S15', false),
  ('clinician.competency_changed', 'A clinician competency or credentialing level changed', 'S15', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('clinician.application_state_changed', 1, array['application_id', 'to_state']),
  ('clinician.credential_expiring', 1, array['clinical_staff_id', 'kind']),
  ('clinician.suspended', 1, array['clinical_staff_id']),
  ('clinician.reinstated', 1, array['clinical_staff_id']),
  ('clinician.competency_changed', 1, array['clinical_staff_id'])
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9. The one state-change function
-- ---------------------------------------------------------------------------
create function private.apply_application_transition(p_application uuid, p_to public.clinician_application_state, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
begin
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.clinician_application_transition_rules where from_state = a.state and to_state = p_to) then
    raise exception 'clinician application: % to % is not a valid transition', a.state, p_to using errcode = '23514';
  end if;
  perform set_config('tarragon.credential_transition', 'on', true);
  update public.clinician_applications
    set state = p_to,
        submitted_at = case when p_to = 'documents_submitted' then now() else submitted_at end,
        decided_at = case when p_to in ('rejected', 'approved_tier1', 'offboarded') then now() else decided_at end,
        rejected_reason = case when p_to = 'rejected' then p_reason else rejected_reason end
    where id = p_application;
  perform set_config('tarragon.credential_transition', 'off', true);
  insert into public.clinician_application_transitions (organisation_id, application_id, from_state, to_state, actor_id, reason, is_test)
    values (a.organisation_id, a.id, a.state, p_to, p_actor, p_reason, a.is_test);
  perform private.credential_audit(a.organisation_id, p_actor, 'clinician_application.' || p_to::text, 'clinician_application', a.id,
    jsonb_build_object('from', a.state, 'to', p_to));
  perform private.emit_domain_event('clinician.application_state_changed', a.organisation_id,
    jsonb_build_object('application_id', a.id, 'from_state', a.state, 'to_state', p_to),
    'clinician.application_state_changed:' || a.id || ':' || p_to || ':' || extract(epoch from clock_timestamp())::text);
  if p_to in ('approved_tier1', 'active', 'rejected') then
    perform private.credential_notify(a.profile_id, a.organisation_id, 'Your clinician application',
      case p_to
        when 'approved_tier1' then 'Your application has been approved. Your care team lead will switch you on shortly.'
        when 'active' then 'You are now active on Tarragon Health.'
        else 'Your application was not approved. Your care team lead can tell you more.'
      end, jsonb_build_object('application_id', a.id, 'audience', 'applicant'), true);
  end if;
end;
$$;
revoke all on function private.apply_application_transition(uuid, public.clinician_application_state, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Applicant functions
-- ---------------------------------------------------------------------------
create function public.start_clinician_application(p_employment_type public.staff_employment_type default 'contracted')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid;
  if not found or not p.is_active or p.organisation_id is null then raise exception 'account is not active' using errcode = '42501'; end if;
  if p.role <> 'patient' then raise exception 'only a person account can apply; this account is already %', p.role using errcode = '42501'; end if;
  if p.is_dependent_account then raise exception 'a dependant account cannot apply' using errcode = '42501'; end if;
  if exists (select 1 from public.clinical_staff where profile_id = v_uid and status <> 'offboarded') then
    raise exception 'this account already has a clinician record' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinical_staff where profile_id = v_uid and status = 'offboarded') then
    raise exception 'your earlier clinician record was closed; ask your care team lead to reopen it' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    raise exception 'confirm your email first' using errcode = '42501';
  end if;
  if p.phone is null or btrim(p.phone) = '' then raise exception 'add your phone number first' using errcode = '42501'; end if;
  select id into v_id from public.clinician_applications where profile_id = v_uid and state not in ('rejected', 'offboarded');
  if v_id is not null then return v_id; end if;
  -- Employed or freelance is the organisation's fact, never the applicant's claim: whatever was passed, a self-started
  -- application is freelance (it needs its own indemnity) until a reviewer sets it with set_application_employment_type().
  insert into public.clinician_applications (organisation_id, profile_id, employment_type, is_test)
    values (p.organisation_id, v_uid, 'contracted', p.is_test) returning id into v_id;
  insert into public.clinician_application_transitions (organisation_id, application_id, from_state, to_state, actor_id, reason, is_test)
    values (p.organisation_id, v_id, null, 'started', v_uid, 'application started', p.is_test);
  perform private.credential_audit(p.organisation_id, v_uid, 'clinician_application.started', 'clinician_application', v_id, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.save_clinician_application(p_application uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  v_nysc smallint;
begin
  select * into a from public.clinician_applications where id = p_application and profile_id = auth.uid();
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.state <> 'started' then raise exception 'details can only be edited before you submit' using errcode = '23514'; end if;
  update public.clinician_applications set
    mdcn_folio = nullif(btrim(p_details ->> 'mdcn_folio'), ''),
    qualification = nullif(btrim(p_details ->> 'qualification'), ''),
    graduation_year = nullif(p_details ->> 'graduation_year', '')::smallint,
    nysc_year = nullif(p_details ->> 'nysc_year', '')::smallint,
    years_since_house_job = nullif(p_details ->> 'years_since_house_job', '')::numeric,
    specialties = coalesce(array(select jsonb_array_elements_text(coalesce(p_details -> 'specialties', '[]'::jsonb))), '{}'),
    languages = coalesce(array(select jsonb_array_elements_text(coalesce(p_details -> 'languages', '[]'::jsonb))), '{}'),
    referees = coalesce(p_details -> 'referees', '[]'::jsonb),
    conflicts_declared_at = case when (p_details -> 'conflicts_declaration') is null then null else coalesce(a.conflicts_declared_at, now()) end,
    conflicts_declaration = p_details -> 'conflicts_declaration',
    indemnity_insurer = nullif(btrim(p_details ->> 'indemnity_insurer'), ''),
    indemnity_policy_number = nullif(btrim(p_details ->> 'indemnity_policy_number'), ''),
    indemnity_expires_at = nullif(p_details ->> 'indemnity_expires_at', '')::timestamptz
  where id = p_application;
exception when unique_violation then
  raise exception 'that MDCN folio number is already in use on another application' using errcode = '23505';
end;
$$;

create function private.credential_required_doc_kinds(p_employment public.staff_employment_type)
returns public.clinician_document_kind[] language sql immutable set search_path = ''
as $$
  select array['mdcn_practising_licence', 'mdcn_portal_screenshot', 'graduation_certificate', 'nysc_certificate', 'government_id', 'cv']::public.clinician_document_kind[]
    || case when p_employment = 'contracted' then array['indemnity_certificate']::public.clinician_document_kind[] else '{}'::public.clinician_document_kind[] end;
$$;
revoke all on function private.credential_required_doc_kinds(public.staff_employment_type) from public, anon, authenticated;

create function private.application_has_doc(p_application uuid, p_kind public.clinician_document_kind) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.clinician_documents where application_id = p_application and kind = p_kind and superseded_at is null) $$;
revoke all on function private.application_has_doc(uuid, public.clinician_document_kind) from public, anon, authenticated;

create function private.application_missing(p_application uuid) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  v_missing text[] := '{}';
  k public.clinician_document_kind;
  r jsonb;
  v_ref_count int := coalesce((private.credential_rule('referees_required'))::int, 2);
begin
  select * into a from public.clinician_applications where id = p_application;
  foreach k in array private.credential_required_doc_kinds(a.employment_type) loop
    if not private.application_has_doc(p_application, k) then v_missing := array_append(v_missing, 'document:' || k::text); end if;
  end loop;
  if a.mdcn_folio is null then v_missing := array_append(v_missing, 'mdcn_folio'::text); end if;
  if a.qualification is null then v_missing := array_append(v_missing, 'qualification'::text); end if;
  if a.years_since_house_job is null then v_missing := array_append(v_missing, 'years_since_house_job'::text); end if;
  if coalesce(array_length(a.languages, 1), 0) = 0 then v_missing := array_append(v_missing, 'languages'::text); end if;
  if a.conflicts_declared_at is null then v_missing := array_append(v_missing, 'conflicts_declaration'::text); end if;
  if jsonb_typeof(a.referees) <> 'array' or jsonb_array_length(a.referees) < v_ref_count then
    v_missing := array_append(v_missing, 'referees'::text);
  else
    for r in select * from jsonb_array_elements(a.referees) loop
      if coalesce(btrim(r ->> 'name'), '') = '' or coalesce(btrim(r ->> 'institution'), '') = ''
         or (coalesce(btrim(r ->> 'phone'), '') = '' and coalesce(btrim(r ->> 'email'), '') = '') then
        v_missing := array_append(v_missing, 'referee_details'::text); exit;
      end if;
    end loop;
  end if;
  if a.employment_type = 'contracted' and (a.indemnity_insurer is null or a.indemnity_policy_number is null or a.indemnity_expires_at is null or a.indemnity_expires_at <= now()) then
    v_missing := array_append(v_missing, 'indemnity_details'::text);
  end if;
  return v_missing;
end;
$$;
revoke all on function private.application_missing(uuid) from public, anon, authenticated;

create function public.submit_clinician_application(p_application uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  v_missing text[];
  v_flag text;
begin
  select * into a from public.clinician_applications where id = p_application and profile_id = auth.uid() for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.state <> 'started' then raise exception 'application already submitted' using errcode = '23514'; end if;
  v_missing := private.application_missing(p_application);
  if array_length(v_missing, 1) > 0 then
    raise exception 'application incomplete: %', array_to_string(v_missing, ', ') using errcode = '23514';
  end if;
  select case
      when exists (select 1 from public.clinical_staff cs where cs.status <> 'offboarded' and cs.profile_id is distinct from a.profile_id
                   and upper(regexp_replace(cs.credential_number, '\s', '', 'g')) = upper(regexp_replace(a.mdcn_folio, '\s', '', 'g'))) then 'in_use'
      when exists (select 1 from public.clinician_applications o where o.id <> a.id and o.profile_id <> a.profile_id and o.state = 'rejected'
                   and upper(regexp_replace(o.mdcn_folio, '\s', '', 'g')) = upper(regexp_replace(a.mdcn_folio, '\s', '', 'g'))) then 'previously_rejected'
      when exists (select 1 from public.clinician_applications o where o.id <> a.id and o.profile_id <> a.profile_id and o.state in ('suspended', 'offboarded')
                   and upper(regexp_replace(o.mdcn_folio, '\s', '', 'g')) = upper(regexp_replace(a.mdcn_folio, '\s', '', 'g'))) then 'previously_suspended'
      else null end into v_flag;
  update public.clinician_applications set folio_flag = v_flag where id = p_application;
  perform private.apply_application_transition(p_application, 'documents_submitted', auth.uid(), 'application submitted');
  perform private.credential_notify_reviewers(a.organisation_id, 'New clinician application', 'A clinician application is ready for checks.',
    jsonb_build_object('application_id', a.id, 'folio_flag', v_flag));
end;
$$;

create function public.register_clinician_document(
  p_application uuid, p_kind public.clinician_document_kind, p_storage_path text, p_mime text,
  p_size bigint, p_sha256 text, p_expires_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  p public.profiles%rowtype;
  a public.clinician_applications%rowtype;
  s public.clinical_staff%rowtype;
  v_id uuid;
  v_max bigint := coalesce((private.credential_rule('document_max_bytes'))::bigint, 8388608);
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid;
  if p_storage_path not like p.organisation_id::text || '/' || v_uid::text || '/%' then
    raise exception 'document path is not in your own folder' using errcode = '42501';
  end if;
  if p_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then raise exception 'file type not allowed' using errcode = '23514'; end if;
  if p_size <= 0 or p_size > v_max then raise exception 'file is too large' using errcode = '23514'; end if;
  -- The file must really be in the private bucket, with the size and type declared. Nobody can upload there directly
  -- (no insert policy); the web route checks the first bytes, uploads with the service role, then registers.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'clinician-documents' and o.name = p_storage_path
                   and (o.metadata ->> 'size')::bigint = p_size and (o.metadata ->> 'mimetype') = p_mime) then
    raise exception 'the file was not found; please upload it again' using errcode = '23514';
  end if;
  if p_application is not null then
    select * into a from public.clinician_applications where id = p_application and profile_id = v_uid;
    if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
    if a.state not in ('started', 'documents_submitted', 'checks_in_progress') then raise exception 'documents can no longer be changed on this application' using errcode = '23514'; end if;
    update public.clinician_documents set superseded_at = now() where application_id = p_application and kind = p_kind and superseded_at is null;
    -- Replacing a document whose check already passed sends that check back to pending: the evidence changed, so the
    -- decision about it no longer stands (otherwise a verified file could be swapped for an unchecked one).
    update public.clinician_checks set result = 'pending', performed_by = null, performed_at = null, evidence_document_id = null
      where application_id = p_application and result = 'passed'
        and kind = case p_kind
          when 'mdcn_practising_licence' then 'licence'::public.credential_check_kind
          when 'mdcn_portal_screenshot' then 'licence'::public.credential_check_kind
          when 'graduation_certificate' then 'qualifications'::public.credential_check_kind
          when 'nysc_certificate' then 'qualifications'::public.credential_check_kind
          when 'government_id' then 'identity'::public.credential_check_kind
        end;
    insert into public.clinician_documents (organisation_id, owner_profile_id, application_id, kind, storage_path, mime_type, size_bytes, sha256, expires_at, is_test)
      values (p.organisation_id, v_uid, p_application, p_kind, p_storage_path, p_mime, p_size, p_sha256, p_expires_at, p.is_test) returning id into v_id;
  else
    select * into s from public.clinical_staff where profile_id = v_uid and status in ('active', 'suspended');
    if not found then raise exception 'no clinician record to attach this document to' using errcode = 'P0002'; end if;
    if p_kind not in ('mdcn_practising_licence', 'mdcn_portal_screenshot', 'indemnity_certificate') then raise exception 'only licence or indemnity renewals can be uploaded here' using errcode = '23514'; end if;
    update public.clinician_documents set superseded_at = now() where clinical_staff_id = s.id and application_id is null and kind = p_kind and superseded_at is null;
    insert into public.clinician_documents (organisation_id, owner_profile_id, clinical_staff_id, kind, storage_path, mime_type, size_bytes, sha256, expires_at, is_test)
      values (p.organisation_id, v_uid, s.id, p_kind, p_storage_path, p_mime, p_size, p_sha256, p_expires_at, p.is_test) returning id into v_id;
    perform private.credential_notify_reviewers(p.organisation_id, 'Renewal uploaded', 'A clinician uploaded a renewed credential for checking.',
      jsonb_build_object('clinical_staff_id', s.id, 'kind', p_kind));
  end if;
  perform private.credential_audit(p.organisation_id, v_uid, 'clinician_document.registered', 'clinician_document', v_id, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

-- Resolve a document for the web route: owner or reviewer only; every open is logged.
create function public.open_clinician_document(p_document uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  d public.clinician_documents%rowtype;
  v_uid uuid := auth.uid();
  v_owner boolean;
begin
  select * into d from public.clinician_documents where id = p_document;
  if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  v_owner := d.owner_profile_id = v_uid;
  if not v_owner and not private.can_credential_review() then raise exception 'document not found' using errcode = 'P0002'; end if;
  insert into public.clinician_document_access_log (organisation_id, document_id, actor_id, is_owner, is_test)
    values (d.organisation_id, d.id, v_uid, v_owner, d.is_test);
  return d.storage_path;
end;
$$;

create function public.verify_clinician_document(p_document uuid, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare d public.clinician_documents%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from public.clinician_documents where id = p_document;
  if not found then raise exception 'document not found' using errcode = 'P0002'; end if;
  if d.owner_profile_id = auth.uid() then raise exception 'you cannot verify your own document' using errcode = '42501'; end if;
  update public.clinician_documents set verified_by = auth.uid(), verified_at = now(), verification_note = p_note where id = p_document;
  perform private.credential_audit(d.organisation_id, auth.uid(), 'clinician_document.verified', 'clinician_document', d.id, jsonb_build_object('kind', d.kind));
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Reviewer functions: checks, reject
-- ---------------------------------------------------------------------------
create function public.begin_credential_checks(p_application uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.clinician_applications%rowtype; k public.credential_check_kind;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot review your own application' using errcode = '42501'; end if;
  perform private.apply_application_transition(p_application, 'checks_in_progress', auth.uid(), 'checks started');
  foreach k in array enum_range(null::public.credential_check_kind) loop
    insert into public.clinician_checks (organisation_id, application_id, kind, is_test) values (a.organisation_id, a.id, k, a.is_test)
      on conflict (application_id, kind) do nothing;
  end loop;
end;
$$;

create function public.record_credential_check(
  p_application uuid, p_kind public.credential_check_kind, p_result public.credential_check_result,
  p_notes text default null, p_details jsonb default '{}'::jsonb, p_licence_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  v_evidence uuid;
  v_min numeric := coalesce((private.credential_rule('min_practice_years'))::numeric, 2);
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot verify your own application' using errcode = '42501'; end if;
  if a.state <> 'checks_in_progress' then raise exception 'checks can only be recorded while checks are in progress' using errcode = '23514'; end if;
  if p_result = 'pending' then raise exception 'a check result must be passed or failed' using errcode = '23514'; end if;

  if p_result = 'passed' then
    case p_kind
      when 'licence' then
        if not (private.application_has_doc(a.id, 'mdcn_practising_licence') and private.application_has_doc(a.id, 'mdcn_portal_screenshot')) then
          raise exception 'the licence check needs the current MDCN licence and the portal screenshot' using errcode = '23514'; end if;
        if p_licence_expires_at is null or p_licence_expires_at <= now() then
          raise exception 'enter the licence expiry date printed on the current licence (it must be in the future)' using errcode = '23514'; end if;
        if a.folio_flag = 'in_use' then raise exception 'this MDCN folio number is held by another clinician' using errcode = '23514'; end if;
        select id into v_evidence from public.clinician_documents where application_id = a.id and kind = 'mdcn_practising_licence' and superseded_at is null;
        update public.clinician_applications set licence_expires_at = p_licence_expires_at where id = a.id;
      when 'qualifications' then
        if not (private.application_has_doc(a.id, 'graduation_certificate') and private.application_has_doc(a.id, 'nysc_certificate')) then
          raise exception 'the qualifications check needs the graduation certificate and the NYSC certificate' using errcode = '23514'; end if;
        select id into v_evidence from public.clinician_documents where application_id = a.id and kind = 'graduation_certificate' and superseded_at is null;
      when 'identity' then
        if not private.application_has_doc(a.id, 'government_id') then raise exception 'the identity check needs a government ID' using errcode = '23514'; end if;
        select id into v_evidence from public.clinician_documents where application_id = a.id and kind = 'government_id' and superseded_at is null;
      when 'practice_years' then
        if a.years_since_house_job is null or a.years_since_house_job < v_min then
          raise exception 'practice after house job is below the minimum of % years', v_min using errcode = '23514'; end if;
      else
        if coalesce((p_details ->> 'confirmed_back')::boolean, false) is not true then
          raise exception 'a referee check passes only after the referee has confirmed the reference back' using errcode = '23514'; end if;
        if coalesce((private.credential_rule('referee_independent_contact'))::boolean, true)
           and coalesce(p_details ->> 'contact_source', '') <> 'independent_institution' then
          raise exception 'reach the referee through an independently sourced institutional contact' using errcode = '23514'; end if;
    end case;
  end if;

  update public.clinician_checks set result = p_result, performed_by = auth.uid(), performed_at = now(),
         evidence_document_id = coalesce(v_evidence, evidence_document_id), notes = p_notes, details = coalesce(p_details, '{}'::jsonb)
    where application_id = a.id and kind = p_kind;
  if not found then raise exception 'checks have not been started for this application' using errcode = '23514'; end if;
  if p_result = 'passed' and v_evidence is not null then
    update public.clinician_documents set verified_by = auth.uid(), verified_at = now() where id = v_evidence and verified_at is null;
  end if;
  perform private.credential_audit(a.organisation_id, auth.uid(), 'clinician_check.' || p_result::text, 'clinician_application', a.id, jsonb_build_object('kind', p_kind));

  if not exists (select 1 from public.clinician_checks where application_id = a.id and result <> 'passed') then
    perform private.apply_application_transition(a.id, 'training', null, 'all checks passed');
  end if;
end;
$$;

-- Employed or freelance is the organisation's fact about the person, never the applicant's claim: it decides
-- whether individual indemnity is needed and which earnings path S30 uses. Reviewer sets it before approval.
create function public.set_application_employment_type(p_application uuid, p_employment_type public.staff_employment_type)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.clinician_applications%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot change your own application' using errcode = '42501'; end if;
  if a.state in ('approved_tier1', 'active', 'suspended', 'offboarded', 'rejected') then
    raise exception 'employment type can no longer be changed' using errcode = '23514'; end if;
  update public.clinician_applications set employment_type = p_employment_type where id = p_application;
  perform private.credential_audit(a.organisation_id, auth.uid(), 'clinician_application.employment_type', 'clinician_application', a.id,
    jsonb_build_object('employment_type', p_employment_type));
end;
$$;

create function public.reject_clinician_application(p_application uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.clinician_applications%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into a from public.clinician_applications where id = p_application;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot decide your own application' using errcode = '42501'; end if;
  perform private.apply_application_transition(p_application, 'rejected', auth.uid(), p_reason);
  -- Approval created a clinician record (switched off, never active). A rejected application must not leave it behind:
  -- it would hold the folio and block the person from applying again.
  if a.clinical_staff_id is not null then
    delete from public.clinical_staff where id = a.clinical_staff_id and not active and status = 'active';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Training and test
-- ---------------------------------------------------------------------------
create function public.complete_training_module(p_application uuid, p_module uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.clinician_applications%rowtype;
begin
  select * into a from public.clinician_applications where id = p_application and profile_id = auth.uid();
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.state <> 'training' then raise exception 'training opens once your checks are complete' using errcode = '23514'; end if;
  if not exists (select 1 from public.training_modules where id = p_module and status = 'approved' and organisation_id = a.organisation_id) then
    raise exception 'training module not available' using errcode = 'P0002'; end if;
  insert into public.training_progress (organisation_id, application_id, module_id, is_test) values (a.organisation_id, a.id, p_module, a.is_test)
    on conflict (application_id, module_id) do nothing;
end;
$$;

create function private.training_complete(p_application uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.training_modules m join public.clinician_applications a on a.id = p_application and a.organisation_id = m.organisation_id
    where m.status = 'approved'
      and not exists (select 1 from public.training_progress tp where tp.application_id = p_application and tp.module_id = m.id));
$$;
revoke all on function private.training_complete(uuid) from public, anon, authenticated;

-- Starts (or resumes) an attempt and returns the scenarios WITHOUT the answer key.
create function public.start_credential_test(p_application uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  v_open public.credential_test_attempts%rowtype;
  v_used int;
  v_max int := coalesce((private.credential_rule('test_max_attempts'))::int, 3);
  v_cooldown int := coalesce((private.credential_rule('test_retake_cooldown_hours'))::int, 24);
  v_per int := coalesce((private.credential_rule('test_scenarios_per_attempt'))::int, 10);
  v_last timestamptz;
  v_ids uuid[];
  v_red uuid[];
  v_n int;
  v_attempt uuid;
begin
  select * into a from public.clinician_applications where id = p_application and profile_id = auth.uid() for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.state <> 'training' then raise exception 'the test opens after checks and training' using errcode = '23514'; end if;
  if not private.training_complete(a.id) then raise exception 'finish every training module before the test' using errcode = '23514'; end if;

  select * into v_open from public.credential_test_attempts where application_id = a.id and submitted_at is null;
  if not found then
    select count(*), max(submitted_at) into v_used, v_last from public.credential_test_attempts where application_id = a.id;
    if v_used >= v_max + a.test_extra_attempts then
      raise exception 'you have used all your attempts; your care team lead will review and may allow another' using errcode = '23514'; end if;
    if v_last is not null and v_last + make_interval(hours => v_cooldown) > now() then
      raise exception 'please wait before trying again' using errcode = '23514'; end if;
    select coalesce(array_agg(id), '{}') into v_red from public.credential_test_cases
      where organisation_id = a.organisation_id and status = 'approved' and is_red;
    v_n := greatest(v_per - coalesce(array_length(v_red, 1), 0), 0);
    select coalesce(array_agg(id), '{}') into v_ids from (
      select c.id from public.credential_test_cases c
      where c.organisation_id = a.organisation_id and c.status = 'approved' and not c.is_red
      order by (c.id = any (select unnest(t.case_ids) from public.credential_test_attempts t where t.application_id = a.id)), random()
      limit v_n) q;
    v_ids := v_red || v_ids;
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      raise exception 'the test content has not been approved yet; your care team lead will let you know' using errcode = '23514'; end if;
    insert into public.credential_test_attempts (organisation_id, application_id, attempt_number, case_ids, is_test)
      values (a.organisation_id, a.id, v_used + 1, v_ids, a.is_test) returning * into v_open;
  end if;
  return jsonb_build_object('attempt_id', v_open.id, 'attempt_number', v_open.attempt_number,
    'cases', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'scenario', c.scenario, 'options', c.options) order by random()), '[]'::jsonb)
              from public.credential_test_cases c where c.id = any (v_open.case_ids)));
end;
$$;

create function public.submit_credential_test(p_attempt uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  t public.credential_test_attempts%rowtype;
  a public.clinician_applications%rowtype;
  c record;
  v_total int := 0; v_correct int := 0; v_red_total int := 0; v_red_correct int := 0;
  v_misses jsonb := '[]'::jsonb;
  v_score numeric; v_passed boolean;
  v_pass numeric := coalesce((private.credential_rule('pass_percent'))::numeric, 80);
  v_all_red boolean := coalesce((private.credential_rule('all_red_correct'))::boolean, true);
  v_max int := coalesce((private.credential_rule('test_max_attempts'))::int, 3);
  v_used int;
begin
  select * into t from public.credential_test_attempts where id = p_attempt for update;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  select * into a from public.clinician_applications where id = t.application_id and profile_id = auth.uid();
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  if t.submitted_at is not null then raise exception 'this attempt was already submitted' using errcode = '23514'; end if;
  for c in select * from public.credential_test_cases where id = any (t.case_ids) loop
    v_total := v_total + 1;
    if c.is_red then v_red_total := v_red_total + 1; end if;
    if (p_answers ->> c.id::text) is not distinct from c.correct_option_id then
      v_correct := v_correct + 1;
      if c.is_red then v_red_correct := v_red_correct + 1; end if;
    elsif c.is_red then
      v_misses := v_misses || jsonb_build_object('case_id', c.id, 'chosen', p_answers ->> c.id::text);
    end if;
  end loop;
  v_score := case when v_total = 0 then 0 else round(100.0 * v_correct / v_total, 2) end;
  v_passed := v_total > 0 and v_score >= v_pass and (not v_all_red or v_red_correct = v_red_total);
  update public.credential_test_attempts set answers = p_answers, score_percent = v_score, red_total = v_red_total,
    red_correct = v_red_correct, red_misses = v_misses, passed = v_passed, submitted_at = now() where id = p_attempt;
  perform private.credential_audit(a.organisation_id, auth.uid(), 'credential_test.submitted', 'clinician_application', a.id,
    jsonb_build_object('attempt', t.attempt_number, 'score', v_score, 'passed', v_passed, 'red_misses', jsonb_array_length(v_misses)));
  if v_passed and a.state = 'training' then
    perform private.apply_application_transition(a.id, 'test_passed', null, 'test passed');
  end if;
  select count(*) into v_used from public.credential_test_attempts where application_id = a.id;
  if not v_passed and v_used >= v_max + a.test_extra_attempts then
    perform private.credential_notify_reviewers(a.organisation_id, 'Clinician test attempts used', 'An applicant used all test attempts and needs a review.', jsonb_build_object('application_id', a.id));
  end if;
  return jsonb_build_object('passed', v_passed, 'score_percent', v_score, 'safety_critical_missed', v_red_total - v_red_correct,
    'attempts_left', greatest(v_max + a.test_extra_attempts - v_used, 0));
end;
$$;

create function public.grant_test_retake(p_application uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.clinician_applications%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can allow another attempt' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into a from public.clinician_applications where id = p_application;
  if not found or a.state <> 'training' then raise exception 'application is not in training' using errcode = '23514'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot decide your own application' using errcode = '42501'; end if;
  update public.clinician_applications set test_extra_attempts = test_extra_attempts + 1 where id = p_application;
  perform private.credential_audit(a.organisation_id, auth.uid(), 'credential_test.retake_granted', 'clinician_application', a.id, jsonb_build_object('reason', p_reason));
end;
$$;

-- Content authoring and sign-off: the chief medical officer's act, never the agent's.
create function public.save_credential_test_case(
  p_id uuid, p_code text, p_scenario text, p_options jsonb, p_correct_option_id text, p_is_red boolean, p_rationale text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_id uuid;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can write test content' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 2
     or not exists (select 1 from jsonb_array_elements(p_options) o where o ->> 'id' = p_correct_option_id) then
    raise exception 'give at least two options and mark one of them correct' using errcode = '23514'; end if;
  if p_id is null then
    insert into public.credential_test_cases (organisation_id, code, scenario, options, correct_option_id, is_red, rationale)
      values (v_org, p_code, p_scenario, p_options, p_correct_option_id, coalesce(p_is_red, false), coalesce(p_rationale, '')) returning id into v_id;
  else
    update public.credential_test_cases set scenario = p_scenario, options = p_options, correct_option_id = p_correct_option_id,
      is_red = coalesce(p_is_red, false), rationale = coalesce(p_rationale, ''), status = 'draft', approved_by = null, approved_at = null
      where id = p_id and organisation_id = v_org returning id into v_id;
    if v_id is null then raise exception 'test case not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create function public.approve_credential_content(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can approve content' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  if p_kind = 'test_case' then
    update public.credential_test_cases set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id and organisation_id = v_org;
  elsif p_kind = 'training_module' then
    update public.training_modules set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id and organisation_id = v_org;
  else
    raise exception 'unknown content kind' using errcode = '23514';
  end if;
  if not found then raise exception 'content not found' using errcode = 'P0002'; end if;
  perform private.credential_audit(v_org, auth.uid(), 'credential_content.approved', p_kind, p_id, '{}'::jsonb);
end;
$$;

create function public.save_training_module(p_id uuid, p_code text, p_title text, p_summary text, p_content jsonb, p_minutes integer)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_id uuid;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can write training content' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  if p_id is null then
    insert into public.training_modules (organisation_id, code, title, summary, content, estimated_minutes)
      values (v_org, p_code, p_title, coalesce(p_summary, ''), coalesce(p_content, '[]'::jsonb), coalesce(p_minutes, 10)) returning id into v_id;
  else
    update public.training_modules set title = p_title, summary = coalesce(p_summary, ''), content = coalesce(p_content, '[]'::jsonb),
      estimated_minutes = coalesce(p_minutes, 10), status = 'draft', approved_by = null, approved_at = null
      where id = p_id and organisation_id = v_org returning id into v_id;
    if v_id is null then raise exception 'module not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Approval and activation
-- ---------------------------------------------------------------------------
create function public.approve_clinician_application(p_application uuid, p_level smallint default null, p_competencies text[] default '{}')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  prof public.profiles%rowtype;
  v_level smallint;
  v_licence_check public.clinician_checks%rowtype;
  v_staff uuid;
  v_code text;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can approve a clinician' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot approve your own application' using errcode = '42501'; end if;
  if a.state <> 'test_passed' then raise exception 'the application must be at test passed to approve (it is %)', a.state using errcode = '23514'; end if;
  select * into v_licence_check from public.clinician_checks where application_id = a.id and kind = 'licence';
  if coalesce((private.credential_rule('separate_verifier_and_approver'))::boolean, true)
     and exists (select 1 from public.clinician_checks where application_id = a.id and performed_by = auth.uid()) then
    raise exception 'the person who verified a check cannot also approve; ask another reviewer' using errcode = '42501'; end if;
  if a.licence_expires_at is null or a.licence_expires_at <= now() then raise exception 'the licence on file has expired' using errcode = '23514'; end if;
  if exists (select 1 from public.clinical_staff where profile_id = a.profile_id) then raise exception 'this account already has a clinician record' using errcode = '23514'; end if;
  v_level := coalesce(p_level, case when a.employment_type = 'employed' then 2 else 1 end);
  if v_level not in (1, 2) then raise exception 'level must be 1 or 2' using errcode = '23514'; end if;
  foreach v_code in array coalesce(p_competencies, '{}') loop
    if not exists (select 1 from public.competencies c where c.code = v_code and c.is_active and c.requires_level <= v_level) then
      raise exception 'competency % is not available at level %', v_code, v_level using errcode = '23514'; end if;
  end loop;
  select * into prof from public.profiles where id = a.profile_id;
  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, credential_type, credential_number, specialty, active, status,
    license_verified_at, verified_by, credential_verified_at, credential_verified_by, license_expires_at,
    doctor_tier, employment_type, credentialing_level, languages, years_of_experience,
    indemnity_insurer, indemnity_policy_number, indemnity_expires_at, is_test)
  values (
    a.organisation_id, a.profile_id, coalesce(nullif(btrim(prof.full_name), ''), 'Clinician'), 'MDCN', a.mdcn_folio,
    nullif(array_to_string(a.specialties, ', '), ''), false, 'active',
    v_licence_check.performed_at, v_licence_check.performed_by, v_licence_check.performed_at, v_licence_check.performed_by, a.licence_expires_at,
    'senior_medical_officer', a.employment_type, v_level, a.languages, least(floor(a.years_since_house_job), 80)::smallint,
    a.indemnity_insurer, a.indemnity_policy_number, a.indemnity_expires_at,
    -- private.guard_is_test_flag() lets only an admin or a service context set the flag; the CMO approving
    -- a QA applicant gets a real-flag row, and an admin flips it (documented in docs/design/S15.md).
    coalesce(a.is_test and private.is_admin(), false))
  returning id into v_staff;
  update public.clinician_applications set approved_by = auth.uid(), approved_at = now(), clinical_staff_id = v_staff where id = a.id;
  foreach v_code in array coalesce(p_competencies, '{}') loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
      values (a.organisation_id, v_staff, v_code, auth.uid(), a.is_test);
  end loop;
  perform private.apply_application_transition(a.id, 'approved_tier1', auth.uid(), 'approved at level ' || v_level);
  return v_staff;
end;
$$;

create function public.activate_clinician(p_application uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare a public.clinician_applications%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot activate yourself' using errcode = '42501'; end if;
  if a.state <> 'approved_tier1' or a.clinical_staff_id is null then raise exception 'only an approved application can be activated' using errcode = '23514'; end if;
  update public.clinical_staff set active = true where id = a.clinical_staff_id;  -- the indemnity gate runs here
  update public.profiles set role = 'clinician' where id = a.profile_id and role = 'patient';
  perform private.apply_application_transition(a.id, 'active', auth.uid(), 'activated');
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Eligibility, suspension, reinstatement, offboarding
-- ---------------------------------------------------------------------------
create function private.credential_in_grace(p_staff uuid, p_kind text, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.credential_grace_periods g where g.clinical_staff_id = p_staff and g.kind = p_kind and g.revoked_at is null and g.starts_at <= p_at and g.ends_at > p_at) $$;
revoke all on function private.credential_in_grace(uuid, text, timestamptz) from public, anon, authenticated;

-- Mirrors private.enforce_clinical_staff_indemnity(): who needs individual indemnity, honouring exemptions.
create function private.indemnity_required(p_staff uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (cs.doctor_tier = 'chief_medical_officer' or (cs.doctor_tier = 'senior_medical_officer' and cs.employment_type = 'contracted'))
     and not cs.indemnity_exempt
     and not exists (select 1 from public.clinical_staff_indemnity_exemptions e
                     where e.organisation_id = cs.organisation_id and (e.doctor_tier is null or e.doctor_tier = cs.doctor_tier))
  from public.clinical_staff cs where cs.id = p_staff;
$$;
revoke all on function private.indemnity_required(uuid) from public, anon, authenticated;

-- A licence stays valid to the end of its printed expiry day, Lagos time.
create function private.credential_valid_on(p_expires timestamptz, p_at timestamptz default now()) returns boolean
language sql immutable set search_path = ''
as $$ select (p_expires at time zone 'Africa/Lagos')::date >= (p_at at time zone 'Africa/Lagos')::date $$;
revoke all on function private.credential_valid_on(timestamptz, timestamptz) from public, anon, authenticated;

-- The one function later sessions call before offering a clinician a task, page or rota slot.
-- A missing licence date means "not yet tracked" (the two pre-existing live rows) and is eligible.
create function private.clinician_is_eligible(p_profile uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff cs
    where cs.profile_id = p_profile and cs.active and cs.status = 'active'
      -- the older quality ladder (20260829093830) can also restrict work; never loosen it
      and not private.provider_work_restricted(cs.id)
      and (cs.license_expires_at is null or private.credential_valid_on(cs.license_expires_at, p_at) or private.credential_in_grace(cs.id, 'licence', p_at))
      and (not coalesce(private.indemnity_required(cs.id), false)
           or (cs.indemnity_expires_at is not null and cs.indemnity_expires_at > p_at)
           or private.credential_in_grace(cs.id, 'indemnity', p_at))
  );
$$;
-- Server-side callers only (S16 to S19 call it from their own functions): not executable by signed-in users, so nobody can
-- probe whether an arbitrary profile id is a working clinician. The screens read eligibility through definer functions.
revoke all on function private.clinician_is_eligible(uuid, timestamptz) from public, anon, authenticated;

create function private.suspend_clinician_internal(p_staff uuid, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_app uuid;
begin
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found or s.status <> 'active' then return; end if;
  update public.clinical_staff set status = 'suspended', active = false, suspended_at = now(), suspended_reason = p_reason where id = p_staff;
  if s.profile_id is not null then
    update public.profiles set role = 'patient' where id = s.profile_id and role = 'clinician';
  end if;
  select id into v_app from public.clinician_applications where clinical_staff_id = p_staff and state = 'active';
  if v_app is not null then perform private.apply_application_transition(v_app, 'suspended', p_actor, p_reason); end if;
  perform private.credential_audit(s.organisation_id, p_actor, 'clinical_staff.suspended', 'clinical_staff', s.id, jsonb_build_object('reason', p_reason));
  perform private.emit_domain_event('clinician.suspended', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id),
    'clinician.suspended:' || s.id || ':' || extract(epoch from clock_timestamp())::text);
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'Your access is paused',
      'Your clinician access is paused: ' || p_reason || ' Upload your renewed documents under Join as a clinician and your care team lead will reinstate you once they are checked.',
      jsonb_build_object('clinical_staff_id', s.id, 'audience', 'applicant'), true);
  end if;
  perform private.credential_notify_reviewers(s.organisation_id, 'Clinician suspended', s.full_name || ' was suspended: ' || p_reason,
    jsonb_build_object('clinical_staff_id', s.id));
end;
$$;
revoke all on function private.suspend_clinician_internal(uuid, text, uuid) from public, anon, authenticated;

create function public.suspend_clinician(p_staff uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot suspend yourself' using errcode = '42501'; end if;
  perform private.suspend_clinician_internal(p_staff, p_reason, auth.uid());
end;
$$;

create function public.reinstate_clinician(p_staff uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_app uuid;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found or s.status <> 'suspended' then raise exception 'only a suspended clinician can be reinstated' using errcode = '23514'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot reinstate yourself' using errcode = '42501'; end if;
  if s.license_expires_at is not null and not (private.credential_valid_on(s.license_expires_at) or private.credential_in_grace(s.id, 'licence')) then
    raise exception 'record the renewed licence first' using errcode = '23514'; end if;
  if coalesce(private.indemnity_required(s.id), false) and not ((s.indemnity_expires_at is not null and s.indemnity_expires_at > now()) or private.credential_in_grace(s.id, 'indemnity')) then
    raise exception 'record the renewed indemnity first' using errcode = '23514'; end if;
  update public.clinical_staff set status = 'active', active = true, suspended_at = null, suspended_reason = null where id = p_staff;
  if s.profile_id is not null then update public.profiles set role = 'clinician' where id = s.profile_id and role = 'patient'; end if;
  select id into v_app from public.clinician_applications where clinical_staff_id = p_staff and state = 'suspended';
  if v_app is not null then perform private.apply_application_transition(v_app, 'active', auth.uid(), p_reason); end if;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.reinstated', 'clinical_staff', s.id, jsonb_build_object('reason', p_reason));
  perform private.emit_domain_event('clinician.reinstated', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id),
    'clinician.reinstated:' || s.id || ':' || extract(epoch from clock_timestamp())::text);
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'You are active again', 'Your clinician access is back on.', jsonb_build_object('clinical_staff_id', s.id), true);
  end if;
end;
$$;

create function public.offboard_clinician(p_staff uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_app uuid; v_years int := coalesce((private.credential_rule('document_retention_years_after_offboarding'))::int, 7);
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found or s.status = 'offboarded' then raise exception 'clinician not found or already offboarded' using errcode = '23514'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot offboard yourself' using errcode = '42501'; end if;
  update public.clinical_staff set status = 'offboarded', active = false where id = p_staff;
  if s.profile_id is not null then update public.profiles set role = 'patient' where id = s.profile_id and role = 'clinician'; end if;
  select id into v_app from public.clinician_applications where clinical_staff_id = p_staff and state in ('active', 'suspended');
  if v_app is not null then perform private.apply_application_transition(v_app, 'offboarded', auth.uid(), p_reason); end if;
  update public.clinician_documents set retain_until = (current_date + make_interval(years => v_years))::date
    where (clinical_staff_id = p_staff or owner_profile_id = s.profile_id) and retain_until is null;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.offboarded', 'clinical_staff', s.id, jsonb_build_object('reason', p_reason));
  perform private.emit_domain_event('clinician.suspended', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id, 'offboarded', true),
    'clinician.offboarded:' || s.id || ':' || extract(epoch from clock_timestamp())::text);
end;
$$;

create function public.renew_clinician_credential(p_staff uuid, p_kind text, p_expires_at timestamptz, p_document uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; d public.clinician_documents%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot verify your own renewal' using errcode = '42501'; end if;
  select * into d from public.clinician_documents where id = p_document and owner_profile_id = s.profile_id and superseded_at is null;
  if not found then raise exception 'renewal document not found' using errcode = 'P0002'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'the new expiry must be in the future' using errcode = '23514'; end if;
  if p_kind = 'licence' then
    if d.kind <> 'mdcn_practising_licence' then raise exception 'attach the licence document' using errcode = '23514'; end if;
    update public.clinical_staff set license_expires_at = p_expires_at, license_verified_at = now(), verified_by = auth.uid(),
      credential_verified_at = now(), credential_verified_by = auth.uid() where id = p_staff;
  elsif p_kind = 'indemnity' then
    if d.kind <> 'indemnity_certificate' then raise exception 'attach the indemnity certificate' using errcode = '23514'; end if;
    update public.clinical_staff set indemnity_expires_at = p_expires_at where id = p_staff;
  else
    raise exception 'unknown credential kind' using errcode = '23514';
  end if;
  update public.clinician_documents set verified_by = auth.uid(), verified_at = now(), expires_at = p_expires_at where id = p_document;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.credential_renewed', 'clinical_staff', s.id, jsonb_build_object('kind', p_kind, 'expires_at', p_expires_at));
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'Renewal recorded', 'Your renewed ' || p_kind || ' was recorded. Thank you.', jsonb_build_object('clinical_staff_id', s.id), false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Competencies, level, grace
-- ---------------------------------------------------------------------------
create function public.grant_clinician_competency(p_staff uuid, p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; c public.competencies%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can grant a competency' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot grant your own competencies' using errcode = '42501'; end if;
  select * into c from public.competencies where code = p_code and is_active;
  if not found then raise exception 'unknown competency' using errcode = 'P0002'; end if;
  if c.requires_level > coalesce(s.credentialing_level, 0) then raise exception '% needs credentialing level %', p_code, c.requires_level using errcode = '23514'; end if;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
    values (s.organisation_id, p_staff, p_code, auth.uid(), s.is_test) on conflict do nothing;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinician_competency.granted', 'clinical_staff', s.id, jsonb_build_object('code', p_code));
  perform private.emit_domain_event('clinician.competency_changed', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id, 'code', p_code, 'change', 'granted'),
    'clinician.competency_changed:' || s.id || ':' || p_code || ':granted:' || extract(epoch from clock_timestamp())::text);
end;
$$;

create function public.revoke_clinician_competency(p_staff uuid, p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can revoke a competency' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  update public.clinician_competencies set revoked_at = now(), revoked_by = auth.uid()
    where clinical_staff_id = p_staff and competency_code = p_code and revoked_at is null;
  if not found then return; end if;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinician_competency.revoked', 'clinical_staff', s.id, jsonb_build_object('code', p_code));
  perform private.emit_domain_event('clinician.competency_changed', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id, 'code', p_code, 'change', 'revoked'),
    'clinician.competency_changed:' || s.id || ':' || p_code || ':revoked:' || extract(epoch from clock_timestamp())::text);
end;
$$;

create function public.set_clinician_level(p_staff uuid, p_level smallint, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can change a level' using errcode = '42501'; end if;
  if p_level not in (1, 2) then raise exception 'level must be 1 or 2' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot change your own level' using errcode = '42501'; end if;
  update public.clinical_staff set credentialing_level = p_level where id = p_staff;
  if p_level = 1 then
    update public.clinician_competencies cc set revoked_at = now(), revoked_by = auth.uid()
      where cc.clinical_staff_id = p_staff and cc.revoked_at is null
        and cc.competency_code in (select code from public.competencies where requires_level = 2);
  end if;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.level_changed', 'clinical_staff', s.id, jsonb_build_object('level', p_level, 'reason', p_reason));
  perform private.emit_domain_event('clinician.competency_changed', s.organisation_id, jsonb_build_object('clinical_staff_id', s.id, 'level', p_level),
    'clinician.level_changed:' || s.id || ':' || extract(epoch from clock_timestamp())::text);
end;
$$;

create function public.grant_credential_grace(p_staff uuid, p_kind text, p_days integer, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_max int := coalesce((private.credential_rule('grace_max_days'))::int, 14); v_id uuid;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('licence', 'indemnity') then raise exception 'unknown credential kind' using errcode = '23514'; end if;
  if p_days is null or p_days < 1 or p_days > v_max then raise exception 'a grace period is between 1 and % days', v_max using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = '23514'; end if;
  select * into s from public.clinical_staff where id = p_staff;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot grant yourself a grace period' using errcode = '42501'; end if;
  insert into public.credential_grace_periods (organisation_id, clinical_staff_id, kind, ends_at, reason, granted_by, is_test)
    values (s.organisation_id, p_staff, p_kind, now() + make_interval(days => p_days), p_reason, auth.uid(), s.is_test) returning id into v_id;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'credential_grace.granted', 'clinical_staff', s.id, jsonb_build_object('kind', p_kind, 'days', p_days, 'reason', p_reason));
  if s.profile_id is not null then
    perform private.credential_notify(s.profile_id, s.organisation_id, 'A short grace period was recorded',
      format('A grace period of %s days was recorded for your %s. Please upload your renewed document before it ends.', p_days, p_kind),
      jsonb_build_object('clinical_staff_id', s.id), true);
  end if;
  return v_id;
end;
$$;

create function public.revoke_credential_grace(p_grace uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare g public.credential_grace_periods%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.credential_grace_periods set revoked_at = now(), revoked_by = auth.uid() where id = p_grace and revoked_at is null returning * into g;
  if not found then raise exception 'grace period not found' using errcode = 'P0002'; end if;
  perform private.credential_audit(g.organisation_id, auth.uid(), 'credential_grace.revoked', 'clinical_staff', g.clinical_staff_id, jsonb_build_object('kind', g.kind));
end;
$$;

-- What a clinician sees about themselves, including anything stopping them taking cases.
create function public.my_credential_status()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_blockers text[] := '{}';
begin
  select * into s from public.clinical_staff where profile_id = auth.uid();
  if not found then return null; end if;
  if s.status <> 'active' then v_blockers := array_append(v_blockers, 'status:' || s.status::text); end if;
  if not s.active and s.status = 'active' then v_blockers := array_append(v_blockers, 'not_yet_activated'::text); end if;
  if s.license_expires_at is not null and not (private.credential_valid_on(s.license_expires_at) or private.credential_in_grace(s.id, 'licence')) then v_blockers := array_append(v_blockers, 'licence_expired'::text); end if;
  if coalesce(private.indemnity_required(s.id), false) and not ((s.indemnity_expires_at is not null and s.indemnity_expires_at > now()) or private.credential_in_grace(s.id, 'indemnity')) then v_blockers := array_append(v_blockers, 'indemnity_expired'::text); end if;
  return jsonb_build_object(
    'clinical_staff_id', s.id, 'status', s.status, 'active', s.active, 'level', s.credentialing_level,
    'licence_expires_at', s.license_expires_at, 'indemnity_expires_at', s.indemnity_expires_at,
    'indemnity_required', coalesce(private.indemnity_required(s.id), false),
    'licence_in_grace', private.credential_in_grace(s.id, 'licence'), 'indemnity_in_grace', private.credential_in_grace(s.id, 'indemnity'),
    'audited_task_count', s.audited_task_count, 'audit_required_count', coalesce((private.credential_rule('audited_task_count'))::int, 20),
    'eligible', private.clinician_is_eligible(s.profile_id), 'blockers', to_jsonb(v_blockers),
    'competencies', (select coalesce(jsonb_agg(competency_code order by competency_code), '[]'::jsonb) from public.clinician_competencies where clinical_staff_id = s.id and revoked_at is null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Nightly expiry sweep: notices at the configured windows (90, 30 and 0 days),
--     then suspension of anyone past expiry with no grace and no exemption.
-- ---------------------------------------------------------------------------
create function private.credential_expiry_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_kind text;
  v_exp timestamptz;
  v_days int;
  v_windows int[] := coalesce(array(select jsonb_array_elements_text(private.credential_rule('notice_windows_days'))::int), array[90, 30, 0]);
  v_w int;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_rows int := 0; v_suspended int := 0; v_missing int := 0; v_errors int := 0;
  v_label text; v_msg text; v_inserted boolean;
begin
  for r in select cs.* from public.clinical_staff cs where cs.active and cs.status = 'active' and cs.profile_id is not null loop
    begin
      foreach v_kind in array array['licence', 'indemnity'] loop
        if v_kind = 'indemnity' and not coalesce(private.indemnity_required(r.id), false) then continue; end if;
        v_exp := case when v_kind = 'licence' then r.license_expires_at else r.indemnity_expires_at end;
        if v_exp is null then v_missing := v_missing + 1; continue; end if;
        v_days := (v_exp at time zone 'Africa/Lagos')::date - v_today;
        v_label := case when v_kind = 'licence' then 'MDCN practising licence' else 'professional indemnity cover' end;

        if v_days >= 0 then
          select min(w) into v_w from unnest(v_windows) w where w >= v_days;
          if v_w is not null then
            -- quietly mark the wider windows as passed so a late sweep sends one notice, not a burst
            insert into public.credential_expiry_notices (organisation_id, clinical_staff_id, kind, expires_on, window_days, was_sent)
              select r.organisation_id, r.id, v_kind, (v_exp at time zone 'Africa/Lagos')::date, w, false from unnest(v_windows) w where w > v_w
              on conflict do nothing;
            insert into public.credential_expiry_notices (organisation_id, clinical_staff_id, kind, expires_on, window_days)
              values (r.organisation_id, r.id, v_kind, (v_exp at time zone 'Africa/Lagos')::date, v_w) on conflict do nothing;
            get diagnostics v_rows = row_count;  -- 1 when this window's notice is new
            v_inserted := v_rows > 0;
            if v_inserted then
              v_msg := case
                when v_days = 0 then format('Your %s expires today. Upload your renewed document under Training and profile now, so your access is not paused.', v_label)
                when v_days <= 31 then format('Your %s expires on %s, in %s days. Please upload your renewed document under Training and profile.', v_label, to_char(v_exp at time zone 'Africa/Lagos', 'DD Mon YYYY'), v_days)
                else format('Your %s expires on %s. Please plan your renewal and upload it under Training and profile.', v_label, to_char(v_exp at time zone 'Africa/Lagos', 'DD Mon YYYY')) end;
              perform private.credential_notify(r.profile_id, r.organisation_id, 'Your ' || v_label || case when v_days = 0 then ' expires today' else ' is due for renewal' end, v_msg,
                jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind, 'days_left', v_days), true);
              if v_w <= 30 then
                perform private.credential_notify_reviewers(r.organisation_id, 'Clinician credential expiring',
                  format('%s: %s expires on %s (%s days).', r.full_name, v_label, to_char(v_exp at time zone 'Africa/Lagos', 'DD Mon YYYY'), v_days),
                  jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind));
              end if;
              perform private.emit_domain_event('clinician.credential_expiring', r.organisation_id,
                jsonb_build_object('clinical_staff_id', r.id, 'kind', v_kind, 'days_left', v_days),
                'clinician.credential_expiring:' || r.id || ':' || v_kind || ':' || v_exp::date || ':' || v_w);
            end if;
          end if;
        elsif not private.credential_in_grace(r.id, v_kind) then
          perform private.suspend_clinician_internal(r.id,
            format('Your %s expired on %s.', v_label, to_char(v_exp at time zone 'Africa/Lagos', 'DD Mon YYYY')), null);
          v_suspended := v_suspended + 1;
          exit;
        end if;
      end loop;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'credential_expiry_sweep failed for clinician %: %', r.id, sqlerrm;
      perform private.credential_audit(r.organisation_id, null, 'credential_sweep.error', 'clinical_staff', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'credential_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'Credential expiry sweep failed for some clinicians',
            format('%s clinician(s) could not be processed by private.credential_expiry_sweep(); see audit_log action credential_sweep.error. Expiry notices or suspensions for them may be missing.', v_errors),
            'credential_sweep', now(), now());
  end if;
  return jsonb_build_object('suspended', v_suspended, 'missing_dates', v_missing, 'errors', v_errors);
end;
$$;
revoke all on function private.credential_expiry_sweep() from public, anon, authenticated;

-- This sweep supersedes the two notify-only admin sweeps (same dates, admins only, 30 days).
-- The functions stay; only their schedules are retired so admins are not told twice.
do $$
begin
  perform cron.unschedule('clinical-staff-license-lapse-notify') where exists (select 1 from cron.job where jobname = 'clinical-staff-license-lapse-notify');
  perform cron.unschedule('clinical-staff-indemnity-lapse-notify') where exists (select 1 from cron.job where jobname = 'clinical-staff-indemnity-lapse-notify');
  perform cron.schedule('credential-expiry-sweep', '0 5 * * *', $c$select private.credential_expiry_sweep()$c$);
end $$;

-- ---------------------------------------------------------------------------
-- 17. Draft training modules (content is the chief medical officer's to write and approve).
-- ---------------------------------------------------------------------------
insert into public.training_modules (organisation_id, code, title, summary, content, estimated_minutes, status)
select o.id, m.code, m.title, 'Draft placeholder. The chief medical officer writes and approves the real content before anyone is asked to complete it.',
       '[{"type":"text","body":"Draft. Awaiting the chief medical officer."}]'::jsonb, 15, 'draft'
from public.organisations o
cross join (values ('protocols', 'Tarragon protocols'), ('triage', 'Triage and red events'), ('documentation', 'Documentation'),
                   ('ai_scribe', 'AI scribe rules'), ('safety_reporting', 'Raising a safety concern')) as m(code, title)
where o.id = (select organisation_id from public.clinical_staff order by created_at limit 1)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 17b. Read functions for the screens (one jsonb call per page; each checks who is asking).
-- ---------------------------------------------------------------------------
create function public.my_clinician_application()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  v_uid uuid := auth.uid();
  v_max int := coalesce((private.credential_rule('test_max_attempts'))::int, 3);
  v_cool int := coalesce((private.credential_rule('test_retake_cooldown_hours'))::int, 24);
  v_used int; v_last timestamptz; v_passed boolean; v_open uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where profile_id = v_uid
    order by (state not in ('rejected', 'offboarded')) desc, created_at desc limit 1;
  if not found then return null; end if;
  select count(*) filter (where submitted_at is not null), max(submitted_at), coalesce(bool_or(passed), false)
    into v_used, v_last, v_passed from public.credential_test_attempts where application_id = a.id;
  select id into v_open from public.credential_test_attempts where application_id = a.id and submitted_at is null;
  return jsonb_build_object(
    'id', a.id, 'state', a.state, 'employment_type', a.employment_type,
    'details', jsonb_build_object('mdcn_folio', a.mdcn_folio, 'qualification', a.qualification, 'graduation_year', a.graduation_year,
      'nysc_year', a.nysc_year, 'years_since_house_job', a.years_since_house_job, 'specialties', to_jsonb(a.specialties),
      'languages', to_jsonb(a.languages), 'referees', a.referees, 'conflicts_declaration', a.conflicts_declaration,
      'indemnity_insurer', a.indemnity_insurer, 'indemnity_policy_number', a.indemnity_policy_number, 'indemnity_expires_at', a.indemnity_expires_at),
    'missing', case when a.state = 'started' then to_jsonb(private.application_missing(a.id)) else '[]'::jsonb end,
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'created_at', d.created_at, 'verified', d.verified_at is not null) order by d.created_at), '[]'::jsonb)
                  from public.clinician_documents d where d.application_id = a.id and d.superseded_at is null),
    'transitions', (select coalesce(jsonb_agg(jsonb_build_object('to_state', t.to_state, 'created_at', t.created_at) order by t.created_at), '[]'::jsonb)
                    from public.clinician_application_transitions t where t.application_id = a.id),
    'modules', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'summary', m.summary, 'content', m.content, 'minutes', m.estimated_minutes,
                  'completed', exists (select 1 from public.training_progress tp where tp.application_id = a.id and tp.module_id = m.id)) order by m.created_at), '[]'::jsonb)
                from public.training_modules m where m.status = 'approved' and m.organisation_id = a.organisation_id),
    'test', jsonb_build_object('attempts_used', v_used, 'attempts_allowed', v_max + a.test_extra_attempts, 'open_attempt_id', v_open,
      'next_allowed_at', case when v_last is null then null else v_last + make_interval(hours => v_cool) end, 'passed', v_passed));
end;
$$;

create function public.credentialing_queue()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by (x ->> 'updated_at') desc), '[]'::jsonb) from (
    select jsonb_build_object('id', a.id, 'state', a.state, 'employment_type', a.employment_type, 'applicant_name', p.full_name,
      'mdcn_folio', a.mdcn_folio, 'folio_flag', a.folio_flag, 'submitted_at', a.submitted_at, 'updated_at', a.updated_at,
      'checks_passed', (select count(*) from public.clinician_checks c where c.application_id = a.id and c.result = 'passed'),
      'checks_total', (select count(*) from public.clinician_checks c where c.application_id = a.id),
      'clinical_staff_id', a.clinical_staff_id) as x
    from public.clinician_applications a join public.profiles p on p.id = a.profile_id
  ) q);
end;
$$;

create function public.credentialing_application_detail(p_application uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a public.clinician_applications%rowtype; p public.profiles%rowtype;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  select * into p from public.profiles where id = a.profile_id;
  return jsonb_build_object(
    'application', to_jsonb(a),
    'applicant', jsonb_build_object('full_name', p.full_name, 'phone', p.phone, 'email', (select email from auth.users where id = a.profile_id), 'role', p.role),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'mime_type', d.mime_type, 'size_bytes', d.size_bytes, 'created_at', d.created_at,
        'verified_at', d.verified_at, 'verified_by_name', (select full_name from public.profiles where id = d.verified_by), 'superseded', d.superseded_at is not null, 'expires_at', d.expires_at)
        order by d.kind, d.created_at), '[]'::jsonb) from public.clinician_documents d where d.application_id = a.id),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'result', c.result, 'performed_at', c.performed_at, 'performed_by_name', (select full_name from public.profiles where id = c.performed_by),
        'notes', c.notes, 'details', c.details) order by c.kind), '[]'::jsonb) from public.clinician_checks c where c.application_id = a.id),
    'transitions', (select coalesce(jsonb_agg(jsonb_build_object('from_state', t.from_state, 'to_state', t.to_state, 'reason', t.reason, 'created_at', t.created_at,
        'actor_name', (select full_name from public.profiles where id = t.actor_id)) order by t.created_at), '[]'::jsonb) from public.clinician_application_transitions t where t.application_id = a.id),
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('attempt_number', t.attempt_number, 'score_percent', t.score_percent, 'red_total', t.red_total, 'red_correct', t.red_correct,
        'passed', t.passed, 'submitted_at', t.submitted_at) order by t.attempt_number), '[]'::jsonb) from public.credential_test_attempts t where t.application_id = a.id),
    'training', jsonb_build_object(
        'completed', (select count(*) from public.training_progress tp where tp.application_id = a.id),
        'required', (select count(*) from public.training_modules m where m.status = 'approved' and m.organisation_id = a.organisation_id)),
    'staff', (select jsonb_build_object('id', cs.id, 'status', cs.status, 'active', cs.active, 'level', cs.credentialing_level, 'license_expires_at', cs.license_expires_at,
        'indemnity_expires_at', cs.indemnity_expires_at, 'competencies', (select coalesce(jsonb_agg(cc.competency_code order by cc.competency_code), '[]'::jsonb) from public.clinician_competencies cc where cc.clinical_staff_id = cs.id and cc.revoked_at is null))
        from public.clinical_staff cs where cs.id = a.clinical_staff_id),
    'folio_conflict', (select coalesce(jsonb_agg(jsonb_build_object('full_name', cs.full_name, 'status', cs.status)), '[]'::jsonb) from public.clinical_staff cs
        where cs.profile_id is distinct from a.profile_id and cs.status <> 'offboarded'
          and upper(regexp_replace(cs.credential_number, '\s', '', 'g')) = upper(regexp_replace(a.mdcn_folio, '\s', '', 'g'))));
end;
$$;

create function public.credentialing_expiry_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by coalesce(x ->> 'soonest', '9999')), '[]'::jsonb) from (
    select jsonb_build_object('id', cs.id, 'profile_id', cs.profile_id, 'full_name', cs.full_name, 'status', cs.status, 'active', cs.active, 'doctor_tier', cs.doctor_tier,
      'employment_type', cs.employment_type, 'level', cs.credentialing_level, 'license_expires_at', cs.license_expires_at, 'indemnity_expires_at', cs.indemnity_expires_at,
      'indemnity_required', coalesce(private.indemnity_required(cs.id), false),
      'soonest', least(cs.license_expires_at, case when coalesce(private.indemnity_required(cs.id), false) then cs.indemnity_expires_at end),
      'eligible', private.clinician_is_eligible(cs.profile_id),
      'grace', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'ends_at', g.ends_at, 'reason', g.reason) order by g.ends_at), '[]'::jsonb)
                from public.credential_grace_periods g where g.clinical_staff_id = cs.id and g.revoked_at is null and g.ends_at > now()),
      'competencies', (select coalesce(jsonb_agg(cc.competency_code order by cc.competency_code), '[]'::jsonb) from public.clinician_competencies cc where cc.clinical_staff_id = cs.id and cc.revoked_at is null),
      'audited_task_count', cs.audited_task_count,
      'renewal_documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'created_at', d.created_at, 'expires_at', d.expires_at,
                'verified', d.verified_at is not null) order by d.created_at), '[]'::jsonb)
              from public.clinician_documents d where d.clinical_staff_id = cs.id and d.application_id is null and d.superseded_at is null
                and d.kind in ('mdcn_practising_licence', 'indemnity_certificate'))) as x
    from public.clinical_staff cs where cs.status <> 'offboarded' and cs.profile_id is not null
  ) q);
end;
$$;

create function public.credentialing_content()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'test_cases', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'scenario', c.scenario, 'options', c.options, 'correct_option_id', c.correct_option_id,
        'is_red', c.is_red, 'rationale', c.rationale, 'status', c.status) order by c.code), '[]'::jsonb) from public.credential_test_cases c),
    'modules', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'title', m.title, 'summary', m.summary, 'content', m.content, 'minutes', m.estimated_minutes,
        'status', m.status) order by m.code), '[]'::jsonb) from public.training_modules m));
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. Grants on the public functions: signed-in users only (anon and PUBLIC revoked).
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'start_clinician_application(public.staff_employment_type)',
    'save_clinician_application(uuid, jsonb)',
    'submit_clinician_application(uuid)',
    'register_clinician_document(uuid, public.clinician_document_kind, text, text, bigint, text, timestamptz)',
    'open_clinician_document(uuid)',
    'verify_clinician_document(uuid, text)',
    'begin_credential_checks(uuid)',
    'set_application_employment_type(uuid, public.staff_employment_type)',
    'record_credential_check(uuid, public.credential_check_kind, public.credential_check_result, text, jsonb, timestamptz)',
    'reject_clinician_application(uuid, text)',
    'complete_training_module(uuid, uuid)',
    'start_credential_test(uuid)',
    'submit_credential_test(uuid, jsonb)',
    'grant_test_retake(uuid, text)',
    'save_credential_test_case(uuid, text, text, jsonb, text, boolean, text)',
    'approve_credential_content(text, uuid)',
    'save_training_module(uuid, text, text, text, jsonb, integer)',
    'approve_clinician_application(uuid, smallint, text[])',
    'activate_clinician(uuid)',
    'suspend_clinician(uuid, text)',
    'reinstate_clinician(uuid, text)',
    'offboard_clinician(uuid, text)',
    'renew_clinician_credential(uuid, text, timestamptz, uuid)',
    'grant_clinician_competency(uuid, text)',
    'revoke_clinician_competency(uuid, text)',
    'set_clinician_level(uuid, smallint, text)',
    'grant_credential_grace(uuid, text, integer, text)',
    'revoke_credential_grace(uuid)',
    'my_credential_status()',
    'my_clinician_application()',
    'credentialing_queue()',
    'credentialing_application_detail(uuid)',
    'credentialing_expiry_overview()',
    'credentialing_content()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 19. Self-check: the migration fails loudly if the shape is not what it claims.
-- ---------------------------------------------------------------------------
do $$
declare t text; f record;
begin
  foreach t in array array['clinician_applications', 'clinician_application_transitions', 'clinician_documents', 'clinician_document_access_log',
    'clinician_checks', 'competencies', 'clinician_competencies', 'training_modules', 'training_progress', 'credential_test_cases',
    'credential_test_attempts', 'credential_grace_periods', 'credential_expiry_notices', 'credentialing_config'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'S15 self-check: RLS is off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'S15 self-check: anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'S15 self-check: authenticated can write % directly', t; end if;
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('start_clinician_application', 'approve_clinician_application', 'open_clinician_document', 'suspend_clinician', 'activate_clinician', 'my_credential_status') loop
    if has_function_privilege('anon', f.sig, 'EXECUTE') then raise exception 'S15 self-check: anon can execute %', f.sig; end if;
  end loop;
  if (select count(*) from public.competencies) <> 7 then raise exception 'S15 self-check: competencies not seeded'; end if;
  if not exists (select 1 from cron.job where jobname = 'credential-expiry-sweep') then raise exception 'S15 self-check: sweep not scheduled'; end if;
  if exists (select 1 from public.clinical_staff where status <> 'active') then raise exception 'S15 self-check: an existing clinician was changed'; end if;
end $$;
