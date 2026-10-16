-- ===========================================================================
-- Verification: OQ-436 20261016190347_oq436_deadman_status
-- Proves public.deadman_status(): service_role only; reports heartbeat age; counts a due-and-old pending delivery but not a
-- fresh one (CONTROL) nor a done one; counts dead letters; counts open sev1/sev2 incidents but not sev3 or resolved ones.
-- SABOTAGE: the function is replaced inside the transaction by a version without the pending filter and the 24 hour window; the +1 checks must flip.
-- BEGIN/ROLLBACK, triggers (and so foreign keys) off for fixtures.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;

insert into p values
 ('anon cannot call', has_function_privilege('anon', 'public.deadman_status(integer)', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('anon', 'public.deadman_status(integer)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('authenticated cannot call', has_function_privilege('authenticated', 'public.deadman_status(integer)', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('authenticated', 'public.deadman_status(integer)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('service_role can call', has_function_privilege('service_role', 'public.deadman_status(integer)', 'EXECUTE')::text, 'true',
  case when has_function_privilege('service_role', 'public.deadman_status(integer)', 'EXECUTE') then 'PASS' else 'FAIL' end);

create temporary table base as select public.deadman_status(300) s;

set local session_replication_role = replica;
insert into public.paging_heartbeats (component, last_seen_at) values ('process_events', now() - interval '400 seconds')
  on conflict (component) do update set last_seen_at = excluded.last_seen_at;
insert into public.domain_events (id, event_type, event_version, organisation_id, idempotency_key) values
  ('00000000-0000-0000-0000-0000000e0001', 'oq436.test', 1, '00000000-0000-0000-0000-0000000000f1', 'k1'),
  ('00000000-0000-0000-0000-0000000e0002', 'oq436.test', 1, '00000000-0000-0000-0000-0000000000f1', 'k2'),
  ('00000000-0000-0000-0000-0000000e0003', 'oq436.test', 1, '00000000-0000-0000-0000-0000000000f1', 'k3'),
  ('00000000-0000-0000-0000-0000000e0004', 'oq436.test', 1, '00000000-0000-0000-0000-0000000000f1', 'k4'),
  ('00000000-0000-0000-0000-0000000e0005', 'oq436.test', 1, '00000000-0000-0000-0000-0000000000f1', 'k5');
insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status, next_attempt_at) values
  ('00000000-0000-0000-0000-0000000e0001', 'oq436.sub', '00000000-0000-0000-0000-0000000000f1', 'pending', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-0000000e0002', 'oq436.sub', '00000000-0000-0000-0000-0000000000f1', 'pending', now() - interval '10 seconds'),
  ('00000000-0000-0000-0000-0000000e0003', 'oq436.sub', '00000000-0000-0000-0000-0000000000f1', 'done', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-0000000e0004', 'oq436.sub', '00000000-0000-0000-0000-0000000000f1', 'dead', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-0000000e0005', 'oq436.sub', '00000000-0000-0000-0000-0000000000f1', 'dead', now() - interval '20 minutes');
update public.domain_event_deliveries set updated_at = now() - interval '3 days' where event_id = '00000000-0000-0000-0000-0000000e0005';
insert into public.ops_incidents (category, severity, status, title, root_cause, ack_due_at, resolve_due_at)
select c, v.sev::public.ops_incident_severity, v.st::public.ops_incident_status, 'oq436 ' || v.sev || v.st, case when v.st = 'resolved' then 'x' end, now(), now()
from (select (enum_range(null::public.ops_incident_category))[1] c) cc,
     (values ('sev1','open'), ('sev2','investigating'), ('sev3','open'), ('sev1','resolved')) v(sev, st);
set local session_replication_role = origin;

create temporary table after_ as select public.deadman_status(300) s;

insert into p select 'heartbeat age is at least 399 seconds', a.s ->> 'process_events_heartbeat_age_seconds', '>= 399',
  case when (a.s ->> 'process_events_heartbeat_age_seconds')::bigint >= 399 then 'PASS' else 'FAIL' end from after_ a;
insert into p select 'only the old pending delivery is counted (+1)',
  ((a.s ->> 'due_unclaimed_deliveries')::int - (b.s ->> 'due_unclaimed_deliveries')::int)::text, '1',
  case when (a.s ->> 'due_unclaimed_deliveries')::int - (b.s ->> 'due_unclaimed_deliveries')::int = 1 then 'PASS' else 'FAIL' end from after_ a, base b;
insert into p select 'dead letter from the last 24 hours counted, a 3 day old one not (+1)',
  ((a.s ->> 'dead_letter_deliveries')::int - (b.s ->> 'dead_letter_deliveries')::int)::text, '1',
  case when (a.s ->> 'dead_letter_deliveries')::int - (b.s ->> 'dead_letter_deliveries')::int = 1 then 'PASS' else 'FAIL' end from after_ a, base b;
insert into p select 'open sev1/sev2 only (+2; sev3 and resolved excluded)',
  ((a.s ->> 'open_sev1_sev2_incidents')::int - (b.s ->> 'open_sev1_sev2_incidents')::int)::text, '2',
  case when (a.s ->> 'open_sev1_sev2_incidents')::int - (b.s ->> 'open_sev1_sev2_incidents')::int = 2 then 'PASS' else 'FAIL' end from after_ a, base b;
-- SABOTAGE: replace the function with one that drops the pending filter and the dead-letter window; the same +1 checks must then FAIL.
create or replace function public.deadman_status(p_due_older_than_seconds integer default 300)
returns jsonb language sql stable security definer set search_path = ''
as $f$
  select jsonb_build_object(
    'due_unclaimed_deliveries', (select count(*) from public.domain_event_deliveries d where d.next_attempt_at < now() - make_interval(secs => p_due_older_than_seconds)),
    'dead_letter_deliveries', (select count(*) from public.domain_event_deliveries d where d.status = 'dead'));
$f$;
create temporary table sab as select public.deadman_status(300) s;
insert into p select 'SABOTAGE: with the pending filter dropped the due count is no longer +1 (test discriminates)',
  ((s.s ->> 'due_unclaimed_deliveries')::int - (b.s ->> 'due_unclaimed_deliveries')::int)::text, '<> 1',
  case when (s.s ->> 'due_unclaimed_deliveries')::int - (b.s ->> 'due_unclaimed_deliveries')::int <> 1 then 'PASS' else 'FAIL' end from sab s, base b;
insert into p select 'SABOTAGE: with the 24 hour window dropped the dead-letter count is no longer +1 (test discriminates)',
  ((s.s ->> 'dead_letter_deliveries')::int - (b.s ->> 'dead_letter_deliveries')::int)::text, '<> 1',
  case when (s.s ->> 'dead_letter_deliveries')::int - (b.s ->> 'dead_letter_deliveries')::int <> 1 then 'PASS' else 'FAIL' end from sab s, base b;

select * from p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then raise exception 'oq436_deadman_status: one or more checks failed'; end if;
end $$;
rollback;
