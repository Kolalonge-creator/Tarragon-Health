-- ===========================================================================
-- S04: "Set up for my parent" (v5 8.2, function 1.19, safety case 23; INV-08, INV-10, INV-12).
--
-- Counted first (live, 2026-09-30): proxy_setups has 0 rows, so this is purely additive, no conversion step.
--
-- The proxy sees NOTHING until the parent confirms, and that is structural: the proxy's only access to the parent is a
-- profile_access row (plus profile_access_categories), and the only code that creates one for a setup is
-- confirm_proxy_setup, which only the holder of the parent's verified phone number can call. Before that there is no
-- grant for any policy to allow. The proxy reads their own proxy_setups row (the name and phone they typed, and its state).
--
-- The code SMS is the existing auth hook's verification code (INV-08); nothing here sends a message. No function here
-- tells the caller whether the number already has an account. The legacy all-or-nothing profile_access.clinical_access
-- flag is deliberately left false: older policies may still read it as a broader gate than the category model.
-- ===========================================================================

-- A new setup for the same creator and number replaces a lapsed one (the partial unique index only covers pending rows).
-- SECURITY DEFINER because the authenticated role has no UPDATE on proxy_setups by design.
create or replace function public.create_proxy_setup(
  p_full_name text,
  p_phone text,
  p_ttl_hours integer,
  p_max_per_day integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid;
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_id    uuid;
  v_own   text;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select organisation_id, phone into v_org, v_own from public.profiles where id = v_uid;
  if v_org is null then
    raise exception 'no profile' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 200 then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone must be E.164' using errcode = '22023';
  end if;
  if p_ttl_hours is null or p_ttl_hours not between 1 and 72 then
    raise exception 'ttl must be 1 to 72 hours' using errcode = '22023';
  end if;
  if p_max_per_day is null or p_max_per_day not between 1 and 20 then
    raise exception 'daily cap must be 1 to 20' using errcode = '22023';
  end if;
  if v_own is not null
     and regexp_replace(v_own, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') then
    raise exception 'that is your own number' using errcode = '22023';
  end if;

  update public.proxy_setups
     set state = 'expired'
   where created_by_profile_id = v_uid and state = 'pending_confirmation' and expires_at <= now();

  -- Idempotent: the same number again while one is still live returns that setup, so repeating the action neither
  -- errors nor reveals anything.
  select id into v_id from public.proxy_setups
   where created_by_profile_id = v_uid and target_phone_e164 = p_phone and state = 'pending_confirmation';
  if v_id is not null then
    return v_id;
  end if;

  if (select count(*) from public.proxy_setups
       where created_by_profile_id = v_uid and created_at > now() - interval '24 hours') >= p_max_per_day then
    raise exception 'proxy_setup_rate_limited' using errcode = 'P0001';
  end if;

  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
  values (v_org, v_uid, v_name, p_phone, now() + make_interval(hours => p_ttl_hours))
  returning id into v_id;

  -- No phone number or name in the trail: the row id is enough to find it.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, v_uid, 'proxy_setup.created', 'proxy_setup', v_id, '{}'::jsonb, 'success');
  return v_id;
end;
$$;

-- What the PARENT sees after signing in on their own phone: who is asking and until when. Matched on the verified
-- number on auth.users, never on anything the caller supplies.
create or replace function public.my_pending_proxy_setups()
returns table (id uuid, requester_first_name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select ps.id, split_part(btrim(pr.full_name), ' ', 1), ps.expires_at
    from public.proxy_setups ps
    join auth.users u on u.id = (select auth.uid())
    join public.profiles pr on pr.id = ps.created_by_profile_id
   where ps.state = 'pending_confirmation'
     and ps.expires_at > now()
     and u.phone_confirmed_at is not null
     and regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(ps.target_phone_e164, '\D', '', 'g')
     and ps.created_by_profile_id <> u.id
   order by ps.created_at desc;
$$;

-- The parent confirms, choosing what the proxy may see. The grant is created in this transaction and only here.
create or replace function public.confirm_proxy_setup(
  p_setup_id uuid,
  p_categories public.care_access_category[],
  p_permissions public.caregiver_permission[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_setup public.proxy_setups;
  v_phone text;
  v_confirmed timestamptz;
  v_grant uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_setup from public.proxy_setups where id = p_setup_id for update;
  select phone, phone_confirmed_at into v_phone, v_confirmed from auth.users where id = v_uid;

  -- One answer for every reason this cannot proceed (no such setup, someone else's number, unverified phone,
  -- already answered, expired): the caller learns nothing about which.
  if v_setup.id is null
     or v_confirmed is null
     or regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') <> regexp_replace(v_setup.target_phone_e164, '\D', '', 'g')
     or v_setup.state <> 'pending_confirmation'
     or v_setup.expires_at <= now()
     or v_setup.created_by_profile_id = v_uid then
    raise exception 'this setup cannot be confirmed' using errcode = '42501';
  end if;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions)
  values (v_uid, v_setup.created_by_profile_id, 'view', v_uid, coalesce(p_permissions, '{}'))
  on conflict (profile_id, grantee_user_id)
  do update set permissions = excluded.permissions, updated_at = now()
  returning id into v_grant;

  delete from public.profile_access_categories
   where profile_access_id = v_grant
     and category <> all (coalesce(p_categories, array[]::public.care_access_category[]));
  insert into public.profile_access_categories (profile_access_id, category)
  select v_grant, c from unnest(coalesce(p_categories, array[]::public.care_access_category[])) as c
  on conflict (profile_access_id, category) do nothing;

  update public.proxy_setups
     set state = 'confirmed', confirmed_at = now(), confirmed_profile_id = v_uid
   where id = v_setup.id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (v_setup.organisation_id, v_uid, 'proxy_setup.confirmed', 'proxy_setup', v_setup.id,
          jsonb_build_object('category_count', cardinality(coalesce(p_categories, array[]::public.care_access_category[]))),
          'success', v_uid);
  return v_grant;
end;
$$;

create or replace function public.decline_proxy_setup(p_setup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_setup public.proxy_setups;
  v_phone text;
  v_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_setup from public.proxy_setups where id = p_setup_id for update;
  select phone, phone_confirmed_at into v_phone, v_confirmed from auth.users where id = v_uid;
  if v_setup.id is null
     or v_confirmed is null
     or regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') <> regexp_replace(v_setup.target_phone_e164, '\D', '', 'g')
     or v_setup.state <> 'pending_confirmation' then
    raise exception 'this setup cannot be declined' using errcode = '42501';
  end if;
  update public.proxy_setups set state = 'declined' where id = v_setup.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_setup.organisation_id, v_uid, 'proxy_setup.declined', 'proxy_setup', v_setup.id, '{}'::jsonb, 'success');
end;
$$;

-- Daily sweep. A pending setup past its expiry is also refused by the functions above, so this only tidies state.
create or replace function private.expire_proxy_setups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.proxy_setups set state = 'expired'
   where state = 'pending_confirmation' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Explicit, because both default ACLs hand EXECUTE out: PUBLIC on public.*, authenticated on private.*.
revoke all on function public.create_proxy_setup(text, text, integer, integer) from public, anon;
revoke all on function public.my_pending_proxy_setups() from public, anon;
revoke all on function public.confirm_proxy_setup(uuid, public.care_access_category[], public.caregiver_permission[]) from public, anon;
revoke all on function public.decline_proxy_setup(uuid) from public, anon;
revoke all on function private.expire_proxy_setups() from public, anon, authenticated;
grant execute on function public.create_proxy_setup(text, text, integer, integer) to authenticated;
grant execute on function public.my_pending_proxy_setups() to authenticated;
grant execute on function public.confirm_proxy_setup(uuid, public.care_access_category[], public.caregiver_permission[]) to authenticated;
grant execute on function public.decline_proxy_setup(uuid) to authenticated;

select cron.schedule(
  'proxy-setup-expiry-daily',
  '45 3 * * *',
  $$ select private.expire_proxy_setups(); $$
);

-- Proof, not hope: nothing callable by anon, the private helper reachable by no API role.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_proxy_setup(text, text, integer, integer)',
    'public.my_pending_proxy_setups()',
    'public.confirm_proxy_setup(uuid, public.care_access_category[], public.caregiver_permission[])',
    'public.decline_proxy_setup(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'S04: anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'S04: authenticated cannot execute %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.expire_proxy_setups()', 'EXECUTE')
     or has_function_privilege('anon', 'private.expire_proxy_setups()', 'EXECUTE') then
    raise exception 'S04: private.expire_proxy_setups is callable by an API role';
  end if;
end $$;
