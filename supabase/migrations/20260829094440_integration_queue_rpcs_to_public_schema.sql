-- Tarragon Health — Interoperability & API Platform, part 4: fix the queue
-- RPCs' schema so the app can actually call them.
--
-- BUG FOUND WHILE WIRING UP THE GATEWAY: private.enqueue_integration_event,
-- private.claim_integration_outbound_batch and private.record_integration_
-- delivery_result (and private.prune_integration_logs from part 1) were
-- written to live in the `private` schema, following the pattern used for
-- helpers only ever called from OTHER SQL (triggers, other functions). But
-- these four are meant to be called directly from server-side app code
-- (the gateway's enqueue call, the cron drainer's claim/record loop, the
-- retention sweep) via supabase-js's `.rpc()` -- and `private` is not in
-- PostgREST's exposed schema list at all. This codebase's own
-- revoke_private_schema_execute_from_public migration already confirmed
-- this live: "POST /rest/v1/rpc/hbpm_average returns PGRST202, 'not found
-- in schema cache'". Every existing app-callable RPC in this codebase is a
-- public.* function for exactly this reason (grep any apps/web `.rpc(`
-- call -- there are dozens, every one targets public).
--
-- FIX: move the four functions to `public` via ALTER FUNCTION ... SET
-- SCHEMA (their bodies are unchanged -- this is a pure relocation), then
-- explicitly lock down EXECUTE to service_role only. Postgres grants
-- EXECUTE to PUBLIC by default on function creation, so simply moving
-- schema would otherwise leave these four callable by anon and
-- authenticated too -- these are server-only queue-management primitives
-- (enqueue on behalf of a caller-supplied organisation_id with no session
-- check, claim/record operate on ANY organisation's queue) that must never
-- be reachable from a user session, so PUBLIC is revoked and only
-- service_role re-granted, same discipline as this codebase's own
-- documented anon-EXECUTE-via-PUBLIC gotcha applied one role further.
--
-- private.integration_backoff_seconds stays in `private` -- it is only
-- ever called from inside record_integration_delivery_result's own SQL,
-- never directly from app code.

alter function private.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)
  set schema public;
alter function private.claim_integration_outbound_batch(integer)
  set schema public;
alter function private.record_integration_delivery_result(uuid, boolean, integer, text, integer)
  set schema public;
alter function private.prune_integration_logs(integer)
  set schema public;

-- Revoke from PUBLIC *and* from authenticated explicitly: these four were
-- created in the `private` schema, which this project's default privileges
-- grant EXECUTE to `authenticated` directly (not merely via the PUBLIC
-- pseudo-role) -- confirmed live moments ago, when the first version of
-- this migration's own assertion caught exactly this and aborted before
-- anything was left in a half-locked-down state. A bare "revoke ... from
-- public" does not touch that direct grant, so both are revoked here.
revoke all on function public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment) from public, anon, authenticated;
revoke all on function public.claim_integration_outbound_batch(integer) from public, anon, authenticated;
revoke all on function public.record_integration_delivery_result(uuid, boolean, integer, text, integer) from public, anon, authenticated;
revoke all on function public.prune_integration_logs(integer) from public, anon, authenticated;

grant execute on function public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment) to service_role;
grant execute on function public.claim_integration_outbound_batch(integer) to service_role;
grant execute on function public.record_integration_delivery_result(uuid, boolean, integer, text, integer) to service_role;
grant execute on function public.prune_integration_logs(integer) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_integration_outbound_batch(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_integration_outbound_batch(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_integration_delivery_result(uuid, boolean, integer, text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_integration_delivery_result(uuid, boolean, integer, text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.prune_integration_logs(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.prune_integration_logs(integer)', 'EXECUTE')
  then
    raise exception 'queue management RPCs: anon or authenticated can still EXECUTE a service-role-only function';
  end if;

  if not has_function_privilege('service_role', 'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_integration_outbound_batch(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_integration_delivery_result(uuid, boolean, integer, text, integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.prune_integration_logs(integer)', 'EXECUTE')
  then
    raise exception 'queue management RPCs: service_role grant did not take';
  end if;
end $$;
