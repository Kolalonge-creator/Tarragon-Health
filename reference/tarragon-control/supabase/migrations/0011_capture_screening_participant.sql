-- Tarragon Control — M3: screening participant capture
-- Source: docs/tarragon-build-spec-v3.md §8: "Participant capture: name,
-- DOB, sex, phone, consent (captured before any measurement), temp_ref."
--
-- Resolves two things left ambiguous by the schema:
--
-- 1. screening_participants.patient_id is commented "null until they
--    convert", but readings.patient_id is NOT NULL (section 5.5) and a
--    screening-day reading must attach to something. Read literally,
--    "convert" can't mean "gets a patients row" (that would make
--    measurement impossible for anyone who hasn't separately "converted"
--    first) -- it has to mean the SEPARATE, later, commercial event
--    tracked by converted_to_enrolment_id/converted_at (becoming a paying
--    enrolled Control/Concierge patient, the 30-day attach-rate metric).
--    So: a patients row (profile_id=null, exactly like an under-18
--    dependant with no login) is created immediately at capture time,
--    the same way name/DOB/sex are captured immediately -- and
--    converted_to_enrolment_id stays null until a real, later enrolment.
--
-- 2. consent_scope has no value for "consent to be measured at this
--    event" -- its five values are all downstream data-sharing scopes
--    (funder/institution/clinical/escalation/research), not a first-order
--    "yes, take my blood pressure" consent. 'clinical_share' is the
--    closest fit (the data this consents to IS clinical data, captured
--    for clinical review) and capture_method='field_tablet' already
--    exists specifically for this scenario -- strong evidence this is
--    the intended path, just not spelled out. Documented, not hidden.
--
-- Statement order below is patients -> consent_records -> screening_participants
-- (not consent-first): consent_records.patient_id is NOT NULL (section 5.8),
-- so a bare consent row can't be created before a patients row exists to
-- reference. This does NOT violate "consent before any measurement" --
-- creating a demographic record is not a measurement, and no reading can
-- exist at any point during this function (nothing here writes to
-- readings). The actual ordering invariant is enforced independently and
-- for real by trg_enforce_screening_consent_before_measurement on readings.

create or replace function private.capture_screening_participant(
  p_screening_event_id uuid,
  p_temp_ref text,
  p_full_name text,
  p_date_of_birth date,
  p_sex_at_birth sex_at_birth,
  p_phone_e164 text default null,
  p_consent_evidence_path text default null
)
returns table (participant_id uuid, patient_id uuid, consent_record_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_consent_id uuid;
  v_participant_id uuid;
begin
  if private.current_role() not in ('coordinator', 'ops_admin', 'superadmin') then
    raise exception 'Only field-operations staff (coordinator/ops_admin/superadmin) may capture a screening participant.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from screening_events where id = p_screening_event_id) then
    raise exception 'No such screening_events row: %', p_screening_event_id;
  end if;

  insert into patients (profile_id, date_of_birth, sex_at_birth)
  values (null, p_date_of_birth, p_sex_at_birth)
  returning id into v_patient_id;

  insert into consent_records (patient_id, scope, capture_method, evidence_path, captured_by)
  values (v_patient_id, 'clinical_share', 'field_tablet', p_consent_evidence_path, auth.uid())
  returning id into v_consent_id;

  insert into screening_participants (
    screening_event_id, patient_id, temp_ref, full_name, phone_e164, consented, consent_record_id
  ) values (
    p_screening_event_id, v_patient_id, p_temp_ref, p_full_name, p_phone_e164, true, v_consent_id
  )
  returning id into v_participant_id;

  return query select v_participant_id, v_patient_id, v_consent_id;
end;
$$;

comment on function private.capture_screening_participant is
  'patients is created before consent_records because consent_records.patient_id is a NOT NULL FK -- this is a statement-ordering necessity, not a policy choice. The invariant section 8 actually cares about (no measurement before consent) is enforced independently and for real by the consent-before-measurement trigger on readings (private.enforce_screening_consent_before_measurement), not by this function''s internal statement order.';

revoke execute on function private.capture_screening_participant from public, anon;
grant execute on function private.capture_screening_participant to authenticated, service_role;
