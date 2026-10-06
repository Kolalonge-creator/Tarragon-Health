-- S21 (part 8): the record of a clinician's Zoom host key being issued (OQ-136, founder decision 2026-10-06).
--
-- A host key lets its holder start meetings as the dedicated consultation host user and cannot be tied to one meeting, so each issue is put
-- on the append-only encounter log BEFORE the key leaves the server (the room refuses to hand it out if this write fails). The event
-- carries no key and no payload; it names WHO (actor_id = the clinician it was issued to, checked against the encounter's clinician at
-- that moment, so a later reassignment cannot change who the record says) and WHEN (the event time).
--
-- Two changes, no data: the allowed event kinds gain 'host_key_issued', and a new SERVER-ONLY function writes it. The general recorders
-- (service_record_encounter_event and the app-session report_encounter_event) are not touched, so neither a signed-in person nor a
-- caller of the general server recorder can write one. Row counts at writing: encounter_events 0 rows live.

alter table public.encounter_events drop constraint encounter_events_kind_check;
alter table public.encounter_events add constraint encounter_events_kind_check check (kind in (
  'room_created', 'joined', 'left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested',
  'phone_connected', 'reconnect_grace_started', 'no_show_marked', 'completed', 'cancelled',
  'credit_returned', 'scribe_consent_asked', 'scribe_consent_changed', 'host_key_issued'));

create function public.service_record_host_key_issued(p_encounter uuid, p_clinician uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.encounters;
begin
  select * into e from public.encounters where id = p_encounter;
  if e.id is null then raise exception 'consultation not found' using errcode = 'P0002'; end if;
  -- only the consultation's own clinician is ever issued a host key
  if p_clinician is null or e.clinician_id is distinct from p_clinician then
    raise exception 'that person is not the clinician on this consultation' using errcode = '42501';
  end if;
  perform private.log_encounter_event(e.id, 'host_key_issued', p_clinician, 'clinician', '{}'::jsonb);
end;
$$;
revoke all on function public.service_record_host_key_issued(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_record_host_key_issued(uuid, uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.service_record_host_key_issued(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_record_host_key_issued(uuid,uuid)', 'EXECUTE') then
    raise exception 'S21h: the server-only host key recorder is callable by a signed-in or anonymous user';
  end if;
  if not has_function_privilege('service_role', 'public.service_record_host_key_issued(uuid,uuid)', 'EXECUTE') then
    raise exception 'S21h: service_role cannot record a host key issue';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.encounter_events'::regclass and conname = 'encounter_events_kind_check'
                   and pg_get_constraintdef(oid) like '%host_key_issued%') then
    raise exception 'S21h: the event kind is not allowed by the table';
  end if;
end $$;
