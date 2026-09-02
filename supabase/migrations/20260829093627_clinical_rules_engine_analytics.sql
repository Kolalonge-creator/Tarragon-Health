-- Tarragon Health — Clinical Rules & Care Protocol Engine, part 5/6:
-- rule analytics (§32.14) and the shadow-mode readout (§32.13).
--
-- Same analyst gate, SECURITY DEFINER posture and revoke-from-public/
-- grant-to-authenticated shape as the existing analytics RPC family
-- (20260717193112_analytics_console_phase2_rpcs.sql, 20260828020801_
-- alert_analytics_rpcs.sql). These do not duplicate those: the alert RPCs
-- measure the alert INBOX (burden, ack times, resolution quality) across
-- every generator; these measure the RULES themselves -- how often each one
-- fires, how much work it creates, and how often a clinician disagrees with
-- it.
--
-- On false-positive rate. The engine does not adjudicate its own accuracy.
-- Where a rule's action produced a clinician_alert, the clinician's own
-- resolution_outcome on that alert ('false_positive' / 'true_positive' /
-- 'duplicate' / 'no_action_needed', already required documentation for
-- severity>=2 since 20260828014055) is what is counted -- so the number
-- reflects a human's judgment of the rule, not the rule's opinion of
-- itself. Actions that produced something other than an alert have no
-- equivalent human verdict yet and are reported as unadjudicated rather
-- than silently counted as correct, which would flatter every rule.

create or replace function public.analytics_clinical_rule_performance(
  p_from timestamptz default now() - interval '30 days',
  p_to   timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select jsonb_build_object('per_rule', coalesce(jsonb_agg(t order by t.execution_count desc), '[]'::jsonb))
    into v_result
  from (
    select
      e.rule_key,
      max(e.rule_version)                                                  as latest_version_seen,
      r.name,
      r.category,
      r.domain,
      r.status,
      count(*)                                                             as execution_count,
      count(*) filter (where e.mode = 'shadow')                            as shadow_execution_count,
      count(*) filter (where e.outcome = 'actions_emitted')                as fired_count,
      count(*) filter (where e.outcome = 'shadow_recorded')                as would_have_fired_count,
      count(*) filter (where e.outcome = 'population_not_matched')         as out_of_population_count,
      count(*) filter (where e.outcome = 'conditions_not_met')             as conditions_not_met_count,
      count(*) filter (where e.outcome = 'suppressed')                     as suppressed_count,
      count(*) filter (where e.outcome = 'superseded')                     as superseded_count,
      count(*) filter (where e.outcome = 'error')                          as error_count,
      coalesce(a.action_count, 0)                                          as action_count,
      coalesce(a.override_count, 0)                                        as override_count,
      -- Override rate is over ACTIONS THAT REALLY HAPPENED. Dividing by all
      -- actions would let a rule sitting in shadow, which no clinician can
      -- possibly have overridden, report a flattering 0%.
      case when coalesce(a.emitted_count, 0) = 0 then null
           else round(coalesce(a.override_count, 0)::numeric * 100 / a.emitted_count, 1)
      end                                                                  as override_rate_pct,
      coalesce(a.adjudicated_count, 0)                                     as adjudicated_count,
      coalesce(a.false_positive_count, 0)                                  as false_positive_count,
      case when coalesce(a.adjudicated_count, 0) = 0 then null
           else round(coalesce(a.false_positive_count, 0)::numeric * 100 / a.adjudicated_count, 1)
      end                                                                  as false_positive_rate_pct,
      -- Clinician acceptance: of the actions a clinician has actually
      -- adjudicated, the share they neither overrode nor called a false
      -- positive. Null (not 100) when nothing has been adjudicated yet.
      case when coalesce(a.adjudicated_count, 0) = 0 then null
           else round(
             (a.adjudicated_count - coalesce(a.false_positive_count, 0) - coalesce(a.override_count, 0))::numeric
               * 100 / a.adjudicated_count, 1)
      end                                                                  as acceptance_rate_pct
    from public.clinical_rule_executions e
    left join lateral (
      select
        count(*)                                                     as action_count,
        count(*) filter (where ar.status = 'emitted')                as emitted_count,
        count(*) filter (where ar.clinician_override)                as override_count,
        count(*) filter (where ca.resolution_outcome is not null)    as adjudicated_count,
        count(*) filter (where ca.resolution_outcome = 'false_positive') as false_positive_count
      from public.clinical_rule_action_records ar
      left join public.clinician_alerts ca
        on ar.produced_table = 'clinician_alerts' and ca.id = ar.produced_id
      where ar.rule_key = e.rule_key
        and ar.created_at >= p_from and ar.created_at < p_to
    ) a on true
    join public.clinical_rules r
      on r.id = e.rule_id
    where e.evaluated_at >= p_from and e.evaluated_at < p_to
    group by e.rule_key, r.name, r.category, r.domain, r.status,
             a.action_count, a.emitted_count, a.override_count,
             a.adjudicated_count, a.false_positive_count
  ) t;

  return coalesce(v_result, jsonb_build_object('per_rule', '[]'::jsonb)) || jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'queue', (
      select jsonb_build_object(
        'pending',   count(*) filter (where status = 'pending'),
        'failed',    count(*) filter (where status = 'failed'),
        'processed', count(*) filter (where status = 'processed')
      )
      from public.clinical_rule_events
      where occurred_at >= p_from and occurred_at < p_to
    ),
    'awaiting_clinician_oversight', (
      select count(*) from public.clinical_rule_action_records
      where status = 'awaiting_oversight'
    )
  );
end;
$$;

comment on function public.analytics_clinical_rule_performance(timestamptz, timestamptz) is
  '§32.14 rule analytics: execution count, action count, false-positive rate, override rate and clinician acceptance per rule_key, plus queue health and the oversight backlog. Rates are null rather than 0 or 100 when nothing has been adjudicated, so an unmeasured rule is visibly unmeasured instead of looking perfect.';

revoke all on function public.analytics_clinical_rule_performance(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_clinical_rule_performance(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- §32.13 — shadow readout: what would this rule have done?
-- ---------------------------------------------------------------------------

create or replace function public.clinical_rule_shadow_report(
  p_rule_key text,
  p_from     timestamptz default now() - interval '30 days',
  p_to       timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule   public.clinical_rules;
  v_result jsonb;
begin
  select * into v_rule
    from public.clinical_rules
    where rule_key = p_rule_key and status = 'shadow'
    limit 1;

  if v_rule is null then
    select * into v_rule
      from public.clinical_rules where rule_key = p_rule_key
      order by version desc limit 1;
  end if;
  if v_rule is null then
    raise exception 'unknown clinical rule %', p_rule_key;
  end if;

  -- Same entitlement check the SELECT policy applies to the rule itself: a
  -- platform-wide rule is readable by any authenticated user, anything
  -- tenant-scoped only by that tenant's staff.
  if v_rule.organisation_id is not null and not private.is_org_staff(v_rule.organisation_id) then
    raise exception 'not authorised for this rule';
  end if;

  select jsonb_build_object(
    'rule_key',            v_rule.rule_key,
    'version',             v_rule.version,
    'status',              v_rule.status,
    'window',              jsonb_build_object('from', p_from, 'to', p_to),
    'events_considered',   count(*),
    'would_have_fired',    count(*) filter (where e.outcome = 'shadow_recorded'),
    'conditions_not_met',  count(*) filter (where e.outcome = 'conditions_not_met'),
    'out_of_population',   count(*) filter (where e.outcome = 'population_not_matched'),
    'suppressed',          count(*) filter (where e.outcome = 'suppressed'),
    'errors',              count(*) filter (where e.outcome = 'error'),
    'distinct_patients_affected',
      count(distinct e.patient_id) filter (where e.outcome = 'shadow_recorded'),
    -- The number governance actually argues about: how much work would this
    -- rule have made, per patient, per week.
    'actions_per_patient_per_week',
      case when count(distinct e.patient_id) filter (where e.outcome = 'shadow_recorded') = 0
             or extract(epoch from (p_to - p_from)) <= 0
        then null
        else round(
          count(*) filter (where e.outcome = 'shadow_recorded')::numeric
          / count(distinct e.patient_id) filter (where e.outcome = 'shadow_recorded')
          / greatest(extract(epoch from (p_to - p_from)) / 604800.0, 0.001), 2)
      end,
    'sample_explanations', (
      select coalesce(jsonb_agg(x.explanation), '[]'::jsonb)
      from (
        select se.explanation
        from public.clinical_rule_executions se
        where se.rule_key = p_rule_key
          and se.outcome = 'shadow_recorded'
          and se.evaluated_at >= p_from and se.evaluated_at < p_to
        order by se.evaluated_at desc
        limit 5
      ) x
    )
  ) into v_result
  from public.clinical_rule_executions e
  where e.rule_key = p_rule_key
    and e.evaluated_at >= p_from and e.evaluated_at < p_to;

  return v_result;
end;
$$;

comment on function public.clinical_rule_shadow_report(text, timestamptz, timestamptz) is
  '§32.13. What a shadow rule WOULD have done over a window -- volume, distinct patients, actions per patient per week, and five real worked explanations. The validate step between "new rule" and "activate": a rule whose shadow readout shows an unworkable action volume never reaches a patient.';

revoke all on function public.clinical_rule_shadow_report(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.clinical_rule_shadow_report(text, timestamptz, timestamptz) to authenticated;
