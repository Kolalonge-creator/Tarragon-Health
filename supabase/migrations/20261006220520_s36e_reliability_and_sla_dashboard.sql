-- S36e: the reliability and SLA dashboard (spec 9.5 for the clinical lead, 9.4 for the operations view of queue health).
--
-- One read function, public.reliability_dashboard(p_gap_days integer, p_min_group integer), over the S16/S17/S18/S19 tables. No table,
-- no column, no data change, so no row count is needed here. The existing queue_health() is administrator-only and not organisation
-- scoped, and rota_coverage_gaps()/on_call_cover_status() admit only the credential reviewer, so none of them can serve both the Chief
-- Medical Officer and an operations holder; this function reads the same tables (and calls private.rota_gaps, the same gap rule the rota
-- builder uses) and answers either door, aggregate for one and named for the other.
--
-- Who may call it:
--   * the Chief Medical Officer of the caller's organisation: everything, including the list of clinicians with their own score;
--   * an administrator or a holder of ops.console.view: the same aggregates, no clinician names, no scores tied to anyone, and the
--     distribution of scores only when at least p_min_group clinicians are in it (a group of one or two is someone's own score).
--   * anyone else, and anon: refused (42501).
-- Reliability is advisory (S17): it is a tie-break in the queue only. The list is ordered by name, never by score, and nothing here
-- ranks, suspends or changes pay. Rows with is_test are excluded everywhere (INV-13). Every figure is for the caller's organisation.
-- Thresholds are not in this function: the report window is the reliability window already in queue_claim_config, the page window is
-- the first escalation time in paging_config, and the gap horizon and minimum group are passed in by the app from the PROPOSED registry.
--
-- The signature is new (no overload of an existing name), so no existing untyped-literal caller can become ambiguous.

create function public.reliability_dashboard(p_gap_days integer, p_min_group integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.caller_org();
  v_lead boolean := private.cmo_of(private.caller_org());
  v_window integer := (private.claim_setting('reliability') ->> 'window_days')::integer;
  v_page_min integer := (private.paging_rule('escalation_minutes') ->> 0)::integer;
  v_since timestamptz;
  v_scores jsonb;
  v_n integer;
  r public.on_call_rota%rowtype;
  v_out jsonb;
begin
  if v_uid is null or v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if not (v_lead or private.is_admin() or private.has_permission('ops.console.view')) then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_gap_days is null or p_gap_days < 1 or p_gap_days > 60 or p_min_group is null or p_min_group < 1 or p_min_group > 100 then
    raise exception 'bad arguments' using errcode = '22023';
  end if;
  if v_window is null or v_page_min is null then raise exception 'configuration missing' using errcode = 'P0002'; end if;
  v_since := now() - make_interval(days => v_window);

  select * into r from public.on_call_rota o
   where o.organisation_id = v_org and o.cancelled_at is null and o.starts_at <= now() and o.ends_at > now() and not o.is_test limit 1;

  select count(*), coalesce(jsonb_agg(cs.reliability_score order by cs.reliability_score), '[]'::jsonb) into v_n, v_scores
    from public.clinical_staff cs
   where cs.organisation_id = v_org and cs.active and cs.status = 'active' and not cs.is_test and cs.profile_id is not null
     and cs.doctor_tier <> 'care_coordinator' and cs.reliability_score is not null;

  v_out := jsonb_build_object(
    'viewer', case when v_lead then 'lead' else 'ops' end,
    'generated_at', now(),
    'window_days', v_window,
    'tasks', jsonb_build_object(
      'waiting', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'priority_class', x.priority_class, 'waiting', x.waiting, 'oldest_wait_minutes', x.oldest, 'past_due', x.past_due,
                 'oldest_past_due_minutes', x.oldest_over) order by x.priority_class)
          from (select t.priority_class,
                       count(*) as waiting,
                       (extract(epoch from (now() - min(t.created_at)))::integer / 60) as oldest,
                       count(*) filter (where t.due_at < now()) as past_due,
                       coalesce((extract(epoch from (now() - min(t.due_at) filter (where t.due_at < now())))::integer / 60), 0) as oldest_over
                  from public.clinical_tasks t
                 where t.organisation_id = v_org and not t.is_test and t.state in ('offered_to_lead', 'open', 'escalated')
                 group by t.priority_class) x), '[]'::jsonb),
      'claimed', (select count(*) from public.clinical_tasks t where t.organisation_id = v_org and not t.is_test and t.state = 'claimed'),
      'claimed_past_due', (select count(*) from public.clinical_tasks t where t.organisation_id = v_org and not t.is_test and t.state = 'claimed' and t.due_at < now())),
    'pages', jsonb_build_object(
      'window_minutes', v_page_min,
      'total', (select count(*) from public.pages p where p.organisation_id = v_org and not p.is_test and p.parent_page_id is null and p.sent_at > v_since),
      'acknowledged', (select count(*) from public.pages p where p.organisation_id = v_org and not p.is_test and p.parent_page_id is null and p.sent_at > v_since and p.acknowledged_at is not null),
      'acknowledged_in_window', (select count(*) from public.pages p where p.organisation_id = v_org and not p.is_test and p.parent_page_id is null and p.sent_at > v_since
                                    and p.acknowledged_at is not null and p.acknowledged_at - p.sent_at <= make_interval(mins => v_page_min)),
      'no_cover', (select count(*) from public.pages p where p.organisation_id = v_org and not p.is_test and p.parent_page_id is null and p.sent_at > v_since and p.no_cover),
      'median_ack_seconds', (select (percentile_cont(0.5) within group (order by extract(epoch from p.acknowledged_at - p.sent_at)))::integer
                               from public.pages p where p.organisation_id = v_org and not p.is_test and p.parent_page_id is null and p.sent_at > v_since and p.acknowledged_at is not null),
      'p90_ack_seconds', (select (percentile_cont(0.9) within group (order by extract(epoch from p.acknowledged_at - p.sent_at)))::integer
                            from public.pages p where p.organisation_id = v_org and not p.is_test and p.parent_page_id is null and p.sent_at > v_since and p.acknowledged_at is not null),
      -- No patient reference and no clinician in a row: how long a page has waited and how far up the ladder it has gone.
      'unacknowledged', coalesce((
        select jsonb_agg(jsonb_build_object('sent_at', p.sent_at, 'seconds_waiting', extract(epoch from now() - p.sent_at)::integer,
                  'level', (select max(c.escalation_level) from public.pages c where coalesce(c.parent_page_id, c.id) = p.id), 'no_cover', p.no_cover)
                 order by p.sent_at)
          from public.pages p
         where p.organisation_id = v_org and not p.is_test and p.parent_page_id is null and p.acknowledged_at is null and p.closed_at is null), '[]'::jsonb)),
    'cover', jsonb_build_object(
      'covered_now', r.id is not null and r.backup_clinician_id is not null,
      'primary_on_call', r.id is not null,
      'backup_on_call', r.backup_clinician_id is not null,
      'gap_days', p_gap_days,
      'gaps', coalesce((select jsonb_agg(jsonb_build_object('from', g.gap_start, 'to', g.gap_end, 'kind', g.kind) order by g.gap_start)
                          from private.rota_gaps(v_org, now(), now() + make_interval(days => p_gap_days)) g), '[]'::jsonb)),
    'handbacks', coalesce((
      select jsonb_object_agg(e.kind, e.n) from (
        select ev.kind, count(*) as n from public.clinician_reliability_events ev
         where ev.organisation_id = v_org and not ev.is_test and ev.occurred_at > v_since and ev.kind <> 'audit_result'
         group by ev.kind) e), '{}'::jsonb),
    'distribution', jsonb_build_object(
      'clinicians', v_n,
      'min_group', p_min_group,
      'suppressed', not v_lead and v_n < p_min_group,
      'scores', case when v_lead or v_n >= p_min_group then v_scores else null end));

  if v_lead then
    v_out := v_out || jsonb_build_object(
      'on_call', jsonb_build_object('primary', (select cs.full_name from public.clinical_staff cs where cs.profile_id = r.primary_clinician_id),
                                    'backup', (select cs.full_name from public.clinical_staff cs where cs.profile_id = r.backup_clinician_id)),
      -- ordered by name on purpose: this list is never a league table
      'individuals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name', cs.full_name, 'tier', cs.doctor_tier, 'score', cs.reliability_score,
                 'events', (select count(*) from public.clinician_reliability_events ev where ev.clinician_id = cs.profile_id and not ev.is_test and ev.occurred_at > v_since and ev.kind <> 'audit_result'),
                 'handbacks', (select count(*) from public.clinician_reliability_events ev where ev.clinician_id = cs.profile_id and not ev.is_test and ev.occurred_at > v_since and ev.kind in ('handed_back_other', 'handed_back_reasoned')))
               order by cs.full_name, cs.id)
          from public.clinical_staff cs
         where cs.organisation_id = v_org and cs.active and cs.status = 'active' and not cs.is_test and cs.profile_id is not null and cs.doctor_tier <> 'care_coordinator'), '[]'::jsonb));
  end if;
  return v_out;
end;
$$;

revoke all on function public.reliability_dashboard(integer, integer) from public, anon;
grant execute on function public.reliability_dashboard(integer, integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.reliability_dashboard(integer, integer)', 'EXECUTE') then raise exception 'anon can execute reliability_dashboard'; end if;
  if not has_function_privilege('authenticated', 'public.reliability_dashboard(integer, integer)', 'EXECUTE') then raise exception 'authenticated cannot execute reliability_dashboard'; end if;
end $$;
