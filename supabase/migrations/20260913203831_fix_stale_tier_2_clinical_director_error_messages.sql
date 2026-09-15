-- The 2026-08-31 doctor-tier collapse (20260831001458_escalation_and_specialist_auto_assignment.sql,
-- finished 20260906141300_collapse_doctor_tier_to_three.sql) replaced the old 6-value doctor_tier
-- ladder (tier_1..tier_5_partner_specialist, care_coordinator) with 4 values
-- (care_coordinator/medical_officer/senior_medical_officer/chief_medical_officer) and retired the
-- orthogonal is_clinical_director column. The gating SQL in these three functions was already
-- correctly migrated to check doctor_tier in ('senior_medical_officer', 'chief_medical_officer') --
-- confirmed live via pg_get_functiondef before writing this migration -- but the user-facing
-- `raise exception` message TEXT still said the old vocabulary ("Tier 2 or above", "Clinical
-- Director" as a separate concept from a tier), which is confusing to a clinician who hits the
-- block today: neither "Tier 2" nor a standalone "Clinical Director" exists in the current enum or
-- UI. This migration changes only the message strings; the gating logic is byte-for-byte identical
-- to the live definitions it replaces.
--
-- Two other functions caught by the same grep (private.enforce_emergency_escalation_tier,
-- private.handle_imaging_order_insert) and two more (private.enforce_safeguarding_concern_attribution,
-- private.stamp_senior_case_review) were checked live and found already corrected by a later
-- migration -- left untouched here.

create or replace function private.enforce_medication_confirm_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  if new.patient_id = (select auth.uid()) then
    return new;
  end if;

  if private.has_prescribing_authority(new.organisation_id) then
    return new;
  end if;

  if old.source is distinct from 'clinician' then
    raise exception 'Only an existing clinician-prescribed medication can be confirmed and continued' using errcode = '42501';
  end if;

  if old.drug_name is distinct from new.drug_name
    or old.dose is distinct from new.dose
    or old.frequency is distinct from new.frequency
    or old.schedule_times is distinct from new.schedule_times
    or old.is_active is distinct from new.is_active
    or old.care_plan_id is distinct from new.care_plan_id
    or old.source is distinct from new.source
    or old.added_by is distinct from new.added_by
    or old.patient_id is distinct from new.patient_id
    or old.organisation_id is distinct from new.organisation_id
    or old.route is distinct from new.route
    or old.duration_days is distinct from new.duration_days
    or old.quantity is distinct from new.quantity
    or old.repeats_allowed is distinct from new.repeats_allowed
    or old.indication is distinct from new.indication
    or old.instructions is distinct from new.instructions
    or old.rx_number is distinct from new.rx_number
    or old.verification_code is distinct from new.verification_code
    or old.expires_at is distinct from new.expires_at
    or old.version is distinct from new.version
    or old.previous_version_id is distinct from new.previous_version_id
    or old.superseded_at is distinct from new.superseded_at
    or old.amendment_reason is distinct from new.amendment_reason
  then
    raise exception 'Confirming a prescription can only update the refill date — changing drug, dose, frequency, or status needs Senior Medical Officer or above' using errcode = '42501';
  end if;

  select id into v_caller_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  new.last_confirmed_at := now();
  new.last_confirmed_by := v_caller_staff_id;

  return new;
end;
$$;

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
    raise exception 'attesting a Health Passport requires Senior Medical Officer or above'
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

create or replace function public.decline_health_passport_attestation(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.health_passport_attestation_requests%rowtype;
begin
  select * into v_req
  from public.health_passport_attestation_requests
  where id = p_request_id;

  if not found or v_req.status <> 'pending' then
    raise exception 'attestation request not found or already actioned'
      using errcode = 'P0002';
  end if;

  if not private.can_attest_health_passport(v_req.organisation_id) then
    raise exception 'declining a Health Passport attestation requires Senior Medical Officer or above'
      using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'a reason is required — the patient is told why'
      using errcode = '22023';
  end if;

  update public.health_passport_attestation_requests
  set status         = 'declined',
      reviewed_by    = (select auth.uid()),
      reviewed_at    = now(),
      decline_reason = trim(p_reason)
  where id = p_request_id;

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload)
  values
    (v_req.organisation_id, v_req.patient_id, 'in_app', 'health_passport_attestation_declined',
     jsonb_build_object('request_id', p_request_id, 'reason', trim(p_reason)));
end;
$$;

do $$
begin
  if pg_get_functiondef('private.enforce_medication_confirm_only()'::regprocedure) ilike '%Tier 2%' then
    raise exception 'enforce_medication_confirm_only still contains stale Tier 2 wording';
  end if;
  if pg_get_functiondef('public.attest_health_passport_request(uuid, text)'::regprocedure) ilike '%Tier 2%' then
    raise exception 'attest_health_passport_request still contains stale Tier 2 wording';
  end if;
  if pg_get_functiondef('public.decline_health_passport_attestation(uuid, text)'::regprocedure) ilike '%Tier 2%' then
    raise exception 'decline_health_passport_attestation still contains stale Tier 2 wording';
  end if;
  if pg_get_functiondef('private.enforce_medication_confirm_only()'::regprocedure) not ilike '%Senior Medical Officer or above%' then
    raise exception 'enforce_medication_confirm_only did not pick up the corrected wording';
  end if;
  if pg_get_functiondef('public.attest_health_passport_request(uuid, text)'::regprocedure) not ilike '%Senior Medical Officer or above%' then
    raise exception 'attest_health_passport_request did not pick up the corrected wording';
  end if;
  if pg_get_functiondef('public.decline_health_passport_attestation(uuid, text)'::regprocedure) not ilike '%Senior Medical Officer or above%' then
    raise exception 'decline_health_passport_attestation did not pick up the corrected wording';
  end if;
end;
$$;
