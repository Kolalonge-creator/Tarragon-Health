-- S62 follow-up: sweep_pathway_scheduled_tests() re-checks the pathway go-live guard, as sweep_pathway_reviews() already does.
--
-- Recorded as a follow-up in 20261022095007_s62_schedule_pathway_sweeps.sql: the scheduled-tests sweep skipped paused enrolments but
-- never asked whether the pathway was still open, so switching pathway_diabetes_care off after enrolment would not have stopped it adding
-- eye, foot and kidney due dates. Live today: 0 enrolments and 0 milestones, so nothing was written; this closes the gap before there is any.
--
-- The loop's existing line `continue when private.pathway_enrolment_paused(e.id);` gains the same guard test the review sweep uses:
-- private.go_live_open_patient(<the pathway's guard key>, patient), open for a test patient or when the guard is on.
-- Patched in place from the live definition (no rewrite of the body), asserting the line was found exactly once.

do $$
declare
  v_def text := pg_get_functiondef('public.sweep_pathway_scheduled_tests()'::regprocedure);
  v_old constant text := 'continue when private.pathway_enrolment_paused(e.id);';
  v_new constant text := 'continue when private.pathway_enrolment_paused(e.id) or not private.go_live_open_patient((private.pathway_def_for_programme(e.programme_id)).guard_key, e.patient_id);';
  v_patched text;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'S62 tests sweep: expected the paused-enrolment line exactly once, the live definition has changed';
  end if;
  v_patched := replace(v_def, v_old, v_new);
  execute v_patched;

  if pg_get_functiondef('public.sweep_pathway_scheduled_tests()'::regprocedure) not like '%go_live_open_patient%' then
    raise exception 'S62 tests sweep: the guard check did not land';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.sweep_pathway_scheduled_tests()'::regprocedure) then
    raise exception 'S62 tests sweep: lost SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.sweep_pathway_scheduled_tests()', 'EXECUTE') then
    raise exception 'S62 tests sweep: anon can execute it';
  end if;
end $$;
