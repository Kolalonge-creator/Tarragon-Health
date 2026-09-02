-- Tarragon Health — Predictive Risk & Early Warning Engine, 2/5
-- Governance RPCs for public.risk_models: shadow deployment, signed
-- activation, and rollback (spec §39.12 – §39.14). Mirrors the
-- sign_cv_risk_config / sign_escalation_slas forge-proof shape: every
-- state transition is a SECURITY DEFINER function, never a raw UPDATE, so
-- risk_models_update's "status = 'draft' only" policy can never be routed
-- around.

-- ---------------------------------------------------------------------------
-- 1. Shadow deployment (§39.13). No signature required — shadowing is the
-- pre-approval step, not a care-influencing one. Moves draft -> shadow only;
-- a model already shadow/active/retired/rolled_back cannot be re-shadowed.
-- ---------------------------------------------------------------------------

create or replace function public.start_risk_model_shadow(p_model_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_status public.risk_model_status;
begin
  select organisation_id, status into v_org, v_status
  from public.risk_models where id = p_model_id;

  if v_org is null then
    raise exception 'risk model not found';
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'not authorised: staff only';
  end if;
  if v_status <> 'draft' then
    raise exception 'model must be in draft status to start shadowing (currently %)', v_status;
  end if;

  update public.risk_models set status = 'shadow' where id = p_model_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'risk_model.shadow_started', 'risk_models', p_model_id, '{}'::jsonb);

  return p_model_id;
end $$;

comment on function public.start_risk_model_shadow(uuid) is
  'Moves a draft model into shadow status (spec §39.13): it may now score '
  'patients and write predictions, but private.risk_model_may_influence_care() '
  'stays false until the model is signed active.';

-- ---------------------------------------------------------------------------
-- 2. Signed activation (§39.12 "governance approval"). Only an active
-- Clinical Director in the model's organisation may sign. draft or shadow
-- may be activated directly (a model can skip shadowing for a low-risk
-- change, or graduate from it) — retired/rolled_back may not: a rolled-back
-- model is terminal by design (§39.14), and "retired" means a newer version
-- already superseded it, so reactivating an old one would silently
-- re-introduce parameters a reviewer already moved past.
-- ---------------------------------------------------------------------------

create or replace function public.activate_risk_model(p_model_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_domain public.risk_domain;
  v_status public.risk_model_status;
  v_staff  uuid;
begin
  select organisation_id, domain, status into v_org, v_domain, v_status
  from public.risk_models where id = p_model_id;

  if v_org is null then
    raise exception 'risk model not found';
  end if;
  if v_status not in ('draft', 'shadow') then
    raise exception 'model must be draft or shadow to activate (currently %)', v_status;
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_org
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can activate a risk model';
  end if;

  -- One active model per (org, domain) — retire whatever is currently live
  -- before activating this one. Retiring, not rolling back: a routine
  -- version bump is not a performance failure (§39.14 is for that).
  update public.risk_models
    set status = 'retired'
    where organisation_id = v_org and domain = v_domain and status = 'active' and id <> p_model_id;

  update public.risk_models
    set status = 'active', approved_by = v_staff, approved_at = now()
    where id = p_model_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'risk_model.activated', 'risk_models', p_model_id,
    jsonb_build_object('signed_by_clinical_staff', v_staff, 'domain', v_domain));

  return p_model_id;
end $$;

comment on function public.activate_risk_model(uuid) is
  'Signs and activates a risk model (spec §39.12). Only an active Clinical '
  'Director may call this. Retires whatever was previously active in the '
  'same (organisation, domain) so exactly one model stays live.';

-- ---------------------------------------------------------------------------
-- 3. Rollback (§39.14: "If performance deteriorates: Immediately return to
-- the previous validated model."). Any org staff may call this — a rollback
-- is a safety action responding to observed harm, not a fresh clinical
-- judgment the way activation is, so it deliberately does not require
-- Clinical-Director-level signing; requiring a director's availability to
-- pull a misbehaving model would work against "immediately."
--
-- Reactivates supersedes_id automatically when present and itself eligible
-- (still 'retired', same org+domain) — that is precisely "the previous
-- validated model" the spec names. If there is nothing eligible to restore
-- to, the domain is left with no active model rather than guessing, and the
-- caller is told so.
-- ---------------------------------------------------------------------------

create or replace function public.rollback_risk_model(p_model_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_domain     public.risk_domain;
  v_status     public.risk_model_status;
  v_prior_id   uuid;
  v_prior_status public.risk_model_status;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'a rollback reason is required';
  end if;

  select organisation_id, domain, status, supersedes_id
    into v_org, v_domain, v_status, v_prior_id
  from public.risk_models where id = p_model_id;

  if v_org is null then
    raise exception 'risk model not found';
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'not authorised: staff only';
  end if;
  if v_status not in ('active', 'shadow') then
    raise exception 'only an active or shadow model can be rolled back (currently %)', v_status;
  end if;

  update public.risk_models
    set status = 'rolled_back', rolled_back_at = now(), rollback_reason = p_reason
    where id = p_model_id;

  if v_prior_id is not null then
    select status into v_prior_status from public.risk_models where id = v_prior_id;
    if v_prior_status = 'retired' then
      update public.risk_models set status = 'active' where id = v_prior_id;
    end if;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'risk_model.rolled_back', 'risk_models', p_model_id,
    jsonb_build_object('reason', p_reason, 'domain', v_domain,
      'restored_model_id', case when v_prior_status = 'retired' then v_prior_id else null end));

  return p_model_id;
end $$;

comment on function public.rollback_risk_model(uuid, text) is
  'Withdraws a model from active/shadow duty (spec §39.14) and, if its '
  'supersedes_id is still eligible (retired, same org+domain), reactivates '
  'it as "the previous validated model." Terminal for the rolled-back row.';

-- ---------------------------------------------------------------------------
-- 4. Care-influence gate. The one place "may this model's output touch a
-- care workflow" is decided — every downstream reader (outreach engine,
-- clinician alerts, dashboards) calls this rather than re-deriving it from
-- status, so a future new status value cannot silently start influencing
-- care by accident.
-- ---------------------------------------------------------------------------

create or replace function private.risk_model_may_influence_care(p_status public.risk_model_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = 'active';
$$;

comment on function private.risk_model_may_influence_care(public.risk_model_status) is
  'Spec §39.13: shadow models "run silently before influencing care." True '
  'only for status=active — every consumer of a risk_predictions row must '
  'check this before letting a prediction drive a task/alert/notification.';

revoke all on function public.start_risk_model_shadow(uuid) from public;
revoke all on function public.start_risk_model_shadow(uuid) from anon;
grant execute on function public.start_risk_model_shadow(uuid) to authenticated;

revoke all on function public.activate_risk_model(uuid) from public;
revoke all on function public.activate_risk_model(uuid) from anon;
grant execute on function public.activate_risk_model(uuid) to authenticated;

revoke all on function public.rollback_risk_model(uuid, text) from public;
revoke all on function public.rollback_risk_model(uuid, text) from anon;
grant execute on function public.rollback_risk_model(uuid, text) to authenticated;

revoke all on function private.risk_model_may_influence_care(public.risk_model_status) from public;
