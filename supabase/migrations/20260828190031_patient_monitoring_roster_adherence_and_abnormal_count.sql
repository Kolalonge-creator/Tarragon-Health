-- Tarragon Health — Monitoring Engine: clinician roster gets adherence % and
-- an abnormal-reading count (§6.16 — "Average BP... Monitoring adherence:
-- 89%... 2 abnormal readings... 1 unresolved alert").
--
-- patient_monitoring_latest_readings (20260826214240) already computes
-- open_alert_level/open_alert_count but the roster card never rendered the
-- count, and the RPC had no adherence or abnormal-count figures at all.
-- Adding them here rather than a second RPC: the roster already pays for one
-- batched query per page load, and every new figure needs the same
-- caller-supplied patient-id-list shape.
--
-- avg_adherence_pct averages public.patient_vitals_adherence()'s per-item
-- figure across a patient's active monitoring_schedule_items (null when
-- they have none — not enrolled in a chronic programme, not "0% adherent").
--
-- abnormal_reading_count_7d deliberately does NOT re-implement per-vital
-- classification (BP/SpO2/temperature bands already live in
-- private.classify_bp_level / classify_spo2_level / classify_temperature_
-- level, each with a different signature) — it counts readings that raised
-- a clinician_alerts row via vital_reading_id, reusing the platform's one
-- already-audited definition of "clinically abnormal" instead of a second,
-- driftable one.
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE function's column list —
-- Postgres requires DROP + CREATE for that, hence the explicit drop below.

drop function if exists public.patient_monitoring_latest_readings(uuid[]);

create or replace function public.patient_monitoring_latest_readings(p_patient_ids uuid[])
returns table (
  patient_id               uuid,
  systolic                 integer,
  diastolic                integer,
  bp_taken_at              timestamptz,
  spo2_pct                 integer,
  spo2_taken_at            timestamptz,
  temperature_c            numeric(4, 1),
  temperature_taken_at     timestamptz,
  glucose_mmol_l           numeric(5, 2),
  glucose_taken_at         timestamptz,
  pulse_bpm                integer,
  pulse_taken_at           timestamptz,
  weight_kg                numeric(5, 2),
  weight_taken_at          timestamptz,
  hrv_ms                   numeric,
  sleep_minutes            numeric,
  steps                    numeric,
  wearable_last_synced_at  timestamptz,
  open_alert_level         public.alert_level,
  open_alert_count         integer,
  avg_adherence_pct        numeric,
  abnormal_reading_count_7d integer
)
language sql
stable
set search_path = ''
as $$
  with target as (
    select id as patient_id from unnest(p_patient_ids) as id
  ),
  bp as (
    select distinct on (patient_id) patient_id, systolic, diastolic, taken_at
    from public.vitals_readings
    where vital_type = 'blood_pressure' and patient_id = any(p_patient_ids)
    order by patient_id, taken_at desc
  ),
  spo2 as (
    select distinct on (patient_id) patient_id, spo2_pct, taken_at
    from public.vitals_readings
    where vital_type = 'spo2' and patient_id = any(p_patient_ids)
    order by patient_id, taken_at desc
  ),
  temp as (
    select distinct on (patient_id) patient_id, temperature_c, taken_at
    from public.vitals_readings
    where vital_type = 'temperature' and patient_id = any(p_patient_ids)
    order by patient_id, taken_at desc
  ),
  glucose as (
    select distinct on (patient_id) patient_id, glucose_mmol_l, taken_at
    from public.vitals_readings
    where vital_type = 'glucose' and patient_id = any(p_patient_ids)
    order by patient_id, taken_at desc
  ),
  pulse as (
    select distinct on (patient_id) patient_id, pulse_bpm, taken_at
    from public.vitals_readings
    where vital_type = 'pulse' and patient_id = any(p_patient_ids)
    order by patient_id, taken_at desc
  ),
  weight as (
    select distinct on (patient_id) patient_id, weight_kg, taken_at
    from public.vitals_readings
    where vital_type = 'weight' and patient_id = any(p_patient_ids)
    order by patient_id, taken_at desc
  ),
  hrv as (
    select distinct on (wc.patient_id) wc.patient_id, wr.value
    from public.wearable_readings wr
    join public.wearable_connections wc on wc.id = wr.connection_id
    where wr.reading_type = 'hrv_ms' and wc.patient_id = any(p_patient_ids)
    order by wc.patient_id, wr.recorded_at desc
  ),
  sleep as (
    select distinct on (wc.patient_id) wc.patient_id, wr.value
    from public.wearable_readings wr
    join public.wearable_connections wc on wc.id = wr.connection_id
    where wr.reading_type = 'sleep_minutes' and wc.patient_id = any(p_patient_ids)
    order by wc.patient_id, wr.recorded_at desc
  ),
  steps as (
    select distinct on (wc.patient_id) wc.patient_id, wr.value
    from public.wearable_readings wr
    join public.wearable_connections wc on wc.id = wr.connection_id
    where wr.reading_type = 'steps' and wc.patient_id = any(p_patient_ids)
    order by wc.patient_id, wr.recorded_at desc
  ),
  last_sync as (
    select distinct on (patient_id) patient_id, last_synced_at
    from public.wearable_connections
    where patient_id = any(p_patient_ids)
    order by patient_id, last_synced_at desc nulls last
  ),
  alerts as (
    select
      patient_id,
      (array_agg(
        level order by
          case level
            when 'emergency' then 1
            when 'urgent_escalation' then 2
            when 'clinician_review' then 3
            else 4
          end
      ))[1] as top_level,
      count(*)::int as open_count
    from public.clinician_alerts
    where patient_id = any(p_patient_ids) and status in ('open', 'acknowledged')
    group by patient_id
  ),
  -- Per active schedule item: expected/completed over a 28-day window, same
  -- shape as public.patient_vitals_adherence(), inlined here so the whole
  -- roster is one batched query rather than one RPC call per patient.
  schedule_adherence as (
    select
      ms.id,
      ms.patient_id,
      greatest(ceil(ms.frequency_per_week * (current_date - w.window_start + 1) / 7.0)::int, 0) as expected_count,
      c.completed_count
    from public.monitoring_schedule_items ms
    cross join lateral (
      select greatest(ms.start_date, current_date - 27) as window_start
    ) w
    cross join lateral (
      select count(*)::int as completed_count
      from public.vitals_readings vr
      where vr.patient_id = ms.patient_id
        and vr.vital_type = ms.vital_type
        and vr.taken_at >= w.window_start::timestamptz
    ) c
    where ms.patient_id = any(p_patient_ids) and ms.status = 'active'
  ),
  adherence as (
    select
      patient_id,
      round(avg(
        case when expected_count = 0 then 100
             else least(completed_count, expected_count)::numeric / expected_count * 100
        end
      )) as avg_adherence_pct
    from schedule_adherence
    group by patient_id
  ),
  abnormal as (
    select ca.patient_id, count(distinct ca.vital_reading_id)::int as abnormal_count
    from public.clinician_alerts ca
    where ca.patient_id = any(p_patient_ids)
      and ca.vital_reading_id is not null
      and ca.created_at >= now() - interval '7 days'
    group by ca.patient_id
  )
  select
    target.patient_id,
    bp.systolic, bp.diastolic, bp.taken_at as bp_taken_at,
    spo2.spo2_pct, spo2.taken_at as spo2_taken_at,
    temp.temperature_c, temp.taken_at as temperature_taken_at,
    glucose.glucose_mmol_l, glucose.taken_at as glucose_taken_at,
    pulse.pulse_bpm, pulse.taken_at as pulse_taken_at,
    weight.weight_kg, weight.taken_at as weight_taken_at,
    hrv.value as hrv_ms,
    sleep.value as sleep_minutes,
    steps.value as steps,
    last_sync.last_synced_at as wearable_last_synced_at,
    alerts.top_level as open_alert_level,
    coalesce(alerts.open_count, 0) as open_alert_count,
    adherence.avg_adherence_pct,
    coalesce(abnormal.abnormal_count, 0) as abnormal_reading_count_7d
  from target
  left join bp on bp.patient_id = target.patient_id
  left join spo2 on spo2.patient_id = target.patient_id
  left join temp on temp.patient_id = target.patient_id
  left join glucose on glucose.patient_id = target.patient_id
  left join pulse on pulse.patient_id = target.patient_id
  left join weight on weight.patient_id = target.patient_id
  left join hrv on hrv.patient_id = target.patient_id
  left join sleep on sleep.patient_id = target.patient_id
  left join steps on steps.patient_id = target.patient_id
  left join last_sync on last_sync.patient_id = target.patient_id
  left join alerts on alerts.patient_id = target.patient_id
  left join adherence on adherence.patient_id = target.patient_id
  left join abnormal on abnormal.patient_id = target.patient_id;
$$;

grant execute on function public.patient_monitoring_latest_readings(uuid[]) to authenticated;
revoke execute on function public.patient_monitoring_latest_readings(uuid[]) from public;

do $$
begin
  if not exists (
    select 1 from information_schema.routines
    where routine_schema = 'public' and routine_name = 'patient_monitoring_latest_readings'
  ) then
    raise exception 'FAIL: public.patient_monitoring_latest_readings() was not installed';
  end if;

  raise notice 'PASS: patient_monitoring_latest_readings extended with adherence + abnormal count';
end $$;
