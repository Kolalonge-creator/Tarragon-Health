-- ===========================================================================
-- Verification: SR2d 20261013004916_sr2d_hot_path_indexes_and_overdue_sweep_sargable
--
-- Proves:
--   * the four indexes exist and are valid;
--   * private.sweep_clinical_tasks now compares `due_at <= now() - make_interval(...)` and not the old expression;
--   * the old and new conditions select EXACTLY the same task ids on a fixture that straddles the boundary, for a
--     zero and a non-zero grace period (so the rewrite changed speed, not meaning);
--   * the planner turns the new condition into an Index Cond on due_at on a 80,000 row table;
--   * SABOTAGE: the old expression gets no Index Cond on due_at, so the plan check can fail;
--   * the function stays uncallable by anon and authenticated.
-- BEGIN/ROLLBACK. Bulk rows are loaded with triggers off (session_replication_role = replica) and removed by the rollback.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table fx(k text primary key, v text) on commit drop;

insert into p
select 'index ' || n || ' exists and is valid', coalesce(i.indisvalid::text, 'missing'), 'true', case when coalesce(i.indisvalid, false) then 'PASS' else 'FAIL' end
from unnest(array['clinical_tasks_overdue_idx','clinical_tasks_amber_promotion_idx','lab_orders_org_status_ordered_idx','notifications_pending_send_idx']) n
left join pg_index i on i.indexrelid = to_regclass('public.' || n);

insert into p
select 'sweep uses the sargable condition',
  (position('due_at <= now() - make_interval(mins => v_grace)' in d) > 0 and position('due_at + make_interval(mins => v_grace) <= now()' in d) = 0)::text, 'true',
  case when position('due_at <= now() - make_interval(mins => v_grace)' in d) > 0 and position('due_at + make_interval(mins => v_grace) <= now()' in d) = 0 then 'PASS' else 'FAIL' end
from (select pg_get_functiondef('private.sweep_clinical_tasks'::regproc) d) x;

insert into p values
 ('anon cannot execute the sweep', has_function_privilege('anon', 'private.sweep_clinical_tasks()', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('anon', 'private.sweep_clinical_tasks()', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('authenticated cannot execute the sweep', has_function_privilege('authenticated', 'private.sweep_clinical_tasks()', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('authenticated', 'private.sweep_clinical_tasks()', 'EXECUTE') then 'PASS' else 'FAIL' end);

-- Bulk fixture (triggers/FKs off), organisation = a throwaway uuid.
set local session_replication_role = replica;
insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test)
select '00000000-0000-0000-0000-0000000000a1', 'amber_bp_review', 1, 4, 4, gen_random_uuid(), 'senior_medical_officer',
       now() + (((g % 2000) - 1000) || ' minutes')::interval,
       (array['open','offered_to_lead'])[1 + g % 2]::clinical_task_state, true
from generate_series(1, 40000) g;
-- Plus 40,000 closed rows so the partial index has something to be partial about.
insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test, completed_at, outcome)
select '00000000-0000-0000-0000-0000000000a1', 'amber_bp_review', 1, 4, 4, gen_random_uuid(), 'senior_medical_officer', now() - (g || ' minutes')::interval,
       'completed', true, now(), '{}'::jsonb
from generate_series(1, 40000) g;
set local session_replication_role = origin;
analyze public.clinical_tasks;

-- Same rows, old versus new condition, grace 0 and 15.
create temporary table old0 as select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at + make_interval(mins => 0) <= now();
create temporary table new0 as select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at <= now() - make_interval(mins => 0);
create temporary table old15 as select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at + make_interval(mins => 15) <= now();
create temporary table new15 as select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at <= now() - make_interval(mins => 15);
insert into p values
 ('old and new condition select the same ids, grace 0', ((select count(*) from old0)::text || '/' || (select count(*) from new0)::text), 'equal and > 0',
  case when (select count(*) from old0) > 0 and not exists (select 1 from (select id from old0 except select id from new0) a) and not exists (select 1 from (select id from new0 except select id from old0) b) then 'PASS' else 'FAIL' end),
 ('old and new condition select the same ids, grace 15', ((select count(*) from old15)::text || '/' || (select count(*) from new15)::text), 'equal and > 0',
  case when (select count(*) from old15) > 0 and not exists (select 1 from (select id from old15 except select id from new15) a) and not exists (select 1 from (select id from new15 except select id from old15) b) then 'PASS' else 'FAIL' end);

-- Planner: new condition uses the index; old expression cannot.
create or replace function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare r text; s text := '';
begin for r in execute 'explain ' || q loop s := s || r || E'\n'; end loop; return s; end $$;
set local enable_seqscan = off;  -- only to ask which index COULD serve it; the sabotage below shows the old form cannot
insert into p select 'new condition is a range condition on the index (Index Cond on due_at)',
  (pg_temp.plan_of($q$select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at <= now() - make_interval(mins => 0)$q$) ~ 'Index Cond: \(+due_at <=')::text, 'true',
  case when pg_temp.plan_of($q$select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at <= now() - make_interval(mins => 0)$q$) ~ 'Index Cond: \(+due_at <=' then 'PASS' else 'FAIL' end;
-- Even with sequential scans forbidden, the old expression can only read the whole index and filter: no Index Cond on due_at.
insert into p select 'SABOTAGE: the old expression gets no Index Cond on due_at (test discriminates)',
  (pg_temp.plan_of($q$select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at + make_interval(mins => 0) <= now()$q$) !~ 'Index Cond: \(+due_at')::text, 'true',
  case when pg_temp.plan_of($q$select id from public.clinical_tasks where state in ('offered_to_lead','open') and due_at + make_interval(mins => 0) <= now()$q$) !~ 'Index Cond: \(+due_at' then 'PASS' else 'FAIL' end;
set local enable_seqscan = on;

select * from p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then raise exception 'sr2d: one or more checks failed'; end if;
end $$;
rollback;
