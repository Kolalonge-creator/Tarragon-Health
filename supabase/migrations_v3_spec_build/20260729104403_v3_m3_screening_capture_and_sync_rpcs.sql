-- M3: screening participant capture + offline sync (build spec v3 §8). Client-invokable (the
-- Expo apps/screening app calls these directly), so -- matching this project's own established
-- pattern for lab_orders_patient/clinical_notes_summary -- these live in `public`, not `private`
-- (authenticated has no USAGE on `private` at all, by design; public.* RPCs are the sanctioned
-- client-facing surface). SECURITY DEFINER with an internal role check, not reliant on RLS.
--
-- Two interpretation notes, ported from the parallel tarragon-control build of this same spec:
-- 1. screening_participants.patient_id is "null until they convert", but readings.patient_id is
--    NOT NULL and a screening-day reading must attach to something. "Convert" can't mean "gets a
--    patients row" (that would make measurement impossible before a separate, later event) -- it
--    has to mean the commercial event tracked by converted_to_enrolment_id/converted_at. So: a
--    patients row (profile_id=null, exactly like an under-18 dependant with no login) is created
--    immediately at capture time; converted_to_enrolment_id stays null until real enrolment.
-- 2. consent_scope has no value for "consent to be measured at this event" -- its five values are
--    all downstream data-sharing scopes. 'clinical_share' is the closest fit (the data this
--    consents to IS clinical data, captured for clinical review) and capture_method='field_tablet'
--    already exists specifically for this scenario.
create or replace function public.capture_screening_participant(
  p_screening_event_id uuid,
  p_temp_ref text,
  p_full_name text,
  p_date_of_birth date,
  p_sex_at_birth sex_at_birth,
  p_phone_e164 text default null,
  p_consent_evidence_path text default null
)
returns table (participant_id uuid, patient_id uuid, consent_record_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_patient_id uuid;
  v_consent_id uuid;
  v_participant_id uuid;
begin
  if private.actor_role() not in ('coordinator','ops_admin','superadmin') then
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

comment on function public.capture_screening_participant is
  'patients is created before consent_records because consent_records.patient_id is a NOT NULL FK -- statement-ordering necessity, not a policy choice. The invariant §8 actually cares about (no measurement before consent) is enforced independently and for real by enforce_screening_consent_before_measurement on readings, not by this function''s internal statement order.';

revoke execute on function public.capture_screening_participant from public;
grant execute on function public.capture_screening_participant to authenticated, service_role;

-- Offline sync target for the screening app's local queue. Never upserts and never applies
-- last-write-wins -- every element is either inserted (genuinely new) or reported
-- duplicate_surfaced/unresolved_participant for the operator to see, per §8's explicit
-- conflict-resolution rule ("last-write-wins is forbidden for readings").
create or replace function public.sync_screening_readings(
  p_screening_event_id uuid,
  p_readings jsonb
)
returns table (temp_ref text, reading_type reading_type, taken_at timestamptz, status text, reading_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb;
  v_patient_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
  v_temp_ref text;
  v_type reading_type;
  v_taken_at timestamptz;
begin
  if private.actor_role() not in ('coordinator','ops_admin','superadmin') then
    raise exception 'Only field-operations staff may sync screening readings.'
      using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(p_readings)
  loop
    v_temp_ref := v_row ->> 'temp_ref';
    v_type := (v_row ->> 'type')::reading_type;
    v_taken_at := (v_row ->> 'taken_at')::timestamptz;

    select sp.patient_id into v_patient_id
    from screening_participants sp
    where sp.screening_event_id = p_screening_event_id
      and sp.temp_ref = v_temp_ref;

    if v_patient_id is null then
      temp_ref := v_temp_ref; reading_type := v_type; taken_at := v_taken_at;
      status := 'unresolved_participant'; reading_id := null;
      return next;
      continue;
    end if;

    select id into v_existing_id
    from readings
    where screening_event_id = p_screening_event_id
      and patient_id = v_patient_id
      and type = v_type
      and readings.taken_at = v_taken_at
      and source = 'screening_day';

    if v_existing_id is not null then
      temp_ref := v_temp_ref; reading_type := v_type; taken_at := v_taken_at;
      status := 'duplicate_surfaced'; reading_id := v_existing_id;
      return next;
      continue;
    end if;

    begin
      insert into readings (
        patient_id, type, value_numeric, systolic, diastolic, unit, taken_at,
        source, source_detail, screening_event_id, device_serial, device_firmware
      ) values (
        v_patient_id,
        v_type,
        (v_row ->> 'value_numeric')::numeric,
        (v_row ->> 'systolic')::int,
        (v_row ->> 'diastolic')::int,
        v_row ->> 'unit',
        v_taken_at,
        'screening_day',
        p_screening_event_id::text,
        p_screening_event_id,
        v_row ->> 'device_serial',
        v_row ->> 'device_firmware'
      )
      returning id into v_new_id;

      temp_ref := v_temp_ref; reading_type := v_type; taken_at := v_taken_at;
      status := 'inserted'; reading_id := v_new_id;
      return next;
    exception
      when unique_violation then
        select id into v_existing_id
        from readings
        where screening_event_id = p_screening_event_id
          and patient_id = v_patient_id
          and type = v_type
          and readings.taken_at = v_taken_at
          and source = 'screening_day';

        temp_ref := v_temp_ref; reading_type := v_type; taken_at := v_taken_at;
        status := 'duplicate_surfaced'; reading_id := v_existing_id;
        return next;
    end;
  end loop;
end;
$$;

comment on function public.sync_screening_readings is
  'Batch sync target for the offline screening app''s local queue. Never upserts and never applies last-write-wins -- every element is either inserted (genuinely new) or reported duplicate_surfaced/unresolved_participant for the operator to see, per §8''s explicit conflict-resolution rule.';

revoke execute on function public.sync_screening_readings from public;
grant execute on function public.sync_screening_readings to authenticated, service_role;
