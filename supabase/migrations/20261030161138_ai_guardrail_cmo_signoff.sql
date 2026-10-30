-- AI guardrail sign-off by the Chief Medical Officer.
-- Live on 2026-10-30: 0 of the 50 active ai_guardrails rows carry an approval, and any admin could write the table directly.
-- 1. public.approve_ai_guardrails(system code, expected count, note): only an active CMO. It stamps approved_by (the clinical_staff id,
--    the same value approve_ai_system_version stores) and approved_at on the system's unapproved active rows. The caller states how many
--    rules they read; if the number of rows to stamp differs, nothing is stamped, so a rule added after the review cannot be signed unseen.
--    The audit row keeps the text of each rule that was approved, not only its id.
-- 2. A trigger makes the function the only way to record an approval (an admin can no longer write approved_by or approved_at), and clears
--    an approval when the rule's wording, kind, enforcement, config or active flag is edited afterwards.
create or replace function private.guard_ai_guardrail_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.ai_guardrail_signoff', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.approved_by is not null or new.approved_at is not null then
      raise exception 'an AI guardrail approval can only be recorded by approve_ai_guardrails' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.approved_by, new.approved_at) is distinct from (old.approved_by, old.approved_at) then
    raise exception 'an AI guardrail approval can only be recorded by approve_ai_guardrails' using errcode = '42501';
  end if;
  if old.approved_at is not null
     and (new.rule_code, new.kind, new.description, new.enforcement, new.config, new.is_active)
         is distinct from (old.rule_code, old.kind, old.description, old.enforcement, old.config, old.is_active) then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

drop trigger if exists ai_guardrails_approval_guard on public.ai_guardrails;
create trigger ai_guardrails_approval_guard
  before insert or update on public.ai_guardrails
  for each row execute function private.guard_ai_guardrail_approval();

create or replace function public.approve_ai_guardrails(p_system_code text, p_expected_count integer, p_note text default null)
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
  v_rules jsonb;
  v_n integer;
begin
  if v_actor is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select cs.id, cs.organisation_id into v_staff, v_org
    from public.clinical_staff cs
   where cs.profile_id = v_actor and cs.active and cs.doctor_tier = 'chief_medical_officer'
   order by cs.created_at
   limit 1;
  if v_staff is null then
    raise exception 'only the active Chief Medical Officer can approve AI guardrails' using errcode = '42501';
  end if;
  select id into v_system from public.ai_systems where system_code = p_system_code;
  if v_system is null then raise exception 'no such AI system: %', p_system_code using errcode = '22023'; end if;

  select jsonb_agg(jsonb_build_object('id', g.id, 'rule_code', g.rule_code, 'kind', g.kind, 'enforcement', g.enforcement, 'description', g.description) order by g.rule_code)
    into v_rules
    from public.ai_guardrails g
   where g.ai_system_id = v_system and g.is_active and g.approved_at is null;
  v_n := coalesce(jsonb_array_length(v_rules), 0);
  if v_n = 0 then
    raise exception 'no unapproved active guardrails for %', p_system_code using errcode = '22023';
  end if;
  if p_expected_count is distinct from v_n then
    raise exception '% has % unapproved active guardrails, not %: review the current list and try again', p_system_code, v_n, p_expected_count using errcode = '22023';
  end if;

  perform set_config('app.ai_guardrail_signoff', 'on', true);
  update public.ai_guardrails
     set approved_by = v_staff, approved_at = now()
   where ai_system_id = v_system and is_active and approved_at is null;
  perform set_config('app.ai_guardrail_signoff', '', true);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (coalesce(v_org, (select organisation_id from public.profiles where id = v_actor)), v_actor,
          'ai_guardrails.approved', 'ai_systems', v_system,
          jsonb_build_object('system_code', p_system_code, 'signed_by_clinical_staff', v_staff,
                             'rules', v_rules, 'note', nullif(btrim(p_note), '')));
  return v_n;
end $$;

revoke all on function public.approve_ai_guardrails(text, integer, text) from public;
revoke all on function public.approve_ai_guardrails(text, integer, text) from anon;
grant execute on function public.approve_ai_guardrails(text, integer, text) to authenticated;

do $$ begin
  if has_function_privilege('anon', 'public.approve_ai_guardrails(text, integer, text)', 'EXECUTE') then
    raise exception 'anon can execute approve_ai_guardrails';
  end if;
end $$;
