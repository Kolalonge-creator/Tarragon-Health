-- S21 (part 3): the read functions behind the consultation pages and the Care tab lists.
--
--   consultation_room_view(encounter)      what the room page needs for one consultation: your role, status, the join window,
--                                          who has joined, your scribe consent state, and whether "nobody came" can be
--                                          reported yet. Answers null for anyone who is not the patient or the clinician
--                                          (the same answer as an unknown id).
--   my_upcoming_encounters(limit)          the signed-in patient's coming consultations, soonest first.
--   my_clinician_encounters(from, to)      the signed-in clinician's consultations in a range, with the patient's FIRST name only.
-- They return jsonb, which is how the S16 and S17 screens will read too (the shared generated types carry none of the new tables
-- until the whole S21 set is applied; the screens cast the client to an rpc-only shape).
-- Row counts at writing: encounters is new (0 rows). No data is converted.

create function public.consultation_room_view(p_encounter uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  c jsonb := private.consult_policy();
  v_role text;
  v_pat_in boolean;
  v_doc_in boolean;
  s public.scribe_consents;
  v_opens timestamptz;
  v_closes timestamptz;
begin
  if v_uid is null then return null; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null then return null; end if;
  if v_uid = e.patient_id then v_role := 'patient';
  elsif v_uid = e.clinician_id then v_role := 'clinician';
  else return null; end if;
  select coalesce(bool_or(actor_role = 'patient'), false), coalesce(bool_or(actor_role = 'clinician'), false)
    into v_pat_in, v_doc_in from public.encounter_events where encounter_id = e.id and kind = 'joined';
  select * into s from public.scribe_consents where encounter_id = e.id;
  v_opens := e.scheduled_at - ((c ->> 'joinOpensMinutesBefore')::integer * interval '1 minute');
  v_closes := e.scheduled_at + ((c ->> 'joinClosesMinutesAfter')::integer * interval '1 minute');
  return jsonb_build_object(
    'encounter_id', e.id,
    'role', v_role,
    'type', e.type,
    'status', e.status,
    'scheduled_at', e.scheduled_at,
    'final_media_mode', e.final_media_mode,
    'fallback_steps', e.fallback_steps,
    'join_opens_at', v_opens,
    'join_closes_at', v_closes,
    'joinable', e.status in ('scheduled', 'waiting', 'in_progress') and private.encounter_is_on(e) and now() >= v_opens and now() <= v_closes,
    'patient_joined', v_pat_in,
    'clinician_joined', v_doc_in,
    'scribe', jsonb_build_object('asked', s.id is not null, 'granted', s.granted),
    -- the clinician's notes and prescribing screen is keyed on the older consultation row; only the clinician is told its id
    'video_consultation_id', case when v_role = 'clinician' then e.video_consultation_id else null end,
    'can_report_clinician_absent', v_role = 'patient' and e.status in ('scheduled', 'waiting') and not v_doc_in
        and now() >= e.scheduled_at + ((c ->> 'clinicianNoShowWaitMinutes')::integer * interval '1 minute'),
    'can_report_patient_absent', v_role = 'clinician' and e.status in ('scheduled', 'waiting') and not v_pat_in
        and now() >= e.scheduled_at + ((c ->> 'patientNoShowWaitMinutes')::integer * interval '1 minute'),
    'clinician_wait_minutes', (c ->> 'clinicianNoShowWaitMinutes')::integer,
    'patient_wait_minutes', (c ->> 'patientNoShowWaitMinutes')::integer,
    'reconnect_grace_seconds', (c ->> 'reconnectGraceSeconds')::integer,
    'session_minutes', (c ->> 'sessionMinutes')::integer);
end;
$$;
revoke all on function public.consultation_room_view(uuid) from public, anon;
grant execute on function public.consultation_room_view(uuid) to authenticated;

create function public.my_upcoming_encounters(p_limit integer default 20) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.scheduled_at), '[]'::jsonb)
    from (
      select e.id as encounter_id, e.type, e.status, e.scheduled_at, e.appointment_id, e.final_media_mode
        from public.encounters e
       where e.patient_id = (select auth.uid())
         and e.status in ('scheduled', 'waiting', 'in_progress')
         and e.scheduled_at >= now() - interval '2 hours'
       order by e.scheduled_at
       limit greatest(1, least(coalesce(p_limit, 20), 50))
    ) x;
$$;
revoke all on function public.my_upcoming_encounters(integer) from public, anon;
grant execute on function public.my_upcoming_encounters(integer) to authenticated;

create function public.my_clinician_encounters(p_from timestamptz default null, p_to timestamptz default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.scheduled_at), '[]'::jsonb)
    from (
      select e.id as encounter_id, e.type, e.status, e.scheduled_at, e.final_media_mode,
             split_part(coalesce(p.full_name, ''), ' ', 1) as patient_first_name
        from public.encounters e
        join public.profiles p on p.id = e.patient_id
       where e.clinician_id = (select auth.uid())
         and e.scheduled_at >= coalesce(p_from, date_trunc('day', now()))
         and e.scheduled_at < coalesce(p_to, date_trunc('day', now()) + interval '2 days')
       order by e.scheduled_at
       limit 200
    ) x;
$$;
revoke all on function public.my_clinician_encounters(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_clinician_encounters(timestamptz, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.consultation_room_view(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_upcoming_encounters(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_clinician_encounters(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'S21c: anon can execute a consultation read function';
  end if;
end $$;
