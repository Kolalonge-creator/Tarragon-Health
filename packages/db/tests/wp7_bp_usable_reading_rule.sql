-- ===========================================================================
-- Proof: 20261023214131_wp7_bp_usable_reading_rule.sql (OQ-WP3-04: which blood pressure readings the S38 / S75 reports count).
--
-- RULE  usable = status 'valid', or status 'requires_validation' with a NON-EMPTY flag list holding only 'insufficient_context'.
--       An empty flag list must NOT qualify (an empty array is a subset of every array).
-- PROVES
--   1. The helper's truth table (valid; waiting+only insufficient_context; waiting+empty; waiting+null; waiting+insufficient_context+another flag;
--      waiting+another flag only; valid with an unrelated flag; null status).
--   2. private.bp_window_stats counts exactly the first two kinds of reading from a mixed fixture.
--   3. The four objects that used to carry the old pattern (bp_window_stats, outcome_compute_snapshot, v_bp_cohort_90d, v_bp_cohort_day) now
--      call the helper and carry no inline pattern; the helper and those functions/views are closed to anon and authenticated.
--   4. SABOTAGE: bp_window_stats re-created with the old inline pattern must count MORE readings (the empty-flag ones), proving check 2 discriminates.
-- Note: vitals_validation_status has only two values (valid, requires_validation), so "empty flags with some other status" cannot exist.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create temp table wp7_results (check_name text, observed text, expected text, verdict text);
grant all on wp7_results to public;
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin
  insert into wp7_results values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  p uuid := gen_random_uuid();
  d date := (now() at time zone 'Africa/Lagos')::date;
  v_n integer; v_avg numeric; v_def text; v_old text; v_n_sab integer; r record; i integer;
  ids uuid[] := array[]::uuid[]; v_id uuid;
begin
  -- 1. helper truth table
  perform pg_temp.chk('1a valid', 'true', private.bp_reading_usable('valid', null)::text);
  perform pg_temp.chk('1b valid with an unrelated flag', 'true', private.bp_reading_usable('valid', array['sudden_change'])::text);
  perform pg_temp.chk('1c waiting, only insufficient_context', 'true', private.bp_reading_usable('requires_validation', array['insufficient_context'])::text);
  perform pg_temp.chk('1d waiting, empty flags', 'false', private.bp_reading_usable('requires_validation', '{}'::text[])::text);
  perform pg_temp.chk('1e waiting, null flags', 'false', private.bp_reading_usable('requires_validation', null)::text);
  perform pg_temp.chk('1f waiting, insufficient_context plus another flag', 'false', private.bp_reading_usable('requires_validation', array['insufficient_context', 'sudden_change'])::text);
  perform pg_temp.chk('1g waiting, another flag only', 'false', private.bp_reading_usable('requires_validation', array['duplicate_entry'])::text);
  perform pg_temp.chk('1h null status', 'false', private.bp_reading_usable(null, array['insufficient_context'])::text);

  -- 2. a mixed fixture
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (p, 'wp7-' || replace(p::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values (p, v_org, 'patient', 'WP7 Patient', '+2348077700001')
  on conflict (id) do update set role = 'patient';
  -- six readings on six days, all with an arm and position (so the insert trigger leaves them valid), then set the interesting states directly
  for i in 1..6 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
    values (v_org, p, 'blood_pressure', 100 + i * 10, 70 + i, 'seated', 'left', ((d - i)::timestamp + interval '12 hours') at time zone 'Africa/Lagos', 'manual')
    returning id into v_id;
    ids := ids || v_id;
  end loop;
  -- i=1 (110) valid; i=2 (120) waiting + only insufficient_context; i=3 (130) waiting + empty; i=4 (140) waiting + sudden_change only (the flag column is NOT NULL, so a null list cannot be stored);
  -- i=5 (150) waiting + insufficient_context + sudden_change; i=6 (160) waiting + duplicate_entry
  update public.vitals_readings set validation_status = 'requires_validation', validation_flags = array['insufficient_context'] where id = ids[2];
  update public.vitals_readings set validation_status = 'requires_validation', validation_flags = '{}'::text[] where id = ids[3];
  update public.vitals_readings set validation_status = 'requires_validation', validation_flags = array['sudden_change'] where id = ids[4];
  update public.vitals_readings set validation_status = 'requires_validation', validation_flags = array['insufficient_context', 'sudden_change'] where id = ids[5];
  update public.vitals_readings set validation_status = 'requires_validation', validation_flags = array['duplicate_entry'] where id = ids[6];
  perform pg_temp.chk('2-setup fixture states landed', '1/1/1/1/1/1',
    (select count(*) filter (where id = ids[1] and validation_status = 'valid')
        || '/' || count(*) filter (where id = ids[2] and validation_flags = array['insufficient_context'])
        || '/' || count(*) filter (where id = ids[3] and validation_flags = '{}'::text[] and validation_status = 'requires_validation')
        || '/' || count(*) filter (where id = ids[4] and validation_flags = array['sudden_change'])
        || '/' || count(*) filter (where id = ids[5] and cardinality(validation_flags) = 2)
        || '/' || count(*) filter (where id = ids[6] and validation_flags = array['duplicate_entry'])
       from public.vitals_readings where patient_id = p));

  select n, avg_sys into v_n, v_avg from private.bp_window_stats(p, d - 10, d);
  perform pg_temp.chk('2a only the valid and the insufficient_context-only readings are counted', '2', v_n::text);
  perform pg_temp.chk('2b their average is the average of those two (110 and 120)', '115.0', v_avg::text);

  -- 3. structure
  for r in select p2.proname, pg_get_functiondef(p2.oid) as def, p2.oid from pg_proc p2
            where p2.pronamespace = 'private'::regnamespace and p2.proname in ('bp_window_stats', 'outcome_compute_snapshot') loop
    perform pg_temp.chk('3 fn ' || r.proname || ' calls the helper, no inline pattern', 'true/false',
      (r.def like '%private.bp_reading_usable(validation_status, validation_flags)%')::text || '/' || (r.def like '%insufficient_context%')::text);
    perform pg_temp.chk('3 fn ' || r.proname || ' closed to API roles', 'false/false',
      has_function_privilege('anon', r.oid, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', r.oid, 'EXECUTE')::text);
  end loop;
  for r in select c.relname, pg_get_viewdef(c.oid) as def, c.oid from pg_class c
            where c.relnamespace = 'private'::regnamespace and c.relname in ('v_bp_cohort_90d', 'v_bp_cohort_day') loop
    perform pg_temp.chk('3 view ' || r.relname || ' calls the helper, no inline pattern', 'true/false',
      (r.def like '%bp_reading_usable(o.validation_status, o.validation_flags)%')::text || '/' || (r.def like '%insufficient_context%')::text);
    perform pg_temp.chk('3 view ' || r.relname || ' closed to API roles', 'false/false',
      has_table_privilege('anon', r.oid, 'SELECT')::text || '/' || has_table_privilege('authenticated', r.oid, 'SELECT')::text);
  end loop;
  perform pg_temp.chk('3 helper closed to API roles, immutable', 'false/false/true',
    has_function_privilege('anon', 'private.bp_reading_usable(public.vitals_validation_status, text[])', 'EXECUTE')::text || '/'
    || has_function_privilege('authenticated', 'private.bp_reading_usable(public.vitals_validation_status, text[])', 'EXECUTE')::text || '/'
    || (select provolatile = 'i' from pg_proc where oid = 'private.bp_reading_usable(public.vitals_validation_status, text[])'::regprocedure)::text);

  -- 4. SABOTAGE: restore the old inline pattern in bp_window_stats; the same fixture must now count MORE (the empty-flag reading)
  v_def := pg_get_functiondef('private.bp_window_stats(uuid,date,date)'::regprocedure);
  v_old := '(validation_status = ''valid'' or coalesce(validation_flags, ''{}''::text[]) <@ array[''insufficient_context'']::text[])';
  if position('private.bp_reading_usable(validation_status, validation_flags)' in v_def) = 0 then raise exception 'sabotage setup FAIL: helper call not found'; end if;
  execute replace(v_def, 'private.bp_reading_usable(validation_status, validation_flags)', v_old);
  select n into v_n_sab from private.bp_window_stats(p, d - 10, d);
  if v_n_sab = v_n then raise exception 'VACUOUS TEST: restoring the old pattern did not change the count (% vs %)', v_n_sab, v_n; end if;
  perform pg_temp.chk('4 sabotage: the old pattern also counts the empty-flag reading (valid, insufficient_context, empty)', '3', v_n_sab::text);
  execute v_def;  -- restore
  select n into v_n from private.bp_window_stats(p, d - 10, d);
  perform pg_temp.chk('4 restored: back to 2', '2', v_n::text);
end $$;

select * from wp7_results order by check_name;
do $$ begin
  if exists (select 1 from wp7_results where verdict <> 'PASS') then raise exception 'wp7 proof FAILED: %', (select string_agg(check_name, '; ') from wp7_results where verdict <> 'PASS'); end if;
end $$;
rollback;
