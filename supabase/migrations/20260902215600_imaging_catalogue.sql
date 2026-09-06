-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 2/9:
-- imaging catalogue (spec §59.3).
--
-- Mirrors lab_tests exactly: global catalogue, provider-scoped, admin-write.
-- Two-price model NOT adopted here (unlike lab_tests' price_kobo-vs-
-- screen_types.price_kobo split, 20260821191743) -- there is no contracted
-- imaging partner today for Tarragon to owe a cost price to (see part 1's
-- header); price_kobo here is simply the patient-facing price at that
-- provider/location, same posture screen_types.price_kobo takes for
-- self-arranged services. Revisit the two-price split if/when a real
-- imaging partner is signed under a commission arrangement, the same way
-- lab_tests grew one only once Synlab was.
--
-- default_safety_questionnaire_key (nullable) names which questionnaire
-- template (part 4) a clinician should complete for this study -- e.g.
-- 'mri_safety_v1' for any MRI study, 'ct_contrast_v1' for a contrast CT,
-- null for a plain X-ray. The exact question set per template lives in app
-- code / the questionnaire's own `questions` jsonb snapshot (spec §59.6:
-- "the exact questions depend on the investigation"), not enumerated here.

create table public.imaging_studies (
  id                              uuid primary key default gen_random_uuid(),
  provider_id                     uuid not null references public.imaging_providers (id) on delete cascade,
  modality                        public.imaging_modality not null,
  code                            text not null,
  name                            text not null,
  indication_category             text,
  duration_minutes                integer,
  preparation_instructions        text,
  default_safety_questionnaire_key text,
  price_kobo                      bigint not null default 0,
  turnaround_hours                integer,
  is_active                       boolean not null default true,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (provider_id, code),
  constraint imaging_studies_duration_positive check (duration_minutes is null or duration_minutes > 0),
  constraint imaging_studies_turnaround_positive check (turnaround_hours is null or turnaround_hours > 0),
  constraint imaging_studies_price_non_negative check (price_kobo >= 0)
);

create index imaging_studies_provider_idx on public.imaging_studies (provider_id);
create index imaging_studies_modality_idx on public.imaging_studies (modality) where is_active;

create trigger imaging_studies_set_updated_at
  before update on public.imaging_studies
  for each row execute function private.set_updated_at();

alter table public.imaging_studies enable row level security;

create policy imaging_studies_select on public.imaging_studies
  for select to authenticated using (true);

create policy imaging_studies_insert on public.imaging_studies
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.imaging.manage'));

create policy imaging_studies_update on public.imaging_studies
  for update to authenticated
  using (private.is_admin() or private.has_permission('partners.imaging.manage'))
  with check (private.is_admin() or private.has_permission('partners.imaging.manage'));

create policy imaging_studies_delete on public.imaging_studies
  for delete to authenticated
  using (private.is_admin() or private.has_permission('partners.imaging.manage'));

grant select, insert, update, delete on public.imaging_studies to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.imaging_studies', 'SELECT') then
    raise exception 'imaging_studies: authenticated SELECT grant did not take';
  end if;
  raise notice 'PASS: imaging_studies catalogue in place';
end $$;
