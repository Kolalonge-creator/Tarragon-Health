-- Tarragon Health — AI Governance, Safety & Model Management, part 5/6:
-- the acceptance criteria (40.20), the kill switch (40.17), the version
-- approval gate (40.9), the runtime configuration reader the TypeScript
-- layer actually calls, and the governance dashboard (40.13).
--
-- 40.20 says every AI capability should have: purpose -> owner -> risk
-- classification -> validation -> guardrails -> monitoring -> audit ->
-- rollback. private.ai_acceptance_criteria() is that sentence as a
-- machine-checkable report, and the trigger below turns it into a
-- precondition for switching a system on.
--
-- ONE DELIBERATE ASYMMETRY, and it is the important design decision in this
-- migration. Part 6 registers ten AI capabilities that are ALREADY running
-- in production, none of which has ever been through a formal evaluation.
-- Refusing to record them, or recording them as switched off, would either
-- make the registry a fiction or take live patient-facing features down to
-- satisfy paperwork. So:
--
--   * the initial registration of an already-running system is a one-off
--     GRANDFATHER: inserted enabled, with grandfathered_at stamped and its
--     outstanding acceptance criteria visible on the console rather than
--     hidden;
--   * every transition INTO enabled after that -- re-enabling after a kill
--     switch, or switching on anything new -- goes through the full gate,
--     grandfathered or not.
--
-- The practical effect is a ratchet: today's systems keep running and their
-- gaps are visible; the moment one is switched off it cannot come back
-- until its criteria are met; and nothing new ever switches on without
-- them. A client cannot forge the grandfather -- the INSERT path refuses an
-- enabled row from an 'authenticated' caller outright, so only a migration
-- can create one.
--
-- The kill switch itself is never gated on anything. Switching a system OFF
-- always works, immediately, for an admin or a Clinical Director. A safety
-- control with preconditions is not a safety control.

alter table public.ai_systems
  add column grandfathered_at timestamptz,
  add column grandfather_note text;

comment on column public.ai_systems.grandfathered_at is
  'Set only by the part-6 registration migration, for a system that was already running in production when governance was introduced. It exempts that first registration from the acceptance gate and nothing else: any later transition into enabled goes through the full gate. Its presence on a row is a standing "this has outstanding governance work", not a clean bill of health.';

-- ---------------------------------------------------------------------------
-- 40.20 acceptance criteria
-- ---------------------------------------------------------------------------

create or replace function private.ai_acceptance_criteria(p_system_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s            record;
  v_validation boolean;
  v_guardrails boolean;
  v_monitoring boolean;
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

  v_criteria := jsonb_build_object(
    'purpose',             btrim(coalesce(s.purpose, '')) <> '',
    -- The accountable FUNCTION is what gates activation; naming the current
    -- individual is surfaced separately below as owner_assigned. Requiring a
    -- named individual to switch anything on would have made this gate
    -- unsatisfiable on a solo-founder platform, which would have meant
    -- quietly dropping the gate instead.
    'owner',               btrim(coalesce(s.owner_role, '')) <> '',
    'risk_classification', s.risk_class is not null and s.autonomy_level is not null,
    'validation',          v_validation,
    'guardrails',          v_guardrails,
    'monitoring',          v_monitoring,
    -- Where the calls are made from. The audit trail is written by the
    -- runtime, not the database, so what the database can actually check is
    -- that the call sites owing it a row are named and reviewable.
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
    'owner_assigned', s.owner_profile_id is not null,
    'grandfathered', s.grandfathered_at is not null
  );
end;
$$;

comment on function private.ai_acceptance_criteria(uuid) is
  '40.20 as a machine-checkable report: purpose, owner, risk classification, validation, guardrails, monitoring, audit, rollback, each true or false for one registered AI system, plus the outstanding list. owner_assigned is reported alongside rather than inside the gate -- see the inline comment for why.';

revoke all on function private.ai_acceptance_criteria(uuid) from public, anon;

-- The gate. INSERT: an enabled row may only be created by a migration
-- registering something already running (grandfathered). UPDATE: any
-- transition into enabled needs the full criteria met.
create or replace function private.guard_ai_system_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_report jsonb;
begin
  if tg_op = 'INSERT' then
    if new.is_enabled then
      if new.grandfathered_at is null or current_user in ('authenticated', 'anon', 'authenticator') then
        raise exception 'a new AI system cannot be registered already enabled -- create it disabled and switch it on with public.set_ai_system_enabled(), which checks the 40.20 acceptance criteria';
      end if;
    end if;
    return new;
  end if;

  if new.is_enabled and not old.is_enabled then
    v_report := private.ai_acceptance_criteria(new.id);
    if not coalesce((v_report->>'satisfied')::boolean, false) then
      raise exception 'AI system % cannot be enabled: outstanding acceptance criteria %',
        new.system_code, v_report->'outstanding';
    end if;
  end if;

  return new;
end;
$$;

comment on function private.guard_ai_system_activation() is
  'Enforces the 40.20 acceptance criteria on every transition into is_enabled, and refuses an already-enabled INSERT from any client. Grandfathering (part 6) is an INSERT-time exemption only -- re-enabling a grandfathered system after a kill switch still requires the full criteria. Deliberately SECURITY INVOKER so the current_user check can tell a migration from a client.';

create trigger ai_systems_activation_gate
  before insert or update on public.ai_systems
  for each row execute function private.guard_ai_system_activation();

-- ---------------------------------------------------------------------------
-- The kill switch (40.17)
-- ---------------------------------------------------------------------------

create or replace function public.set_ai_system_enabled(
  p_id uuid,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        record;
  v_actor  uuid := (select auth.uid());
  v_staff  uuid;
  v_org    uuid;
  v_rec    uuid;
  v_report jsonb;
begin
  select * into s from public.ai_systems where id = p_id;
  if s.id is null then
    raise exception 'AI system not found';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'switching an AI system % requires a reason on the record',
      case when p_enabled then 'on' else 'off' end;
  end if;

  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = v_actor and cs.active and cs.is_clinical_director
  limit 1;

  if v_staff is null and not private.is_admin() then
    raise exception 'not authorised: only an admin or an active Clinical Director can operate the AI kill switch';
  end if;

  v_org := coalesce(v_org, (select organisation_id from public.profiles where id = v_actor));

  if p_enabled then
    -- Checked here as well as in the activation trigger, so an admin gets a
    -- readable list of what is missing rather than a bare trigger error. The
    -- trigger is still the guarantee -- this is the message.
    v_report := private.ai_acceptance_criteria(p_id);
    if not coalesce((v_report->>'satisfied')::boolean, false) then
      raise exception 'AI system % cannot be switched on yet -- outstanding acceptance criteria (40.20): %',
        s.system_code, v_report->'outstanding';
    end if;

    update public.ai_systems
       set lifecycle_status = 'live',
           is_enabled       = true,
           disabled_at      = null,
           disabled_by      = null,
           disabled_reason  = null
     where id = p_id;
  else
    update public.ai_systems
       set is_enabled       = false,
           lifecycle_status = 'suspended',
           disabled_at      = now(),
           disabled_by      = v_actor,
           disabled_reason  = p_reason
     where id = p_id;

    -- 40.17: disable -> fallback -> clinical operations notified ->
    -- investigation. The fallback is the runtime's job; telling clinical
    -- operations is this function's.
    for v_rec in
      select distinct cs.profile_id
      from public.clinical_staff cs
      where cs.active and cs.is_clinical_director and cs.profile_id is not null
      union
      select p.id from public.profiles p where p.role = 'admin'
    loop
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload,
         content_class, priority, source_table, source_id)
      values (
        v_org, v_rec, 'in_app', 'pending', 'ai_system_disabled',
        jsonb_build_object(
          'ai_system', s.name,
          'system_code', s.system_code,
          'reason', p_reason,
          'fallback', s.fallback_behaviour
        ),
        'non_clinical', 'critical', 'ai_systems', p_id
      );
    end loop;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, v_actor,
    case when p_enabled then 'ai_system.enabled' else 'ai_system.disabled' end,
    'ai_systems', p_id,
    jsonb_build_object(
      'system_code', s.system_code,
      'reason', p_reason,
      'by_clinical_staff', v_staff
    )
  );

  return private.ai_acceptance_criteria(p_id);
end;
$$;

comment on function public.set_ai_system_enabled(uuid, boolean, text) is
  'The AI kill switch (40.17). Switching OFF is never blocked by anything except authorisation -- a safety control with preconditions is not a safety control -- and pages Clinical Directors and admins with the system''s fallback behaviour so operations know what happens next. Switching ON re-checks the 40.20 acceptance criteria. A reason is mandatory in both directions.';

revoke all on function public.set_ai_system_enabled(uuid, boolean, text) from public, anon;
grant execute on function public.set_ai_system_enabled(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Version approval, gated on the evaluation pipeline (40.9)
-- ---------------------------------------------------------------------------

create or replace function public.approve_ai_system_version(
  p_version_id uuid,
  p_note text default null,
  p_deploy boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system record;
  v_gate   jsonb;
  v_staff  uuid;
  v_actor  uuid := (select auth.uid());
  v_org    uuid;
begin
  select s.id, s.system_code, s.name, s.risk_class, s.clinically_meaningful
    into v_system
  from public.ai_system_versions v
  join public.ai_systems s on s.id = v.ai_system_id
  where v.id = p_version_id;

  if v_system.id is null then
    raise exception 'AI system version not found';
  end if;

  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = v_actor and cs.active and cs.is_clinical_director
  limit 1;

  if v_system.clinically_meaningful or v_system.risk_class in ('high', 'very_high') then
    if v_staff is null then
      raise exception 'not authorised: only an active Clinical Director can approve a version of % (%), a clinically meaningful or high-risk AI system',
        v_system.name, v_system.system_code;
    end if;
  elsif v_staff is null and not private.is_admin() then
    raise exception 'not authorised: approving a version requires an admin or an active Clinical Director';
  end if;

  v_gate := private.ai_release_gate(p_version_id);

  if not coalesce((v_gate->>'satisfied')::boolean, false) then
    raise exception 'this version has not passed every required evaluation suite: %', v_gate->'outstanding';
  end if;

  update public.ai_system_versions
     set approved_by       = coalesce(approved_by, v_staff),
         approval_actor_id = coalesce(approval_actor_id, v_actor),
         approved_at       = coalesce(approved_at, now()),
         deployed_at       = case when p_deploy then coalesce(deployed_at, now()) else deployed_at end,
         change_summary    = coalesce(p_note, change_summary)
   where id = p_version_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)),
    v_actor, 'ai_system_version.approved', 'ai_system_versions', p_version_id,
    jsonb_build_object(
      'system_code', v_system.system_code,
      'signed_by_clinical_staff', v_staff,
      'release_gate', v_gate,
      'deployed', p_deploy
    )
  );

  return v_gate;
end;
$$;

comment on function public.approve_ai_system_version(uuid, text, boolean) is
  'Governance approval of an AI system version (the last arrow of 40.9''s pipeline). Refuses unless every active required evaluation suite has a completed passing run against THIS version, and requires a Clinical Director for anything clinically meaningful or high-risk. The release-gate report is written into audit_log, so what was true at approval time stays on the record.';

revoke all on function public.approve_ai_system_version(uuid, text, boolean) from public, anon;
grant execute on function public.approve_ai_system_version(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The runtime reader
-- ---------------------------------------------------------------------------

-- One round trip, because the alternative is four, per AI call. The
-- TypeScript layer caches this briefly in-process; see
-- apps/web/src/lib/ai-governance/registry.ts.
create or replace function public.ai_runtime_config(p_system_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s        record;
  v_expect text;
begin
  select * into s from public.ai_systems where system_code = p_system_code;

  if s.id is null then
    -- An unregistered system is reported as such rather than as "disabled",
    -- so the runtime can tell "governance says stop" apart from "governance
    -- has never heard of this" and treat them differently.
    return jsonb_build_object('registered', false, 'system_code', p_system_code);
  end if;

  select v.model_identifier into v_expect
  from public.ai_system_versions v
  where v.ai_system_id = s.id and v.approved_at is not null and v.retired_at is null
  order by v.deployed_at desc nulls last, v.approved_at desc
  limit 1;

  return jsonb_build_object(
    'registered', true,
    'system_code', s.system_code,
    'system_id', s.id,
    'name', s.name,
    'enabled', s.is_enabled,
    'lifecycle_status', s.lifecycle_status,
    'risk_class', s.risk_class,
    'autonomy_level', s.autonomy_level,
    'clinically_meaningful', s.clinically_meaningful,
    'fallback_behaviour', s.fallback_behaviour,
    'disabled_reason', s.disabled_reason,
    'expected_model_identifier', v_expect,
    'prompt', private.active_ai_prompt(p_system_code),
    'guardrails', private.ai_guardrails_for(p_system_code),
    'knowledge_sources', private.approved_ai_knowledge_sources(p_system_code)
  );
end;
$$;

comment on function public.ai_runtime_config(text) is
  'Everything the runtime needs about one AI system in a single round trip: kill-switch state, risk and autonomy, fallback behaviour, the governed prompt (null when none is activated -- the caller then uses its in-repo constant), active guardrails, and approved knowledge sources. Distinguishes "not registered" from "registered but disabled": the first is a wiring gap, the second is a deliberate safety decision.';

revoke all on function public.ai_runtime_config(text) from public, anon;
grant execute on function public.ai_runtime_config(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The governance dashboard (40.13)
-- ---------------------------------------------------------------------------

create or replace function public.ai_governance_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
    -- Scope note: an admin sees the platform; other staff see their own
    -- organisation. Same posture as every other cross-tenant console here.
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

comment on function public.ai_governance_dashboard(integer) is
  'The 40.13 clinical-governance view: interactions, escalations, human overrides, safety incidents and high-risk outputs over a window, plus per-system model version, status and outstanding 40.20 acceptance criteria. An admin sees the platform; other staff see their own organisation only.';

revoke all on function public.ai_governance_dashboard(integer) from public, anon;
grant execute on function public.ai_governance_dashboard(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_sys uuid;
  v_rep jsonb;
begin
  insert into public.ai_systems
    (system_code, name, purpose, owner_role, risk_class, autonomy_level,
     clinically_meaningful, fallback_behaviour)
  values ('AI-996', 'assertion probe', 'probe', 'probe', 'low', 'inform_only', false, 'probe')
  returning id into v_sys;

  v_rep := private.ai_acceptance_criteria(v_sys);

  -- A bare registration is NOT acceptance-complete: no approved version, no
  -- guardrail, no monitoring, no code reference.
  if coalesce((v_rep->>'satisfied')::boolean, true) then
    raise exception 'ai_acceptance_criteria called a bare registration satisfied';
  end if;
  if not (v_rep->'criteria'->>'purpose')::boolean then
    raise exception 'ai_acceptance_criteria failed the purpose check on a row that has a purpose';
  end if;
  if (v_rep->'criteria'->>'validation')::boolean then
    raise exception 'ai_acceptance_criteria passed validation with no approved version';
  end if;

  -- ...and the gate refuses to switch it on.
  begin
    update public.ai_systems set lifecycle_status = 'live', is_enabled = true where id = v_sys;
    raise exception 'the activation gate let an unqualified system be enabled';
  exception
    when raise_exception then
      if sqlerrm not like '%outstanding acceptance criteria%' then raise; end if;
  end;

  -- An already-enabled INSERT is refused unless it is a grandfather from a
  -- migration -- and this block IS running as a migration, so the
  -- grandfathered form must succeed while the plain form must not.
  begin
    insert into public.ai_systems
      (system_code, name, purpose, owner_role, risk_class, autonomy_level,
       clinically_meaningful, fallback_behaviour, lifecycle_status, is_enabled)
    values ('AI-995', 'probe', 'probe', 'probe', 'low', 'inform_only', false, 'probe', 'live', true);
    raise exception 'an enabled AI system was registered with no grandfather stamp';
  exception
    when raise_exception then
      if sqlerrm not like '%cannot be registered already enabled%' then raise; end if;
  end;

  insert into public.ai_systems
    (system_code, name, purpose, owner_role, risk_class, autonomy_level,
     clinically_meaningful, fallback_behaviour, lifecycle_status, is_enabled,
     grandfathered_at, grandfather_note)
  values ('AI-995', 'probe', 'probe', 'probe', 'low', 'inform_only', false, 'probe', 'live', true,
          now(), 'assertion probe');

  if not exists (select 1 from public.ai_systems where system_code = 'AI-995' and is_enabled) then
    raise exception 'a grandfathered registration was refused -- part 6 would be unable to record what is already running';
  end if;

  -- The runtime reader distinguishes unregistered from disabled.
  if (public.ai_runtime_config('AI-000')->>'registered')::boolean then
    raise exception 'ai_runtime_config reported an unregistered system as registered';
  end if;
  if not (public.ai_runtime_config('AI-995')->>'enabled')::boolean then
    raise exception 'ai_runtime_config reported an enabled system as disabled';
  end if;

  delete from public.ai_systems where system_code in ('AI-995', 'AI-996');

  if has_function_privilege('anon', 'public.set_ai_system_enabled(uuid, boolean, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.approve_ai_system_version(uuid, text, boolean)', 'EXECUTE')
    or has_function_privilege('anon', 'public.ai_runtime_config(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.ai_governance_dashboard(integer)', 'EXECUTE')
  then
    raise exception 'anon can still execute an AI governance control';
  end if;
end;
$$;
