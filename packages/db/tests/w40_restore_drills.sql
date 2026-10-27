-- W-40 proof: restore_drills.
--   admin only (clinician, anon refused); an OPEN drill changes only its finishing columns; a FINISHED drill is immutable for every role,
--   the table owner included; nothing deletes; a mistake is voided through void_restore_drill (admin only, reason of 20+ characters,
--   audited, voided columns writable no other way); restore_drill_status() ignores voided drills.
-- One rolled-back transaction; every check raises on failure. NOT executed when written (no Docker on the authoring machine).
-- SABOTAGE (one per rule, at the end): the guard trigger dropped (open-row column lock and finished-row immutability must both fail
-- to hold), the insert policy opened to anyone, and restore_drill_status() redefined to ignore voids; each check must flip.
begin;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w40-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'W40 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

-- run a statement as a user; returns 'ok <rows>' or 'ERR <sqlstate>'
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql; get diagnostics r = row_count; r := 'ok ' || r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

-- run a statement as the table owner (the current superuser session); 'ok <rows>' or 'ERR <sqlstate>'
create function pg_temp.as_owner(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  begin execute p_sql; get diagnostics r = row_count; r := 'ok ' || r; exception when others then r := 'ERR ' || sqlstate; end;
  return r;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; r text; v_open uuid; v_done uuid; v_bad uuid; s record;
  ins text := 'insert into public.restore_drills (drill_kind, environment, target_restore_point, started_at, rto_target_minutes, rpo_target_minutes) values (''pitr_restore'', ''branch'', now() - interval ''1 hour'', now() - interval ''3 hours'', 240, 15)';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');

  -- 1. who can open and read -------------------------------------------------------------------------------------------------------
  r := pg_temp.as_user(v_admin, ins);
  if r <> 'ok 1' then raise exception 'admin insert expected ok 1, got %', r; end if;
  r := pg_temp.as_user(v_doc, ins);
  if r = 'ok 1' then raise exception 'clinician must not insert a drill'; end if;
  r := pg_temp.as_anon(ins);
  if r = 'ok' then raise exception 'anon must not insert a drill'; end if;
  r := pg_temp.as_anon('select count(*) from public.restore_drills');
  if r = 'ok' then raise exception 'anon must not read drills'; end if;
  r := pg_temp.as_user(v_doc, 'select 1 from public.restore_drills');
  if r <> 'ok 0' then raise exception 'clinician must read zero drills, got %', r; end if;
  select id into v_open from public.restore_drills order by created_at desc limit 1;

  -- 2. an OPEN drill: only the finishing columns change (rule a) ------------------------------------------------------------------------
  r := pg_temp.as_user(v_admin, format('update public.restore_drills set rto_target_minutes = 1 where id = %L', v_open));
  if r not like 'ERR %' and r <> 'ok 0' then raise exception 'changing a target on an open drill must be refused, got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set rto_target_minutes = 1 where id = %L', v_open));
  if r not like 'ERR %' then raise exception 'rule a: the owner must not change rto_target_minutes on an open drill, got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set started_at = now() where id = %L', v_open));
  if r not like 'ERR %' then raise exception 'rule a: the owner must not change started_at on an open drill, got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set notes = ''still running'' where id = %L', v_open));
  if r <> 'ok 1' then raise exception 'rule a: notes is writable on an open drill, got %', r; end if;
  r := pg_temp.as_user(v_admin, format('update public.restore_drills set passed = true where id = %L', v_open));
  if r not like 'ERR %' then raise exception 'a result with no finish time must be refused, got %', r; end if;
  r := pg_temp.as_user(v_admin, format('update public.restore_drills set finished_at = started_at + interval ''90 minutes'', passed = true, achieved_rpo_minutes = 5 where id = %L', v_open));
  if r <> 'ok 1' then raise exception 'admin finishing a drill expected ok 1, got %', r; end if;
  if (select duration_minutes from public.restore_drills where id = v_open) <> 90 then raise exception 'duration_minutes should be 90'; end if;
  v_done := v_open;

  -- 3. a FINISHED drill is immutable for every role, and nothing deletes (rules b, c) -------------------------------------------------------
  r := pg_temp.as_user(v_admin, format('update public.restore_drills set notes = ''edited'' where id = %L', v_done));
  if r <> 'ok 0' then raise exception 'admin must not edit a finished drill (row security hides it), got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set notes = ''edited'' where id = %L', v_done));
  if r not like 'ERR %' then raise exception 'rule b: the owner must not edit a finished drill, got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set passed = false where id = %L', v_done));
  if r not like 'ERR %' then raise exception 'rule b: the owner must not flip the result of a finished drill, got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set voided_at = now(), voided_by = %L, void_reason = ''set directly by the owner, not allowed'' where id = %L', v_admin, v_done));
  if r not like 'ERR %' then raise exception 'rule d: the owner must not write voided_* directly, got %', r; end if;
  r := pg_temp.as_user(v_admin, 'delete from public.restore_drills');
  if r not like 'ERR %' and r <> 'ok 0' then raise exception 'delete must be refused, got %', r; end if;
  r := pg_temp.as_owner('delete from public.restore_drills');
  if r not like 'ERR %' then raise exception 'rule c: the owner must not delete a drill, got %', r; end if;

  -- 4. status reads the last good drill (admin only) ---------------------------------------------------------------------------------
  select * into s from (select pg_temp.as_user(v_doc, 'select * from public.restore_drill_status()') x) t;
  if s.x = 'ok 1' or s.x = 'ok 0' then raise exception 'a clinician must not read restore_drill_status, got %', s.x; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select * into s from public.restore_drill_status();
  reset role;
  if s.last_good_id is distinct from v_done then raise exception 'status should name the finished passed drill, got %', s.last_good_id; end if;
  if s.met_rto is distinct from true then raise exception 'a 90 minute drill meets a 240 minute target'; end if;

  -- 5. void path (rule d) ---------------------------------------------------------------------------------------------------------------
  r := pg_temp.as_user(v_doc, format('select public.void_restore_drill(%L, %L)', v_done, 'a clinician has no business voiding a drill'));
  if r not like 'ERR %' then raise exception 'a clinician must not void, got %', r; end if;
  r := pg_temp.as_anon(format('select public.void_restore_drill(%L, %L)', v_done, 'anon has no business voiding a drill at all'));
  if r = 'ok' then raise exception 'anon must not void'; end if;
  r := pg_temp.as_user(v_admin, format('select public.void_restore_drill(%L, %L)', v_done, 'too short'));
  if r not like 'ERR %' then raise exception 'a short reason must be refused, got %', r; end if;
  r := pg_temp.as_user(v_admin, format('select public.void_restore_drill(%L, %L)', gen_random_uuid(), 'a reason that is long enough to pass'));
  if r not like 'ERR %' then raise exception 'voiding an unknown drill must be refused, got %', r; end if;
  r := pg_temp.as_user(v_admin, format('select public.void_restore_drill(%L, %L)', v_done, 'entered against the wrong project by mistake'));
  if r not like 'ok%' then raise exception 'admin void expected ok, got %', r; end if;
  if (select voided_by from public.restore_drills where id = v_done) is distinct from v_admin then raise exception 'voided_by should be the admin'; end if;
  if not exists (select 1 from public.audit_log where action = 'restore_drill.void' and entity_id = v_done) then raise exception 'the void must be audited'; end if;
  r := pg_temp.as_user(v_admin, format('select public.void_restore_drill(%L, %L)', v_done, 'voiding the same drill a second time'));
  if r not like 'ERR %' then raise exception 'a second void must be refused, got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set notes = ''x'' where id = %L', v_done));
  if r not like 'ERR %' then raise exception 'a voided drill must stay frozen, got %', r; end if;
  -- a voided drill is not the last good drill
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select * into s from public.restore_drill_status();
  reset role;
  if s.last_good_id is not null then raise exception 'status must ignore a voided drill, got %', s.last_good_id; end if;
  if s.voided_drills <> 1 then raise exception 'status should count 1 voided drill, got %', s.voided_drills; end if;

  -- 6. SABOTAGE: each rule must be able to fail --------------------------------------------------------------------------------------------
  -- (i) guard trigger dropped: the locked-column update and the finished-row edit now succeed
  select id into v_bad from public.restore_drills where voided_at is null order by created_at limit 1;
  if v_bad is null then
    perform pg_temp.as_user(v_admin, ins);
    select id into v_bad from public.restore_drills where voided_at is null order by created_at desc limit 1;
  end if;
  drop trigger restore_drills_guard on public.restore_drills;
  r := pg_temp.as_owner(format('update public.restore_drills set rto_target_minutes = 1 where id = %L', v_bad));
  if r <> 'ok 1' then raise exception 'SABOTAGE (open-row column lock) did not flip, got %', r; end if;
  r := pg_temp.as_owner(format('update public.restore_drills set notes = ''edited'' where id = %L', v_done));
  if r <> 'ok 1' then raise exception 'SABOTAGE (finished-row immutability) did not flip, got %', r; end if;
  r := pg_temp.as_owner('delete from public.restore_drills where id = ' || quote_literal(v_bad));
  if r <> 'ok 1' then raise exception 'SABOTAGE (no delete) did not flip, got %', r; end if;
  -- (ii) insert policy opened to anyone: the clinician insert now succeeds
  drop policy restore_drills_admin_insert on public.restore_drills;
  create policy restore_drills_admin_insert on public.restore_drills for insert to authenticated with check (true);
  r := pg_temp.as_user(v_doc, ins);
  if r <> 'ok 1' then raise exception 'SABOTAGE (admin-only insert) did not flip, got %', r; end if;
  -- (iii) status redefined to ignore voids: the voided drill is named again
  create or replace function public.restore_drill_status() returns table (
    last_good_id uuid, last_good_kind text, last_good_finished_at timestamptz, age_days numeric,
    duration_minutes numeric, rto_target_minutes integer, met_rto boolean, achieved_rpo_minutes integer, rpo_target_minutes integer,
    open_drills bigint, voided_drills bigint)
  language sql security definer set search_path = '' as $f$
    select d.id, d.drill_kind, d.finished_at, 0::numeric, d.duration_minutes, d.rto_target_minutes, true, d.achieved_rpo_minutes, d.rpo_target_minutes, 0::bigint, 0::bigint
      from public.restore_drills d where d.passed order by d.finished_at desc limit 1 $f$;
  select * into s from public.restore_drill_status();
  if s.last_good_id is distinct from v_done then raise exception 'SABOTAGE (status ignores voids) did not flip, got %', s.last_good_id; end if;
end $$;

rollback;
