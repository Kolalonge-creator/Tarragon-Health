-- Tarragon Health — cover the 3 foreign keys the performance advisor
-- flagged as unindexed on the FHIR import tables (api_key_id, confirmed_by,
-- dismissed_by_staff). Purely additive, no behavior change.

create index if not exists fhir_import_batches_api_key_idx
  on public.fhir_import_batches (api_key_id);

create index if not exists fhir_import_proposed_resources_confirmed_by_idx
  on public.fhir_import_proposed_resources (confirmed_by)
  where confirmed_by is not null;

create index if not exists fhir_import_proposed_resources_dismissed_by_staff_idx
  on public.fhir_import_proposed_resources (dismissed_by_staff)
  where dismissed_by_staff is not null;

do $$
begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'fhir_import_batches_api_key_idx'
  ) then
    raise exception 'fhir_import_batches_api_key_idx missing after migration';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'fhir_import_proposed_resources_confirmed_by_idx'
  ) then
    raise exception 'fhir_import_proposed_resources_confirmed_by_idx missing after migration';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'fhir_import_proposed_resources_dismissed_by_staff_idx'
  ) then
    raise exception 'fhir_import_proposed_resources_dismissed_by_staff_idx missing after migration';
  end if;
end $$;
