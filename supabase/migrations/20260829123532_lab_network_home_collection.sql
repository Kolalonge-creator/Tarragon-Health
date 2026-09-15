-- Laboratory Network, part 8: home sample collection with phlebotomist
-- assignment (§56.8) — request -> location verified -> phlebotomist assigned
-- -> appointment -> sample collected -> courier -> laboratory.
--
-- home_visit_provider_id/home_visit_scheduled_at/courier_reference already
-- exist on lab_orders (20260715230129) and cover the "which agency, when,
-- what courier reference" part. What's missing is WHO is actually coming —
-- a named phlebotomist a patient can expect at the door — and a single,
-- guarded entry point that proves "location verified" (region_service_
-- available for 'home_visit') before anyone is assigned, rather than
-- trusting the caller to have checked.

alter table public.lab_orders
  add column if not exists phlebotomist_name  text,
  add column if not exists phlebotomist_phone text;

alter table public.lab_orders
  drop constraint if exists lab_orders_phlebotomist_phone_e164;
alter table public.lab_orders
  add constraint lab_orders_phlebotomist_phone_e164
  check (phlebotomist_phone is null or phlebotomist_phone ~ '^\+[1-9][0-9]{7,14}$');

comment on column public.lab_orders.phlebotomist_name is
  'Who is actually coming to draw the sample, set once a real home_visit_providers agency assigns someone — see assign_home_phlebotomist. Null until assigned.';

-- Staff/lab-partner assignment entry point. SECURITY DEFINER for the same
-- reason set_lab_order_facility/request_lab_order_partner_visit are —
-- lab_orders_update RLS is staff-only, so a lab_partner (who does not pass
-- is_org_staff) needs its own narrow, checked door.
create or replace function public.assign_home_phlebotomist(
  p_order_id             uuid,
  p_home_visit_provider_id uuid,
  p_phlebotomist_name    text,
  p_phlebotomist_phone   text,
  p_scheduled_at         timestamptz
)
returns public.lab_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    public.lab_orders%rowtype;
  v_provider public.home_visit_providers%rowtype;
  v_is_staff boolean;
  v_is_owning_lab_partner boolean;
  v_state    text;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Lab order not found' using errcode = '42501';
  end if;

  -- Split into two named booleans rather than one inline "NOT (A OR (B AND
  -- C))" expression — with SQL's three-valued logic, `v_order.provider_id =
  -- private.lab_partner_provider()` is NULL (not false) when the caller is
  -- not a lab partner at all, which would make the whole OR NULL and the
  -- surrounding NOT NULL — and PL/pgSQL's `if null then` does not raise,
  -- silently skipping the refusal for exactly the caller it exists to
  -- refuse. Each boolean below is computed to be definitely true or false
  -- before the IF ever sees it.
  v_is_staff := private.is_org_staff(v_order.organisation_id);
  v_is_owning_lab_partner := v_order.provider_id is not null
    and private.lab_partner_provider() is not null
    and v_order.provider_id = private.lab_partner_provider();
  if not (v_is_staff or v_is_owning_lab_partner) then
    raise exception 'Not authorized for this lab order' using errcode = '42501';
  end if;

  if v_order.fulfilment <> 'partner' then
    raise exception 'Only a partner-fulfilled order can have a Tarragon-arranged home collection — a self-arranged patient arranges their own' using errcode = '23514';
  end if;
  if v_order.status not in ('payment_confirmed', 'ordered') then
    raise exception 'This order is not in a state that can still be scheduled for collection' using errcode = '23514';
  end if;
  if p_scheduled_at <= now() then
    raise exception 'Choose a time that has not already passed' using errcode = '23514';
  end if;

  select * into v_provider from public.home_visit_providers where id = p_home_visit_provider_id and is_active;
  if v_provider.id is null then
    raise exception 'This home-visit provider is not available' using errcode = '23514';
  end if;

  -- Location verified: the same public.region_service_available('home_visit')
  -- gate the patient-facing coverage checker itself uses, checked here
  -- server-side rather than assumed from whatever the UI last showed.
  select state into v_state from public.profiles where id = v_order.patient_id;
  if v_state is null or not public.region_service_available(v_state, 'home_visit') then
    raise exception 'Home sample collection is not available in % yet', coalesce(v_state, 'this patient''s state')
      using errcode = '23514';
  end if;
  if not (v_provider.regions @> array[v_state]) then
    raise exception '% does not cover %', v_provider.name, v_state using errcode = '23514';
  end if;

  update public.lab_orders
     set home_visit_provider_id = p_home_visit_provider_id,
         home_visit_scheduled_at = p_scheduled_at,
         phlebotomist_name = p_phlebotomist_name,
         phlebotomist_phone = p_phlebotomist_phone
   where id = p_order_id
   returning * into v_order;

  -- The specimen this order is already tracking (part 5) now knows it will
  -- be a home draw, not a walk-in.
  update public.lab_specimens
     set collection_method = 'home_collection'
   where lab_order_id = p_order_id and status = 'pending_collection';

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    v_order.organisation_id, v_order.patient_id, 'in_app', 'pending',
    'lab_home_phlebotomist_assigned',
    jsonb_build_object(
      'phlebotomist_name', p_phlebotomist_name,
      'scheduled_at', p_scheduled_at,
      'provider_name', v_provider.name
    )
  );

  return v_order;
end;
$$;

revoke all on function public.assign_home_phlebotomist(uuid, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.assign_home_phlebotomist(uuid, uuid, text, text, timestamptz) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'phlebotomist_name'
  ) then
    raise exception 'lab_orders.phlebotomist_name was not created';
  end if;
  if not exists (
    select 1 from pg_proc
    where proname = 'assign_home_phlebotomist' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'assign_home_phlebotomist was not created';
  end if;
  if has_function_privilege('anon', 'public.assign_home_phlebotomist(uuid, uuid, text, text, timestamptz)', 'EXECUTE') then
    raise exception 'anon must not be able to execute assign_home_phlebotomist';
  end if;
end $$;
