-- Tarragon Health — AI governance: approving a version now retires the
-- drafts it supersedes (Module 40.9's release gate, follow-up).
--
-- Found 2026-09-25 while checking why the CMO sign-off queue listed 5 AI-001
-- versions "awaiting approval" when only one (2026-09-16.4) was actually
-- unresolved. The other four (v1, 2026-09-14.1, 2026-09-14.2, 2026-09-16.2)
-- were dead drafts: each was superseded by a later version that itself went
-- on to fail its own evals, get fixed, pass, and get approved -- but nothing
-- ever set approved_at or retired_at on the abandoned predecessor, so it sat
-- in the "Awaiting Clinical Director approval" list forever. Confirmed live
-- via ai_evaluation_runs: 2026-09-16.2 genuinely failed clinical accuracy
-- (6/8) and fairness (2/4) on 2026-09-16; 2026-09-16.4 passed all five
-- required suites 100% the same evening and was approved by the founder at
-- 22:29 and deployed at 02:05 the next day. That real approval history is
-- untouched by this migration -- the four dead rows were retired by hand via
-- a one-off UPDATE before this migration existed, so this fixes the cause,
-- not that specific symptom.
--
-- Fix: public.approve_ai_system_version now retires (sets retired_at, if not
-- already set) every OTHER still-open (approved_at is null, retired_at is
-- null) version of the SAME ai_system that was created strictly before the
-- version just approved. A version created after the one just approved is
-- left alone -- it may be genuinely in-progress follow-up work, not a
-- superseded draft, and approving an older version is never a reason to kill
-- something newer. This mirrors exactly what a human reviewing the queue
-- would conclude: once version N is approved, any earlier, never-approved
-- draft of the same system is moot.

create or replace function public.approve_ai_system_version(p_version_id uuid, p_note text default null::text, p_deploy boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_system record;
  v_gate   jsonb;
  v_staff  uuid;
  v_actor  uuid := (select auth.uid());
  v_org    uuid;
  v_created_at timestamptz;
  v_retired_ids uuid[];
begin
  select s.id, s.system_code, s.name, s.risk_class, s.clinically_meaningful, v.created_at as version_created_at
    into v_system
  from public.ai_system_versions v
  join public.ai_systems s on s.id = v.ai_system_id
  where v.id = p_version_id;

  if v_system.id is null then
    raise exception 'AI system version not found';
  end if;

  v_created_at := v_system.version_created_at;

  select cs.id, cs.organisation_id into v_staff, v_org
  from public.clinical_staff cs
  where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
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

  -- Retire every earlier, still-open draft of the same system -- approving
  -- this one settles them. A later-created version (in-progress follow-up
  -- work) is left untouched.
  --
  -- Known, accepted race: two concurrent approvals of different drafts of
  -- the same ai_system could, under READ COMMITTED, retire a sibling at the
  -- moment it is itself being approved (each transaction's snapshot may not
  -- yet see the other's approved_at). Approval is a rare, deliberate,
  -- single-Clinical-Director action, and the only consequence is a
  -- contradictory retired_at+approved_at pair on that one row -- the release
  -- gate and the CMO queue already key off approved_at, not retired_at, so
  -- nothing unsafe is exposed. Not worth a lock for this likelihood.
  with retired as (
    update public.ai_system_versions
       set retired_at = now()
     where ai_system_id = v_system.id
       and id <> p_version_id
       and approved_at is null
       and retired_at is null
       and created_at < v_created_at
    returning id
  )
  select array_agg(id) into v_retired_ids from retired;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)),
    v_actor, 'ai_system_version.approved', 'ai_system_versions', p_version_id,
    jsonb_build_object(
      'system_code', v_system.system_code,
      'signed_by_clinical_staff', v_staff,
      'release_gate', v_gate,
      'deployed', p_deploy,
      'superseded_versions_retired', coalesce(v_retired_ids, array[]::uuid[])
    )
  );

  return v_gate;
end;
$function$;
