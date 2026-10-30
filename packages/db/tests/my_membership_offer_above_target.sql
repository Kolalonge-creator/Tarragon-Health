-- Journey 1 proof (migration *_my_membership_offer_above_target.sql): a Free patient whose 7-day blood pressure average is above target is offered
-- Membership; nobody else is. One rolled-back transaction. Proves:
--  * a Free test patient with readings well above target gets status 'offer' for membership_annual with their own average;
--  * a Free test patient within target, and one with too few readings, get 'not_eligible' (within_target, too_few_readings);
--  * a current Member above target gets 'not_eligible' (already_member): no sales offer to someone who already has a doctor task;
--  * a real (non-test) patient gets 'not_open_yet' while the checkout_enabled guard is off, whatever their readings;
--  * a pregnant patient and a child dependent above target get 'not_eligible' (clinician_led);
--  * a patient sees only their own readings (a second patient's high readings do not change the first patient's answer); anon cannot call it.
-- SABOTAGE: (1) the member check removed; (2) the guard check removed. Both must flip (asserted inside a DO block, not printed).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.mkuser(p_org uuid, p_label text, p_test boolean) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'offer-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, (select id from public.organisations order by created_at limit 1), 'patient', 'Offer ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set is_test = excluded.is_test, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.readings(p_pat uuid, p_n int, p_sys int, p_dia int) returns void language plpgsql as
$f$ declare i int; v_org uuid := (select organisation_id from public.profiles where id = p_pat);
begin
  for i in 1..p_n loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
    values (v_org, p_pat, 'blood_pressure', p_sys, p_dia, now() - make_interval(hours => i * 6), 'device', 'seated', 'left');
  end loop;
end $f$;
create function pg_temp.offer_as(p_uid uuid) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin select public.my_membership_offer()::text into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.field(p_json text, p_key text) returns text language sql as $f$ select (p_json::jsonb) ->> p_key $f$;

do $$
declare
  v_hi uuid; v_ok uuid; v_few uuid; v_member uuid; v_real uuid; v_other uuid; v_preg uuid; v_dep uuid; v_anon text; v_def text; v_caught integer := 0; v_out text;
begin
  v_hi := pg_temp.mkuser(null, 'hi', true);       perform pg_temp.readings(v_hi, 6, 160, 100);
  v_ok := pg_temp.mkuser(null, 'ok', true);       perform pg_temp.readings(v_ok, 6, 120, 78);
  v_few := pg_temp.mkuser(null, 'few', true);     perform pg_temp.readings(v_few, 1, 170, 105);
  v_member := pg_temp.mkuser(null, 'member', true); perform pg_temp.readings(v_member, 6, 160, 100);
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test)
  select organisation_id, v_member, 'purchase', now() - interval '10 days', true from public.profiles where id = v_member;
  v_real := pg_temp.mkuser(null, 'real', false);  perform pg_temp.readings(v_real, 6, 160, 100);
  v_other := pg_temp.mkuser(null, 'other', true); perform pg_temp.readings(v_other, 6, 120, 78);
  v_preg := pg_temp.mkuser(null, 'preg', true);   perform pg_temp.readings(v_preg, 6, 160, 100);
  update public.profiles set is_pregnant = true where id = v_preg;
  v_dep := pg_temp.mkuser(null, 'dep', true);     perform pg_temp.readings(v_dep, 6, 160, 100);
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child', date_of_birth = (private.lagos_today() - 3650) where id = v_dep;

  insert into results values ('real', 'Free test patient above target: offer', 'offer', pg_temp.field(pg_temp.offer_as(v_hi), 'status'));
  insert into results values ('real', '...for membership_annual', 'membership_annual', pg_temp.field(pg_temp.offer_as(v_hi), 'catalog_item'));
  insert into results values ('real', '...with their own average (160/100)', '160/100', pg_temp.field(pg_temp.offer_as(v_hi), 'avg_systolic') || '/' || pg_temp.field(pg_temp.offer_as(v_hi), 'avg_diastolic'));
  insert into results values ('real', 'within target: not eligible', 'not_eligible/within_target', pg_temp.field(pg_temp.offer_as(v_ok), 'status') || '/' || pg_temp.field(pg_temp.offer_as(v_ok), 'reason'));
  insert into results values ('real', 'one reading only: not eligible', 'not_eligible/too_few_readings', pg_temp.field(pg_temp.offer_as(v_few), 'status') || '/' || pg_temp.field(pg_temp.offer_as(v_few), 'reason'));
  insert into results values ('real', 'current Member above target: no sales offer', 'not_eligible/already_member', pg_temp.field(pg_temp.offer_as(v_member), 'status') || '/' || pg_temp.field(pg_temp.offer_as(v_member), 'reason'));
  insert into results values ('real', 'pregnant patient above target: clinician led, no offer', 'not_eligible/clinician_led', pg_temp.field(pg_temp.offer_as(v_preg), 'status') || '/' || pg_temp.field(pg_temp.offer_as(v_preg), 'reason'));
  insert into results values ('real', 'a child dependent above target: clinician led, no offer', 'not_eligible/clinician_led', pg_temp.field(pg_temp.offer_as(v_dep), 'status') || '/' || pg_temp.field(pg_temp.offer_as(v_dep), 'reason'));
  insert into results values ('real', 'real patient while checkout_enabled is off: not open yet', 'not_open_yet', pg_temp.field(pg_temp.offer_as(v_real), 'status'));
  insert into results values ('real', 'another patient''s readings do not change the answer', 'offer', pg_temp.field(pg_temp.offer_as(v_hi), 'status'));
  insert into results values ('real', 'guard is off in this database', 'false', (select is_on::text from public.go_live_guards where key = 'checkout_enabled'));
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin perform public.my_membership_offer(); v_anon := 'callable'; exception when others then v_anon := 'ERR ' || sqlstate; end;
    reset role;
  end;
  insert into results values ('real', 'anon cannot call it', 'ERR 42501', v_anon);

  -- SABOTAGE 1: the member check removed; the Member must now get an offer
  select pg_get_functiondef('public.my_membership_offer()'::regprocedure) into v_def;
  execute replace(v_def, 'if private.risk_is_current_member(v_me, now()) then', 'if false then');
  v_out := pg_temp.field(pg_temp.offer_as(v_member), 'status');
  if v_out <> 'offer' then raise exception 'VACUOUS TEST: sabotage 1 did not flip (got %)', pg_temp.offer_as(v_member); end if;
  v_caught := v_caught + 1;
  -- SABOTAGE 2: the guard check removed; the real patient must now get an offer
  execute replace(replace(v_def, 'if private.risk_is_current_member(v_me, now()) then', 'if false then'), 'if not private.go_live_open_patient(''checkout_enabled'', v_me) then', 'if false then');
  v_out := pg_temp.field(pg_temp.offer_as(v_real), 'status');
  if v_out <> 'offer' then raise exception 'VACUOUS TEST: sabotage 2 did not flip (got %)', v_out; end if;
  v_caught := v_caught + 1;
  if v_caught < 2 then raise exception 'VACUOUS TEST: % of 2 sabotages flipped', v_caught; end if;
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'my_membership_offer proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
