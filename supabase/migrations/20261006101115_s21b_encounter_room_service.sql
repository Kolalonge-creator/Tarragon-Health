-- S21 (part 2): the service-role functions the consultation pages and webhooks use to open a room and record events.
--
--   service_get_encounter_room(encounter)       what the server needs to decide a join: who, when, status, the room reference,
--                                               and whether the join window is open (policy joinOpensMinutesBefore and
--                                               joinClosesMinutesAfter). Never returns a join URL (none is stored).
--   service_open_encounter_room(encounter, ...) records the vendor room once; a second call returns the first room and says so,
--                                               so a lost race can end its own orphan room.
--   service_record_encounter_event(...)         for webhooks and the phone bridge: the same whitelisted payload keys as the
--                                               app path, any actor role.
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
    'joinable', e.status in ('scheduled', 'waiting', 'in_progress') and now() >= v_opens and now() <= v_closes,
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
declare v_clean jsonb := '{}'::jsonb;
begin
  if p_actor_role not in ('patient', 'clinician', 'system') then raise exception 'unknown actor role' using errcode = '22023'; end if;
  if p_kind not in ('joined', 'left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested', 'phone_connected', 'reconnect_grace_started', 'room_created') then
    raise exception 'that event cannot be recorded here' using errcode = '22023';
  end if;
  if not exists (select 1 from public.encounters where id = p_encounter) then raise exception 'consultation not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object' then
    if p_payload ? 'mode' then v_clean := v_clean || jsonb_build_object('mode', p_payload ->> 'mode'); end if;
    if p_payload ? 'quality' then v_clean := v_clean || jsonb_build_object('quality', p_payload ->> 'quality'); end if;
    if p_payload ? 'reason_code' then v_clean := v_clean || jsonb_build_object('reason_code', left(p_payload ->> 'reason_code', 40)); end if;
    if p_payload ? 'bitrate_kbps' then v_clean := v_clean || jsonb_build_object('bitrate_kbps', (p_payload ->> 'bitrate_kbps')::integer); end if;
  end if;
  perform private.log_encounter_event(p_encounter, p_kind, null, p_actor_role, v_clean);
end;
$$;
revoke all on function public.service_record_encounter_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.service_record_encounter_event(uuid, text, text, jsonb) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.service_get_encounter_room(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.service_open_encounter_room(uuid,text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_record_encounter_event(uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'S21b: a service function is callable by a signed-in user';
  end if;
  if not has_function_privilege('service_role', 'public.service_get_encounter_room(uuid)', 'EXECUTE') then
    raise exception 'S21b: service_role cannot call service_get_encounter_room';
  end if;
end $$;
