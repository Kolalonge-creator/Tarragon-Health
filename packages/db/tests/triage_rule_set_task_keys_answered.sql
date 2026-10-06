-- Regression: every task key a triage rule set can create must be answered by an active, creatable task type.
--
-- Bug: bp_care_triage v2 (rule BP-P5) created postpartum_review, which no task type answered. Nothing flagged it in
-- the draft; the CMO found out only when approve_triage_rule_set refused to sign (2026-10-06). Fixed by
-- 20261006174040_task_type_amber_bp_review_answers_postpartum_review.sql.
--
-- Proves in one rolled-back transaction:
--   0. Fixture: a draft rule set with a postpartum rule, shaped like BP-P5 (a fresh replay has no such set in it).
--   1. Every shipped rule set, whatever its status, has no create_task key without an answering task type.
--   2. postpartum_review is answered by an active, creatable task type.
--   3. SABOTAGE: with the key removed from its task type, check 1 must find it unanswered.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.unanswered() returns text language sql as
$f$
  select coalesce(string_agg(distinct rs.code || ' v' || rs.version || ': ' || (x ->> 'task'), ', '), '')
    from public.triage_rule_sets rs,
         lateral jsonb_path_query(rs.rules, '$.rules[*].actions[*] ? (@.kind == "create_task")') x
   where not exists (
     select 1 from public.task_types t
      where t.is_active and t.creatable and t.source_task_keys @> array[x ->> 'task']
   )
$f$;

insert into public.triage_rule_sets (code, version, status, rules) values ('task_key_fixture', 1, 'draft',
  '{"code":"task_key_fixture","version":1,"rules":[{"id":"BP-P5","actions":[{"kind":"create_task","task":"postpartum_review","dueMinutes":1440}]}]}'::jsonb);

insert into results values ('real', 'every rule set task key is answered by a task type', '', pg_temp.unanswered());
insert into results values ('real', 'postpartum_review has an active creatable task type', 'true',
  exists (select 1 from public.task_types t where t.is_active and t.creatable and t.source_task_keys @> array['postpartum_review'])::text);

-- SABOTAGE: take the key away; the check above must now report it
update public.task_types set source_task_keys = array_remove(source_task_keys, 'postpartum_review') where code = 'amber_bp_review';
insert into results values ('sabotaged', 'every rule set task key is answered by a task type', '', pg_temp.unanswered());

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'task-key proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing postpartum_review did not change the result'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
