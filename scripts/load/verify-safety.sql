-- W-40: run this against the load-test database AFTER a k6 run or a tools/load run. Read-only; raises on the first failure.
--   psql "$LOAD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/load/verify-safety.sql
--   psql "$LOAD_DB_URL" -v ON_ERROR_STOP=1 -v require_red=1 -f scripts/load/verify-safety.sql   (fail if the run produced no red test events)
-- Scope: is_test rows only, so it can be pointed at a database that also holds other data.
--
-- WHAT EACH CHECK IS WORTH (read this before trusting a green run):
--   1. "no task has two live claims"   SANITY ONLY. The unique index task_claims_one_live (task_id where ended_at is null) makes this
--                                      impossible to fail. A double claim attempt shows up as a unique violation in the application
--                                      instead: that is measured by the k6 counters queue_contention_409 and queue_server_errors in
--                                      scripts/load/k6/queue-next.js, which are the real contention measures.
--   2. "no doctor holds two live claims" REAL for queue_next: the database does not forbid it, queue_next must (it returns the live
--                                      claim instead of taking another). The k6 script also reads it back per doctor in teardown().
--   3. red events paged / notified      REAL, but only for red events the run actually created. The k6 script creates NONE (it covers
--                                      queue_next only). Red events come from tools/load. With zero red test events this file says
--                                      NOT EXERCISED, and fails if require_red=1.
-- NOT EXECUTED when written (no Docker on the authoring machine).

\if :{?require_red}
\else
  \set require_red 0
\endif
select set_config('load.require_red', :'require_red', false);

do $$
declare
  n int; v_red int; v_claims int; v_require boolean := current_setting('load.require_red') = '1';
begin
  select count(*) into v_claims from public.task_claims k join public.profiles c on c.id = k.clinician_id and c.is_test;
  raise notice 'claims by test doctors in this database: %', v_claims;

  -- 1. SANITY ONLY (cannot fail while the unique index exists)
  select count(*) into n from (
    select k.task_id from public.task_claims k
      join public.clinical_tasks t on t.id = k.task_id
      join public.profiles p on p.id = t.patient_id and p.is_test
     where k.ended_at is null group by 1 having count(*) > 1) x;
  if n > 0 then raise exception 'SAFETY: % task(s) have two live claims (the unique index task_claims_one_live is missing or broken)', n; end if;

  -- 2. REAL: a doctor holds at most one live claim
  select count(*) into n from (
    select k.clinician_id from public.task_claims k
      join public.profiles c on c.id = k.clinician_id and c.is_test
     where k.ended_at is null group by 1 having count(*) > 1) x;
  if n > 0 then raise exception 'SAFETY: % doctor(s) hold two live claims', n; end if;

  -- 3. red events: only meaningful if the run made some
  select count(*) into v_red from public.triage_events e where e.is_test and e.grade = 'red' and not e.shadow;
  if v_red = 0 then
    if v_require then raise exception 'NOT EXERCISED: 0 red test events in this run and require_red=1. Run tools/load (it creates red events) before this check.'; end if;
    raise notice 'NOT EXERCISED (0 red events in this run): the red event paging checks below were skipped, not passed. The k6 queue script creates no red events; use tools/load for those.';
  else
    select count(*) into n from public.triage_events e
      where e.is_test and e.grade = 'red' and not e.shadow
        and not exists (select 1 from public.pages p where p.triage_event_id = e.id and p.parent_page_id is null);
    if n > 0 then raise exception 'SAFETY: % of % red event(s) have no page', n, v_red; end if;

    select count(*) into n from public.triage_events e
      where e.is_test and e.grade = 'red' and not e.shadow
        and not exists (select 1 from public.notifications nt join public.pages p on p.id = nt.source_id and nt.source_table = 'pages'
                         where p.triage_event_id = e.id and nt.priority = 'critical');
    if n > 0 then raise exception 'SAFETY: % of % paged red event(s) produced no critical notification', n, v_red; end if;
    raise notice 'OK: all % red test events were paged and produced a critical notification', v_red;
  end if;

  raise notice 'OK: no doctor with two live claims (and the claim-uniqueness sanity check held). Contention itself is read from the k6 counters.';
end $$;
