-- W-40: run this against the load-test database AFTER a k6 run or tools/load run. It is read-only and raises on the first failure.
--   psql "$LOAD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/load/verify-safety.sql
-- Scope: is_test rows only, so it can be pointed at a database that also holds other data.
-- Safety rules (plan section 2): no task is claimed twice, no doctor holds two live claims, every red event has a page.
-- NOT EXECUTED when written (no Docker on the authoring machine).
do $$
declare n int;
begin
  select count(*) into n from (
    select k.task_id from public.task_claims k
      join public.clinical_tasks t on t.id = k.task_id
      join public.profiles p on p.id = t.patient_id and p.is_test
     where k.ended_at is null group by 1 having count(*) > 1) x;
  if n > 0 then raise exception 'SAFETY: % task(s) have two live claims', n; end if;

  select count(*) into n from (
    select k.clinician_id from public.task_claims k
      join public.profiles c on c.id = k.clinician_id and c.is_test
     where k.ended_at is null group by 1 having count(*) > 1) x;
  if n > 0 then raise exception 'SAFETY: % doctor(s) hold two live claims', n; end if;

  select count(*) into n from public.triage_events e
    where e.is_test and e.grade = 'red' and not e.shadow
      and not exists (select 1 from public.pages p where p.triage_event_id = e.id and p.parent_page_id is null);
  if n > 0 then raise exception 'SAFETY: % red event(s) have no page', n; end if;

  select count(*) into n from public.triage_events e
    where e.is_test and e.grade = 'red' and not e.shadow
      and exists (select 1 from public.pages p where p.triage_event_id = e.id and p.parent_page_id is null)
      and not exists (select 1 from public.notifications nt join public.pages p on p.id = nt.source_id and nt.source_table = 'pages'
                       where p.triage_event_id = e.id and nt.priority = 'critical');
  if n > 0 then raise exception 'SAFETY: % paged red event(s) produced no critical notification', n; end if;

  raise notice 'OK: no task claimed twice, no doctor with two live claims, every red event paged and notified';
end $$;
