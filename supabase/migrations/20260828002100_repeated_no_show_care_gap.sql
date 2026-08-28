create or replace view public.patient_care_gaps
with (security_invoker = true) as
 SELECT 'overdue_screening'::text AS gap_type,
    ss.patient_id,
    ss.organisation_id,
    st.name AS condition_or_type,
    ss.due_date::timestamp with time zone AS opened_at,
    jsonb_build_object('screen_type', st.name, 'due_date', ss.due_date, 'status', ss.status) AS detail
   FROM screening_schedules ss
     JOIN screen_types st ON st.id = ss.screen_type_id
  WHERE (ss.status = ANY (ARRAY['pending'::screening_status, 'booked'::screening_status, 'overdue'::screening_status])) AND ss.due_date < CURRENT_DATE
UNION ALL
 SELECT 'stale_monitoring'::text AS gap_type,
    cp.patient_id,
    cp.organisation_id,
    cp.condition::text AS condition_or_type,
    cp.created_at AS opened_at,
    jsonb_build_object('condition', cp.condition, 'care_plan_id', cp.id, 'last_reading_at', latest_score.computed_at) AS detail
   FROM care_plans cp
     LEFT JOIN LATERAL ( SELECT prs.computed_at
           FROM patient_risk_scores prs
          WHERE prs.patient_id = cp.patient_id
          ORDER BY prs.computed_at DESC
         LIMIT 1) latest_score ON true
  WHERE cp.status = 'active'::care_plan_status AND (latest_score.computed_at IS NULL OR latest_score.computed_at < (now() -
        CASE cp.condition
            WHEN 'hypertension'::care_plan_condition THEN '90 days'::interval
            WHEN 'diabetes'::care_plan_condition THEN '90 days'::interval
            WHEN 'cardiovascular'::care_plan_condition THEN '90 days'::interval
            WHEN 'ckd'::care_plan_condition THEN '90 days'::interval
            ELSE '180 days'::interval
        END))
UNION ALL
 SELECT 'unactioned_abnormal'::text AS gap_type,
    sr.patient_id,
    sr.organisation_id,
    COALESCE(sr.result_summary, 'abnormal result'::text) AS condition_or_type,
    sr.created_at AS opened_at,
    jsonb_build_object('result_id', sr.id, 'result_status', sr.result_status, 'abnormal_flags', sr.abnormal_flags) AS detail
   FROM screening_results sr
  WHERE (sr.result_status = ANY (ARRAY['abnormal'::result_status, 'critical'::result_status])) AND NOT (EXISTS ( SELECT 1
           FROM care_plans cp
          WHERE cp.patient_id = sr.patient_id AND cp.status = 'active'::care_plan_status AND cp.created_at >= sr.created_at))
UNION ALL
 SELECT 'awaiting_result'::text AS gap_type,
    lo.patient_id,
    lo.organisation_id,
    COALESCE(pb.name, 'lab test'::text) AS condition_or_type,
    lo.ordered_at AS opened_at,
    jsonb_build_object('lab_order_id', lo.id, 'order_number', lo.order_number, 'panel', pb.name, 'ordered_at', lo.ordered_at) AS detail
   FROM lab_orders lo
     LEFT JOIN panel_bundles pb ON pb.id = lo.panel_bundle_id
  WHERE lo.fulfilment = 'self_arranged'::fulfilment_mode
    AND lo.status = 'ordered'::lab_order_status
    AND lo.ordered_at < (now() - '21 days'::interval)
    AND NOT (EXISTS ( SELECT 1
           FROM lab_result_documents d
          WHERE d.lab_order_id = lo.id))
UNION ALL
 SELECT 'repeated_no_show'::text AS gap_type,
    ns.patient_id,
    ns.organisation_id,
    'appointment'::text AS condition_or_type,
    ns.last_no_show_at AS opened_at,
    jsonb_build_object('no_show_count', ns.no_show_count, 'most_recent_no_show_at', ns.last_no_show_at) AS detail
   FROM ( SELECT a.patient_id,
            a.organisation_id,
            count(*) AS no_show_count,
            max(a.scheduled_for) AS last_no_show_at
           FROM appointments a
          WHERE a.status = 'no_show'::appointment_status
            AND a.scheduled_for >= (now() - '90 days'::interval)
          GROUP BY a.patient_id, a.organisation_id
         HAVING count(*) >= 2) ns
  WHERE NOT (EXISTS ( SELECT 1
           FROM appointments a2
          WHERE a2.patient_id = ns.patient_id
            AND a2.status = 'completed'::appointment_status
            AND a2.scheduled_for > ns.last_no_show_at));

comment on view public.patient_care_gaps is
  'Derived read-model of open care gaps. No new source of truth. awaiting_result = a self-arranged test issued 21+ days ago with nothing uploaded against it. repeated_no_show = 2+ missed appointments in 90 days with nothing completed since (Consultation System §9.13).';

-- queue_care_outreach: the else-branch would otherwise mis-map the new gap
-- type to stale_monitoring. Everything else preserved byte-for-byte from
-- the live definition (20260811235133_guarantee_in_app_notification_companions.sql).
create or replace function private.queue_care_outreach()
returns void
language sql
security definer
set search_path = ''
as $$
  with latest_risk as (
    select distinct on (prs.patient_id)
      prs.patient_id, prs.organisation_id, prs.risk_level, prs.score_type,
      prs.id as score_id, prs.computed_at
    from public.patient_risk_scores prs
    where prs.computed_at >= now() - interval '120 days'
    order by prs.patient_id, prs.computed_at desc
  ),
  candidates as (
    select
      lr.organisation_id,
      lr.patient_id,
      'high_risk_score'::public.outreach_trigger_type as trigger_type,
      jsonb_build_object(
        'risk_level', lr.risk_level,
        'score_type', lr.score_type,
        'score_id', lr.score_id,
        'computed_at', lr.computed_at
      ) as trigger_detail,
      case when lr.risk_level = 'very_high' then 1 else 2 end as priority
    from latest_risk lr
    where lr.risk_level in ('high', 'very_high')

    union all

    select
      g.organisation_id,
      g.patient_id,
      case g.gap_type
        when 'unactioned_abnormal' then 'unactioned_abnormal'
        when 'overdue_screening' then 'overdue_screening'
        when 'awaiting_result' then 'awaiting_result'
        when 'repeated_no_show' then 'repeated_no_show'
        else 'stale_monitoring'
      end::public.outreach_trigger_type,
      g.detail || jsonb_build_object('condition_or_type', g.condition_or_type, 'opened_at', g.opened_at),
      case g.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        when 'awaiting_result' then 2
        when 'repeated_no_show' then 2
        else 3
      end
    from public.patient_care_gaps g
  ),
  inserted as (
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select organisation_id, patient_id, trigger_type, trigger_detail, priority, now()
    from candidates
    on conflict (patient_id, trigger_type)
      where status in ('open', 'in_progress', 'contacted')
      do nothing
    returning id, organisation_id, patient_id, trigger_type
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      i.organisation_id,
      i.patient_id,
      'whatsapp',
      'pending',
      'care_outreach_checkin',
      jsonb_build_object('reasons', array_agg(distinct i.trigger_type::text))
    from inserted i
    group by i.organisation_id, i.patient_id
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    i.organisation_id,
    i.patient_id,
    'in_app',
    'pending',
    'care_outreach_checkin',
    jsonb_build_object('reasons', array_agg(distinct i.trigger_type::text))
  from inserted i
  group by i.organisation_id, i.patient_id;
$$;

do $$
begin
  if not exists (
    select 1 from pg_views where schemaname = 'public' and viewname = 'patient_care_gaps'
      and definition like '%repeated_no_show%'
  ) then
    raise exception 'patient_care_gaps is missing the repeated_no_show branch';
  end if;

  if not exists (
    select 1 from pg_views where schemaname = 'public' and viewname = 'patient_care_gaps'
      and definition like '%awaiting_result%'
  ) then
    raise exception 'patient_care_gaps lost a pre-existing branch (awaiting_result) during the rewrite';
  end if;

  raise notice 'PASS: patient_care_gaps repeated_no_show branch present, prior branches intact';
end $$;
