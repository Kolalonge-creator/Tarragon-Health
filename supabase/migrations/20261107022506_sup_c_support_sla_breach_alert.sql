-- Customer Support Dashboard, phase C (continued): tell someone when support items run past their target (SUP-3).
--
-- One rule on the SR5 alert engine: support items past their SUP-3 target, not clinical (those run on the clinical
-- escalation SLA and already page through their own route), not paused waiting on the customer, test accounts left out.
-- One alert per desk (dedup key 'desk'), raised when at least min_breached items are late. sev3: tell the on-call
-- contact once, no incident, because a late reply is a service problem, not a safety one. Thresholds are PROPOSED and
-- mirrored in packages/shared/src/proposed-config/registry.ts (ops.alert_rules v4); a test fails if the two drift.
--
-- The check reads the base tables directly (the work-items view is security invoker and the alert engine has no user).

create or replace function private.ops_check_support_sla_breach(p jsonb, p_test boolean)
returns table(dedup_key text, detail jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  with items as (
    select 'support_ticket' as source, t.created_at as received_at, t.first_response_at as first_at,
           case t.priority::text when 'critical' then 'urgent' else t.priority::text end as priority,
           t.patient_id
      from public.support_tickets t
     where t.status not in ('resolved', 'closed', 'awaiting_patient') and not coalesce(t.is_clinical, false)
    union all
    select 'help_request', n.created_at, n.acknowledged_at,
           case when n.is_urgent or n.is_complaint then 'high' else 'normal' end, n.patient_id
      from public.navigation_requests n
     where n.status not in ('resolved', 'waiting_on_patient') and n.classification::text <> 'clinical'
    union all
    -- per wait: the clock starts when the patient last wrote and stops at the next care-team reply; no resolution target
    select 'care_thread', c.awaiting_reply_since, null::timestamptz, 'normal', c.patient_id
      from public.care_message_threads c
     where c.queue = 'support' and c.status = 'open' and c.awaiting_reply_since is not null and not coalesce(c.needs_doctor, false)
  ),
  late as (
    select i.source
      from items i
      left join public.profiles p on p.id = i.patient_id
     where (p_test or not coalesce(p.is_test, false))
       and now() > case when i.first_at is null
                        then private.support_due(i.priority, i.received_at, 'first_response')
                        else private.support_due(i.priority, i.received_at, 'resolution') end
  )
  select 'desk',
         jsonb_build_object('late_items', count(*),
                            'by_source', (select jsonb_object_agg(source, n) from (select source, count(*) as n from late group by source) s))
    from late
  having count(*) >= coalesce((p ->> 'min_breached')::integer, 1);
$$;

comment on function private.ops_check_support_sla_breach(jsonb, boolean) is
  'Ops alert check: non-clinical support items past their SUP-3 target (not paused waiting on the customer).';

revoke all on function private.ops_check_support_sla_breach(jsonb, boolean) from public, anon, authenticated;

-- ops-alert-rules-begin
insert into public.ops_alert_rules (code, title, severity, source, enabled, params, min_interval_seconds, renotify_minutes, open_incident, off_reason) values
  ('support_sla_breach', 'Support items are past their reply or resolution target', 'sev3', 'database', true, '{"min_breached": 1}'::jsonb, 900, 240, false, null)
on conflict (code) do nothing;
-- ops-alert-rules-end

do $$
begin
  if not exists (select 1 from public.ops_alert_rules where code = 'support_sla_breach' and enabled and severity = 'sev3') then
    raise exception 'support_sla_breach rule missing or not as seeded';
  end if;
  if has_function_privilege('authenticated', 'private.ops_check_support_sla_breach(jsonb,boolean)', 'EXECUTE') then
    raise exception 'ops_check_support_sla_breach must not be executable by authenticated';
  end if;
  perform * from private.ops_check_support_sla_breach('{"min_breached": 1}'::jsonb, true);
end $$;
