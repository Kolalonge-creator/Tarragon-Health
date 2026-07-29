-- Tarragon Health — Patient-set delivery address RPC (Workstream 3)
--
-- Patients need to set their own delivery address on their own pharmacy
-- order, but pharmacy_orders_update RLS is staff-only (verified directly
-- against the live policy before writing this). Modeled directly on
-- public.claim_employer_roster_member (20260715162958_employer_roster_members.sql):
-- security definer, set search_path = '', ownership re-checked inside the
-- function body rather than trusting RLS, revoked from public/anon and
-- granted only to authenticated. This function only ever touches
-- delivery_address — it does not broaden the general UPDATE policy.

create or replace function public.set_pharmacy_order_delivery_address(
  p_order_id uuid,
  p_address jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pharmacy_orders;
begin
  select * into v_order from public.pharmacy_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Pharmacy order not found';
  end if;
  if v_order.patient_id <> (select auth.uid()) then
    raise exception 'Not authorised for this order';
  end if;

  update public.pharmacy_orders
    set delivery_address = p_address
    where id = p_order_id;

  return true;
end;
$$;

revoke execute on function public.set_pharmacy_order_delivery_address(uuid, jsonb) from public;
revoke execute on function public.set_pharmacy_order_delivery_address(uuid, jsonb) from anon;
grant execute on function public.set_pharmacy_order_delivery_address(uuid, jsonb) to authenticated;
