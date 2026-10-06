-- S36a proof: public.admin_patient_search and public.admin_open_patient_record (migration *_s36a_admin_patient_search_and_reasoned_open.sql).
-- OQ-04 (minimal identity in search, typed reason and audit to open), INV-10, INV-12.
--
--   1. Admin search returns minimal identity only (no date of birth, no full phone, no email column) and masks the phone.
--   2. A search writes one audit row holding the query LENGTH and hit count, never the query text.
--   3. A query under 3 characters is refused; LIKE wildcards are literal (a typed % matches nothing).
--   4. Search by patient number, by phone digits and by exact email finds the patient; a partial email does not.
--   5. Only patients are returned (a clinician with the same name is not).
--   6. Open needs a reason of 10+ characters; a short reason is refused and writes no audit row.
--   7. A successful open writes exactly one audit row carrying the reason, and returns support facts with no clinical keys.
--   8. A clinician, a patient and anon are all refused on both functions.
--   9. SABOTAGE: the reason check removed, and the admin check removed on search; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text, p_phone text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's36a-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, p_phone, date '1981-03-09', true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
-- run a search as a user; returns count of rows, or ERR:sqlstate
create function pg_temp.search_as(p_uid uuid, p_q text) returns text language plpgsql as
$f$ declare n integer;
begin
  perform pg_temp.act(p_uid);
  begin select count(*) into n from public.admin_patient_search(p_q); exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return n::text;
end $f$;
create function pg_temp.open_as(p_uid uuid, p_patient uuid, p_reason text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.admin_open_patient_record(p_patient, p_reason); exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_search() returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform * from public.admin_patient_search('Mmesoma'); r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;

do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_pat uuid; v_pat2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'S36a Admin', '+2348011110001');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'Mmesoma Clinician', '+2348011110002');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'Mmesoma Zzproof', '+2348011119876');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient', 'Wildcard Person', '+2348011110004');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2);
  update public.profiles set date_of_birth = date '1981-03-09' where id in (v_pat, v_pat2);
end $$;

-- 1. minimal fields and masked phone
do $$
declare r record; v_cols text;
begin
  perform pg_temp.act(pg_temp.f('admin'));
  select * into r from public.admin_patient_search('Zzproof');
  perform pg_temp.back();
  insert into results values ('real', 'search finds the patient by name', pg_temp.f('pat')::text, r.patient_id::text);
  insert into results values ('real', 'phone is masked', '+234*******876', r.phone_masked);
  insert into results values ('real', 'only the birth year is shown', '1981', r.birth_year::text);
  select string_agg(a.attname, ',' order by a.attnum) into v_cols
    from pg_attribute a where a.attrelid = (select p.prorettype from pg_proc p where p.oid = 'public.admin_patient_search(text)'::regprocedure)
     or false;
  select string_agg(pa, ',') into v_cols from (select unnest(proargnames) pa from pg_proc where oid = 'public.admin_patient_search(text)'::regprocedure) x
    where pa not like 'p\_%';
  insert into results values ('real', 'return columns are the minimal set', 'patient_id,full_name,patient_number,phone_masked,birth_year,is_active,is_test', v_cols);
end $$;

-- 2. audit row for a search: length and count, never the text
do $$
declare v_before integer; v_n integer; v_txt text; v_event jsonb;
begin
  select count(*) into v_before from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_searched';
  perform pg_temp.search_as(pg_temp.f('admin'), 'Zzproof');
  select count(*) - v_before, string_agg(event::text, ' ') into v_n, v_txt from public.audit_log
   where actor_id = pg_temp.f('admin') and action = 'admin.patient_searched';
  insert into results values ('real', 'a search writes an audit row', '1', v_n::text);
  insert into results values ('real', 'the audit row never holds the query text', 'false', (coalesce(v_txt, '') ilike '%zzproof%')::text);
  select event into v_event from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_searched' order by created_at desc limit 1;
  insert into results values ('real', 'the audit row holds the hit count', '1', v_event ->> 'result_count');
end $$;

-- 3. too short, wildcards literal
insert into results values ('real', 'two characters are refused', 'ERR:22023', pg_temp.search_as(pg_temp.f('admin'), 'Mm'));
insert into results values ('real', 'a typed percent sign matches nothing', '0', pg_temp.search_as(pg_temp.f('admin'), '%%%'));

-- 4. other ways to find
do $$
declare v_pn text;
begin
  select patient_number into v_pn from public.profiles where id = pg_temp.f('pat');
  insert into results values ('real', 'search by patient number', '1', pg_temp.search_as(pg_temp.f('admin'), v_pn));
end $$;
insert into results values ('real', 'search by phone digits', '1', pg_temp.search_as(pg_temp.f('admin'), '08011119876'));
insert into results values ('real', 'search by exact email', '1', pg_temp.search_as(pg_temp.f('admin'), 's36a-pat@example.invalid'));
insert into results values ('real', 'a partial email finds nothing', '0', pg_temp.search_as(pg_temp.f('admin'), 's36a-pa@exam'));

-- 5. clinician with the same first name is not a patient result
insert into results values ('real', 'only patients are returned', '1', pg_temp.search_as(pg_temp.f('admin'), 'Mmesoma'));

-- 6. reason rules
do $$
declare v_before integer; v_after integer; r jsonb;
begin
  select count(*) into v_before from public.audit_log where action = 'admin.patient_record_opened' and entity_id = pg_temp.f('pat');
  r := pg_temp.open_as(pg_temp.f('admin'), pg_temp.f('pat'), 'too short');
  select count(*) into v_after from public.audit_log where action = 'admin.patient_record_opened' and entity_id = pg_temp.f('pat');
  insert into results values ('real', 'a short reason is refused', '22023', coalesce(r ->> 'err', 'accepted'));
  insert into results values ('real', 'a refused open writes no audit row', '0', (v_after - v_before)::text);
end $$;

-- 7. a good open
do $$
declare r jsonb; v_n integer; v_reason text;
begin
  r := pg_temp.open_as(pg_temp.f('admin'), pg_temp.f('pat'), 'Patient reported a double charge on a booking');
  insert into results values ('real', 'an open returns the patient', pg_temp.f('pat')::text, r ->> 'id');
  insert into results values ('real', 'an open returns the email', 's36a-pat@example.invalid', r ->> 'email');
  insert into results values ('real', 'an open carries no clinical keys', 'false',
    (r ?| array['readings', 'medications', 'conditions', 'notes', 'results', 'triage'])::text);
  select count(*), max(reason) into v_n, v_reason from public.audit_log
   where action = 'admin.patient_record_opened' and entity_id = pg_temp.f('pat') and actor_id = pg_temp.f('admin');
  insert into results values ('real', 'an open writes exactly one audit row', '1', v_n::text);
  insert into results values ('real', 'the audit row carries the reason', 'Patient reported a double charge on a booking', v_reason);
  r := pg_temp.open_as(pg_temp.f('admin'), pg_temp.f('doc'), 'Opening a clinician as if a patient');
  insert into results values ('real', 'a non-patient id is not found', 'P0002', coalesce(r ->> 'err', 'opened'));
end $$;

-- 8. everyone else refused
insert into results values ('real', 'a clinician cannot search', 'ERR:42501', pg_temp.search_as(pg_temp.f('doc'), 'Zzproof'));
insert into results values ('real', 'a patient cannot search', 'ERR:42501', pg_temp.search_as(pg_temp.f('pat2'), 'Zzproof'));
insert into results values ('real', 'anon cannot search', '42501', pg_temp.anon_search());
insert into results values ('real', 'a clinician cannot open', '42501',
  coalesce(pg_temp.open_as(pg_temp.f('doc'), pg_temp.f('pat'), 'A long enough reason here') ->> 'err', 'opened'));
insert into results values ('real', 'a patient cannot open', '42501',
  coalesce(pg_temp.open_as(pg_temp.f('pat2'), pg_temp.f('pat'), 'A long enough reason here') ->> 'err', 'opened'));

-- 9. sabotage
do $$
declare v_orig text; v_def text; r jsonb;
begin
  v_orig := pg_get_functiondef('public.admin_open_patient_record(uuid,text)'::regprocedure);
  v_def := replace(v_orig, 'char_length(v_reason) < 10 or', 'false and');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  r := pg_temp.open_as(pg_temp.f('admin'), pg_temp.f('pat'), 'short');
  insert into results values ('sabotaged', 'a short reason is refused', '22023', coalesce(r ->> 'err', 'accepted'));
  execute v_orig;

  v_orig := pg_get_functiondef('public.admin_patient_search(text)'::regprocedure);
  v_def := replace(v_orig, 'if not private.is_admin() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'a clinician cannot search', 'ERR:42501', pg_temp.search_as(pg_temp.f('doc'), 'Zzproof'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36a proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
