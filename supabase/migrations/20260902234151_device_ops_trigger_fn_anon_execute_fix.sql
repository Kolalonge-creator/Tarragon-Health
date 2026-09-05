-- Tarragon Health — Device & Data Operations, forward-fix: close the anon-EXECUTE-via-PUBLIC gap
-- on two trigger functions from this feature's own migrations.
--
-- Found while reconciling this branch against main-dev: private.stamp_patient_device_unpair()
-- (20260902233653_wearable_connection_security_revocation.sql) and
-- private.handle_integration_incident_opened() (20260902233910_integration_health_status_and_
-- incidents.sql) were both created with no explicit `revoke ... from public, anon` — this
-- codebase's own recurring gotcha (project memory: reference_supabase_anon_execute_gotcha,
-- feedback_supabase_anon_execute_gotcha — anon/authenticated inherit EXECUTE through the PUBLIC
-- pseudo-role by default, so an omitted revoke is not "ungranted", it is "granted via PUBLIC").
-- Confirmed live before writing this fix: has_function_privilege('anon', ..., 'EXECUTE') returned
-- true for both.
--
-- Both are practically inert as a direct-call attack surface — Postgres refuses to invoke a
-- trigger-return-type function via a plain SQL call ("trigger functions can only be called as
-- triggers") — but EXECUTE is still a real, checkable privilege independent of that runtime
-- restriction, and this codebase's own established pattern (private.audit_row_change(),
-- private.set_updated_at(), private.integration_component_affected_patients() in the same sibling
-- migration) always closes it explicitly rather than relying on the call failing for an unrelated
-- reason. This is a fix-forward, not an edit to either already-applied migration.

revoke all on function private.stamp_patient_device_unpair() from public, anon;
revoke all on function private.handle_integration_incident_opened() from public, anon;

do $$
begin
  if has_function_privilege('anon', 'private.stamp_patient_device_unpair()', 'EXECUTE') then
    raise exception 'FAIL: anon can still execute private.stamp_patient_device_unpair';
  end if;
  if has_function_privilege('anon', 'private.handle_integration_incident_opened()', 'EXECUTE') then
    raise exception 'FAIL: anon can still execute private.handle_integration_incident_opened';
  end if;
  raise notice 'PASS: anon EXECUTE closed on stamp_patient_device_unpair and handle_integration_incident_opened';
end $$;
