-- Patient-facing display units for weight, temperature and body measurements.
--
-- Same shape and same reasoning as 20260910232607_profiles_glucose_display_unit.sql: this is a DISPLAY and
-- INPUT-DEFAULT preference only. vitals_readings keeps storing kg, degrees Celsius and cm, so there is no data
-- conversion here, switching later never rewrites a reading, and nothing downstream (thresholds, red flags,
-- risk scores) reads these columns.
--
-- LIVE COUNT BEFORE: no such columns; every existing row takes the defaults (kg, c, cm), which is what the
-- apps have always shown, so shipping this changes nothing for anyone until they choose.
--
-- Deliberately NOT added to private.guard_profiles_self_update()'s denylist: the account owner's own display
-- preference, like glucose_display_unit. The allowed values mirror WEIGHT_DISPLAY_UNITS, TEMPERATURE_DISPLAY_UNITS
-- and LENGTH_DISPLAY_UNITS in packages/shared/src/measurement-units.ts.

alter table public.profiles
  add column if not exists weight_display_unit text not null default 'kg',
  add column if not exists temperature_display_unit text not null default 'c',
  add column if not exists length_display_unit text not null default 'cm';

alter table public.profiles drop constraint if exists profiles_weight_display_unit_check;
alter table public.profiles add constraint profiles_weight_display_unit_check
  check (weight_display_unit in ('kg', 'lb'));

alter table public.profiles drop constraint if exists profiles_temperature_display_unit_check;
alter table public.profiles add constraint profiles_temperature_display_unit_check
  check (temperature_display_unit in ('c', 'f'));

alter table public.profiles drop constraint if exists profiles_length_display_unit_check;
alter table public.profiles add constraint profiles_length_display_unit_check
  check (length_display_unit in ('cm', 'in'));

comment on column public.profiles.weight_display_unit is
  'Unit this person reads weight in (kg or lb). Display/input only: vitals_readings.weight_kg is always kg.';
comment on column public.profiles.temperature_display_unit is
  'Unit this person reads temperature in (c or f). Display/input only: vitals_readings.temperature_c is always Celsius.';
comment on column public.profiles.length_display_unit is
  'Unit this person reads waist and height in (cm or in). Display/input only: stored values are always cm.';

-- Prove the CHECKs attached and discriminate, on a scratch table carrying the same expressions (inserting into
-- profiles itself would hit the FK on id before the CHECK and prove nothing).
do $$
declare
  v_col text;
  v_con text;
  v_bad text;
  v_good text[];
  v_rejected boolean;
begin
  for v_col, v_con, v_bad, v_good in
    select * from (values
      ('weight_display_unit', 'profiles_weight_display_unit_check', 'stone', array['kg', 'lb']),
      ('temperature_display_unit', 'profiles_temperature_display_unit_check', 'k', array['c', 'f']),
      ('length_display_unit', 'profiles_length_display_unit_check', 'ft', array['cm', 'in'])
    ) as t(col, con, bad, good)
  loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = v_con) then
      raise exception '% did not attach', v_con;
    end if;

    execute format('create temp table _unit_probe (%I text)', v_col);
    execute format(
      'alter table _unit_probe add constraint probe_chk %s',
      (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.profiles'::regclass and conname = v_con)
    );

    v_rejected := false;
    begin
      execute format('insert into _unit_probe (%I) values (%L)', v_col, v_bad);
    exception when check_violation then v_rejected := true;
    end;
    if not v_rejected then
      raise exception '% accepted an invalid unit', v_col;
    end if;

    execute format('insert into _unit_probe (%I) values (%L), (%L)', v_col, v_good[1], v_good[2]);
    drop table _unit_probe;
  end loop;
end $$;
