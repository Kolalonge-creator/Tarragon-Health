-- Links the yearly Health Check orchestration row to the specific Screen-tier
-- lab_orders row the patient actually paid for, so the app can read which
-- tier (Core/Advanced/Comprehensive) applies to this year's check instead of
-- annual_health_checks being a generic, tier-blind progress tracker.
alter table public.annual_health_checks
  add column if not exists lab_order_id uuid references public.lab_orders(id) on delete set null;

create index if not exists idx_annual_health_checks_lab_order
  on public.annual_health_checks(lab_order_id);

create or replace function private.link_screen_order_to_annual_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle_code text;
  v_year int;
  v_check_id uuid;
begin
  if not (new.status = 'payment_confirmed' and old.status is distinct from 'payment_confirmed') then
    return new;
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
  after update on public.lab_orders
  for each row execute function private.link_screen_order_to_annual_check();

revoke all on function private.link_screen_order_to_annual_check() from public;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from information_schema.columns
    where table_schema = 'public' and table_name = 'annual_health_checks' and column_name = 'lab_order_id';
  if v_count <> 1 then
    raise exception 'annual_health_checks.lab_order_id should exist';
  end if;

  if not has_table_privilege('authenticated', 'public.annual_health_checks', 'select') then
    raise exception 'authenticated should retain SELECT on annual_health_checks';
  end if;
end $$;
