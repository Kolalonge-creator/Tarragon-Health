-- Tarragon Health — Analytics Console Phase 2 RPCs
-- Acquisition, Engagement, Clinical Outcomes & Quality, Operations &
-- Deliverability. Same rules as Phase 1: security definer, search_path='',
-- gated by private.is_analyst(), return jsonb aggregates, authenticated-only.

-- ===========================================================================
-- ACQUISITION
-- ===========================================================================
create or replace function public.analytics_traffic_summary(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'visitors', (select count(distinct coalesce(session_id, id::text)) from public.web_events
                 where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'logged_in_visitors', (select count(distinct profile_id) from public.web_events
                 where profile_id is not null and (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'pageviews', (select count(*) from public.web_events
                 where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)),
    'by_country', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(country,'Unknown') country, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(country,'Unknown')) t),
    'by_region', (select coalesce(jsonb_agg(jsonb_build_object('region', region, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(region,'Unknown') region, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(region,'Unknown')) t),
    'by_referrer', (select coalesce(jsonb_agg(jsonb_build_object('referrer_host', referrer_host, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(referrer_host,'Direct') referrer_host, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(referrer_host,'Direct')) t),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(utm_source,'None') source, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(utm_source,'None')) t),
    'by_device', (select coalesce(jsonb_agg(jsonb_build_object('device', device_type, 'visitors', v) order by v desc), '[]'::jsonb)
      from (select coalesce(device_type,'unknown') device_type, count(distinct coalesce(session_id, id::text)) v from public.web_events
            where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to) group by coalesce(device_type,'unknown')) t)
  );
end; $$;

create or replace function public.analytics_traffic_timeseries(p_period text default 'day', p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_period text := case when p_period in ('day','week','month') then p_period else 'day' end;
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'visitors', visitors, 'pageviews', pageviews) order by bucket)
    from (
      select date_trunc(v_period, occurred_at) bucket,
             count(distinct coalesce(session_id, id::text)) visitors, count(*) pageviews
      from public.web_events
      where (p_from is null or occurred_at >= p_from) and (p_to is null or occurred_at <= p_to)
      group by 1
    ) t
  ), '[]'::jsonb);
end; $$;

create or replace function public.analytics_acquisition_funnel(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return jsonb_build_array(
    jsonb_build_object('step','Visitors','count', (select count(distinct coalesce(session_id, id::text)) from public.web_events where (p_from is null or occurred_at>=p_from) and (p_to is null or occurred_at<=p_to))),
    jsonb_build_object('step','Leads','count', (select count(*) from public.leads where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))),
    jsonb_build_object('step','Signups','count', (select count(*) from public.profiles where role='patient' and (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))),
    jsonb_build_object('step','Onboarded','count', (select count(*) from public.profiles where role='patient' and onboarding_completed_at is not null and (p_from is null or onboarding_completed_at>=p_from) and (p_to is null or onboarding_completed_at<=p_to))),
    jsonb_build_object('step','Paid','count', (select count(*) from public.subscriptions where status in ('active','trialing') and (p_from is null or started_at>=p_from) and (p_to is null or started_at<=p_to)))
  );
end; $$;

-- ===========================================================================
-- ENGAGEMENT (logged-in activity from web_events.profile_id)
-- ===========================================================================
create or replace function public.analytics_engagement_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dau bigint; v_wau bigint; v_mau bigint;
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  select count(distinct profile_id) into v_dau from public.web_events where profile_id is not null and occurred_at >= now() - interval '1 day';
  select count(distinct profile_id) into v_wau from public.web_events where profile_id is not null and occurred_at >= now() - interval '7 days';
  select count(distinct profile_id) into v_mau from public.web_events where profile_id is not null and occurred_at >= now() - interval '30 days';
  return jsonb_build_object(
    'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
    'stickiness', case when v_mau = 0 then 0 else round(100.0 * v_dau / v_mau, 1) end
  );
end; $$;

create or replace function public.analytics_active_users_timeseries(p_period text default 'day')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_period text := case when p_period in ('day','week','month') then p_period else 'day' end;
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'active_users', au) order by bucket)
    from (select date_trunc(v_period, occurred_at) bucket, count(distinct profile_id) au
          from public.web_events where profile_id is not null group by 1) t
  ), '[]'::jsonb);
end; $$;

create or replace function public.analytics_feature_adoption()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return jsonb_build_array(
    jsonb_build_object('feature','Vitals logging','patients', (select count(distinct patient_id) from public.vitals_readings)),
    jsonb_build_object('feature','AI health coach','patients', (select count(distinct profile_id) from public.ai_conversations)),
    jsonb_build_object('feature','Care plans','patients', (select count(distinct patient_id) from public.care_plans)),
    jsonb_build_object('feature','Medications','patients', (select count(distinct patient_id) from public.medications)),
    jsonb_build_object('feature','Vaccinations','patients', (select count(distinct profile_id) from public.vaccination_records)),
    jsonb_build_object('feature','Screenings','patients', (select count(distinct patient_id) from public.screening_schedules)),
    jsonb_build_object('feature','Lifestyle coaching','patients', (select count(distinct patient_id) from public.lifestyle_programme_enrolments)),
    jsonb_build_object('feature','Preventive programmes','patients', (select count(distinct patient_id) from public.preventive_programme_enrolments))
  );
end; $$;

create or replace function public.analytics_retention_cohorts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row order by (row->>'cohort_week'))
    from (
      select jsonb_build_object(
        'cohort_week', to_char(c.cohort_week,'YYYY-MM-DD'),
        'cohort_size', c.cohort_size,
        'offsets', (
          select coalesce(jsonb_agg(jsonb_build_object('week_offset', o.k, 'retained', (
            select count(distinct w.profile_id) from public.web_events w
            where w.profile_id = any(c.members)
              and w.occurred_at >= c.cohort_week + (o.k || ' weeks')::interval
              and w.occurred_at <  c.cohort_week + ((o.k + 1) || ' weeks')::interval
          )) order by o.k), '[]'::jsonb)
          from generate_series(0,3) as o(k)
        )
      ) row
      from (
        select date_trunc('week', created_at) cohort_week, count(*) cohort_size, array_agg(id) members
        from public.profiles
        where role='patient' and created_at >= now() - interval '8 weeks'
        group by 1
      ) c
    ) rows
  ), '[]'::jsonb);
end; $$;

-- ===========================================================================
-- CLINICAL OUTCOMES & QUALITY  (thresholds are indicative)
-- ===========================================================================
create or replace function public.analytics_clinical_outcomes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'bp_control', (
      with latest as (
        select distinct on (patient_id) patient_id, systolic, diastolic
        from public.vitals_readings where vital_type='blood_pressure' and systolic is not null and diastolic is not null
        order by patient_id, taken_at desc
      )
      select jsonb_build_object('total', count(*), 'controlled', count(*) filter (where systolic < 140 and diastolic < 90),
        'pct', case when count(*)=0 then 0 else round(100.0 * count(*) filter (where systolic < 140 and diastolic < 90) / count(*), 1) end)
      from latest
    ),
    'glucose_control', (
      with latest as (
        select distinct on (patient_id) patient_id, glucose_mmol_l
        from public.vitals_readings where vital_type='glucose' and glucose_mmol_l is not null
        order by patient_id, taken_at desc
      )
      select jsonb_build_object('total', count(*), 'controlled', count(*) filter (where glucose_mmol_l <= 7.0),
        'pct', case when count(*)=0 then 0 else round(100.0 * count(*) filter (where glucose_mmol_l <= 7.0) / count(*), 1) end)
      from latest
    ),
    'risk_migration', (
      with ranked as (
        select patient_id,
          (case risk_level::text when 'low' then 1 when 'moderate' then 2 when 'high' then 3 when 'very_high' then 4 else 0 end) rank,
          row_number() over (partition by patient_id order by computed_at asc) rn_first,
          row_number() over (partition by patient_id order by computed_at desc) rn_last
        from public.patient_risk_scores
      ),
      pairs as (
        select f.patient_id, f.rank first_rank, l.rank last_rank
        from (select patient_id, rank from ranked where rn_first=1) f
        join (select patient_id, rank from ranked where rn_last=1) l on l.patient_id=f.patient_id
      )
      select coalesce(jsonb_agg(jsonb_build_object('direction', direction, 'patients', c) order by direction), '[]'::jsonb)
      from (
        select case when last_rank < first_rank then 'improved' when last_rank > first_rank then 'worsened' else 'stable' end direction, count(*) c
        from pairs group by 1
      ) t
    ),
    'screening_coverage', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
      from (select status::text status, count(*) c from public.screening_schedules group by status) t),
    'vaccination_coverage', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
      from (select status::text status, count(*) c from public.vaccination_schedules group by status) t)
  );
end; $$;

create or replace function public.analytics_escalation_quality(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'funnel', jsonb_build_object(
      'abnormal_results', (select count(*) from public.screening_results where result_status in ('abnormal','critical') and (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)),
      'alerts_raised', (select count(*) from public.clinician_alerts where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)),
      'escalations', (select count(*) from public.escalations where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)),
      'resolved', (select count(*) from public.escalations where status='resolved' and (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to))
    ),
    'sla', (
      select jsonb_build_object(
        'total', count(*) filter (where sla_due_at is not null),
        'met', count(*) filter (where sla_due_at is not null and acknowledged_at is not null and acknowledged_at <= sla_due_at),
        'breached', count(*) filter (where sla_due_at is not null and (acknowledged_at > sla_due_at or (acknowledged_at is null and sla_due_at < now()))),
        'pct_met', case when count(*) filter (where sla_due_at is not null)=0 then 0
          else round(100.0 * count(*) filter (where sla_due_at is not null and acknowledged_at is not null and acknowledged_at <= sla_due_at) / count(*) filter (where sla_due_at is not null), 1) end
      )
      from public.clinician_alerts where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)
    ),
    'avg_ack_minutes', (select coalesce(round(avg(extract(epoch from (acknowledged_at - created_at))/60.0)::numeric, 1), 0) from public.clinician_alerts where acknowledged_at is not null),
    'avg_resolution_hours', (select coalesce(round(avg(extract(epoch from (reviewed_at - created_at))/3600.0)::numeric, 1), 0) from public.escalations where reviewed_at is not null),
    'open_alerts', (select count(*) from public.clinician_alerts where status='open'),
    'overdue_alerts', (select count(*) from public.clinician_alerts where status='open' and sla_due_at is not null and sla_due_at < now())
  );
end; $$;

-- ===========================================================================
-- OPERATIONS & DELIVERABILITY
-- ===========================================================================
create or replace function public.analytics_operations_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'target_ratio', 120,
    'clinician_load', (
      select coalesce(jsonb_agg(jsonb_build_object('clinician', name, 'tier', tier, 'patients', patients) order by patients desc), '[]'::jsonb)
      from (
        select coalesce(cs.full_name, p.full_name, 'Unknown') name, cs.doctor_tier::text tier, count(*) patients
        from public.care_team_assignment cta
        left join public.profiles p on p.id = cta.clinician_id
        left join public.clinical_staff cs on cs.profile_id = cta.clinician_id
        group by coalesce(cs.full_name, p.full_name, 'Unknown'), cs.doctor_tier
      ) t
    ),
    'over_target', (select count(*) from (select cta.clinician_id, count(*) c from public.care_team_assignment cta group by cta.clinician_id having count(*) > 120) x),
    'escalation_queue', (select coalesce(jsonb_agg(jsonb_build_object('level', level, 'open', c) order by c desc), '[]'::jsonb)
      from (select level::text level, count(*) c from public.clinician_alerts where status='open' group by level) t),
    'orders', jsonb_build_object(
      'lab', (select jsonb_build_object('total', count(*), 'completed', count(*) filter (where resulted_at is not null),
        'avg_turnaround_hours', coalesce(round(avg(extract(epoch from (resulted_at - ordered_at))/3600.0) filter (where resulted_at is not null and ordered_at is not null)::numeric, 1), 0))
        from public.lab_orders),
      'pharmacy', (select jsonb_build_object('total', count(*), 'delivered', count(*) filter (where delivered_at is not null),
        'avg_turnaround_hours', coalesce(round(avg(extract(epoch from (delivered_at - requested_at))/3600.0) filter (where delivered_at is not null and requested_at is not null)::numeric, 1), 0))
        from public.pharmacy_orders),
      'referral', (select jsonb_build_object('total', count(*), 'confirmed', count(*) filter (where booking_confirmed_at is not null)) from public.specialist_referrals)
    )
  );
end; $$;

create or replace function public.analytics_deliverability(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'channel', channel, 'total', total, 'sent', sent, 'failed', failed, 'pending', pending,
        'success_pct', case when total=0 then 0 else round(100.0 * sent / total, 1) end) order by total desc), '[]'::jsonb)
      from (
        select channel::text channel, count(*) total,
          count(*) filter (where status in ('sent','delivered','read')) sent,
          count(*) filter (where status='failed') failed,
          count(*) filter (where status='pending') pending
        from public.notifications where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to)
        group by channel
      ) t
    ),
    'queue_depth', (select count(*) from public.notifications where status='pending'),
    'failures', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', c) order by c desc), '[]'::jsonb)
      from (select coalesce(last_error,'unknown') reason, count(*) c from public.notifications where status='failed' group by coalesce(last_error,'unknown')) t),
    'timeseries', (select coalesce(jsonb_agg(jsonb_build_object('bucket', to_char(bucket,'YYYY-MM-DD'), 'sent', sent, 'failed', failed) order by bucket), '[]'::jsonb)
      from (select date_trunc('day', created_at) bucket,
        count(*) filter (where status in ('sent','delivered','read')) sent, count(*) filter (where status='failed') failed
        from public.notifications where (p_from is null or created_at>=p_from) and (p_to is null or created_at<=p_to) group by 1) t)
  );
end; $$;

-- Lock execution to signed-in users (gate still returns empty to non-analysts).
do $$
declare fn text; fns text[] := array[
  'public.analytics_traffic_summary(timestamptz, timestamptz)',
  'public.analytics_traffic_timeseries(text, timestamptz, timestamptz)',
  'public.analytics_acquisition_funnel(timestamptz, timestamptz)',
  'public.analytics_engagement_summary()',
  'public.analytics_active_users_timeseries(text)',
  'public.analytics_feature_adoption()',
  'public.analytics_retention_cohorts()',
  'public.analytics_clinical_outcomes()',
  'public.analytics_escalation_quality(timestamptz, timestamptz)',
  'public.analytics_operations_summary()',
  'public.analytics_deliverability(timestamptz, timestamptz)'
];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end; $$;
