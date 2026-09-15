-- ===========================================================================
-- Verification: 20260829120000_wearable_granular_consent_and_patient_control
--
--   * a patient session can update their own connection's consent_* columns
--     and status (pause/resume), same grant path disconnect already used;
--   * a patient session CANNOT call delete_wearable_connection_data() for a
--     connection belonging to a DIFFERENT patient — sabotage control;
--   * the rightful owner's patient session CAN call it, and it actually
--     deletes the connection's vitals_readings + wearable_readings rows,
--     nulls the stored OAuth tokens, and marks the connection disconnected —
--     "delete my data" also means "and stop pulling more of it."
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/profiles_self_update_column_guard.sql):
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session — running as the connecting superuser
-- would silently bypass RLS via table ownership.
-- ===========================================================================

begin;

create temporary table wgcpc_fixture(k text primary key, v uuid) on commit drop;
create temporary table wgcpc_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: two patients in the same org, each with their own fitbit
-- connection, so cross-patient access can actually be tested rather than
-- assumed.
-- --------------------------------------------------------------------------
do $$
declare
  v_org        uuid;
  v_patient    uuid := gen_random_uuid();
  v_other      uuid := gen_random_uuid();
  v_connection uuid;
  v_other_connection uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'wgcpc-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other, 'wgcpc-test-other-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient, v_org, 'patient', 'WGCPC Test Patient'),
    (v_other, v_org, 'patient', 'WGCPC Test Other Patient');

  insert into public.wearable_connections
    (organisation_id, patient_id, provider, status, external_id, access_token, refresh_token)
  values (v_org, v_patient, 'fitbit', 'active', 'wgcpc-account', 'tok', 'refresh')
  returning id into v_connection;

  insert into public.wearable_connections
    (organisation_id, patient_id, provider, status, external_id, access_token, refresh_token)
  values (v_org, v_other, 'fitbit', 'active', 'wgcpc-other-account', 'tok2', 'refresh2')
  returning id into v_other_connection;

  insert into public.wearable_readings (organisation_id, connection_id, reading_type, value, unit, recorded_at)
  values (v_org, v_connection, 'steps', 4200, 'count', now());

  insert into public.vitals_readings
    (patient_id, organisation_id, vital_type, source, wearable_connection_id, taken_at, pulse_bpm)
  values (v_patient, v_org, 'pulse', 'wearable', v_connection, now(), 72);

  insert into wgcpc_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('other', v_other),
    ('connection', v_connection), ('other_connection', v_other_connection);
end $$;

-- ==========================================================================
-- 1. Patient session can toggle their own connection's consent columns.
-- ==========================================================================
do $$
declare
  v_patient    uuid := (select v from wgcpc_fixture where k = 'patient');
  v_connection uuid := (select v from wgcpc_fixture where k = 'connection');
  v_row_count  bigint;
  v_readback   boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.wearable_connections set consent_sleep = false where id = v_connection;
  get diagnostics v_row_count = row_count;
  select consent_sleep into v_readback from public.wearable_connections where id = v_connection;
  reset role;

  insert into wgcpc_result values
    ('patient narrows their own consent_sleep', 'patient', coalesce(v_readback::text, 'null'), 'false',
     case when v_row_count = 1 and v_readback = false then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 or v_readback is distinct from false then
    raise exception 'BROKEN: patient session could not update their own connection''s consent_sleep';
  end if;
end $$;

-- ==========================================================================
-- 2. Patient session can pause and resume their own connection.
-- ==========================================================================
do $$
declare
  v_patient    uuid := (select v from wgcpc_fixture where k = 'patient');
  v_connection uuid := (select v from wgcpc_fixture where k = 'connection');
  v_readback   public.wearable_connection_status;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.wearable_connections set status = 'paused' where id = v_connection;
  select status into v_readback from public.wearable_connections where id = v_connection;
  reset role;

  insert into wgcpc_result values
    ('patient pauses their own connection', 'patient', coalesce(v_readback::text, 'null'), 'paused',
     case when v_readback = 'paused' then 'PASS' else 'FAIL' end);
  if v_readback is distinct from 'paused' then
    raise exception 'BROKEN: patient session could not pause their own connection';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.wearable_connections set status = 'active' where id = v_connection;
  select status into v_readback from public.wearable_connections where id = v_connection;
  reset role;

  insert into wgcpc_result values
    ('patient resumes their own connection', 'patient', coalesce(v_readback::text, 'null'), 'active',
     case when v_readback = 'active' then 'PASS' else 'FAIL' end);
  if v_readback is distinct from 'active' then
    raise exception 'BROKEN: patient session could not resume their own paused connection';
  end if;
end $$;

-- ==========================================================================
-- 3. Sabotage — a DIFFERENT patient must not be able to delete this
--    connection's data.
-- ==========================================================================
do $$
declare
  v_other      uuid := (select v from wgcpc_fixture where k = 'other');
  v_connection uuid := (select v from wgcpc_fixture where k = 'connection');
  v_caught     boolean := false;
  v_msg        text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.delete_wearable_connection_data(v_connection);
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;
  reset role;

  insert into wgcpc_result values
    ('a different patient deletes another patient''s wearable data', 'other patient',
     coalesce(v_msg, 'not blocked'), 'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: a different patient session deleted another patient''s wearable data';
  end if;

  -- Control: the sabotage attempt must not have touched anything.
  if not exists (select 1 from public.wearable_readings where connection_id = v_connection) then
    raise exception 'BROKEN: the blocked sabotage attempt deleted data anyway';
  end if;
end $$;

-- ==========================================================================
-- 4. The rightful owner's patient session succeeds, and the rows are
--    actually gone (not merely hidden by RLS).
-- ==========================================================================
do $$
declare
  v_patient    uuid := (select v from wgcpc_fixture where k = 'patient');
  v_connection uuid := (select v from wgcpc_fixture where k = 'connection');
  v_vitals_deleted   bigint;
  v_readings_deleted bigint;
  v_status     public.wearable_connection_status;
  v_token      text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select vitals_deleted, wearable_readings_deleted
    into v_vitals_deleted, v_readings_deleted
    from public.delete_wearable_connection_data(v_connection);
  reset role;

  insert into wgcpc_result values
    ('owner deletes their own connection data (vitals rows)', 'patient', v_vitals_deleted::text, '1',
     case when v_vitals_deleted = 1 then 'PASS' else 'FAIL' end);
  insert into wgcpc_result values
    ('owner deletes their own connection data (wearable_readings rows)', 'patient', v_readings_deleted::text, '1',
     case when v_readings_deleted = 1 then 'PASS' else 'FAIL' end);
  if v_vitals_deleted <> 1 or v_readings_deleted <> 1 then
    raise exception 'BROKEN: expected exactly one vitals_readings and one wearable_readings row deleted, got % / %',
      v_vitals_deleted, v_readings_deleted;
  end if;

  if exists (select 1 from public.wearable_readings where connection_id = v_connection) then
    raise exception 'LEAK: wearable_readings row survived owner-initiated deletion';
  end if;
  if exists (select 1 from public.vitals_readings where wearable_connection_id = v_connection) then
    raise exception 'LEAK: vitals_readings row survived owner-initiated deletion';
  end if;

  select status, access_token into v_status, v_token
  from public.wearable_connections where id = v_connection;

  insert into wgcpc_result values
    ('connection disconnected + tokens revoked after deletion', 'patient',
     v_status::text || '/' || coalesce(v_token, 'null'), 'disconnected/null',
     case when v_status = 'disconnected' and v_token is null then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'disconnected' or v_token is not null then
    raise exception 'BROKEN: connection was not disconnected and revoked after owner-initiated deletion';
  end if;
end $$;

-- ==========================================================================
-- 5. Control — the OTHER patient's own connection and data are untouched by
--    everything above. If this fails, the function or its RLS scoped wider
--    than the one connection it was called on.
-- ==========================================================================
do $$
declare
  v_other_connection uuid := (select v from wgcpc_fixture where k = 'other_connection');
  v_status public.wearable_connection_status;
begin
  select status into v_status from public.wearable_connections where id = v_other_connection;

  insert into wgcpc_result values
    ('other patient''s own connection untouched', 'other patient', coalesce(v_status::text, 'null'), 'active',
     case when v_status = 'active' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'active' then
    raise exception 'BROKEN: an unrelated connection was affected by this test';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from wgcpc_result
order by verdict desc, check_name, role;

rollback;
