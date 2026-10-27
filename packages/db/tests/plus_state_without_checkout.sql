-- Proof: Membership Plus without a checkout still gets a collection state (migration *_plus_state_without_checkout.sql, OQ-PLUS-1).
-- Raises on any failed check. One rolled-back transaction.
--   1. Module OFF: an admin can grant Plus with no state and nothing is stored (as before); an approved state that is given is kept.
--   2. Module ON: an admin grant of Plus needs an approved state (plus_state_required / plus_state_not_available); an approved state is stored;
--      Membership (evergreen) ignores the argument; a caller who may not grant is told that, not the state error; nothing is written on a refusal.
--   3. A member whose live Plus has no state chooses once (employer seat, older grant): approved only, a second change is refused, a Membership
--      holder and a person with no membership are refused, anon cannot call either function, the old four-argument grant is gone.
--   SABOTAGE: the state requirement removed from the grant (check 2) and the set-once rule removed (check 3); each must flip.
begin;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ps-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'PS ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.grant_as(p_admin uuid, p_patient uuid, p_tier text, p_state text default null) returns text language plpgsql as $f$
begin
  return pg_temp.q_as(p_admin, case when p_state is null
    then format($q$select public.grant_membership_tier(%L, %L, 'proof grant for the collection state')::text$q$, p_patient, p_tier)
    else format($q$select public.grant_membership_tier(%L, %L, 'proof grant for the collection state', null, %L)::text$q$, p_patient, p_tier, p_state) end);
end $f$;

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;

do $$
declare ad uuid := pg_temp.mkuser('admin', 'admin');
begin
  insert into fx values ('ad', ad::text);
  if private.plus_collection_state_enabled('Kano') then raise exception 'FAIL fixture: Kano must not be approved'; end if;
  if not private.plus_collection_state_enabled('Oyo') then raise exception 'FAIL fixture: Oyo must be approved'; end if;
end $$;

-- 1. module OFF
do $$
declare ad uuid := (select v::uuid from fx where k = 'ad'); p uuid := pg_temp.mkuser('off', 'patient'); r text;
        o2 uuid := pg_temp.mkuser('off2', 'patient'); o3 uuid := pg_temp.mkuser('off3', 'patient');
begin
  update public.platform_modules set is_enabled = false where key = 'membership_two_member_tiers';
  r := pg_temp.grant_as(ad, p, 'plus');
  if r like 'ERR:%' then raise exception 'FAIL a Plus grant needed a state while the module is off: %', r; end if;
  if (select collection_state from public.patient_memberships where patient_id = p and state = 'active') is not null then raise exception 'FAIL a state was stored while the module is off'; end if;
  -- an approved state the admin chose is kept even while the module is off; an unapproved one is not
  r := pg_temp.grant_as(ad, o2, 'plus', 'Osun');
  if r like 'ERR:%' or (select collection_state from public.patient_memberships where patient_id = o2 and state = 'active') is distinct from 'Osun' then
    raise exception 'FAIL an approved state was not kept while the module is off: %', r;
  end if;
  r := pg_temp.grant_as(ad, o3, 'plus', 'Kano');
  if r like 'ERR:%' or (select collection_state from public.patient_memberships where patient_id = o3 and state = 'active') is not null then
    raise exception 'FAIL an unapproved state was kept while the module is off: %', r;
  end if;
end $$;

-- 2. module ON: the admin grant
do $$
declare ad uuid := (select v::uuid from fx where k = 'ad'); r text; p1 uuid := pg_temp.mkuser('p1', 'patient'); p2 uuid := pg_temp.mkuser('p2', 'patient');
        p3 uuid := pg_temp.mkuser('p3', 'patient'); p4 uuid := pg_temp.mkuser('p4', 'patient'); n integer;
begin
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = ad, activation_note = 'proof' where key = 'membership_two_member_tiers';
  r := pg_temp.grant_as(ad, p1, 'plus');
  if r not like 'ERR:%plus_state_required%' then raise exception 'FAIL Plus granted with no state: %', r; end if;
  r := pg_temp.grant_as(ad, p1, 'plus', 'Kano');
  if r not like 'ERR:%plus_state_not_available%' then raise exception 'FAIL Plus granted for an unapproved state: %', r; end if;
  if exists (select 1 from public.patient_memberships where patient_id = p1) then raise exception 'FAIL a refused grant left a membership behind'; end if;
  r := pg_temp.grant_as(ad, p1, 'plus', 'Oyo');
  if r like 'ERR:%' then raise exception 'FAIL an approved state was refused: %', r; end if;
  if (select collection_state from public.patient_memberships where patient_id = p1 and state = 'active') is distinct from 'Oyo' then raise exception 'FAIL the state was not stored'; end if;
  r := pg_temp.grant_as(ad, p2, 'evergreen', 'Kano');
  if r like 'ERR:%' then raise exception 'FAIL Membership was refused over a state it ignores: %', r; end if;
  if (select collection_state from public.patient_memberships where patient_id = p2 and state = 'active') is not null then raise exception 'FAIL Membership stored a state'; end if;
  -- a patient may not grant: told that, not the state error
  r := pg_temp.q_as(p3, format($q$select public.grant_membership_tier(%L, 'plus', 'proof self grant attempt', null, 'Oyo')::text$q$, p3));
  if r not like 'ERR:%' or r like '%plus_state%' then raise exception 'FAIL a patient grant was not refused on authority: %', r; end if;
  select count(*) into n from pg_proc where proname = 'grant_membership_tier' and pronamespace = 'public'::regnamespace;
  if n <> 1 then raise exception 'FAIL expected one grant_membership_tier, found %', n; end if;
  if has_function_privilege('anon', 'public.grant_membership_tier(uuid,text,text,timestamptz,text)', 'EXECUTE') then raise exception 'FAIL anon can grant'; end if;
end $$;

-- 3. the member chooses once
do $$
declare ad uuid := (select v::uuid from fx where k = 'ad'); org uuid := '00000000-0000-0000-0000-000000000001';
        seat uuid := pg_temp.mkuser('seat', 'patient'); eg uuid := pg_temp.mkuser('eg', 'patient'); nobody uuid := pg_temp.mkuser('nobody', 'patient'); r text;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values (org, seat, 'employer', 'active', now(), now() + interval '300 days', true, 'plus'),
         (org, eg, 'purchase', 'active', now(), now() + interval '300 days', true, 'evergreen');
  r := pg_temp.q_as(seat, $q$select public.set_my_plus_collection_state('Kano')::text$q$);
  if r not like 'ERR:%plus_state_not_available%' then raise exception 'FAIL an unapproved state was accepted: %', r; end if;
  r := pg_temp.q_as(seat, $q$select public.set_my_plus_collection_state('  ')::text$q$);
  if r not like 'ERR:%plus_state_required%' then raise exception 'FAIL a blank state was accepted: %', r; end if;
  r := pg_temp.q_as(seat, $q$select public.set_my_plus_collection_state('Osun')::text$q$);
  if r like 'ERR:%' then raise exception 'FAIL a seat member could not choose an approved state: %', r; end if;
  if (select collection_state from public.patient_memberships where patient_id = seat and state = 'active') is distinct from 'Osun' then raise exception 'FAIL the chosen state was not stored'; end if;
  r := pg_temp.q_as(seat, $q$select public.set_my_plus_collection_state('Lagos')::text$q$);
  if r not like 'ERR:%plus_state_already_set%' then raise exception 'FAIL the state was changed a second time: %', r; end if;
  r := pg_temp.q_as(eg, $q$select public.set_my_plus_collection_state('Lagos')::text$q$);
  if r not like 'ERR:%plus_membership_not_found%' then raise exception 'FAIL a Membership holder set a Plus state: %', r; end if;
  r := pg_temp.q_as(nobody, $q$select public.set_my_plus_collection_state('Lagos')::text$q$);
  if r not like 'ERR:%plus_membership_not_found%' then raise exception 'FAIL a person with no membership set a state: %', r; end if;
  if has_function_privilege('anon', 'public.set_my_plus_collection_state(text)', 'EXECUTE') then raise exception 'FAIL anon can set a state'; end if;
  if not exists (select 1 from public.audit_log where action = 'membership.plus_state_set' and actor_id = seat) then raise exception 'FAIL the choice was not audited'; end if;
end $$;

-- SABOTAGE 1: the state requirement removed from the grant; a stateless Plus grant must then succeed (proving check 2 can fail)
do $$
declare ad uuid := (select v::uuid from fx where k = 'ad'); d text; r text; p uuid := pg_temp.mkuser('sab1', 'patient');
begin
  d := pg_get_functiondef('public.grant_membership_tier(uuid,text,text,timestamptz,text)'::regprocedure);
  d := replace(d, 'if p_tier = ''plus'' and private.plus_needs_state(', 'if false and p_tier = ''plus'' and private.plus_needs_state(');
  execute d;
  r := pg_temp.grant_as(ad, p, 'plus');
  if r like 'ERR:%' then raise exception 'FAIL the state requirement sabotage did not flip: %', r; end if;
end $$;

-- SABOTAGE 2: the set-once rule removed; a second change must then succeed
do $$
declare d text; r text; seat uuid := pg_temp.mkuser('sab2', 'patient');
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier, collection_state)
  values ('00000000-0000-0000-0000-000000000001', seat, 'employer', 'active', now(), now() + interval '300 days', true, 'plus', 'Oyo');
  d := pg_get_functiondef('public.set_my_plus_collection_state(text)'::regprocedure);
  d := replace(d, 'if m.collection_state is not null then raise exception', 'if false then raise exception');
  execute d;
  r := pg_temp.q_as(seat, $q$select public.set_my_plus_collection_state('Lagos')::text$q$);
  if r like 'ERR:%' then raise exception 'FAIL the set-once sabotage did not flip: %', r; end if;
end $$;

select 'PASS plus_state_without_checkout' as result;
rollback;
