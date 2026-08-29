alter function private.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)
  set schema public;
alter function private.claim_integration_outbound_batch(integer)
  set schema public;
alter function private.record_integration_delivery_result(uuid, boolean, integer, text, integer)
  set schema public;
alter function private.prune_integration_logs(integer)
  set schema public;

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
