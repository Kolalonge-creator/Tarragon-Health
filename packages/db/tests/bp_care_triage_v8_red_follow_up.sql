-- OQ-551 proof (migration *_bp_care_triage_v8_red_follow_up_draft.sql): bp_care_triage v8 is an UNSIGNED draft, built from v7, where every red rule
-- still pages and gains exactly one 24 hour follow-up task (urgent_bp_review), and no other rule changed. Includes a sabotage step: a copy of v8
-- with the page removed from one red rule, or a second task added, is caught by the same check.
begin;

create function pg_temp.red_rules_ok(p_rules jsonb) returns boolean language sql as $$
  select count(*) > 0 and bool_and(
           (r -> 'actions') @> '[{"kind": "page_on_call"}]'::jsonb
       and (select count(*) from jsonb_array_elements(r -> 'actions') a where a ->> 'kind' = 'create_task') = 1
       and (r -> 'actions') @> '[{"kind": "create_task", "task": "urgent_bp_review", "dueMinutes": 1440}]'::jsonb
       and r ? 'taskAnchor')
    from jsonb_array_elements(p_rules -> 'rules') r where r ->> 'grade' = 'red';
$$;

do $$
declare v7 public.triage_rule_sets%rowtype; v8 public.triage_rule_sets%rowtype; damaged jsonb; doubled jsonb;
begin
  select * into v7 from public.triage_rule_sets where code = 'bp_care_triage' and version = 7;
  select * into v8 from public.triage_rule_sets where code = 'bp_care_triage' and version = 8;
  if v8.id is null then raise exception 'FAIL: bp_care_triage v8 does not exist'; end if;
  if v8.status = 'draft' and (v8.approved_by is not null or v8.approved_at is not null) then raise exception 'FAIL: a draft carries a signature'; end if;
  if jsonb_array_length(v8.rules -> 'rules') <> jsonb_array_length(v7.rules -> 'rules') then raise exception 'FAIL: v8 changed the number of rules'; end if;
  if not pg_temp.red_rules_ok(v8.rules) then raise exception 'FAIL: a red rule does not page and carry exactly one follow-up'; end if;
  if (select jsonb_agg(r order by o) from jsonb_array_elements(v8.rules -> 'rules') with ordinality x(r, o) where r ->> 'grade' <> 'red')
       is distinct from (select jsonb_agg(r order by o) from jsonb_array_elements(v7.rules -> 'rules') with ordinality x(r, o) where r ->> 'grade' <> 'red') then
    raise exception 'FAIL: a non-red rule changed from v7';
  end if;
  if exists (select 1 from jsonb_array_elements(v7.rules -> 'rules') r where r ->> 'grade' = 'red' and (r -> 'actions') @> '[{"kind": "create_task"}]'::jsonb) then
    raise exception 'FAIL: control broken, v7 already had a follow-up on a red rule';
  end if;

  -- sabotage 1: remove the page from one red rule of a copy; the check must fail
  damaged := jsonb_set(v8.rules, '{rules}', (select jsonb_agg(
      case when r ->> 'id' = (select x ->> 'id' from jsonb_array_elements(v8.rules -> 'rules') x where x ->> 'grade' = 'red' limit 1)
           then jsonb_set(r, '{actions}', (select coalesce(jsonb_agg(a), '[]'::jsonb) from jsonb_array_elements(r -> 'actions') a where a ->> 'kind' <> 'page_on_call')) else r end order by o)
    from jsonb_array_elements(v8.rules -> 'rules') with ordinality x(r, o)));
  if pg_temp.red_rules_ok(damaged) then raise exception 'FAIL: sabotage 1 (page removed) was not caught'; end if;

  -- sabotage 2: a second create_task on one red rule of a copy; the check must fail
  doubled := jsonb_set(v8.rules, '{rules}', (select jsonb_agg(
      case when r ->> 'id' = (select x ->> 'id' from jsonb_array_elements(v8.rules -> 'rules') x where x ->> 'grade' = 'red' limit 1)
           then jsonb_set(r, '{actions}', (r -> 'actions') || '[{"kind": "create_task", "task": "urgent_bp_review", "dueMinutes": 60, "notifyKey": "notify.triage.task_created"}]'::jsonb) else r end order by o)
    from jsonb_array_elements(v8.rules -> 'rules') with ordinality x(r, o)));
  if pg_temp.red_rules_ok(doubled) then raise exception 'FAIL: sabotage 2 (second task) was not caught'; end if;
end $$;

rollback;
