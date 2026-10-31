-- Tarragon Health — Paediatric growth monitoring (Child Health Platform §48.3/§48.4)
--
-- A child's weight/height cannot be read against adult BMI logic (§48.3's own
-- requirement: "use appropriate paediatric growth references rather than adult
-- BMI logic"). This adds a dedicated measurement table plus a reference-LMS
-- table the WHO Child Growth Standards / CDC Growth Charts shape is designed
-- around (the standard method every real paediatric growth chart uses: a
-- Box-Cox power transform with three per-age parameters L/M/S gives an exact
-- z-score/percentile for any raw value — see private.growth_z_score below).
--
-- HONEST GAP, DELIBERATE: growth_reference_lms ships EMPTY. The L/M/S
-- parameters are precise, decimal-sensitive population statistics published by
-- WHO (https://www.who.int/tools/child-growth-standards/standards) and CDC
-- (https://www.cdc.gov/growthcharts/percentile_data_files.htm) as downloadable
-- data files — the kind of clinical reference data this codebase's own
-- precedent (private.egfr in apps/web/src/lib/rules/egfr.ts: "it refuses
-- rather than return a wrong number") says must come from a verified source,
-- never be approximated from memory. Loading the real WHO/CDC tables is a
-- data-import follow-up, not a code one — see docs/PEDIATRIC_CHILD_HEALTH_SPEC.md.
-- Until that happens, private.growth_z_score returns NULL (not a guess) for
-- every input, and the app degrades to showing raw measurements over time with
-- percentile/z-score panels reading "reference data pending" — never a
-- fabricated percentile. Raw growth tracking (§48.3's core ask) and the
-- reference-independent trajectory checks below (point 4) work today,
-- unconditionally, with zero reference rows loaded.

-- ---------------------------------------------------------------------------
-- 1. growth_reference_lms — WHO/CDC LMS parameters (admin-loaded, ships empty)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'growth_measurement_type') then
    create type public.growth_measurement_type as enum (
      'weight_for_age', 'height_for_age', 'bmi_for_age', 'head_circumference_for_age'
    );
  end if;
end $$;

create table if not exists public.growth_reference_lms (
  id               uuid primary key default gen_random_uuid(),
  sex              public.sex not null,
  measurement_type public.growth_measurement_type not null,
  age_months       numeric(6, 2) not null check (age_months >= 0),
  l_value          numeric(12, 6) not null,
  m_value          numeric(12, 6) not null,
  s_value          numeric(12, 6) not null,
  source           text not null default 'WHO Child Growth Standards / CDC Growth Charts',
  created_at       timestamptz not null default now(),
  unique (sex, measurement_type, age_months)
);

create index if not exists growth_reference_lms_lookup_idx
  on public.growth_reference_lms (sex, measurement_type, age_months);

comment on table public.growth_reference_lms is
  'LMS reference parameters for paediatric growth percentiles. Ships EMPTY — see this file''s header. private.growth_z_score() returns NULL, never a fabricated value, when no row is close enough to the requested age.';

alter table public.growth_reference_lms enable row level security;

drop policy if exists growth_reference_lms_select on public.growth_reference_lms;
create policy growth_reference_lms_select on public.growth_reference_lms
  for select to authenticated
  using (true);

drop policy if exists growth_reference_lms_write on public.growth_reference_lms;
create policy growth_reference_lms_write on public.growth_reference_lms
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.growth_reference_lms to authenticated;

-- ---------------------------------------------------------------------------
-- 2. private.growth_z_score — the LMS formula (textbook, not clinical-data)
-- ---------------------------------------------------------------------------
-- z = ((value/M)^L - 1) / (L*S)  for L != 0
-- z = ln(value/M) / S            for L == 0
-- Looks up the closest reference age within 45 days (no interpolation between
-- ages yet — a deliberately conservative "close enough or nothing" match, same
-- spirit as vaccination-status.ts degrading gracefully on an unrecognised
-- shape rather than guessing). Returns null when no reference row exists at
-- all (the honest common case today) or the closest row is further than that.
create or replace function private.growth_z_score(
  p_sex public.sex,
  p_measurement_type public.growth_measurement_type,
  p_age_months numeric,
  p_value numeric
) returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref record;
begin
  if p_value is null or p_age_months is null then
    return null;
  end if;

  select l_value, m_value, s_value, age_months
    into v_ref
  from public.growth_reference_lms
  where sex = p_sex and measurement_type = p_measurement_type
  order by abs(age_months - p_age_months)
  limit 1;

  if v_ref is null or abs(v_ref.age_months - p_age_months) > 1.5 then
    return null;
  end if;

  if v_ref.l_value = 0 then
    return ln(p_value / v_ref.m_value) / v_ref.s_value;
  end if;

  return (power((p_value / v_ref.m_value)::numeric, v_ref.l_value) - 1) / (v_ref.l_value * v_ref.s_value);
end;
$$;

revoke all on function private.growth_z_score(public.sex, public.growth_measurement_type, numeric, numeric) from public;
grant execute on function private.growth_z_score(public.sex, public.growth_measurement_type, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. child_growth_measurements
-- ---------------------------------------------------------------------------
create table if not exists public.child_growth_measurements (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  patient_id                uuid not null references public.profiles (id) on delete cascade,
  measured_at               timestamptz not null default now(),
  -- Snapshotted at insert (private.stamp_growth_measurement below) from the
  -- patient's date_of_birth at that moment, so a later DOB correction never
  -- retroactively reshuffles chart history.
  age_days_at_measurement   integer not null,
  height_cm                 numeric(5, 2),
  weight_kg                 numeric(5, 2),
  head_circumference_cm     numeric(5, 2),
  bmi                       numeric(5, 2),
  weight_for_age_z          numeric(5, 2),
  height_for_age_z          numeric(5, 2),
  bmi_for_age_z             numeric(5, 2),
  head_circumference_for_age_z numeric(5, 2),
  note                      text,
  -- Who physically entered this, when not the patient themselves (a young
  -- child obviously never logs their own growth) — same forge-proof,
  -- server-derived pattern as vitals_readings/symptoms
  -- (private.stamp_acting_supporter, 20260801110000_acting_for_someone_you_support.sql).
  logged_by_profile_id      uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  constraint child_growth_measurements_has_a_measurement
    check (height_cm is not null or weight_kg is not null or head_circumference_cm is not null)
);

create index if not exists child_growth_measurements_patient_idx
  on public.child_growth_measurements (patient_id, measured_at desc);
create index if not exists child_growth_measurements_org_idx
  on public.child_growth_measurements (organisation_id);

comment on column public.child_growth_measurements.age_days_at_measurement is
  'Snapshotted from profiles.date_of_birth at insert time by private.stamp_growth_measurement. NOT recomputed later — a corrected DOB must never reshuffle already-plotted chart history.';

-- Requires a DOB on file — a growth chart with no known age is not a growth
-- chart. Also computes bmi + the four z-score columns (null until reference
-- data exists for that age/sex/measurement_type, per this file's header).
create or replace function private.stamp_growth_measurement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dob date;
  v_sex public.sex;
  v_age_months numeric;
begin
  select date_of_birth, sex into v_dob, v_sex
  from public.profiles where id = new.patient_id;

  if v_dob is null then
    raise exception 'Cannot record a growth measurement: % has no date of birth on file.', new.patient_id
      using errcode = 'check_violation';
  end if;

  new.age_days_at_measurement := (new.measured_at::date - v_dob);
  v_age_months := new.age_days_at_measurement / 30.4375;

  if new.height_cm is not null and new.weight_kg is not null then
    new.bmi := round(new.weight_kg / power(new.height_cm / 100, 2), 2);
  end if;

  if v_sex is not null then
    new.weight_for_age_z := private.growth_z_score(v_sex, 'weight_for_age', v_age_months, new.weight_kg);
    new.height_for_age_z := private.growth_z_score(v_sex, 'height_for_age', v_age_months, new.height_cm);
    new.bmi_for_age_z := private.growth_z_score(v_sex, 'bmi_for_age', v_age_months, new.bmi);
    new.head_circumference_for_age_z :=
      private.growth_z_score(v_sex, 'head_circumference_for_age', v_age_months, new.head_circumference_cm);
  end if;

  -- Same forge-proof attribution as vitals_readings/symptoms.
  if new.patient_id is distinct from (select auth.uid()) then
    new.logged_by_profile_id := (select auth.uid());
  else
    new.logged_by_profile_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists child_growth_measurements_stamp on public.child_growth_measurements;
create trigger child_growth_measurements_stamp
  before insert on public.child_growth_measurements
  for each row execute function private.stamp_growth_measurement();

-- ---------------------------------------------------------------------------
-- 4. Trajectory-change flag — clinical review, never a diagnosis (§48.4)
-- ---------------------------------------------------------------------------
-- Two independent checks, deliberately kept separate:
--   a) z-score based (WHO monitoring convention: a shift of >= 2 SD between
--      consecutive measurements is a "crossed two major percentile lines"
--      flag) — only fires once reference data exists for both points.
--   b) reference-INDEPENDENT bounds that need no LMS table at all and so give
--      real protection from day one: weight loss in a child under 5, or no
--      height gain over a 90+ day interval in a child under 3. Both are
--      clinically self-evident regardless of where a child sits on any curve.
-- Either only ever raises a 'clinician_review' alert for a doctor to actually
-- assess — per §48.4, "identify... for appropriate clinical review, rather
-- than diagnosing from a chart alone."
create or replace function private.flag_growth_trajectory_concern()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev record;
  v_age_years numeric;
  v_reason text;
begin
  select * into v_prev
  from public.child_growth_measurements
  where patient_id = new.patient_id and id <> new.id and measured_at < new.measured_at
  order by measured_at desc
  limit 1;

  if v_prev is null then
    return new;
  end if;

  v_age_years := new.age_days_at_measurement / 365.25;
  v_reason := null;

  if new.weight_for_age_z is not null and v_prev.weight_for_age_z is not null
     and abs(new.weight_for_age_z - v_prev.weight_for_age_z) >= 2 then
    v_reason := format('Weight-for-age z-score shifted from %s to %s since the last measurement.',
                        v_prev.weight_for_age_z, new.weight_for_age_z);
  elsif new.height_for_age_z is not null and v_prev.height_for_age_z is not null
     and abs(new.height_for_age_z - v_prev.height_for_age_z) >= 2 then
    v_reason := format('Height-for-age z-score shifted from %s to %s since the last measurement.',
                        v_prev.height_for_age_z, new.height_for_age_z);
  elsif v_age_years < 5 and new.weight_kg is not null and v_prev.weight_kg is not null
     and new.weight_kg < v_prev.weight_kg then
    v_reason := format('Weight decreased from %s kg to %s kg (child under 5).',
                        v_prev.weight_kg, new.weight_kg);
  elsif v_age_years < 3 and new.height_cm is not null and v_prev.height_cm is not null
     and new.height_cm <= v_prev.height_cm
     and new.measured_at - v_prev.measured_at >= interval '90 days' then
    v_reason := format('No height gain over %s days (child under 3).',
                        extract(day from new.measured_at - v_prev.measured_at));
  end if;

  if v_reason is not null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Growth trajectory change flagged for review',
      format('%s Flagged for clinical review — not an automated diagnosis.', v_reason)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists child_growth_measurements_trajectory_flag on public.child_growth_measurements;
create trigger child_growth_measurements_trajectory_flag
  after insert on public.child_growth_measurements
  for each row execute function private.flag_growth_trajectory_concern();

-- ---------------------------------------------------------------------------
-- 5. RLS — vitals_readings-style (patient/staff) + acting-for-a-dependent
-- ---------------------------------------------------------------------------
alter table public.child_growth_measurements enable row level security;

drop policy if exists child_growth_measurements_select on public.child_growth_measurements;
create policy child_growth_measurements_select on public.child_growth_measurements
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
  );

drop policy if exists child_growth_measurements_insert on public.child_growth_measurements;
create policy child_growth_measurements_insert on public.child_growth_measurements
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_act_for(patient_id)
  );

drop policy if exists child_growth_measurements_update on public.child_growth_measurements;
create policy child_growth_measurements_update on public.child_growth_measurements
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists child_growth_measurements_delete on public.child_growth_measurements;
create policy child_growth_measurements_delete on public.child_growth_measurements
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.child_growth_measurements to authenticated;

-- Assertions.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'growth_measurement_type') then
    raise exception 'growth_measurement_type enum was not created';
  end if;
  if exists (select 1 from public.growth_reference_lms limit 1) then
    raise exception 'growth_reference_lms must ship empty — see this migration''s header on why fabricated LMS values are unacceptable';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'child_growth_measurements'
      and policyname = 'child_growth_measurements_insert'
      and with_check::text like '%can_act_for%'
  ) then
    raise exception 'a parent/guardian must be able to log growth measurements for a child they manage';
  end if;
end $$;
