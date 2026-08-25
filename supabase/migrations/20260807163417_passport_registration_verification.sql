-- Attesting a Health Passport needs a CHECKED registration, not a typed one.
--
-- The Health Passport migration gated attestation on `credential_type` and
-- `credential_number` being non-empty. That is too weak for the one document on
-- this platform designed to be read by a stranger who has no other way to judge
-- it: an embassy or a UK GP surgery is being told "this record was attested by a
-- doctor holding MDCN registration N", and the only thing behind that today is
-- that somebody typed N into a form. Nobody checked it against the register.
--
-- ⚠️ WHY THIS IS NOT `license_verified_at`. That column already exists and looks
-- like the answer. It is not, and conflating them would break real accounts:
--
--   * `license_verified_at` gates ACTIVATION (clinical_staff_active_requires_
--     verification). It means "cleared to work here", and it is legitimately set
--     on records that have no registration number at all — a Care Coordinator is
--     employed, non-clinical, active, and has no MDCN number to check. A
--     constraint requiring a credential wherever `license_verified_at` is set
--     would make every Care Coordinator unactivatable.
--   * It is also, in practice, set without a `verified_by` on at least one live
--     record, so it cannot even prove a person performed the check.
--
--   `clinical-staff-manager.tsx` already carries a comment saying exactly this
--   ("only records that *something* was marked verified, not that a real
--   credential backs it") and renders a badge for it. This migration turns that
--   known, surfaced gap into an enforced one for the single act that needs it.
--
-- So this adds a NARROWER, separate claim beside it: this specific registration
-- number was checked, by this named person, on this date. Nothing else on the
-- platform is gated on it, so nothing else can break.
--
-- ⚠️ THE DEADLOCK THIS DOES NOT SOLVE, AND MUST NOT. `clinical_staff_no_self_
-- verification` (2026-07-12) forbids verifying yourself, per
-- docs/CLINICAL_TRUST_MODEL_SPEC.md §5 — "License verification, not
-- self-attestation". The same rule is applied here. As of this migration the
-- platform has exactly one real staff record (the founder, Clinical Director)
-- and one real admin (the same person), so there is literally nobody who may
-- verify them. That is why zero passports are attestable in production, and it
-- is a governance fact, not a bug: a solo operator cannot self-certify to an
-- embassy and have that mean anything. It is resolved by a second real admin
-- existing, never by relaxing this constraint.

alter table public.clinical_staff
  add column if not exists credential_verified_at timestamptz,
  add column if not exists credential_verified_by uuid references public.profiles (id) on delete restrict;

comment on column public.clinical_staff.credential_verified_at is
  'When this staff member''s registration number was checked against the issuing register. DISTINCT from license_verified_at, which gates activation and is legitimately set on non-clinical records with no registration at all. Only Health Passport attestation is gated on this.';

comment on column public.clinical_staff.credential_verified_by is
  'The admin who performed the register check. Never the staff member themselves (clinical_staff_no_self_credential_verification).';

-- All-or-nothing, and never a verification of nothing: a checked registration
-- has a date, a checker, and a number to have checked. Same discipline as
-- health_passport_attestation_complete — a half-populated claim is the failure
-- mode that puts an unbacked registration number in front of an institution.
alter table public.clinical_staff
  drop constraint if exists clinical_staff_credential_verification_complete;
alter table public.clinical_staff
  add constraint clinical_staff_credential_verification_complete
  check (
    credential_verified_at is null
    or (
      credential_verified_by is not null
      and credential_type is not null and length(trim(credential_type)) > 0
      and credential_number is not null and length(trim(credential_number)) > 0
    )
  );

alter table public.clinical_staff
  drop constraint if exists clinical_staff_no_self_credential_verification;
alter table public.clinical_staff
  add constraint clinical_staff_no_self_credential_verification
  check (
    credential_verified_by is null
    or profile_id is null
    or credential_verified_by <> profile_id
  );

-- Editing the number must invalidate the check. Otherwise an admin could verify
-- "MDCN/R/1", then quietly change it to "MDCN/R/2" and keep the tick — which is
-- precisely the forgery this whole feature exists to make impossible.
create or replace function private.clear_credential_verification_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.credential_type is distinct from old.credential_type
     or new.credential_number is distinct from old.credential_number then
    -- Unless this very statement is the one recording the check.
    if new.credential_verified_at is not distinct from old.credential_verified_at then
      new.credential_verified_at := null;
      new.credential_verified_by := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_staff_credential_change on public.clinical_staff;
create trigger clinical_staff_credential_change
  before update on public.clinical_staff
  for each row
  execute function private.clear_credential_verification_on_change();

revoke all on function private.clear_credential_verification_on_change() from public, anon;

-- ------------------------------------------------- record the check (admin only)

create or replace function public.verify_clinical_staff_credential(p_clinical_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.clinical_staff%rowtype;
begin
  if not private.is_admin() then
    raise exception 'only a platform admin may verify a registration number'
      using errcode = '42501';
  end if;

  select * into v_row from public.clinical_staff where id = p_clinical_staff_id;
  if not found then
    raise exception 'staff record not found' using errcode = 'P0002';
  end if;

  if v_row.credential_type is null or v_row.credential_number is null
     or length(trim(v_row.credential_number)) = 0 then
    raise exception 'there is no registration number on this record to verify'
      using errcode = '22023';
  end if;

  if v_row.profile_id = (select auth.uid()) then
    raise exception 'you cannot verify your own registration — this needs a second admin'
      using errcode = '42501';
  end if;

  update public.clinical_staff
  set credential_verified_at = now(),
      credential_verified_by = (select auth.uid())
  where id = p_clinical_staff_id;
end;
$$;

create or replace function public.revoke_clinical_staff_credential_verification(
  p_clinical_staff_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only a platform admin may withdraw a registration verification'
      using errcode = '42501';
  end if;

  update public.clinical_staff
  set credential_verified_at = null, credential_verified_by = null
  where id = p_clinical_staff_id;

  -- Deliberately does NOT revoke passports already issued under this doctor's
  -- name. Those documents recorded what was true when they were issued, and the
  -- attestation on them is snapshotted for exactly that reason. If a
  -- registration turns out to have been wrong, the passports themselves are
  -- revoked individually through revoke_health_passport, which is a separate,
  -- deliberate act with its own reason.
  perform p_reason;
end;
$$;

revoke all on function public.verify_clinical_staff_credential(uuid) from public, anon;
revoke all on function public.revoke_clinical_staff_credential_verification(uuid, text) from public, anon;
grant execute on function public.verify_clinical_staff_credential(uuid) to authenticated;
grant execute on function public.revoke_clinical_staff_credential_verification(uuid, text) to authenticated;

-- ------------------------------------------- tighten the attestation gate itself

create or replace function public.attest_health_passport_request(
  p_request_id uuid,
  p_statement  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   public.health_passport_attestation_requests%rowtype;
  v_staff public.clinical_staff%rowtype;
begin
  select * into v_req
  from public.health_passport_attestation_requests
  where id = p_request_id;

  if not found or v_req.status <> 'pending' then
    raise exception 'attestation request not found or already actioned'
      using errcode = 'P0002';
  end if;

  if not private.can_attest_health_passport(v_req.organisation_id) then
    raise exception 'attesting a Health Passport requires Tier 2 or above, or Clinical Director'
      using errcode = '42501';
  end if;

  select * into v_staff
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_req.organisation_id
    and active;

  if v_staff.credential_type is null or v_staff.credential_number is null
     or length(trim(v_staff.credential_number)) = 0 then
    raise exception 'a registration authority and number must be on your staff record before you can attest a passport'
      using errcode = '42501';
  end if;

  -- The tightening. A typed number is not a checked number, and this document is
  -- read by people who cannot tell the difference unless we refuse to blur it.
  if v_staff.credential_verified_at is null then
    raise exception 'your registration number has not been verified by an administrator yet — an attested passport asserts a registration an institution can look up'
      using errcode = '42501';
  end if;

  update public.health_passport_attestation_requests
  set status      = 'attested',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      statement   = nullif(trim(coalesce(p_statement, '')), '')
  where id = p_request_id;

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload)
  values
    (v_req.organisation_id, v_req.patient_id, 'in_app', 'health_passport_attested',
     jsonb_build_object('request_id', p_request_id)),
    (v_req.organisation_id, v_req.patient_id, 'email', 'health_passport_attested',
     jsonb_build_object('request_id', p_request_id));

  return p_request_id;
end;
$$;

-- And the same check where the passport is actually minted, because an
-- attestation granted last month must not still mint a passport if the
-- registration behind it has since been withdrawn.
create or replace function public.mint_health_passport(
  p_attestation_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_req     public.health_passport_attestation_requests%rowtype;
  v_staff   public.clinical_staff%rowtype;
  v_doctor  public.profiles%rowtype;
  v_serial  text;
  v_id      uuid;
  v_issued  timestamptz := now();
  v_expires timestamptz := now() + interval '12 months';
begin
  select * into v_profile
  from public.profiles
  where id = (select auth.uid()) and role = 'patient' and receives_care;

  if not found or v_profile.organisation_id is null then
    raise exception 'only a patient receiving care may issue their own Health Passport'
      using errcode = '42501';
  end if;

  if v_profile.full_name is null or length(trim(v_profile.full_name)) = 0 then
    raise exception 'a Health Passport cannot be issued without a name on the account'
      using errcode = '22023';
  end if;

  if p_attestation_request_id is not null then
    select * into v_req
    from public.health_passport_attestation_requests
    where id = p_attestation_request_id
      and patient_id = v_profile.id
      and status = 'attested';

    if not found then
      raise exception 'that attestation is not available for this patient'
        using errcode = 'P0002';
    end if;

    select * into v_staff
    from public.clinical_staff
    where profile_id = v_req.reviewed_by
      and organisation_id = v_req.organisation_id;

    select * into v_doctor from public.profiles where id = v_req.reviewed_by;

    if v_staff.credential_type is null or v_staff.credential_number is null then
      raise exception 'the attesting doctor no longer has a registration number on file'
        using errcode = '42501';
    end if;

    if v_staff.credential_verified_at is null then
      raise exception 'the attesting doctor''s registration verification has since been withdrawn'
        using errcode = '42501';
    end if;
  end if;

  v_serial := private.new_passport_serial();

  insert into public.health_passport_issuances (
    patient_id, organisation_id, serial, status,
    subject_name, subject_dob, subject_patient_number,
    issued_at, expires_at,
    attestation_request_id, attested_by, attested_at,
    attesting_doctor_name, attesting_credential_type, attesting_credential_number,
    attestation_statement
  ) values (
    v_profile.id, v_profile.organisation_id, v_serial, 'unsigned',
    trim(v_profile.full_name), v_profile.date_of_birth, v_profile.patient_number,
    v_issued, v_expires,
    case when v_req.id is not null then v_req.id end,
    v_req.reviewed_by,
    v_req.reviewed_at,
    case when v_req.id is not null then coalesce(v_staff.full_name, v_doctor.full_name) end,
    v_staff.credential_type,
    v_staff.credential_number,
    v_req.statement
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'serial', v_serial,
    'organisation_id', v_profile.organisation_id,
    'subject_name', trim(v_profile.full_name),
    'subject_dob', v_profile.date_of_birth,
    'subject_patient_number', v_profile.patient_number,
    'issued_at', v_issued,
    'expires_at', v_expires,
    'attestation', case
      when v_req.id is null then null
      else jsonb_build_object(
        'doctor_name', coalesce(v_staff.full_name, v_doctor.full_name),
        'credential_type', v_staff.credential_type,
        'credential_number', v_staff.credential_number,
        'attested_at', v_req.reviewed_at,
        'statement', v_req.statement,
        'purpose', v_req.purpose
      )
    end
  );
end;
$$;

revoke all on function public.attest_health_passport_request(uuid, text) from public, anon;
revoke all on function public.mint_health_passport(uuid) from public, anon;
grant execute on function public.attest_health_passport_request(uuid, text) to authenticated;
grant execute on function public.mint_health_passport(uuid) to authenticated;

-- ------------------------------------------------------------- assertions

do $$
declare
  v_bad integer;
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clinical_staff_credential_verification_complete'
      and conrelid = 'public.clinical_staff'::regclass
  ) then
    raise exception 'the credential-verification completeness constraint is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'clinical_staff_no_self_credential_verification'
      and conrelid = 'public.clinical_staff'::regclass
  ) then
    raise exception 'self-verification of a registration must be structurally impossible';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'clinical_staff_credential_change'
  ) then
    raise exception 'editing a registration number must clear its verification';
  end if;
  if has_function_privilege('anon', 'public.verify_clinical_staff_credential(uuid)', 'EXECUTE') then
    raise exception 'registration verification must never be anon-executable';
  end if;

  -- Nothing existing may already violate the new rules.
  select count(*) into v_bad from public.clinical_staff
  where credential_verified_at is not null
    and (credential_verified_by is null or credential_number is null);
  if v_bad > 0 then
    raise exception '% staff rows carry an incomplete credential verification', v_bad;
  end if;

  -- Loud, deliberate notice rather than a silent pass: this is the real reason
  -- no passport is attestable in production, and it is a governance state
  -- somebody has to act on, not a bug in this migration.
  select count(*) into v_bad
  from public.clinical_staff
  where active and credential_verified_at is not null;
  raise notice 'staff with a verified registration (eligible to attest a Health Passport): %', v_bad;
end $$;
