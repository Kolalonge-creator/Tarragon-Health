-- Proof: patient home layout (migration *_patient_home_layout.sql). One rolled-back transaction. Proves:
--  * a patient saves, reads and changes their own pinned list, including an empty one ("show nothing");
--  * a patient cannot write or read another patient's layout, and cannot delete a row;
--  * the database refuses an unknown key, a list of more than 12, and a null element;
--  * anon has no access, the table is in the data registry, and the minor-dependant guard has no gaps.
-- SABOTAGE: the select policy opened to everyone. The cross-patient read check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'phl-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'PHL ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          -- registration is adult-only (counsel-signed): a minor is created as an adult and then made a minor_child dependant, as the other proofs do
          case when p_dob is not null and p_dob > (current_date - interval '18 years')::date then (current_date - interval '45 years')::date
               else coalesce(p_dob, (current_date - interval '45 years')::date) end, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true,
    date_of_birth = excluded.date_of_birth;
  if p_dob is not null and p_dob > (current_date - interval '18 years')::date then
    update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child', date_of_birth = p_dob where id = v;
  end if;
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


-- fixtures ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then insert into public.organisations (name) values ('PHL proof org') returning id into v_org; end if;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('p1', pg_temp.mkuser(v_org, 'p1', 'patient'));
  perform pg_temp.setf('p2', pg_temp.mkuser(v_org, 'p2', 'patient'));
end $$;

-- 1 own layout -----------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('1', 'a patient saves their own pins', 'bp,sleep', pg_temp.as_user(pg_temp.f('p1'), format($$
  insert into public.patient_home_layout (patient_id, organisation_id, pinned) values (%L, %L, array['bp','sleep']) returning array_to_string(pinned, ',') $$,
  pg_temp.f('p1'), pg_temp.f('org'))));
select pg_temp.ck('1', 'and reads them back', 'bp,sleep', pg_temp.as_user(pg_temp.f('p1'), format($$
  select array_to_string(pinned, ',') from public.patient_home_layout where patient_id = %L $$, pg_temp.f('p1'))));
select pg_temp.ck('1', 'and changes the order', 'sleep,bp', pg_temp.as_user(pg_temp.f('p1'), format($$
  update public.patient_home_layout set pinned = array['sleep','bp'] where patient_id = %L returning array_to_string(pinned, ',') $$, pg_temp.f('p1'))));
select pg_temp.ck('1', 'an empty list is allowed: chose to show nothing', '0', pg_temp.as_user(pg_temp.f('p1'), format($$
  update public.patient_home_layout set pinned = '{}' where patient_id = %L returning cardinality(pinned)::text $$, pg_temp.f('p1'))));

-- 2 closed doors ---------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('2', 'a patient cannot write a layout for someone else', 'ERR 42501', pg_temp.as_user(pg_temp.f('p2'), format($$
  insert into public.patient_home_layout (patient_id, organisation_id, pinned) values (%L, %L, array['bp']) returning 'x' $$,
  pg_temp.f('p1'), pg_temp.f('org'))));
select pg_temp.ck('2', 'a patient cannot read someone else''s layout', '0', pg_temp.as_user(pg_temp.f('p2'), format($$
  select count(*)::text from public.patient_home_layout where patient_id = %L $$, pg_temp.f('p1'))));
select pg_temp.ck('2', 'a patient cannot change someone else''s layout', '0', pg_temp.as_user(pg_temp.f('p2'), format($$
  with u as (update public.patient_home_layout set pinned = array['labs'] where patient_id = %L returning 1) select count(*)::text from u $$, pg_temp.f('p1'))));
select pg_temp.ck('2', 'a patient cannot delete a row', 'ERR 42501', pg_temp.as_user(pg_temp.f('p1'), format($$
  delete from public.patient_home_layout where patient_id = %L returning 'x' $$, pg_temp.f('p1'))));
select pg_temp.ck('2', 'anon has no access', 'ERR 42501', pg_temp.as_anon($$ select count(*)::text from public.patient_home_layout $$));

-- 3 the database refuses bad lists ---------------------------------------------------------------------------------------------------
select pg_temp.ck('3', 'an unknown key is refused', 'ERR 23514', pg_temp.as_user(pg_temp.f('p1'), format($$
  update public.patient_home_layout set pinned = array['bp','nonsense'] where patient_id = %L returning 'x' $$, pg_temp.f('p1'))));
select pg_temp.ck('3', 'a null element is refused', 'ERR 23514', pg_temp.as_user(pg_temp.f('p1'), format($$
  update public.patient_home_layout set pinned = array['bp', null] where patient_id = %L returning 'x' $$, pg_temp.f('p1'))));
select pg_temp.ck('3', 'more than twelve is refused', 'ERR 23514', pg_temp.as_user(pg_temp.f('p1'), format($$
  update public.patient_home_layout set pinned = array['bp','glucose','weight','pulse','spo2','temperature','waist','peak_flow','active_meds','doses_today','sleep','meals','exercise'] where patient_id = %L returning 'x' $$, pg_temp.f('p1'))));
select pg_temp.ck('3', 'twelve is fine', '12', pg_temp.as_user(pg_temp.f('p1'), format($$
  update public.patient_home_layout set pinned = array['bp','glucose','weight','pulse','spo2','temperature','waist','peak_flow','active_meds','doses_today','sleep','meals'] where patient_id = %L returning cardinality(pinned)::text $$, pg_temp.f('p1'))));

-- 4 registrations --------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('4', 'no minor guard gaps', '0', (select count(*)::text from private.minor_guard_gaps()));
select pg_temp.ck('4', 'the table is in the data registry', '1', (select count(*)::text from public.data_registry where table_name = 'patient_home_layout'));
select pg_temp.ck('4', 'anon holds no privilege on it', 'false', has_table_privilege('anon', 'public.patient_home_layout', 'SELECT')::text);

-- SABOTAGE: with the select policy opened to everyone, a second patient CAN read the first one's row (so the check above can fail)
drop policy patient_home_layout_select on public.patient_home_layout;
create policy patient_home_layout_select on public.patient_home_layout for select to authenticated using (true);
select pg_temp.ck('sabotage', 'with the policy opened a stranger could read the layout', '0', pg_temp.as_user(pg_temp.f('p2'), format($$
  select count(*)::text from public.patient_home_layout where patient_id = %L $$, pg_temp.f('p1'))));

-- verdict ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(phase || ' / ' || check_name || ': expected ' || coalesce(expected, 'NULL') || ' got ' || coalesce(actual, 'NULL'), E'\n')
    into v_bad from results where expected is distinct from actual and phase <> 'sabotage';
  if v_bad is not null then raise exception E'patient home layout proof FAILED:\n%', v_bad; end if;
  if not exists (select 1 from results where phase = 'sabotage' and expected is distinct from actual) then
    raise exception 'patient home layout proof: the sabotage did not flip a check, so the policy check proves nothing';
  end if;
  raise notice 'patient home layout proof: % checks passed', (select count(*) from results where phase <> 'sabotage');
end $$;

rollback;
