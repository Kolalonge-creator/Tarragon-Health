-- Tarragon Health — Clinical Rules & Care Protocol Engine, part 3/6:
-- governed deployment, event emission, candidate selection, suppression and
-- override RPCs.
--
-- §32.16's acceptance criteria are "configurable logic -> governed
-- deployment -> explainable actions -> auditability -> rollback". Part 1
-- gave the configurable logic and part 2 the auditability substrate; this
-- file is the governed-deployment and rollback half, plus the two narrow,
-- gated write paths a human legitimately has into the engine's own tables
-- (a manual suppression, and an override of an action the engine emitted).
--
-- Every state transition here is Clinical-Director-gated and audit-logged,
-- mirroring public.sign_escalation_slas / public.sign_alert_rules. The one
-- exception is promotion to SHADOW, which is admin-gated rather than
-- Director-gated -- a shadow rule cannot reach a patient by construction, so
-- requiring a Director's signature to merely start measuring one would push
-- teams to skip the shadow step, which is the opposite of what §32.13 wants.

-- ---------------------------------------------------------------------------
-- Helper: the caller's own active clinical_staff record
-- ---------------------------------------------------------------------------

create or replace function private.current_clinical_staff()
returns public.clinical_staff
language sql
stable
security definer
set search_path = ''
as $$
  select cs.*
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid()) and cs.active
  limit 1;
$$;

comment on function private.current_clinical_staff() is
  'The caller''s own active clinical_staff row, or no row. Used by the clinical-rules governance RPCs so attribution is always derived from the session, never client-supplied -- the same posture as public.sign_alert_rules().';

-- ---------------------------------------------------------------------------
-- §32.13 — promote a draft into shadow mode
-- ---------------------------------------------------------------------------

create or replace function public.promote_clinical_rule_to_shadow(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.clinical_rules;
begin
  if not private.is_admin() then
    raise exception 'not authorised: only an admin may put a clinical rule into shadow mode';
  end if;

  select * into v_rule from public.clinical_rules where id = p_id;
  if v_rule is null then
    raise exception 'clinical rule version not found';
  end if;
  if v_rule.status <> 'draft' then
    raise exception 'only a draft rule can be promoted to shadow (this one is %)', v_rule.status;
  end if;

  -- One shadow per rule_key (partial unique index in part 1). Retire any
  -- earlier shadow of the same rule explicitly rather than letting the
  -- insert fail with a constraint name nobody can act on.
  update public.clinical_rules
    set status = 'retired',
        retired_at = now(),
        retired_reason = format('Superseded in shadow by version %s.', v_rule.version)
  where rule_key = v_rule.rule_key and status = 'shadow' and id <> p_id;

  update public.clinical_rules set status = 'shadow' where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_rule.organisation_id, (select auth.uid()), 'clinical_rule.shadow_started',
    'clinical_rules', p_id,
    jsonb_build_object('rule_key', v_rule.rule_key, 'version', v_rule.version)
  );

  return p_id;
end;
$$;

comment on function public.promote_clinical_rule_to_shadow(uuid) is
  '§32.13. Starts a draft rule running in shadow: it is evaluated against real events and its would-be actions are recorded, but nothing reaches a patient. Admin-gated rather than Director-gated on purpose -- a shadow rule cannot act, and gating measurement behind a signature would discourage the shadow step entirely.';

-- ---------------------------------------------------------------------------
-- Governed activation (§32.16)
-- ---------------------------------------------------------------------------

create or replace function public.sign_clinical_rule(p_id uuid, p_activate boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule   public.clinical_rules;
  v_staff  public.clinical_staff;
  v_prior  public.clinical_rules;
begin
  select * into v_staff from private.current_clinical_staff();
  if v_staff is null or not v_staff.is_clinical_director then
    raise exception 'not authorised: only an active Clinical Director can sign a clinical rule';
  end if;

  select * into v_rule from public.clinical_rules where id = p_id;
  if v_rule is null then
    raise exception 'clinical rule version not found';
  end if;
  if v_rule.status not in ('draft', 'shadow') then
    raise exception 'only a draft or shadow rule can be signed (this one is %)', v_rule.status;
  end if;
  -- Enforced by CHECK too, but a named error here beats a constraint
  -- violation for the Director who has to act on it.
  if v_rule.protocol_version_id is null then
    raise exception 'clinical rule % v% has no protocol_version_id: a rule that acts must name the signed protocol its thresholds come from',
      v_rule.rule_key, v_rule.version;
  end if;
  if v_rule.owner_clinical_staff_id is null then
    raise exception 'clinical rule % v% has no owner: assign an accountable clinical_staff owner before signing',
      v_rule.rule_key, v_rule.version;
  end if;

  if p_activate then
    -- Retire whatever is currently live for this rule_key. Recorded as a
    -- supersession, not a deletion: §32.15 rollback needs the old version to
    -- still be there, intact and signed, to go back to.
    select * into v_prior
      from public.clinical_rules
      where rule_key = v_rule.rule_key and status = 'active' and id <> p_id;

    if v_prior is not null then
      update public.clinical_rules
        set status = 'retired',
            retired_at = now(),
            retired_reason = format('Superseded by version %s, signed by %s.', v_rule.version, v_staff.full_name)
      where id = v_prior.id;
    end if;
  end if;

  update public.clinical_rules
    set approved_by  = v_staff.id,
        approved_at  = now(),
        status       = case when p_activate then 'active' else status end,
        activated_at = case when p_activate then now() else activated_at end
  where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_rule.organisation_id, v_staff.organisation_id), (select auth.uid()),
    case when p_activate then 'clinical_rule.signed_and_activated' else 'clinical_rule.signed' end,
    'clinical_rules', p_id,
    jsonb_build_object(
      'rule_key', v_rule.rule_key,
      'version', v_rule.version,
      'signed_by_clinical_staff', v_staff.id,
      'protocol_version_id', v_rule.protocol_version_id,
      'superseded_version_id', v_prior.id
    )
  );

  return p_id;
end;
$$;

comment on function public.sign_clinical_rule(uuid, boolean) is
  'Clinical-Director-only signature for a clinical rule, optionally activating it in the same step. Refuses a rule with no protocol_version_id or no accountable owner. Retires (never deletes) the previously active version of the same rule_key, so §32.15 rollback always has an intact, signed version to return to.';

-- ---------------------------------------------------------------------------
-- §32.15 — rollback
-- ---------------------------------------------------------------------------

create or replace function public.rollback_clinical_rule(
  p_rule_key text,
  p_to_version integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff   public.clinical_staff;
  v_current public.clinical_rules;
  v_target  public.clinical_rules;
begin
  select * into v_staff from private.current_clinical_staff();
  if v_staff is null or not v_staff.is_clinical_director then
    raise exception 'not authorised: only an active Clinical Director can roll back a clinical rule';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a rollback reason is required: it is the clinical record of why the live rule was withdrawn';
  end if;

  select * into v_current
    from public.clinical_rules where rule_key = p_rule_key and status = 'active';
  if v_current is null then
    raise exception 'clinical rule % has no active version to roll back', p_rule_key;
  end if;

  select * into v_target
    from public.clinical_rules where rule_key = p_rule_key and version = p_to_version;
  if v_target is null then
    raise exception 'clinical rule % has no version %', p_rule_key, p_to_version;
  end if;
  if v_target.id = v_current.id then
    raise exception 'version % of % is the version currently live; nothing to roll back to', p_to_version, p_rule_key;
  end if;
  -- Rolling FORWARD to something that was never signed would be an
  -- unreviewed activation wearing a rollback's clothes.
  if v_target.approved_by is null then
    raise exception 'version % of % was never signed, so it cannot be rolled back to', p_to_version, p_rule_key;
  end if;

  update public.clinical_rules
    set status = 'rolled_back',
        rolled_back_at = now(),
        rollback_reason = p_reason
  where id = v_current.id;

  update public.clinical_rules
    set status = 'active',
        activated_at = now(),
        retired_at = null,
        retired_reason = null
  where id = v_target.id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_current.organisation_id, v_staff.organisation_id), (select auth.uid()),
    'clinical_rule.rolled_back', 'clinical_rules', v_current.id,
    jsonb_build_object(
      'rule_key', p_rule_key,
      'withdrawn_version', v_current.version,
      'restored_version', v_target.version,
      'reason', p_reason,
      'by_clinical_staff', v_staff.id
    )
  );

  return v_target.id;
end;
$$;

comment on function public.rollback_clinical_rule(text, integer, text) is
  '§32.15. Withdraws the live version of a rule (status rolled_back, with a required reason) and restores a previously SIGNED earlier version to active in one transaction. Refuses to "roll back" to a version that was never signed -- that would be an unreviewed activation in disguise.';

-- ---------------------------------------------------------------------------
-- Retirement
-- ---------------------------------------------------------------------------

create or replace function public.retire_clinical_rule(p_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule  public.clinical_rules;
  v_staff public.clinical_staff;
begin
  select * into v_rule from public.clinical_rules where id = p_id;
  if v_rule is null then
    raise exception 'clinical rule version not found';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a retirement reason is required';
  end if;

  select * into v_staff from private.current_clinical_staff();

  -- Retiring something that is live is a clinical decision; retiring a draft
  -- or a shadow rule is housekeeping.
  if v_rule.status = 'active' then
    if v_staff is null or not v_staff.is_clinical_director then
      raise exception 'not authorised: only an active Clinical Director can retire a live clinical rule';
    end if;
  elsif v_rule.status in ('retired', 'rolled_back') then
    raise exception 'clinical rule % v% is already %', v_rule.rule_key, v_rule.version, v_rule.status;
  elsif not private.is_admin() then
    raise exception 'not authorised: only an admin may retire a draft or shadow clinical rule';
  end if;

  update public.clinical_rules
    set status = 'retired', retired_at = now(), retired_reason = p_reason
  where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    coalesce(v_rule.organisation_id, v_staff.organisation_id), (select auth.uid()),
    'clinical_rule.retired', 'clinical_rules', p_id,
    jsonb_build_object('rule_key', v_rule.rule_key, 'version', v_rule.version,
                       'previous_status', v_rule.status, 'reason', p_reason)
  );

  return p_id;
end;
$$;

comment on function public.retire_clinical_rule(uuid, text) is
  'Retires a clinical rule version with a required reason. Retiring a LIVE rule is Clinical-Director-gated (it changes what the platform does); retiring a draft or shadow version is admin-gated housekeeping.';

-- ---------------------------------------------------------------------------
-- §32.7 — event emission
-- ---------------------------------------------------------------------------

create or replace function private.emit_clinical_rule_event(
  p_organisation_id uuid,
  p_patient_id      uuid,
  p_event_type      public.clinical_rule_event_type,
  p_payload         jsonb default '{}'::jsonb,
  p_source          text default 'db_trigger',
  p_subject_table   text default null,
  p_subject_id      uuid default null,
  p_occurred_at     timestamptz default now(),
  p_dedup_key       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_organisation_id is null then
    return null;
  end if;

  insert into public.clinical_rule_events
    (organisation_id, patient_id, event_type, occurred_at, payload, source,
     subject_table, subject_id, dedup_key)
  values
    (p_organisation_id, p_patient_id, p_event_type, coalesce(p_occurred_at, now()),
     coalesce(p_payload, '{}'::jsonb), p_source, p_subject_table, p_subject_id, p_dedup_key)
  on conflict (dedup_key) where dedup_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.emit_clinical_rule_event(uuid, uuid, public.clinical_rule_event_type, jsonb, text, text, uuid, timestamptz, text) is
  '§32.7. The single entry point for putting an event on the rules-engine queue. Returns null (rather than raising) on a missing organisation or a dedup-key collision: an emitter is always a side-effect of some real clinical write, and failing that write because the OBSERVABILITY queue rejected it would be a strictly worse outcome than a missed rule evaluation.';

-- ---------------------------------------------------------------------------
-- §32.6 — candidate rule selection
-- ---------------------------------------------------------------------------
--
-- Lives in SQL rather than in the TS engine so that the effective-window and
-- scope logic has exactly one implementation. The engine, the simulator and
-- the admin UI all read candidates through here, which is what stops a
-- "which rules would apply?" preview from disagreeing with what actually
-- runs.

create or replace function public.clinical_rule_candidates(
  p_event_type      public.clinical_rule_event_type,
  p_organisation_id uuid,
  p_patient_id      uuid default null,
  p_at              timestamptz default now(),
  p_include_shadow  boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.specificity desc, r.priority desc, r.rule_key), '[]'::jsonb)
  from public.clinical_rules r
  where r.event_type = p_event_type
    and (r.status = 'active' or (p_include_shadow and r.status = 'shadow'))
    and r.effective_from <= p_at
    and (r.effective_to is null or r.effective_to > p_at)
    -- Scope ladder: platform-wide, this organisation, or this patient.
    and (r.organisation_id is null or r.organisation_id = p_organisation_id)
    and (r.patient_id is null or r.patient_id = p_patient_id)
    -- The caller must be entitled to the tenant they are asking about.
    -- SECURITY DEFINER, so without this a staff member of one organisation
    -- could enumerate another's patient-specific rules.
    and (private.is_org_staff(p_organisation_id) or (select auth.uid()) is null);
$$;

comment on function public.clinical_rule_candidates(public.clinical_rule_event_type, uuid, uuid, timestamptz, boolean) is
  '§32.6 step 2 ("matching rules"): every active (and, by default, shadow) rule whose trigger, effective window and scope admit this event, ordered by the §32.9 specificity-then-priority ladder. The single source of truth for candidate selection -- the worker, the simulator and the admin preview all read through it, so a preview cannot disagree with what really runs. auth.uid() is null identifies the service-role worker, which has no session to check.';

-- ---------------------------------------------------------------------------
-- §32.10 — manual suppression by a clinician
-- ---------------------------------------------------------------------------

create or replace function public.suppress_clinical_rule_for_patient(
  p_rule_key   text,
  p_patient_id uuid,
  p_until      timestamptz,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.clinical_staff;
  v_org   uuid;
  v_id    uuid;
  v_key   text;
begin
  select * into v_staff from private.current_clinical_staff();
  if v_staff is null then
    raise exception 'not authorised: only clinical staff may suppress a rule for a patient';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a suppression reason is required';
  end if;
  if p_until is null or p_until <= now() then
    raise exception 'a suppression must expire in the future: an open-ended silence is a retirement, not a suppression';
  end if;

  select p.organisation_id into v_org from public.profiles p where p.id = p_patient_id;
  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised for this patient';
  end if;
  if not exists (select 1 from public.clinical_rules where rule_key = p_rule_key) then
    raise exception 'unknown clinical rule %', p_rule_key;
  end if;

  v_key := format('manual:%s:%s', p_rule_key, p_patient_id);

  insert into public.clinical_rule_suppressions
    (organisation_id, rule_key, patient_id, suppression_key, mechanism,
     suppressed_until, reason, created_by)
  values (v_org, p_rule_key, p_patient_id, v_key, 'manual', p_until, p_reason, v_staff.id)
  on conflict (rule_key, suppression_key) do update
    set suppressed_until = excluded.suppressed_until,
        reason           = excluded.reason,
        created_by       = excluded.created_by,
        mechanism        = 'manual'
  returning id into v_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, (select auth.uid()), 'clinical_rule.suppressed_for_patient',
    'clinical_rule_suppressions', v_id,
    jsonb_build_object('rule_key', p_rule_key, 'patient_id', p_patient_id,
                       'until', p_until, 'reason', p_reason, 'by_clinical_staff', v_staff.id)
  );

  return v_id;
end;
$$;

comment on function public.suppress_clinical_rule_for_patient(text, uuid, timestamptz, text) is
  '§32.10 manual suppression: a clinician quietening one rule for one patient, with a required reason and a required expiry. Audit-logged and attributed to the caller''s own clinical_staff record. An open-ended silence is deliberately not expressible here -- that is a retirement decision, not a per-patient one.';

-- ---------------------------------------------------------------------------
-- §32.14 — clinician override of an emitted action
-- ---------------------------------------------------------------------------

create or replace function public.override_clinical_rule_action(
  p_action_id uuid,
  p_reason    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff  public.clinical_staff;
  v_action public.clinical_rule_action_records;
begin
  select * into v_staff from private.current_clinical_staff();
  if v_staff is null then
    raise exception 'not authorised: only clinical staff may override an automated action';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'an override reason is required: it is the clinical justification for disagreeing with the protocol';
  end if;

  select * into v_action from public.clinical_rule_action_records where id = p_action_id;
  if v_action is null then
    raise exception 'clinical rule action not found';
  end if;
  if not private.is_org_staff(v_action.organisation_id) then
    raise exception 'not authorised for this organisation';
  end if;
  if v_action.clinician_override then
    raise exception 'this action has already been overridden';
  end if;

  update public.clinical_rule_action_records
    set clinician_override = true,
        override_reason    = p_reason,
        overridden_by      = v_staff.id,
        overridden_at      = now()
  where id = p_action_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_action.organisation_id, (select auth.uid()), 'clinical_rule.action_overridden',
    'clinical_rule_action_records', p_action_id,
    jsonb_build_object('rule_key', v_action.rule_key, 'action_type', v_action.action_type,
                       'reason', p_reason, 'by_clinical_staff', v_staff.id)
  );

  return p_action_id;
end;
$$;

comment on function public.override_clinical_rule_action(uuid, text) is
  '§32.14 override rate. Records a clinician disagreeing with an action the engine produced, with a required justification -- the deterministic-classification-plus-clinician_override pattern already used by clinician_alerts. An override is recorded, never a deletion: a rule that is overridden often is the signal that it needs revising.';

-- ---------------------------------------------------------------------------
-- Grants. anon inherits EXECUTE through the PUBLIC pseudo-role, so it is
-- revoked via `from public` -- revoking `from anon` alone does nothing here
-- (see feedback_supabase_anon_execute_gotcha in memory; this has been
-- believed fixed and found broken repeatedly on this project).
-- ---------------------------------------------------------------------------

revoke all on function public.promote_clinical_rule_to_shadow(uuid) from public, anon;
revoke all on function public.sign_clinical_rule(uuid, boolean) from public, anon;
revoke all on function public.rollback_clinical_rule(text, integer, text) from public, anon;
revoke all on function public.retire_clinical_rule(uuid, text) from public, anon;
revoke all on function public.clinical_rule_candidates(public.clinical_rule_event_type, uuid, uuid, timestamptz, boolean) from public, anon;
revoke all on function public.suppress_clinical_rule_for_patient(text, uuid, timestamptz, text) from public, anon;
revoke all on function public.override_clinical_rule_action(uuid, text) from public, anon;
revoke all on function private.emit_clinical_rule_event(uuid, uuid, public.clinical_rule_event_type, jsonb, text, text, uuid, timestamptz, text) from public, anon;
revoke all on function private.current_clinical_staff() from public, anon;

grant execute on function public.promote_clinical_rule_to_shadow(uuid) to authenticated;
grant execute on function public.sign_clinical_rule(uuid, boolean) to authenticated;
grant execute on function public.rollback_clinical_rule(text, integer, text) to authenticated;
grant execute on function public.retire_clinical_rule(uuid, text) to authenticated;
grant execute on function public.clinical_rule_candidates(public.clinical_rule_event_type, uuid, uuid, timestamptz, boolean) to authenticated;
grant execute on function public.suppress_clinical_rule_for_patient(text, uuid, timestamptz, text) to authenticated;
grant execute on function public.override_clinical_rule_action(uuid, text) to authenticated;
