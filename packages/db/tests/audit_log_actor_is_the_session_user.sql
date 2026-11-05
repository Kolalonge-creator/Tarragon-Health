-- Proof: an audit_log row written from a user session always names that user as the actor
-- (migration *_audit_log_actor_is_the_session_user.sql, security audit 2026-11-05 M-9).
--   1. A staff session that names ANOTHER person as actor_id is refused (42501) and nothing is written.
--   2. A staff session that names no actor (null) gets its own id recorded.
--   3. A patient session's row records the patient.
--   4. A SECURITY DEFINER / postgres write keeps the actor it names (server code chooses it).
--   5. SABOTAGE: with the trigger dropped and the old staff branch restored, the staff session's forged actor survives.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to public;

do $$
declare v_org uuid; v_staff uuid := gen_random_uuid(); v_patient uuid := gen_random_uuid(); v_victim uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'ala-' || u || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_staff, v_patient, v_victim]) u;
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v_staff, v_org, 'admin', 'ALA staff', true), (v_patient, v_org, 'patient', 'ALA patient', true), (v_victim, v_org, 'admin', 'ALA victim', true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true;
  insert into ids values ('org', v_org), ('staff', v_staff), ('patient', v_patient), ('victim', v_victim);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'staff'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into public.audit_log (organisation_id, actor_id, action, entity_type)
  values ((select v from ids where k = 'org'), (select v from ids where k = 'victim'), 'ala.forged', 'test');
  insert into results values ('staff naming another person is refused', '42501', 'inserted');
exception when others then
  insert into results values ('staff naming another person is refused', '42501', sqlstate);
end $$;
insert into public.audit_log (organisation_id, actor_id, action, entity_type)
values ((select v from ids where k = 'org'), null, 'ala.null_actor', 'test');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'patient'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.audit_log (organisation_id, actor_id, action, entity_type)
values ((select v from ids where k = 'org'), (select v from ids where k = 'patient'), 'ala.patient', 'test');
reset role;
select set_config('request.jwt.claims', null, true);

insert into public.audit_log (organisation_id, actor_id, action, entity_type)
values ((select v from ids where k = 'org'), (select v from ids where k = 'victim'), 'ala.server', 'test');

insert into results
select 'the refused forgery left no row', '0', count(*)::text from public.audit_log where action = 'ala.forged'
union all select 'staff naming no actor is recorded as staff', (select v from ids where k = 'staff')::text, actor_id::text from public.audit_log where action = 'ala.null_actor'
union all select 'patient row records the patient', (select v from ids where k = 'patient')::text, actor_id::text from public.audit_log where action = 'ala.patient'
union all select 'server write keeps its named actor', (select v from ids where k = 'victim')::text, actor_id::text from public.audit_log where action = 'ala.server';

-- SABOTAGE: the pre-fix state.
drop trigger audit_log_actor_is_session_user on public.audit_log;
drop policy audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (actor_id = (select auth.uid()) or (organisation_id is not null and private.is_org_staff(organisation_id)));
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'staff'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.audit_log (organisation_id, actor_id, action, entity_type)
values ((select v from ids where k = 'org'), (select v from ids where k = 'victim'), 'ala.sabotage', 'test');
reset role;
select set_config('request.jwt.claims', null, true);
insert into results select 'SABOTAGE: without the fix the forged actor survives', (select v from ids where k = 'victim')::text, actor_id::text
from public.audit_log where action = 'ala.sabotage';

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as outcome from results;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', '; ') into v_fail
  from results where expected is distinct from actual;
  if v_fail is not null then raise exception 'audit_log_actor_is_the_session_user FAILED: %', v_fail; end if;
  if (select count(*) from results) <> 6 then raise exception 'audit_log_actor_is_the_session_user: expected 6 checks'; end if;
end $$;

rollback;
