-- Proof: pharmacy-counter adherence snapshot (migration *_pharmacy_counter_adherence_snapshot.sql).
-- One rolled-back transaction. Proves: the feature is closed for a real patient while its guard is off (a test account may try it); a snapshot is
-- one record share limited to the 'medications' section with a PIN and a one-session window; the stored figures must have exactly the known shape
-- (no extra key to hide a name in) and sane arithmetic; expiry is 1 to 24 hours; at most 5 live at once; the public door answers only for a
-- token that has a snapshot (an ordinary share is NOT served through it), only with the right PIN, returns the frozen figures and the medicines
-- section and no other section, locks after repeated wrong PINs through the share machinery, stops after revoke and when the guard is off;
-- another patient cannot read the rows, a client cannot write the table, anon cannot create; the create is audited.
-- SABOTAGE: the guard check removed from the door (a closed feature opens), the snapshot-exists check removed (an ordinary share leaks through
-- the counter door), the shape check removed (an extra key is stored), the live cap removed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table store(k text primary key, v jsonb) on commit drop;
grant all on store to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'pcs-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'PCS ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = p_test, is_active = true;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

-- A good set of weekly figures, and a helper that makes a snapshot as a user and keeps the answer.
create function pg_temp.weeks(p_extra text default '') returns text language sql as
$$ select '[{"week_start":"2026-10-05","week_end":"2026-10-11","due":14,"marked_taken":10,"late":1,"skipped":2,"no_record":2,"could_not_get":0,"percent":71' || p_extra || '}]' $$;
create function pg_temp.make(p_user uuid, p_key text, p_weeks text, p_hours integer default 2) returns text language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.as_user(p_user, format($q$ select public.create_pharmacy_counter_snapshot(%L::jsonb, 7, %s)::text $q$, p_weeks, p_hours));
  if r not like 'ERR%' then insert into store values (p_key, r::jsonb) on conflict (k) do update set v = excluded.v; return 'ok'; end if;
  return r;
end $f$;
create function pg_temp.tok(p_key text) returns text language sql as $$ select v ->> 'token' from store where k = p_key $$;
create function pg_temp.pin(p_key text) returns text language sql as $$ select v ->> 'pin' from store where k = p_key $$;
-- p_client differs per attempt where a test makes many: the share door slows ONE client after 3 wrong PINs ('try_later'), which is not the lockout under test.
create function pg_temp.door(p_key text, p_pin text, p_client text default 'proof-client') returns text language sql as
$$ select pg_temp.as_anon(format($q$ select public.pharmacy_snapshot_by_token(%L, %L, %L)::text $q$, pg_temp.tok(p_key), p_pin, p_client)) $$;

do $$
declare v_org uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p1 := pg_temp.mkuser(v_org, 'test patient', 'patient', true);
  v_p2 := pg_temp.mkuser(v_org, 'other patient', 'patient', true);
  v_p3 := pg_temp.mkuser(v_org, 'real patient', 'patient', false);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('p1', v_p1); perform pg_temp.setf('p2', v_p2); perform pg_temp.setf('p3', v_p3);
  insert into public.medications (patient_id, organisation_id, drug_name, dose, frequency, is_active)
  values (v_p1, v_org, 'ProofMed', '5 mg', 'daily', true);
end $$;

-- A. closed while the guard is off -------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A0 the guard exists and is born off', 'false',
  (select is_on::text from public.go_live_guards where key = 'pharmacy_counter_snapshot'));
select pg_temp.ck('real', 'A1 a real (non-test) patient is refused while the guard is off', 'ERR 55000', pg_temp.make(pg_temp.f('p3'), 'real', pg_temp.weeks()));
select pg_temp.ck('real', 'A2 a test account can try it', 'ok', pg_temp.make(pg_temp.f('p1'), 's1', pg_temp.weeks()));
select pg_temp.ck('real', 'A3 anon cannot create one', 'ERR 42501',
  pg_temp.as_anon(format($q$ select public.create_pharmacy_counter_snapshot(%L::jsonb, 7, 2)::text $q$, pg_temp.weeks())));

-- B. what a snapshot is -------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'B1 the share holds the medications section and nothing else', '{medications}',
  (select r.sections::text from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id where s.profile_id = pg_temp.f('p1') limit 1));
select pg_temp.ck('real', 'B2 it has a PIN and a one-session window', 'true/true',
  (select (r.pin_hash is not null)::text || '/' || r.one_session::text from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id where s.profile_id = pg_temp.f('p1') limit 1));
select pg_temp.ck('real', 'B3 the default life is two hours', 'true',
  (select (r.expires_at > now() + interval '119 minutes' and r.expires_at < now() + interval '121 minutes')::text from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id where s.profile_id = pg_temp.f('p1') limit 1));
select pg_temp.ck('real', 'B4 the PIN is returned once, six digits', 'true', (pg_temp.pin('s1') ~ '^[0-9]{6}$')::text);
select pg_temp.ck('real', 'B5 more than 24 hours is refused', 'ERR 22023', pg_temp.make(pg_temp.f('p1'), 'x', pg_temp.weeks(), 25));
select pg_temp.ck('real', 'B6 zero hours is refused', 'ERR 22023', pg_temp.make(pg_temp.f('p1'), 'x', pg_temp.weeks(), 0));
select pg_temp.ck('real', 'B7 an extra key in the figures (a place to hide a name) is refused', 'ERR 22023', pg_temp.make(pg_temp.f('p1'), 'x', pg_temp.weeks(',"drug_name":"ProofMed"')));
select pg_temp.ck('real', 'B8 more late doses than doses marked taken is refused', 'ERR 22023',
  pg_temp.make(pg_temp.f('p1'), 'x', replace(pg_temp.weeks(), '"late":1', '"late":11')));
select pg_temp.ck('real', 'B9 a percent above 100 is refused', 'ERR 22023', pg_temp.make(pg_temp.f('p1'), 'x', replace(pg_temp.weeks(), '"percent":71', '"percent":101')));
select pg_temp.ck('real', 'B10 an empty list is refused', 'ERR 22023', pg_temp.make(pg_temp.f('p1'), 'x', '[]'));
select pg_temp.ck('real', 'B11 the shape check refuses a bad figure set', 'false',
  (select private.pharmacy_snapshot_weeks_ok('[{"a":1}]'::jsonb)::text));
select pg_temp.ck('real', 'B12 the create is audited', '1',
  (select count(*)::text from public.audit_log where action = 'pharmacy_counter_snapshot_created' and actor_id = pg_temp.f('p1')));

-- C. the public door ----------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'C1 an unknown token gets the dead-link answer', 'null',
  coalesce(pg_temp.as_anon(format($q$ select public.pharmacy_snapshot_by_token(%L, null, 'c')::text $q$, repeat('a', 64))), 'null'));
select pg_temp.ck('real', 'C2 without a PIN it asks for one', 'pin_required', (pg_temp.door('s1', null)::jsonb) ->> 'status');
select pg_temp.ck('real', 'C3 a wrong PIN asks again and counts', 'pin_required', (pg_temp.door('s1', '000000')::jsonb) ->> 'status');
select pg_temp.ck('real', 'C4 the right PIN opens it', 'ok', (pg_temp.door('s1', pg_temp.pin('s1'))::jsonb) ->> 'status');
select pg_temp.ck('real', 'C5 it is a counter view carrying the frozen figures', 'pharmacy_counter/1/10',
  (select (d ->> 'kind') || '/' || jsonb_array_length(d -> 'adherence' -> 'weeks') || '/' || (d -> 'adherence' -> 'weeks' -> 0 ->> 'marked_taken')
     from (select pg_temp.door('s1', pg_temp.pin('s1'))::jsonb d) x));
select pg_temp.ck('real', 'C6 it carries the medicines section and no other record section', 'true/false/false/false',
  (select (d ? 'medications')::text || '/' || (d ? 'vitals')::text || '/' || (d ? 'lab_results')::text || '/' || (d ? 'allergies')::text
     from (select pg_temp.door('s1', pg_temp.pin('s1'))::jsonb d) x));
select pg_temp.ck('real', 'C7 the frozen figures name no medicine', 'true',
  (select (not ((d -> 'adherence')::text ilike '%proofmed%'))::text from (select pg_temp.door('s1', pg_temp.pin('s1'))::jsonb d) x));
select pg_temp.ck('real', 'C8 openings are counted by the share machinery', 'true',
  (select (r.view_count >= 1)::text from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id where s.profile_id = pg_temp.f('p1') order by s.created_at limit 1));
-- an ORDINARY share must not be served through the counter door
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('p1'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', pg_temp.f('p1')::text, true);
  set local role authenticated;
  v := public.create_record_share(array['medications'], 2, false, false);
  reset role;
  insert into store values ('plain', v);
end $$;
select pg_temp.ck('real', 'C9 an ordinary share link is not served through the counter door', 'null', coalesce(pg_temp.door('plain', null), 'null'));
-- lockout through the share machinery, revoke, guard, caps
do $$
declare v_id uuid; v_answer text; v_i integer;
begin
  -- D. five wrong PINs lock it (the share door's own rule); even the right PIN is then dead
  perform pg_temp.make(pg_temp.f('p1'), 's2', pg_temp.weeks());
  for v_i in 1..5 loop perform pg_temp.door('s2', '111111', 'client-' || v_i); end loop;
  v_answer := pg_temp.door('s2', pg_temp.pin('s2'), 'client-final');
  perform pg_temp.ck('real', 'D1 five wrong PINs lock the counter view; the right PIN no longer opens it', 'null', coalesce(v_answer, 'null'));

  -- E. revoke stops it
  perform pg_temp.make(pg_temp.f('p1'), 's3', pg_temp.weeks());
  perform pg_temp.ck('real', 'E0 before the revoke it opens', 'ok', (pg_temp.door('s3', pg_temp.pin('s3'))::jsonb) ->> 'status');
  v_id := (select (v ->> 'id')::uuid from store where k = 's3');
  perform pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.revoke_record_share(%L)::text $q$, v_id));
  perform pg_temp.ck('real', 'E1 revoking the share stops the counter view', 'null', coalesce(pg_temp.door('s3', pg_temp.pin('s3')), 'null'));

  -- F. the guard: a real patient's link made while the patient was a test account stops when the guard is off for them
  perform pg_temp.make(pg_temp.f('p1'), 's4', pg_temp.weeks());
  update public.profiles set is_test = false where id = pg_temp.f('p1');
  perform pg_temp.ck('real', 'F1 once the patient is not a test account and the guard is off, the door answers nothing', 'null', coalesce(pg_temp.door('s4', pg_temp.pin('s4')), 'null'));
  update public.profiles set is_test = true where id = pg_temp.f('p1');
  perform pg_temp.ck('real', 'F2 ...and answers again for a test account (so F1 was the guard, not a broken link)', 'ok', (pg_temp.door('s4', pg_temp.pin('s4'))::jsonb) ->> 'status');
end $$;

-- G. the live cap: s1, s2 (locked but live), s3 (revoked), s4 so far; fill to five live
do $$
declare v_live integer; v_i integer; v_answer text;
begin
  select count(*) into v_live from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id
   where s.profile_id = pg_temp.f('p1') and r.is_active and r.expires_at > now();
  for v_i in 1..(5 - v_live) loop perform pg_temp.make(pg_temp.f('p1'), 'fill' || v_i, pg_temp.weeks()); end loop;
  perform pg_temp.ck('real', 'G1 five live counter views exist', '5',
    (select count(*)::text from public.pharmacy_counter_snapshots s join public.record_shares r on r.id = s.share_id
      where s.profile_id = pg_temp.f('p1') and r.is_active and r.expires_at > now()));
  v_answer := pg_temp.make(pg_temp.f('p1'), 'sixth', pg_temp.weeks());
  perform pg_temp.ck('real', 'G2 a sixth live one is refused', 'ERR 53400', v_answer);
end $$;

-- H. who can read or write the table
select pg_temp.ck('real', 'H1 another patient reads none of these rows', '0',
  pg_temp.as_user(pg_temp.f('p2'), 'select count(*)::text from public.pharmacy_counter_snapshots'));
select pg_temp.ck('real', 'H2 the owner reads their own', 'true',
  pg_temp.as_user(pg_temp.f('p1'), 'select (count(*) >= 5)::text from public.pharmacy_counter_snapshots'));
select pg_temp.ck('real', 'H3 a client cannot insert a snapshot row directly', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ with i as (insert into public.pharmacy_counter_snapshots (share_id, profile_id, organisation_id, weeks, min_doses) select id, %L, %L, %L::jsonb, 7 from public.record_shares limit 1 returning 1) select count(*)::text from i $q$, pg_temp.f('p1'), pg_temp.f('org'), pg_temp.weeks())));
select pg_temp.ck('real', 'H4 ...or update one', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p1'), $q$ with u as (update public.pharmacy_counter_snapshots set min_doses = 1 returning 1) select count(*)::text from u $q$));
select pg_temp.ck('real', 'H5 anon cannot read the table', 'ERR 42501', pg_temp.as_anon('select count(*)::text from public.pharmacy_counter_snapshots'));
select pg_temp.ck('real', 'H6 the table has no medicine-name column', '0',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_counter_snapshots' and column_name ~ 'drug|medicine|name'));

-- SABOTAGE -------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_orig text; v_answer text;
begin
  select pg_get_functiondef('public.pharmacy_snapshot_by_token(text, text, text)'::regprocedure) into v_orig;

  -- 1. the guard check removed from the door: a closed feature opens for a real patient
  update public.profiles set is_test = true where id = pg_temp.f('p3');
  perform pg_temp.make(pg_temp.f('p3'), 'sab1', pg_temp.weeks());
  update public.profiles set is_test = false where id = pg_temp.f('p3');
  v_def := replace(v_orig, 'if not private.go_live_open_patient(''pharmacy_counter_snapshot'', v_profile) then return null; end if;', '');
  if v_def = v_orig then raise exception 'sabotage 1 anchor missing'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'SABOTAGE 1: with the guard check gone a real patient''s counter view opens while the feature is off', 'null',
    coalesce((pg_temp.door('sab1', pg_temp.pin('sab1'))::jsonb) ->> 'status', 'null'));
  execute v_orig;

  -- 2. the snapshot-exists check removed: an ordinary share is served through the counter door
  v_def := replace(replace(v_orig, 'if not found then return null; end if;', ''),
                   'if not private.go_live_open_patient(''pharmacy_counter_snapshot'', v_profile) then return null; end if;', '');
  if v_def = v_orig then raise exception 'sabotage 2 anchor missing'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'SABOTAGE 2: with the snapshot check gone (and the guard that keys on its owner) an ordinary share leaks through the counter door', 'null',
    coalesce((pg_temp.door('plain', null)::jsonb) ->> 'status', 'null'));
  execute v_orig;

  -- 3. the shape check removed from create and from the table: an extra key is stored
  select pg_get_functiondef('public.create_pharmacy_counter_snapshot(jsonb, integer, integer)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if not private.pharmacy_snapshot_weeks_ok(p_weeks) then', 'if false then');
  execute v_def;
  alter table public.pharmacy_counter_snapshots drop constraint pharmacy_counter_snapshots_weeks_shape;
  insert into results values ('sabotaged', 'SABOTAGE 3: with the shape checks gone an extra key (a hiding place for a name) is stored', 'ERR 22023',
    pg_temp.make(pg_temp.f('p2'), 'sab3', pg_temp.weeks(',"drug_name":"ProofMed"')));

  -- 4. the live cap removed: a sixth is accepted
  select pg_get_functiondef('public.create_pharmacy_counter_snapshot(jsonb, integer, integer)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if v_live >= 5 then', 'if false then');
  execute v_def;
  insert into results values ('sabotaged', 'SABOTAGE 4: with the cap gone a sixth live counter view is accepted', 'ERR 53400',
    pg_temp.make(pg_temp.f('p1'), 'sab4', pg_temp.weeks()));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'pharmacy counter proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
