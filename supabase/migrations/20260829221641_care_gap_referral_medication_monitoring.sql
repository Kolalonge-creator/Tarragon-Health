-- Operations & Command Centre (§96.5 "care-gap monitoring"): three more gap
-- types on the existing patient_care_gaps -> care_outreach_tasks pipeline,
-- same "no new source of truth" discipline as every prior gap addition
-- (20260716150000_care_gap_view.sql / 20260803125639_awaiting_result_care_gap.sql /
-- 20260828000123_repeated_no_show_care_gap.sql):
--   overdue_referral            — a specialist_referrals row still open
--                                  (not completed/closed/declined/draft, no
--                                  treatment_plan_received_at) 30+ days after
--                                  submission.
--   overdue_medication_review   — medication_reviews past due_date, pending.
--   overdue_lab_monitoring      — medication_lab_monitoring past due_date
--                                  (excludes the "as clinically indicated"
--                                  rows where due_date is null), pending.
--
-- Live-schema inspection immediately before writing this (2026-08-29) found:
--   1. private.queue_care_outreach() has drifted from every committed
--      migration that touches it — the live function already has 3 more
--      candidate branches (care_tasks, a broader missed_appointment sweep,
--      and a specialist_referrals-declined "failed_referral" branch) with no
--      matching local migration file at all. Reproduced byte-for-byte from
--      pg_get_functiondef, unchanged, alongside this migration's edits.
--   2. specialist_referrals has a same-day-in-flight "referral management
--      engine" migration batch live (referral_management_engine_fields /
--      referral_status_add_draft / specialist_referral_create_gate /
--      referral_stale_sweeps_exclude_draft) adding submitted_at, closed_at,
--      and a new 'draft' referral_status value, none of which exist in this
--      repo's committed migrations yet either. overdue_referral is written
--      against that live shape (submitted_at as the "in flight since"
--      timestamp, closed_at as an additional terminal signal, draft excluded
--      since a draft referral was never actually submitted).
--   3. patient_care_gaps itself had NOT drifted — the live view text matches
--      20260828000123_repeated_no_show_care_gap.sql byte-for-byte, so its 5
--      existing branches are reproduced from that file, not a fresh pull.
--
-- The 3 new outreach_trigger_type enum values this migration relies on were
-- added in the immediately-preceding migration
-- (20260829221455_care_gap_outreach_trigger_type_values.sql) — ALTER TYPE
-- ADD VALUE cannot be used in the same transaction that adds it.

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
    sr2.patient_id,
    sr2.organisation_id,
    COALESCE(sr2.result_summary, 'abnormal result'::text) AS condition_or_type,
    sr2.created_at AS opened_at,
    jsonb_build_object('result_id', sr2.id, 'result_status', sr2.result_status, 'abnormal_flags', sr2.abnormal_flags) AS detail
   FROM screening_results sr2
  WHERE (sr2.result_status = ANY (ARRAY['abnormal'::result_status, 'critical'::result_status])) AND NOT (EXISTS ( SELECT 1
           FROM care_plans cp
          WHERE cp.patient_id = sr2.patient_id AND cp.status = 'active'::care_plan_status AND cp.created_at >= sr2.created_at))
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
            AND a2.scheduled_for > ns.last_no_show_at))
UNION ALL
 SELECT 'overdue_referral'::text AS gap_type,
    sr3.patient_id,
    sr3.organisation_id,
    sr3.specialist_type::text AS condition_or_type,
    COALESCE(sr3.submitted_at, sr3.created_at) AS opened_at,
    jsonb_build_object('referral_id', sr3.id, 'referral_number', sr3.referral_number, 'status', sr3.status, 'specialist_type', sr3.specialist_type) AS detail
   FROM specialist_referrals sr3
  WHERE sr3.status NOT IN ('completed'::referral_status, 'closed'::referral_status, 'declined'::referral_status, 'draft'::referral_status)
    AND sr3.closed_at IS NULL
    AND sr3.treatment_plan_received_at IS NULL
    AND COALESCE(sr3.submitted_at, sr3.created_at) < (now() - '30 days'::interval)
UNION ALL
 SELECT 'overdue_medication_review'::text AS gap_type,
    mr.patient_id,
    mr.organisation_id,
    'medication review'::text AS condition_or_type,
    mr.due_date::timestamp with time zone AS opened_at,
    jsonb_build_object('medication_review_id', mr.id, 'care_plan_id', mr.care_plan_id, 'due_date', mr.due_date) AS detail
   FROM medication_reviews mr
  WHERE mr.status = 'pending'::medication_review_status
    AND mr.due_date < CURRENT_DATE
UNION ALL
 SELECT 'overdue_lab_monitoring'::text AS gap_type,
    mlm.patient_id,
    mlm.organisation_id,
    mlm.monitoring_label AS condition_or_type,
    mlm.due_date::timestamp with time zone AS opened_at,
    jsonb_build_object('medication_lab_monitoring_id', mlm.id, 'medication_id', mlm.medication_id, 'drug_class', mlm.drug_class, 'monitoring_label', mlm.monitoring_label, 'due_date', mlm.due_date) AS detail
   FROM medication_lab_monitoring mlm
  WHERE mlm.status = 'pending'::lab_monitoring_status
    AND mlm.due_date IS NOT NULL
    AND mlm.due_date < CURRENT_DATE;

comment on view public.patient_care_gaps is
  'Derived read-model of open care gaps. No new source of truth. awaiting_result = a self-arranged test issued 21+ days ago with nothing uploaded against it. repeated_no_show = 2+ missed appointments in 90 days with nothing completed since. overdue_referral = a specialist referral open 30+ days with no treatment plan received. overdue_medication_review / overdue_lab_monitoring = medication_reviews / medication_lab_monitoring past due_date, still pending.';

-- queue_care_outreach: reproduced byte-for-byte from the live definition
-- (pg_get_functiondef, pulled immediately before writing this migration),
-- extending only the patient_care_gaps-sourced branch's two inner CASE
-- statements with the 3 new gap types. The care_tasks / missed_appointment /
-- failed_referral branches below are untouched, drifted-live code this
-- migration does not own — preserved exactly so this CREATE OR REPLACE
-- doesn't silently regress them.
create or replace function private.queue_care_outreach()
returns void
language sql
security definer
set search_path to ''
as $function$
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
        when 'overdue_referral' then 'overdue_referral'
        when 'overdue_medication_review' then 'overdue_medication_review'
        when 'overdue_lab_monitoring' then 'overdue_lab_monitoring'
        else 'stale_monitoring'
      end::public.outreach_trigger_type,
      g.detail || jsonb_build_object('condition_or_type', g.condition_or_type, 'opened_at', g.opened_at),
      case g.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        when 'awaiting_result' then 2
        when 'repeated_no_show' then 2
        when 'overdue_referral' then 2
        when 'overdue_medication_review' then 3
        when 'overdue_lab_monitoring' then 3
        else 3
      end
    from public.patient_care_gaps g

    union all

    select
      ct.organisation_id,
      ct.patient_id,
      'missed_care_task'::public.outreach_trigger_type,
      jsonb_build_object('task_id', ct.id, 'title', ct.title, 'status', ct.status, 'due_at', ct.due_at),
      case when ct.priority = 1 then 1 else 2 end
    from public.care_tasks ct
    where ct.status in ('missed', 'expired', 'unable_to_complete')

    union all

    select
      a.organisation_id,
      a.patient_id,
      'missed_appointment'::public.outreach_trigger_type,
      jsonb_build_object(
        'appointment_id', a.id, 'scheduled_for', a.scheduled_for, 'reason', a.reason
      ),
      2
    from public.appointments a
    where a.status = 'no_show'
      and a.updated_at >= now() - interval '14 days'

    union all

    select
      sr.organisation_id,
      sr.patient_id,
      'failed_referral'::public.outreach_trigger_type,
      jsonb_build_object(
        'referral_id', sr.id, 'specialist_type', sr.specialist_type, 'reason', sr.referral_reason
      ),
      2
    from public.specialist_referrals sr
    where sr.status = 'declined'
      and sr.updated_at >= now() - interval '30 days'
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
$function$;

do $$
declare v_def text;
begin
  if not exists (
    select 1 from pg_views where schemaname = 'public' and viewname = 'patient_care_gaps'
      and definition like '%overdue_referral%'
      and definition like '%overdue_medication_review%'
      and definition like '%overdue_lab_monitoring%'
  ) then
    raise exception 'patient_care_gaps is missing one of the 3 new gap-type branches';
  end if;

  if not exists (
    select 1 from pg_views where schemaname = 'public' and viewname = 'patient_care_gaps'
      and definition like '%overdue_screening%'
      and definition like '%stale_monitoring%'
      and definition like '%unactioned_abnormal%'
      and definition like '%awaiting_result%'
      and definition like '%repeated_no_show%'
  ) then
    raise exception 'patient_care_gaps lost a pre-existing gap type during the rewrite';
  end if;

  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname = 'queue_care_outreach' and pronamespace = 'private'::regnamespace;

  if v_def not like '%when ''overdue_referral'' then ''overdue_referral''%'
    or v_def not like '%when ''overdue_medication_review'' then ''overdue_medication_review''%'
    or v_def not like '%when ''overdue_lab_monitoring'' then ''overdue_lab_monitoring''%'
  then
    raise exception 'queue_care_outreach would mis-map a new gap type to stale_monitoring';
  end if;

  -- The 3 branches this migration does not own must survive the rewrite too.
  if v_def not like '%missed_care_task%'
    or v_def not like '%''missed_appointment''::public.outreach_trigger_type%'
    or v_def not like '%''failed_referral''::public.outreach_trigger_type%'
  then
    raise exception 'queue_care_outreach lost a pre-existing (drifted-live) branch during the rewrite';
  end if;

  raise notice 'PASS: patient_care_gaps + queue_care_outreach carry the 3 new gap types, all prior branches intact';
end $$;
