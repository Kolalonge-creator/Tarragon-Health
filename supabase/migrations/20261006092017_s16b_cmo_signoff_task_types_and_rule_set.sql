-- S16b: the Chief Medical Officer's sign-off, as screens can call it.
--
-- Until now nothing in the product let the CMO confirm the one task type the spec does not list
-- (adherence_follow_up, OQ-110) or approve the draft blood pressure triage rule set (OQ-88): both were
-- possible only as raw SQL. This adds two CMO-only functions and the columns they need.
--
--   * task_types gains needs_confirmation, confirmed_by, confirmed_at, confirmation_note. Only
--     adherence_follow_up needs confirming; the spec's own types are not touched.
--   * public.confirm_task_type(code, note): CMO only, audited.
--   * public.approve_triage_rule_set(id, note): CMO only, audited. Refuses while a task type still awaits
--     confirmation, or while the rule set asks for a task key no active task type answers (that would
--     dead-letter every task it tried to make). Retires the previously approved set of the same code
--     in the same step. Approving is what ends shadow mode (OQ-88): later grades create tasks.
--
-- Nothing here signs anything. The functions run only when the CMO presses the button.

alter table public.task_types
  add column needs_confirmation boolean not null default false,
  add column confirmed_by uuid references public.profiles (id) on delete set null,
  add column confirmed_at timestamptz,
  add column confirmation_note text;

update public.task_types set needs_confirmation = true where code = 'adherence_follow_up' and is_active;

create function public.confirm_task_type(p_code text, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can confirm a task type' using errcode = '42501';
  end if;
  update public.task_types
     set confirmed_by = (select auth.uid()), confirmed_at = now(), confirmation_note = nullif(btrim(coalesce(p_note, '')), '')
   where code = p_code and is_active and needs_confirmation and confirmed_at is null;
  if not found then
    raise exception 'nothing to confirm for %', p_code using errcode = '22023';
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event)
  values (private.current_org_id(), (select auth.uid()), 'task_type.confirmed', 'task_type',
          jsonb_build_object('code', p_code, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

create function public.approve_triage_rule_set(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  rs public.triage_rule_sets%rowtype;
  v_unconfirmed text;
  v_missing text;
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can approve a triage rule set' using errcode = '42501';
  end if;
  select * into rs from public.triage_rule_sets where id = p_id for update;
  if not found or rs.status <> 'draft' then
    raise exception 'only a draft rule set can be approved' using errcode = '22023';
  end if;
  select string_agg(code, ', ') into v_unconfirmed
    from public.task_types where is_active and needs_confirmation and confirmed_at is null;
  if v_unconfirmed is not null then
    raise exception 'confirm these task types first: %', v_unconfirmed using errcode = '22023';
  end if;
  -- every task the rules can create must have a task type that answers it
  select string_agg(k, ', ') into v_missing from (
    select distinct x ->> 'task' as k
      from jsonb_path_query(rs.rules, '$.rules[*].actions[*] ? (@.kind == "create_task")') x
     where not exists (select 1 from public.task_types t where t.is_active and t.creatable and t.source_task_keys @> array[x ->> 'task'])
  ) m;
  if v_missing is not null then
    raise exception 'no active task type answers these task keys: %', v_missing using errcode = '22023';
  end if;

  update public.triage_rule_sets set status = 'retired' where code = rs.code and status = 'approved';
  update public.triage_rule_sets set status = 'approved', approved_by = (select auth.uid()), approved_at = now() where id = p_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.current_org_id(), (select auth.uid()), 'triage_rule_set.approved', 'triage_rule_set', p_id,
          jsonb_build_object('code', rs.code, 'version', rs.version, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

revoke all on function public.confirm_task_type(text, text) from public, anon;
revoke all on function public.approve_triage_rule_set(uuid, text) from public, anon;
grant execute on function public.confirm_task_type(text, text) to authenticated;
grant execute on function public.approve_triage_rule_set(uuid, text) to authenticated;
