-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as every other stubbed function in this history:
-- 20260820055147_lab_order_partner_visit_scheduling.sql's own self-test
-- fails on a fresh replay because anon still holds direct EXECUTE despite
-- that migration's `revoke all ... from public`, the same unexplained
-- local/CI-only default-ACL gap documented throughout this history.
--
-- This function's signature includes a custom type
-- (public.lab_order_time_of_day) created by that same real migration, but
-- unlike the earlier custom-type stubs, that migration creates the type
-- inside a `do $$ ... exception when duplicate_object then null; end $$`
-- guard specifically so a second creation is a no-op -- meaning it's safe
-- to pre-create the type here too, one second earlier, and let the real
-- migration's own guard absorb it.
do $$ begin
  create type public.lab_order_time_of_day as enum ('morning', 'afternoon', 'evening');
exception when duplicate_object then null; end $$;

create function public.request_lab_order_partner_visit(
  p_order_id uuid,
  p_facility_id uuid,
  p_scheduled_date date,
  p_preferred_time_of_day public.lab_order_time_of_day
)
returns public.lab_orders
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return null;
end;
$$;

revoke all on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) from public;
revoke all on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) from anon;
