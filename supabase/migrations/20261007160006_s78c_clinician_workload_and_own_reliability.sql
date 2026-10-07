-- S78c: the clinician workload dashboard (spec 23.21) and a clinician's own reliability signal (spec 23.20).
--
-- Two read functions over existing tables (S16 clinical_tasks, task_claims, task_handbacks; S17 clinician_reliability_events). No table,
-- no column and no data change, so no row count is needed. The signatures are new names, so no existing untyped-literal caller can become ambiguous.
--
--   * public.clinician_workload_dashboard(p_days): one row per clinician who claimed work in the window, for the Chief Medical Officer of
--     the caller's organisation only (the clinical lead; administrators and ordinary clinicians are refused, 42501). Claims, completed,
--     hand-backs, median and 90th percentile minutes from claim to completion, and tasks claimed right now that are past due. Rows with
--     is_test are excluded (INV-13). Ordered by name, never by a measure, and nothing here ranks, scores or suspends anyone: it is advisory
--     (spec 23.21). It is internal staff data, not patient data, so no minimum group is applied, and it carries no patient reference.
--     Every read is audited (INV-10): audit_log action workload_dashboard.read.
--   * public.my_reliability_signal(): the caller's own reliability score and the counts behind it (on time, late, expired claims, hand-backs)
--     over the reliability window. Only the caller's own row, never another clinician's, never a position among colleagues.

create function public.clinician_workload_dashboard(p_days integer default 30) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  v_since timestamptz;
  v_rows jsonb;
begin
  if v_uid is null or v_org is null or not private.cmo_of(v_org) then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'bad arguments' using errcode = '22023'; end if;
  v_since := now() - make_interval(days => p_days);

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.name), '[]'::jsonb) into v_rows
    from (
      select cs.profile_id as clinician_id, cs.full_name as name,
             count(k.id) as claims,
             count(k.id) filter (where k.end_reason = 'completed') as completed,
             (select count(*) from public.task_handbacks h where h.clinician_id = cs.profile_id and not h.is_test and h.created_at > v_since) as handbacks,
             round((percentile_cont(0.5) within group (order by extract(epoch from (k.ended_at - k.claimed_at)) / 60.0)
                      filter (where k.end_reason = 'completed'))::numeric, 1) as median_minutes,
             round((percentile_cont(0.9) within group (order by extract(epoch from (k.ended_at - k.claimed_at)) / 60.0)
                      filter (where k.end_reason = 'completed'))::numeric, 1) as p90_minutes,
             (select count(*) from public.clinical_tasks t where t.claimed_by = cs.profile_id and t.state = 'claimed' and not t.is_test and t.due_at < now()) as overdue
        from public.clinical_staff cs
        join public.task_claims k on k.clinician_id = cs.profile_id and k.organisation_id = v_org and not k.is_test and k.claimed_at > v_since
       where cs.organisation_id = v_org and not cs.is_test and cs.profile_id is not null
       group by cs.profile_id, cs.full_name
    ) x;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, v_uid, 'workload_dashboard.read', 'organisation', v_org, jsonb_build_object('days', p_days, 'clinicians', jsonb_array_length(v_rows)));
  return jsonb_build_object('days', p_days, 'generated_at', now(), 'clinicians', v_rows);
end;
$$;
revoke all on function public.clinician_workload_dashboard(integer) from public, anon, authenticated;
grant execute on function public.clinician_workload_dashboard(integer) to authenticated;

create function public.my_reliability_signal() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_window integer := (private.claim_setting('reliability') ->> 'window_days')::integer;
  v_score numeric;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select cs.reliability_score into v_score from public.clinical_staff cs where cs.profile_id = v_uid and not cs.is_test limit 1;
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'score', v_score,
    'window_days', v_window,
    'completed_on_time', (select count(*) from public.clinician_reliability_events e where e.clinician_id = v_uid and not e.is_test and e.kind = 'completed_on_time' and e.occurred_at > now() - make_interval(days => v_window)),
    'completed_late', (select count(*) from public.clinician_reliability_events e where e.clinician_id = v_uid and not e.is_test and e.kind = 'completed_late' and e.occurred_at > now() - make_interval(days => v_window)),
    'claims_expired', (select count(*) from public.clinician_reliability_events e where e.clinician_id = v_uid and not e.is_test and e.kind = 'claim_expired' and e.occurred_at > now() - make_interval(days => v_window)),
    'handed_back', (select count(*) from public.clinician_reliability_events e where e.clinician_id = v_uid and not e.is_test and e.kind in ('handed_back_other', 'handed_back_reasoned') and e.occurred_at > now() - make_interval(days => v_window)));
end;
$$;
revoke all on function public.my_reliability_signal() from public, anon, authenticated;
grant execute on function public.my_reliability_signal() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.clinician_workload_dashboard(integer)', 'EXECUTE') or has_function_privilege('anon', 'public.my_reliability_signal()', 'EXECUTE') then
    raise exception 'S78c: anon can execute a workload function';
  end if;
  if not has_function_privilege('authenticated', 'public.clinician_workload_dashboard(integer)', 'EXECUTE') then raise exception 'S78c: grant missing'; end if;
end $$;
