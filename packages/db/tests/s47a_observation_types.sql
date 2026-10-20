-- ===========================================================================
-- Proof: *_s47a_a_* and *_s47a_b_* (S47a): water, sleep and mood observations, the inhaler-use log, plausibility CHECKs, events, and the signed limits.
--
--   A. Born off: with platform module extended_observations off, a water row is refused by the database (55000) and so is log_inhaler_use.
--   B. On: water / sleep / mood rows save, the unit is set by the database (ml / h / score), and public.observations maps them
--      (type text, value_numeric, unit). Implausible numbers (water 5000, sleep 30, mood 6, mood 2.5) are refused by the CHECK (23514).
--   C. The existing red-flag engines are untouched: the new types raise no emergency_events row, while a dangerous glucose (2.1 mmol/L)
--      in the same session still raises its glucose_red_flag row (gate-opens control).
--   D. Events: a water row emits observation.recorded (kind water) and water.logged; a mood row emits observation.recorded (kind mood) only.
--   E. Edit history: the patient corrects her own water entry through correct_clinical_value; the replacement carries supersedes_id, the chart
--      view (public.observations) shows only the replacement, and the original is still in the table.
--   F. Inhaler log: the patient logs (2 puffs), a retry with the same client id is one row, 25 puffs is refused, the table cannot be written or
--      updated directly, a stranger can neither read nor correct it, a correction supersedes (current view shows the replacement, marked changed).
--   G. Grants: anon cannot execute any S47a function; only the Chief Medical Officer signs the limits; the seed ships unsigned and inactive.
--   H. SABOTAGE (each must flip): the plausibility CHECK dropped (water 5000 now saves); the lifestyle guard trigger dropped (a row saves while
--      the module is off); the glucose backstop trigger disabled (the dangerous glucose raises nothing, so check C is not vacuous).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temporary table s47a_fx (k text primary key, v uuid) on commit drop;
grant all on s47a_fx to public;

do $$
declare
  v_org uuid;
  v_p uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then
    insert into public.organisations (name, type) values ('S47a Test Org', 'clinic') returning id into v_org;
  end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p, 's47a-p@example.invalid', 'x', now(), '{}', '{}'),
    (v_other, 's47a-o@example.invalid', 'x', now(), '{}', '{}'),
    (v_cmo, 's47a-c@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_p, v_org, 'patient', 'S47a Patient', '+2348047000001'),
    (v_other, v_org, 'patient', 'S47a Stranger', '+2348047000002'),
    (v_cmo, v_org, 'clinician', 'S47a CMO', '+2348047000003')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_adm, 's47a-a@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v_adm, v_org, 'admin', 'S47a Admin', '+2348047000004')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'S47a CMO', 'MDCN', 'S47A-CMO-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_adm,
      'chief_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, v_adm, true);
  insert into s47a_fx values ('org', v_org), ('p', v_p), ('other', v_other), ('cmo', v_cmo);
end $$;

-- A. born off --------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from s47a_fx where k = 'org');
  v_p uuid := (select v from s47a_fx where k = 'p');
  v_state text;
begin
  if (select is_enabled from public.platform_modules where key = 'extended_observations') is distinct from false then
    raise exception 'A FAIL: extended_observations must be born off';
  end if;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source)
    values (v_org, v_p, 'water_ml', 250, now(), 'manual');
    raise exception 'A FAIL: a water row saved while the module is off';
  exception when sqlstate '55000' then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.log_inhaler_use(2, 'before_exercise');
    raise exception 'A FAIL: an inhaler row saved while the module is off';
  exception when sqlstate '55000' then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS A: the new logs are refused by the database while extended_observations is off';
end $$;

-- the switch is flipped the way the other proofs do it (an attributed enable)
update public.platform_modules
   set is_enabled = true, enabled_at = now(), enabled_by = (select v from s47a_fx where k = 'cmo'), activation_note = 'S47a proof'
 where key = 'extended_observations';

-- B. saves, units, view mapping, plausibility ---------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from s47a_fx where k = 'org');
  v_p uuid := (select v from s47a_fx where k = 'p');
  v_id uuid; v_unit text; v_type text; v_val numeric; v_vunit text; v_bad numeric;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source)
  values (v_org, v_p, 'water_ml', 250, now(), 'manual') returning id into v_id;
  insert into s47a_fx values ('water', v_id);
  select value_unit into v_unit from public.vitals_readings where id = v_id;
  if v_unit is distinct from 'ml' then raise exception 'B FAIL: water unit is %', v_unit; end if;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source)
  values (v_org, v_p, 'sleep_hours', 7.5, now(), 'manual') returning id into v_id;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source)
  values (v_org, v_p, 'mood', 4, now(), 'manual') returning id into v_id;
  insert into s47a_fx values ('mood', v_id);

  select type, value_numeric, unit into v_type, v_val, v_vunit from public.observations where id = (select v from s47a_fx where k = 'water');
  if v_type is distinct from 'water_ml' or v_val is distinct from 250 or v_vunit is distinct from 'ml' then
    raise exception 'B FAIL: observations view maps water as (%, %, %)', v_type, v_val, v_vunit;
  end if;
  if (select unit from public.observations where id = v_id) is distinct from 'score' then raise exception 'B FAIL: mood unit'; end if;

  foreach v_bad in array array[5000, 5, 2000.5]::numeric[] loop
    begin
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source)
      values (v_org, v_p, 'water_ml', v_bad, now(), 'manual');
      raise exception 'B FAIL: water % saved', v_bad;
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source)
    values (v_org, v_p, 'sleep_hours', 30, now(), 'manual');
    raise exception 'B FAIL: sleep 30 saved';
  exception when check_violation then null;
  end;
  foreach v_bad in array array[6, 2.5, 0]::numeric[] loop
    begin
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source)
      values (v_org, v_p, 'mood', v_bad, now(), 'manual');
      raise exception 'B FAIL: mood % saved', v_bad;
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, taken_at, source)
    values (v_org, v_p, 'mood', now(), 'manual');
    raise exception 'B FAIL: a mood row with no number saved';
  exception when check_violation then null;
  end;
  raise notice 'PASS B: new types save with their own unit, map into public.observations, and implausible numbers are refused';
end $$;

-- C. the existing engines are untouched -------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from s47a_fx where k = 'org');
  v_p uuid := (select v from s47a_fx where k = 'p');
  v_n integer;
begin
  select count(*) into v_n from public.emergency_events where patient_id = v_p;
  if v_n <> 0 then raise exception 'C FAIL: the new types raised % emergency rows', v_n; end if;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, taken_at, source)
  values (v_org, v_p, 'glucose', 2.1, now(), 'manual');
  select count(*) into v_n from public.emergency_events where patient_id = v_p and source = 'glucose_red_flag';
  if v_n <> 1 then raise exception 'C FAIL: the dangerous glucose raised % glucose_red_flag rows (expected 1)', v_n; end if;
  -- the two replaced trigger functions keep their live behaviour for the types they already served
  if position('water_ml' in pg_get_functiondef('private.timeline_from_vitals_reading'::regproc)) = 0
     or position('Glucose recorded' in pg_get_functiondef('private.timeline_from_vitals_reading'::regproc)) = 0 then
    raise exception 'C FAIL: timeline function lost its glucose title or the lifestyle exit';
  end if;
  if position('rewards_emit' in pg_get_functiondef('private.wellness_points_on_vitals_logged'::regproc)) = 0 then
    raise exception 'C FAIL: wellness points function lost its emit';
  end if;
  raise notice 'PASS C: no red-flag row from the new types; the dangerous glucose still raises glucose_red_flag';
end $$;

-- D. events -----------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_w uuid := (select v from s47a_fx where k = 'water');
  v_m uuid := (select v from s47a_fx where k = 'mood');
begin
  if not exists (select 1 from public.domain_events where event_type = 'observation.recorded' and aggregate_id = v_w and payload ->> 'kind' = 'water')
     or not exists (select 1 from public.domain_events where event_type = 'water.logged' and aggregate_id = v_w) then
    raise exception 'D FAIL: water did not emit observation.recorded (kind water) and water.logged';
  end if;
  if not exists (select 1 from public.domain_events where event_type = 'observation.recorded' and aggregate_id = v_m and payload ->> 'kind' = 'mood')
     or exists (select 1 from public.domain_events where event_type = 'water.logged' and aggregate_id = v_m) then
    raise exception 'D FAIL: mood events are wrong';
  end if;
  raise notice 'PASS D: observation.recorded and water.logged are emitted';
end $$;

-- E. edit history -----------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_p uuid := (select v from s47a_fx where k = 'p');
  v_w uuid := (select v from s47a_fx where k = 'water');
  v_res jsonb; v_rep uuid; v_val numeric; v_sup uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('vitals_readings', v_w, 'corrected', 'I typed the wrong amount', '{"value_numeric": 300}'::jsonb);
  v_rep := (v_res ->> 'replacement_id')::uuid;
  select value_numeric into v_val from public.observations where id = v_rep;
  if v_val is distinct from 300 then raise exception 'E FAIL: the chart does not show the replacement (%)', v_val; end if;
  if exists (select 1 from public.observations where id = v_w) then raise exception 'E FAIL: the chart still shows the original'; end if;
  select supersedes_id into v_sup from public.vitals_readings where id = v_rep;
  if v_sup is distinct from v_w then raise exception 'E FAIL: the replacement does not point at the original'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  if not exists (select 1 from public.vitals_readings where id = v_w and correction_status = 'corrected') then
    raise exception 'E FAIL: the original was lost or not marked';
  end if;
  raise notice 'PASS E: the edit supersedes; the chart shows the current value and the original is kept';
end $$;

-- F. inhaler log -------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_p uuid := (select v from s47a_fx where k = 'p');
  v_other uuid := (select v from s47a_fx where k = 'other');
  v_cid uuid := gen_random_uuid();
  v_id uuid; v_id2 uuid; v_new uuid; v_n integer; v_changed boolean; v_puffs integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_id := public.log_inhaler_use(2, 'before_exercise', null, v_cid);
  v_id2 := public.log_inhaler_use(2, 'before_exercise', null, v_cid);
  if v_id is null or v_id2 is distinct from v_id then raise exception 'F FAIL: a retry with the same client id made a second row'; end if;
  begin
    perform public.log_inhaler_use(25, 'other');
    raise exception 'F FAIL: 25 puffs saved';
  exception when sqlstate '22023' then null;
  end;
  begin
    insert into public.inhaler_use_logs (organisation_id, patient_id, puffs, reason, recorded_by)
    values ((select v from s47a_fx where k = 'org'), v_p, 1, 'other', v_p);
    raise exception 'F FAIL: a direct insert was allowed';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_n from public.inhaler_use_logs where patient_id = v_p;
  if v_n <> 1 then raise exception 'F FAIL: the patient sees % rows', v_n; end if;

  -- a correction supersedes; the current view shows the replacement, marked changed
  v_new := public.correct_inhaler_use(v_id, 3, 'before_exercise', 'It was three puffs, not two');
  select puffs, was_changed into v_puffs, v_changed from public.inhaler_use_current where patient_id = v_p;
  if v_puffs <> 3 or v_changed is not true then raise exception 'F FAIL: the current view is (%, %)', v_puffs, v_changed; end if;
  if (select count(*) from public.inhaler_use_current where patient_id = v_p) <> 1 then raise exception 'F FAIL: the current view shows the history'; end if;
  begin
    perform public.correct_inhaler_use(v_id, 4, 'other', 'A second change of the same row');
    raise exception 'F FAIL: a row was changed twice';
  exception when sqlstate '22023' then null;
  end;
  execute 'reset role';

  -- a stranger sees nothing and cannot correct (gate-opens control: the owner saw her row above)
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.inhaler_use_logs where patient_id = v_p;
  if v_n <> 0 then raise exception 'F FAIL: a stranger reads % inhaler rows', v_n; end if;
  begin
    perform public.correct_inhaler_use(v_new, 1, 'other', 'I should not be able to');
    raise exception 'F FAIL: a stranger corrected a row';
  exception when sqlstate '42501' then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- append-only even for the table owner
  begin
    update public.inhaler_use_logs set puffs = 9 where id = v_id;
    raise exception 'F FAIL: an update was allowed';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'PASS F: the inhaler log saves once, refuses 25 puffs, is append-only, supersedes, and is private';
end $$;

-- G. grants and the signature -------------------------------------------------------------------------------------------------------------
do $$
declare
  v_cmo uuid := (select v from s47a_fx where k = 'cmo');
  v_p uuid := (select v from s47a_fx where k = 'p');
  v_row uuid;
begin
  if has_function_privilege('anon', 'public.log_inhaler_use(integer, text, timestamptz, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.correct_inhaler_use(uuid, integer, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_observation_limits(uuid)', 'EXECUTE') then
    raise exception 'G FAIL: anon can execute an S47a function';
  end if;
  select id into v_row from public.observation_limit_signoffs where version = 1;
  if (select is_active from public.observation_limit_signoffs where id = v_row) or (select approved_by from public.observation_limit_signoffs where id = v_row) is not null then
    raise exception 'G FAIL: the seed is not unsigned and inactive';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.sign_observation_limits(v_row);
    raise exception 'G FAIL: a patient signed the limits';
  exception when others then
    if sqlerrm not like 'not authorised%' then raise; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.sign_observation_limits(v_row);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  if not (select is_active and approved_by is not null from public.observation_limit_signoffs where id = v_row) then raise exception 'G FAIL: the CMO signature did not activate the version'; end if;
  if (select is_enabled from public.platform_modules where key = 'extended_observations') is not true then raise exception 'G FAIL: setup'; end if;
  raise notice 'PASS G: anon is shut out and only the Chief Medical Officer signs';
end $$;

-- H. SABOTAGE -------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select v from s47a_fx where k = 'org');
  v_p uuid := (select v from s47a_fx where k = 'p');
  v_flipped boolean; v_n integer;
begin
  -- H1: without the CHECK, water 5000 saves
  alter table public.vitals_readings drop constraint vitals_readings_s47a_lifestyle_plausible;
  v_flipped := false;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, taken_at, source) values (v_org, v_p, 'water_ml', 5000, now(), 'manual');
    v_flipped := true;
  exception when others then null;
  end;
  if not v_flipped then raise exception 'H1 FAIL: the sabotage did not flip (the proof of the CHECK is vacuous)'; end if;

  -- H2: without the guard trigger, a row saves while the module is off
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null where key = 'extended_observations';
  drop trigger vitals_readings_b0_s47a_lifestyle_guard on public.vitals_readings;
  v_flipped := false;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, value_numeric, value_unit, taken_at, source) values (v_org, v_p, 'sleep_hours', 8, 'h', now(), 'manual');
    v_flipped := true;
  exception when others then null;
  end;
  if not v_flipped then raise exception 'H2 FAIL: the sabotage did not flip (the proof of the guard is vacuous)'; end if;

  -- H3: with the glucose backstop off, the dangerous glucose raises nothing (so check C discriminates)
  alter table public.vitals_readings disable trigger vitals_readings_glucose_emergency_backstop;
  delete from public.emergency_events where patient_id = v_p;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, taken_at, source) values (v_org, v_p, 'glucose', 2.0, now(), 'manual');
  select count(*) into v_n from public.emergency_events where patient_id = v_p and source = 'glucose_red_flag';
  if v_n <> 0 then raise exception 'H3 FAIL: glucose raised a row with its backstop disabled (%), so check C proves nothing', v_n; end if;
  raise notice 'PASS H: each sabotage flipped its check';
end $$;

rollback;
