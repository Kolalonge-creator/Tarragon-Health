-- ===========================================================================
-- Verification: 20260910172703_specialist_providers_commercial_columns_off_the_patient_surface
--
-- public.specialist_providers had a SELECT policy of `using (true)` for role
-- `authenticated`, so every logged-in patient could read what Tarragon earns on
-- a referral and the partner's private contact details. Found 2026-09-10 by
-- driving the live API with a real patient JWT, not by reading the policy.
--
-- Proves, in both directions, because a rule only asserted in one direction
-- tells you nothing about whether it is refusing everybody:
--
--   1. A PATIENT session reads ZERO rows from specialist_providers.
--   2. A PATIENT session CAN read public.specialist_directory, and that view
--      carries license_number -- deliberately patient-visible, because a
--      registration number is what lets somebody check a practitioner with the
--      regulator before paying them.
--   3. Neither directory view exposes any commission or contact column, now or
--      after a future edit.
--   4. An ADMIN session still reads the table, or the partner console is broken.
--
-- Run via `supabase db query --linked -f this_file.sql`, `psql $DATABASE_URL -f
-- this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK: a verification script, never seed data. Builds its
-- own patient fixture rather than borrowing one, so it behaves the same on a
-- fresh reset as against the live project.
-- ===========================================================================

begin;

do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_admin   uuid;
  v_total   int;
  v_seen    int;
  v_dir     int;
  v_leaky   text;
begin
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    select id into v_org from public.organisations limit 1;
  end if;
  if v_org is null then
    raise exception 'no organisation exists — cannot run this proof';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'sp-columns-probe@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'Specialist Columns Probe')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = 'patient';

  -- A provider the patient could plausibly want to see, so an empty catalogue
  -- cannot make this proof pass vacuously.
  insert into public.specialist_providers
    (specialist_type, name, location, consultation_fee_kobo, is_active,
     verification_stage, supports_telemedicine, license_type, license_number,
     license_verified_at, commission_rate_type, commission_rate, contact_email)
  -- verification_stage must be 'active' for an active provider
  -- (specialist_providers_active_requires_verification_stage), which is the
  -- guard stopping an unvetted practitioner reaching a patient at all.
  values ('psychology', 'ZZ Probe Practitioner', 'Lagos', 2000000, true,
          'active', true, 'MDCN', 'ZZ-PROBE-1', now(), 'percentage', 0.15,
          'zz-probe@example.invalid');

  select count(*) into v_total from public.specialist_providers;

  -- ---------------------------------------------------------------- 1 & 2
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into v_seen from public.specialist_providers;
    select count(*) into v_dir  from public.specialist_directory where license_number = 'ZZ-PROBE-1';

    reset role;
  exception when others then
    reset role;
    raise;
  end;

  if v_seen <> 0 then
    raise exception 'FAIL(1): a patient session read % specialist_providers row(s). Commission rates and partner contact details are exposed.', v_seen;
  end if;
  if v_dir <> 1 then
    raise exception 'FAIL(2): a patient session could not see the probe provider in specialist_directory (found %). The directory is broken, which is worse than the leak: patients now see nothing at all.', v_dir;
  end if;
  raise notice 'PASS(1,2): patient reads the directory including the licence number, and not the table';

  -- ---------------------------------------------------------------- 3
  select string_agg(table_name || '.' || column_name, ', ') into v_leaky
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('specialist_directory', 'therapy_directory')
     and column_name in ('commission_rate', 'commission_rate_type',
                         'commission_flat_kobo', 'contact_email', 'contact_phone');
  if v_leaky is not null then
    raise exception 'FAIL(3): a directory view exposes %', v_leaky;
  end if;
  raise notice 'PASS(3): neither directory view carries a commission or contact column';

  -- ---------------------------------------------------------------- 4
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'SKIP(4): no admin profile to prove the console still works';
  else
    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into v_seen from public.specialist_providers;
      reset role;
    exception when others then
      reset role;
      raise;
    end;
    if v_seen <> v_total then
      raise exception 'FAIL(4): an admin session read % of % rows. The partner console is broken.', v_seen, v_total;
    end if;
    raise notice 'PASS(4): admin still reads all % rows', v_seen;
  end if;

  perform set_config('request.jwt.claims', null, true);
  raise notice 'ALL PASS: commission and contact details are off the patient surface; the licence number stays on it';
end $$;

rollback;
