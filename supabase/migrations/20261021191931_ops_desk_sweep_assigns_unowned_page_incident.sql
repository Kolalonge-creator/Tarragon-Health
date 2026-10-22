-- Ops desk: an open page incident nobody was assigned is assigned by the minute sweep once someone is on duty.
--
-- Found 2026-10-21 while fixing the intermittent ops_desk_expired_page proof: assignment ran only from the AFTER INSERT trigger on ops_incidents and
-- private.page_incident only refreshes an incident that is already open, so a "nobody reachable" (or expired-page) incident opened while nobody was
-- on duty, or before a contact was named, stayed unowned until a person resolved and reopened it. Replaces private.sweep_ops_desk() with the
-- existing body plus one step (and a 'late' count in its result). Rows affected on apply: 0 (no table, column or data change).
-- The last block asserts the function is still locked to the service role.

create or replace function private.sweep_ops_desk() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record; o record;
  v_after integer := coalesce(private.ops_desk_rule('deputy_after_seconds'), 300);
  v_deputies integer := 0; v_final integer := 0; v_uncovered integer := 0; v_errors integer := 0; v_late integer := 0;
  v_got uuid;
begin
  for a in
    select asg.id, asg.incident_id, asg.profile_id, asg.role, asg.organisation_id, asg.is_test
      from public.ops_desk_assignments asg
      join public.ops_incidents i on i.id = asg.incident_id
     where asg.acknowledged_at is null and asg.escalated_at is null
       and asg.assigned_at <= now() - make_interval(secs => v_after)
       and i.status not in ('resolved', 'closed') and i.acknowledged_at is null
       -- the page was acknowledged by a clinician after all: the phone call is no longer needed
       and not exists (select 1 from public.pages pg where i.external_reference = 'page_expired:' || pg.id and pg.acknowledged_at is not null)
     order by asg.assigned_at for update of asg skip locked
  loop
    begin
      update public.ops_desk_assignments set escalated_at = now() where id = a.id;
      if a.role = 'primary' then
        v_got := private.ops_desk_assign(a.incident_id, 'deputy', a.profile_id);
        if not exists (select 1 from public.ops_desk_assignments d where d.incident_id = a.incident_id and d.role = 'deputy') and not a.is_test then
          perform private.page_incident(a.organisation_id, 'ops_desk_no_deputy:' || a.incident_id, 'The ops desk primary has not answered and no deputy is on duty',
            'The named ops primary has not acknowledged a page incident and no deputy is on duty. Phone the on-call clinician and the chief medical officer yourself and record the calls.');
        end if;
        v_deputies := v_deputies + 1;
      else
        if not a.is_test then
          perform private.page_incident(a.organisation_id, 'ops_desk_unacknowledged:' || a.incident_id, 'Nobody at the ops desk has acknowledged a page incident',
            'The named ops deputy has not acknowledged a page incident. Phone the on-call clinician and the chief medical officer yourself and record the calls on the Ops desk page.');
          if private.ops_desk_ref(a.incident_id) <> a.incident_id then
            perform private.page_notify_leadership(a.organisation_id, private.ops_desk_ref(a.incident_id), a.is_test, 'on_call_ops_desk_uncovered');
          end if;
        end if;
        v_final := v_final + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (a.organisation_id, 'ops_desk.sweep_error', 'ops_incident', a.incident_id, jsonb_build_object('error', sqlerrm));
      begin
        perform private.page_incident(a.organisation_id, 'ops_desk_sweep_failed', 'The ops desk escalation failed',
          'Moving a page incident to the ops deputy failed (see audit_log ops_desk.sweep_error). Phone the on-call clinician and the chief medical officer now.');
      exception when others then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (a.organisation_id, 'ops_desk.sweep_fallback_error', 'ops_incident', a.incident_id, jsonb_build_object('error', sqlerrm));
        raise warning 'ops desk sweep: % failed and so did the fallback incident: %', a.incident_id, sqlerrm;
      end;
    end;
  end loop;

  -- An open page incident that nobody was assigned (nobody was on duty when it opened, or it was already open when the contact was named) gets
  -- its owner as soon as someone is on duty. The assignment otherwise runs only from the insert trigger, and private.page_incident only refreshes
  -- an incident that is already open, so without this it would wait for a person to resolve and reopen it. Only when someone IS on duty: with nobody
  -- on duty ops_desk_assign would repeat the uncovered notice to the leadership every minute.
  for a in
    select i.id, i.organisation_id, coalesce((select pg.is_test from public.pages pg where i.external_reference = 'page_expired:' || pg.id), false) as is_test
      from public.ops_incidents i
     where (i.external_reference ~ '^page_expired:[0-9a-f-]{36}$' or i.external_reference like 'page\_nobody\_reachable:%')
       and i.status not in ('resolved', 'closed') and i.acknowledged_at is null and i.organisation_id is not null
       and i.created_at > now() - interval '24 hours'
       and not exists (select 1 from public.ops_desk_assignments x where x.incident_id = i.id)
       and not exists (select 1 from public.pages pg where i.external_reference = 'page_expired:' || pg.id and pg.acknowledged_at is not null)
     order by i.created_at
  loop
    begin
      if exists (select 1 from private.ops_desk_on_duty(a.organisation_id, a.is_test)) then
        perform private.ops_desk_assign(a.id, 'first', null);
        v_late := v_late + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (a.organisation_id, 'ops_desk.sweep_error', 'ops_incident', a.id, jsonb_build_object('error', sqlerrm, 'step', 'late_assign'));
    end;
  end loop;

  -- a notice that failed to send: the page monitors do not see these (they point at an incident, not a page)
  if exists (select 1 from public.notifications n where n.source_table = 'ops_incidents' and n.template like 'on\_call\_ops\_desk%' and n.status = 'failed' and n.created_at > now() - interval '1 hour') then
    perform private.page_incident(null, 'ops_desk_notifications_failed', 'Ops desk notices are failing to send',
      'A notice to an ops contact failed in the last hour (see notifications.last_error). Check who is affected and phone them.');
  end if;

  if coalesce(private.ops_desk_rule('uncovered_roster_alarm'), 0) = 1 then
    for o in select distinct r.organisation_id from public.on_call_rota r where r.is_test = false and r.cancelled_at is null and r.starts_at <= now() and r.ends_at > now() loop
      begin
        if exists (select 1 from private.ops_desk_on_duty(o.organisation_id, false)) then
          -- cover is back: the alarm closes itself (a person can still reopen the question in the incident)
          -- the register's own path: moving the status fires its stamp trigger (resolved_at, mitigated_at, acknowledged_at) and its timeline trigger
          update public.ops_incidents set status = 'resolved', root_cause = coalesce(root_cause, 'An ops desk contact is on duty again (closed automatically).')
           where external_reference = 'ops_desk_uncovered_roster:' || o.organisation_id and status not in ('resolved', 'closed');
        else
          perform private.page_incident(o.organisation_id, 'ops_desk_uncovered_roster:' || o.organisation_id, 'Nobody is named at the ops desk for this hour',
            'A real on-call rota is running and no ops desk contact is on duty right now. If a red event page expires, no named person will be told to phone the on-call clinician. Name, verify and activate ops contacts on the Ops desk page.');
          v_uncovered := v_uncovered + 1;
        end if;
      exception when others then
        v_errors := v_errors + 1;
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (o.organisation_id, 'ops_desk.sweep_error', 'organisation', o.organisation_id, jsonb_build_object('error', sqlerrm, 'step', 'roster'));
      end;
    end loop;
  end if;
  return jsonb_build_object('deputies', v_deputies, 'final', v_final, 'uncovered', v_uncovered, 'late', v_late, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_ops_desk() from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.sweep_ops_desk()', 'EXECUTE') or has_function_privilege('authenticated', 'private.sweep_ops_desk()', 'EXECUTE') then
    raise exception 'sweep_ops_desk must not be callable by anon or authenticated';
  end if;
  if pg_get_functiondef('private.sweep_ops_desk()'::regprocedure) not like '%late_assign%' then
    raise exception 'sweep_ops_desk was not replaced';
  end if;
end $$;
