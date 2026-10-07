-- S76 B4: a new kind of clinical work is created by configuration (spec 23 acceptance test), not by code.
--
--   public.create_task_type_proposal(...): admin or the chief medical officer. Inserts version 1 of a NEW code as an
--   active task type that needs confirmation (needs_confirmation = true, confirmed_at null): exactly the shape
--   public.confirm_task_type() already settles, so the CMO's confirmation is a separate, recorded act and nothing here
--   ever confirms anything. Until it is confirmed approve_triage_rule_set() refuses to sign a rule set (existing rule).
--
--   Guards: the code is new (an existing code is changed by a new version through the usual route, not here); the
--   priority class is 1 to 9 and a class 1 type has no lead window (table check, INV-05); the tier and competencies are
--   real; the triage task keys must not already be answered by another active type (so create_tasks_from_triage_event()
--   can never pick between two types).
--   The new type appears in the queue the moment a task of it is created (private.create_clinical_task) with its own
--   priority class and is claimable through queue_next() with no code change; the DB proof shows exactly that.
-- Counts: task_types rows are not touched by this migration.

create function public.create_task_type_proposal(
  p_code text, p_priority_class smallint, p_default_due_minutes integer, p_min_tier public.doctor_tier,
  p_required_competencies text[] default '{}', p_lead_window_minutes integer default 0, p_claim_timeout_minutes integer default 30,
  p_pushable boolean default false, p_source_task_keys text[] default '{}', p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_comp text; v_key text;
begin
  if not private.can_credential_review() then raise exception 'only an admin or the Chief Medical Officer can propose a task type' using errcode = '42501'; end if;
  if p_code is null or p_code !~ '^[a-z][a-z0-9_]{2,60}$' then raise exception 'the code must be lower case letters, numbers and underscores' using errcode = '22023'; end if;
  if exists (select 1 from public.task_types where code = p_code) then raise exception 'a task type with that code already exists' using errcode = '22023'; end if;
  if p_priority_class is null or p_priority_class not between 1 and 9 then raise exception 'priority class must be 1 to 9' using errcode = '22023'; end if;
  if p_default_due_minutes is null or p_default_due_minutes < 0 then raise exception 'the expected time must be zero or more minutes' using errcode = '22023'; end if;
  if coalesce(p_lead_window_minutes, 0) < 0 or (p_priority_class = 1 and coalesce(p_lead_window_minutes, 0) <> 0) then
    raise exception 'a class 1 task never has a named-clinician window' using errcode = '22023'; end if;
  if coalesce(p_claim_timeout_minutes, 30) < 1 then raise exception 'the claim time must be at least one minute' using errcode = '22023'; end if;
  foreach v_comp in array coalesce(p_required_competencies, '{}') loop
    if not exists (select 1 from public.competencies where code = v_comp and is_active) then raise exception 'unknown competency %', v_comp using errcode = '22023'; end if;
  end loop;
  foreach v_key in array coalesce(p_source_task_keys, '{}') loop
    if exists (select 1 from public.task_types t where t.is_active and t.source_task_keys @> array[v_key]) then
      raise exception 'another task type already answers the triage key %', v_key using errcode = '22023'; end if;
  end loop;
  insert into public.task_types (code, version, is_active, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
      lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note, needs_confirmation)
    values (p_code, 1, true, p_priority_class, p_default_due_minutes, p_min_tier, coalesce(p_required_competencies, '{}'),
      coalesce(p_lead_window_minutes, 0), coalesce(p_claim_timeout_minutes, 30), coalesce(p_pushable, false), true, coalesce(p_source_task_keys, '{}'),
      nullif(btrim(coalesce(p_note, '')), ''), true)
    returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.current_org_id(), (select auth.uid()), 'task_type.proposed', 'task_type', v_id,
          jsonb_build_object('code', p_code, 'priority_class', p_priority_class, 'min_tier', p_min_tier));
  return v_id;
end;
$$;
revoke all on function public.create_task_type_proposal(text, smallint, integer, public.doctor_tier, text[], integer, integer, boolean, text[], text) from public, anon;
grant execute on function public.create_task_type_proposal(text, smallint, integer, public.doctor_tier, text[], integer, integer, boolean, text[], text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.create_task_type_proposal(text, smallint, integer, public.doctor_tier, text[], integer, integer, boolean, text[], text)', 'EXECUTE') then
    raise exception 'S76 B4: anon can execute create_task_type_proposal'; end if;
  if not has_function_privilege('authenticated', 'public.create_task_type_proposal(text, smallint, integer, public.doctor_tier, text[], integer, integer, boolean, text[], text)', 'EXECUTE') then
    raise exception 'S76 B4: authenticated cannot execute create_task_type_proposal'; end if;
end $$;
