-- Community: the four functions that contain a DELETE statement, split out of the earlier Community migrations so they can be applied on
-- their own. They are unchanged from the versions that used to sit in:
--   20261009193548 (community_admin_rule_delete), 20261009203218 (community_unhide_author, community_admin_end_prompt),
--   20261009213122 (community_admin_set_shifts).
-- (The database tool used to apply migrations to the live project hung on any function body containing DELETE, so these four were separated
-- from the rest rather than blocking everything else. Nothing about their behaviour or access changed.)

create or replace function public.community_admin_rule_delete(p_rule_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.community_filter_rules;
begin
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  select * into r from public.community_filter_rules where id = p_rule_id;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'no_such_rule'); end if;
  if r.action = 'safety' and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer removes emergency and self-harm rules' using errcode = '42501';
  end if;
  delete from public.community_filter_rules where id = p_rule_id;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_unhide_author(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  delete from public.community_hidden_authors where id = p_id and viewer_id = v_uid;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.community_admin_end_prompt(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.community_group_prompts;
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into p from public.community_group_prompts where id = p_id;
  if not found then return jsonb_build_object('status', 'refused', 'reason', 'not_found'); end if;
  if not private.community_can_prompt(p.group_id) then raise exception 'admins, the Chief Medical Officer and moderators of this group only' using errcode = '42501'; end if;
  -- a prompt that has barely started (or not started) is simply removed; a running one is ended now
  perform private.community_log_event(p.group_id, p.id, null, 'prompt_ended', (select auth.uid()), null, '[]'::jsonb);
  if p.show_from > now() - interval '1 minute' then
    delete from public.community_group_prompts where id = p_id;
  else
    update public.community_group_prompts set show_until = now() where id = p_id and (show_until is null or show_until > now());
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- Replaces all the shifts of one grant. p_shifts: [{"weekday":0,"start_hour":8,"end_hour":16}, ...]
create or replace function public.community_admin_set_shifts(p_staff_id uuid, p_shifts jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r jsonb;
  v_n integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.community_can_configure() then raise exception 'admins and the Chief Medical Officer only' using errcode = '42501'; end if;
  if not exists (select 1 from public.community_staff where id = p_staff_id and revoked_at is null) then
    return jsonb_build_object('status', 'refused', 'reason', 'not_found');
  end if;
  if p_shifts is null or coalesce(jsonb_typeof(p_shifts), '') <> 'array' or jsonb_array_length(p_shifts) > 100 then return jsonb_build_object('status', 'refused', 'reason', 'bad_shifts'); end if;
  for r in select * from jsonb_array_elements(p_shifts) loop
    if coalesce(jsonb_typeof(r -> 'weekday'), '') <> 'number' or coalesce(jsonb_typeof(r -> 'start_hour'), '') <> 'number' or coalesce(jsonb_typeof(r -> 'end_hour'), '') <> 'number'
       or (r ->> 'weekday')::numeric not between 0 and 6 or (r ->> 'weekday')::numeric <> trunc((r ->> 'weekday')::numeric)
       or (r ->> 'start_hour')::numeric not between 0 and 23 or (r ->> 'start_hour')::numeric <> trunc((r ->> 'start_hour')::numeric)
       or (r ->> 'end_hour')::numeric not between 1 and 24 or (r ->> 'end_hour')::numeric <> trunc((r ->> 'end_hour')::numeric)
       or (r ->> 'end_hour')::int <= (r ->> 'start_hour')::int then
      return jsonb_build_object('status', 'refused', 'reason', 'bad_shifts');
    end if;
  end loop;
  delete from public.community_shifts where staff_id = p_staff_id;
  for r in select * from jsonb_array_elements(p_shifts) loop
    insert into public.community_shifts (staff_id, weekday, start_hour, end_hour)
    values (p_staff_id, (r ->> 'weekday')::int, (r ->> 'start_hour')::int, (r ->> 'end_hour')::int);
    v_n := v_n + 1;
  end loop;
  perform private.community_log_event(null, null, null, 'rota_changed', (select auth.uid()), null, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'shifts', v_n);
end $$;

revoke all on function public.community_admin_rule_delete(bigint), public.community_unhide_author(uuid), public.community_admin_end_prompt(uuid),
  public.community_admin_set_shifts(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.community_admin_rule_delete(bigint), public.community_unhide_author(uuid), public.community_admin_end_prompt(uuid),
  public.community_admin_set_shifts(uuid, jsonb) to authenticated;
