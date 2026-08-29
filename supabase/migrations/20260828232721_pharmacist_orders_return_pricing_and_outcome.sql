-- Tarragon Health -- pharmacist_orders() needs to expose price/outcome
-- fields for the new accept/decline UI (pharmacist_accept_order/
-- pharmacist_decline_order, previous migration) to work from -- a
-- pharmacist confirming a price has to see what the patient already paid,
-- and the worklist needs to show the outcome of an order already acted on.
-- Postgres refuses CREATE OR REPLACE when a RETURNS TABLE shape changes
-- (42P13), so the function is dropped and recreated; its grants are
-- reapplied in the same migration.

drop function if exists public.pharmacist_orders();

create function public.pharmacist_orders()
returns table (
  order_id uuid,
  order_number text,
  status text,
  patient_name text,
  patient_number text,
  items jsonb,
  requested_at timestamptz,
  payable_kobo bigint,
  confirmed_quantity text,
  confirmed_price_kobo bigint,
  estimated_fulfilment_at timestamptz,
  cancellation_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, p.full_name, p.patient_number, o.items, o.requested_at,
         coalesce(o.payable_kobo, o.total_kobo), o.confirmed_quantity, o.confirmed_price_kobo,
         o.estimated_fulfilment_at, o.cancellation_reason
  from public.pharmacy_orders o
  join public.profiles p on p.id = o.patient_id
  where private.pharmacist_partner() is not null
    and o.pharmacy_partner_id = private.pharmacist_partner()
  order by o.requested_at desc;
$$;

revoke execute on function public.pharmacist_orders() from public;
revoke execute on function public.pharmacist_orders() from anon;
grant execute on function public.pharmacist_orders() to authenticated;

do $$
declare
  v_cols text[];
begin
  select array_agg(a.attname order by a.attnum) into v_cols
  from pg_proc pr
  join pg_type t on t.oid = pr.prorettype
  join pg_attribute a on a.attrelid = t.typrelid and a.attnum > 0
  where pr.proname = 'pharmacist_orders' and pr.pronamespace = 'public'::regnamespace;

  if not ('payable_kobo' = any(v_cols)) then
    raise exception 'FAIL: pharmacist_orders() does not return payable_kobo';
  end if;
  if not ('cancellation_reason' = any(v_cols)) then
    raise exception 'FAIL: pharmacist_orders() does not return cancellation_reason';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_orders()', 'execute') then
    raise exception 'FAIL: pharmacist_orders is anon-executable';
  end if;
  raise notice 'PASS: pharmacist_orders() now returns pricing/outcome fields';
end $$;
