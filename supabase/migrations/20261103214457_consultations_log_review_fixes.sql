-- Consultations log, review fixes (same change as 20261103213406, before merge).
--
-- 1. Async written consults (encounters.type = 'async') have no scheduled_at and are not calls; they are left out, so a
--    null call_date can never reach the page (whose row schema would refuse it and show the whole log as unreadable).
-- 2. A Zoom leg is keyed by the meeting-instance uuid, falling back to the reported start_time when an event carries no
--    uuid, so two such legs no longer collapse into one.
-- 3. An expression index on the meeting id in zoom_webhook_events, so the log does not scan every webhook on each read.
-- 4. public.log_consultations_log_export: the CSV download writes an audit row (private.log_audit) before the file is
--    built, the same gate as the log (admin or active CMO); anyone else is refused, so the route gives no file.
--
-- Same signature as 20261103213406: create or replace, not an overload. Live body read 2026-11-03 before writing.

create or replace function public.consultations_log(
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
         and e.type <> 'async'
         and (p_from is null or (e.scheduled_at at time zone 'Africa/Lagos')::date >= p_from)
         and (p_to is null or (e.scheduled_at at time zone 'Africa/Lagos')::date <= p_to)
         and (p_clinician_id is null or e.clinician_id = p_clinician_id)
         and (p_status is null or e.status = p_status)
    ),
    legs as (
      select r.encounter_id,
             coalesce(z.raw_payload->'payload'->'object'->>'uuid', z.raw_payload->'payload'->'object'->>'start_time') as leg,
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
       group by 1, 2
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


create index if not exists zoom_webhook_events_meeting_id_idx
  on public.zoom_webhook_events ((raw_payload->'payload'->'object'->>'id'));

create function public.log_consultations_log_export(
  p_from date default null,
  p_to date default null,
  p_clinician_id uuid default null,
  p_status text default null,
  p_include_tests boolean default false,
  p_rows integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'consultations_log_not_authorised' using errcode = '42501';
  end if;
  perform private.log_audit('consultations.log_export', 'consultations_log', null,
    jsonb_build_object('from', p_from, 'to', p_to, 'clinician_id', p_clinician_id, 'status', p_status,
                       'include_tests', p_include_tests, 'rows', p_rows, 'format', 'csv'));
end;
$$;

comment on function public.log_consultations_log_export(date, date, uuid, text, boolean, integer) is
  'Writes the audit row for a consultations log CSV download, before the file is built. Admin or the active CMO only.';

revoke all on function public.log_consultations_log_export(date, date, uuid, text, boolean, integer) from public, anon;
grant execute on function public.log_consultations_log_export(date, date, uuid, text, boolean, integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.log_consultations_log_export(date, date, uuid, text, boolean, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.consultations_log(date, date, uuid, text, boolean)', 'EXECUTE') then
    raise exception 'anon can execute a consultations log function';
  end if;
  if (select count(*) from pg_proc where proname = 'consultations_log' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'consultations_log has an overload';
  end if;
end $$;

notify pgrst, 'reload schema';
