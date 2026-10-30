-- AI guardrail sign-off by the Chief Medical Officer.
-- Live on 2026-10-30: 0 of the 50 active ai_guardrails rows carry an approval, and only an admin could write the table directly.
-- This adds one function the CMO calls for a whole system's active guardrails. It stamps approved_by (the clinical_staff id, the same
-- value approve_ai_system_version stores) and approved_at on the rows not yet approved, and writes one audit row. It never edits a rule.
-- It is a record of the CMO's judgement, so only an active CMO may call it; an admin who is not the CMO is refused.
create or replace function public.approve_ai_guardrails(p_system_code text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_staff uuid;
  v_org uuid;
  v_system uuid;
  v_ids uuid[];
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select cs.id, cs.organisation_id into v_staff, v_org
    from public.clinical_staff cs
   where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
   limit 1;
  if v_staff is null then
    raise exception 'only the active Chief Medical Officer can approve AI guardrails' using errcode = '42501';
  end if;
  select id into v_system from public.ai_systems where system_code = p_system_code;
  if v_system is null then raise exception 'no such AI system: %', p_system_code using errcode = '22023'; end if;

  with done as (
    update public.ai_guardrails
       set approved_by = v_staff, approved_at = now()
     where ai_system_id = v_system and is_active and approved_at is null
    returning id
  )
  select array_agg(id) into v_ids from done;

  if v_ids is null then
    raise exception 'no unapproved active guardrails for %', p_system_code using errcode = '22023';
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)), v_actor,
          'ai_guardrails.approved', 'ai_systems', v_system,
          jsonb_build_object('system_code', p_system_code, 'signed_by_clinical_staff', v_staff,
                             'guardrail_ids', to_jsonb(v_ids), 'note', nullif(btrim(p_note), '')));
  return cardinality(v_ids);
end $$;

revoke all on function public.approve_ai_guardrails(text, text) from public;
revoke all on function public.approve_ai_guardrails(text, text) from anon;
grant execute on function public.approve_ai_guardrails(text, text) to authenticated;

do $$ begin
  if has_function_privilege('anon', 'public.approve_ai_guardrails(text, text)', 'EXECUTE') then
    raise exception 'anon can execute approve_ai_guardrails';
  end if;
end $$;
