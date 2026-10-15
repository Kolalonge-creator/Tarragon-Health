-- OQ-276 follow-up proof (CMO answers 2026-10-12): the read-only QR views flag a controlled medicine, and the patient can ask whether a prescription holds one.
-- Migration *_oq276b_qr_views_flag_controlled_and_patient_note.sql. Proves in one rolled-back transaction, calling every function it changes:
--   * verify_prescription_public (anonymous QR page): a controlled medicine answers status controlled_medicine with supply_available false; an ordinary one is still
--     active with a supply available; anon keeps its grant;
--   * desk_verify_prescription (phone desk, admin session): the same two answers, and the lookup is still audited;
--   * patient_prescription_has_controlled_item: true for the owner when the medicine row is controlled, or only a signed item (real key drug_name) is; false for an
--     ordinary one; false for another patient (it reveals nothing about someone else's prescription); anon refused.
-- SABOTAGE: the controlled branch removed from the public view, and the patient function forced to false; both must flip or the test is vacuous.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table txt(k text primary key, v text) on commit drop;
grant all on txt to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.sett(p text, p_v text) returns void language sql as $$ insert into txt values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.t(p text) returns text language sql as $$ select v from txt where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run one statement as a user; returns its single text result, or ERR:sqlstate. A failed statement still leaves the transaction usable.
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_q(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'oq276b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- a signed prescription (as the owner, no session) with its clinician medicine row
create function pg_temp.mkrx(p_org uuid, p_pat uuid, p_doc uuid, p_drug text, p_state text, p_rep integer default 0) returns uuid language plpgsql as
$f$ declare v_rx uuid;
begin
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug', p_drug, 'dose', '5 mg', 'quantity', '30 tablets')), p_state::public.prescription_state,
          case when p_state = 'draft' then null else p_doc end, case when p_state = 'draft' then null else now() end, true) returning id into v_rx;
  if p_state <> 'draft' then
    insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
    values (p_org, p_pat, p_drug, '5 mg', '30 tablets', p_rep, 'clinician', true, v_rx);
  end if;
  return v_rx;
end $f$;
create function pg_temp.med_of(p_rx uuid) returns uuid language sql as $$ select id from public.medications where prescription_id = p_rx $$;
create function pg_temp.rxstate(p_rx uuid) returns text language sql as $$ select state::text from public.prescriptions where id = p_rx $$;
-- the first column of a pharmacist function that returns rows
create function pg_temp.verify_as(p_uid uuid, p_rx uuid, p_code text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select outcome from public.pharmacist_verify_collection(%L, %L)$q$, p_rx, p_code)) $$;
create function pg_temp.disp_as(p_uid uuid, p_rx uuid, p_code text, p_partial boolean, p_note text, p_reg text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select outcome from public.pharmacist_dispense_prescription(%L, %L, '30 tablets', %L, %L, 'B-1234', %L, %L, 'Ada Pharmacist')$q$,
     p_rx, p_code, p_partial, p_note, (current_date + 400)::text, p_reg)) $$;

-- S28c: the whole feature sits behind the S37 prescribing guard (closed by default). This proof opens it the way the guard's own trigger allows,
-- a log row in this transaction and then the update; the closed state is proved in s28c_pharmacy_extras.sql.
create function pg_temp.guard(p_on boolean) returns void language plpgsql as $f$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  select 'prescribing_enabled', case when p_on then 'switched_on' else 'switched_off' end, p.id, 'admin', 'S28 proof', '[]'::jsonb from public.profiles p order by p.created_at limit 1;
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then (select id from public.profiles order by created_at limit 1) end, change_note = case when p_on then 'S28 proof' end
   where key = 'prescribing_enabled';
end $f$;



do $$
declare v_org uuid; v_doc uuid; v_pat uuid; v_rx uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'OQ276b Prescriber');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'OQ276b Patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient', 'OQ276b Other Patient'));
  perform pg_temp.setf('adm', pg_temp.mkuser(v_org, 'adm', 'admin', 'OQ276b Admin'));
  perform pg_temp.setf('rxCtl', pg_temp.mkrx(v_org, v_pat, v_doc, 'Tramadol 50mg', 'signed'));
  perform pg_temp.setf('rxOk', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug Ordinary', 'signed'));
  -- controlled only in a signed item, under the real key drug_name; the medicine row is ordinary
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (v_org, v_pat, '[{"drug_name":"Morphine sulfate","dose":"10 mg"}]', 'signed', v_doc, now(), true) returning id into v_rx;
  perform pg_temp.setf('rxItem', v_rx);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
  values (v_org, v_pat, 'Proofdrug Cover', '5 mg', '30 tablets', 0, 'clinician', true, v_rx);
end $$;

create function pg_temp.tok(p_rx uuid) returns text language sql as $$ select public_token from public.medications where id = pg_temp.med_of(p_rx) $$;
create function pg_temp.pub(p_rx uuid, p_col text) returns text language sql as
$$ select pg_temp.anon_q(format($q$select %s::text from public.verify_prescription_public(%L)$q$, p_col, pg_temp.tok(p_rx))) $$;
create function pg_temp.desk(p_rx uuid, p_col text) returns text language sql as
$$ select pg_temp.q_as(pg_temp.f('adm'), format($q$select %s::text from public.desk_verify_prescription(%L, %L)$q$, p_col,
     (select rx_number from public.medications where id = pg_temp.med_of(p_rx)), (select verification_code from public.medications where id = pg_temp.med_of(p_rx)))) $$;
create function pg_temp.has_ctl(p_uid uuid, p_rx uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.patient_prescription_has_controlled_item(%L)::text$q$, p_rx)) $$;

-- A. anonymous QR page
select pg_temp.ck('real', 'A1 public view, controlled medicine: status controlled_medicine and no supply available', 'controlled_medicine|false',
  pg_temp.pub(pg_temp.f('rxCtl'), 'status') || '|' || pg_temp.pub(pg_temp.f('rxCtl'), 'supply_available'));
select pg_temp.ck('real', 'A2 public view, ordinary medicine: still active with a supply available', 'active|true',
  pg_temp.pub(pg_temp.f('rxOk'), 'status') || '|' || pg_temp.pub(pg_temp.f('rxOk'), 'supply_available'));
select pg_temp.ck('real', 'A3 anon keeps its grant on the public view', 'true', has_function_privilege('anon', 'public.verify_prescription_public(text)', 'EXECUTE')::text);

-- B. phone desk
select pg_temp.ck('real', 'B1 desk view, controlled medicine: controlled_medicine, not suppliable', 'controlled_medicine|false',
  pg_temp.desk(pg_temp.f('rxCtl'), 'status') || '|' || pg_temp.desk(pg_temp.f('rxCtl'), 'supply_available'));
select pg_temp.ck('real', 'B2 desk view, ordinary medicine: active and suppliable', 'active|true',
  pg_temp.desk(pg_temp.f('rxOk'), 'status') || '|' || pg_temp.desk(pg_temp.f('rxOk'), 'supply_available'));
select pg_temp.ck('real', 'B3 the desk lookups were audited with the status', '2',
  (select count(*)::text from public.audit_log where action = 'prescription.desk_lookup' and event ->> 'status' = 'controlled_medicine'));

-- C. the patient's note
select pg_temp.ck('real', 'C1 the owner: a controlled medicine row is true', 'true', pg_temp.has_ctl(pg_temp.f('pat'), pg_temp.f('rxCtl')));
select pg_temp.ck('real', 'C2 the owner: a controlled drug_name only in a signed item is true', 'true', pg_temp.has_ctl(pg_temp.f('pat'), pg_temp.f('rxItem')));
select pg_temp.ck('real', 'C3 the owner: an ordinary prescription is false', 'false', pg_temp.has_ctl(pg_temp.f('pat'), pg_temp.f('rxOk')));
select pg_temp.ck('real', 'C4 another patient asking about it gets false, learning nothing', 'false', pg_temp.has_ctl(pg_temp.f('pat2'), pg_temp.f('rxCtl')));
select pg_temp.ck('real', 'C5 anon cannot call it', 'ERR:42501', pg_temp.anon_q(format($q$select public.patient_prescription_has_controlled_item(%L)::text$q$, pg_temp.f('rxCtl'))));

-- Sabotage -------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_out text;
begin
  -- (1) the controlled branch removed from the public view: a controlled medicine must now read as active
  select pg_get_functiondef('public.verify_prescription_public(text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'when private.is_controlled_medicine(v_med.drug_name) then', 'when false then');
  execute v_def;
  v_out := pg_temp.pub(pg_temp.f('rxCtl'), 'status');
  insert into results values ('sabotaged', 'SABOTAGE controlled branch removed: the public view still says controlled_medicine', 'controlled_medicine', v_out);
end $$;
do $$
declare v_def text; v_out text;
begin
  -- (2) the patient function made to always answer false: the owner must now NOT be told
  select pg_get_functiondef('public.patient_prescription_has_controlled_item(uuid,uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'and private.prescription_has_controlled_item(m.drug_name, rx.items)', 'and false');
  execute v_def;
  v_out := pg_temp.has_ctl(pg_temp.f('pat'), pg_temp.f('rxCtl'));
  insert into results values ('sabotaged', 'SABOTAGE forced false: the owner is still told about a controlled medicine', 'true', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-276b proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught, (select string_agg(check_name || '=' || coalesce(actual, 'null'), ' | ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
