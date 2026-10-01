-- S05f piece D, part 1 (reads): the audited, tie-gated reads of vitals_readings (INV-10, INV-12, OQ-02, OQ-03). Additive in effect (no
-- policy changes); the table stays open to staff until the closing migration follows (piece D2).
--
-- Counted first (live, 2026-10-01): 12 rows. Database inventory (live scan):
--   * 42 SECURITY DEFINER functions read the table (the red-flag trigger handlers, analytics, the audited chart read, ...): unaffected.
--   * Three INVOKER functions and views read it as the caller and would silently return less once staff lose SELECT:
--       - private.flag_vitals_requiring_validation (BEFORE INSERT trigger, duplicate and outlier flags): reads the inserted patient's own
--         rows as the inserter. Inserters are the patient, a supporter or the service role (no staff screen inserts a reading), none of
--         which depends on the staff policy, so it is left as is.
--       - public.patient_monitoring_latest_readings and public.patient_vitals_adherence (the monitoring roster RPCs): reworked below.
--       - the view public.hypertension_quality_metrics (org-level KPI aggregate): reworked below.
--     The v5 view `observations` is reached only through read_patient_chart_audited (definer).
--
-- Decision (OQ-02 for lists that cross patients, recorded 2026-10-01): lists that show one patient's vitals to a clinician apply the
-- same tie as the chart (care team, a routed escalation or alert, a live appointment, a hosted video consultation, an assigned open
-- referral); a patient on the roster that the caller is not tied to is listed with `visible = false` and no readings, never with empty
-- ones. Aggregate KPI figures that expose no individual (the hypertension quality view) stay org-level for org staff.
--
-- Functions:
--   read_patient_vitals_audited(patient, reason, vital type, since, limit, offset, ascending, source) -> {status: ok | denied, rows: [vitals rows]}
--     One path for every caller of the shared hooks and loaders, like read_patient_medications_audited: the patient, a caregiver with the
--     'vitals_readings' category grant and the service role read without an audit row; staff are admitted by
--     private.can_staff_read_clinical (tie, break-glass per category, support-view session) with an audit row, a refusal audited too.
--   patient_monitoring_latest_readings(ids) now SECURITY DEFINER through a wrapper that only ever passes the core the ids the caller may
--     see, and returns every requested id with a `visible` flag.
--   patient_vitals_adherence(patient, days) now SECURITY DEFINER and refuses (42501) a caller who may not see the patient.
--   private.hqm_latest_bp_rows() feeds the hypertension_quality_metrics view the latest BP per patient with a `visible` flag, and the view
--     keeps a row only when visible (or when the caller is not an end-user session: cron, the service role, definer analytics), the same
--     pattern as private.overdue_referral_gap_rows in S05e.

create or replace function public.read_patient_vitals_audited(
  p_patient uuid, p_reason text default null, p_vital_type public.vital_type default null,
  p_since timestamptz default null, p_limit integer default 20, p_offset integer default 0, p_ascending boolean default false,
  p_source public.vital_source default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max constant integer := 1000;                      -- technical cap, not a clinical value
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';
  v_own boolean;
  v_rows jsonb;
begin
  if v_uid is null and not v_service then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_own := v_service or p_patient = v_uid
        or private.can_read_clinical(p_patient, 'vitals_readings'::public.care_access_category);

  if not v_own then
    if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then
      raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
    end if;
    if not private.can_staff_read_clinical(p_patient, 'vitals_readings'::public.care_access_category) then
      perform private.audit_chart_read(p_patient, array['vitals'], p_reason, 'denied');
      return jsonb_build_object('status', 'denied', 'rows', '[]'::jsonb);
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_taken), '[]'::jsonb) into v_rows from (
    select v.*, case when p_ascending then extract(epoch from v.taken_at) else -extract(epoch from v.taken_at) end as sort_taken
      from public.vitals_readings v
     where v.patient_id = p_patient
       and (p_vital_type is null or v.vital_type = p_vital_type)
       and (p_since is null or v.taken_at >= p_since)
       and (p_source is null or v.source = p_source)
     order by case when p_ascending then v.taken_at end asc, case when not p_ascending then v.taken_at end desc
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limit, 20), 1), c_max)) x;
  -- the helper sort column is not part of the row
  v_rows := (select coalesce(jsonb_agg(elem - 'sort_taken'), '[]'::jsonb) from jsonb_array_elements(v_rows) elem);

  if not v_own then
    perform private.audit_chart_read(p_patient, array['vitals'], p_reason, 'success');
  end if;
  return jsonb_build_object('status', 'ok', 'rows', v_rows);
end;
$$;

revoke all on function public.read_patient_vitals_audited(uuid, text, public.vital_type, timestamptz, integer, integer, boolean, public.vital_source) from public;
grant execute on function public.read_patient_vitals_audited(uuid, text, public.vital_type, timestamptz, integer, integer, boolean, public.vital_source) to authenticated;

-- The roster core: the previous body of patient_monitoring_latest_readings, unchanged, now definer and callable only by the wrapper below
-- (which passes it ids the caller may see).
create or replace function private.patient_monitoring_core(p_patient_ids uuid[])
returns table(patient_id uuid, systolic integer, diastolic integer, bp_taken_at timestamp with time zone, spo2_pct integer, spo2_taken_at timestamp with time zone, temperature_c numeric, temperature_taken_at timestamp with time zone, glucose_mmol_l numeric, glucose_taken_at timestamp with time zone, pulse_bpm integer, pulse_taken_at timestamp with time zone, weight_kg numeric, weight_taken_at timestamp with time zone, hrv_ms numeric, sleep_minutes numeric, steps numeric, wearable_last_synced_at timestamp with time zone, open_alert_level alert_level, open_alert_count integer, avg_adherence_pct numeric, abnormal_reading_count_7d integer)
language sql
stable
security definer
set search_path = ''
as $function$

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
$function$;
revoke all on function private.patient_monitoring_core(uuid[]) from public, anon, authenticated;

drop function if exists public.patient_monitoring_latest_readings(uuid[]);
create function public.patient_monitoring_latest_readings(p_patient_ids uuid[])
returns table(patient_id uuid, systolic integer, diastolic integer, bp_taken_at timestamp with time zone, spo2_pct integer, spo2_taken_at timestamp with time zone, temperature_c numeric, temperature_taken_at timestamp with time zone, glucose_mmol_l numeric, glucose_taken_at timestamp with time zone, pulse_bpm integer, pulse_taken_at timestamp with time zone, weight_kg numeric, weight_taken_at timestamp with time zone, hrv_ms numeric, sleep_minutes numeric, steps numeric, wearable_last_synced_at timestamp with time zone, open_alert_level alert_level, open_alert_count integer, avg_adherence_pct numeric, abnormal_reading_count_7d integer, visible boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';
  v_is_patient boolean;
  v_ids uuid[];
  v_staff integer := 0;
begin
  if v_uid is null and not v_service then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_is_patient := not v_service and exists (select 1 from public.profiles where id = v_uid and role = 'patient');
  if p_patient_ids is not null and cardinality(p_patient_ids) > 1000 then
    raise exception 'too many ids' using errcode = '22023';
  end if;

  -- The tie decides, per patient. The service role and a patient reading her own id see them as the owner.
  select coalesce(array_agg(t.id), '{}') into v_ids from unnest(coalesce(p_patient_ids, '{}')) as t(id)
   where v_service or t.id = v_uid or (not v_is_patient and private.clinician_has_patient_access(t.id));
  select count(*) into v_staff from unnest(v_ids) as t(id) where not v_service and t.id <> v_uid;
  if v_staff > 0 then
    -- one summary audit row per call (no per-patient fan-out), the same shape as the referral queue read
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, result, ip)
    values (private.current_org_id(), v_uid, 'staff.monitoring_roster_read', 'vitals_readings',
            jsonb_build_object('requested', cardinality(p_patient_ids), 'served_on_tie', v_staff), 'success', private.request_ip());
  end if;

  return query
  select t.id, c.systolic, c.diastolic, c.bp_taken_at, c.spo2_pct, c.spo2_taken_at, c.temperature_c, c.temperature_taken_at,
         c.glucose_mmol_l, c.glucose_taken_at, c.pulse_bpm, c.pulse_taken_at, c.weight_kg, c.weight_taken_at,
         c.hrv_ms, c.sleep_minutes, c.steps, c.wearable_last_synced_at, c.open_alert_level, c.open_alert_count,
         c.avg_adherence_pct, c.abnormal_reading_count_7d, (t.id = any (v_ids)) as visible
    from unnest(coalesce(p_patient_ids, '{}')) as t(id)
    left join private.patient_monitoring_core(v_ids) c on c.patient_id = t.id;
end;
$function$;
revoke all on function public.patient_monitoring_latest_readings(uuid[]) from public;
grant execute on function public.patient_monitoring_latest_readings(uuid[]) to authenticated, service_role;

create or replace function public.patient_vitals_adherence(p_patient_id uuid, p_window_days integer default 28)
returns table(schedule_item_id uuid, vital_type public.vital_type, frequency_per_week integer, expected_count integer,
              completed_count integer, missed_count integer, adherence_pct numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_service boolean := coalesce((select auth.role()), '') = 'service_role';
begin
  if v_uid is null and not v_service then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not (v_service or p_patient_id = v_uid
          or (not exists (select 1 from public.profiles where id = v_uid and role = 'patient')
              and private.clinician_has_patient_access(p_patient_id))) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return query
  with items as (
    select id, vital_type, frequency_per_week, greatest(start_date, current_date - (p_window_days - 1)) as window_start
      from public.monitoring_schedule_items
     where patient_id = p_patient_id and status = 'active'
  ),
  expected as (
    select id, vital_type, frequency_per_week,
           greatest(ceil(frequency_per_week * (current_date - window_start + 1) / 7.0)::int, 0) as expected_count, window_start
      from items
  ),
  completed as (
    select e.id, count(vr.id)::int as completed_count
      from expected e
      left join public.vitals_readings vr
        on vr.patient_id = p_patient_id and vr.vital_type = e.vital_type and vr.taken_at >= e.window_start::timestamptz
     group by e.id
  )
  select e.id, e.vital_type, e.frequency_per_week, e.expected_count, coalesce(c.completed_count, 0),
         greatest(e.expected_count - coalesce(c.completed_count, 0), 0),
         case when e.expected_count = 0 then 100
              else round(least(coalesce(c.completed_count, 0), e.expected_count)::numeric / e.expected_count * 100) end
    from expected e
    left join completed c on c.id = e.id
   order by e.vital_type;
end;
$$;
revoke all on function public.patient_vitals_adherence(uuid, integer) from public;
grant execute on function public.patient_vitals_adherence(uuid, integer) to authenticated, service_role;

create or replace function private.hqm_latest_bp_rows()
returns table(patient_id uuid, systolic integer, diastolic integer, taken_at timestamptz, visible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (v.patient_id) v.patient_id, v.systolic, v.diastolic, v.taken_at,
         (v.patient_id = (select auth.uid()) or private.is_org_staff(v.organisation_id)) as visible
    from public.vitals_readings v
   where v.vital_type = 'blood_pressure'::public.vital_type
   order by v.patient_id, v.taken_at desc;
$$;
revoke all on function private.hqm_latest_bp_rows() from public, anon;
grant execute on function private.hqm_latest_bp_rows() to authenticated, service_role;

create or replace view public.hypertension_quality_metrics with (security_invoker = true) as
WITH hm AS (
         SELECT DISTINCT care_plans.patient_id,
            care_plans.organisation_id
           FROM care_plans
          WHERE care_plans.condition = 'hypertension'::care_plan_condition AND care_plans.status = 'active'::care_plan_status
        ), target AS (
         SELECT DISTINCT ON (patient_bp_targets.patient_id) patient_bp_targets.patient_id,
            patient_bp_targets.home_systolic,
            patient_bp_targets.home_diastolic
           FROM patient_bp_targets
          ORDER BY patient_bp_targets.patient_id, patient_bp_targets.created_at DESC
        ), latest_bp AS (
         SELECT g.patient_id, g.systolic, g.diastolic, g.taken_at
           FROM private.hqm_latest_bp_rows() g
          WHERE g.visible OR current_user <> 'authenticated'
        ), at_target AS (
         SELECT latest_bp.patient_id
           FROM latest_bp
             JOIN target target_1 ON target_1.patient_id = latest_bp.patient_id
          WHERE latest_bp.systolic IS NOT NULL AND latest_bp.diastolic IS NOT NULL AND latest_bp.systolic <= target_1.home_systolic AND latest_bp.diastolic <= target_1.home_diastolic
        ), recent_reading AS (
         SELECT latest_bp.patient_id
           FROM latest_bp
          WHERE latest_bp.taken_at >= (now() - '30 days'::interval)
        ), severe_events AS (
         SELECT emergency_events.patient_id,
            count(*) AS n
           FROM emergency_events
          WHERE emergency_events.source = 'bp_reading'::emergency_source AND emergency_events.created_at >= (now() - '90 days'::interval)
          GROUP BY emergency_events.patient_id
        ), flag_titles(title) AS (
         VALUES ('Priority 1: high blood pressure reading'::text), ('Priority 1: raised BP in pregnancy'::text), ('Blood pressure above target'::text), ('Missing expected blood-pressure readings'::text)
        ), flag_contact AS (
         SELECT clinician_alerts.organisation_id,
            avg(EXTRACT(epoch FROM clinician_alerts.acknowledged_at - clinician_alerts.created_at) / 3600.0) AS hrs
           FROM clinician_alerts
             JOIN flag_titles ON flag_titles.title = clinician_alerts.title
          WHERE clinician_alerts.acknowledged_at IS NOT NULL AND clinician_alerts.created_at >= (now() - '90 days'::interval)
          GROUP BY clinician_alerts.organisation_id
        )
 SELECT hm.organisation_id,
    count(*)::integer AS hypertensive_patients,
    count(*) FILTER (WHERE target.patient_id IS NOT NULL)::integer AS target_set,
    count(*) FILTER (WHERE at_target.patient_id IS NOT NULL)::integer AS at_target,
    count(*) FILTER (WHERE recent_reading.patient_id IS NOT NULL)::integer AS reading_within_30d,
    COALESCE(sum(severe_events.n), 0::numeric)::integer AS severe_events_90d,
    round(COALESCE(sum(severe_events.n), 0::numeric) * 100.0 / NULLIF(count(*), 0)::numeric, 1) AS severe_events_per_100_patients,
    round(max(flag_contact.hrs), 1) AS avg_bp_flag_to_contact_hours
   FROM hm
     LEFT JOIN target ON target.patient_id = hm.patient_id
     LEFT JOIN at_target ON at_target.patient_id = hm.patient_id
     LEFT JOIN recent_reading ON recent_reading.patient_id = hm.patient_id
     LEFT JOIN severe_events ON severe_events.patient_id = hm.patient_id
     LEFT JOIN flag_contact ON flag_contact.organisation_id = hm.organisation_id
  GROUP BY hm.organisation_id;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.read_patient_vitals_audited(uuid,text,public.vital_type,timestamptz,integer,integer,boolean,public.vital_source)',
    'public.patient_monitoring_latest_readings(uuid[])',
    'public.patient_vitals_adherence(uuid,integer)'] loop
    if not (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception 'S05f assertion: % is not SECURITY DEFINER', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'S05f assertion: anon can execute %', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.hqm_latest_bp_rows()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.patient_monitoring_core(uuid[])', 'EXECUTE') then
    raise exception 'S05f assertion: a private vitals function is executable by the wrong role';
  end if;
  if not exists (select 1 from pg_views where schemaname = 'public' and viewname = 'hypertension_quality_metrics' and definition ilike '%hqm_latest_bp_rows%') then
    raise exception 'S05f assertion: hypertension_quality_metrics does not read through private.hqm_latest_bp_rows';
  end if;
end $$;
