-- P5 (S15 follow-up), part 2 of 2: primary-source verification, mid-year re-check, new-clinician early review,
-- a patient-safe "licence verified on" lookup, and the licence-date work list.
-- CMO answers Q14 to Q17 (docs/DECISIONS.md, 2026-10-07). Design: docs/design/S11-S15-credentialing.md.
--
--   Q14  A recorded MDCN / DataFlow verification (route, reference, date, verifier, evidence file) is required before a
--        NEW clinician can be offered any independent patient contact: private.clinician_is_eligible() now asks
--        private.psv_satisfied(). The two clinicians active today are grandfathered by a flag that can only be switched
--        OFF, and ONLY recording the same evidence (public.record_primary_source_verification) removes them from the
--        "evidence needed" work list. No evidence and no date was invented for anyone.
--   Q15  A daily sweep opens a credential_work_items row six months after the last verification. Overdue shows on the CMO
--        hub. Nothing in it can suspend anyone: suspension stays expiry-driven (credential_expiry_sweep).
--   Q16  quality_config v2 adds sampling.new_clinician_full_review_cases = 20: every one of a clinician's first 20 red or
--        prescribing cases is audited, then the existing sample applies.
--   Q17  public.clinician_licence_verified_on() answers a date only when a stored verification exists and the licence on
--        file is still in date. It never returns the folio number.
--   OQ-109  public.record_clinician_credential_dates() fills a missing licence or cover date (never overwrites one).
--
-- Live counts before this change: 2 active clinicians, 0 verification records (the table is new), 0 clinical tasks,
-- 0 audits, so there is nothing to convert. Test clinicians (is_test) are exempt from the gate so the existing proofs and
-- QA fixtures keep working; a real clinician can never be flagged is_test by a non-admin (private.guard_is_test_flag).

-- ---------------------------------------------------------------------------
-- 1. Configuration: credentialing_config v3, quality_config v2 (PROPOSED values, mirrored in the code registry)
-- ---------------------------------------------------------------------------
update public.credentialing_config set is_active = false where is_active;
-- credentialing-rules-begin
insert into public.credentialing_config (version, is_active, effective_from, rules) values (3, true, '2026-10-13', $json$
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
  "document_retention_years_after_offboarding": 7,
  "require_verified_phone": false,
  "document_purge_enabled": false,
  "rejected_application_document_retention_months": 24,
  "primary_source_required": true,
  "primary_source_routes": ["mdcn_dataflow", "mdcn_written_confirmation", "mdcn_register_check"],
  "primary_source_max_age_days": 365,
  "recheck_months": 6,
  "recheck_overdue_days": 14,
  "credential_date_max_days": 1100,
  "grandfather_ends_on": null
}
$json$::jsonb);
-- credentialing-rules-end

update public.quality_config set is_active = false where is_active;
-- quality-audit-begin
insert into public.quality_config (version, is_active, effective_from, rules) values (2, true, '2026-10-13', $json$
{
  "sampling": { "random_rate_percent": 10, "always_reasons": ["red_event", "titration"], "floor_min_tasks": 3, "floor_per_clinician_per_month": 1, "reviewer_monthly_cap": 40, "due_days": 14, "new_clinician_full_review_cases": 20 },
  "tier1": { "audited_task_count": 20, "graduation_min_score": 85, "max_critical_misses": 0 },
  "form": {
    "version": 1,
    "safety_items": ["identity_and_consent_confirmed", "red_flags_recognised_and_acted_on", "decision_within_competence_and_protocol", "no_unsigned_treatment_change", "safety_netting_and_follow_up_given", "escalated_when_needed"],
    "quality_items": ["history_adequate", "reasoning_documented", "communication_clear", "plan_appropriate", "patient_questions_answered", "documentation_timely"],
    "quality_max": 4
  },
  "outcomes": { "satisfactory_min": 85, "minor_concerns_min": 70, "rationale_min_chars": 20 },
  "reliability": { "audit_weight": 2, "good_by_outcome": { "satisfactory": 1, "minor_concerns": 0.6, "significant_concerns": 0.2, "unsafe": 0 } },
  "speak_up": { "acknowledge_hours": 48, "immediate_acknowledge_hours": 4, "respond_days": 14, "max_per_day": 10, "retaliation_review_months": 12 }
}
$json$::jsonb);
-- quality-audit-end

-- ---------------------------------------------------------------------------
-- 2. Verification records and work items
-- ---------------------------------------------------------------------------
alter table public.clinical_staff
  add column psv_grandfathered boolean not null default false;
comment on column public.clinical_staff.psv_grandfathered is
  'P5/Q14: true only for clinicians who were already active when primary-source verification became required. Eligible until the evidence is recorded (or credentialing_config.grandfather_ends_on passes). Can only be switched off, never on (trigger).';

-- the two clinicians who are active today; no evidence is invented for them
update public.clinical_staff set psv_grandfathered = true
  where active and status = 'active' and profile_id is not null and is_test is not true and doctor_tier <> 'care_coordinator';

create function private.guard_psv_grandfathered() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.psv_grandfathered then
    if tg_op = 'INSERT' then
      raise exception 'psv_grandfathered can only be switched off; record the verification instead' using errcode = '23514';
    elsif not old.psv_grandfathered then
      raise exception 'psv_grandfathered can only be switched off; record the verification instead' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger clinical_staff_guard_psv_grandfathered before insert or update of psv_grandfathered on public.clinical_staff
  for each row execute function private.guard_psv_grandfathered();
revoke all on function private.guard_psv_grandfathered() from public, anon, authenticated;

create table public.clinician_primary_source_verifications (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id    uuid not null references public.clinical_staff (id) on delete cascade,
  application_id       uuid references public.clinician_applications (id) on delete set null,
  kind                 text not null check (kind in ('initial', 'recheck')),
  route                text not null check (route in ('mdcn_dataflow', 'mdcn_written_confirmation', 'mdcn_register_check')),
  reference            text not null check (length(btrim(reference)) between 4 and 80),
  verified_on          date not null,
  verified_by          uuid not null references public.profiles (id) on delete restrict,
  evidence_document_id uuid not null references public.clinician_documents (id) on delete restrict,
  notes                text,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now()
);
-- the same MDCN or DataFlow reference can never vouch for two different people (the functions below enforce that); the same person
-- may repeat a reference at a re-check (a register number does not change), but not on the same day twice
create unique index clinician_psv_reference_unique on public.clinician_primary_source_verifications (clinical_staff_id, route, upper(btrim(reference)), verified_on);
create index clinician_psv_staff_idx on public.clinician_primary_source_verifications (clinical_staff_id, verified_on desc);
-- Append only: never edited, and deleted only when the clinician record itself is removed (rejecting an approved
-- application that was never switched on deletes that record, and with it these rows).
create function private.psv_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.clinical_staff cs where cs.id = old.clinical_staff_id) then
    return old;
  end if;
  raise exception '% is append only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function private.psv_append_only() from public, anon, authenticated;
create trigger clinician_psv_append_only before update or delete on public.clinician_primary_source_verifications
  for each row execute function private.psv_append_only();
alter table public.clinician_primary_source_verifications enable row level security;
create policy clinician_psv_read on public.clinician_primary_source_verifications for select to authenticated
  using (private.can_credential_review()
         or exists (select 1 from public.clinical_staff cs where cs.id = clinical_staff_id and cs.profile_id = (select auth.uid())));
revoke all on public.clinician_primary_source_verifications from public, anon;
revoke insert, update, delete on public.clinician_primary_source_verifications from authenticated;
grant select on public.clinician_primary_source_verifications to authenticated;

create table public.credential_work_items (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id   uuid not null references public.clinical_staff (id) on delete cascade,
  kind                text not null check (kind in ('credential_recheck', 'primary_source_missing')),
  due_on              date not null,
  state               text not null default 'open' check (state in ('open', 'done', 'cancelled')),
  reviewers_told_at   timestamptz,
  overdue_told_at     timestamptz,
  verification_id     uuid references public.clinician_primary_source_verifications (id) on delete set null,
  completed_at        timestamptz,
  completed_by        uuid references public.profiles (id) on delete set null,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now()
);
create unique index credential_work_items_one_open on public.credential_work_items (clinical_staff_id, kind) where state = 'open';
alter table public.credential_work_items enable row level security;
create policy credential_work_items_read on public.credential_work_items for select to authenticated using (private.can_credential_review());
revoke all on public.credential_work_items from public, anon;
revoke insert, update, delete on public.credential_work_items from authenticated;
grant select on public.credential_work_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The gate: private.psv_satisfied() and clinician_is_eligible()
-- ---------------------------------------------------------------------------
create function private.psv_satisfied(p_staff uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when not coalesce((private.credential_rule('primary_source_required'))::boolean, false) then true
    -- a care coordinator is not a registered doctor: there is no MDCN registration to verify (they never take clinical work)
    else exists (select 1 from public.clinical_staff cs where cs.id = p_staff and (cs.is_test or cs.doctor_tier = 'care_coordinator'))
      or exists (select 1 from public.clinician_primary_source_verifications v where v.clinical_staff_id = p_staff)
      or exists (select 1 from public.clinical_staff cs
                  where cs.id = p_staff and cs.psv_grandfathered
                    and ((private.credential_rule('grandfather_ends_on') #>> '{}') is null
                         or (p_at at time zone 'Africa/Lagos')::date <= ((private.credential_rule('grandfather_ends_on') #>> '{}')::date)))
  end;
$$;
revoke all on function private.psv_satisfied(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.clinician_is_eligible(p_profile uuid, p_at timestamptz default now()) returns boolean
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
      -- P5/Q14: a recorded MDCN / DataFlow primary-source verification (or the grandfathering flag, until evidence is recorded)
      and private.psv_satisfied(cs.id, p_at)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. New applicants: the check, from the live definitions
-- ---------------------------------------------------------------------------
create or replace function public.register_clinician_document(
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
  if not exists (select 1 from storage.objects o where o.bucket_id = 'clinician-documents' and o.name = p_storage_path
                   and (o.metadata ->> 'size')::bigint = p_size and (o.metadata ->> 'mimetype') = p_mime) then
    raise exception 'the file was not found; please upload it again' using errcode = '23514';
  end if;
  if p_application is not null then
    select * into a from public.clinician_applications where id = p_application and profile_id = v_uid;
    if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
    if a.state not in ('started', 'documents_submitted', 'checks_in_progress') then raise exception 'documents can no longer be changed on this application' using errcode = '23514'; end if;
    update public.clinician_documents set superseded_at = now() where application_id = p_application and kind = p_kind and superseded_at is null;
    -- Replacing a document whose check already passed sends that check back to pending: the evidence changed.
    update public.clinician_checks set result = 'pending', performed_by = null, performed_at = null, evidence_document_id = null
      where application_id = p_application and result = 'passed'
        and kind = case p_kind
          when 'mdcn_practising_licence' then 'licence'::public.credential_check_kind
          when 'mdcn_portal_screenshot' then 'licence'::public.credential_check_kind
          when 'graduation_certificate' then 'qualifications'::public.credential_check_kind
          when 'nysc_certificate' then 'qualifications'::public.credential_check_kind
          when 'government_id' then 'identity'::public.credential_check_kind
          when 'mdcn_confirmation' then 'primary_source'::public.credential_check_kind
        end;
    insert into public.clinician_documents (organisation_id, owner_profile_id, application_id, kind, storage_path, mime_type, size_bytes, sha256, expires_at, is_test)
      values (p.organisation_id, v_uid, p_application, p_kind, p_storage_path, p_mime, p_size, p_sha256, p_expires_at, p.is_test) returning id into v_id;
  else
    select * into s from public.clinical_staff where profile_id = v_uid and status in ('active', 'suspended');
    if not found then raise exception 'no clinician record to attach this document to' using errcode = 'P0002'; end if;
    -- P5: the MDCN / DataFlow confirmation is accepted here too, so a clinician who was already working can supply the same evidence.
    if p_kind not in ('mdcn_practising_licence', 'mdcn_portal_screenshot', 'indemnity_certificate', 'mdcn_confirmation') then
      raise exception 'only licence, indemnity or MDCN confirmation documents can be uploaded here' using errcode = '23514'; end if;
    update public.clinician_documents set superseded_at = now() where clinical_staff_id = s.id and application_id is null and kind = p_kind and superseded_at is null;
    insert into public.clinician_documents (organisation_id, owner_profile_id, clinical_staff_id, kind, storage_path, mime_type, size_bytes, sha256, expires_at, is_test)
      values (p.organisation_id, v_uid, s.id, p_kind, p_storage_path, p_mime, p_size, p_sha256, p_expires_at, p.is_test) returning id into v_id;
    perform private.credential_notify_reviewers(p.organisation_id, 'Renewal uploaded', 'A clinician uploaded a renewed credential for checking.',
      jsonb_build_object('clinical_staff_id', s.id, 'kind', p_kind,
        'i18n_key', 'credential.renewal_uploaded'));
  end if;
  perform private.credential_audit(p.organisation_id, v_uid, 'clinician_document.registered', 'clinician_document', v_id, jsonb_build_object('kind', p_kind));
  return v_id;
end;
$$;

create or replace function public.record_credential_check(
  p_application uuid, p_kind public.credential_check_kind, p_result public.credential_check_result,
  p_notes text default null, p_details jsonb default '{}'::jsonb, p_licence_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  v_evidence uuid;
  v_min numeric := coalesce((private.credential_rule('min_practice_years'))::numeric, 2);
  v_routes jsonb := coalesce(private.credential_rule('primary_source_routes'), '[]'::jsonb);
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_max_age integer := coalesce((private.credential_rule('primary_source_max_age_days'))::integer, 365);
  v_ref text; v_on date;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot verify your own application' using errcode = '42501'; end if;
  -- the primary-source check may also be recorded for an application that was already past the checks when the rule arrived
  if a.state <> 'checks_in_progress' and not (p_kind = 'primary_source' and a.state in ('training', 'test_passed')) then
    raise exception 'checks can only be recorded while checks are in progress' using errcode = '23514'; end if;
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
      when 'primary_source' then
        -- Q14: the MDCN / DataFlow verification, with its reference, date and the evidence file.
        if not private.application_has_doc(a.id, 'mdcn_confirmation') then
          raise exception 'the primary-source check needs the MDCN or DataFlow confirmation file' using errcode = '23514'; end if;
        if not (v_routes ? coalesce(p_details ->> 'route', '')) then
          raise exception 'choose how it was verified: DataFlow, a written MDCN confirmation, or an MDCN register check' using errcode = '23514'; end if;
        v_ref := btrim(coalesce(p_details ->> 'reference', ''));
        if length(v_ref) < 4 or length(v_ref) > 80 then raise exception 'enter the DataFlow or MDCN reference number (4 to 80 characters)' using errcode = '23514'; end if;
        begin v_on := (p_details ->> 'verified_on')::date; exception when others then v_on := null; end;
        if v_on is null or v_on > v_today or v_on < v_today - v_max_age then
          raise exception 'enter the date of the verification (today or earlier, within the last % days)', v_max_age using errcode = '23514'; end if;
        -- an applicant has no clinician record yet, so any existing record with this reference belongs to someone else
        if exists (select 1 from public.clinician_primary_source_verifications v
                    where v.route = p_details ->> 'route' and upper(btrim(v.reference)) = upper(v_ref)) then
          raise exception 'this reference is already recorded for another clinician' using errcode = '23514'; end if;
        select id into v_evidence from public.clinician_documents where application_id = a.id and kind = 'mdcn_confirmation' and superseded_at is null;
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

  if a.state = 'checks_in_progress' and not exists (select 1 from public.clinician_checks where application_id = a.id and result <> 'passed') then
    perform private.apply_application_transition(a.id, 'training', null, 'all checks passed');
  end if;
end;
$$;

create or replace function public.approve_clinician_application(p_application uuid, p_level smallint default null, p_competencies text[] default '{}')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  a public.clinician_applications%rowtype;
  prof public.profiles%rowtype;
  v_level smallint;
  v_licence_check public.clinician_checks%rowtype;
  v_psv_check public.clinician_checks%rowtype;
  v_staff uuid;
  v_code text;
begin
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can approve a clinician' using errcode = '42501'; end if;
  select * into a from public.clinician_applications where id = p_application for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if a.profile_id = auth.uid() then raise exception 'you cannot approve your own application' using errcode = '42501'; end if;
  if a.state <> 'test_passed' then raise exception 'the application must be at test passed to approve (it is %)', a.state using errcode = '23514'; end if;
  select * into v_licence_check from public.clinician_checks where application_id = a.id and kind = 'licence';
  select * into v_psv_check from public.clinician_checks where application_id = a.id and kind = 'primary_source';
  if coalesce((private.credential_rule('separate_verifier_and_approver'))::boolean, true)
     and exists (select 1 from public.clinician_checks where application_id = a.id and performed_by = auth.uid()) then
    raise exception 'the person who verified a check cannot also approve; ask another reviewer' using errcode = '42501'; end if;
  if coalesce((private.credential_rule('primary_source_required'))::boolean, false)
     and (v_psv_check.id is null or v_psv_check.result <> 'passed' or v_psv_check.evidence_document_id is null) then
    raise exception 'the MDCN or DataFlow primary-source verification must be recorded before approval' using errcode = '23514'; end if;
  if a.licence_expires_at is null or a.licence_expires_at <= now() then raise exception 'the licence on file has expired' using errcode = '23514'; end if;
  if exists (select 1 from public.clinical_staff where profile_id = a.profile_id) then raise exception 'this account already has a clinician record' using errcode = '23514'; end if;
  v_level := coalesce(p_level, case when a.employment_type = 'employed' then 2 else 1 end);
  if v_level not in (1, 2) then raise exception 'level must be 1 or 2' using errcode = '23514'; end if;
  foreach v_code in array coalesce(p_competencies, '{}') loop
    if not exists (select 1 from public.competencies c where c.code = v_code and c.is_active and c.requires_level <= v_level) then
      raise exception 'competency % is not available at level %', v_code, v_level using errcode = '23514'; end if;
  end loop;
  select * into prof from public.profiles where id = a.profile_id;
  perform set_config('tarragon.credential_carry_test_flag', case when a.is_test then a.profile_id::text else '' end, true);
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
    coalesce(a.is_test, false))
  returning id into v_staff;
  perform set_config('tarragon.credential_carry_test_flag', '', true);
  update public.clinician_applications set approved_by = auth.uid(), approved_at = now(), clinical_staff_id = v_staff where id = a.id;
  -- Q14: carry the verified record (route, reference, date, verifier, evidence file) to the clinician.
  if v_psv_check.id is not null and v_psv_check.result = 'passed' then
    insert into public.clinician_primary_source_verifications
      (organisation_id, clinical_staff_id, application_id, kind, route, reference, verified_on, verified_by, evidence_document_id, notes, is_test)
    values (a.organisation_id, v_staff, a.id, 'initial', v_psv_check.details ->> 'route', btrim(v_psv_check.details ->> 'reference'),
            (v_psv_check.details ->> 'verified_on')::date, v_psv_check.performed_by, v_psv_check.evidence_document_id, v_psv_check.notes, coalesce(a.is_test, false));
    update public.clinician_documents set clinical_staff_id = v_staff where id = v_psv_check.evidence_document_id and clinical_staff_id is null;
  end if;
  foreach v_code in array coalesce(p_competencies, '{}') loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
      values (a.organisation_id, v_staff, v_code, auth.uid(), a.is_test);
  end loop;
  perform private.apply_application_transition(a.id, 'approved_tier1', auth.uid(), 'approved at level ' || v_level);
  return v_staff;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Clinicians already working: record the same evidence (and later, the mid-year re-check)
-- ---------------------------------------------------------------------------
create function public.record_primary_source_verification(
  p_staff uuid, p_route text, p_reference text, p_verified_on date, p_evidence_document uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.clinical_staff%rowtype;
  d public.clinician_documents%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_max_age integer := coalesce((private.credential_rule('primary_source_max_age_days'))::integer, 365);
  v_ref text := btrim(coalesce(p_reference, ''));
  v_last date;
  v_kind text;
  v_id uuid;
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot verify your own registration' using errcode = '42501'; end if;
  if s.status = 'offboarded' then raise exception 'this clinician has been removed' using errcode = '23514'; end if;
  if not ((coalesce(private.credential_rule('primary_source_routes'), '[]'::jsonb)) ? coalesce(p_route, '')) then
    raise exception 'choose how it was verified: DataFlow, a written MDCN confirmation, or an MDCN register check' using errcode = '23514'; end if;
  if length(v_ref) < 4 or length(v_ref) > 80 then raise exception 'enter the DataFlow or MDCN reference number (4 to 80 characters)' using errcode = '23514'; end if;
  if p_verified_on is null or p_verified_on > v_today or p_verified_on < v_today - v_max_age then
    raise exception 'enter the date of the verification (today or earlier, within the last % days)', v_max_age using errcode = '23514'; end if;
  select * into d from public.clinician_documents
    where id = p_evidence_document and clinical_staff_id = p_staff and owner_profile_id = s.profile_id and superseded_at is null
      and kind in ('mdcn_confirmation', 'mdcn_portal_screenshot');
  if not found then raise exception 'attach the clinician''s uploaded MDCN or DataFlow confirmation (or register screenshot)' using errcode = '23514'; end if;
  if exists (select 1 from public.clinician_primary_source_verifications v
              where v.route = p_route and upper(btrim(v.reference)) = upper(v_ref) and v.clinical_staff_id <> p_staff) then
    raise exception 'this reference is already recorded for another clinician' using errcode = '23514'; end if;
  if exists (select 1 from public.clinician_primary_source_verifications v
              where v.route = p_route and upper(btrim(v.reference)) = upper(v_ref) and v.clinical_staff_id = p_staff and v.verified_on = p_verified_on) then
    raise exception 'this verification is already recorded' using errcode = '23514'; end if;
  select max(verified_on) into v_last from public.clinician_primary_source_verifications where clinical_staff_id = p_staff;
  if v_last is not null and p_verified_on < v_last then raise exception 'the date is earlier than the last verification on record' using errcode = '23514'; end if;
  v_kind := case when v_last is null then 'initial' else 'recheck' end;

  insert into public.clinician_primary_source_verifications
    (organisation_id, clinical_staff_id, kind, route, reference, verified_on, verified_by, evidence_document_id, notes, is_test)
  values (s.organisation_id, p_staff, v_kind, p_route, v_ref, p_verified_on, auth.uid(), d.id, nullif(btrim(p_notes), ''), s.is_test)
  returning id into v_id;
  update public.clinician_documents set verified_by = auth.uid(), verified_at = now() where id = d.id and verified_at is null;
  -- Recording the evidence ends the grandfathering for this clinician and closes the open work items for them.
  update public.clinical_staff set psv_grandfathered = false where id = p_staff and psv_grandfathered;
  update public.credential_work_items set state = 'done', completed_at = now(), completed_by = auth.uid(), verification_id = v_id
    where clinical_staff_id = p_staff and state = 'open';
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinician_primary_source.' || v_kind, 'clinical_staff', p_staff,
    jsonb_build_object('route', p_route, 'verified_on', p_verified_on, 'verification_id', v_id));
  return v_id;
end;
$$;

create function public.record_clinician_credential_dates(
  p_staff uuid, p_licence_expires_at timestamptz default null, p_indemnity_expires_at timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s public.clinical_staff%rowtype;
  v_max timestamptz := now() + make_interval(days => coalesce((private.credential_rule('credential_date_max_days'))::integer, 1100));
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.clinical_staff where id = p_staff for update;
  if not found then raise exception 'clinician not found' using errcode = 'P0002'; end if;
  if s.profile_id = auth.uid() then raise exception 'you cannot record your own dates' using errcode = '42501'; end if;
  if s.status = 'offboarded' then raise exception 'this clinician has been removed' using errcode = '23514'; end if;
  if p_licence_expires_at is null and p_indemnity_expires_at is null then raise exception 'enter at least one date' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say where you read the date (at least 10 characters)' using errcode = '23514'; end if;
  if p_licence_expires_at is not null then
    if s.license_expires_at is not null then raise exception 'a licence date is already on file; use the renewal check' using errcode = '23514'; end if;
    if p_licence_expires_at <= now() then raise exception 'the licence date must be in the future' using errcode = '23514'; end if;
    if p_licence_expires_at > v_max then raise exception 'that licence date is too far away; check the document' using errcode = '23514'; end if;
  end if;
  if p_indemnity_expires_at is not null then
    if not coalesce(private.indemnity_required(p_staff), false) then raise exception 'cover is not required for this clinician' using errcode = '23514'; end if;
    if s.indemnity_expires_at is not null then raise exception 'a cover date is already on file; use the renewal check' using errcode = '23514'; end if;
    if p_indemnity_expires_at <= now() then raise exception 'the cover date must be in the future' using errcode = '23514'; end if;
    if p_indemnity_expires_at > v_max then raise exception 'that cover date is too far away; check the document' using errcode = '23514'; end if;
  end if;
  update public.clinical_staff set
      license_expires_at = coalesce(p_licence_expires_at, license_expires_at),
      indemnity_expires_at = coalesce(p_indemnity_expires_at, indemnity_expires_at)
    where id = p_staff;
  perform private.credential_audit(s.organisation_id, auth.uid(), 'clinical_staff.dates_recorded', 'clinical_staff', p_staff,
    jsonb_build_object('licence', p_licence_expires_at, 'indemnity', p_indemnity_expires_at, 'note', btrim(p_note)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The work list, the sweep, and the patient-safe lookup
-- ---------------------------------------------------------------------------
create function public.credentialing_work_list() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_months integer := coalesce((private.credential_rule('recheck_months'))::integer, 6);
  v_over integer := coalesce((private.credential_rule('recheck_overdue_days'))::integer, 14);
begin
  if not private.can_credential_review() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'unverified', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', cs.id, 'full_name', cs.full_name, 'status', cs.status,
          'grandfathered', cs.psv_grandfathered,
          'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'created_at', d.created_at) order by d.created_at), '[]'::jsonb)
                          from public.clinician_documents d where d.clinical_staff_id = cs.id and d.application_id is null and d.superseded_at is null
                           and d.kind in ('mdcn_confirmation', 'mdcn_portal_screenshot'))) order by cs.full_name), '[]'::jsonb)
        from public.clinical_staff cs
        where cs.status <> 'offboarded' and cs.profile_id is not null and cs.active and cs.is_test is not true and cs.doctor_tier <> 'care_coordinator'
          and not exists (select 1 from public.clinician_primary_source_verifications v where v.clinical_staff_id = cs.id)),
    'rechecks', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', cs.id, 'full_name', cs.full_name, 'last_verified_on', l.verified_on,
          'due_on', (l.verified_on + make_interval(months => v_months))::date,
          'overdue', v_today > (l.verified_on + make_interval(months => v_months))::date + v_over,
          'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'created_at', d.created_at) order by d.created_at), '[]'::jsonb)
                          from public.clinician_documents d where d.clinical_staff_id = cs.id and d.application_id is null and d.superseded_at is null
                           and d.kind in ('mdcn_confirmation', 'mdcn_portal_screenshot')))
          order by l.verified_on), '[]'::jsonb)
        from public.clinical_staff cs
        join lateral (select max(verified_on) as verified_on from public.clinician_primary_source_verifications v where v.clinical_staff_id = cs.id) l on l.verified_on is not null
        where cs.status <> 'offboarded' and cs.profile_id is not null and cs.active and cs.is_test is not true and cs.doctor_tier <> 'care_coordinator'
          and v_today >= (l.verified_on + make_interval(months => v_months))::date),
    'missing_dates', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', cs.id, 'full_name', cs.full_name, 'status', cs.status,
          'licence_missing', cs.license_expires_at is null,
          'indemnity_missing', coalesce(private.indemnity_required(cs.id), false) and cs.indemnity_expires_at is null) order by cs.full_name), '[]'::jsonb)
        from public.clinical_staff cs
        where cs.status <> 'offboarded' and cs.profile_id is not null and cs.active and cs.is_test is not true and cs.doctor_tier <> 'care_coordinator'
          and (cs.license_expires_at is null or (coalesce(private.indemnity_required(cs.id), false) and cs.indemnity_expires_at is null))));
end;
$$;

create function private.credential_recheck_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_months integer := coalesce((private.credential_rule('recheck_months'))::integer, 6);
  v_over integer := coalesce((private.credential_rule('recheck_overdue_days'))::integer, 14);
  v_last date; v_due date; v_item uuid; v_new integer := 0; v_overdue integer := 0; v_errors integer := 0;
  v_date_str text;
begin
  for r in select cs.* from public.clinical_staff cs
            where cs.active and cs.status = 'active' and cs.profile_id is not null and cs.is_test is not true and cs.doctor_tier <> 'care_coordinator' loop
    begin
      select max(verified_on) into v_last from public.clinician_primary_source_verifications where clinical_staff_id = r.id;
      if v_last is null then
        -- no evidence at all: one open item, told to reviewers once
        insert into public.credential_work_items (organisation_id, clinical_staff_id, kind, due_on, is_test)
          values (r.organisation_id, r.id, 'primary_source_missing', v_today, r.is_test) on conflict do nothing
          returning id into v_item;
        if v_item is not null then
          v_new := v_new + 1;
          perform private.credential_notify_reviewers(r.organisation_id, 'MDCN verification evidence needed',
            format('%s has no MDCN or DataFlow verification on record. Record the reference and attach the evidence.', r.full_name),
            jsonb_build_object('clinical_staff_id', r.id, 'i18n_key', 'credential.primary_source_missing', 'i18n_params', jsonb_build_object('name', r.full_name)));
          update public.credential_work_items set reviewers_told_at = now() where id = v_item;
        end if;
        v_item := null;
        continue;
      end if;
      v_due := (v_last + make_interval(months => v_months))::date;
      if v_today < v_due then continue; end if;
      v_date_str := to_char(v_due, 'DD Mon YYYY');
      insert into public.credential_work_items (organisation_id, clinical_staff_id, kind, due_on, is_test)
        values (r.organisation_id, r.id, 'credential_recheck', v_due, r.is_test) on conflict do nothing
        returning id into v_item;
      if v_item is not null then
        v_new := v_new + 1;
        perform private.credential_notify_reviewers(r.organisation_id, 'MDCN spot re-check due',
          format('%s: the six-month MDCN spot re-check is due on %s.', r.full_name, v_date_str),
          jsonb_build_object('clinical_staff_id', r.id, 'i18n_key', 'credential.recheck_due', 'i18n_params', jsonb_build_object('name', r.full_name, 'date', v_date_str)));
        update public.credential_work_items set reviewers_told_at = now() where id = v_item;
      end if;
      v_item := null;
      if v_today > v_due + v_over then
        update public.credential_work_items set overdue_told_at = now()
          where clinical_staff_id = r.id and kind = 'credential_recheck' and state = 'open' and overdue_told_at is null
          returning id into v_item;
        if v_item is not null then
          v_overdue := v_overdue + 1;
          perform private.credential_notify_reviewers(r.organisation_id, 'MDCN spot re-check overdue',
            format('%s: the MDCN spot re-check was due on %s and is not recorded yet.', r.full_name, v_date_str),
            jsonb_build_object('clinical_staff_id', r.id, 'i18n_key', 'credential.recheck_overdue', 'i18n_params', jsonb_build_object('name', r.full_name, 'date', v_date_str)));
          v_item := null;
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'credential_recheck_sweep failed for clinician %: %', r.id, sqlerrm;
      perform private.credential_audit(r.organisation_id, null, 'credential_recheck_sweep.error', 'clinical_staff', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'credential_recheck_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'MDCN re-check sweep failed for some clinicians',
            format('%s clinician(s) could not be processed by private.credential_recheck_sweep(); see audit_log action credential_recheck_sweep.error. Re-check notices for them may be missing.', v_errors),
            'credential_recheck_sweep', now(), now());
  end if;
  -- Deliberately no suspension here: a missed re-check is a person's job to chase. Suspension stays expiry-driven.
  return jsonb_build_object('opened', v_new, 'overdue_told', v_overdue, 'errors', v_errors);
end;
$$;
revoke all on function private.credential_recheck_sweep() from public, anon, authenticated;

-- Q17: the only thing a patient-facing screen may learn about a clinician's registration is a date, and only when it is held.
create function public.clinician_licence_verified_on(p_ids uuid[]) returns table (staff_id uuid, profile_id uuid, verified_on date)
language sql stable security definer set search_path = ''
as $$
  select cs.id, cs.profile_id, l.verified_on
    from public.clinical_staff cs
    join lateral (select max(v.verified_on) as verified_on from public.clinician_primary_source_verifications v where v.clinical_staff_id = cs.id) l on l.verified_on is not null
   where (cs.id = any (p_ids) or cs.profile_id = any (p_ids))
     and cs.active and cs.status = 'active'
     and cs.license_expires_at is not null and private.credential_valid_on(cs.license_expires_at)
     and (cs.organisation_id = private.current_org_id() or private.is_org_staff(cs.organisation_id));
$$;

create function public.consultation_clinician_licence_verified_on(p_encounter uuid) returns date
language sql stable security definer set search_path = ''
as $$
  select (select x.verified_on from public.clinician_licence_verified_on(array[e.clinician_id]) x limit 1)
    from public.encounters e
   where e.id = p_encounter and e.patient_id = (select auth.uid());
$$;

-- my_credential_status gains the blocker
create or replace function public.my_credential_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype; v_blockers text[] := '{}';
begin
  select * into s from public.clinical_staff where profile_id = auth.uid();
  if not found then return null; end if;
  if s.status <> 'active' then v_blockers := array_append(v_blockers, 'status:' || s.status::text); end if;
  if not s.active and s.status = 'active' then v_blockers := array_append(v_blockers, 'not_yet_activated'::text); end if;
  if s.license_expires_at is not null and not (private.credential_valid_on(s.license_expires_at) or private.credential_in_grace(s.id, 'licence')) then v_blockers := array_append(v_blockers, 'licence_expired'::text); end if;
  if coalesce(private.indemnity_required(s.id), false) and not ((s.indemnity_expires_at is not null and s.indemnity_expires_at > now()) or private.credential_in_grace(s.id, 'indemnity')) then v_blockers := array_append(v_blockers, 'indemnity_expired'::text); end if;
  if not private.psv_satisfied(s.id) then v_blockers := array_append(v_blockers, 'primary_source_missing'::text); end if;
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

-- grants: signed-in only, never PUBLIC (anon inherits execute through PUBLIC)
revoke all on function public.record_primary_source_verification(uuid, text, text, date, uuid, text) from public, anon;
revoke all on function public.record_clinician_credential_dates(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.credentialing_work_list() from public, anon;
revoke all on function public.clinician_licence_verified_on(uuid[]) from public, anon;
revoke all on function public.consultation_clinician_licence_verified_on(uuid) from public, anon;
grant execute on function public.record_primary_source_verification(uuid, text, text, date, uuid, text) to authenticated;
grant execute on function public.record_clinician_credential_dates(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.credentialing_work_list() to authenticated;
grant execute on function public.clinician_licence_verified_on(uuid[]) to authenticated;
grant execute on function public.consultation_clinician_licence_verified_on(uuid) to authenticated;

-- staggered daily schedule (the expiry sweep runs at 05:01, the ladder at 06:48)
do $$
begin
  perform cron.schedule('credential-recheck-sweep', '37 5 * * *', $c$select private.credential_recheck_sweep()$c$);
end $$;

-- Applications already past the start of checks when the rule arrives get the new check as pending, so they are not stuck.
insert into public.clinician_checks (organisation_id, application_id, kind, is_test)
  select a.organisation_id, a.id, 'primary_source', a.is_test
    from public.clinician_applications a
   where a.state in ('checks_in_progress', 'training', 'test_passed')
  on conflict (application_id, kind) do nothing;

-- Q14 also covers the older patient-facing route: a clinician cannot publish video-visit availability until verified.
create function private.guard_consult_slot_primary_source() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare s public.clinical_staff%rowtype;
begin
  select * into s from public.clinical_staff where profile_id = new.clinician_profile_id and active;
  if found and not private.psv_satisfied(s.id) then
    raise exception 'the MDCN or DataFlow verification must be recorded before you can offer video visits' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_consult_slot_primary_source() from public, anon, authenticated;
create trigger consult_availability_slots_primary_source before insert on public.consult_availability_slots
  for each row execute function private.guard_consult_slot_primary_source();

-- ---------------------------------------------------------------------------
-- 7. Q16: a new clinician's first N red or prescribing cases are all audited
-- ---------------------------------------------------------------------------
alter table public.clinical_audits drop constraint clinical_audits_reason_check;
alter table public.clinical_audits add constraint clinical_audits_reason_check
  check (reason in ('random_sample', 'floor_top_up', 'red_event', 'titration', 'first_tasks', 'lead_request', 'new_clinician_review'));

-- Which completed task is this clinician's n-th red or prescribing case? Ordered by completion time then id, so it is stable.
create function private.new_clinician_case_ordinal(p_task uuid) returns integer
language sql stable security definer set search_path = ''
as $$
  select case when (t.priority_class_original = 1 or t.type = 'red_event_unacknowledged' or t.required_competencies @> array['prescribing']::text[])
           then (select count(*)::integer from public.clinical_tasks x
                  where x.claimed_by = t.claimed_by and x.state = 'completed'
                    and (x.priority_class_original = 1 or x.type = 'red_event_unacknowledged' or x.required_competencies @> array['prescribing']::text[])
                    and (coalesce(x.completed_at, 'infinity'::timestamptz), x.id) <= (coalesce(t.completed_at, 'infinity'::timestamptz), t.id))
         end
    from public.clinical_tasks t where t.id = p_task;
$$;
revoke all on function private.new_clinician_case_ordinal(uuid) from public, anon, authenticated;

create or replace function private.consider_task_for_audit(p_task uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.clinical_tasks%rowtype; s public.clinical_staff%rowtype;
  v_reason text; v_draw numeric; v_rate numeric := (private.quality_setting('sampling') ->> 'random_rate_percent')::numeric;
  v_full integer := coalesce((private.quality_setting('sampling') ->> 'new_clinician_full_review_cases')::integer, 0);
  v_ord integer;
begin
  select * into t from public.clinical_tasks where id = p_task;
  if not found or t.state <> 'completed' or t.claimed_by is null then return null; end if;
  select * into s from public.clinical_staff where profile_id = t.claimed_by;
  if not found then return null; end if;
  v_draw := (abs(hashtextextended(t.id::text || ':' || private.lagos_month(coalesce(t.completed_at, now()))::text, 0)) % 1000000) / 10000.0;
  if t.priority_class_original = 1 or t.type = 'red_event_unacknowledged' then v_reason := 'red_event';
  elsif t.type = 'titration_signoff' then v_reason := 'titration';
  elsif coalesce(s.credentialing_level, 2) = 1 and private.tier1_count(t.claimed_by) < private.tier1_target(s.id) then v_reason := 'first_tasks';
  else
    -- only counted when the rule is on and nothing above already decided the reason (the count walks the clinician's completed tasks)
    if v_full > 0 then v_ord := private.new_clinician_case_ordinal(p_task); end if;
    if v_ord is not null and v_ord <= v_full then v_reason := 'new_clinician_review';
    elsif v_draw < v_rate then v_reason := 'random_sample';
    else return null;
    end if;
  end if;
  return private.create_audit(p_task, v_reason, v_draw);
end;
$$;
