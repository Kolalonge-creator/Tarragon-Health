-- Tarragon Health — AI Governance: make the evaluation release gate mean
-- something.
--
-- THE BUG. `private.ai_acceptance_criteria()`'s `monitoring` criterion asks
-- only whether a required-for-release evaluation suite EXISTS:
--
--     exists (select 1 from ai_evaluation_suites e
--             where e.is_active and e.is_required_for_release and ...)
--
-- It never looks at whether that suite's latest run passed. So a system can
-- show every acceptance criterion satisfied — a green row on the console a
-- Clinical Director uses to decide whether it should keep running — while its
-- blocking suites are failing.
--
-- That is not hypothetical. Measured live on 2026-09-16, AI-001 (the AI
-- Coach, high risk, clinically meaningful, is_enabled, serving patients) had
-- two of its four required suites failing against a 100% threshold:
--
--     AI Coach clinical accuracy                   6/8   75%   fail
--     AI Coach fairness across Nigerian populations 2/4   50%   fail
--     AI Coach red-team                            7/7  100%   pass
--     AI-001 Safety & Scope Guardrail Eval       30/30  100%   pass
--
-- Nothing on the dashboard, in the acceptance criteria, or anywhere else said
-- so. The gate was decorative.
--
-- WHAT THIS DOES, AND DELIBERATELY DOES NOT DO. It adds an
-- `evaluation_passing` criterion and a per-suite breakdown, and counts live
-- systems with a failing required suite on the dashboard's monitoring tile.
-- It does NOT block the runtime. Two reasons, and the second is the one that
-- matters: a runtime block would take the coach offline this instant on the
-- strength of two failures that are both in the SAFE direction (the model
-- over-triaged: it answered `emergency` where the label said
-- `clinician_review`, and `clinician_review` where the label said `routine`)
-- — a worse outcome for patients than the failures themselves. And whether a
-- failing suite should stop a live system is a clinical-governance decision
-- with a human's name on it, which is exactly what the kill switch already
-- is. This makes the decision visible and informed; it does not make it
-- automatically.
--
-- A suite that has NEVER run is reported separately from one that ran and
-- failed. They are different problems — "nobody has checked" versus "we
-- checked and it is wrong" — and collapsing them would hide the second behind
-- the first. Measured on the live project the moment this landed, that
-- distinction is the whole value of the change: all fifteen systems report
-- evaluation_passing = false, but exactly one (AI-001) does so because a
-- suite ran and failed, while the other fourteen do so only because the
-- platform-wide safety baseline has never been run against them. A single
-- boolean would have flattened those into one uninformative red column, which
-- is why the per-suite `evaluations` breakdown and the two separate dashboard
-- counters exist.

create or replace function private.ai_required_evaluation_status(p_system_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.name), '[]'::jsonb)
  from (
    select
      e.id                        as suite_id,
      e.name,
      e.kind::text                as kind,
      case when e.ai_system_id is null then 'platform' else 'system' end as scope,
      e.pass_threshold_pct,
      r.outcome::text             as latest_outcome,
      r.started_at                as latest_run_at,
      r.pass_rate_pct             as latest_pass_rate_pct,
      r.reviewed_at is not null   as latest_run_reviewed
    from public.ai_evaluation_suites e
    left join lateral (
      select rr.*
      from public.ai_evaluation_runs rr
      where rr.suite_id = e.id
        -- A platform-wide suite is scored per system, so a run of it only
        -- counts towards this system if it was run against this system.
        and (e.ai_system_id is not null or rr.ai_system_id = p_system_id)
      order by rr.started_at desc
      limit 1
    ) r on true
    where e.is_active
      and e.is_required_for_release
      and (e.ai_system_id = p_system_id or e.ai_system_id is null)
  ) x
$$;

comment on function private.ai_required_evaluation_status(uuid) is
  'Every active required-for-release evaluation suite that applies to one AI system, with the outcome of its most recent run (null when it has never run). Feeds the evaluation_passing acceptance criterion.';

create or replace function private.ai_acceptance_criteria(p_system_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  s            record;
  v_validation boolean;
  v_guardrails boolean;
  v_monitoring boolean;
  v_evals      jsonb;
  v_passing    boolean;
  v_criteria   jsonb;
begin
  select * into s from public.ai_systems where id = p_system_id;
  if s.id is null then
    return null;
  end if;

  select exists (
    select 1 from public.ai_system_versions v
    where v.ai_system_id = p_system_id and v.approved_at is not null and v.retired_at is null
  ) into v_validation;

  select exists (
    select 1 from public.ai_guardrails g
    where g.ai_system_id = p_system_id and g.is_active
  ) into v_guardrails;

  select (
    exists (
      select 1 from public.ai_evaluation_suites e
      where e.is_active and e.is_required_for_release
        and (e.ai_system_id = p_system_id or e.ai_system_id is null)
    )
    and s.next_review_due is not null
  ) into v_monitoring;

  v_evals := private.ai_required_evaluation_status(p_system_id);

  -- Passing means: there is at least one required suite, and every one of
  -- them has a most-recent run that passed. A suite that has never run is not
  -- passing — "nobody has checked" cannot satisfy a gate that exists to make
  -- someone check. `needs_review` is likewise not a pass.
  v_passing := jsonb_array_length(v_evals) > 0
    and not exists (
      select 1 from jsonb_array_elements(v_evals) as e(v)
      where coalesce(e.v->>'latest_outcome', '') <> 'pass'
    );

  v_criteria := jsonb_build_object(
    'purpose',             btrim(coalesce(s.purpose, '')) <> '',
    'owner',               btrim(coalesce(s.owner_role, '')) <> '',
    'risk_classification', s.risk_class is not null and s.autonomy_level is not null,
    'validation',          v_validation,
    'guardrails',          v_guardrails,
    'monitoring',          v_monitoring,
    'evaluation_passing',  v_passing,
    'audit',               btrim(coalesce(s.code_reference, '')) <> '',
    'rollback',            btrim(coalesce(s.fallback_behaviour, '')) <> ''
  );

  return jsonb_build_object(
    'system_id', p_system_id,
    'system_code', s.system_code,
    'criteria', v_criteria,
    'satisfied', not exists (
      select 1 from jsonb_each(v_criteria) as c(k, v) where c.v = 'false'::jsonb
    ),
    'outstanding', coalesce(
      (select jsonb_agg(c.k order by c.k) from jsonb_each(v_criteria) as c(k, v) where c.v = 'false'::jsonb),
      '[]'::jsonb
    ),
    -- The detail behind evaluation_passing, so the console can say WHICH
    -- suite is failing rather than only that something is. Without this the
    -- criterion would be a single red dot on every system, since one
    -- platform-wide required suite has never been run.
    'evaluations', v_evals,
    'owner_assigned', s.owner_profile_id is not null,
    'grandfathered', s.grandfathered_at is not null
  );
end;
$$;

-- The dashboard tile. `systems_live_with_failing_evaluations` counts only
-- suites that ran and failed — a real, checked, wrong result on a system that
-- is switched on. Never-run suites are counted separately: they are a
-- backlog, not a finding, and mixing them would have buried AI-001's two
-- genuine failures among fourteen systems that have simply never been tested.
create or replace function public.ai_governance_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_since timestamptz;
  v_org   uuid := private.current_org_id();
  v_all   boolean := private.is_admin();
begin
  if not private.is_org_staff(v_org) then
    raise exception 'not authorised: the AI governance dashboard is staff-only';
  end if;

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'p_days must be between 1 and 365';
  end if;

  v_since := now() - make_interval(days => p_days);

  return jsonb_build_object(
    'window_days', p_days,
    'since', v_since,
    'scope', case when v_all then 'platform' else 'organisation' end,
    'totals', (
      select jsonb_build_object(
        'interactions', count(*),
        'escalations', count(*) filter (where safety_classification in ('urgent_escalation', 'emergency')),
        'human_overrides', count(*) filter (where human_override),
        'high_risk_outputs', count(*) filter (where cardinality(output_flags) > 0),
        'flagged_for_review', count(*) filter (where flagged_for_review),
        'blocked_by_guardrail', count(*) filter (where status = 'blocked'),
        'fallbacks', count(*) filter (where fallback_used),
        'failures', count(*) filter (where status = 'failed')
      )
      from public.ai_interaction_log l
      where l.created_at >= v_since and (v_all or l.organisation_id = v_org)
    ),
    'incidents', (
      select jsonb_build_object(
        'total', count(*),
        'open', count(*) filter (where status in ('open', 'triaged', 'investigating')),
        'critical_open', count(*) filter (where status in ('open', 'triaged', 'investigating') and severity = 'critical'),
        'with_patient_harm', count(*) filter (where patient_harm_occurred)
      )
      from public.ai_safety_incidents i
      where i.created_at >= v_since and (v_all or i.organisation_id = v_org)
    ),
    'monitoring', jsonb_build_object(
      'unacknowledged_model_changes', (
        select count(*) from public.ai_vendor_model_observations
        where not is_expected and acknowledged_at is null
      ),
      'drift_breaches', (
        select count(*) from public.ai_drift_observations d
        where d.breached and d.observed_on >= (v_since at time zone 'UTC')::date
          and (v_all or d.organisation_id = v_org)
      ),
      'material_disparities', (
        select count(*) from public.ai_bias_assessments b
        where b.is_material_disparity and b.assessed_on >= (v_since at time zone 'UTC')::date
          and (v_all or b.organisation_id = v_org)
      ),
      'systems_overdue_review', (
        select count(*) from public.ai_systems
        where next_review_due is not null and next_review_due < current_date
      ),
      'systems_live_with_failing_evaluations', (
        select count(*) from public.ai_systems s
        where s.is_enabled
          and exists (
            select 1 from jsonb_array_elements(private.ai_required_evaluation_status(s.id)) as e(v)
            where e.v->>'latest_outcome' = 'fail'
          )
      ),
      'systems_live_with_unrun_evaluations', (
        select count(*) from public.ai_systems s
        where s.is_enabled
          and exists (
            select 1 from jsonb_array_elements(private.ai_required_evaluation_status(s.id)) as e(v)
            where e.v->>'latest_outcome' is null
          )
      )
    ),
    'systems', coalesce((
      select jsonb_agg(row_to_json(x) order by x.system_code)
      from (
        select
          s.system_code,
          s.name,
          s.risk_class::text          as risk_class,
          s.autonomy_level::text      as autonomy_level,
          s.lifecycle_status::text    as lifecycle_status,
          s.is_enabled,
          s.grandfathered_at is not null as grandfathered,
          s.next_review_due,
          (
            select v.version from public.ai_system_versions v
            where v.ai_system_id = s.id and v.approved_at is not null and v.retired_at is null
            order by v.deployed_at desc nulls last, v.approved_at desc limit 1
          ) as approved_version,
          (
            select pv.version from public.ai_prompt_versions pv
            where pv.ai_system_id = s.id and pv.is_active limit 1
          ) as active_prompt_version,
          coalesce((
            select count(*) from public.ai_interaction_log l
            where l.ai_system_id = s.id and l.created_at >= v_since
              and (v_all or l.organisation_id = v_org)
          ), 0) as interactions,
          coalesce((
            select count(*) from public.ai_interaction_log l
            where l.ai_system_id = s.id and l.created_at >= v_since and l.human_override
              and (v_all or l.organisation_id = v_org)
          ), 0) as human_overrides,
          coalesce((
            select count(*) from public.ai_safety_incidents i
            where i.ai_system_id = s.id and i.created_at >= v_since
              and (v_all or i.organisation_id = v_org)
          ), 0) as incidents,
          private.ai_acceptance_criteria(s.id) as acceptance
        from public.ai_systems s
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

do $chk$
declare
  v_ai001   uuid;
  v_accept  jsonb;
  v_fails   int;
begin
  select id into v_ai001 from public.ai_systems where system_code = 'AI-001';
  if v_ai001 is null then
    raise exception 'AI-001 is missing — this migration assumes the registry is populated';
  end if;

  v_accept := private.ai_acceptance_criteria(v_ai001);

  if v_accept->'criteria'->'evaluation_passing' is null then
    raise exception 'evaluation_passing was not added to the acceptance criteria';
  end if;

  if jsonb_array_length(v_accept->'evaluations') = 0 then
    raise exception 'AI-001 reports no required evaluation suites, but it has four';
  end if;

  -- The assertion that proves this is not merely compiling: AI-001 has
  -- genuinely failing required suites as at this migration, so the new
  -- criterion must be reporting false. If a future session makes those suites
  -- pass, this assertion is the thing to update — and updating it should be a
  -- deliberate act, not a silent one.
  select count(*) into v_fails
    from jsonb_array_elements(v_accept->'evaluations') as e(v)
    where e.v->>'latest_outcome' = 'fail';

  if v_fails = 0 then
    raise notice 'AI-001 has no failing required suites — good, but verify the criterion still discriminates';
  elsif (v_accept->'criteria'->>'evaluation_passing')::boolean then
    raise exception 'AI-001 has % failing required suites but evaluation_passing says true', v_fails;
  end if;

  if not (v_accept->'outstanding' ? 'evaluation_passing') and not (v_accept->'criteria'->>'evaluation_passing')::boolean then
    raise exception 'evaluation_passing is false but does not appear in the outstanding list';
  end if;
end;
$chk$;
