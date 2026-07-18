-- Tarragon Health — Super-Admin RBAC Phase 2: member activity / oversight RPC.
--
-- Lets the super admin (or a member delegated `members.activity.view`) read
-- another member's recent activity from the immutable public.audit_log. A
-- self-gating SECURITY DEFINER primitive — even if a page guard were bypassed,
-- a caller without the capability gets `42501`, never data. Read-only, no PHI:
-- audit_log records who-did-what actions, not patient records.
-- ---------------------------------------------------------------------------

create or replace function public.admin_member_activity(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.has_permission('members.activity.view') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_actions', (select count(*) from public.audit_log where actor_id = p_member),
    'last_active', (select max(created_at) from public.audit_log where actor_id = p_member),
    'action_counts', coalesce((
      select jsonb_agg(jsonb_build_object('action', action, 'count', c) order by c desc)
      from (
        select action, count(*)::int as c
        from public.audit_log
        where actor_id = p_member
        group by action
      ) t
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', action,
        'entity_type', entity_type,
        'entity_id', entity_id,
        'created_at', created_at,
        'event', event
      ) order by created_at desc)
      from (
        select action, entity_type, entity_id, created_at, event
        from public.audit_log
        where actor_id = p_member
        order by created_at desc
        limit 100
      ) r
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- Strip the default PUBLIC execute grant so anon can't reach it at all (revoking
-- from anon alone leaves the inherited PUBLIC grant), then re-grant to signed-in
-- users only. The in-body has_permission() check is still the real gate.
revoke execute on function public.admin_member_activity(uuid) from public;
revoke execute on function public.admin_member_activity(uuid) from anon;
grant execute on function public.admin_member_activity(uuid) to authenticated;
