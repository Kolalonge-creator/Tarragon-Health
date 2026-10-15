-- OQ-276 brand-name proof (CMO decision 2026-10-12): the ONE controlled list now names brands and combinations, so signing and every counter path catch them.
-- Migration *_oq276c_controlled_list_brand_names.sql. Proves in one rolled-back transaction: every added brand/combination (Tramal, Valium, Ativan, Xanax, Rivotril,
-- Lexotan, Ritalin, Adderall, Percocet, Phensedyl, Solpadeine, Panadeine, co-codamol with and without the hyphen, co-dydramol, bromazepam) is controlled in realistic
-- written forms; ordinary medicines and look-alike words (Panadol, Paracetamol, Ventolin, Ultrasound gel, Concertina, Valiumx) are not; signing hard-stops a brand
-- (private.prescription_safety_findings and check_prescription_safety); a brand held only in a signed item is seen; the anonymous QR page refuses to record a supply of a
-- brand and the read-only QR view says controlled_medicine. SABOTAGE: the list put back to generic names only; the brand checks must then flip, or the test is vacuous.
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
  values (v, 'oq276c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
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
declare v_org uuid; v_doc uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'OQ276c Prescriber');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'OQ276c Patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('rxBrand', pg_temp.mkrx(v_org, v_pat, v_doc, 'Valium 5mg', 'signed'));
  perform pg_temp.setf('rxOk', pg_temp.mkrx(v_org, v_pat, v_doc, 'Panadol Extra', 'signed'));
end $$;

create function pg_temp.names(p_names text[]) returns text language sql as
$$ select string_agg(private.is_controlled_medicine(n)::text, ',' order by ord) from unnest(p_names) with ordinality t(n, ord) $$;
create function pg_temp.qr(p_rx uuid) returns text language sql as
$$ select pg_temp.anon_q(format($q$select outcome from public.record_prescription_supply_public(%L, 'Other Pharmacy', 'Bola Counter', 'PCN99999', '30')$q$,
     (select public_token from public.medications where id = pg_temp.med_of(p_rx)))) $$;

select pg_temp.ck('real', 'A1 brands and combinations are controlled in realistic written forms', 'true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true',
  pg_temp.names(array['Tramal 50mg','Valium 5mg tablets','ATIVAN 1 mg','Xanax XR','Rivotril 0.5mg','Lexotan 3mg','Ritalin LA','Adderall','Percocet 5/325','Phensedyl syrup',
                      'Solpadeine Max','Panadeine Extra','co-codamol 30/500','cocodamol','Co-Dydramol','bromazepam']));
select pg_temp.ck('real', 'A2 ordinary medicines and look-alike words are not controlled', 'false,false,false,false,false,false,false',
  pg_temp.names(array['Amlodipine 5mg','Paracetamol 500mg','Panadol Extra','Ventolin','Ultrasound gel','Concertina','Valiumx']));
select pg_temp.ck('real', 'A3 the generic names are still controlled', 'true,true,true,true',
  pg_temp.names(array['Tramadol 50mg','Diazepam','codeine phosphate','Phenobarbitone 30mg']));

select pg_temp.ck('real', 'B1 signing: a brand is a blocking controlled finding', 'true',
  (private.prescription_safety_findings(pg_temp.f('pat'), 'Valium 5mg', null) @> '[{"code":"controlled_medicine","blocking":true}]'::jsonb)::text);
do $$ declare v text; begin
  begin perform private.check_prescription_safety(pg_temp.f('pat'), 'Xanax 0.5mg', null, true, 'override attempt'); v := 'no error';
  exception when others then get stacked diagnostics v = pg_exception_detail; end;
  perform pg_temp.ck('real', 'B2 signing: check_prescription_safety hard-stops a brand even with an override reason', 'SAFETY_BLOCKED', v);
end $$;
select pg_temp.ck('real', 'B3 a brand named only in a signed item is seen', 'true|false',
  private.prescription_has_controlled_item('Safe', '[{"drug_name":"Tramal 100mg"}]')::text || '|' || private.prescription_has_controlled_item('Safe', '[{"drug_name":"Panadol"}]')::text);

select pg_temp.ck('real', 'C1 the read-only QR view says controlled_medicine for a brand, active for an ordinary one', 'controlled_medicine|active',
  pg_temp.anon_q(format($q$select status from public.verify_prescription_public(%L)$q$, (select public_token from public.medications where id = pg_temp.med_of(pg_temp.f('rxBrand')))))
  || '|' || pg_temp.anon_q(format($q$select status from public.verify_prescription_public(%L)$q$, (select public_token from public.medications where id = pg_temp.med_of(pg_temp.f('rxOk'))))));
select pg_temp.ck('real', 'C2 the QR page refuses to record a supply of a brand, nothing is recorded', 'controlled_medicine|0', pg_temp.qr(pg_temp.f('rxBrand')) || '|' ||
  (select count(*) from public.pharmacy_order_dispenses where medication_id = pg_temp.med_of(pg_temp.f('rxBrand')))::text);
select pg_temp.ck('real', 'C3 control: an ordinary medicine is still recorded', 'recorded', pg_temp.qr(pg_temp.f('rxOk')));

-- Sabotage -------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_out text;
begin
  -- the list put back to generic names only: a brand must then pass, which is what the checks above would catch
  select pg_get_functiondef('private.is_controlled_medicine(text)'::regprocedure) into v_def;
  v_def := regexp_replace(v_def, '\|bromazepam\|.*\)\\M', ')\\M');
  execute v_def;
  v_out := pg_temp.names(array['Valium 5mg tablets', 'Tramal 50mg']);
  insert into results values ('sabotaged', 'SABOTAGE generic-only list: brands are still controlled', 'true,true', v_out);
  v_out := (private.prescription_safety_findings(pg_temp.f('pat'), 'Valium 5mg', null) @> '[{"code":"controlled_medicine"}]'::jsonb)::text;
  insert into results values ('sabotaged', 'SABOTAGE generic-only list: signing still blocks a brand', 'true', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-276c proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught, (select string_agg(check_name || '=' || coalesce(actual, 'null'), ' | ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
