-- Tarragon Health — Women's Health platform, part 2: contraception (§44.5).
--
-- §44.5's flow (enquiry -> education -> clinical consultation where needed ->
-- method selected -> prescription/service -> follow-up) is deliberately built
-- as thin composition over machinery that already exists rather than a new
-- booking system: education already lives in health_education_content
-- ('contraception options', migration 20260810014719); "clinical consultation
-- where needed" is a normal appointment booked through the existing
-- appointment engine (public.hold_appointment_slot/confirm_appointment_booking,
-- appointment_type 'gp' or 'specialist', free-text service — no schema
-- change needed there); "prescription" is an ordinary row in the existing
-- medications table once a clinician prescribes.
--
-- The one genuinely missing piece is a place for the patient to record which
-- method they are currently using, so the platform (and §44.14's
-- cross-programme intersection checks, e.g. a hypertension caution on
-- combined hormonal methods) has something to read. Extends
-- reproductive_health_profiles (20260724001210) rather than adding a new
-- table -- it is exactly the kind of single self-reported preference that
-- table already exists to hold, same discipline as life_stage: informational,
-- never a diagnosis, never fed into risk/escalation scoring.

alter table public.reproductive_health_profiles
  add column if not exists current_contraception_method text;

comment on column public.reproductive_health_profiles.current_contraception_method is
  'Self-reported, free text (e.g. "combined pill", "implant", "condoms", "none"). Informational only -- never inferred, never fed into risk/escalation scoring. Existing RLS on the table already covers this column.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reproductive_health_profiles'
      and column_name = 'current_contraception_method'
  ) then
    raise exception 'current_contraception_method column was not added';
  end if;
  raise notice 'PASS: reproductive_health_profiles.current_contraception_method added';
end $$;
