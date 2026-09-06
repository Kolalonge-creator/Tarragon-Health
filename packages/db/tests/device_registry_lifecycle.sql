-- Tarragon Health — verification for
-- 20260829121304_device_registry_lifecycle.sql (Connected Medical Device
-- Platform: device_units registry, patient_devices.device_unit_id,
-- device_fault_reports).
--
-- Cases:
--   1. Schema sanity — the new tables/columns are not vacuous.
--   2. Ownership CHECK: partner_owned requires owning_partner_organisation_id;
--      any other ownership rejects one (spec §52.6 — "the ownership model
--      should be stored").
--   3. Lifecycle/assignment CHECK: assigned_patient_id only while
--      lifecycle_status in (assigned, active, inactive); retired <=> retired_at.
--   4. Uniqueness: two device_units rows can't share
--      (manufacturer, model, serial_number).
--   5/6. RLS on device_units — POSITIVE (assigned patient sees their own
--      unit; org staff sees every unit in their org) paired with the
--      NEGATIVE control that proves each actually discriminates (a
--      different patient in the same org sees nothing; staff in a
--      different organisation see nothing) — same shape as
--      tier_authority_monotonicity.sql's non-vacuity requirement.
--   7. A patient cannot insert/update a device_units row — registry
--      management is staff-only.
--   8. device_fault_reports — a patient can file and read their own report,
--      cannot read another patient's, cannot resolve their own; org staff
--      can read and resolve it.
--   9. device_fault_reports CHECK constraints (resolved_scope,
--      replacement_scope).
--
-- Role switches happen via perform set_config(...) + set local role
-- authenticated *inside* the same DO block as the action being probed, with
-- a nested begin/exception to catch an expected RLS/CHECK rejection — this
-- is the pattern already proven in record_corrections_platform_wide.sql.
--
-- Run: npx supabase db query --linked -f packages/db/tests/device_registry_lifecycle.sql
-- Wrapped in BEGIN/ROLLBACK — nothing here persists.

begin;

create temp table drl_results(check_name text primary key, expected text, actual text) on commit drop;
create temp table drl_fixture(k text primary key, v uuid) on commit drop;
-- Every RLS probe below runs as `authenticated` (a real login role, not the
-- table owner) and still needs to read/write these fixture tables.
grant all on drl_results to authenticated;
grant all on drl_fixture to authenticated;

do $$
declare
  v_org_a       uuid;
  v_org_b       uuid := gen_random_uuid();
  v_patient_a1  uuid := gen_random_uuid();
  v_patient_a2  uuid := gen_random_uuid();
  v_staff_a     uuid := gen_random_uuid();
  v_staff_b     uuid := gen_random_uuid();
begin
  select organisation_id into v_org_a
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  if v_org_a is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  insert into public.organisations (id, name, type)
  values (v_org_b, 'DRL Test Org B', 'clinic');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient_a1, 'drl-patient-a1@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient_a2, 'drl-patient-a2@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_a,    'drl-staff-a@example.invalid',    'x', now(), '{}', '{}'),
    (v_staff_b,    'drl-staff-b@example.invalid',    'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient_a1, v_org_a, 'patient',   'DRL Test Patient A1'),
    (v_patient_a2, v_org_a, 'patient',   'DRL Test Patient A2'),
    (v_staff_a,    v_org_a, 'clinician', 'DRL Test Staff A'),
    (v_staff_b,    v_org_b, 'clinician', 'DRL Test Staff B')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into drl_fixture (k, v) values
    ('org_a', v_org_a), ('org_b', v_org_b),
    ('patient_a1', v_patient_a1), ('patient_a2', v_patient_a2),
    ('staff_a', v_staff_a), ('staff_b', v_staff_b);
end $$;

-- ==========================================================================
-- 1. Schema sanity.
-- ==========================================================================
insert into drl_results
select 'device_units table exists', 'true', (to_regclass('public.device_units') is not null)::text;
insert into drl_results
select 'device_fault_reports table exists', 'true', (to_regclass('public.device_fault_reports') is not null)::text;
insert into drl_results
select 'patient_devices.device_unit_id exists', 'true',
  exists(select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'patient_devices' and column_name = 'device_unit_id')::text;

-- ==========================================================================
-- 2. Ownership CHECK constraint.
-- ==========================================================================
do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.device_units (organisation_id, device_type, manufacturer, model, serial_number, ownership)
    values ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-PARTNER-NOOWNER', 'partner_owned');
  exception when check_violation then
    v_caught := true;
  end;
  insert into drl_results values ('partner_owned without an owning partner is rejected', 'true', v_caught::text);
end $$;

do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.device_units (organisation_id, device_type, manufacturer, model, serial_number, ownership, owning_partner_organisation_id)
    values ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-OWNER-MISMATCH', 'patient_owned',
            (select v from drl_fixture where k = 'org_b'));
  exception when check_violation then
    v_caught := true;
  end;
  insert into drl_results values ('patient_owned with an owning partner is rejected', 'true', v_caught::text);
end $$;

-- ==========================================================================
-- 3. Lifecycle/assignment CHECK constraints.
-- ==========================================================================
do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.device_units (organisation_id, device_type, manufacturer, model, serial_number, lifecycle_status, assigned_patient_id, assigned_at)
    values ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-BADASSIGN', 'registered',
            (select v from drl_fixture where k = 'patient_a1'), now());
  exception when check_violation then
    v_caught := true;
  end;
  insert into drl_results values ('assigned_patient_id rejected while lifecycle_status=registered', 'true', v_caught::text);
end $$;

do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.device_units (organisation_id, device_type, manufacturer, model, serial_number, lifecycle_status)
    values ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-RETIRED-NODATE', 'retired');
  exception when check_violation then
    v_caught := true;
  end;
  insert into drl_results values ('retired lifecycle_status without retired_at is rejected', 'true', v_caught::text);
end $$;

-- ==========================================================================
-- 4. Uniqueness on (manufacturer, model, serial_number).
-- ==========================================================================
insert into public.device_units (organisation_id, device_type, manufacturer, model, serial_number)
values ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-DUP');

do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.device_units (organisation_id, device_type, manufacturer, model, serial_number)
    values ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-DUP');
  exception when unique_violation then
    v_caught := true;
  end;
  insert into drl_results values ('duplicate manufacturer+model+serial_number is rejected', 'true', v_caught::text);
end $$;

-- A real unit, assigned to patient_a1, for the RLS probes below.
insert into public.device_units
  (organisation_id, device_type, manufacturer, model, serial_number, lifecycle_status, assigned_patient_id, assigned_at)
values
  ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-ASSIGNED', 'assigned',
   (select v from drl_fixture where k = 'patient_a1'), now());

insert into drl_fixture (k, v)
select 'assigned_unit', id from public.device_units where serial_number = 'DRL-SN-ASSIGNED';

-- ==========================================================================
-- 5/6/7. RLS on device_units.
-- ==========================================================================

-- The assigned patient sees their own unit.
do $$
declare
  v_visible boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'patient_a1')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists(select 1 from public.device_units where id = (select v from drl_fixture where k = 'assigned_unit')) into v_visible;
  reset role;
  insert into drl_results values ('the assigned patient sees their own device_units row', 'true', v_visible::text);
end $$;

-- NEGATIVE control: a different patient in the same org sees nothing —
-- proves the policy discriminates rather than granting org-wide patient read.
do $$
declare
  v_visible boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'patient_a2')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists(select 1 from public.device_units where id = (select v from drl_fixture where k = 'assigned_unit')) into v_visible;
  reset role;
  insert into drl_results values ('a different patient in the same org cannot see it', 'false', v_visible::text);
end $$;

-- A patient cannot register a new device_units row (staff-only write).
do $$
declare
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'patient_a1')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.device_units (organisation_id, device_type, manufacturer, model, serial_number)
    values ((select v from drl_fixture where k = 'org_a'), 'bp_cuff', 'DRL Mfr', 'DRL Model', 'DRL-SN-PATIENT-INSERT');
  exception when others then
    v_caught := true;
  end;
  reset role;
  insert into drl_results values ('a patient cannot insert a device_units row', 'true', v_caught::text);
end $$;

-- Org staff sees the unit, and can update its lifecycle.
do $$
declare
  v_visible boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'staff_a')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists(select 1 from public.device_units where id = (select v from drl_fixture where k = 'assigned_unit')) into v_visible;
  update public.device_units set lifecycle_status = 'active' where id = (select v from drl_fixture where k = 'assigned_unit');
  reset role;
  insert into drl_results values ('org staff sees a unit in their organisation', 'true', v_visible::text);
end $$;

insert into drl_results
select 'org staff can update lifecycle_status', 'active',
  (select lifecycle_status::text from public.device_units where id = (select v from drl_fixture where k = 'assigned_unit'));

-- NEGATIVE control: staff in a DIFFERENT organisation see nothing — proves
-- is_org_staff scoping, not a blanket staff bypass.
do $$
declare
  v_visible boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'staff_b')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists(select 1 from public.device_units where id = (select v from drl_fixture where k = 'assigned_unit')) into v_visible;
  reset role;
  insert into drl_results values ('staff in a different organisation cannot see it', 'false', v_visible::text);
end $$;

-- ==========================================================================
-- 8. device_fault_reports RLS.
-- ==========================================================================

insert into public.patient_devices (organisation_id, patient_id, device_type, ble_device_id, device_unit_id)
values ((select v from drl_fixture where k = 'org_a'), (select v from drl_fixture where k = 'patient_a1'), 'bp_cuff', 'DRL-BLE-1',
        (select v from drl_fixture where k = 'assigned_unit'));

insert into drl_fixture (k, v)
select 'pairing', id from public.patient_devices where ble_device_id = 'DRL-BLE-1';

-- Patient files their own report.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'patient_a1')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.device_fault_reports (organisation_id, patient_id, patient_device_id, device_unit_id, reported_by, description)
  values ((select v from drl_fixture where k = 'org_a'), (select v from drl_fixture where k = 'patient_a1'),
          (select v from drl_fixture where k = 'pairing'), (select v from drl_fixture where k = 'assigned_unit'),
          (select v from drl_fixture where k = 'patient_a1'), 'DRL test: will not turn on');
  reset role;
end $$;

insert into drl_fixture (k, v)
select 'fault_report', id from public.device_fault_reports where description = 'DRL test: will not turn on';

insert into drl_results
select 'a fault report was created with status=reported', 'reported',
  (select status::text from public.device_fault_reports where id = (select v from drl_fixture where k = 'fault_report'));

-- The reporting patient can read it back, but cannot resolve it themselves
-- (device_fault_reports_update is staff-only).
do $$
declare
  v_visible boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'patient_a1')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists(select 1 from public.device_fault_reports where id = (select v from drl_fixture where k = 'fault_report')) into v_visible;
  update public.device_fault_reports
     set status = 'resolved', resolution_notes = 'patient self-resolved (should not happen)', resolved_at = now()
   where id = (select v from drl_fixture where k = 'fault_report');
  reset role;
  insert into drl_results values ('the reporting patient can read their own report', 'true', v_visible::text);
end $$;

insert into drl_results
select 'a patient cannot resolve their own fault report', 'reported',
  (select status::text from public.device_fault_reports where id = (select v from drl_fixture where k = 'fault_report'));

-- NEGATIVE control: a different patient in the same org cannot see it.
do $$
declare
  v_visible boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'patient_a2')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists(select 1 from public.device_fault_reports where id = (select v from drl_fixture where k = 'fault_report')) into v_visible;
  reset role;
  insert into drl_results values ('a different patient cannot see it', 'false', v_visible::text);
end $$;

-- Org staff can read and resolve it.
do $$
declare
  v_visible boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from drl_fixture where k = 'staff_a')::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select exists(select 1 from public.device_fault_reports where id = (select v from drl_fixture where k = 'fault_report')) into v_visible;
  update public.device_fault_reports
     set status = 'resolved', resolution_notes = 'Re-paired successfully.', resolved_at = now()
   where id = (select v from drl_fixture where k = 'fault_report');
  reset role;
  insert into drl_results values ('org staff can read the report', 'true', v_visible::text);
end $$;

insert into drl_results
select 'org staff can resolve the report', 'resolved',
  (select status::text from public.device_fault_reports where id = (select v from drl_fixture where k = 'fault_report'));

-- ==========================================================================
-- 9. device_fault_reports CHECK constraints.
-- ==========================================================================
do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.device_fault_reports (organisation_id, patient_id, reported_by, description, status)
    values ((select v from drl_fixture where k = 'org_a'), (select v from drl_fixture where k = 'patient_a1'),
            (select v from drl_fixture where k = 'patient_a1'), 'DRL test: resolved without resolved_at', 'resolved');
  exception when check_violation then
    v_caught := true;
  end;
  insert into drl_results values ('resolved status without resolved_at is rejected', 'true', v_caught::text);
end $$;

do $$
declare
  v_caught boolean := false;
begin
  begin
    insert into public.device_fault_reports (organisation_id, patient_id, reported_by, description, status, replacement_device_unit_id)
    values ((select v from drl_fixture where k = 'org_a'), (select v from drl_fixture where k = 'patient_a1'),
            (select v from drl_fixture where k = 'patient_a1'), 'DRL test: replacement without replaced status', 'reported',
            (select v from drl_fixture where k = 'assigned_unit'));
  exception when check_violation then
    v_caught := true;
  end;
  insert into drl_results values ('replacement_device_unit_id without status=replaced is rejected', 'true', v_caught::text);
end $$;

-- ==========================================================================
-- Report + fail the run if anything didn't match.
-- ==========================================================================

select check_name, expected, actual,
       case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from drl_results
 order by check_name;

do $$
declare
  v_failures int;
begin
  select count(*) into v_failures from drl_results where expected is distinct from actual;
  if v_failures > 0 then
    raise exception '% device_registry_lifecycle check(s) failed — see the printed results table above', v_failures;
  end if;
end $$;

rollback;
