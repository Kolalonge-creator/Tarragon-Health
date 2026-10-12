-- ===========================================================================
-- Verification: SR1 20261012183837_sr1_platform_health_snapshot
--
-- Proves public.platform_health_snapshot():
--   * is callable by service_role and by no client role (anon, authenticated);
--   * returns every section the uptime route reads;
--   * counts an unprocessed payment event older than 5 minutes and NOT a fresh one (CONTROL) nor a processed one;
--   * counts an overdue real task but never an is_test one;
--   * reports an unacknowledged page's age;
--   * SABOTAGE: if the is_test filter were dropped the test task would be counted, so the exclusion check can fail.
-- BEGIN/ROLLBACK; bulk-free fixtures (a handful of rows), triggers off for the inserts.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;

insert into p values
 ('anon cannot call the snapshot', has_function_privilege('anon', 'public.platform_health_snapshot()', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('anon', 'public.platform_health_snapshot()', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('authenticated cannot call the snapshot', has_function_privilege('authenticated', 'public.platform_health_snapshot()', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('authenticated', 'public.platform_health_snapshot()', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('service_role can call the snapshot', has_function_privilege('service_role', 'public.platform_health_snapshot()', 'EXECUTE')::text, 'true',
  case when has_function_privilege('service_role', 'public.platform_health_snapshot()', 'EXECUTE') then 'PASS' else 'FAIL' end);

create temporary table base as select public.platform_health_snapshot() s;

insert into p
select 'snapshot carries section ' || k, (s ? k)::text, 'true', case when s ? k then 'PASS' else 'FAIL' end
from base, unnest(array['generated_at','database','queue','notifications','events','webhooks','cron']) k;

set local session_replication_role = replica;
-- unprocessed payment event, old (counted) / fresh (not counted) / old but processed (not counted)
insert into public.payment_transactions (provider, provider_event_id, event_type, raw_payload, processed_at, created_at) values
  ('paystack', 'sr1-old-unprocessed', 'charge.success', '{}', null, now() - interval '20 minutes'),
  ('paystack', 'sr1-fresh-unprocessed', 'charge.success', '{}', null, now() - interval '1 minute'),
  ('paystack', 'sr1-old-processed', 'charge.success', '{}', now(), now() - interval '20 minutes');
-- overdue open tasks: one real, one test
insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test)
select '00000000-0000-0000-0000-0000000000a1', 'amber_bp_review', 1, 4, 4, gen_random_uuid(), 'senior_medical_officer', now() - interval '90 minutes', 'open', t
from (values (false), (true)) v(t);
-- an unacknowledged root page, 12 minutes old
insert into public.pages (organisation_id, patient_id, triage_event_id, role, escalation_level, config_version, sent_at, to_clinician_id)
values ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), gen_random_uuid(), 'primary', 0, 1, now() - interval '12 minutes', '00000000-0000-0000-0000-0000000000c1');
set local session_replication_role = origin;

create temporary table after_ as select public.platform_health_snapshot() s;

insert into p
select 'only the old unprocessed payment event is counted (+1)',
  ((a.s #>> '{webhooks,payments_unprocessed}')::int - (b.s #>> '{webhooks,payments_unprocessed}')::int)::text, '1',
  case when (a.s #>> '{webhooks,payments_unprocessed}')::int - (b.s #>> '{webhooks,payments_unprocessed}')::int = 1 then 'PASS' else 'FAIL' end
from after_ a, base b;

insert into p
select 'the overdue real task is counted and the is_test one is not (+1)',
  ((a.s #>> '{queue,overdue_tasks}')::int - (b.s #>> '{queue,overdue_tasks}')::int)::text, '1',
  case when (a.s #>> '{queue,overdue_tasks}')::int - (b.s #>> '{queue,overdue_tasks}')::int = 1 then 'PASS' else 'FAIL' end
from after_ a, base b;

insert into p
select 'oldest overdue task is at least 89 minutes', (a.s #>> '{queue,oldest_overdue_task_minutes}'), '>= 89',
  case when (a.s #>> '{queue,oldest_overdue_task_minutes}')::int >= 89 then 'PASS' else 'FAIL' end
from after_ a;

insert into p
select 'the unacknowledged page is counted and aged', (a.s #>> '{queue,oldest_unacknowledged_page_minutes}'), '>= 11',
  case when (a.s #>> '{queue,oldest_unacknowledged_page_minutes}')::int >= 11
        and (a.s #>> '{queue,unacknowledged_pages}')::int - (b.s #>> '{queue,unacknowledged_pages}')::int = 1 then 'PASS' else 'FAIL' end
from after_ a, base b;

-- SABOTAGE: the same count without the is_test filter sees both tasks, so the +1 check above can fail.
insert into p
select 'SABOTAGE: without the is_test filter both overdue tasks would be counted (test discriminates)',
  (select count(*) from public.clinical_tasks where state = 'open' and due_at <= now() and organisation_id = '00000000-0000-0000-0000-0000000000a1')::text, '2',
  case when (select count(*) from public.clinical_tasks where state = 'open' and due_at <= now() and organisation_id = '00000000-0000-0000-0000-0000000000a1') = 2 then 'PASS' else 'FAIL' end;

select * from p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then raise exception 'sr1_platform_health_snapshot: one or more checks failed'; end if;
end $$;
rollback;
