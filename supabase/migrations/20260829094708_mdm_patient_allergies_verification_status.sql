-- Tarragon Health — Health Data Architecture & MDM (spec §34.8)
-- Provenance completeness pass: patient_allergies.verification_status.
--
-- AUDIT METHOD (not guesswork): queried pg_attribute directly for every
-- table in the platform's own 21-table audited clinical core plus the
-- patient-profile tables, checking for a source column, a creator column
-- (recorded_by/created_by/set_by/confirmed_by/etc.), a timestamp, and a
-- verification-style signal. Almost everything already has full §34.8
-- coverage — vitals_readings alone carries source, logged_by_profile_id,
-- AND validation_status/validated_by/validated_at; patient_diabetes_
-- profile already has exactly this migration's shape (patient_reported_
-- type vs confirmed_type/confirmed_by/confirmed_at); patient_blood_
-- profile has provenance/recorded_by/recorded_at/attested_at. This
-- migration's own header exists specifically because ONE real gap turned
-- up, not a pattern of gaps: patient_allergies has source + recorded_by +
-- timestamps, same as every table above, but NO verification signal at
-- all — despite CLAUDE.md itself calling this table out as "this
-- platform's own reference-quality pattern for a safety-critical field"
-- (drug-interaction checking reads it) elsewhere in the same document.
--
-- WHY THIS MATTERS FOR patient_allergies SPECIFICALLY
-- patient_allergies.source can be 'patient' (self-reported, e.g. "I think
-- I'm allergic to penicillin" typed during onboarding, never clinically
-- confirmed), 'clinician', or 'fhir_import' (an external record, also
-- unconfirmed by THIS platform's own clinicians). Right now every one of
-- those rows is read identically by drug-safety checks — there is no way
-- to distinguish a patient's unconfirmed guess from something a clinician
-- has actually reviewed and stands behind. This migration adds that
-- signal without changing any existing read path's behaviour (the column
-- is additive; nothing currently queries it).
--
-- SHAPE: mirrors patient_diabetes_profile's confirmed_type/confirmed_by/
-- confirmed_at pattern rather than inventing a new one. 'unverified' is
-- the default and requires verified_by/verified_at to stay null;
-- anything else requires both, enforced by a check constraint AND a
-- trigger (a patient must not be able to self-verify their own allergy
-- claim, which a bare check constraint can't see who is calling).

create type public.allergy_verification_status as enum ('unverified', 'confirmed', 'refuted');

alter table public.patient_allergies
  add column verification_status public.allergy_verification_status not null default 'unverified',
  add column verified_by uuid references public.profiles (id) on delete set null,
  add column verified_at timestamptz,
  add constraint patient_allergies_verification_consistency check (
    (verification_status = 'unverified' and verified_by is null and verified_at is null)
    or (verification_status <> 'unverified' and verified_by is not null and verified_at is not null)
  );

comment on column public.patient_allergies.verification_status is
  'Whether a clinician has reviewed this allergy claim (§34.8 provenance). Defaults unverified — a patient-reported or fhir_import allergen stays unverified until org staff confirms or refutes it via the trigger below; verified_by/verified_at are system-set, never client-supplied.';

-- Only org staff may move a row off 'unverified', and verified_by/
-- verified_at are ALWAYS system-set (never trusted from client input) —
-- same null-gated-attribution discipline as the platform's ReviewedByDoctor
-- pattern (CLINICAL_TRUST_MODEL_SPEC.md §2/§9): a verification claim must
-- come from a real authenticated staff action, not a value typed into a
-- form field.
create or replace function private.enforce_allergy_verification_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.verification_status = 'unverified' then
    NEW.verified_by := null;
    NEW.verified_at := null;
    return NEW;
  end if;

  if not private.is_org_staff(NEW.organisation_id) then
    raise exception 'only organisation staff may confirm or refute an allergy';
  end if;

  NEW.verified_by := (select auth.uid());
  NEW.verified_at := now();
  return NEW;
end;
$$;

comment on function private.enforce_allergy_verification_authority is
  'Blocks a non-staff caller (i.e. the patient themselves) from setting patient_allergies.verification_status to anything but unverified, and always system-sets verified_by/verified_at rather than trusting client input.';

create trigger patient_allergies_enforce_verification_authority
  before insert or update of verification_status on public.patient_allergies
  for each row execute function private.enforce_allergy_verification_authority();

grant execute on function private.enforce_allergy_verification_authority() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------

do $$
declare
  v_org_id     uuid;
  v_patient_id uuid;
  v_row_id     uuid;
  v_wrongly_succeeded boolean := false;
begin
  select id into v_org_id from public.organisations limit 1;
  select id into v_patient_id from public.profiles where role = 'patient' limit 1;

  if v_org_id is not null and v_patient_id is not null then
    -- A default insert must land as unverified with null attestation.
    insert into public.patient_allergies (organisation_id, patient_id, allergen, source)
    values (v_org_id, v_patient_id, 'provenance test allergen', 'patient')
    returning id into v_row_id;

    if not exists (
      select 1 from public.patient_allergies
      where id = v_row_id and verification_status = 'unverified' and verified_by is null and verified_at is null
    ) then
      raise exception 'FAIL: default patient_allergies insert did not land as unverified/null-attested';
    end if;

    -- patient_allergies also requires app.change_reason on any UPDATE/
    -- DELETE (capture_record_correction_trg, see 20260827201314) — set it
    -- so this test actually exercises the verification guard rather than
    -- tripping the unrelated correction-reason guard first.
    perform set_config('app.change_reason', 'provenance migration self-test', true);

    -- A non-staff (this migration runs as postgres, which is NOT what
    -- private.is_org_staff() checks — is_org_staff reads profiles via
    -- auth.uid(), which is null in a migration context, so the guard
    -- should reject exactly like a patient session would) confirmation
    -- attempt must be rejected.
    begin
      update public.patient_allergies set verification_status = 'confirmed' where id = v_row_id;
      v_wrongly_succeeded := true;
    exception
      when others then
        if sqlerrm not like '%only organisation staff may confirm or refute%' then
          raise exception 'FAIL: unexpected error from allergy verification guard: %', sqlerrm;
        end if;
    end;

    if v_wrongly_succeeded then
      raise exception 'FAIL: patient_allergies verification_status was set to confirmed by a non-staff caller';
    end if;

    delete from public.patient_allergies where id = v_row_id;
  end if;
end;
$$;
