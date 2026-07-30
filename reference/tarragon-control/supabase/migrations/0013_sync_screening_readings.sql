-- Tarragon Control — M3: offline sync with duplicate surfacing
-- Source: docs/tarragon-build-spec-v3.md §8: "Every reading writes
-- source = 'screening_day' and source_detail = screening_event_id" and
-- "Conflict resolution on sync: last-write-wins is forbidden for
-- readings. Duplicate detection on (screening_event_id, temp_ref, type,
-- taken_at); genuine duplicates are surfaced to the operator, never
-- silently merged."
--
-- The spec's dedup key uses temp_ref, but readings has no temp_ref column
-- -- only patient_id. temp_ref resolves 1:1 to patient_id via
-- screening_participants, PROVIDED temp_ref is unique per event, which
-- the spec's own DDL didn't enforce either -- added here alongside the
-- dedup index, since the whole dedup scheme is meaningless without it.

alter table screening_participants add constraint screening_participants_temp_ref_unique_per_event
  unique (screening_event_id, temp_ref);

-- DB-level backstop matching the dedup key 1:1 (screening_event_id +
-- patient_id stands in for screening_event_id + temp_ref, per the
-- constraint just added). Catches a race between concurrent sync
-- attempts that the application-level check-then-insert below can't.
create unique index screening_reading_dedup
  on readings (screening_event_id, patient_id, type, taken_at)
  where source = 'screening_day';

create or replace function private.sync_screening_readings(
  p_screening_event_id uuid,
  p_readings jsonb
)
returns table (temp_ref text, reading_type reading_type, taken_at timestamptz, status text, reading_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_patient_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
  v_temp_ref text;
  v_type reading_type;
  v_taken_at timestamptz;
begin
  if private.current_role() not in ('coordinator', 'ops_admin', 'superadmin') then
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
      -- Surfaced, never silently dropped: the operator needs to know a
      -- reading arrived for a participant record that doesn't exist
      -- (e.g. the participant capture itself never synced).
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
        -- A concurrent sync won the race between our SELECT and INSERT.
        -- Surface it exactly like a plain duplicate -- never silently
        -- swallowed, never merged.
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

comment on function private.sync_screening_readings is
  'Batch sync target for the offline screening app''s local queue. Never upserts and never applies last-write-wins -- every element is either inserted (genuinely new) or reported duplicate_surfaced/unresolved_participant for the operator to see, per section 8''s explicit conflict-resolution rule.';

revoke execute on function private.sync_screening_readings from public, anon;
grant execute on function private.sync_screening_readings to authenticated, service_role;
