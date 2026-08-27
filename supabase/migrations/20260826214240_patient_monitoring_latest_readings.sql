-- Tarragon Health — batched "latest reading per patient" for the
-- clinician-facing Patient Monitoring grid (apps/web
-- /clinician/patients/monitoring).
--
-- PostgREST has no DISTINCT ON, and a per-patient N+1 query doesn't scale to
-- an org roster. This mirrors the `distinct on (patient_id) ... order by
-- patient_id, taken_at desc` shape already used org-wide in
-- analytics_console_phase2_rpcs.sql's analytics_clinical_outcomes(), just
-- scoped to a caller-supplied patient id list instead of the whole platform.
--
-- Deliberately plain SECURITY INVOKER (the default) — every table this reads
-- (vitals_readings, wearable_readings, wearable_connections,
-- clinician_alerts) already has an is_org_staff-scoped SELECT policy, so a
-- caller can never get back a row for a patient outside their organisation
-- even if they passed a foreign id: RLS filters it before this function ever
-- sees it. No new privilege is granted here, only a batched read.
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
  open_alert_count         integer
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
  -- A patient can hold more than one wearable connection (e.g. a Fitbit for
  -- steps and a Dexcom for glucose) — each metric picks its own latest
  -- reading across ALL of the patient's connections, never pinned to
  -- whichever connection happened to sync most recently.
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
  -- Most recent sync across ALL of a patient's connections (independent of
  -- which one actually carried the latest hrv/sleep/steps reading above).
  last_sync as (
    select distinct on (patient_id) patient_id, last_synced_at
    from public.wearable_connections
    where patient_id = any(p_patient_ids)
    order by patient_id, last_synced_at desc nulls last
  ),
  -- Highest-severity OPEN (not yet resolved) alert per patient.
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
    coalesce(alerts.open_count, 0) as open_alert_count
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
  left join alerts on alerts.patient_id = target.patient_id;
$$;

grant execute on function public.patient_monitoring_latest_readings(uuid[]) to authenticated;
revoke execute on function public.patient_monitoring_latest_readings(uuid[]) from public;
