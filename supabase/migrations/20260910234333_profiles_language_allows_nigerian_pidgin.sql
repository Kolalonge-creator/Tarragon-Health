-- profiles.language becomes a real, constrained interface-language setting.
--
-- The column has existed for a long time with no consumer at all: the
-- platform was English-only (founder decision 2026-08-03) and the
-- communication-preferences form explicitly refused to surface a language
-- picker, on the grounds that offering one while still sending English would
-- over-promise. That reasoning was right and still is -- which is why the
-- scope here is deliberately narrow.
--
-- 'pcm' is ISO 639-3 for Nigerian Pidgin (Naija). It selects the language of
-- WAYFINDING ONLY -- navigation, buttons, tab labels, the setup steps.
-- Clinical guidance, emergency copy, dosing instructions, and consent text
-- are NOT translated and must not be: a half-translated safety instruction is
-- worse than an untranslated one, because the patient cannot tell which half
-- they are reading. See packages/shared/src/ui-language.ts for the boundary
-- and the test that enforces it.
--
-- Notification/send-pipeline behaviour is unchanged. Nothing in the WhatsApp,
-- SMS or email path reads this column, so no message changes language.
--
-- No default change and no data migration: all existing rows are 'en' and
-- stay 'en'. The CHECK exists so a third language cannot arrive as free text
-- and quietly reach a Record<UiLanguage, ...> lookup in two apps.

alter table public.profiles
  drop constraint if exists profiles_language_check;

alter table public.profiles
  add constraint profiles_language_check
  check (language in ('en', 'pcm'));

comment on column public.profiles.language is
  'Interface language for the patient app: en | pcm (Nigerian Pidgin). '
  'Wayfinding only -- navigation, buttons, setup steps. Clinical guidance, '
  'emergency copy, dosing and consent text are never translated. Not read by '
  'any notification send path.';

do $$
declare
  v_rejected boolean := false;
  v_non_en integer;
begin
  -- Nothing pre-existing may have been invalidated by the new constraint.
  select count(*) into v_non_en
  from public.profiles
  where language not in ('en', 'pcm');
  if v_non_en > 0 then
    raise exception 'profiles.language holds % rows outside (en, pcm)', v_non_en;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_language_check'
  ) then
    raise exception 'profiles_language_check did not attach';
  end if;

  -- Prove the constraint discriminates, on a scratch table carrying the same
  -- expression: asserting against public.profiles itself would be vacuous,
  -- since the FK on profiles.id bites long before the CHECK is reached.
  create temp table _language_probe (language text);
  execute format(
    'alter table _language_probe add constraint probe_chk %s',
    (select pg_get_constraintdef(oid)
     from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_language_check')
  );

  begin
    insert into _language_probe (language) values ('yo');
  exception
    when check_violation then v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'profiles_language_check accepted an unsupported language';
  end if;

  insert into _language_probe (language) values ('en'), ('pcm');
  drop table _language_probe;
end $$;
