-- Bug found in browser QA immediately after shipping admin_search_patients
-- (20260912220307): PostgREST returned 42804 "structure of query does not
-- match function result type" for every real call. Root cause: auth.users.email
-- is character varying(255), and PL/pgSQL's RETURN QUERY (unlike a plain
-- LANGUAGE SQL function's RETURNS TABLE, which implicitly coerces) requires an
-- exact type match against the declared OUT column (text). profiles.full_name
-- and profiles.phone are already text, so only email needs the cast.
create or replace function public.admin_search_patients(p_query text)
returns table (
  id        uuid,
  full_name text,
  email     text,
  phone     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, u.email::text, p.phone
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'patient'
    and (
      p.full_name ilike '%' || p_query || '%'
      or p.phone ilike '%' || p_query || '%'
      or u.email ilike '%' || p_query || '%'
    )
  order by p.full_name nulls last
  limit 25;
end;
$$;

revoke all on function public.admin_search_patients(text) from public, anon;
grant execute on function public.admin_search_patients(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_search_patients(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute admin_search_patients';
  end if;
end $$;
