-- Tarragon Health — Device & Data Operations, part 6/6: data-quality + RPM SLA reporting (55.10, 55.16).
--
-- Two read-only, staff-gated reporting RPCs closing out the acceptance criteria (55.20): "is the
-- device working, are measurements arriving" (device_connection_data_quality) and "did the
-- clinical team receive the relevant signal, in time" (rpm_sla_metrics). Both are SECURITY DEFINER
-- with an explicit is_org_staff check (fail-closed — raise, not an empty result) rather than RLS
-- alone, because both aggregate across every patient in an organisation at once; a per-row RLS
-- policy on the underlying tables would not by itself bound a cross-patient aggregate to one org.
--
-- "Missing data" and staleness use a per-kind threshold rather than one constant: cloud wearables
-- sync continuously (a 3-day silence is a real signal), BLE clinical devices are patient-initiated
-- per-reading and have no fixed cadence (14 days is a looser, still-meaningful threshold). Both
-- numbers are inline constants, not a governed config table — unlike escalation_slas/alert_rules,
-- there is no clinical-safety judgment call here to put in front of a Clinical Director; this is
-- purely an operations dashboard threshold, so it does not warrant that machinery.

create or replace function public.device_connection_data_quality(p_organisation_id uuid)
returns table (
  connection_kind         text,
  connection_id           uuid,
  patient_id              uuid,
  provider_or_device_type text,
  status                  text,
  last_synced_at          timestamptz,
  is_missing_data         boolean,
  implausible_readings_count integer,
  duplicate_readings_count   integer,
  last_error              text,
  avg_latency_seconds     numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_staff(p_organisation_id) then
    raise exception 'not authorised: org staff only';
  end if;

  return query
  select
    'wearable'::text,
    wc.id,
    wc.patient_id,
    wc.provider::text,
    wc.status::text,
    wc.last_synced_at,
    (wc.status = 'active' and (wc.last_synced_at is null or wc.last_synced_at < now() - interval '3 days')),
    wc.implausible_readings_count,
    wc.duplicate_readings_count,
    wc.last_sync_error,
    (
      select avg(extract(epoch from (vr.created_at - vr.taken_at)))
      from public.vitals_readings vr
      where vr.wearable_connection_id = wc.id and vr.taken_at > now() - interval '30 days'
    )
  from public.wearable_connections wc
  where wc.organisation_id = p_organisation_id

  union all

  select
    'ble_device'::text,
    pd.id,
    pd.patient_id,
    pd.device_type::text,
    pd.status::text,
    pd.last_synced_at,
    (pd.status = 'active' and (pd.last_synced_at is null or pd.last_synced_at < now() - interval '14 days')),
    pd.implausible_readings_count,
    pd.duplicate_readings_count,
    pd.last_sync_error,
    (
      select avg(extract(epoch from (vr.created_at - vr.taken_at)))
      from public.vitals_readings vr
      where vr.device_id = pd.id and vr.taken_at > now() - interval '30 days'
    )
  from public.patient_devices pd
  where pd.organisation_id = p_organisation_id;
end;
$$;

comment on function public.device_connection_data_quality(uuid) is
  '55.10 data-quality dashboard source. One row per wearable_connections/patient_devices row in the org: missing data (staleness vs. a per-kind threshold), abnormal transmission + duplicate counts (implausible_readings_count/duplicate_readings_count, incremented by the ingestion code path), last error, and mean ingestion latency over the last 30 days.';

revoke all on function public.device_connection_data_quality(uuid) from public, anon;
grant execute on function public.device_connection_data_quality(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPM SLA metrics — measurement latency, alert ack ("clinician response")
-- latency, technical downtime, and device-reporting adherence, all over a
-- caller-supplied window. Returned as one jsonb document (matching this
-- codebase's existing analytics RPC convention, e.g. analytics_audit_log) —
-- a single call gives the whole 55.16 dashboard its numbers.
-- ---------------------------------------------------------------------------
create or replace function public.rpm_sla_metrics(p_organisation_id uuid, p_since timestamptz default now() - interval '7 days')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latency_avg   numeric;
  v_latency_p95   numeric;
  v_ack_avg       numeric;
  v_ack_p95       numeric;
  v_ack_count     integer;
  v_downtime      jsonb;
  v_active_total  integer;
  v_active_fresh  integer;
begin
  if not private.is_org_staff(p_organisation_id) then
    raise exception 'not authorised: org staff only';
  end if;

  select
    avg(extract(epoch from (vr.created_at - vr.taken_at))),
    percentile_cont(0.95) within group (order by extract(epoch from (vr.created_at - vr.taken_at)))
  into v_latency_avg, v_latency_p95
  from public.vitals_readings vr
  where vr.organisation_id = p_organisation_id
    and vr.source in ('device', 'wearable')
    and vr.taken_at >= p_since;

  select
    avg(extract(epoch from (ca.acknowledged_at - ca.created_at)) / 60.0),
    percentile_cont(0.95) within group (order by extract(epoch from (ca.acknowledged_at - ca.created_at)) / 60.0),
    count(*)
  into v_ack_avg, v_ack_p95, v_ack_count
  from public.clinician_alerts ca
  where ca.organisation_id = p_organisation_id
    and ca.created_at >= p_since
    and ca.acknowledged_at is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'component', component,
    'downtime_minutes', downtime_minutes
  )), '[]'::jsonb)
  into v_downtime
  from (
    select ii.component, sum(extract(epoch from (coalesce(ii.resolved_at, now()) - ii.started_at)) / 60.0) as downtime_minutes
    from public.integration_incidents ii
    where ii.state = 'down'
      and coalesce(ii.resolved_at, now()) >= p_since
    group by ii.component
  ) t;

  select count(*), count(*) filter (
    where last_synced_at is not null and last_synced_at >= now() - interval '3 days'
  )
  into v_active_total, v_active_fresh
  from (
    select last_synced_at from public.wearable_connections wc
    where wc.organisation_id = p_organisation_id and wc.status = 'active'
    union all
    select last_synced_at from public.patient_devices pd
    where pd.organisation_id = p_organisation_id and pd.status = 'active'
  ) t;

  return jsonb_build_object(
    'organisation_id', p_organisation_id,
    'since', p_since,
    'computed_at', now(),
    'measurement_latency_seconds', jsonb_build_object('avg', v_latency_avg, 'p95', v_latency_p95),
    'alert_ack_latency_minutes', jsonb_build_object('avg', v_ack_avg, 'p95', v_ack_p95, 'count', v_ack_count),
    'technical_downtime_minutes_by_component', v_downtime,
    'device_reporting_adherence_pct', case when v_active_total > 0 then round(100.0 * v_active_fresh / v_active_total, 1) else null end
  );
end;
$$;

comment on function public.rpm_sla_metrics(uuid, timestamptz) is
  '55.16 RPM SLA dashboard source, one call per org/window. measurement_latency = time from a device/wearable-sourced vitals_readings.taken_at to ingestion (created_at). alert_ack_latency = clinician_alerts.acknowledged_at - created_at ("clinician response"). technical_downtime = summed integration_incidents(state=down) duration per component, clipped to the window. device_reporting_adherence_pct = share of active connections/pairings with a sync within the last 3 days (a device-fleet reporting-adherence signal, distinct from the platform''s existing patient medication/vitals adherence tracking).';

revoke all on function public.rpm_sla_metrics(uuid, timestamptz) from public, anon;
grant execute on function public.rpm_sla_metrics(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.device_connection_data_quality(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.device_connection_data_quality';
  end if;
  if has_function_privilege('anon', 'public.rpm_sla_metrics(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.rpm_sla_metrics';
  end if;
  if not has_function_privilege('authenticated', 'public.device_connection_data_quality(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.device_connection_data_quality';
  end if;
  if not has_function_privilege('authenticated', 'public.rpm_sla_metrics(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.rpm_sla_metrics';
  end if;
  raise notice 'PASS: device_connection_data_quality and rpm_sla_metrics in place, anon denied on both';
end $$;
