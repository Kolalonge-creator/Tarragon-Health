-- The Chief Medical Officer chooses how many days an acknowledged test page keeps an on-call clinician "ready" (rule readiness_test_page_days).
--
-- Until now a change meant a developer writing a new paging_delivery_config version as a migration. This function lets the CMO do it from the
-- Capacity page: it takes the version in force, changes ONLY readiness_test_page_days, and makes that the new signed version in force. The old
-- version stays on record and a signed version is still never edited (the frozen_config_guard is untouched).
--
-- Safety, in the same order the database checks it:
--   * only the Chief Medical Officer (private.credential_is_cmo), a written reason of at least 10 characters, a whole number from 1 to 365;
--   * refused if the number is already the one in force, or if an unsigned newer draft is waiting (sign or deal with that first);
--   * if the new window would leave an on-call clinician without a push subscription, a verified email or a test page inside it, nothing is
--     written and the people missing something are returned, exactly as activate_paging_delivery_config reports them;
--   * the new version is inserted unsigned and made active by the same statements the activation function uses, and the change is audited.
-- No row is changed by this migration itself.

create function public.set_paging_test_page_days(p_days integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_live public.paging_delivery_config%rowtype;
  v_gaps jsonb;
  v_next integer;
  v_id uuid;
  v_org uuid;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can change the test page window' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'choose a whole number of days from 1 to 365' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'write a reason of at least 10 characters' using errcode = '22023'; end if;

  lock table public.paging_delivery_config in share row exclusive mode;
  select * into v_live from public.paging_delivery_config where is_active order by version desc limit 1;
  if not found then raise exception 'there is no paging delivery configuration in force' using errcode = 'P0002'; end if;
  if (v_live.rules ->> 'readiness_test_page_days')::integer = p_days then
    raise exception 'the test page window is already % days', p_days using errcode = '23514';
  end if;
  if exists (select 1 from public.paging_delivery_config where version > v_live.version and approved_at is null) then
    raise exception 'a newer paging configuration is waiting for your signature; deal with that first' using errcode = '23514';
  end if;

  v_gaps := private.paging_activation_gaps(p_days);
  if jsonb_array_length(v_gaps) > 0 then
    return jsonb_build_object('changed', false, 'reasons', v_gaps);
  end if;

  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  select max(version) + 1 into v_next from public.paging_delivery_config;
  insert into public.paging_delivery_config (version, is_active, effective_from, rules)
    values (v_next, false, current_date, v_live.rules || jsonb_build_object('readiness_test_page_days', p_days))
    returning id into v_id;
  update public.paging_delivery_config set is_active = false where is_active and version <> v_next;
  update public.paging_delivery_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = v_next;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, (select auth.uid()), 'paging_delivery_config.test_page_days_set', 'paging_delivery_config', v_id,
            jsonb_build_object('version', v_next, 'previous_version', v_live.version, 'from_days', (v_live.rules ->> 'readiness_test_page_days')::integer, 'to_days', p_days, 'reason', btrim(p_reason)));
  return jsonb_build_object('changed', true, 'version', v_next, 'days', p_days, 'reasons', '[]'::jsonb);
end;
$$;
revoke all on function public.set_paging_test_page_days(integer, text) from public, anon, authenticated;
grant execute on function public.set_paging_test_page_days(integer, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.set_paging_test_page_days(integer, text)'::regprocedure, 'EXECUTE') then
    raise exception 'set_paging_test_page_days is executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.set_paging_test_page_days(integer, text)'::regprocedure, 'EXECUTE') then
    raise exception 'set_paging_test_page_days is not executable by authenticated';
  end if;
end $$;
