-- ===========================================================================
-- Proof: 20261013215731_s04b1b_guard_late_patient_tables_and_minor_guard_gaps.sql
--   1. private.minor_guard_gaps() is empty after the migration (every patient table guarded or classified).
--   2. The eleven late tables are guarded, and a minor dependant is refused a row in each that exists.
--   3. A new unclassified patient_id table is reported; guarding it clears the report; dropping its trigger is reported again.
--   4. The function is not callable by anon or authenticated.
--   5. SABOTAGE: a function that returns nothing would hide the unclassified table (the check in 3 flips); a guarded table
--      with its trigger dropped is not blocked (the check in 2 flips).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create temp table s04b1b_orig as select pg_get_functiondef('private.minor_guard_gaps()'::regprocedure) as def;
grant select on s04b1b_orig to public;

do $$
declare
  v_org uuid;
  g uuid := gen_random_uuid();
  k uuid := gen_random_uuid();
  tname text;
  m text;
  v_late text[] := array['followup_offer_slots','followup_offers','medication_prn_flags','medication_prn_limits',
    'member_followup_entitlements','member_review_notes','poc_ecg_recordings','poc_measurements','poc_result_items',
    'poc_results','testing_event_bookings'];
begin
  select id into v_org from public.organisations order by created_at limit 1;

  -- 1
  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'FAIL 1: gaps remain: %', (select string_agg(table_name || ' ' || problem, '; ') from private.minor_guard_gaps());
  end if;

  -- 2
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (g, 's04b1b-g@example.invalid', 'x', now(), now(), '{}', '{}'),
    (k, 'dependent+' || k || '@dependents.tarragonhealth.internal', null, now(), now(), jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{}');
  perform public.provision_dependent_profile_basics(k, (current_date - interval '6 years')::date, null, g, 'minor_child');
  foreach tname in array v_late loop
    if to_regclass('public.' || tname) is null then continue; end if;
    if not exists (select 1 from public.minor_dependant_table_policy where table_name = tname and policy = 'guarded') then
      raise exception 'FAIL 2a: % is not guarded', tname;
    end if;
    m := null;
    begin
      execute format('insert into public.%I (patient_id) values ($1)', tname) using k;
    exception when others then m := sqlerrm; end;
    if m is null or m not like 'minor_dependant_scope%' then
      raise exception 'FAIL 2b: % did not refuse a minor dependant with the scope error (got %)', tname, m;
    end if;
  end loop;

  -- 3
  alter event trigger guard_new_patient_tables_trigger disable;  -- S04b-1e would guard it on creation; this proof needs it unclassified
  create table public.zz_s04b1b_gap (id uuid primary key default gen_random_uuid(), patient_id uuid);
  if not exists (select 1 from private.minor_guard_gaps() where table_name = 'zz_s04b1b_gap') then
    raise exception 'FAIL 3a: an unclassified patient table was not reported';
  end if;
  perform private.guard_minor_dependant_table('zz_s04b1b_gap');
  if exists (select 1 from private.minor_guard_gaps()) then raise exception 'FAIL 3b: guarding did not clear the report'; end if;
  drop trigger "00_minor_dependant_scope" on public.zz_s04b1b_gap;
  if not exists (select 1 from private.minor_guard_gaps() where table_name = 'zz_s04b1b_gap') then
    raise exception 'FAIL 3c: a guarded table without its trigger was not reported';
  end if;
  -- a DISABLED trigger is a gap too
  perform private.guard_minor_dependant_table('zz_s04b1b_gap');
  alter table public.zz_s04b1b_gap disable trigger "00_minor_dependant_scope";
  if not exists (select 1 from private.minor_guard_gaps() where table_name = 'zz_s04b1b_gap') then
    raise exception 'FAIL 3d: a disabled guard trigger was not reported';
  end if;
  alter table public.zz_s04b1b_gap enable trigger "00_minor_dependant_scope";
  perform private.guard_minor_dependant_table('zz_s04b1b_gap');

  -- 4
  if has_function_privilege('anon', 'private.minor_guard_gaps()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.minor_guard_gaps()', 'EXECUTE') then
    raise exception 'FAIL 4: callable by an API role';
  end if;
end $$;

-- 5a. a function that reports nothing hides an unclassified table: check 3a must be able to fail
do $$
declare src text;
begin
  alter event trigger guard_new_patient_tables_trigger disable;
  create table public.zz_s04b1b_gap2 (id uuid primary key default gen_random_uuid(), patient_id uuid);
  select def into src from s04b1b_orig;
  src := replace(src, 'where p.table_name is null', 'where false');
  if src not like '%where false%' then raise exception 'sabotage 5a did not apply'; end if;
  execute src;
  if exists (select 1 from private.minor_guard_gaps() where table_name = 'zz_s04b1b_gap2') then
    raise exception 'SABOTAGE 5a: the crippled function still reported the table, so check 3a could not have failed';
  end if;
end $$;

-- 5b. with a guard trigger dropped a minor gets a row in: check 2b must be able to fail
do $$
declare v_org uuid; g uuid := gen_random_uuid(); k uuid := gen_random_uuid(); ok boolean := false;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (g, 's04b1b-sg@example.invalid', 'x', now(), now(), '{}', '{}'),
    (k, 'dependent+' || k || '@dependents.tarragonhealth.internal', null, now(), now(), jsonb_build_object('role', 'patient', 'organisation_id', v_org), '{}');
  perform public.provision_dependent_profile_basics(k, (current_date - interval '6 years')::date, null, g, 'minor_child');
  if to_regclass('public.medication_prn_limits') is null then return; end if;
  drop trigger "00_minor_dependant_scope" on public.medication_prn_limits;
  begin
    insert into public.medication_prn_limits (patient_id) values (k);
    ok := true;
  exception when not_null_violation or foreign_key_violation or check_violation then ok := true;
  when others then ok := (sqlerrm not like 'minor_dependant_scope%'); end;
  if not ok then raise exception 'SABOTAGE 5b: dropping the guard did not let the minor through, so check 2b could not have failed'; end if;
end $$;

rollback;
