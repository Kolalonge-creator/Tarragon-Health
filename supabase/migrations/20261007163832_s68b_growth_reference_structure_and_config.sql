-- S68b: structure for the WHO growth reference (Module 16 function 16.10) and the versioned configuration home for S68.
--
-- WHAT IS WRONG TODAY (all found by reading the live definitions in 20260830103301_pediatric_growth_monitoring.sql, 2026-10-07):
--   1. growth_reference_lms ships EMPTY, so every child z-score is NULL (INV-16 asks for a versioned reference).
--   2. private.growth_z_score() takes the NEAREST row within 1.5 months instead of interpolating, and indexes by age in months only, so it
--      cannot hold the WHO tables that are indexed by day, or weight-for-length and weight-for-height, which are indexed by length or height.
--   3. A recumbent length and a standing height are treated as the same thing (WHO: 0.7 cm apart; the table basis changes at 24 months).
--   4. There is no weight-for-length/height, no MUAC, no plausibility check, and no record of which reference version produced a z-score.
-- This migration only changes STRUCTURE (the data load is S68c, the functions are S68d). Row counts at writing (live, 2026-10-07, read-only):
-- growth_reference_lms 0, so it is restructured in place and nothing is converted. child_growth_measurements keeps every row and column.
--
-- z-scores are NOT cached in a jsonb column (spec data-model line `z_scores jsonb` is deliberately not followed): the existing typed columns
-- are written at insert from the versioned reference, and reference_version says which table version was used (INV-16).
--
-- maternal_enabled (go-live guard, spec B.16): S37 seeded seven guards and this one is not among them. It is added here, OFF, with
-- ON CONFLICT DO NOTHING because S67 (pregnancy) needs the same row and may add it first. Its conditions are S67's to write; until then
-- go_live_conditions() returns its fail-closed "no defined condition" answer, so it can not be switched on by mistake.

-- ---------------------------------------------------------------------------
-- 1. growth_reference_lms: index by day, month, length or height; carry the reference version and the source
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from public.growth_reference_lms) then
    raise exception 'S68b: growth_reference_lms is not empty; restructuring it in place would need a data conversion this migration does not do';
  end if;
end $$;

alter table public.growth_reference_lms drop constraint if exists growth_reference_lms_sex_measurement_type_age_months_key;
drop index if exists public.growth_reference_lms_lookup_idx;
alter table public.growth_reference_lms drop column age_months;
alter table public.growth_reference_lms
  add column reference_version text not null check (reference_version ~ '^who-(2006|2007)-v[0-9]+$'),
  add column index_unit text not null check (index_unit in ('age_days', 'age_months', 'length_cm', 'height_cm')),
  add column index_value numeric(8, 2) not null check (index_value >= 0),
  add column source_url text;
alter table public.growth_reference_lms alter column source drop default;
alter table public.growth_reference_lms
  add constraint growth_reference_lms_row_key unique (reference_version, sex, measurement_type, index_unit, index_value);
alter table public.growth_reference_lms
  add constraint growth_reference_lms_positive_ms check (m_value > 0 and s_value > 0);
create index growth_reference_lms_lookup_idx
  on public.growth_reference_lms (reference_version, sex, measurement_type, index_unit, index_value);

comment on table public.growth_reference_lms is
  'S68: WHO LMS reference rows, loaded from the published WHO workbooks by scripts/who-growth/build_who_lms.py (never typed by hand). One row per (reference_version, sex, indicator, index unit, index value). Age indicators are indexed by age_days (2006 standard, 0 to 5 years) or age_months (2007 reference, 5 to 19 years); weight-for-length is indexed by length_cm and weight-for-height by height_cm. private.growth_z() interpolates linearly between neighbouring rows and returns NULL, never a guess, outside the table.';

-- The reference is public scientific data: signed-in roles read it, only an admin writes it (unchanged policies, re-stated for clarity).
-- No new grant is needed: the table keeps its existing select/insert/update/delete grant to authenticated, gated by the existing policies.

-- ---------------------------------------------------------------------------
-- 2. maternal_child_config: one versioned home for every PROPOSED value of S68 (INV-16)
-- ---------------------------------------------------------------------------
-- NO organisation_id, on purpose: these are deployment-wide clinical settings, like care_circle_config, paging_config and the go-live guards.
-- status stays 'proposed' until the owner confirms it in the S37 sign-off screen; nothing here is, or may be, signed by an agent.
create table public.maternal_child_config (
  id             uuid primary key default gen_random_uuid(),
  config_key     text not null check (config_key ~ '^[a-z][a-z0-9_.]*$'),
  version        integer not null check (version >= 1),
  is_active      boolean not null default false,
  status         text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  effective_from date not null,
  rules          jsonb not null check (jsonb_typeof(rules) = 'object'),
  source_note    text not null,
  created_at     timestamptz not null default now(),
  unique (config_key, version)
);
create unique index maternal_child_config_one_active on public.maternal_child_config (config_key) where is_active;
comment on table public.maternal_child_config is
  'S68 (INV-16): versioned PROPOSED clinical values for growth routing, plausibility, EPDS cut-offs, postnatal checks, the lifecycle and retention. Append-only by convention: a change is a NEW version. Mirrored in packages/shared proposed-config with a mirror test. Never confirmed by an agent.';

alter table public.maternal_child_config enable row level security;
create policy maternal_child_config_read on public.maternal_child_config for select to authenticated using (true);
revoke all on public.maternal_child_config from public, anon, authenticated;
grant select on public.maternal_child_config to authenticated;
-- A write only ever comes from a migration (a new version row). Nobody, including the service role, writes it at runtime.
revoke insert, update, delete, truncate on public.maternal_child_config from service_role;

create or replace function private.maternal_child_rules(p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select rules from public.maternal_child_config where config_key = p_key and is_active
$$;
create or replace function private.maternal_child_config_version(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select version from public.maternal_child_config where config_key = p_key and is_active
$$;
revoke all on function private.maternal_child_rules(text) from public, anon;
revoke all on function private.maternal_child_config_version(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. child_growth_measurements: the columns the WHO method needs, and the audit of which reference was used
-- ---------------------------------------------------------------------------
alter table public.child_growth_measurements
  add column muac_mm                  numeric(5, 1) check (muac_mm is null or muac_mm between 40 and 400),
  add column bilateral_oedema         boolean not null default false,
  add column measure_position         text check (measure_position in ('recumbent', 'standing')),
  add column weight_for_height_z      numeric(5, 2),
  add column muac_for_age_z           numeric(5, 2),
  add column reference_version        text,
  add column plausibility_flags       text[] not null default '{}',
  add column nutrition_class          text check (nutrition_class in ('severe_acute', 'moderate_acute', 'none')),
  add column nutrition_config_version integer,
  add column nutrition_alert_id       uuid references public.clinician_alerts (id) on delete set null,
  add column source                   text not null default 'patient_entered' check (source in ('patient_entered', 'caregiver_entered', 'clinician_recorded')),
  add column recorded_by              uuid references public.profiles (id) on delete restrict;

alter table public.child_growth_measurements drop constraint child_growth_measurements_has_a_measurement;
alter table public.child_growth_measurements add constraint child_growth_measurements_has_a_measurement
  check (height_cm is not null or weight_kg is not null or head_circumference_cm is not null or muac_mm is not null);

comment on column public.child_growth_measurements.reference_version is
  'The growth_reference_lms reference_version used for the z-scores on this row (INV-16). NULL when no reference row matched, which is shown as "reference not available", never as a value.';
comment on column public.child_growth_measurements.plausibility_flags is
  'WHO biologically-implausible z-score flags (growth.plausibility config). A flagged row is KEPT and still routed (an extreme but possible child must not be missed); the alert and the screen both say "please check the measurement".';
comment on column public.child_growth_measurements.source is
  'Who recorded it (S68 retention rule B3): patient_entered and caregiver_entered rows are deletable by the patient or parent after the grace window; a clinician_recorded row, or a row a clinician acted on, is sealed.';

-- ---------------------------------------------------------------------------
-- 4. Events and the guard
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('child.growth_recorded', 'A child growth measurement was recorded (z-scores computed from the versioned WHO reference)', 'S68', false),
  ('child.nutrition_flagged', 'A growth measurement met the severe or moderate acute malnutrition routing rule', 'S68', true),
  ('delivery.recorded', 'A delivery was recorded by the person or a clinician (a confirmed event, never inferred)', 'S68', false),
  ('pregnancy.loss_recorded', 'A pregnancy loss was recorded by the person or a clinician (a confirmed event, never inferred)', 'S68', false),
  ('lifecycle.stage_changed', 'A person moved between lifecycle stages because of a confirmed event', 'S68', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('child.growth_recorded', 1, array['measurement_id', 'reference_version']),
  ('child.nutrition_flagged', 1, array['measurement_id', 'class', 'config_version']),
  ('delivery.recorded', 1, array['postnatal_profile_id']),
  ('pregnancy.loss_recorded', 1, array['loss_id']),
  ('lifecycle.stage_changed', 1, array['from_stage', 'to_stage', 'cause'])
on conflict (event_type, version) do nothing;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('maternal_enabled', 'Maternal and child health', 'Pregnancy blood pressure rules, postnatal checks, child malnutrition routing, the lifecycle and the breastfeeding log',
   'Obstetric protocol and paediatric growth routing signed by the CMO (see docs/plans/S66-S70-cmo-signoff-pack.md)', 'cmo',
   array['child growth nutrition routing (alerts and paging)', 'breastfeeding_feed_log insert', 'record_lifecycle_event (pregnancy confirmed, delivery, loss, and the other confirmed events)'],
   'Child growth z-scores, the growth chart and the EPDS crisis route are live today and stay outside this guard (a crisis answer is never held back). Pregnancy blood pressure rules are S67''s to wire.')
on conflict (key) do nothing;

do $$ begin
  if not exists (select 1 from public.go_live_guards where key = 'maternal_enabled' and not is_on) then
    raise exception 'S68b self-check: maternal_enabled must exist and be OFF';
  end if;
  if exists (select 1 from public.growth_reference_lms) then raise exception 'S68b self-check: the reference table must still be empty here'; end if;
  if has_table_privilege('anon', 'public.maternal_child_config', 'SELECT') then raise exception 'S68b self-check: anon can read the config'; end if;
end $$;
