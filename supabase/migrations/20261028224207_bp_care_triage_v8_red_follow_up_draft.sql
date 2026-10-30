-- OQ-551 (owner decision 2026-10-28): bp_care_triage v8 = version 7 plus one follow-up task on every RED rule. A DRAFT. NOT signed, NOT approved.
-- The Chief Medical Officer has not read or signed it; an agent never signs a rule set. Applying this migration only adds a draft row, so no patient
-- is affected until the CMO approves it with approve_triage_rule_set.
--
-- Why: journey 2 asks for "a follow-up the next day". The approved rule set pages the on-call clinician on a red grade and names no follow-up, so
-- nothing asks a doctor to check on the patient the next day. Version 8 adds, to each red rule, one create_task action (urgent_bp_review, due 1440
-- minutes, an existing task type) and a weekly task anchor where the rule had none. The page is unchanged. It is a clinician task, not a booked
-- consultation and not a paid slot. The lead time and the task type are PROPOSED for the CMO (params.proposedForCmo.redFollowUp).
--
-- Built from the STORED version 7 row (derived, not retyped). Row count before this migration: 0 rows for version 8 (it adds a row, removes none).
insert into public.triage_rule_sets (code, version, status, rules, note)
select code, 8, 'draft',
       jsonb_set(
         jsonb_set(
           jsonb_set(rules, '{version}', '8'::jsonb),
           '{params,proposedForCmo}',
           (rules #> '{params,proposedForCmo}') || jsonb_build_object(
             'redFollowUp', 'Version 8 adds one follow-up task to every red rule: urgent_bp_review, due 1440 minutes (24 hours) after the grade, one a week per patient (OQ-551, owner decision 2026-10-28). The page is unchanged. The CMO decides the lead time, the task type and whether a red grade should also offer the patient a consultation. Limits the CMO should know: the task is shared with any open amber_bp_review for the patient, so an earlier open one keeps its own due time; a second red in the same ISO week creates no further task while the first is open; a red grade for a Free patient creates no clinical task (two-tier rule).')),
         '{rules}',
         (select jsonb_agg(
                   case when r ->> 'grade' = 'red'
                        then jsonb_set(
                               jsonb_set(r, '{actions}',
                                 (r -> 'actions') || '[{"kind": "create_task", "task": "urgent_bp_review", "dueMinutes": 1440, "notifyKey": "notify.triage.task_created"}]'::jsonb),
                               '{taskAnchor}', coalesce(r -> 'taskAnchor', '"week"'::jsonb))
                        else r end
                   order by o)
            from jsonb_array_elements(rules -> 'rules') with ordinality x(r, o))),
       'bp_care_triage v8 DRAFT (OQ-551): version 7 plus one 24 hour follow-up task (urgent_bp_review) on every red rule. NOT signed by the CMO, who decides the lead time and the task type. The page is unchanged.'
  from public.triage_rule_sets
 where code = 'bp_care_triage' and version = 7
on conflict (code, version) do nothing;

do $$
declare v7 public.triage_rule_sets%rowtype; v8 public.triage_rule_sets%rowtype; reds integer; bad integer;
begin
  select * into v7 from public.triage_rule_sets where code = 'bp_care_triage' and version = 7;
  select * into v8 from public.triage_rule_sets where code = 'bp_care_triage' and version = 8;
  if v7.id is null then raise exception 'OQ-551 self-check: bp_care_triage v7 is missing'; end if;
  if v8.id is null then raise exception 'OQ-551 self-check: bp_care_triage v8 was not created'; end if;
  if v8.status <> 'draft' or v8.approved_by is not null or v8.approved_at is not null then
    raise exception 'OQ-551 self-check: v8 must be an unsigned draft, found % / approved_by %', v8.status, v8.approved_by;
  end if;
  if (v8.rules -> 'version') <> to_jsonb(8) or (v8.rules -> 'code') <> to_jsonb('bp_care_triage'::text) then
    raise exception 'OQ-551 self-check: the JSON must repeat the row code and version';
  end if;
  if jsonb_array_length(v8.rules -> 'rules') <> jsonb_array_length(v7.rules -> 'rules') then
    raise exception 'OQ-551 self-check: v8 must have the same number of rules as v7';
  end if;
  -- every non-red rule is v7 unchanged
  if (select jsonb_agg(r order by o) from jsonb_array_elements(v8.rules -> 'rules') with ordinality x(r, o) where r ->> 'grade' <> 'red')
       is distinct from (select jsonb_agg(r order by o) from jsonb_array_elements(v7.rules -> 'rules') with ordinality x(r, o) where r ->> 'grade' <> 'red') then
    raise exception 'OQ-551 self-check: a non-red rule changed';
  end if;
  -- every red rule still pages and has exactly one create_task, the follow-up
  select count(*) into reds from jsonb_array_elements(v8.rules -> 'rules') r where r ->> 'grade' = 'red';
  select count(*) into bad from jsonb_array_elements(v8.rules -> 'rules') r
   where r ->> 'grade' = 'red'
     and not ( (r -> 'actions') @> '[{"kind": "page_on_call"}]'::jsonb
               and (select count(*) from jsonb_array_elements(r -> 'actions') a where a ->> 'kind' = 'create_task') = 1
               and (r -> 'actions') @> '[{"kind": "create_task", "task": "urgent_bp_review", "dueMinutes": 1440}]'::jsonb
               and r ? 'taskAnchor');
  if reds = 0 or bad <> 0 then
    raise exception 'OQ-551 self-check: % red rules, % without the page and exactly one follow-up', reds, bad;
  end if;
  -- approval is done live by the CMO, never by a migration
  if (select count(*) from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved') > 1 then
    raise exception 'OQ-551 self-check: at most one bp_care_triage version may be approved';
  end if;
end $$;
