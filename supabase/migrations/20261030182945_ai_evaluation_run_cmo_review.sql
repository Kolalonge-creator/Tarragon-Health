-- AI evaluation run review by the Chief Medical Officer (the guardrail and knowledge-source halves are
-- 20261030161138_ai_guardrail_cmo_signoff and 20261030170944_ai_knowledge_source_cmo_signoff).
-- Live on 2026-10-30: 0 of the 77 ai_evaluation_runs rows carry a reviewer, no function records one, and any admin could write
-- reviewed_by directly. private.go_live_conditions_assistant counts a passing AI-001 safety or red-team run with reviewed_by set as
-- "a person looked at the result", so that column must mean exactly that.
-- 1. public.review_ai_evaluation_run(run id, expected outcome, note): only an active CMO. The caller states the outcome they read
--    (pass, fail or needs_review); if the run's outcome differs, nothing is stamped, so a rescore after the page loaded cannot be signed
--    unseen. Only a completed run with an outcome can be reviewed, once. It stamps reviewed_by (their clinical_staff id, the value the
--    FK and the existing paired check expect) and reviewed_at, and writes an audit row that keeps the system, suite, outcome and counts.
--    Reviewing records that a person read the result; it never changes the outcome and a fail stays a fail.
-- 2. A trigger makes that function the only way to record a review (no pre-reviewed insert, no direct write of the review columns,
--    admins included) and clears a review when the result it covered changes afterwards (outcome, counts, completion time, suite, system,
--    environment, model).
-- It reviews nothing itself.
create or replace function private.guard_ai_evaluation_run_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.ai_evaluation_review', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'an AI evaluation run review can only be recorded by review_ai_evaluation_run' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.reviewed_by, new.reviewed_at) is distinct from (old.reviewed_by, old.reviewed_at) then
    raise exception 'an AI evaluation run review can only be recorded by review_ai_evaluation_run' using errcode = '42501';
  end if;
  if old.reviewed_at is not null
     and (new.outcome, new.total_cases, new.passed_cases, new.failed_cases, new.completed_at, new.suite_id, new.ai_system_id, new.environment, new.model_identifier)
         is distinct from (old.outcome, old.total_cases, old.passed_cases, old.failed_cases, old.completed_at, old.suite_id, old.ai_system_id, old.environment, old.model_identifier) then
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end $$;

revoke all on function private.guard_ai_evaluation_run_review() from public, anon;

-- named to sort after ai_evaluation_runs_score_on_completion, so a rescore on completion is already in new.* when this compares
drop trigger if exists ai_evaluation_runs_validate_review on public.ai_evaluation_runs;
create trigger ai_evaluation_runs_validate_review
  before insert or update on public.ai_evaluation_runs
  for each row execute function private.guard_ai_evaluation_run_review();

create or replace function public.review_ai_evaluation_run(p_run_id uuid, p_expected_outcome text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_staff uuid;
  v_org uuid;
  r public.ai_evaluation_runs%rowtype;
  v_system text;
  v_suite text;
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select cs.id, cs.organisation_id into v_staff, v_org
    from public.clinical_staff cs
   where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
   order by cs.created_at
   limit 1;
  if v_staff is null then
    raise exception 'only the active Chief Medical Officer can review an AI evaluation run' using errcode = '42501';
  end if;

  select * into r from public.ai_evaluation_runs where id = p_run_id for update;
  if not found then raise exception 'no such evaluation run' using errcode = '22023'; end if;
  if r.completed_at is null or r.outcome is null then
    raise exception 'that evaluation run has not finished, so there is no result to review' using errcode = '22023';
  end if;
  if r.reviewed_at is not null then
    raise exception 'that evaluation run has already been reviewed' using errcode = '22023';
  end if;
  if p_expected_outcome is distinct from r.outcome::text then
    raise exception 'that run''s outcome is %, not %: reload the result and try again', r.outcome, coalesce(p_expected_outcome, 'null') using errcode = '22023';
  end if;

  select s.system_code into v_system from public.ai_systems s where s.id = r.ai_system_id;
  select su.name into v_suite from public.ai_evaluation_suites su where su.id = r.suite_id;

  perform set_config('app.ai_evaluation_review', 'on', true);
  update public.ai_evaluation_runs set reviewed_by = v_staff, reviewed_at = now() where id = r.id;
  perform set_config('app.ai_evaluation_review', '', true);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)), v_actor,
          'ai_evaluation_run.reviewed', 'ai_evaluation_runs', r.id,
          jsonb_build_object('system_code', v_system, 'suite', v_suite, 'environment', r.environment,
                             'model_identifier', r.model_identifier, 'outcome', r.outcome,
                             'total_cases', r.total_cases, 'passed_cases', r.passed_cases, 'failed_cases', r.failed_cases,
                             'pass_rate_pct', r.pass_rate_pct, 'completed_at', r.completed_at,
                             'signed_by_clinical_staff', v_staff, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;

comment on function public.review_ai_evaluation_run(uuid, text, text) is
  'Chief Medical Officer only. Records that the CMO read the result of a finished AI evaluation run (reviewed_by, reviewed_at, one audit_log row). Never changes the outcome. The caller states the outcome they read; a different current outcome refuses.';

revoke all on function public.review_ai_evaluation_run(uuid, text, text) from public;
revoke all on function public.review_ai_evaluation_run(uuid, text, text) from anon;
grant execute on function public.review_ai_evaluation_run(uuid, text, text) to authenticated;

do $$ begin
  if has_function_privilege('anon', 'public.review_ai_evaluation_run(uuid, text, text)', 'EXECUTE') then
    raise exception 'anon can execute review_ai_evaluation_run';
  end if;
end $$;
