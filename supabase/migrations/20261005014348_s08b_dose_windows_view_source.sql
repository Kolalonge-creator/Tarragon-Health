-- S08b: flexible dose windows and the catch-up sheet.
--
--   1. medication_logs_latest_per_slot gains `source` (appended last, so CREATE OR REPLACE
--      keeps every existing reader working). The phone's catch-up sheet needs to tell a
--      "missed" the patient confirmed (source patient) from the server's own (source system),
--      or a confirmed miss would come back to be asked about again.
--   2. weekly_adherence reads the schedule's flexible window (spec.windowMinutes, 0 to 360):
--      a dose whose window is still open is not yet missed, the same rule the phone uses
--      (packages/medicines slotCloseMinutes). A malformed window reads as 0 and never raises,
--      because emit_adherence_signals calls this for every patient and one bad row must not
--      stop the whole cron.
--
-- The server missed job is unchanged: it marks a dose missed 12 hours after it is due and a
-- window may not exceed 6 hours, so a window always closes first.
--
-- Row counts at writing (live): medications 4 (none with a window), medication_logs 0.

create or replace view public.medication_logs_latest_per_slot with (security_invoker = on) as
 select distinct on (medication_id, scheduled_for_date, scheduled_time,
        case when scheduled_time is null then id else null::uuid end)
    id, organisation_id, patient_id, medication_id, status, reason, logged_at, created_at,
    scheduled_time, scheduled_for_date, logged_by_profile_id, missed_reason, source
   from public.medication_logs
  order by medication_id, scheduled_for_date, scheduled_time,
        case when scheduled_time is null then id else null::uuid end,
        (status = 'missed' and source = 'system'), logged_at desc, id desc;

create or replace function private.weekly_adherence(p_patient uuid, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c record;
  v_end date := (p_now at time zone 'Africa/Lagos')::date;
  v_start date;
  r record;
  v_percent integer;
begin
  select * into c from public.medicine_config where is_active;
  if not found then
    raise exception 'no active medicine_config' using errcode = '55000';
  end if;
  v_start := v_end - (c.adherence_window_days - 1);

  select
    count(*) filter (where state <> 'open')                          as due,
    count(*) filter (where state = 'taken')                          as taken,
    count(*) filter (where state = 'delayed')                        as late,
    count(*) filter (where state = 'skipped')                        as skipped,
    count(*) filter (where state = 'missed')                         as missed,
    count(*) filter (where state = 'not_available')                  as unavailable
  into r
  from (
    select coalesce(v.status::text,
             case when p_now >= s.due_at + make_interval(mins => greatest(c.missed_after_minutes, s.win)) then 'missed' else 'open' end) as state
      from (
        select m.id as med_id, g.d::date as sdate, sl.slot_time,
               ((g.d::date + sl.slot_time::time) at time zone 'Africa/Lagos') as due_at,
               greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at)) as active_from,
               case when (m.schedule_spec ->> 'windowMinutes') ~ '^[0-9]{1,3}$'
                    then least((m.schedule_spec ->> 'windowMinutes')::integer, 360) else 0 end as win
          from public.medications m
         cross join lateral generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g(d)
         cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, g.d::date) sl
         where m.patient_id = p_patient and m.is_active and m.superseded_at is null
      ) s
      left join public.medication_logs_latest_per_slot v
        on v.medication_id = s.med_id and v.scheduled_for_date = s.sdate and v.scheduled_time = s.slot_time
     where s.due_at <= p_now and s.due_at >= s.active_from
  ) z;

  v_percent := case when r.due >= c.adherence_min_doses
                    then round(100.0 * (r.taken + r.late) / r.due)::integer end;

  return jsonb_build_object(
    'percent', v_percent, 'due', r.due, 'taken', r.taken, 'late', r.late, 'skipped', r.skipped,
    'missed', r.missed, 'unavailable', r.unavailable,
    'below_threshold', coalesce(v_percent < c.adherence_threshold_percent, false),
    'threshold_percent', c.adherence_threshold_percent,
    'window_start', v_start, 'window_end', v_end, 'config_version', c.version);
end;
$$;

revoke all on function private.weekly_adherence(uuid, timestamptz) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.weekly_adherence(uuid,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.weekly_adherence(uuid,timestamptz)', 'EXECUTE') then
    raise exception 'weekly_adherence must not be executable by clients';
  end if;
  if (select reloptions::text from pg_class where oid = 'public.medication_logs_latest_per_slot'::regclass) not like '%security_invoker=on%' then
    raise exception 'medication_logs_latest_per_slot must stay security_invoker';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'medication_logs_latest_per_slot' and column_name = 'source') then
    raise exception 'the view must expose source';
  end if;
end $$;
