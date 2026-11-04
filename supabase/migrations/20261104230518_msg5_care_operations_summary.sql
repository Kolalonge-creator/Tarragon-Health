-- MSG-5 (messaging redesign, build step 3 in docs/design/MESSAGING-2.md): the care operations summary behind /clinician/care-operations
-- and the coordinator's Operations tab. One read function, no table, no column, no data change, so no row count is needed.
--
-- public.care_operations_summary(p_target_hours, p_lookback_days) returns, for the caller's own organisation only:
--   * messages: new patient or supporter messages today (Lagos day); open threads waiting on a reply in the support queue and in the
--     clinical queue; threads that need a doctor; threads past the reply target (counted from awaiting_reply_since, with the lookback on
--     recent activity, the same rule as lib/worklist/message-triage.ts); waiting threads with no owner; older unanswered threads;
--   * alerts: open or acknowledged emergency and urgent clinician alerts, and open unread-clinical-message alerts (not suppressed, not
--     a duplicate);
--   * monthly meetings this month (member_followup_entitlements covering now): available, booked, done;
--   * workload: one row per active clinician or Care Coordinator login in the organisation, with the open threads they own that are
--     waiting, past target, or need a doctor. Ordered by name, never by a measure: it shows where work sits, it does not rank anyone.
-- The reply target and lookback come from the caller (the shared config care_messages.reply_target), so the page and this function
-- cannot drift apart; out-of-range values are refused.
--
-- Access: any signed-in staff member of the organisation (private.is_org_staff on the caller's own organisation). SECURITY DEFINER because
-- member_followup_entitlements has no staff policy (it is read through functions only); everything is filtered to the caller's
-- organisation explicitly. It returns counts and staff names only, never a patient name, id or message. Test patients and test staff
-- are left out (INV-13).

create or replace function public.care_operations_summary(p_target_hours integer default 24, p_lookback_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  v_today timestamptz := (date_trunc('day', now() at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos';
  v_target interval;
  v_lookback interval;
  v_messages jsonb;
  v_alerts jsonb;
  v_meetings jsonb;
  v_workload jsonb;
begin
  if v_uid is null or v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_target_hours is null or p_target_hours < 1 or p_target_hours > 720
     or p_lookback_days is null or p_lookback_days < 1 or p_lookback_days > 366 then
    raise exception 'bad arguments' using errcode = '22023';
  end if;
  v_target := make_interval(hours => p_target_hours);
  v_lookback := make_interval(days => p_lookback_days);

  with t as (
    select th.*
    from public.care_message_threads th
    join public.profiles pt on pt.id = th.patient_id
    where th.organisation_id = v_org and not coalesce(pt.is_test, false)
  ), waiting as (
    select t.*, (t.last_message_author_role in ('patient', 'sponsor')) as patient_last
    from t where t.status = 'open' and t.awaiting_reply_since is not null
  )
  select jsonb_build_object(
    'new_today', (
      select count(*) from public.care_messages m join t on t.id = m.thread_id
      where m.author_role in ('patient', 'sponsor') and m.created_at >= v_today),
    'support_waiting', (select count(*) from waiting where queue = 'support'),
    'clinical_waiting', (select count(*) from waiting where queue = 'clinical'),
    'needs_doctor', (select count(*) from t where t.status = 'open' and t.needs_doctor),
    'past_target', (
      select count(*) from waiting
      where patient_last and now() - awaiting_reply_since > v_target and now() - last_message_at <= v_lookback),
    'older_unanswered', (select count(*) from waiting where patient_last and now() - last_message_at > v_lookback),
    'unowned_waiting', (
      select count(*) from waiting w where not exists (select 1 from public.care_thread_owners o where o.thread_id = w.id))
  ) into v_messages;

  select jsonb_build_object(
    'emergency_open', count(*) filter (where coalesce(a.override_level, a.level) = 'emergency'),
    'urgent_open', count(*) filter (where coalesce(a.override_level, a.level) = 'urgent_escalation'),
    'unread_message_alerts_open', count(*) filter (where a.type_code = 'unread_clinical_care_message')
  ) into v_alerts
  from public.clinician_alerts a
  join public.profiles pt on pt.id = a.patient_id
  where a.organisation_id = v_org and a.status in ('open', 'acknowledged')
    and not coalesce(a.suppressed, false) and a.duplicate_of is null and not coalesce(pt.is_test, false);

  select jsonb_build_object(
    'available', count(*) filter (where e.state = 'available'),
    'booked', count(*) filter (where e.state = 'booked'),
    'done', count(*) filter (where e.state = 'consumed')
  ) into v_meetings
  from public.member_followup_entitlements e
  where e.organisation_id = v_org and not e.is_test and e.period_start <= now() and now() < e.period_end;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.name), '[]'::jsonb) into v_workload
  from (
    select p.id as staff_id, coalesce(p.full_name, 'Colleague') as name, p.role::text as role,
           exists (select 1 from public.clinical_staff cs
                   where cs.profile_id = p.id and cs.organisation_id = v_org and cs.active
                     and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')) as is_doctor,
           count(th.id) filter (where th.awaiting_reply_since is not null) as waiting,
           count(th.id) filter (where th.awaiting_reply_since is not null and th.last_message_author_role in ('patient', 'sponsor')
                                  and now() - th.awaiting_reply_since > v_target and now() - th.last_message_at <= v_lookback) as past_target,
           count(th.id) filter (where th.needs_doctor) as needs_doctor
    from public.profiles p
    left join public.care_thread_owners o on o.owner_id = p.id
    left join public.care_message_threads th on th.id = o.thread_id and th.status = 'open' and th.organisation_id = v_org
      and not exists (select 1 from public.profiles pt where pt.id = th.patient_id and coalesce(pt.is_test, false))
    where p.organisation_id = v_org and p.is_active and p.role in ('clinician', 'care_coordinator') and not coalesce(p.is_test, false)
    group by p.id, p.full_name, p.role
  ) x;

  return jsonb_build_object(
    'messages', v_messages,
    'alerts', v_alerts,
    'monthly_meetings', v_meetings,
    'workload', v_workload,
    'target_hours', p_target_hours,
    'lookback_days', p_lookback_days
  );
end;
$$;

revoke execute on function public.care_operations_summary(integer, integer) from public, anon;
grant execute on function public.care_operations_summary(integer, integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.care_operations_summary(integer,integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute care_operations_summary';
  end if;
end $$;
