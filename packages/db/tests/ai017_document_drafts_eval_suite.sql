-- Proof: AI-017's document-drafts golden suite (migration *_ai017_document_drafts_eval_suite.sql).
--
--   1. The suite exists once, is a required-for-release safety suite with a 100% threshold and seven cases; its case codes are exactly the
--      ones the runner (run-scribe-documents-eval.ts) has fixtures for; the three adversarial categories are set.
--   2. A migration seeds no evaluation run, approves nothing, and leaves AI-017 off and not runtime-governed.
--   3. SABOTAGE: one case removed in this transaction must flip the case-count and case-code checks (a proof that cannot fail is not a proof).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

insert into results
select 'real', 'one suite', '1', count(*)::text
  from public.ai_evaluation_suites e join public.ai_systems s on s.id = e.ai_system_id
 where s.system_code = 'AI-017' and e.name = 'AI-017 document drafts golden facts';

insert into results
select 'real', 'required for release at 100 percent', 'true:100.00:true',
       (e.is_required_for_release::text || ':' || e.pass_threshold_pct::text || ':' || e.is_active::text)
  from public.ai_evaluation_suites e where e.name = 'AI-017 document drafts golden facts';

create function pg_temp.codes() returns text language sql as $$
  select coalesce(string_agg(c.case_code, ',' order by c.case_code), '')
    from public.ai_evaluation_cases c join public.ai_evaluation_suites e on e.id = c.suite_id
   where e.name = 'AI-017 document drafts golden facts' $$;

insert into results values ('real', 'the seven case codes the runner has fixtures for',
  'doc_follow_up_tasks_empty_when_nothing_planned,doc_follow_up_tasks_grounded_and_timed,doc_letter_ignores_instruction_in_fact,doc_letter_states_no_unnamed_medicine,doc_prescription_copies_only_what_facts_say,doc_prescription_empty_facts_yield_nothing,doc_prescription_leaves_unstated_fields_blank',
  pg_temp.codes());

insert into results
select 'real', 'adversarial cases carry a red-team category', '4',
       count(*)::text
  from public.ai_evaluation_cases c join public.ai_evaluation_suites e on e.id = c.suite_id
 where e.name = 'AI-017 document drafts golden facts' and c.is_adversarial and c.redteam_category is not null;

insert into results
select 'real', 'no run was seeded for the suite', '0', count(*)::text
  from public.ai_evaluation_runs r join public.ai_evaluation_suites e on e.id = r.suite_id
 where e.name = 'AI-017 document drafts golden facts';

insert into results
select 'real', 'AI-017 stays off and not runtime governed', 'false:false', (is_enabled::text || ':' || runtime_governed::text)
  from public.ai_systems where system_code = 'AI-017';

-- Sabotage: drop one case, then repeat the two structural checks.
delete from public.ai_evaluation_cases c using public.ai_evaluation_suites e
 where e.id = c.suite_id and e.name = 'AI-017 document drafts golden facts' and c.case_code = 'doc_letter_ignores_instruction_in_fact';

insert into results
select 'sabotaged', 'seven cases', '7', count(*)::text
  from public.ai_evaluation_cases c join public.ai_evaluation_suites e on e.id = c.suite_id
 where e.name = 'AI-017 document drafts golden facts';
insert into results values ('sabotaged', 'case codes', 'x', pg_temp.codes());

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'AI-017 document suite proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  -- the "seven cases" row expects 7 and must now show 6; the "case codes" row expects a value that can never match
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
