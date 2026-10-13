-- P1 (R1 part 2, R9, D1 tooling): chain health, the reliability measures competitors do not publish, and legacy-versus-engine parity.
--
-- 1. public.chain_health(): ONE read for the chain health page (admin and the active CMO only): last canary result, deliveries stuck or
--    dead on the chain's subscribers, real-patient timings (reading to graded, graded to page, page to acknowledgement) against
--    thresholds in chain_canary_config.rules.health (PROPOSED, CMO owned; mirrored in the registry as chain.canary_and_health), and a
--    plain status with reasons. It decides nothing clinical and returns no patient id.
-- 2. R9 measurement, added to the S38 analytics layer without a new fact table: private.chain_timing_rows() reads the facts that already
--    exist (triage_events, clinical_tasks, pages, notifications, clinical_staff); analytics.v_chain_timings exposes them for BI with no
--    patient identifier and no test row (INV-13, service role only); public.chain_reliability_report() gives the aggregate for the CMO:
--    time to grade, grade to task, task to acknowledgement (a clinician claiming it), act rate, page to acknowledgement, push open rate by
--    phone make, credential expiry coverage. Percentiles show only from minSample events (small numbers say so, never a flattering median).
-- 3. D1 parity tooling. S12b's triage_shadow_divergence() reads shadow rows only (e.shadow) BY DESIGN and its own proof asserts approved
--    events are not counted. With bp_care_triage v3 approved every new event is non-shadow, so that report is now empty. It is left
--    untouched. public.triage_engine_parity() compares every graded non-test blood pressure reading with what the legacy pipeline ACTUALLY
--    did for it (the emergency_events and clinician_alerts rows the old trigger made), which is the parity the CMO asked to see (decision Q1)
--    before any legacy trigger is retired. NOTHING is retired here.
--    Known limit (printed on the page): the legacy trigger merges a repeat into an open alert and de-duplicates emergencies for six hours, so
--    only the first reading in such a window shows its legacy action.

-- 1. Timings, from facts that already exist ----------------------------------------------------------------------------------
create function private.chain_timing_rows(p_days integer, p_test boolean)
returns table (metric text, day date, seconds numeric)
language sql stable security definer set search_path = ''
as $$
  with win as (select now() - make_interval(days => greatest(1, least(p_days, 365))) as since)
  select 'reading_to_graded', (te.created_at at time zone 'Africa/Lagos')::date, extract(epoch from te.created_at - vr.created_at)
    from public.triage_events te join public.vitals_readings vr on vr.id = te.trigger_id, win
   where te.trigger_type = 'observation' and not te.shadow and te.is_test = p_test and te.created_at >= win.since
  union all
  select 'graded_to_task', (te.created_at at time zone 'Africa/Lagos')::date, extract(epoch from t.first_task - te.created_at)
    from public.triage_events te
    join lateral (select min(ct.created_at) as first_task from public.clinical_tasks ct where ct.triage_event_id = te.id) t on t.first_task is not null, win
   where not te.shadow and te.is_test = p_test and te.created_at >= win.since
  union all
  select 'graded_to_page', (te.created_at at time zone 'Africa/Lagos')::date, extract(epoch from p.sent_at - te.created_at)
    from public.pages p join public.triage_events te on te.id = p.triage_event_id, win
   where p.parent_page_id is null and p.is_test = p_test and p.sent_at >= win.since
  union all
  select 'page_to_ack', (p.sent_at at time zone 'Africa/Lagos')::date, extract(epoch from p.acknowledged_at - p.sent_at)
    from public.pages p, win
   where p.parent_page_id is null and p.is_test = p_test and p.acknowledged_at is not null and p.sent_at >= win.since
  union all
  select 'task_to_claim', (ct.created_at at time zone 'Africa/Lagos')::date, extract(epoch from ct.claimed_at - ct.created_at)
    from public.clinical_tasks ct, win
   where ct.is_test = p_test and ct.claimed_at is not null and ct.created_at >= win.since;
$$;
revoke all on function private.chain_timing_rows(integer, boolean) from public, anon, authenticated;

-- BI view: metric, day and seconds only. No patient, no task, no clinician, no test row.
create view analytics.v_chain_timings with (security_invoker = off) as
  select metric, day, seconds from private.chain_timing_rows(365, false);
revoke all on analytics.v_chain_timings from public, anon, authenticated;
grant select on analytics.v_chain_timings to service_role;
comment on view analytics.v_chain_timings is 'P1/R9: timings of the clinical chain for real (non-test) events over the last year. Metric, day, seconds. No identifier of any kind.';

-- 2. The aggregate for the CMO (R9) -------------------------------------------------------------------------------------------
create function private.chain_percentiles(p_metric text, p_days integer, p_test boolean, p_min integer) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when count(*) = 0 then jsonb_build_object('n', 0, 'withheld', false)
              when count(*) < p_min then jsonb_build_object('n', count(*), 'withheld', true)
              else jsonb_build_object('n', count(*), 'withheld', false,
                     'p50', round((percentile_cont(0.5) within group (order by seconds))::numeric, 1),
                     'p95', round((percentile_cont(0.95) within group (order by seconds))::numeric, 1)) end
    from private.chain_timing_rows(p_days, p_test) where metric = p_metric and seconds is not null;
$$;
revoke all on function private.chain_percentiles(text, integer, boolean, integer) from public, anon, authenticated;

create function public.chain_reliability_report(p_days integer default 30) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_min integer := coalesce((private.chain_canary_rule('health') ->> 'minSample')::integer, 20);
  v_cell integer := coalesce((private.outcome_rule('min_cell') #>> '{}')::integer, 20);
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_out jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'chain_not_authorised' using errcode = '42501';
  end if;
  v_out := jsonb_build_object(
    'days', v_days,
    'minSample', v_min,
    'timings', jsonb_build_object(
      'reading_to_graded', private.chain_percentiles('reading_to_graded', v_days, false, v_min),
      'graded_to_task', private.chain_percentiles('graded_to_task', v_days, false, v_min),
      'task_to_claim', private.chain_percentiles('task_to_claim', v_days, false, v_min),
      'graded_to_page', private.chain_percentiles('graded_to_page', v_days, false, v_min),
      'page_to_ack', private.chain_percentiles('page_to_ack', v_days, false, v_min)),
    -- act rate: of tasks whose due time has passed and were not cancelled, the share completed, and the share completed on time
    'act_rate', (select jsonb_build_object('due', count(*),
                    'completed', count(*) filter (where state = 'completed'),
                    'completed_on_time', count(*) filter (where state = 'completed' and completed_at <= due_at),
                    'withheld', count(*) < v_min)
                   from public.clinical_tasks where not is_test and state <> 'cancelled' and due_at < now() and created_at >= v_since),
    'page_ack', (select jsonb_build_object('pages', count(*), 'acknowledged', count(*) filter (where acknowledged_at is not null),
                    'withheld', count(*) < v_min)
                   from public.pages where not is_test and parent_page_id is null and sent_at >= v_since),
    -- push open rate by phone make (read from the push subscription's user agent; a make we cannot tell is 'other'). Cells under the platform minimum are withheld.
    'push_open_by_make', coalesce((
      select jsonb_agg(case when q.n < v_cell then jsonb_build_object('make', q.make, 'withheld', true, 'under', v_cell)
                            else jsonb_build_object('make', q.make, 'sent', q.n, 'opened', q.opened, 'open_rate', round(100.0 * q.opened / q.n, 1)) end order by q.make)
        from (
          select m.make, count(*) n, count(*) filter (where n.opened_at is not null) opened
            from public.notifications n
            join public.profiles pr on pr.id = n.recipient_id and not pr.is_test
            left join lateral (
              select case
                  when ua ~ 'tecno' then 'Tecno' when ua ~ 'infinix' then 'Infinix' when ua ~ 'itel' then 'Itel'
                  when ua ~ 'samsung|sm-[a-z]' then 'Samsung' when ua ~ 'iphone|ipad|darwin|cfnetwork' then 'Apple'
                  when ua ~ 'xiaomi|redmi|poco' then 'Xiaomi' when ua ~ 'oppo|realme|vivo|oneplus' then 'Oppo group'
                  else 'Other or unknown' end as make
                from (select lower(coalesce(ps.user_agent, '')) as ua from public.push_subscriptions ps
                       where ps.profile_id = n.recipient_id and ps.disabled_at is null order by ps.last_seen_at desc nulls last limit 1) x
            ) m on true
           where n.channel = 'push' and n.status in ('sent', 'delivered', 'read') and n.created_at >= v_since
           group by m.make) q), '[]'::jsonb),
    'credential_coverage', (select jsonb_build_object(
        'active_staff', count(*),
        'licence_date_held', count(*) filter (where cs.license_expires_at is not null),
        'indemnity_required', count(*) filter (where coalesce(private.indemnity_required(cs.id), false)),
        'indemnity_date_held_where_required', count(*) filter (where coalesce(private.indemnity_required(cs.id), false) and cs.indemnity_expires_at is not null),
        'licence_expired', count(*) filter (where cs.license_expires_at is not null and cs.license_expires_at < now()),
        'licence_expires_within_30_days', count(*) filter (where cs.license_expires_at is not null and cs.license_expires_at >= now() and cs.license_expires_at < now() + interval '30 days'),
        'verification_recorded', count(*) filter (where cs.license_verified_at is not null))
        from public.clinical_staff cs where cs.active and cs.status = 'active' and not cs.is_test),
    'canary_timings', jsonb_build_object(
      'reading_to_graded', private.chain_percentiles('reading_to_graded', v_days, true, 1),
      'graded_to_page', private.chain_percentiles('graded_to_page', v_days, true, 1),
      'page_to_ack', private.chain_percentiles('page_to_ack', v_days, true, 1)),
    'limits', jsonb_build_array(
      'Timings are medians and 95th percentiles of real events; fewer than the minimum sample are withheld, not shown.',
      'Task to claim measures a clinician taking the task. A page acknowledgement is a separate figure.',
      'Push open rate depends on the app reporting opens; a phone that never reports one counts as not opened.',
      'The phone make is read from the push subscription and may say other or unknown.'));
  perform private.log_audit('chain.reliability_report', 'chain_reliability', null, jsonb_build_object('days', v_days));
  return v_out;
end $$;
revoke all on function public.chain_reliability_report(integer) from public, anon;
grant execute on function public.chain_reliability_report(integer) to authenticated;

-- 3. D1 parity: engine against what the legacy pipeline actually did --------------------------------------------------------------
create function private.triage_parity_rows(p_days integer)
returns table (triage_event_id uuid, observation_id uuid, engine_status text, engine_grade text, legacy_class text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select te.id, te.trigger_id, case when te.shadow then 'draft' else 'approved' end, te.grade,
    case when exists (select 1 from public.emergency_events ee where ee.vital_reading_id = te.trigger_id and ee.source = 'bp_reading') then 'emergency'
         when exists (select 1 from public.clinician_alerts ca where ca.vital_reading_id = te.trigger_id and ca.level in ('urgent_escalation', 'emergency')) then 'priority1'
         when exists (select 1 from public.clinician_alerts ca where ca.vital_reading_id = te.trigger_id and ca.level = 'clinician_review') then 'review'
         else 'none' end,
    te.created_at
    from public.triage_events te
   where te.trigger_type = 'observation' and not te.is_test
     and te.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)));
$$;
revoke all on function private.triage_parity_rows(integer) from public, anon, authenticated;

create function public.triage_engine_parity(p_days integer default 30)
returns table (engine_status text, engine_grade text, legacy_class text, readings bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.engine_status, r.engine_grade, r.legacy_class, count(*)
      from private.triage_parity_rows(p_days) r group by 1, 2, 3 order by 1, 2, 3;
end $$;
comment on function public.triage_engine_parity(integer) is 'P1/D1: every graded non-test BP reading by engine grade against the legacy action actually taken (emergency, priority1, review, none). Aggregates only. Known limit: the legacy trigger merges repeats and de-duplicates emergencies for six hours.';

create function public.triage_engine_parity_cases(p_days integer default 30, p_limit integer default 100)
returns table (triage_event_id uuid, observation_id uuid, engine_status text, engine_grade text, legacy_class text, concern text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.triage_event_id, r.observation_id, r.engine_status, r.engine_grade, r.legacy_class,
           case when r.engine_grade = 'red' and r.legacy_class = 'none' then 'engine_red_legacy_quiet'
                else 'legacy_urgent_engine_not_red' end,
           r.created_at
      from private.triage_parity_rows(p_days) r
     where (r.engine_grade = 'red' and r.legacy_class = 'none')
        or (r.engine_grade <> 'red' and r.legacy_class in ('emergency', 'priority1'))
     order by (r.engine_grade = 'red') desc, r.created_at desc
     limit greatest(1, least(p_limit, 500));
end $$;
comment on function public.triage_engine_parity_cases(integer, integer) is 'P1/D1: ids only. The readings where exactly one side acted urgently. Asymptomatic severe BP is EXPECTED to appear as legacy_urgent_engine_not_red (CMO decision Q2: repeat, then amber review).';

revoke all on function public.triage_engine_parity(integer) from public, anon;
revoke all on function public.triage_engine_parity_cases(integer, integer) from public, anon;
grant execute on function public.triage_engine_parity(integer) to authenticated;
grant execute on function public.triage_engine_parity_cases(integer, integer) to authenticated;

-- 4. Chain health (one read for the page) -----------------------------------------------------------------------------------------
create function public.chain_health() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg jsonb := (select rules from public.chain_canary_config where is_active);
  v_h jsonb := v_cfg -> 'health';
  v_min integer := (v_h ->> 'minSample')::integer;
  v_last public.chain_canary_runs;
  v_last_pass timestamptz;
  v_reasons text[] := '{}';
  v_status text := 'ok';
  v_subs jsonb;
  v_stuck integer; v_dead integer;
  v_g jsonb; v_a jsonb;
  v_age integer;
  v_parity jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'chain_not_authorised' using errcode = '42501';
  end if;
  select * into v_last from public.chain_canary_runs where kind = 'result' order by at desc limit 1;
  select max(at) into v_last_pass from public.chain_canary_runs where kind = 'result' and passed;
  v_age := case when v_last.id is null then null else (extract(epoch from now() - v_last.at) / 60)::integer end;

  select coalesce(jsonb_agg(jsonb_build_object('subscriber', s.subscriber_key,
           'pending', coalesce(c.pending, 0), 'processing', coalesce(c.processing, 0), 'dead', coalesce(c.dead, 0),
           'oldest_pending_seconds', coalesce(c.oldest, 0)) order by s.subscriber_key), '[]'::jsonb)
    into v_subs
    from public.event_subscribers s
    left join (select d.subscriber_key,
                      count(*) filter (where d.status = 'pending') pending, count(*) filter (where d.status = 'processing') processing,
                      count(*) filter (where d.status = 'dead') dead,
                      coalesce(extract(epoch from now() - min(d.next_attempt_at) filter (where d.status = 'pending'))::bigint, 0) oldest
                 from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id and not e.is_test
                where d.status in ('pending', 'processing', 'dead') group by d.subscriber_key) c on c.subscriber_key = s.subscriber_key
   where s.subscriber_key in ('triage.grade_observation', 'queue.create_from_triage', 'paging.on_red');

  select count(*) filter (where d.status in ('pending', 'processing') and coalesce(d.next_attempt_at, d.created_at) < now() - make_interval(secs => (v_h ->> 'stuckDeliverySeconds')::int)),
         count(*) filter (where d.status = 'dead')
    into v_stuck, v_dead
    from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id and not e.is_test
   where d.subscriber_key in ('triage.grade_observation', 'queue.create_from_triage', 'paging.on_red');

  v_g := private.chain_percentiles('reading_to_graded', 7, false, v_min);
  v_a := private.chain_percentiles('page_to_ack', 7, false, v_min);

  if v_last.id is null then
    v_reasons := array_append(v_reasons, ('The canary has not reported yet.')::text); v_status := 'attention';
  elsif not v_last.passed then
    v_reasons := array_append(v_reasons, (format('The last canary run failed at stage "%s".', v_last.failed_stage))::text); v_status := 'down';
  end if;
  if v_age is not null and v_age > (v_h ->> 'canaryStaleMinutes')::int then
    v_reasons := array_append(v_reasons, (format('The canary has not reported for %s minutes.', v_age))::text); v_status := 'down';
  end if;
  if v_dead > (v_h ->> 'deadLettersMax')::int then
    v_reasons := array_append(v_reasons, (format('%s event deliveries on the chain are dead letters.', v_dead))::text); v_status := 'down';
  end if;
  if v_stuck > 0 then
    v_reasons := array_append(v_reasons, (format('%s event deliveries on the chain have waited longer than %s seconds.', v_stuck, v_h ->> 'stuckDeliverySeconds'))::text);
    if v_status = 'ok' then v_status := 'attention'; end if;
  end if;
  if (v_g ->> 'p95') is not null and (v_g ->> 'p95')::numeric > (v_h ->> 'readingToGradedP95Seconds')::numeric then
    v_reasons := array_append(v_reasons, (format('Reading to graded is slow (95th percentile %s seconds).', v_g ->> 'p95'))::text);
    if v_status = 'ok' then v_status := 'attention'; end if;
  end if;
  if (v_a ->> 'p95') is not null and (v_a ->> 'p95')::numeric > (v_h ->> 'pageToAckP95Seconds')::numeric then
    v_reasons := array_append(v_reasons, (format('Pages are slow to be acknowledged (95th percentile %s seconds).', v_a ->> 'p95'))::text);
    if v_status = 'ok' then v_status := 'attention'; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('engine_status', p.engine_status, 'engine_grade', p.engine_grade, 'legacy_class', p.legacy_class, 'readings', p.readings)), '[]'::jsonb)
    into v_parity from (select r.engine_status, r.engine_grade, r.legacy_class, count(*) readings from private.triage_parity_rows(30) r group by 1, 2, 3 order by 1, 2, 3) p;

  return jsonb_build_object(
    'generated_at', now(),
    'status', v_status,
    'reasons', to_jsonb(v_reasons),
    'thresholds', v_h,
    'canary', jsonb_build_object(
      'last_result_at', v_last.at, 'last_passed', v_last.passed, 'last_failed_stage', v_last.failed_stage,
      'last_pass_at', v_last_pass, 'minutes_since_last_result', v_age,
      'last_fixtures', coalesce(v_last.fixtures, '[]'::jsonb),
      'runs_24h', (select count(*) from public.chain_canary_runs where kind = 'result' and at > now() - interval '24 hours'),
      'failures_24h', (select count(*) from public.chain_canary_runs where kind = 'result' and not passed and at > now() - interval '24 hours'),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'passed', x.passed, 'stage', x.failed_stage) order by x.at desc)
                           from (select at, passed, failed_stage from public.chain_canary_runs where kind = 'result' order by at desc limit 12) x), '[]'::jsonb)),
    'bus', jsonb_build_object('subscribers', v_subs, 'stuck', v_stuck, 'dead', v_dead),
    'timings_7d', jsonb_build_object(
      'reading_to_graded', v_g,
      'graded_to_task', private.chain_percentiles('graded_to_task', 7, false, v_min),
      'graded_to_page', private.chain_percentiles('graded_to_page', 7, false, v_min),
      'page_to_ack', v_a),
    'canary_timings_7d', jsonb_build_object(
      'reading_to_graded', private.chain_percentiles('reading_to_graded', 7, true, 1),
      'graded_to_page', private.chain_percentiles('graded_to_page', 7, true, 1),
      'page_to_ack', private.chain_percentiles('page_to_ack', 7, true, 1)),
    'parity_30d', v_parity);
end $$;
revoke all on function public.chain_health() from public, anon;
grant execute on function public.chain_health() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.chain_health()', 'EXECUTE')
     or has_function_privilege('anon', 'public.chain_reliability_report(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_engine_parity(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.chain_timing_rows(integer, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.triage_parity_rows(integer)', 'EXECUTE')
     or has_table_privilege('authenticated', 'analytics.v_chain_timings', 'SELECT')
     or has_table_privilege('anon', 'analytics.v_chain_timings', 'SELECT') then
    raise exception 'P1 health grants are too wide';
  end if;
end $$;
