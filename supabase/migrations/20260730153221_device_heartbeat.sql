-- Notification delivery-state + forced-channel fallback, part 4/6.
--
-- Device heartbeat — the v3 pivot banner's "device heartbeat" item. Lets the
-- escalation engine (and, later, any UI) know whether a recipient's device
-- has been seen recently at all, distinct from whether a specific
-- notification was opened. No such column existed anywhere (confirmed —
-- every existing "last active" figure in this codebase is computed on the
-- fly from web_events/audit_log for analytics, never stored on profiles).
--
-- A narrow, single-purpose RPC rather than opening a general self-update RLS
-- policy on profiles — this only ever touches app_last_active_at.
alter table public.profiles
  add column app_last_active_at timestamptz;

create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set app_last_active_at = now()
  where id = (select auth.uid());
$$;

revoke all on function public.touch_last_active() from public, anon;
revoke all on function public.touch_last_active() from anon;
grant execute on function public.touch_last_active() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.touch_last_active()', 'EXECUTE') then
    raise exception 'touch_last_active() is still anon-executable after revoke';
  end if;
end $$;
