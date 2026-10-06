-- S21 (part 2): the service-role functions the consultation pages and webhooks use to open a room and record events.
--
--   service_get_encounter_room(encounter)       what the server needs to decide a join: who, when, status, the room reference,
--                                               and whether the join window is open (policy joinOpensMinutesBefore and
--                                               joinClosesMinutesAfter). Never returns a join URL (none is stored).
--   service_open_encounter_room(encounter, ...) records the vendor room once; a second call returns the first room and says so,
--                                               so a lost race can end its own orphan room.
--   service_record_encounter_event(...)         for webhooks and the phone bridge: the same whitelisted payload keys as the
--                                               app path, any actor role.
--   service_record_join(encounter, role, mode)  the ONLY way a 'joined' event is written: the server records it after checking the
--                                               person and the join window. A person cannot vouch for their own presence, so a
--                                               clinician who never came cannot block the patient's no-show report.
--   service_set_phone_mode(encounter)           the ONLY way a consultation is put on the phone, once a bridge has really started.
-- All three are service_role only. The app's own session never calls them: the Next.js server action first checks the signed-in
-- user against the encounter (RLS) and only then calls these with the service client (the same shape as the other S-series
-- server actions). Row counts at writing: encounters, encounter_rooms, encounter_events are all new in part 1 (0 rows).

create function public.service_get_encounter_room(p_encounter uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  e public.encounters;
  r public.encounter_rooms;
  c jsonb := private.consult_policy();
  v_opens timestamptz;
  v_closes timestamptz;
begin
  select * into e from public.encounters where id = p_encounter;
  if e.id is null then return null; end if;
  select * into r from public.encounter_rooms where encounter_id = e.id;
  v_opens := e.scheduled_at - ((c ->> 'joinOpensMinutesBefore')::integer * interval '1 minute');
  v_closes := e.scheduled_at + ((c ->> 'joinClosesMinutesAfter')::integer * interval '1 minute');
  return jsonb_build_object(
    'encounter_id', e.id,
    'organisation_id', e.organisation_id,
    'patient_id', e.patient_id,
    'clinician_id', e.clinician_id,
    'type', e.type,
    'status', e.status,
    'scheduled_at', e.scheduled_at,
    'final_media_mode', e.final_media_mode,
    'is_test', e.is_test,
    'join_opens_at', v_opens,
    'join_closes_at', v_closes,
    'joinable', e.status in ('scheduled', 'waiting', 'in_progress') and private.encounter_is_on(e) and now() >= v_opens and now() <= v_closes,
    'room', case when r.id is null then null else jsonb_build_object(
      'provider', r.provider, 'provider_room_id', r.provider_room_id, 'state', r.state, 'expires_at', r.expires_at) end,
    'session_minutes', (c ->> 'sessionMinutes')::integer,
    'reconnect_grace_seconds', (c ->> 'reconnectGraceSeconds')::integer);
end;
$$;
revoke all on function public.service_get_encounter_room(uuid) from public, anon, authenticated;
grant execute on function public.service_get_encounter_room(uuid) to service_role;

create function public.service_open_encounter_room(p_encounter uuid, p_provider text, p_room_id text, p_expires_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.encounter_rooms;
  v_created boolean := false;
begin
  if p_provider not in ('zoom', 'mock') then raise exception 'unknown provider' using errcode = '22023'; end if;
  if p_room_id is null or length(p_room_id) = 0 or length(p_room_id) > 64 then raise exception 'room id is required' using errcode = '22023'; end if;
  select * into r from public.encounter_rooms where encounter_id = p_encounter for update;
  if r.id is null then raise exception 'no room for this consultation' using errcode = 'P0002'; end if;
  if r.provider_room_id is null then
    update public.encounter_rooms
       set provider = p_provider, provider_room_id = p_room_id, state = 'open', expires_at = p_expires_at
     where id = r.id returning * into r;
    v_created := true;
  end if;
  return jsonb_build_object('provider', r.provider, 'provider_room_id', r.provider_room_id, 'state', r.state,
                            'expires_at', r.expires_at, 'created', v_created);
end;
$$;
revoke all on function public.service_open_encounter_room(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.service_open_encounter_room(uuid, text, text, timestamptz) to service_role;

create function public.service_record_encounter_event(p_encounter uuid, p_kind text, p_actor_role text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_actor_role not in ('patient', 'clinician', 'system') then raise exception 'unknown actor role' using errcode = '22023'; end if;
  if p_kind not in ('left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested', 'phone_connected', 'reconnect_grace_started', 'room_created') then
    raise exception 'that event cannot be recorded here' using errcode = '22023';
  end if;
  if not exists (select 1 from public.encounters where id = p_encounter) then raise exception 'consultation not found' using errcode = 'P0002'; end if;
  perform private.log_encounter_event(p_encounter, p_kind, null, p_actor_role, private.clean_encounter_payload(p_payload));
end;
$$;
revoke all on function public.service_record_encounter_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.service_record_encounter_event(uuid, text, text, jsonb) to service_role;

create function public.service_record_join(p_encounter uuid, p_role text, p_mode text default 'video') returns public.encounters
language plpgsql security definer set search_path = ''
as $$
declare
  e public.encounters;
  c jsonb := private.consult_policy();
  v_actor uuid;
  v_opens timestamptz;
  v_closes timestamptz;
  v_patient_in boolean;
  v_clinician_in boolean;
begin
  if p_role not in ('patient', 'clinician') then raise exception 'unknown role' using errcode = '22023'; end if;
  select * into e from public.encounters where id = p_encounter for update;
  if e.id is null then raise exception 'consultation not found' using errcode = 'P0002'; end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then raise exception 'this consultation is %', e.status; end if;
  if not private.encounter_is_on(e) then raise exception 'this consultation is no longer on'; end if;
  if c is null or (c ->> 'joinOpensMinutesBefore') is null or (c ->> 'joinClosesMinutesAfter') is null then
    raise exception 'consultation policy is not configured' using errcode = 'P0001';
  end if;
  v_opens := e.scheduled_at - ((c ->> 'joinOpensMinutesBefore')::integer * interval '1 minute');
  v_closes := e.scheduled_at + ((c ->> 'joinClosesMinutesAfter')::integer * interval '1 minute');
  if now() < v_opens or now() > v_closes then raise exception 'outside the join window' using errcode = 'P0001'; end if;
  v_actor := case p_role when 'patient' then e.patient_id else e.clinician_id end;
  if v_actor is null then raise exception 'this consultation has no clinician yet' using errcode = 'P0001'; end if;

  -- the care team opened the room before the patient: one neutral notice, never twice (INV-07, INV-08: no SMS)
  if p_role = 'clinician'
     and not exists (select 1 from public.encounter_events where encounter_id = e.id and kind = 'joined' and actor_role = 'patient')
     and not exists (select 1 from public.notifications where recipient_id = e.patient_id and template = 'consult_join_ready' and payload ->> 'encounter_id' = e.id::text) then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (e.organisation_id, e.patient_id, private.patient_reminder_channel(e.patient_id), 'pending', 'consult_join_ready',
            jsonb_build_object('encounter_id', e.id), 'non_clinical');
  end if;

  perform private.log_encounter_event(e.id, 'joined', v_actor, p_role, private.clean_encounter_payload(jsonb_build_object('mode', p_mode)));

  select coalesce(bool_or(actor_role = 'patient'), false), coalesce(bool_or(actor_role = 'clinician'), false)
    into v_patient_in, v_clinician_in from public.encounter_events where encounter_id = e.id and kind = 'joined';
  if v_patient_in and v_clinician_in and e.status <> 'in_progress' then
    update public.encounters set status = 'in_progress', started_at = coalesce(started_at, now()) where id = e.id returning * into e;
    update public.appointments set status = 'in_progress' where id = e.appointment_id and status in ('confirmed', 'checked_in', 'booked');
    update public.video_consultations set status = 'started', started_at = coalesce(started_at, now())
     where id = e.video_consultation_id and status = 'scheduled';
    perform private.emit_domain_event('encounter.started', e.organisation_id, jsonb_build_object('encounter_id', e.id),
                                      'encounter.started:' || e.id::text, e.patient_id, 'encounter', e.id);
  elsif e.status = 'scheduled' then
    update public.encounters set status = 'waiting' where id = e.id returning * into e;
  end if;
  return e;
end;
$$;
revoke all on function public.service_record_join(uuid, text, text) from public, anon, authenticated;
grant execute on function public.service_record_join(uuid, text, text) to service_role;

create function public.service_set_phone_mode(p_encounter uuid) returns public.encounters
language plpgsql security definer set search_path = ''
as $$
declare e public.encounters;
begin
  select * into e from public.encounters where id = p_encounter for update;
  if e.id is null then raise exception 'consultation not found' using errcode = 'P0002'; end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') then raise exception 'this consultation is %', e.status; end if;
  if not private.encounter_is_on(e) then raise exception 'this consultation is no longer on'; end if;
  if e.final_media_mode is distinct from 'phone' then
    update public.encounters set final_media_mode = 'phone', fallback_steps = fallback_steps + 1 where id = e.id returning * into e;
    perform private.log_encounter_event(e.id, 'mode_changed', null, 'system', jsonb_build_object('mode', 'phone'));
    perform private.emit_domain_event('encounter.fallback', e.organisation_id, jsonb_build_object('encounter_id', e.id),
                                      'encounter.fallback:' || e.id::text || ':' || e.fallback_steps::text, e.patient_id, 'encounter', e.id);
  end if;
  return e;
end;
$$;
revoke all on function public.service_set_phone_mode(uuid) from public, anon, authenticated;
grant execute on function public.service_set_phone_mode(uuid) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.service_get_encounter_room(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.service_open_encounter_room(uuid,text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_record_encounter_event(uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'S21b: a service function is callable by a signed-in user';
  end if;
  if has_function_privilege('authenticated', 'public.service_record_join(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_set_phone_mode(uuid)', 'EXECUTE') then
    raise exception 'S21b: a join or phone-mode function is callable by a signed-in user';
  end if;
  if not has_function_privilege('service_role', 'public.service_get_encounter_room(uuid)', 'EXECUTE') then
    raise exception 'S21b: service_role cannot call service_get_encounter_room';
  end if;
end $$;
