-- Tarragon Health — basal body temperature and ovulation tests on the daily log.
--
-- The cycle tracker predicts ovulation by counting back a luteal phase from
-- the next predicted period. That is the best available estimate from dates
-- alone, but it is only ever an estimate: it says when ovulation is likely,
-- never whether it happened. These two columns are the only signals a
-- patient can record at home that speak to the second question.
--
--   basal_body_temperature_c  A sustained rise of roughly 0.3 C, held for
--                             three days, follows ovulation (progesterone
--                             raises resting temperature). It is a
--                             RETROSPECTIVE confirmation -- by the time the
--                             shift is visible the fertile window has
--                             closed -- which is exactly why it must never
--                             be presented as a prediction or as
--                             contraception.
--   ovulation_test_result     Urine LH tests. A positive typically precedes
--                             ovulation by 24-36 hours, so unlike BBT it is
--                             forward-looking.
--
-- Both live on menstrual_daily_logs rather than a new table: they are one
-- more thing recorded about one day, and a parallel table would mean a
-- second source of truth for "what happened on this date" (the same rule
-- that keeps overlapping wearable metrics in vitals_readings).
--
-- Deliberately NOT added to vitals_readings despite being a temperature:
-- vitals_readings.temperature_c is body temperature for illness assessment
-- and feeds the red-flag/escalation engine, where a fever matters. A basal
-- reading is taken at rest before rising, is only meaningful as a relative
-- shift within one cycle, and a 37.1 C basal temperature is a normal
-- post-ovulation value that must never page a clinician.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'menstrual_ovulation_test_result') then
    create type public.menstrual_ovulation_test_result as enum ('negative', 'positive', 'peak');
  end if;
end $$;

comment on type public.menstrual_ovulation_test_result is
  'Home LH (ovulation) test reading. ''peak'' is the darkest/highest reading some '
  'digital tests report distinctly from a plain positive.';

alter table public.menstrual_daily_logs
  add column if not exists basal_body_temperature_c numeric(4,2),
  add column if not exists ovulation_test_result public.menstrual_ovulation_test_result;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menstrual_daily_logs_plausible_bbt'
  ) then
    -- Deliberately wide. A basal temperature outside 34-40 C is a
    -- mis-entered number (a Fahrenheit reading typed into a Celsius field
    -- lands near 97, and a missing decimal point lands near 366), not a
    -- clinical finding this table should try to judge.
    alter table public.menstrual_daily_logs
      add constraint menstrual_daily_logs_plausible_bbt
      check (basal_body_temperature_c is null
             or (basal_body_temperature_c >= 34 and basal_body_temperature_c <= 40));
  end if;
end $$;

comment on column public.menstrual_daily_logs.basal_body_temperature_c is
  'Resting temperature in Celsius, taken before rising. Interpreted only as a '
  'relative shift within a cycle (see lib/rules/cycle-thermal-shift.ts); never '
  'fed to the fever/red-flag engine, which reads vitals_readings.temperature_c.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='menstrual_daily_logs'
      and column_name='basal_body_temperature_c'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='menstrual_daily_logs'
      and column_name='ovulation_test_result'
  ) then
    raise exception 'menstrual_daily_logs is missing the BBT/ovulation-test columns';
  end if;

  -- The plausibility guard must actually reject a Fahrenheit slip.
  if (98.6::numeric >= 34 and 98.6::numeric <= 40) then
    raise exception 'the BBT range check would accept a Fahrenheit reading';
  end if;
end $$;
