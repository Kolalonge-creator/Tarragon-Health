-- Tarragon Control — M3: attach-rate instrumentation
-- Source: docs/tarragon-build-spec-v3.md §8: "Attach-rate instrumentation:
-- screening_participants.converted_to_enrolment_id and converted_at. The
-- internal dashboard reports 30-day attach rate per event. This is the
-- primary go-to-market metric."
--
-- If a patient attended more than one screening event before eventually
-- enrolling, only their MOST RECENT still-unconverted screening_participants
-- row is stamped -- crediting every event they ever attended would inflate
-- attach rate for all of them. Not specified in the spec; a defensible,
-- documented tie-break, not a silent guess.

create or replace function private.stamp_screening_conversion_on_enrolment_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_id uuid;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if TG_OP = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  select sp.id into v_participant_id
  from screening_participants sp
  join screening_events se on se.id = sp.screening_event_id
  where sp.patient_id = new.patient_id
    and sp.converted_to_enrolment_id is null
  order by se.held_on desc
  limit 1;

  if v_participant_id is not null then
    update screening_participants
    set converted_to_enrolment_id = new.id, converted_at = now()
    where id = v_participant_id;
  end if;

  return new;
end;
$$;

create trigger trg_stamp_screening_conversion
  after insert or update of status on enrolments
  for each row
  execute function private.stamp_screening_conversion_on_enrolment_active();

create or replace function private.screening_event_attach_rate(p_screening_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held_on date;
  v_total int;
  v_converted_30d int;
begin
  if private.current_role() not in ('clinician', 'coordinator', 'ops_admin', 'superadmin') then
    raise exception 'Only internal staff may read screening-event attach rate.'
      using errcode = '42501';
  end if;

  select held_on into v_held_on from screening_events where id = p_screening_event_id;
  if v_held_on is null then
    raise exception 'No such screening_events row: %', p_screening_event_id;
  end if;

  select count(*) into v_total
  from screening_participants where screening_event_id = p_screening_event_id;

  select count(*) into v_converted_30d
  from screening_participants
  where screening_event_id = p_screening_event_id
    and converted_at is not null
    and converted_at::date <= v_held_on + interval '30 days';

  return jsonb_build_object(
    'screening_event_id', p_screening_event_id,
    'total_participants', v_total,
    'converted_within_30_days', v_converted_30d,
    'attach_rate', case when v_total = 0 then 0 else round(v_converted_30d::numeric / v_total, 4) end
  );
end;
$$;

revoke execute on function private.screening_event_attach_rate from public, anon;
grant execute on function private.screening_event_attach_rate to authenticated, service_role;
