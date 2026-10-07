-- S42 (v5 Module 1, function 1.19, OQ-48): safeguards against a "Set up for my parent" arrangement being pushed on someone.
-- Not applied to production by this session.
--
-- A proxy can only ever get access through the parent's own confirmation (S04, safety case 23). What was missing is the
-- parent's way OUT and the parent's way to SEE who is behind the access:
--   1. my_proxy_arrangements(): what the parent sees on their own account, always: who set this up (first name), since when,
--      what they were given. It is read from the setup row, so it cannot be hidden by the proxy.
--   2. end_proxy_access(): the parent ends the access instantly, in one call, from their own session. The grant goes, its
--      categories go with it, and the ending is recorded.
--   3. A cooling-off: after the parent ends an arrangement, the same proxy cannot start a new setup for that parent's number
--      until blocks_until. The number of days is PROPOSED config (proxy.setup.coolingOffDays), passed by the caller and capped
--      here; the parent can still invite the person again from their own account (Care Circle) whenever they choose.
--
-- Counted first: proxy_setups holds few or no rows live; no ending exists, so no existing arrangement is affected.

create table public.proxy_access_endings (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  parent_id       uuid not null references public.profiles (id) on delete cascade,
  proxy_id        uuid not null references public.profiles (id) on delete cascade,
  ended_at        timestamptz not null default now(),
  blocks_until    timestamptz not null,
  is_test         boolean not null default false,
  check (blocks_until >= ended_at)
);
create index proxy_access_endings_proxy_idx on public.proxy_access_endings (proxy_id, blocks_until);
alter table public.proxy_access_endings enable row level security;
revoke all on public.proxy_access_endings from public, anon, authenticated;
grant select on public.proxy_access_endings to authenticated;
-- The parent reads their own endings. The proxy reads nothing here: the refusal they get names no one.
create policy proxy_access_endings_parent on public.proxy_access_endings for select to authenticated
  using (parent_id = (select auth.uid()));

create function public.my_proxy_arrangements() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'proxy_not_authorised' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'grant_id', pa.id,
             'set_up_by', split_part(coalesce(nullif(btrim(g.full_name), ''), 'Someone'), ' ', 1),
             'since', s.confirmed_at,
             'categories', coalesce((select jsonb_agg(pac.category order by pac.category) from public.profile_access_categories pac where pac.profile_access_id = pa.id), '[]'::jsonb))
             order by s.confirmed_at)
      from public.proxy_setups s
      join public.profile_access pa on pa.profile_id = s.confirmed_profile_id and pa.grantee_user_id = s.created_by_profile_id
      join public.profiles g on g.id = s.created_by_profile_id
     where s.state = 'confirmed' and s.confirmed_profile_id = v_uid), '[]'::jsonb);
end $$;
revoke all on function public.my_proxy_arrangements() from public, anon;
grant execute on function public.my_proxy_arrangements() to authenticated;

create function public.end_proxy_access(p_grant uuid, p_block_days integer default 30) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pa public.profile_access%rowtype;
  p public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'proxy_not_authorised' using errcode = '42501'; end if;
  select * into pa from public.profile_access where id = p_grant and profile_id = v_uid for update;
  if not found then raise exception 'proxy_arrangement_not_found' using errcode = 'P0002'; end if;
  select * into p from public.profiles where id = v_uid;
  delete from public.profile_access where id = pa.id;
  -- Only an arrangement that began as a setup starts a cooling-off; ending any other grant is just ending it.
  if exists (select 1 from public.proxy_setups s where s.state = 'confirmed' and s.confirmed_profile_id = v_uid and s.created_by_profile_id = pa.grantee_user_id) then
    insert into public.proxy_access_endings (organisation_id, parent_id, proxy_id, blocks_until, is_test)
    values (p.organisation_id, v_uid, pa.grantee_user_id, now() + make_interval(days => greatest(1, least(coalesce(p_block_days, 30), 365))), p.is_test);
  end if;
  perform private.log_audit('proxy_access.ended', 'profile', v_uid, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.end_proxy_access(uuid, integer) from public, anon;
grant execute on function public.end_proxy_access(uuid, integer) to authenticated;

-- A new setup for a parent who ended the last one is refused until blocks_until.
create function private.enforce_proxy_cooling_off() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.proxy_access_endings e join public.profiles par on par.id = e.parent_id
     where e.proxy_id = new.created_by_profile_id and e.blocks_until > now()
       and regexp_replace(coalesce(par.phone, ''), '\D', '', 'g') = regexp_replace(new.target_phone_e164, '\D', '', 'g')) then
    raise exception 'proxy_setup_cooling_off' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.enforce_proxy_cooling_off() from public, anon, authenticated;
create trigger proxy_setups_cooling_off before insert on public.proxy_setups
  for each row execute function private.enforce_proxy_cooling_off();

do $$
begin
  if has_function_privilege('anon', 'public.end_proxy_access(uuid,integer)', 'EXECUTE') then raise exception 'S42: anon can end proxy access'; end if;
  if has_table_privilege('authenticated', 'public.proxy_access_endings', 'INSERT,UPDATE,DELETE') then raise exception 'S42: proxy_access_endings writable directly'; end if;
end $$;
