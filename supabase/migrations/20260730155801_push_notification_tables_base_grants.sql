-- Notification delivery-state + forced-channel fallback — fix.
--
-- Found live, via browser verification: POST /api/push/subscribe returned
-- "permission denied for table push_subscriptions" for a real authenticated
-- session — not an RLS rejection (which would just filter rows), a bare
-- missing GRANT. `authenticated` has no base table-level privilege on either
-- new table from this build; RLS restricts ROWS but the role still needs
-- the underlying SQL grant to reach the table at all. This is the exact gap
-- CLAUDE.md's M1 entry already documented for this platform's rebuilt
-- schema — Supabase normally provisions this at project creation via
-- default privileges, which a table created later by a plain migration does
-- not inherit. `notifications` itself (original platform_infra migration,
-- created at project setup) already has these grants; only the two tables
-- new in this build were missing them.
grant select, insert, update, delete on public.push_subscriptions to authenticated;
-- notification_escalation_failures has a SELECT-only RLS policy (admin/org
-- staff) and no insert/update/delete policy at all — writes are
-- function-only (private.escalate_unconfirmed_critical_notifications, which
-- runs as postgres and bypasses grants). authenticated only needs the base
-- SELECT grant for its RLS policy to have anything to filter.
grant select on public.notification_escalation_failures to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT') then
    raise exception 'authenticated still cannot SELECT push_subscriptions after grant';
  end if;
  if not has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT') then
    raise exception 'authenticated still cannot INSERT push_subscriptions after grant';
  end if;
  if not has_table_privilege('authenticated', 'public.notification_escalation_failures', 'SELECT') then
    raise exception 'authenticated still cannot SELECT notification_escalation_failures after grant';
  end if;
end $$;
