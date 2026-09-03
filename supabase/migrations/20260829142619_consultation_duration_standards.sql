-- Tarragon Health
-- Specialist Network & Provider Platform — standardised consultation
-- durations with governed exceptions (66.7). Tarragon-wide defaults per
-- (consultation_method, duration_type), admin-editable; a specific
-- provider's availability rule (see the availability-rules migration) can
-- still set its own slot_duration_minutes different from the default — that
-- explicit, admin-authored deviation IS the "governed exception" the spec
-- asks for, not a separate approval workflow layered on top.
--
-- Per 66.7's own text ("Exact durations should be determined by operational
-- testing and specialty requirements"), the seeded minutes below are
-- starting points, not a permanent platform decision.
create type public.consultation_duration_type as enum (
  'standard',
  'extended',
  'follow_up'
);

create table public.platform_consultation_duration_defaults (
  consultation_method public.appointment_consultation_method not null,
  duration_type       public.consultation_duration_type not null,
  default_minutes     smallint not null check (default_minutes > 0),
  updated_at          timestamptz not null default now(),
  primary key (consultation_method, duration_type)
);

alter table public.platform_consultation_duration_defaults enable row level security;

create policy platform_consultation_duration_defaults_select
  on public.platform_consultation_duration_defaults
  for select to authenticated using (true);
create policy platform_consultation_duration_defaults_insert
  on public.platform_consultation_duration_defaults
  for insert to authenticated with check (private.is_admin());
create policy platform_consultation_duration_defaults_update
  on public.platform_consultation_duration_defaults
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy platform_consultation_duration_defaults_delete
  on public.platform_consultation_duration_defaults
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.platform_consultation_duration_defaults to authenticated;

-- Telemedicine offers all three types per the spec's example; physical
-- (in_person) offers standard/extended only — 66.7 lists no physical
-- follow-up type distinct from a standard physical visit.
insert into public.platform_consultation_duration_defaults (consultation_method, duration_type, default_minutes) values
  ('telemedicine', 'standard', 20),
  ('telemedicine', 'extended', 40),
  ('telemedicine', 'follow_up', 15),
  ('in_person', 'standard', 30),
  ('in_person', 'extended', 60)
on conflict do nothing;

do $$
begin
  if not exists (select 1 from public.platform_consultation_duration_defaults) then
    raise exception 'platform_consultation_duration_defaults seed rows were not inserted';
  end if;
end $$;
