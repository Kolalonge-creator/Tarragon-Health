-- Patient-facing glucose display unit.
--
-- WHY: `vitals_readings` stores mmol/L, and every DISPLAY site on both the web
-- and native apps was hardcoded to mmol/L. Meters sold in Nigeria read mg/dL,
-- so a patient typing the 110 off their Accu-Chek saw "6.1" on their own
-- dashboard, and the diabetes guidance told them a low was "below 3.9 mmol/L"
-- -- a figure that meter will never display. The unit picker on both vitals
-- forms was local component state defaulting to mmol_l, remembered nowhere, so
-- the correct unit had to be re-chosen on every single entry.
--
-- This is a DISPLAY and INPUT-DEFAULT preference only. Storage stays mmol/L,
-- so there is no data conversion here and switching the setting later never
-- rewrites a reading. That is also why this is a plain column and not a
-- units-of-measure system: nothing downstream (classification thresholds,
-- red-flag triggers, risk scoring) reads it or should.
--
-- DEFAULT: 'mg_dl', which is what Nigeria's meters read. Every existing row
-- takes that default too. That is deliberate rather than preserving today's
-- implicit mmol/L: the current behaviour was never a choice anyone made, it
-- was the component's initial state, and no patient has ever been shown a
-- setting to disagree with it.
--
-- Deliberately NOT added to private.guard_profiles_self_update()'s denylist:
-- this is the account owner's own display preference and self-editing it is
-- the entire point. Checked against that function's live definition first,
-- which is allow-by-default with an explicit list of privileged columns.

alter table public.profiles
  add column if not exists glucose_display_unit text not null default 'mg_dl';

alter table public.profiles
  drop constraint if exists profiles_glucose_display_unit_check;

alter table public.profiles
  add constraint profiles_glucose_display_unit_check
  check (glucose_display_unit in ('mg_dl', 'mmol_l'));

comment on column public.profiles.glucose_display_unit is
  'The unit this patient sees their own glucose figures in, and the default '
  'selected on the vitals entry forms. Display/input only -- vitals_readings '
  'always stores mmol/L, so changing this never converts stored data. '
  'Defaults to mg_dl, which is what meters sold in Nigeria read.';

-- Prove it, rather than hope. A CHECK that silently failed to attach would
-- leave a free-text column feeding a Record<Unit, ...> lookup in both apps.
do $$
declare
  v_default text;
  v_rejected boolean := false;
begin
  select column_default into v_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'glucose_display_unit';

  if v_default is null or v_default not like '%mg_dl%' then
    raise exception 'expected profiles.glucose_display_unit to default to mg_dl, got %', v_default;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_glucose_display_unit_check'
  ) then
    raise exception 'profiles_glucose_display_unit_check did not attach';
  end if;

  -- Exercise the constraint for real, on a scratch table carrying the same
  -- expression. Inserting into public.profiles itself would have been a
  -- vacuous test: the FK on profiles.id bites before the CHECK is ever
  -- reached, so a constraint that accepted anything would still have "passed".
  create temp table _glucose_unit_probe (glucose_display_unit text);
  execute format(
    'alter table _glucose_unit_probe add constraint probe_chk %s',
    (select pg_get_constraintdef(oid)
     from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_glucose_display_unit_check')
  );

  begin
    insert into _glucose_unit_probe (glucose_display_unit) values ('mmol/L');
  exception
    when check_violation then v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'glucose_display_unit CHECK accepted an invalid unit';
  end if;

  -- ...and confirm it is not simply rejecting everything.
  insert into _glucose_unit_probe (glucose_display_unit) values ('mg_dl'), ('mmol_l');

  drop table _glucose_unit_probe;
end $$;
