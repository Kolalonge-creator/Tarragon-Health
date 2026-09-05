alter table public.clinician_alerts
  alter column severity set default 0,
  alter column dedup_key set default '';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts'
      and column_name = 'severity' and column_default is not null
  ) then
    raise exception 'clinician_alerts.severity default was not set';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts'
      and column_name = 'dedup_key' and column_default is not null
  ) then
    raise exception 'clinician_alerts.dedup_key default was not set';
  end if;
  raise notice 'PASS: clinician_alerts.severity/dedup_key have inert defaults, trigger still overwrites both unconditionally';
end $$;
