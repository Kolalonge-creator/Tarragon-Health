-- Customer Support Dashboard, phase A: one workspace over the support stores that already exist (SUP-1,
-- docs/design/SUPPORT-DASHBOARD.md).
--
-- public.support_work_items is a security-invoker view: one row per support item, with a common shape, from
--   support_tickets                       technical problems (2026-09-03: technical-only)
--   navigation_requests                   the patient "I need help" card
--   care_message_threads (queue support)  the MSG-3 support message queue
--   complaints                            the seven-stage complaint workflow
-- Each source's own RLS still applies to the reader, so the view shows nobody anything they could not already read.
-- Front Desk conversations and provider_complaints are deliberately absent (admin-only by decision, SUP-1).
--
-- What the view carries, and does not: a short subject, the customer's name, category, priority, owner, status, times
-- and the SLA clock. It carries no clinical field (no diagnosis, result, medicine, note). A clinical-care complaint's
-- text is replaced by a fixed label: it belongs to clinical governance, not the support queue. Help-request text and
-- thread subjects are shown as the existing worklists already show them, cut to 140 characters.
--
-- Priority mapping into the desk's four levels (SUP-3): ticket critical -> urgent; help request urgent or marked as a
-- complaint -> high, otherwise normal; support messages normal; complaints high.
--
-- The clock: tickets, help requests and complaints time a first reply from receipt, then resolution. A support
-- conversation is timed per wait: from awaiting_reply_since to the next care-team reply, with no resolution target, so
-- an old thread is never late the moment its patient writes again (review finding, 2026-11-07).
--
-- sla_state: 'clinical' (clinical items run on the clinical escalation SLA, not support targets), 'paused' (waiting on
-- the customer), 'met' (resolved or closed), 'breached', 'at_risk' (the last quarter of the time to the next due
-- point), 'on_track', or 'none' (no target applies).

create or replace view public.support_work_items
with (security_invoker = true)
as
with base as (
  -- Technical support tickets
  select
    'support_ticket'::text                                         as source,
    t.id                                                           as item_id,
    'TK-' || upper(left(t.id::text, 8))                            as reference,
    t.organisation_id,
    t.patient_id,
    'technical'::text                                              as category,
    case t.priority::text when 'critical' then 'urgent' else t.priority::text end as priority,
    case
      when t.status = 'closed' then 'closed'
      when t.status = 'resolved' then 'resolved'
      when t.status = 'awaiting_patient' then 'awaiting_customer'
      when t.status = 'new' then 'new'
      else 'in_progress'
    end                                                            as status_group,
    t.status::text                                                 as raw_status,
    left(t.subject, 140)                                           as subject,
    t.assigned_to,
    t.created_at                                                   as received_at,
    t.first_response_at,
    coalesce(t.resolved_at, t.closed_at)                           as resolved_at,
    t.updated_at                                                   as last_activity_at,
    coalesce(t.is_clinical, false)                                 as is_clinical,
    (t.escalated_alert_id is not null or coalesce(t.technical_tier, 1) > 1) as is_escalated,
    t.satisfaction_score::integer                                  as satisfaction,
    t.channel::text                                                as channel,
    '/clinician/support-tickets/' || t.id::text                    as detail_href,
    t.created_at                                                   as clock_from,
    t.first_response_at                                            as clock_answered_at,
    true                                                           as has_resolution_target
  from public.support_tickets t

  union all

  -- "I need help" requests
  select
    'help_request',
    n.id,
    'HR-' || upper(left(n.id::text, 8)),
    n.organisation_id,
    n.patient_id,
    case n.category::text when 'payment' then 'payments' when 'appointment' then 'appointments' else n.category::text end,
    case when n.is_urgent or n.is_complaint then 'high' else 'normal' end,
    case
      when n.status = 'resolved' then 'resolved'
      when n.status = 'waiting_on_patient' then 'awaiting_customer'
      when n.status = 'waiting_on_provider' then 'awaiting_internal'
      when n.acknowledged_at is null then 'new'
      else 'in_progress'
    end,
    n.status::text,
    left(n.description, 140),
    n.assigned_to,
    n.created_at,
    n.acknowledged_at,
    n.resolved_at,
    n.updated_at,
    n.classification::text = 'clinical',
    n.care_message_thread_id is not null,
    n.satisfaction_rating::integer,
    'in_app',
    '/dashboard/care-coordinator/support-requests',
    n.created_at,
    n.acknowledged_at,
    true
  from public.navigation_requests n

  union all

  -- Support message queue (MSG-3)
  select
    'care_thread',
    c.id,
    'MS-' || upper(left(c.id::text, 8)),
    c.organisation_id,
    c.patient_id,
    case c.category::text when 'billing' then 'payments' when 'appointment' then 'appointments' else c.category::text end,
    'normal',
    case
      when c.status = 'closed' then 'closed'
      when c.awaiting_reply_since is null then 'awaiting_customer'
      when c.last_care_team_reply_at is null then 'new'
      else 'in_progress'
    end,
    c.status::text,
    left(coalesce(c.subject, 'Message to the support team'), 140),
    o.owner_id,
    c.created_at,
    fr.first_reply_at,
    case when c.status = 'closed' then c.updated_at end,
    coalesce(c.last_message_at, c.updated_at),
    coalesce(c.needs_doctor, false),
    coalesce(c.needs_doctor, false),
    null::integer,
    'in_app',
    '/clinician/messages',
    -- A support conversation never "resolves": each time the patient writes, a new reply is due, timed from that wait.
    coalesce(c.awaiting_reply_since, c.created_at),
    case when c.awaiting_reply_since is null then coalesce(c.last_care_team_reply_at, fr.first_reply_at) end,
    false
  from public.care_message_threads c
  left join public.care_thread_owners o on o.thread_id = c.id
  left join lateral (
    select min(m.created_at) as first_reply_at
      from public.care_messages m
     where m.thread_id = c.id and m.author_role = 'care_team'
  ) fr on true
  where c.queue = 'support'

  union all

  -- Complaints
  select
    'complaint',
    k.id,
    'CP-' || upper(left(k.id::text, 8)),
    k.organisation_id,
    k.patient_id,
    'complaint',
    'high',
    case
      when k.status = 'governance_review' then 'closed'
      when k.status = 'resolved' then 'resolved'
      when k.status = 'received' then 'new'
      else 'in_progress'
    end,
    k.status::text,
    case when k.category = 'clinical_care' then 'Complaint about clinical care (clinical governance)'
         else left(k.description, 140) end,
    k.assigned_to,
    k.created_at,
    k.acknowledged_at,
    k.resolved_at,
    k.updated_at,
    k.category = 'clinical_care',
    k.incident_report_id is not null,
    null::integer,
    'in_app',
    '/clinician/complaints/' || k.id::text,
    k.created_at,
    k.acknowledged_at,
    true
  from public.complaints k
),
with_handoffs as (
  select b.*,
         h.open_handoffs,
         h.destinations
    from base b
    left join lateral (
      select count(*)::integer as open_handoffs,
             array_agg(distinct sh.destination order by sh.destination) as destinations
        from public.support_handoffs sh
       where sh.source = b.source and sh.source_id = b.item_id and sh.status in ('open', 'acknowledged')
    ) h on true
),
with_due as (
  select w.*,
         private.support_due(w.priority, w.clock_from, 'first_response') as first_response_due_at,
         case when w.has_resolution_target then private.support_due(w.priority, w.received_at, 'resolution') end as resolution_due_at
    from with_handoffs w
)
select
  d.source,
  d.item_id,
  d.reference,
  d.organisation_id,
  d.patient_id,
  p.full_name                                                   as customer_name,
  coalesce(p.is_test, false)                                    as is_test,
  d.category,
  d.priority,
  case when d.status_group in ('resolved', 'closed') then d.status_group
       when coalesce(d.open_handoffs, 0) > 0 and d.status_group <> 'awaiting_customer' then 'awaiting_internal'
       when d.is_escalated and d.status_group not in ('awaiting_customer') then 'escalated'
       else d.status_group end                                   as status_group,
  d.raw_status,
  d.subject,
  d.assigned_to,
  a.full_name                                                   as assigned_to_name,
  d.received_at,
  d.first_response_at,
  d.resolved_at,
  d.last_activity_at,
  d.is_clinical,
  d.is_escalated,
  coalesce(d.open_handoffs, 0)                                  as open_handoffs,
  coalesce(d.destinations, '{}'::text[])                        as handoff_destinations,
  d.satisfaction,
  d.channel,
  d.detail_href,
  d.first_response_due_at,
  d.resolution_due_at,
  d.clock_from,
  d.clock_answered_at,
  s.next_due_at,
  case
    when d.status_group in ('resolved', 'closed') then 'met'
    when d.is_clinical then 'clinical'
    when d.status_group = 'awaiting_customer' then 'paused'
    when s.next_due_at is null then 'none'
    when now() > s.next_due_at then 'breached'
    when now() > s.next_due_at - (s.next_due_at - case when d.clock_answered_at is null then d.clock_from else d.received_at end) * 0.25 then 'at_risk'
    else 'on_track'
  end                                                           as sla_state
from with_due d
left join public.profiles p on p.id = d.patient_id
left join public.profiles a on a.id = d.assigned_to
cross join lateral (
  select case when d.clock_answered_at is null then d.first_response_due_at else d.resolution_due_at end as next_due_at
) s;

comment on view public.support_work_items is
  'Support desk workspace (SUP-1): one row per support item across support_tickets, navigation_requests, the MSG-3 support queue and complaints. security_invoker: each source''s RLS applies. No clinical fields.';

revoke all on public.support_work_items from anon;
grant select on public.support_work_items to authenticated;

-- Assign or reassign a support item. Assigning to yourself needs support.agent (or coordinator); assigning anyone else
-- needs support.manage. The assignee must be able to work the desk. Complaints are assigned inside their own governance
-- workflow (advance_complaint_status) and a support message flagged for a doctor stays with the doctor route (MSG-2), so
-- both are refused here.
create or replace function private.profile_can_work_support(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_profile and p.is_active
       and (
         p.role in ('admin', 'care_coordinator')
         or (p.role = 'clinician' and (
               exists (select 1 from public.user_permission_grants g
                        where g.profile_id = p.id and g.revoked_at is null and g.permission_key in ('support.agent', 'support.manage'))
            or exists (select 1 from public.role_permissions rp
                        where rp.custom_role_id = p.custom_role_id and rp.permission_key in ('support.agent', 'support.manage'))))
       )
  );
$$;

revoke all on function private.profile_can_work_support(uuid) from public, anon;
grant execute on function private.profile_can_work_support(uuid) to authenticated;

create or replace function public.assign_support_work_item(p_source text, p_item_id uuid, p_assignee uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_needs_doctor boolean;
begin
  if not private.is_support_staff() then
    raise exception 'Only support staff can assign support work' using errcode = '42501';
  end if;
  if p_assignee is distinct from v_me and not private.is_support_lead() then
    raise exception 'Only a support lead can assign work to someone else' using errcode = '42501';
  end if;
  if p_assignee is not null and not private.profile_can_work_support(p_assignee) then
    raise exception 'That person does not work the support desk' using errcode = '22023';
  end if;

  if p_source = 'support_ticket' then
    perform public.assign_support_ticket(p_item_id, p_assignee);

  elsif p_source = 'help_request' then
    select organisation_id into v_org from public.navigation_requests where id = p_item_id for update;
    if v_org is null then
      raise exception 'That help request was not found' using errcode = 'P0002';
    end if;
    if not private.is_org_staff(v_org) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    update public.navigation_requests set assigned_to = p_assignee, updated_at = now() where id = p_item_id;

  elsif p_source = 'care_thread' then
    select organisation_id, coalesce(needs_doctor, false) into v_org, v_needs_doctor
      from public.care_message_threads where id = p_item_id and queue = 'support' for update;
    if v_org is null then
      raise exception 'That support conversation was not found' using errcode = 'P0002';
    end if;
    if not private.is_org_staff(v_org) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    if v_needs_doctor then
      raise exception 'This conversation is waiting for a doctor and stays on the doctor route' using errcode = '22023';
    end if;
    if p_assignee is null then
      delete from public.care_thread_owners where thread_id = p_item_id;
    else
      insert into public.care_thread_owners (thread_id, organisation_id, owner_id, assigned_by, assigned_at)
      values (p_item_id, v_org, p_assignee, v_me, now())
      on conflict (thread_id) do update
        set owner_id = excluded.owner_id, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
    end if;

  elsif p_source = 'complaint' then
    raise exception 'Complaints are assigned inside the complaint workflow' using errcode = '22023';
  else
    raise exception 'Unknown support source %', p_source using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.assign_support_work_item(text, uuid, uuid) from public, anon;
grant execute on function public.assign_support_work_item(text, uuid, uuid) to authenticated;

-- Who can be given support work, for the assignment picker: active people who can work the desk, in the caller's
-- organisation (the super admin is listed too). Names only.
create or replace function public.list_support_desk_staff()
returns table (profile_id uuid, full_name text, is_lead boolean)
language sql
stable
security definer
set search_path to ''
as $$
  select p.id, p.full_name,
         (p.role = 'admin'
          or exists (select 1 from public.user_permission_grants g where g.profile_id = p.id and g.revoked_at is null and g.permission_key = 'support.manage')
          or exists (select 1 from public.role_permissions rp where rp.custom_role_id = p.custom_role_id and rp.permission_key = 'support.manage'))
    from public.profiles p
   where private.is_support_staff()
     and private.profile_can_work_support(p.id)
     and (p.role = 'admin' or p.organisation_id = private.current_org_id())
   order by p.full_name;
$$;

revoke all on function public.list_support_desk_staff() from public, anon;
grant execute on function public.list_support_desk_staff() to authenticated;

-- Headline figures for the overview, read through the view (so the reader's RLS applies). Test accounts are left out.
-- Satisfaction is returned only when at least p_min_csat_sample ratings exist in the period; otherwise null, which the
-- page shows as "not yet available" rather than a misleading score from two answers.
create or replace function public.support_desk_summary(p_days integer default 7, p_min_csat_sample integer default 5)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from timestamptz := now() - make_interval(days => p_days);
  v_prev timestamptz := now() - make_interval(days => p_days * 2);
  v_result jsonb;
begin
  if not private.is_support_staff() then
    raise exception 'Only support staff can read the support desk' using errcode = '42501';
  end if;

  with w as (select * from public.support_work_items where not is_test),
  period as (
    select
      count(*) filter (where received_at >= v_from)                                              as received,
      count(*) filter (where resolved_at >= v_from)                                              as resolved,
      percentile_cont(0.5) within group (order by extract(epoch from first_response_at - received_at) / 60)
        filter (where received_at >= v_from and first_response_at is not null)                   as median_first_response_min,
      percentile_cont(0.5) within group (order by extract(epoch from resolved_at - received_at) / 60)
        filter (where received_at >= v_from and resolved_at is not null)                         as median_resolution_min,
      -- First-reply compliance counts one-off first replies only (tickets, help requests, complaints). Support messages
      -- are timed per wait and follow the message reply target on care operations instead.
      count(*) filter (where received_at >= v_from and not is_clinical and source <> 'care_thread' and first_response_due_at is not null
                        and (first_response_at is not null or now() > first_response_due_at))   as sla_measured,
      count(*) filter (where received_at >= v_from and not is_clinical and source <> 'care_thread' and first_response_due_at is not null
                        and first_response_at is not null and first_response_at <= first_response_due_at) as sla_met,
      count(satisfaction) filter (where resolved_at >= v_from)                                   as csat_count,
      avg(satisfaction) filter (where resolved_at >= v_from)                                     as csat_avg
    from w
  ),
  prev as (
    select
      count(*) filter (where received_at >= v_prev and received_at < v_from)                     as received,
      count(*) filter (where resolved_at >= v_prev and resolved_at < v_from)                     as resolved,
      percentile_cont(0.5) within group (order by extract(epoch from first_response_at - received_at) / 60)
        filter (where received_at >= v_prev and received_at < v_from and first_response_at is not null) as median_first_response_min
    from w
  ),
  now_counts as (
    select
      count(*) filter (where status_group not in ('resolved', 'closed'))                         as open,
      count(*) filter (where status_group not in ('resolved', 'closed') and assigned_to is null)  as unassigned,
      count(*) filter (where (received_at at time zone 'Africa/Lagos')::date = v_today)          as received_today,
      count(*) filter (where (resolved_at at time zone 'Africa/Lagos')::date = v_today)          as resolved_today,
      count(*) filter (where sla_state = 'breached')                                             as breached,
      count(*) filter (where sla_state = 'at_risk')                                              as at_risk,
      count(*) filter (where status_group = 'awaiting_customer')                                 as awaiting_customer,
      count(*) filter (where status_group = 'awaiting_internal')                                 as awaiting_internal
    from w
  )
  select jsonb_build_object(
    'days', p_days,
    'open', n.open,
    'unassigned', n.unassigned,
    'received_today', n.received_today,
    'resolved_today', n.resolved_today,
    'breached', n.breached,
    'at_risk', n.at_risk,
    'awaiting_customer', n.awaiting_customer,
    'awaiting_internal', n.awaiting_internal,
    'received', p.received,
    'resolved', p.resolved,
    'median_first_response_min', round(p.median_first_response_min::numeric, 0),
    'median_resolution_min', round(p.median_resolution_min::numeric, 0),
    'sla_measured', p.sla_measured,
    'sla_compliance_pct', case when p.sla_measured > 0 then round(100.0 * p.sla_met / p.sla_measured, 1) end,
    'csat_count', p.csat_count,
    'csat_avg', case when p.csat_count >= p_min_csat_sample then round(p.csat_avg::numeric, 2) end,
    'prev_received', q.received,
    'prev_resolved', q.resolved,
    'prev_median_first_response_min', round(q.median_first_response_min::numeric, 0)
  ) into v_result
  from period p, prev q, now_counts n;

  return v_result;
end;
$$;

revoke all on function public.support_desk_summary(integer, integer) from public, anon;
grant execute on function public.support_desk_summary(integer, integer) to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.support_work_items', 'SELECT') then
    raise exception 'anon must not read support_work_items';
  end if;
  if not exists (
    select 1 from pg_class c where c.relname = 'support_work_items' and c.relnamespace = 'public'::regnamespace
       and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception 'support_work_items must be security_invoker';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'support_work_items'
       and column_name ~ '(diagnos|result|medic|prescri|vital|note|description|body)'
  ) then
    raise exception 'support_work_items must not expose a clinical or free-text body column';
  end if;
  if has_function_privilege('anon', 'public.assign_support_work_item(text,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.support_desk_summary(integer,integer)', 'EXECUTE') then
    raise exception 'support desk RPCs must not be executable by anon';
  end if;
end $$;
