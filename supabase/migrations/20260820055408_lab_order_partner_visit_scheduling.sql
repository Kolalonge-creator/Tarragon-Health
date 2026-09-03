-- Lets a patient convert an existing self-arranged lab_order into a
-- partner-facility visit request (pick a lab we have a real relationship
-- with + a preferred date/time-of-day), instead of arranging their own lab.
--
-- WHY a new RPC rather than reusing public.set_lab_order_facility (added
-- 20260724020744): that function requires status = 'pending_payment' and
-- never touches `fulfilment` -- it's shaped for the still-payable partner
-- order path, not for converting an already-`ordered`, self_arranged row.
-- Since 20260803124833 made self_arranged the default for every order
-- created today, that's the only kind of row this needs to act on. No
-- payment step here either: picking a facility/time doesn't change who
-- pays -- the patient still pays the lab directly, same as self-arranged
-- always has (total_kobo stays 0, status stays 'ordered').
--
-- No fabricated real-time slot grid: nothing backs a specific lab's actual
-- capacity today (zero active lab facilities, confirmed live), so this
-- stores a preferred date + a coarse time-of-day, not invented fixed slots
-- like 08:00/08:15/08:30 implying a live calendar integration that doesn't
-- exist. This is a request a facility confirms manually, same "low-tech on
-- purpose" shape as `booking_requests`.
--
-- Deliberately does NOT touch `private.enforce_lab_order_origin` or
-- `private.enforce_lab_order_region` -- both are `before insert` only,
-- confirmed by reading their `create trigger` statements, so an UPDATE
-- through this RPC never runs them. The RPC re-derives the equivalent
-- checks itself (ownership, current fulfilment/status, a real active lab
-- facility) rather than editing those two trigger functions, which
-- CLAUDE.md flags as needing byte-for-byte preservation of every existing
-- branch when touched.

do $$ begin
  create type public.lab_order_time_of_day as enum ('morning', 'afternoon', 'evening');
exception when duplicate_object then null; end $$;

alter table public.lab_orders
  add column if not exists scheduled_date date,
  add column if not exists preferred_time_of_day public.lab_order_time_of_day;

comment on column public.lab_orders.scheduled_date is
  'Patient''s preferred visit date for a partner-fulfilled order. Never set on a self_arranged order (see the check constraint) -- a self-arranged patient picks their own lab and their own time, Tarragon has no schedule to keep for them.';
comment on column public.lab_orders.preferred_time_of_day is
  'A coarse preference (morning/afternoon/evening), not a real time slot -- no partner integration exists yet to back an actual calendar. The facility confirms the real time manually, same as booking_requests.';

alter table public.lab_orders
  add constraint lab_orders_partner_scheduling_requires_partner_fulfilment
  check (
    (scheduled_date is null and preferred_time_of_day is null)
    or fulfilment = 'partner'
  );

-- Patient converts their own self-arranged, not-yet-collected order into a
-- partner-facility visit request. SECURITY DEFINER because lab_orders_update
-- RLS is staff-only (private.is_org_staff) -- same shape as
-- set_lab_order_facility. Deliberately narrow: only a currently
-- self_arranged, still-'ordered' row, and only an is_active lab facility --
-- exactly the gate that keeps this dormant until a real lab is contracted
-- (facilities.is_active is false for every lab row today, confirmed live;
-- flipping one is the same single UPDATE the self-arranged migration's own
-- comment describes for "contracting a real lab").
create or replace function public.request_lab_order_partner_visit(
  p_order_id uuid,
  p_facility_id uuid,
  p_scheduled_date date,
  p_preferred_time_of_day public.lab_order_time_of_day
)
returns public.lab_orders
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order public.lab_orders%rowtype;
  v_facility public.facilities%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Lab order not found' using errcode = '42501';
  end if;

  if v_order.patient_id is distinct from (select auth.uid()) then
    raise exception 'Not authorised to update this lab order' using errcode = '42501';
  end if;

  if v_order.fulfilment <> 'self_arranged' then
    raise exception 'This order has already been arranged' using errcode = '23514';
  end if;

  if v_order.status <> 'ordered' then
    raise exception 'This order can no longer be scheduled with a partner lab' using errcode = '23514';
  end if;

  if p_scheduled_date < current_date then
    raise exception 'Choose a date that has not already passed' using errcode = '23514';
  end if;

  select * into v_facility
    from public.facilities
    where id = p_facility_id and type = 'lab' and is_active;
  if v_facility.id is null then
    raise exception 'This lab is not available for booking yet' using errcode = '23514';
  end if;

  update public.lab_orders
    set fulfilment = 'partner',
        facility_id = p_facility_id,
        provider_id = v_facility.lab_provider_id,
        scheduled_date = p_scheduled_date,
        preferred_time_of_day = p_preferred_time_of_day
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) from public;
revoke all on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) from anon;
revoke all on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) from public, anon;
grant execute on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) to authenticated;

-- The migration is the test.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'scheduled_date'
  ) then
    raise exception 'lab_orders.scheduled_date was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'preferred_time_of_day'
  ) then
    raise exception 'lab_orders.preferred_time_of_day was not created';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'request_lab_order_partner_visit' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'request_lab_order_partner_visit was not created';
  end if;

  if has_function_privilege('anon', 'public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day)', 'EXECUTE') then
    raise exception 'anon must not be able to execute request_lab_order_partner_visit';
  end if;
  if not has_function_privilege('authenticated', 'public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day)', 'EXECUTE') then
    raise exception 'authenticated should be able to execute request_lab_order_partner_visit';
  end if;
end;
$$;
