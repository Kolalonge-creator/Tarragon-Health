-- Fix: the rota_gap_12h alert re-raised on every evaluation.
-- The check's dedup_key embedded the gap start time. For a gap that begins at now() the start moves on every run, so
-- ops_evaluate_alerts never matched the open alert and raised a new sev1 alert, a new incident and new on-call
-- notifications each time (live 2026-10-14/15: 224 open duplicate incidents since 2026-10-13 21:44 UTC).
-- Now: one row per organisation, stable key '<org_id>:rota_gap', the gaps aggregated in the detail.
-- The org with no real rota really does have a gap; only the duplication was the bug, so one alert/incident is
-- legitimately raised on the next evaluation. Signature and ACL are kept (create or replace); the closing block asserts it.

create or replace function private.ops_check_rota_gap_12h(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select o.id::text || ':rota_gap',
         jsonb_build_object('gap_start', min(g.gap_start), 'gap_end', max(g.gap_end),
                            'hours', round(sum(extract(epoch from g.gap_end - g.gap_start)) / 3600.0, 1),
                            'gap_count', count(*))
    from public.organisations o
    cross join lateral private.rota_gaps(o.id, now(), now() + make_interval(hours => coalesce((p ->> 'hours')::integer, 12))) g
   where exists (select 1 from public.clinical_staff cs where cs.organisation_id = o.id and cs.active and cs.status = 'active' and (p_test or not cs.is_test))
   group by o.id;
$$;

-- Quiet clean-up of the duplicates. Deliberately no ops_alert_notify: nobody is sent a 'clear' notice per duplicate.
-- The old check keeps inserting a duplicate every 5 minutes until this commits, so the counts come from the UPDATEs themselves
-- (no before/after equality), and a short lock keeps the cron from inserting mid-clean-up. The evaluator takes only row locks, in
-- the same table order (alerts, then incidents), so it can wait for us or we for it but not deadlock.
do $$
declare
  v_alerts_before integer; v_inc_before integer; v_alerts_done integer; v_inc_done integer;
begin
  lock table public.ops_alerts, public.ops_incidents in share row exclusive mode;
  select count(*) into v_alerts_before from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open';
  select count(*) into v_inc_before from public.ops_incidents
   where title = 'Nobody is on call for part of the next 12 hours' and external_reference like 'ops_alert:rota_gap_12h:%'
     and status not in ('resolved', 'closed');
  raise notice 'rota gap clean-up: % open alerts and % open duplicate incidents before', v_alerts_before, v_inc_before;

  with u as (
    update public.ops_alerts set state = 'resolved', resolved_at = now()
     where rule_code = 'rota_gap_12h' and state = 'open' returning 1)
  select count(*) into v_alerts_done from u;

  with u as (
    update public.ops_incidents
       set status = 'resolved', resolved_at = now(),
           acknowledged_at = coalesce(acknowledged_at, now()), mitigated_at = coalesce(mitigated_at, now()),
           root_cause = 'Alert de-duplication key moved on every evaluation (fixed by this migration)',
           corrective_action = 'The rota gap check now returns one row per organisation with a stable key, so one alert and one incident cover the whole gap.',
           preventive_action = 'A database proof asserts the key is stable and contains no timestamp, and that two evaluations leave exactly one open alert and one incident.'
     where title = 'Nobody is on call for part of the next 12 hours' and external_reference like 'ops_alert:rota_gap_12h:%'
       and status not in ('resolved', 'closed') returning 1)
  select count(*) into v_inc_done from u;
  raise notice 'rota gap clean-up: resolved % alerts and % incidents', v_alerts_done, v_inc_done;

  assert not exists (select 1 from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open'), 'open rota gap alerts remain';
  assert not exists (select 1 from public.ops_incidents where external_reference like 'ops_alert:rota_gap_12h:%' and status not in ('resolved', 'closed')), 'open rota gap incidents remain';
  assert not exists (select 1 from public.ops_incidents where title = 'Nobody is on call for part of the next 12 hours' and status = 'resolved'
                       and (acknowledged_at is null or mitigated_at is null or resolved_at is null)), 'resolved incident missing a timestamp';
  assert not has_function_privilege('anon', 'private.ops_check_rota_gap_12h(jsonb,boolean)', 'EXECUTE'), 'anon can execute';
  assert not has_function_privilege('authenticated', 'private.ops_check_rota_gap_12h(jsonb,boolean)', 'EXECUTE'), 'authenticated can execute';
end $$;
