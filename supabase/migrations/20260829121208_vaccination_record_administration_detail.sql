-- Tarragon Health — Vaccination & Immunisation Engine, gap closure 1/3
--
-- Closes a spec §43.2 gap: a vaccination_records row already carries vaccine,
-- dose, date, provider and documentation (certificate_url/
-- physical_certificate_path), but has no field for batch/lot number,
-- route/site of administration, or the location the dose was given at
-- (distinct from `provider`, which is the clinic/pharmacy name). All four are
-- "where available"/"where relevant" per spec — self-reported historical
-- doses routinely won't have them, so every column here is nullable.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vaccination_route') then
    create type public.vaccination_route as enum (
      'oral', 'intramuscular', 'subcutaneous', 'intradermal', 'intranasal', 'other'
    );
  end if;
end $$;

alter table public.vaccination_records
  add column if not exists batch_lot_number text,
  add column if not exists route public.vaccination_route,
  -- Free text (e.g. "left deltoid", "right thigh") — sites vary too much
  -- across vaccine types and ages to usefully enumerate.
  add column if not exists site text,
  -- Where the dose was physically given (clinic/centre name or address) —
  -- kept distinct from `provider`, which names the provider/clinic itself.
  add column if not exists location text,
  add constraint vaccination_records_batch_lot_number_length
    check (batch_lot_number is null or char_length(batch_lot_number) between 1 and 100),
  add constraint vaccination_records_site_length
    check (site is null or char_length(site) between 1 and 200),
  add constraint vaccination_records_location_length
    check (location is null or char_length(location) between 1 and 200);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vaccination_route') then
    raise exception 'vaccination_route enum was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vaccination_records'
      and column_name in ('batch_lot_number', 'route', 'site', 'location')
    having count(*) = 4
  ) then
    raise exception 'vaccination_records is missing one or more administration-detail columns';
  end if;
  raise notice 'PASS: vaccination_records administration-detail columns present';
end $$;
