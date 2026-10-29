-- Proves 20261029233636_feature_waitlist.sql: a patient can put themselves on the waitlist for a closed feature, can see and remove
-- only their own rows, cannot write for someone else, and cannot name a feature that does not exist.
--
--   npx supabase db query --linked -f packages/db/tests/feature_waitlist.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

do $$
declare
  r     record;
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_id  uuid;
begin
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type) values (v_org, 'Waitlist Test Org', 'direct_consumer');
  end if;
  insert into ids(k, v) values ('org', v_org);
  for r in select unnest(array['ada', 'bayo']) as key_name loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('waitlist-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'patient'::public.user_role, format('Waitlist %s', r.key_name))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  end loop;
end $$;

-- As Ada
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='ada'), 'role','authenticated')::text, true);
set local role authenticated;

insert into public.feature_waitlist (organisation_id, patient_id, feature_key)
select (select v from ids where k='org'), (select v from ids where k='ada'), 'consultations';

-- Writing a row in someone else's name is refused (RLS with check).
do $$
begin
  begin
    insert into public.feature_waitlist (organisation_id, patient_id, feature_key)
    select (select v from ids where k='org'), (select v from ids where k='bayo'), 'membership';
    insert into results values ('Ada cannot add a row for Bayo', 'refused', 'allowed');
  exception when others then
    insert into results values ('Ada cannot add a row for Bayo', 'refused', 'refused');
  end;
  begin
    insert into public.feature_waitlist (organisation_id, patient_id, feature_key)
    select (select v from ids where k='org'), (select v from ids where k='ada'), 'not_a_feature';
    insert into results values ('an unknown feature key is refused', 'refused', 'allowed');
  exception when others then
    insert into results values ('an unknown feature key is refused', 'refused', 'refused');
  end;
  begin
    insert into public.feature_waitlist (organisation_id, patient_id, feature_key)
    select (select v from ids where k='org'), (select v from ids where k='ada'), 'consultations';
    insert into results values ('joining twice is refused (one row per feature)', 'refused', 'allowed');
  exception when unique_violation then
    insert into results values ('joining twice is refused (one row per feature)', 'refused', 'refused');
  end;
end $$;

insert into results select 'Ada sees her own row', '1', count(*)::text from public.feature_waitlist;

reset role;
select set_config('request.jwt.claims', null, true);

-- As Bayo: sees nothing of Ada's, and cannot remove it.
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='bayo'), 'role','authenticated')::text, true);
set local role authenticated;
insert into results select 'Bayo cannot see Ada''s row', '0', count(*)::text from public.feature_waitlist;
delete from public.feature_waitlist where patient_id = (select v from ids where k='ada');
reset role;
select set_config('request.jwt.claims', null, true);

insert into results select 'Bayo cannot delete Ada''s row', '1',
  (select count(*)::text from public.feature_waitlist where patient_id = (select v from ids where k='ada'));

-- Ada can leave the list.
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k='ada'), 'role','authenticated')::text, true);
set local role authenticated;
delete from public.feature_waitlist where feature_key = 'consultations';
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'Ada can leave the list', '0',
  (select count(*)::text from public.feature_waitlist where patient_id = (select v from ids where k='ada'));

-- The signed-out role cannot read it at all.
insert into results select 'anon has no read access', 'false', has_table_privilege('anon', 'public.feature_waitlist', 'SELECT')::text;

do $$
declare bad text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || actual || ')', '; ')
    into bad from results where expected is distinct from actual;
  if bad is not null then raise exception 'feature_waitlist proof failed: %', bad; end if;
end $$;

select check_name, expected, actual, 'PASS' as status from results order by 1;
rollback;
