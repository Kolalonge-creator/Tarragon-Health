-- Ergonomic RPC wrapper for logging a navigation request (75.4), mirroring
-- start_care_thread's shape. The BEFORE INSERT trigger
-- (private.enforce_navigation_request_insert, added in
-- 20260829143304_navigation_requests.sql) remains the real enforcement
-- boundary and still runs on this RPC's INSERT -- this only exists because
-- organisation_id is NOT NULL with no default, which makes a direct
-- Supabase client insert from TypeScript structurally require a value the
-- trigger is going to overwrite anyway.

create or replace function public.create_navigation_request(
  p_category public.navigation_request_category,
  p_description text,
  p_is_complaint boolean default false,
  p_patient_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  insert into public.navigation_requests (patient_id, category, description, is_complaint)
  values (
    coalesce(p_patient_id, (select auth.uid())),
    p_category,
    p_description,
    p_is_complaint
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_navigation_request(public.navigation_request_category, text, boolean, uuid) from public, anon;
grant execute on function public.create_navigation_request(public.navigation_request_category, text, boolean, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'create_navigation_request' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'create_navigation_request missing after migration';
  end if;
  raise notice 'PASS: create_navigation_request present';
end $$;
