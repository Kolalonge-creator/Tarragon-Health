-- Regression guard for the Interoperability & API Platform (spec §33)
-- gateway core, outbound queue, and monitoring surface.
--
-- Run inside a transaction and roll back; nothing persists.
--   npx supabase db query --linked -f packages/db/tests/integration_gateway.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;

-- 1. api_idempotency_records holds response bodies and must be reachable
--    only via the service role — deny-all RLS (RLS enabled, zero policies),
--    per the gateway core migration's own posture.
insert into results
select 'api_idempotency_records has RLS enabled', 'true',
       (select relrowsecurity from pg_class where oid = 'public.api_idempotency_records'::regclass)::text;

insert into results
select 'api_idempotency_records has zero policies (deny-all)', '0',
       (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'api_idempotency_records')::text;

-- 2. api_keys' environment/prefix pairing must actually discriminate — the
--    CHECK the migration itself sabotage-tested at apply time. Kept here as
--    a constraint-existence regression so a later migration can't silently
--    drop it without any test noticing.
insert into results
select 'api_keys_prefix_matches_environment constraint exists', 'true',
       exists (
         select 1 from pg_constraint
         where conrelid = 'public.api_keys'::regclass
           and conname = 'api_keys_prefix_matches_environment'
       )::text;

-- 3. The outbound queue is genuinely read-only from a user session — every
--    state transition must go through requeue_integration_event /
--    cancel_integration_event / the service-role-only RPCs, never a direct
--    UPDATE. A stray INSERT/UPDATE/DELETE policy here would let a
--    compromised admin session forge a "delivered" row without ever
--    calling a partner.
insert into results
select 'integration_outbound_events exposes SELECT only', '0',
       (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'integration_outbound_events'
          and cmd <> 'SELECT')::text;

-- 4. The four queue-management primitives are service-role-only. These run
--    with elevated internal logic (enqueue trusts a caller-supplied
--    organisation_id with no session check; claim/record touch ANY org's
--    queue) — a grant to anon or authenticated here would let any
--    logged-in session forge deliveries for an organisation it has no
--    relationship with.
insert into results
select 'enqueue_integration_event: anon cannot execute', 'false',
       has_function_privilege('anon',
         'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)',
         'EXECUTE')::text;
insert into results
select 'enqueue_integration_event: authenticated cannot execute', 'false',
       has_function_privilege('authenticated',
         'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)',
         'EXECUTE')::text;
insert into results
select 'enqueue_integration_event: service_role can execute', 'true',
       has_function_privilege('service_role',
         'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)',
         'EXECUTE')::text;

insert into results
select 'claim_integration_outbound_batch: anon cannot execute', 'false',
       has_function_privilege('anon', 'public.claim_integration_outbound_batch(integer)', 'EXECUTE')::text;
insert into results
select 'claim_integration_outbound_batch: authenticated cannot execute', 'false',
       has_function_privilege('authenticated', 'public.claim_integration_outbound_batch(integer)', 'EXECUTE')::text;

insert into results
select 'record_integration_delivery_result: anon cannot execute', 'false',
       has_function_privilege('anon',
         'public.record_integration_delivery_result(uuid, boolean, integer, text, integer)', 'EXECUTE')::text;
insert into results
select 'record_integration_delivery_result: authenticated cannot execute', 'false',
       has_function_privilege('authenticated',
         'public.record_integration_delivery_result(uuid, boolean, integer, text, integer)', 'EXECUTE')::text;

insert into results
select 'prune_integration_logs: anon cannot execute', 'false',
       has_function_privilege('anon', 'public.prune_integration_logs(integer)', 'EXECUTE')::text;
insert into results
select 'prune_integration_logs: authenticated cannot execute', 'false',
       has_function_privilege('authenticated', 'public.prune_integration_logs(integer)', 'EXECUTE')::text;

-- 5. The two user-facing monitoring RPCs must be SECURITY INVOKER — that is
--    the entire mechanism by which they inherit the caller's own RLS
--    instead of needing a duplicated authorisation check (see the
--    integration_catalogue_and_monitoring migration's own header). A
--    regression to SECURITY DEFINER here would silently turn both into a
--    cross-org data leak.
insert into results
select 'integration_catalogue is SECURITY INVOKER', 'false',
       (select prosecdef from pg_proc where oid = 'public.integration_catalogue()'::regprocedure)::text;
insert into results
select 'integration_health_metrics is SECURITY INVOKER', 'false',
       (select prosecdef from pg_proc where oid = 'public.integration_health_metrics(integer)'::regprocedure)::text;

-- 6. Admin-facing recovery RPCs stay off anon, same discipline as every
--    other admin RPC in this codebase.
insert into results
select 'requeue_integration_event: anon cannot execute', 'false',
       has_function_privilege('anon', 'public.requeue_integration_event(uuid)', 'EXECUTE')::text;
insert into results
select 'cancel_integration_event: anon cannot execute', 'false',
       has_function_privilege('anon', 'public.cancel_integration_event(uuid)', 'EXECUTE')::text;

-- 7. external_identifier_map's two unique indexes must both exist —
--    together they are what makes "one external id per partner+entity" and
--    "one Tarragon id per partner+entity" hold; either missing would let
--    the same partner map two of our patients to one of theirs (or vice
--    versa) with no constraint stopping it.
insert into results
select 'external_identifier_by_external unique index exists', 'true',
       exists (select 1 from pg_indexes
               where schemaname = 'public' and tablename = 'external_identifier_map'
                 and indexname = 'external_identifier_by_external')::text;
insert into results
select 'external_identifier_by_tarragon unique index exists', 'true',
       exists (select 1 from pg_indexes
               where schemaname = 'public' and tablename = 'external_identifier_map'
                 and indexname = 'external_identifier_by_tarragon')::text;

select check_name,
       expected,
       actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected <> actual;
  if v_fail > 0 then
    raise exception '% integration gateway check(s) failed', v_fail;
  end if;
end $$;

rollback;
