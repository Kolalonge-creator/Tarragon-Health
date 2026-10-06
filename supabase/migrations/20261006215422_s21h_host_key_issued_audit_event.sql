-- S21 (part 8): the record of a clinician's Zoom host key being issued (OQ-136, founder decision 2026-10-06).
--
-- A host key lets its holder start meetings as the dedicated consultation host user and cannot be tied to one meeting, so each issue is put
-- on the append-only encounter log BEFORE the key leaves the server (the room refuses to hand it out if this write fails). The event
-- carries no key and no payload: who is the encounter's own clinician, when is the event time.
--
-- Two changes, no data: the allowed event kinds gain 'host_key_issued', and the SERVER-ONLY recorder accepts it. The app-session recorder
-- (report_encounter_event) is not touched, so a signed-in person can never write one. Row counts at writing: encounter_events 0 rows live.
-- public.service_record_encounter_event below repeats the definition read live on 2026-10-06 plus the one kind.

alter table public.encounter_events drop constraint encounter_events_kind_check;
alter table public.encounter_events add constraint encounter_events_kind_check check (kind in (
  'room_created', 'joined', 'left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested',
  'phone_connected', 'reconnect_grace_started', 'no_show_marked', 'completed', 'cancelled',
  'credit_returned', 'scribe_consent_asked', 'scribe_consent_changed', 'host_key_issued'));

create or replace function public.service_record_encounter_event(p_encounter uuid, p_kind text, p_actor_role text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_actor_role not in ('patient', 'clinician', 'system') then raise exception 'unknown actor role' using errcode = '22023'; end if;
  if p_kind not in ('left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested', 'phone_connected', 'reconnect_grace_started', 'room_created', 'host_key_issued') then
    raise exception 'that event cannot be recorded here' using errcode = '22023';
  end if;
  if not exists (select 1 from public.encounters where id = p_encounter) then raise exception 'consultation not found' using errcode = 'P0002'; end if;
  perform private.log_encounter_event(p_encounter, p_kind, null, p_actor_role, private.clean_encounter_payload(p_payload));
end;
$function$;

do $$
begin
  if has_function_privilege('anon', 'public.service_record_encounter_event(uuid,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_record_encounter_event(uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'S21h: the server-only event recorder is callable by a signed-in or anonymous user';
  end if;
  if not has_function_privilege('service_role', 'public.service_record_encounter_event(uuid,text,text,jsonb)', 'EXECUTE') then
    raise exception 'S21h: service_role cannot record events';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.encounter_events'::regclass and conname = 'encounter_events_kind_check'
                   and pg_get_constraintdef(oid) like '%host_key_issued%') then
    raise exception 'S21h: the event kind is not allowed by the table';
  end if;
end $$;
