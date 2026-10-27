-- W-40 proof: restore_drills is admin only, a finished drill is final, nothing is deletable, anon is shut out.
-- One rolled-back transaction; every check raises on failure. NOT executed when written (no Docker on the authoring machine).
-- SABOTAGE: the insert policy is replaced with one that admits anyone; the clinician insert must then succeed, proving the refusal check can fail.
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

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

-- run a statement as a user; returns 'ok' or 'ERR <sqlstate>'
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

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; r text;
  ins text := 'insert into public.restore_drills (drill_kind, environment, target_restore_point, started_at, rto_target_minutes, rpo_target_minutes) values (''pitr_restore'', ''branch'', now() - interval ''1 hour'', now(), 240, 15)';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');

  -- an admin can open a drill
  r := pg_temp.as_user(v_admin, ins);
  if r <> 'ok 1' then raise exception 'admin insert expected ok 1, got %', r; end if;
  -- a clinician, and anon, cannot
  r := pg_temp.as_user(v_doc, ins);
  if r = 'ok 1' then raise exception 'clinician must not insert a drill'; end if;
  r := pg_temp.as_anon(ins);
  if r = 'ok' then raise exception 'anon must not insert a drill'; end if;
  r := pg_temp.as_anon('select count(*) from public.restore_drills');
  if r = 'ok' then raise exception 'anon must not read drills'; end if;
  -- a clinician reads zero rows
  r := pg_temp.as_user(v_doc, 'select 1 from public.restore_drills');
  if r <> 'ok 0' then raise exception 'clinician must read zero drills, got %', r; end if;

  -- finishing sets result and duration; result without a finish time is refused by the table
  r := pg_temp.as_user(v_admin, 'update public.restore_drills set passed = true where finished_at is null');
  if r not like 'ERR %' then raise exception 'a result with no finish time must be refused, got %', r; end if;
  r := pg_temp.as_user(v_admin, 'update public.restore_drills set finished_at = started_at + interval ''90 minutes'', passed = true where finished_at is null');
  if r <> 'ok 1' then raise exception 'admin finishing a drill expected ok 1, got %', r; end if;
  if (select duration_minutes from public.restore_drills order by created_at desc limit 1) <> 90 then raise exception 'duration_minutes should be 90'; end if;

  -- a finished drill is final, and nothing can be deleted
  r := pg_temp.as_user(v_admin, 'update public.restore_drills set notes = ''edited'' where finished_at is not null');
  if r <> 'ok 0' then raise exception 'a finished drill must not be editable, got %', r; end if;
  r := pg_temp.as_user(v_admin, 'delete from public.restore_drills');
  if r not like 'ERR %' then raise exception 'delete must be refused, got %', r; end if;

  -- SABOTAGE: admit anyone to insert; the clinician insert must now succeed (the refusal check above can fail)
  drop policy restore_drills_admin_insert on public.restore_drills;
  create policy restore_drills_admin_insert on public.restore_drills for insert to authenticated with check (true);
  r := pg_temp.as_user(v_doc, ins);
  if r <> 'ok 1' then raise exception 'SABOTAGE did not flip the clinician refusal check, got %', r; end if;
end $$;

rollback;
