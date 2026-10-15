-- S16-S20 Stage 6 (W6.3): the care funnel, read only, for the Chief Medical Officer and admins.
--
-- One function, public.care_funnel_metrics(p_days), returns counts over the last p_days (default 30, 1 to 90) for the caller's own
-- organisation, test accounts excluded:
--   * alerts          clinician_alerts raised and not suppressed
--   * pages           root red-event pages (a merged or repeat page is not a new page)
--   * doctor_reviews  clinical tasks completed
--   * emergencies     emergency_events opened
--   * ratios          pages, reviews and emergencies per alert (null when there were no alerts, never a divide by zero)
--   * continuity      of completed tasks whose patient had a lead at creation, the share the lead handled, with the reason for each
--                     fallback (lead handed it back, lead's claim ran out, escalated, or the offer was never taken). Tasks with no lead
--                     are counted separately and never counted as a fallback: attribution is null-gated, a task with no lead has no
--                     "should have been" clinician. No clinician name, id or patient appears anywhere in the result.
-- Nothing is written. SECURITY DEFINER because the caller (a CMO) has no direct read on all of these tables; the gate is
-- private.task_staff_reader() (admin or the Chief Medical Officer), the same gate as queue_health(). Revoked from public and anon.
-- On the live project at the time of writing every one of these counts is zero or near zero (no task has been claimed yet), so the
-- ratios are null until real work flows.

create or replace function public.care_funnel_metrics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 90));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)));
  v_org uuid := private.current_org_id();
  v_alerts integer;
  v_pages integer;
  v_reviews integer;
  v_emergencies integer;
  v_with_lead integer;
  v_by_lead integer;
  v_no_lead integer;
  v_reasons jsonb;
begin
  if not private.task_staff_reader() then raise exception 'not authorised' using errcode = '42501'; end if;

  select count(*) into v_alerts
    from public.clinician_alerts a join public.profiles p on p.id = a.patient_id
   where a.organisation_id = v_org and a.created_at >= v_since and not coalesce(a.suppressed, false) and not coalesce(p.is_test, false);

  select count(*) into v_pages
    from public.pages g
   where g.organisation_id = v_org and g.created_at >= v_since and g.parent_page_id is null and not g.is_test;

  select count(*) into v_reviews
    from public.clinical_tasks t
   where t.organisation_id = v_org and t.state = 'completed' and t.completed_at >= v_since and not t.is_test;

  select count(*) into v_emergencies
    from public.emergency_events e join public.profiles p on p.id = e.patient_id
   where e.organisation_id = v_org and e.created_at >= v_since and not coalesce(p.is_test, false);

  with done as (
    select t.id, t.lead_clinician_id, t.claimed_by, t.state
      from public.clinical_tasks t
     where t.organisation_id = v_org and t.state = 'completed' and t.completed_at >= v_since and not t.is_test
  ), classified as (
    select d.*,
           case
             when d.lead_clinician_id is null then 'no_lead'
             when d.claimed_by = d.lead_clinician_id then 'by_lead'
             when exists (select 1 from public.task_claims c where c.task_id = d.id and c.clinician_id = d.lead_clinician_id and c.end_reason = 'handed_back') then 'lead_handed_back'
             when exists (select 1 from public.task_claims c where c.task_id = d.id and c.clinician_id = d.lead_clinician_id and c.end_reason = 'expired') then 'lead_claim_expired'
             when exists (select 1 from public.clinical_task_transitions x where x.task_id = d.id and x.to_state = 'escalated') then 'escalated'
             else 'offer_not_taken'
           end as bucket
      from done d
  )
  select count(*) filter (where bucket <> 'no_lead'),
         count(*) filter (where bucket = 'by_lead'),
         count(*) filter (where bucket = 'no_lead'),
         coalesce(jsonb_object_agg(bucket, n) filter (where bucket not in ('by_lead', 'no_lead')), '{}'::jsonb)
    into v_with_lead, v_by_lead, v_no_lead, v_reasons
    from (select bucket, count(*) over (partition by bucket) as n from classified) z;

  return jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'alerts', v_alerts,
    'pages', v_pages,
    'doctor_reviews', v_reviews,
    'emergencies', v_emergencies,
    'ratios', jsonb_build_object(
      'pages_per_alert', case when v_alerts > 0 then round(v_pages::numeric / v_alerts, 3) end,
      'reviews_per_alert', case when v_alerts > 0 then round(v_reviews::numeric / v_alerts, 3) end,
      'emergencies_per_alert', case when v_alerts > 0 then round(v_emergencies::numeric / v_alerts, 3) end),
    'continuity', jsonb_build_object(
      'completed_with_lead', v_with_lead,
      'handled_by_lead', v_by_lead,
      'share', case when v_with_lead > 0 then round(v_by_lead::numeric / v_with_lead, 3) end,
      'completed_without_lead', v_no_lead,
      'fallback_reasons', v_reasons));
end;
$$;

comment on function public.care_funnel_metrics(integer) is
  'S16-S20 W6.3: read-only care funnel (alerts, pages, completed doctor reviews, emergencies, ratios per alert, continuity share with fallback reasons) for the caller''s organisation over the last p_days. CMO or admin only. No names or ids.';

revoke all on function public.care_funnel_metrics(integer) from public, anon;
grant execute on function public.care_funnel_metrics(integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.care_funnel_metrics(integer)', 'EXECUTE') then
    raise exception 'S16-S20 W6.3: anon can execute care_funnel_metrics';
  end if;
  if not has_function_privilege('authenticated', 'public.care_funnel_metrics(integer)', 'EXECUTE') then
    raise exception 'S16-S20 W6.3: authenticated cannot execute care_funnel_metrics';
  end if;
end $$;
