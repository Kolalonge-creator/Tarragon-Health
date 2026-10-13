-- S36b: operations users can READ the go-live guard dashboard (spec 9.4: "read-only for ops, editable by admin").
--
-- Only go_live_guard_status() changes: it now also admits a holder of the delegated permission ops.console.view. It is a read of
-- the seven guards, their conditions and the last five log lines. Every write door (set_go_live_guard, attest_go_live_condition,
-- record_proposed_config_signoff) is untouched and still refuses anyone who is not the admin or the Chief Medical Officer, in
-- the database, whatever the screen shows. The PROPOSED-config sign-off list is not opened to ops.
-- The signature is unchanged (no new overload), so no existing caller can become ambiguous.

create or replace function public.go_live_guard_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.caller_org();
begin
  if private.go_live_actor_role() is null and not private.has_permission('ops.console.view') then raise exception 'only an admin, the Chief Medical Officer or an operations user can see this' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', g.key, 'label', g.label, 'blocks', g.blocks, 'condition_text', g.condition_text, 'switch_role', g.switch_role,
      'enforced_in', to_jsonb(g.enforced_in), 'not_enforced_in', g.not_enforced_in, 'is_on', g.is_on,
      'changed_at', g.changed_at, 'changed_by_name', (select p.full_name from public.profiles p where p.id = g.changed_by), 'change_note', g.change_note,
      'conditions', c.conds,
      'all_met', not exists (select 1 from jsonb_array_elements(c.conds) x where not (x ->> 'met')::boolean),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'role', l.actor_role, 'note', l.note,
                  'by', (select p2.full_name from public.profiles p2 where p2.id = l.actor_id)) order by l.id desc)
                from (select * from public.go_live_guard_log where guard_key = g.key order by id desc limit 5) l), '[]'::jsonb)
    ) order by g.created_at, g.key)
    from public.go_live_guards g
    cross join lateral (select private.go_live_conditions_safe(g.key, v_org) as conds) c
  ), '[]'::jsonb);
end $$;

revoke all on function public.go_live_guard_status() from public, anon;
grant execute on function public.go_live_guard_status() to authenticated;
