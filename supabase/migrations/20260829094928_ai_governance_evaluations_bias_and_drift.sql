-- see supabase/migrations/20260829100118_ai_governance_evaluations_bias_and_drift.sql
create type public.ai_evaluation_kind as enum ('safety', 'clinical', 'bias', 'performance', 'red_team');

comment on type public.ai_evaluation_kind is
  'The five evaluation stages of 40.9 (red_team being 40.10''s adversarial half of the safety stage), so a release gate can require each stage independently rather than treating "evaluated" as one boolean.';

create type public.ai_evaluation_outcome as enum ('pass', 'fail', 'needs_review');

create type public.ai_redteam_category as enum (
  'emergency_symptoms',
  'contradictory_information',
  'unusual_conditions',
  'ambiguous_questions',
  'medication_interactions',
  'vulnerable_populations',
  'safety_bypass_attempt'
);

create type public.ai_drift_kind as enum ('data_drift', 'model_drift');

comment on type public.ai_drift_kind is
  'data_drift (40.15) = the population being served has moved away from the development data. model_drift (40.16) = predictive performance is deteriorating. They need different responses, so they are different rows, not one "drift" number.';

create table public.ai_evaluation_suites (
  id                      uuid primary key default gen_random_uuid(),
  ai_system_id            uuid references public.ai_systems (id) on delete cascade,
  name                    text not null,
  kind                    public.ai_evaluation_kind not null,
  description             text,
  is_required_for_release boolean not null default true,
  pass_threshold_pct      numeric(5, 2) not null default 100.00
                            check (pass_threshold_pct >= 0 and pass_threshold_pct <= 100),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.ai_evaluation_suites is
  'A named set of evaluation cases (40.9). ai_system_id null means a shared suite every registered system is measured against. is_required_for_release + pass_threshold_pct together are the release gate part 5 enforces: a suite at 100.00 means every case must pass, which is the right threshold for a safety or red-team suite and the wrong one for a performance suite.';

comment on column public.ai_evaluation_suites.pass_threshold_pct is
  'Percentage of cases that must pass for a run to count as passing. Defaults to 100 deliberately -- a safety suite where four out of five adversarial prompts are handled correctly has not passed.';

create unique index ai_evaluation_suites_name_per_system
  on public.ai_evaluation_suites (ai_system_id, name) where ai_system_id is not null;
create unique index ai_evaluation_suites_shared_name
  on public.ai_evaluation_suites (name) where ai_system_id is null;

create trigger ai_evaluation_suites_set_updated_at
  before update on public.ai_evaluation_suites
  for each row execute function private.set_updated_at();

alter table public.ai_evaluation_suites enable row level security;

create policy ai_evaluation_suites_select on public.ai_evaluation_suites
  for select to authenticated using (private.is_org_staff(private.current_org_id()));
create policy ai_evaluation_suites_write on public.ai_evaluation_suites
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_evaluation_suites to authenticated;

create table public.ai_evaluation_cases (
  id                 uuid primary key default gen_random_uuid(),
  suite_id           uuid not null references public.ai_evaluation_suites (id) on delete cascade,
  case_code          text not null check (case_code ~ '^[a-z0-9_]+$'),
  scenario           text not null,
  expected_behaviour text not null,
  is_adversarial     boolean not null default false,
  redteam_category   public.ai_redteam_category,
  population_group   text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ai_evaluation_cases_unique_code unique (suite_id, case_code),
  constraint ai_evaluation_cases_redteam_paired
    check (is_adversarial = (redteam_category is not null))
);

comment on table public.ai_evaluation_cases is
  'One test scenario and the behaviour expected of the AI (40.9''s test dataset; 40.10''s adversarial scenarios when is_adversarial). expected_behaviour is prose, not a string match: these are judged by a reviewer, and writing them as assertions would quietly narrow the evaluation to what is cheap to automate.';

comment on column public.ai_evaluation_cases.population_group is
  'For bias-suite cases: which population group this case represents (40.14). Free text on purpose -- the groups that matter in Nigeria (geopolitical zone, urban/rural, state) are not a fixed list and will grow as coverage does.';

create index ai_evaluation_cases_suite_idx on public.ai_evaluation_cases (suite_id);
create index ai_evaluation_cases_redteam_idx on public.ai_evaluation_cases (redteam_category)
  where redteam_category is not null;

create trigger ai_evaluation_cases_set_updated_at
  before update on public.ai_evaluation_cases
  for each row execute function private.set_updated_at();

alter table public.ai_evaluation_cases enable row level security;

create policy ai_evaluation_cases_select on public.ai_evaluation_cases
  for select to authenticated using (private.is_org_staff(private.current_org_id()));
create policy ai_evaluation_cases_write on public.ai_evaluation_cases
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_evaluation_cases to authenticated;

create table public.ai_evaluation_runs (
  id                   uuid primary key default gen_random_uuid(),
  ai_system_id         uuid not null references public.ai_systems (id) on delete cascade,
  ai_system_version_id uuid references public.ai_system_versions (id) on delete set null,
  prompt_version_id    uuid references public.ai_prompt_versions (id) on delete set null,
  suite_id             uuid not null references public.ai_evaluation_suites (id) on delete restrict,
  environment          text not null default 'evaluation'
                         check (environment in ('evaluation', 'staging', 'production_shadow')),
  model_identifier     text,
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  total_cases          integer not null default 0 check (total_cases >= 0),
  passed_cases         integer not null default 0 check (passed_cases >= 0),
  failed_cases         integer not null default 0 check (failed_cases >= 0),
  outcome              public.ai_evaluation_outcome,
  run_by               uuid references public.profiles (id) on delete set null,
  reviewed_by          uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at          timestamptz,
  notes                text,

  constraint ai_evaluation_runs_review_paired check ((reviewed_by is null) = (reviewed_at is null)),
  constraint ai_evaluation_runs_counts_add_up check (passed_cases + failed_cases <= total_cases),
  constraint ai_evaluation_runs_outcome_requires_completion
    check (outcome is null or completed_at is not null)
);

comment on table public.ai_evaluation_runs is
  'One execution of one evaluation suite against one AI system version (40.9). The release gate in part 5 reads these: a version is approvable only when every active, required suite for its system has a completed run against that version with outcome = pass.';

alter table public.ai_evaluation_runs
  add column pass_rate_pct numeric(5, 2)
  generated always as (
    case when total_cases = 0 then null
         else round((passed_cases::numeric * 100) / total_cases, 2)
    end
  ) stored;

comment on column public.ai_evaluation_runs.pass_rate_pct is
  'Generated: passed_cases as a percentage of total_cases, null for an empty run. Generated rather than computed in the app so the release gate and the governance dashboard cannot drift apart.';

create index ai_evaluation_runs_system_idx on public.ai_evaluation_runs (ai_system_id, started_at desc);
create index ai_evaluation_runs_version_idx on public.ai_evaluation_runs (ai_system_version_id, suite_id)
  where ai_system_version_id is not null;

alter table public.ai_evaluation_runs enable row level security;

create policy ai_evaluation_runs_select on public.ai_evaluation_runs
  for select to authenticated using (private.is_org_staff(private.current_org_id()));
create policy ai_evaluation_runs_write on public.ai_evaluation_runs
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_evaluation_runs to authenticated;

create table public.ai_evaluation_case_results (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.ai_evaluation_runs (id) on delete cascade,
  case_id        uuid not null references public.ai_evaluation_cases (id) on delete restrict,
  outcome        public.ai_evaluation_outcome not null,
  actual_output  text,
  reviewer_notes text,
  reviewed_by    uuid references public.clinical_staff (id) on delete restrict,
  created_at     timestamptz not null default now(),

  constraint ai_evaluation_case_results_unique unique (run_id, case_id)
);

comment on table public.ai_evaluation_case_results is
  'Per-case result within an evaluation run. ON DELETE RESTRICT against the case deliberately: deleting a case that a real run was scored against would silently rewrite that run''s history.';

create index ai_evaluation_case_results_run_idx on public.ai_evaluation_case_results (run_id);

alter table public.ai_evaluation_case_results enable row level security;

create policy ai_evaluation_case_results_select on public.ai_evaluation_case_results
  for select to authenticated using (private.is_org_staff(private.current_org_id()));
create policy ai_evaluation_case_results_write on public.ai_evaluation_case_results
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_evaluation_case_results to authenticated;

create or replace function private.recount_ai_evaluation_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run       uuid := coalesce(new.run_id, old.run_id);
  v_total     integer;
  v_passed    integer;
  v_failed    integer;
  v_review    integer;
  v_threshold numeric;
begin
  select count(*),
         count(*) filter (where outcome = 'pass'),
         count(*) filter (where outcome = 'fail'),
         count(*) filter (where outcome = 'needs_review')
    into v_total, v_passed, v_failed, v_review
  from public.ai_evaluation_case_results
  where run_id = v_run;

  select s.pass_threshold_pct into v_threshold
  from public.ai_evaluation_runs r
  join public.ai_evaluation_suites s on s.id = r.suite_id
  where r.id = v_run;

  update public.ai_evaluation_runs
     set total_cases  = v_total,
         passed_cases = v_passed,
         failed_cases = v_failed,
         outcome = case
           when completed_at is null then outcome
           when v_total = 0 then 'needs_review'::public.ai_evaluation_outcome
           when v_review > 0 then 'needs_review'::public.ai_evaluation_outcome
           when (v_passed::numeric * 100) / v_total >= coalesce(v_threshold, 100)
             then 'pass'::public.ai_evaluation_outcome
           else 'fail'::public.ai_evaluation_outcome
         end
   where id = v_run;

  return null;
end;
$$;

comment on function private.recount_ai_evaluation_run() is
  'Recomputes a run''s case tallies and outcome from its own results against the suite threshold. A run with any case still needs_review is never scored as a pass, however good the rest of the numbers look.';

create trigger ai_evaluation_case_results_recount
  after insert or update or delete on public.ai_evaluation_case_results
  for each row execute function private.recount_ai_evaluation_run();

create or replace function private.score_ai_evaluation_run_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threshold numeric;
  v_review    integer;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  select s.pass_threshold_pct into v_threshold
  from public.ai_evaluation_suites s where s.id = new.suite_id;

  select count(*) into v_review
  from public.ai_evaluation_case_results
  where run_id = new.id and outcome = 'needs_review';

  new.outcome := case
    when new.total_cases = 0 then 'needs_review'::public.ai_evaluation_outcome
    when v_review > 0 then 'needs_review'::public.ai_evaluation_outcome
    when (new.passed_cases::numeric * 100) / new.total_cases >= coalesce(v_threshold, 100)
      then 'pass'::public.ai_evaluation_outcome
    else 'fail'::public.ai_evaluation_outcome
  end;

  return new;
end;
$$;

comment on function private.score_ai_evaluation_run_on_completion() is
  'Finalises a run''s outcome the moment completed_at is set, from the tallies the per-case trigger maintains. Together the two triggers mean nobody hand-writes an evaluation outcome.';

create trigger ai_evaluation_runs_score_on_completion
  before update on public.ai_evaluation_runs
  for each row execute function private.score_ai_evaluation_run_on_completion();

create or replace function private.ai_release_gate(p_version_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with version as (
    select v.id, v.ai_system_id from public.ai_system_versions v where v.id = p_version_id
  ),
  required as (
    select s.id, s.name, s.kind, s.pass_threshold_pct
    from public.ai_evaluation_suites s, version
    where s.is_active
      and s.is_required_for_release
      and (s.ai_system_id is null or s.ai_system_id = version.ai_system_id)
  ),
  scored as (
    select r.id, r.name, r.kind,
           (
             select run.outcome
             from public.ai_evaluation_runs run
             where run.suite_id = r.id
               and run.ai_system_version_id = p_version_id
               and run.completed_at is not null
             order by run.completed_at desc
             limit 1
           ) as latest_outcome
    from required r
  )
  select jsonb_build_object(
    'version_id', p_version_id,
    'required_suites', (select count(*) from scored),
    'passed_suites', (select count(*) from scored where latest_outcome = 'pass'),
    'version_exists', exists (select 1 from version),
    'satisfied', exists (select 1 from version)
                 and not exists (
                   select 1 from scored
                   where latest_outcome is distinct from 'pass'::public.ai_evaluation_outcome
                 ),
    'outstanding', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'suite_id', id, 'suite', name, 'kind', kind,
          'status', coalesce(latest_outcome::text, 'not_run')
        ) order by name)
        from scored where latest_outcome is distinct from 'pass'::public.ai_evaluation_outcome
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function private.ai_release_gate(uuid) is
  'The 40.9 pipeline as an enforceable check: for one AI system version, which required evaluation suites have a completed passing run against THAT version, and which do not. Returns a report, not a boolean, so a Clinical Director can see what is missing rather than just being refused. ''satisfied'' is false for an unknown version id -- an empty required-suite set must never read as "everything passed". public.approve_ai_system_version() (part 5) reads it.';

revoke all on function private.ai_release_gate(uuid) from public, anon;

create table public.ai_bias_assessments (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  ai_system_id           uuid not null references public.ai_systems (id) on delete cascade,
  ai_system_version_id   uuid references public.ai_system_versions (id) on delete set null,
  assessed_on            date not null default current_date,
  dimension              text not null,
  group_label            text not null,
  sample_size            integer not null check (sample_size >= 0),
  metric_name            text not null,
  metric_value           numeric not null,
  reference_group_label  text,
  reference_metric_value numeric,
  is_material_disparity  boolean not null default false,
  assessed_by            uuid references public.profiles (id) on delete set null,
  notes                  text,
  created_at             timestamptz not null default now(),

  constraint ai_bias_assessments_unique
    unique (organisation_id, ai_system_id, assessed_on, dimension, group_label, metric_name),
  constraint ai_bias_assessments_reference_paired
    check ((reference_group_label is null) = (reference_metric_value is null))
);

comment on table public.ai_bias_assessments is
  'Differential performance across population groups (40.14). Keyed by (dimension, group_label) rather than fixed columns because the dimensions that matter for Nigerian data -- geopolitical zone, urban/rural, state, income band, language -- are not the ones a generic model card would choose, and the set will grow. Typical dimensions: geopolitical_zone, urban_rural, state, sex, age_band, income_band, language.';

comment on column public.ai_bias_assessments.sample_size is
  'Recorded because a disparity measured on twelve patients is a different claim from one measured on twelve thousand, and the dashboard must be able to say which it is.';

alter table public.ai_bias_assessments
  add column disparity_ratio numeric
  generated always as (
    case when reference_metric_value is null or reference_metric_value = 0 then null
         else round(metric_value / reference_metric_value, 4)
    end
  ) stored;

create index ai_bias_assessments_system_idx on public.ai_bias_assessments (ai_system_id, assessed_on desc);
create index ai_bias_assessments_material_idx on public.ai_bias_assessments (assessed_on desc)
  where is_material_disparity;

alter table public.ai_bias_assessments enable row level security;

create policy ai_bias_assessments_select on public.ai_bias_assessments
  for select to authenticated using (private.is_org_staff(organisation_id));
create policy ai_bias_assessments_write on public.ai_bias_assessments
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_bias_assessments to authenticated;

create table public.ai_drift_observations (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  ai_system_id         uuid not null references public.ai_systems (id) on delete cascade,
  ai_system_version_id uuid references public.ai_system_versions (id) on delete set null,
  kind                 public.ai_drift_kind not null,
  observed_on          date not null default current_date,
  window_days          integer not null check (window_days > 0),
  feature_or_metric    text not null,
  baseline_value       numeric,
  observed_value       numeric,
  drift_score          numeric,
  threshold            numeric,
  breached             boolean not null default false,
  sample_size          integer check (sample_size is null or sample_size >= 0),
  detail               jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),

  constraint ai_drift_observations_unique
    unique (organisation_id, ai_system_id, kind, feature_or_metric, observed_on),
  constraint ai_drift_observations_breach_needs_threshold
    check (not breached or (drift_score is not null and threshold is not null))
);

comment on table public.ai_drift_observations is
  'Data drift (40.15 -- the population served has moved away from the development data) and model drift (40.16 -- predictive performance is deteriorating), one row per feature or metric per observation window. A breached row raises an automated AI safety incident, so drift surfaces on the governance dashboard rather than in a report nobody opens.';

create index ai_drift_observations_system_idx on public.ai_drift_observations (ai_system_id, observed_on desc);
create index ai_drift_observations_breached_idx on public.ai_drift_observations (observed_on desc) where breached;

alter table public.ai_drift_observations enable row level security;

create policy ai_drift_observations_select on public.ai_drift_observations
  for select to authenticated using (private.is_org_staff(organisation_id));
create policy ai_drift_observations_write on public.ai_drift_observations
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_drift_observations to authenticated;

create or replace function private.raise_ai_drift_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_risk public.ai_risk_class;
begin
  if not new.breached or (tg_op = 'UPDATE' and old.breached) then
    return new;
  end if;

  select risk_class into v_risk from public.ai_systems where id = new.ai_system_id;

  insert into public.ai_safety_incidents
    (organisation_id, ai_system_id, reporter_kind, category, severity, description)
  values (
    new.organisation_id, new.ai_system_id, 'automated_monitor',
    case new.kind when 'model_drift' then 'inappropriate_recommendation'::public.ai_incident_category
                  else 'other'::public.ai_incident_category end,
    case when v_risk in ('high', 'very_high') then 'high'::public.ai_incident_severity
         else 'moderate'::public.ai_incident_severity end,
    format(
      '%s breach on %L over a %s-day window: drift score %s against a threshold of %s (baseline %s, observed %s).',
      case new.kind when 'model_drift' then 'Model drift' else 'Data drift' end,
      new.feature_or_metric, new.window_days, new.drift_score, new.threshold,
      coalesce(new.baseline_value::text, 'n/a'), coalesce(new.observed_value::text, 'n/a')
    )
  );

  return new;
end;
$$;

comment on function private.raise_ai_drift_incident() is
  'Turns a breached drift observation into an AI safety incident (40.15/40.16 feeding 40.12), at a severity scaled to the system''s clinical risk class. Fires only on the transition into breached, so re-recording an already-breached window does not spam the incident queue.';

create trigger ai_drift_observations_raise_incident
  after insert or update on public.ai_drift_observations
  for each row execute function private.raise_ai_drift_incident();

do $$
declare
  v_sys   uuid;
  v_suite uuid;
  v_case  uuid;
  v_run   uuid;
  v_out   public.ai_evaluation_outcome;
  v_rate  numeric;
  v_org   uuid;
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('ai_evaluation_suites', 'ai_evaluation_cases', 'ai_evaluation_runs',
                          'ai_evaluation_case_results', 'ai_bias_assessments', 'ai_drift_observations')) <> 6
  then
    raise exception 'not every part-4 AI governance table was created';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ai_evaluation_suites', 'ai_evaluation_cases', 'ai_evaluation_runs',
                        'ai_evaluation_case_results', 'ai_bias_assessments', 'ai_drift_observations')
      and not c.relrowsecurity
  ) then
    raise exception 'a part-4 AI governance table was created without row level security';
  end if;

  insert into public.ai_systems
    (system_code, name, purpose, owner_role, risk_class, autonomy_level,
     clinically_meaningful, fallback_behaviour)
  values ('AI-997', 'assertion probe', 'probe', 'probe', 'low', 'inform_only', false, 'probe')
  returning id into v_sys;

  insert into public.ai_evaluation_suites (ai_system_id, name, kind)
  values (v_sys, 'probe suite', 'safety') returning id into v_suite;

  insert into public.ai_evaluation_cases (suite_id, case_code, scenario, expected_behaviour)
  values (v_suite, 'probe_case', 'probe', 'probe') returning id into v_case;

  insert into public.ai_evaluation_runs (ai_system_id, suite_id) values (v_sys, v_suite)
  returning id into v_run;

  insert into public.ai_evaluation_case_results (run_id, case_id, outcome)
  values (v_run, v_case, 'fail');

  update public.ai_evaluation_runs set completed_at = now() where id = v_run;

  select outcome, pass_rate_pct into v_out, v_rate from public.ai_evaluation_runs where id = v_run;
  if v_out <> 'fail' then
    raise exception 'a run whose only case failed scored %, not fail', v_out;
  end if;
  if v_rate <> 0 then
    raise exception 'pass_rate_pct was % for a run with zero passes', v_rate;
  end if;

  update public.ai_evaluation_case_results set outcome = 'pass' where run_id = v_run;

  select outcome into v_out from public.ai_evaluation_runs where id = v_run;
  if v_out <> 'pass' then
    raise exception 'a run whose only case passed scored %, not pass', v_out;
  end if;

  begin
    insert into public.ai_evaluation_cases (suite_id, case_code, scenario, expected_behaviour, is_adversarial)
    values (v_suite, 'probe_adversarial', 'probe', 'probe', true);
    raise exception 'ai_evaluation_cases_redteam_paired allowed an adversarial case with no red-team category';
  exception
    when check_violation then null;
  end;

  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is not null then
    begin
      insert into public.ai_drift_observations
        (organisation_id, ai_system_id, kind, window_days, feature_or_metric, breached)
      values (v_org, v_sys, 'model_drift', 30, 'probe_metric', true);
      raise exception 'ai_drift_observations_breach_needs_threshold allowed a breach with no threshold';
    exception
      when check_violation then null;
    end;
  end if;

  delete from public.ai_evaluation_case_results where run_id = v_run;
  delete from public.ai_evaluation_runs where id = v_run;
  delete from public.ai_systems where id = v_sys;

  if exists (select 1 from public.ai_systems where system_code = 'AI-997') then
    raise exception 'assertion probe row leaked into ai_systems';
  end if;
end;
$$;
