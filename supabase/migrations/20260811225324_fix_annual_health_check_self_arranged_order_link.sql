-- Fixes a structural gap: lab_orders_link_annual_check
-- (20260802224321_annual_health_checks_link_screen_order.sql) only ever
-- fired on the UPDATE transition into status = 'payment_confirmed'. One day
-- later, 20260803124833_self_arranged_lab_fulfilment.sql made every
-- lab_order self-arranged by default and made 'payment_confirmed'
-- structurally unreachable for that path: private.enforce_lab_order_origin
-- rejects a self_arranged order at status = 'pending_payment' and requires
-- total_kobo = 0, and the real patient/clinician insert paths
-- (apps/web/src/lib/queries/lab-orders.ts useCreateLabOrder/useOrderLabTest)
-- create the row directly at status = 'ordered'. Every Core/Advanced/
-- Comprehensive Screen order requested since then has silently never linked
-- to that year's annual_health_checks row. Confirmed live before this
-- migration: 1 self-arranged Screen-tier lab_order exists, 0
-- annual_health_checks rows carry a lab_order_id.
--
-- Fix: fire the same linkage on INSERT for a self-arranged order landing
-- straight at 'ordered' (the only transition that path actually goes
-- through), alongside the pre-existing UPDATE-into-'payment_confirmed'
-- branch, which is kept byte-for-byte for the day a partner-billed path is
-- live again.
create or replace function private.link_screen_order_to_annual_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle_code text;
  v_year int;
begin
  if tg_op = 'INSERT' then
    if not (new.fulfilment = 'self_arranged' and new.status = 'ordered') then
      return new;
    end if;
  else
    if not (new.status = 'payment_confirmed' and old.status is distinct from 'payment_confirmed') then
      return new;
    end if;
  end if;

  select code into v_bundle_code from public.panel_bundles where id = new.panel_bundle_id;
  if v_bundle_code not in ('screen_core', 'screen_advanced', 'screen_comprehensive') then
    return new;
  end if;

  v_year := extract(year from (now() at time zone 'Africa/Lagos'))::int;

  insert into public.annual_health_checks (organisation_id, patient_id, year, status, lab_order_id)
  values (new.organisation_id, new.patient_id, v_year, 'in_progress', new.id)
  on conflict (patient_id, year) do update
    set lab_order_id = coalesce(public.annual_health_checks.lab_order_id, excluded.lab_order_id),
        status = case
          when public.annual_health_checks.status = 'pending' then 'in_progress'
          else public.annual_health_checks.status
        end;

  return new;
end;
$$;

drop trigger if exists lab_orders_link_annual_check on public.lab_orders;
create trigger lab_orders_link_annual_check
  after insert or update on public.lab_orders
  for each row execute function private.link_screen_order_to_annual_check();

revoke all on function private.link_screen_order_to_annual_check() from public;

-- ---------------------------------------------------------------------------
-- Backfill: close the live gap for self-arranged Screen orders created
-- before this fix existed, using the order's own created_at year rather than
-- today's year (matches what the trigger would have recorded had it fired
-- at insert time). Cancelled orders are skipped — nothing to track.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_year int;
begin
  for r in
    select lo.id, lo.organisation_id, lo.patient_id, lo.created_at
    from public.lab_orders lo
    join public.panel_bundles pb on pb.id = lo.panel_bundle_id
    where pb.code in ('screen_core', 'screen_advanced', 'screen_comprehensive')
      and lo.fulfilment = 'self_arranged'
      and lo.status <> 'cancelled'
      and not exists (
        select 1 from public.annual_health_checks ahc where ahc.lab_order_id = lo.id
      )
  loop
    v_year := extract(year from (r.created_at at time zone 'Africa/Lagos'))::int;

    insert into public.annual_health_checks (organisation_id, patient_id, year, status, lab_order_id)
    values (r.organisation_id, r.patient_id, v_year, 'in_progress', r.id)
    on conflict (patient_id, year) do update
      set lab_order_id = coalesce(public.annual_health_checks.lab_order_id, excluded.lab_order_id),
          status = case
            when public.annual_health_checks.status = 'pending' then 'in_progress'
            else public.annual_health_checks.status
          end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_trigger_events text;
  v_orphans int;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'link_screen_order_to_annual_check' and pronamespace = 'private'::regnamespace;
  if v_def not like '%fulfilment = ''self_arranged'' and new.status = ''ordered''%' then
    raise exception 'link_screen_order_to_annual_check is missing the self-arranged INSERT branch';
  end if;
  if v_def not like '%new.status = ''payment_confirmed'' and old.status is distinct from ''payment_confirmed''%' then
    raise exception 'link_screen_order_to_annual_check lost the payment_confirmed UPDATE branch';
  end if;

  select string_agg(distinct event_manipulation, ',' order by event_manipulation)
    into v_trigger_events
  from information_schema.triggers
  where event_object_table = 'lab_orders' and trigger_name = 'lab_orders_link_annual_check';
  if v_trigger_events is distinct from 'INSERT,UPDATE' then
    raise exception 'lab_orders_link_annual_check should fire on INSERT and UPDATE, found: %', coalesce(v_trigger_events, '<none>');
  end if;

  -- No active, self-arranged Screen order should be left unlinked after the
  -- backfill above.
  select count(*) into v_orphans
  from public.lab_orders lo
  join public.panel_bundles pb on pb.id = lo.panel_bundle_id
  where pb.code in ('screen_core', 'screen_advanced', 'screen_comprehensive')
    and lo.fulfilment = 'self_arranged'
    and lo.status <> 'cancelled'
    and not exists (select 1 from public.annual_health_checks ahc where ahc.lab_order_id = lo.id);
  if v_orphans > 0 then
    raise exception 'backfill left % self-arranged Screen order(s) unlinked from annual_health_checks', v_orphans;
  end if;
end $$;
