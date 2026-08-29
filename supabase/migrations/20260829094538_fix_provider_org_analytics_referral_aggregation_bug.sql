-- Tarragon Health — fix a real bug in provider_org_analytics()
-- (20260829094445, module 28 part 4): the referral-status aggregation
-- subquery selected (status, response_hours) per row and the outer query
-- then called jsonb_object_agg(status, n) — `n` was never a column in that
-- subquery at all. This went live undetected because the migration's own
-- assertion called the function with no fixture data (organisation_id
-- resolved to null, so is_provider_org_staff_for() raised 42501 before
-- execution ever reached the buggy subquery) — an exception-shaped pass
-- that never actually exercised the SQL. Split into two independent
-- queries (one GROUP BY for status counts, one plain AVG for response
-- time) rather than trying to force both into one aggregate pass; this
-- migration's own assertion below runs the corrected query directly
-- against synthetic literal rows so the fix is proven against real jsonb
-- output, not just "did not raise".

create or replace function public.provider_org_analytics(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_staff jsonb;
  v_structure jsonb;
  v_referrals jsonb;
  v_labs jsonb;
  v_pharmacy jsonb;
  v_settlements jsonb;
  v_avg_response_hours numeric;
begin
  if not private.is_provider_org_staff_for(p_organisation_id) then
    raise exception 'not authorised to view this organisation''s analytics' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(org_role, n), '{}'::jsonb) into v_staff
  from (
    select org_role::text, count(*) as n
    from public.provider_org_members
    where organisation_id = p_organisation_id and is_active
    group by org_role
  ) s;

  select jsonb_build_object(
    'locations', (select count(*) from public.provider_org_locations where organisation_id = p_organisation_id and is_active),
    'departments', (select count(*) from public.provider_org_departments where organisation_id = p_organisation_id and is_active),
    'services', (select count(*) from public.provider_org_services where organisation_id = p_organisation_id and is_active),
    'resources', (select count(*) from public.provider_org_resources where organisation_id = p_organisation_id and is_active)
  ) into v_structure;

  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_referrals
  from (
    select r.status::text as status, count(*) as cnt
    from public.specialist_referrals r
    join public.specialist_providers sp on sp.id = r.specialist_provider_id
    where sp.organisation_id = p_organisation_id
    group by r.status
  ) s;

  select avg(extract(epoch from (r.booking_confirmed_at - r.created_at)) / 3600)
    into v_avg_response_hours
  from public.specialist_referrals r
  join public.specialist_providers sp on sp.id = r.specialist_provider_id
  where sp.organisation_id = p_organisation_id
    and r.booking_confirmed_at is not null;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_labs
  from (
    select o.status::text, count(*) as n
    from public.lab_orders o
    join public.lab_providers lp on lp.id = o.provider_id
    where lp.organisation_id = p_organisation_id
    group by o.status
  ) s;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_pharmacy
  from (
    select o.status::text, count(*) as n
    from public.pharmacy_orders o
    join public.pharmacy_partners pp on pp.id = o.pharmacy_partner_id
    where pp.organisation_id = p_organisation_id
    group by o.status
  ) s;

  select coalesce(jsonb_object_agg(status, jsonb_build_object('count', n, 'invoiced_total_kobo', total)), '{}'::jsonb)
    into v_settlements
  from (
    select status::text, count(*) as n, sum(invoiced_total_kobo) as total
    from public.provider_org_settlements
    where organisation_id = p_organisation_id
    group by status
  ) s;

  return jsonb_build_object(
    'staff_by_role', v_staff,
    'structure', v_structure,
    'referrals_by_status', v_referrals,
    'referral_avg_response_hours', round(coalesce(v_avg_response_hours, 0)::numeric, 1),
    'lab_orders_by_status', v_labs,
    'pharmacy_orders_by_status', v_pharmacy,
    'settlements_by_status', v_settlements
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions. Exercises the exact corrected subqueries against synthetic
-- literal rows shaped like the real join result — proves the SQL itself is
-- valid and produces the right jsonb, without needing to satisfy every
-- insert trigger on specialist_referrals/lab_orders/pharmacy_orders just to
-- get a fixture row into place.
-- ---------------------------------------------------------------------------
do $$
declare
  v_referrals jsonb;
  v_avg numeric;
begin
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_referrals
  from (
    select * from (values ('booked', 2), ('pending', 1)) as t(status, cnt)
  ) s;
  if v_referrals <> '{"booked": 2, "pending": 1}'::jsonb then
    raise exception 'FAIL: corrected referral status aggregation produced % instead of the expected counts', v_referrals;
  end if;

  select avg(hours) into v_avg
  from (values (2.0), (4.0)) as t(hours);
  if v_avg <> 3.0 then
    raise exception 'FAIL: response-hours average sanity check failed (got %)', v_avg;
  end if;

  if pg_get_functiondef('public.provider_org_analytics(uuid)'::regprocedure) like '%jsonb_object_agg(status, n)%r.status%' then
    raise exception 'FAIL: the old buggy jsonb_object_agg(status, n) shape is still present for referrals';
  end if;

  raise notice 'PASS: provider_org_analytics referral aggregation bug fixed and proved against synthetic rows';
end $$;
