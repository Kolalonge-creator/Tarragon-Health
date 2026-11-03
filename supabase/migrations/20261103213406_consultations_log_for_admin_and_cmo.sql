-- Consultations log: every video consultation in the organisation, for admins and the Chief Medical Officer.
--
-- Founder (also CMO) ask of 2026-11-03, after the first live call: every call's time, doctor, patient and length must be easy to
-- track. /clinician/consultations shows only the signed-in doctor's own calls (my_clinician_encounters), so nobody could see the
-- whole list.
--
-- Live facts read 2026-11-03 from koiplnmbgnqnbywhpjlf: one encounter (the is_test call of 2026-11-03, doctor joined 21:05:05,
-- Finish pressed 21:26:47) with one zoom room (provider_room_id 88074609614) and four zoom_webhook_events: two legs, each a
-- meeting.started and a meeting.ended under its own meeting-instance uuid (21:05:20-21:11:27 and 21:18:00-21:20:37). The webhook
-- handler does not link those events to encounters (it looks at the older video_consultations table, and a separate session is
-- changing it), so the link is made here in SQL instead: meeting id in the payload = encounter_rooms.provider_room_id.
--
-- Connected minutes = the sum, over each meeting instance (payload object uuid) with a meeting.ended event, of end_time - start_time
-- as Zoom reports them. A leg with meeting.started and no meeting.ended yet is counted in zoom_open_legs, not in the minutes. Null
-- when the room has no Zoom events at all. Only events on or after the room was created count, so a meeting id Zoom reuses later
-- cannot pull an older call's legs in.
--
-- Gate: private.is_admin() or private.credential_is_cmo(), rows of the caller's own organisation only. Anyone else gets zero rows,
-- never an error. private.is_org_staff() is not touched. No existing function is changed; no overload is added.

create function public.consultations_log(
  p_from date default null,
  p_to date default null,
  p_clinician_id uuid default null,
  p_status text default null,
  p_include_tests boolean default false
)
returns table (
  encounter_id uuid,
  call_date date,
  scheduled_at timestamptz,
  patient_id uuid,
  patient_name text,
  clinician_id uuid,
  clinician_name text,
  status text,
  media_mode text,
  doctor_started_at timestamptz,
  finished_at timestamptz,
  doctor_minutes numeric,
  connected_minutes numeric,
  zoom_legs integer,
  zoom_open_legs integer,
  patient_joins integer,
  clinician_joins integer,
  is_test boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not (private.is_admin() or private.credential_is_cmo()) then
    return;
  end if;

  return query
    with enc as (
      select e.*, (e.is_test or coalesce(pp.is_test, false)) as any_test, pp.full_name as p_name, cp.full_name as c_name
        from public.encounters e
        left join public.profiles pp on pp.id = e.patient_id
        left join public.profiles cp on cp.id = e.clinician_id
       where e.organisation_id = private.caller_org()
         and (p_from is null or (e.scheduled_at at time zone 'Africa/Lagos')::date >= p_from)
         and (p_to is null or (e.scheduled_at at time zone 'Africa/Lagos')::date <= p_to)
         and (p_clinician_id is null or e.clinician_id = p_clinician_id)
         and (p_status is null or e.status = p_status)
    ),
    legs as (
      select r.encounter_id,
             z.raw_payload->'payload'->'object'->>'uuid' as leg,
             bool_or(z.event_type = 'meeting.ended') as ended,
             max(case when z.event_type = 'meeting.ended'
                      then extract(epoch from ((z.raw_payload->'payload'->'object'->>'end_time')::timestamptz
                                             - (z.raw_payload->'payload'->'object'->>'start_time')::timestamptz))
                 end) as seconds
        from public.encounter_rooms r
        join public.zoom_webhook_events z
          on z.raw_payload->'payload'->'object'->>'id' = r.provider_room_id
         and z.event_type in ('meeting.started', 'meeting.ended')
         and z.created_at >= r.created_at
       where r.provider = 'zoom'
         and r.encounter_id in (select enc.id from enc)
       group by r.encounter_id, z.raw_payload->'payload'->'object'->>'uuid'
    ),
    zoom as (
      select l.encounter_id,
             round(sum(l.seconds) filter (where l.ended) / 60.0, 1) as minutes,
             (count(*) filter (where l.ended))::integer as done,
             (count(*) filter (where not l.ended))::integer as open
        from legs l
       group by l.encounter_id
    ),
    joins as (
      select ev.encounter_id,
             (count(*) filter (where ev.actor_role = 'patient'))::integer as pj,
             (count(*) filter (where ev.actor_role = 'clinician'))::integer as cj
        from public.encounter_events ev
       where ev.kind = 'joined' and ev.encounter_id in (select enc.id from enc)
       group by ev.encounter_id
    )
    select enc.id,
           (enc.scheduled_at at time zone 'Africa/Lagos')::date,
           enc.scheduled_at,
           enc.patient_id,
           enc.p_name,
           enc.clinician_id,
           enc.c_name,
           enc.status,
           enc.final_media_mode,
           enc.started_at,
           enc.ended_at,
           case when enc.started_at is not null and enc.ended_at is not null
                then round(extract(epoch from (enc.ended_at - enc.started_at)) / 60.0, 1) end,
           case when zoom.done > 0 then coalesce(zoom.minutes, 0) end,
           coalesce(zoom.done, 0),
           coalesce(zoom.open, 0),
           coalesce(joins.pj, 0),
           coalesce(joins.cj, 0),
           enc.any_test
      from enc
      left join zoom on zoom.encounter_id = enc.id
      left join joins on joins.encounter_id = enc.id
     where p_include_tests or not enc.any_test
     order by enc.scheduled_at desc
     limit 1000;
end;
$$;

comment on function public.consultations_log(date, date, uuid, text, boolean) is
  'Every consultation in the caller''s organisation with patient, doctor, status, doctor minutes (joined to Finish) and Zoom connected minutes (meeting.ended legs matched on encounter_rooms.provider_room_id). Admin and the CMO only; anyone else gets zero rows. Tests hidden unless p_include_tests.';

revoke all on function public.consultations_log(date, date, uuid, text, boolean) from public, anon;
grant execute on function public.consultations_log(date, date, uuid, text, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.consultations_log(date, date, uuid, text, boolean)', 'EXECUTE') then
    raise exception 'anon can execute consultations_log';
  end if;
  if not has_function_privilege('authenticated', 'public.consultations_log(date, date, uuid, text, boolean)', 'EXECUTE') then
    raise exception 'authenticated cannot execute consultations_log';
  end if;
end $$;

notify pgrst, 'reload schema';
