-- Same false-attribution bug class as escalation_and_consult_clinical_tier_gate
-- and review_completion_clinical_tier_gate: private.enforce_vaccination_verification()
-- gated adjudication on private.is_org_staff(organisation_id), which admits
-- care_coordinator, and the matching app-layer check
-- (apps/web/src/app/(dashboard)/clinician/vaccinations/actions.ts's
-- decideVaccinationVerification) only checked "has an active clinical_staff
-- row" -- true for a Care Coordinator too, despite both the DB comment and the
-- app comment explicitly claiming a Care Coordinator was excluded ("this is
-- the DB backstop that a plain patient session cannot cross" / "not a Care
-- Coordinator or other org staff"). Neither claim was actually enforced.
--
-- This one is a step worse than the review-completion bugs: verified_by here
-- feeds apps/web/src/lib/vaccination/get-certificate-data.ts, which renders
-- the Tarragon-issued, potentially externally-shared vaccination certificate
-- (the Health Passport verifiable credential surface) with a "verified by"
-- clinical_staff lookup that also has no tier filter. A Care Coordinator
-- could therefore have adjudicated a patient-uploaded certificate and had a
-- real, serial-numbered Tarragon certificate issued under their own false
-- clinical attribution.
--
-- No live vaccination_records row currently carries this bad state (checked:
-- zero rows where verified_by resolves to a care_coordinator), so this is a
-- closed-gap fix, not a backfill. Verified live in a rolled-back transaction
-- with a temporary test row: the real care_coordinator profile was blocked
-- (42501); the real tier_3 clinician succeeded on the same row.

create or replace function private.enforce_vaccination_verification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.verification_status in ('verified', 'rejected') then
    -- Adjudicating a certificate is a clinical judgement, not logistics --
    -- private.is_clinical_tier (not is_org_staff) is the real backstop a Care
    -- Coordinator's session cannot cross, matching the app-layer gate.
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can verify or reject a vaccination record. A Care Coordinator can prepare the case, but a doctor must adjudicate it.'
        using errcode = '42501';
    end if;

    -- Server-derived attribution — cannot be spoofed to another doctor.
    new.verified_by := (select auth.uid());
    if new.verified_at is null then
      new.verified_at := now();
    end if;
  else
    -- Any non-adjudicated state carries no attribution or note.
    new.verified_by := null;
    new.verified_at := null;
    new.verification_note := null;
  end if;

  -- The Tarragon certificate exists only on a verified record, and its serial
  -- is issued exactly once (never reissued, never client-supplied).
  if new.verification_status = 'verified' then
    if tg_op = 'UPDATE' and old.verification_status = 'verified' then
      new.tarragon_certificate_serial := old.tarragon_certificate_serial;
      new.tarragon_certificate_issued_at := old.tarragon_certificate_issued_at;
    else
      if new.tarragon_certificate_serial is null then
        new.tarragon_certificate_serial :=
          'TAR-VAX-' || lpad(nextval('public.vaccination_certificate_serial_seq')::text, 6, '0');
      end if;
      new.tarragon_certificate_issued_at := now();
    end if;
  else
    new.tarragon_certificate_serial := null;
    new.tarragon_certificate_issued_at := null;
  end if;

  return new;
end;
$function$;
