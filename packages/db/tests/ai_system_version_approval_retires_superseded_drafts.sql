-- Proves 20260925014357_ai_system_version_approval_retires_superseded_drafts.sql.
--
-- Found live on AI-001 (the AI Health Coach) 2026-09-25: the Chief Medical
-- Officer's sign-off queue listed 5 versions "awaiting approval" when only
-- one was genuinely unresolved. The other four were dead drafts, each
-- superseded by a later version that itself went on to fail its own evals,
-- get fixed, pass, and get approved -- but nothing ever retired the
-- abandoned predecessor, so it sat in the queue forever looking like an
-- outstanding safety item. public.approve_ai_system_version now retires
-- every earlier, still-open (never approved, never retired) version of the
-- same ai_system when a version is approved.
--
-- Two things checked, both real assertions on real data built fresh here
-- (not borrowed from the populated project, so this can run in CI against a
-- clean `supabase db reset`):
--   1. An earlier draft with no approval and no evaluation runs of its own
--      is retired the moment a later version of the same system is approved.
--   2. Control: a version created AFTER the one just approved is left
--      completely alone. Without this control, a broken fix that just
--      retired "every other version" would pass check 1 just as well.
--
-- npx supabase db query --linked -f packages/db/tests/ai_system_version_approval_retires_superseded_drafts.sql

begin;

create temporary table test_result (
  label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org         uuid := '00000000-0000-0000-0000-000000000001';
  v_admin       uuid := gen_random_uuid();
  v_sys         uuid;
  v_older       uuid; -- earlier draft: never approved, must be retired
  v_approved    uuid; -- the version actually approved in this test
  v_future      uuid; -- created AFTER v_approved: must NOT be retired
  v_suite       uuid;
  v_case        uuid;
  v_run         uuid;
  v_shared_suite uuid;
  v_shared_case  uuid;
  v_blocked     boolean := false;
  v_err         text;
begin
  -- The direct-consumer org is seeded by migration 20260706084837.
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type)
    values (v_org, 'AI Governance Test Org', 'direct_consumer');
  end if;

  -- private.handle_new_user() auto-creates a profiles row on the auth.users
  -- insert below (default role), so the profiles insert must upsert rather
  -- than assume the row doesn't exist yet.
  insert into auth.users (id, email)
  values (v_admin, 'ai-retire-drafts-test-admin@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, v_org, 'admin'::public.user_role, 'AI Governance Test Admin')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role             = excluded.role,
        full_name        = excluded.full_name;

  insert into public.ai_systems
    (system_code, name, purpose, owner_role, risk_class, autonomy_level,
     clinically_meaningful, fallback_behaviour, code_reference,
     review_interval_days, next_review_due)
  values ('AI-991', 'retire-superseded-drafts probe', 'probe', 'Test owner', 'low', 'inform_only',
          false, 'probe fallback',
          'packages/db/tests/ai_system_version_approval_retires_superseded_drafts.sql',
          365, current_date + 365)
  returning id into v_sys;

  insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement)
  values (v_sys, 'probe_rule', 'output_constraint', 'probe', 'warn');

  insert into public.ai_system_versions
    (ai_system_id, version, model_identifier, intended_population, excluded_population, created_at)
  values (v_sys, 'draft-older', 'probe-model', 'probe', 'probe', now() - interval '2 days')
  returning id into v_older;

  insert into public.ai_system_versions
    (ai_system_id, version, model_identifier, intended_population, excluded_population, created_at)
  values (v_sys, 'draft-to-approve', 'probe-model', 'probe', 'probe', now() - interval '1 day')
  returning id into v_approved;

  insert into public.ai_system_versions
    (ai_system_id, version, model_identifier, intended_population, excluded_population, created_at)
  values (v_sys, 'draft-future', 'probe-model', 'probe', 'probe', now() + interval '1 day')
  returning id into v_future;

  -- Satisfy the release gate for v_approved: its own required suite...
  insert into public.ai_evaluation_suites (ai_system_id, name, kind, is_required_for_release)
  values (v_sys, 'probe required suite (retire-drafts test)', 'safety', true)
  returning id into v_suite;

  insert into public.ai_evaluation_cases (suite_id, case_code, scenario, expected_behaviour)
  values (v_suite, 'probe_case', 'probe', 'probe') returning id into v_case;

  insert into public.ai_evaluation_runs (ai_system_id, ai_system_version_id, suite_id)
  values (v_sys, v_approved, v_suite) returning id into v_run;
  insert into public.ai_evaluation_case_results (run_id, case_id, outcome)
  values (v_run, v_case, 'pass');
  update public.ai_evaluation_runs set completed_at = now() where id = v_run;

  -- ...and every shared (ai_system_id is null) required suite -- the release
  -- gate demands those too, for every system, not just this probe's own.
  for v_shared_suite in
    select s.id from public.ai_evaluation_suites s
    where s.is_active and s.is_required_for_release and s.ai_system_id is null
  loop
    insert into public.ai_evaluation_runs (ai_system_id, ai_system_version_id, suite_id)
    values (v_sys, v_approved, v_shared_suite) returning id into v_run;

    for v_shared_case in select c.id from public.ai_evaluation_cases c where c.suite_id = v_shared_suite loop
      insert into public.ai_evaluation_case_results (run_id, case_id, outcome)
      values (v_run, v_shared_case, 'pass');
    end loop;

    update public.ai_evaluation_runs set completed_at = now() where id = v_run;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  begin
    perform public.approve_ai_system_version(v_approved, 'Test: approving, expect the older draft retired.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values ('setup: the approval itself succeeds',
    case when not v_blocked then 'PASS' else 'FAIL' end,
    coalesce(v_err, 'approved'));

  insert into test_result values ('an earlier never-approved draft is retired by the approval',
    case when (select retired_at from public.ai_system_versions where id = v_older) is not null
         then 'PASS' else 'FAIL' end,
    format('draft-older retired_at=%s',
           (select retired_at from public.ai_system_versions where id = v_older)));

  insert into test_result values ('control: a version created AFTER the approved one is left untouched',
    case when (select retired_at from public.ai_system_versions where id = v_future) is null
         then 'PASS' else 'FAIL' end,
    format('draft-future retired_at=%s (must stay null -- it is not a superseded draft)',
           (select retired_at from public.ai_system_versions where id = v_future)));
end;
$$;

select label, outcome, detail from test_result order by label;

rollback;
