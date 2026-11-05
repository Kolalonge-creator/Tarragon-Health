-- Proves 20261105103048_audit_log_writes_through_record_audit_event.sql (master architecture assessment finding S2).
--
-- 1. A care-team staff member can no longer insert an audit row naming another person as the actor.
-- 2. A direct insert naming the caller still works (transitional, until step 2 removes direct inserts).
-- 3. public.record_audit_event writes the row with actor = auth.uid() and the caller's own organisation, whatever the client sends.
-- 4. It refuses an action that is not on its allowlist.
-- 5. A patient cannot record an event about another patient.
-- 6. A clinician can record a prescription download about a patient in their organisation.
-- 7. anon cannot execute it.
-- Sabotage: with the old audit_log_insert policy restored, the staff forgery in check 1 succeeds, so check 1 discriminates.
--
-- Each attempt runs in its own sub-block: the role switch is EXECUTEd so it takes effect before the next statement is planned.

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to authenticated, anon;

create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to authenticated, anon;
insert into ids values
  ('org', (select id from public.organisations order by created_at limit 1)),
  ('patient', 'a5e20000-0000-4000-8000-000000000001'),
  ('other_patient', 'a5e20000-0000-4000-8000-000000000002'),
  ('doctor', 'a5e20000-0000-4000-8000-000000000003');

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select v, k || '-auditlog@example.invalid', 'x', now(), '{}', '{}' from ids where k <> 'org'
on conflict (id) do nothing;

insert into public.profiles (id, organisation_id, role, full_name)
values ((select v from ids where k='patient'), (select v from ids where k='org'), 'patient', 'Audit Patient'),
       ((select v from ids where k='other_patient'), (select v from ids where k='org'), 'patient', 'Audit Other Patient'),
       ((select v from ids where k='doctor'), (select v from ids where k='org'), 'clinician', 'Audit Doctor')
on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;

-- Runs p_sql as p_who (a key in ids, or 'anon') and returns the SQLSTATE, or 'ok'.
create or replace function pg_temp.attempt(p_who text, p_sql text) returns text language plpgsql as $$
declare v_state text := 'ok';
begin
  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from ids where k = p_who), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  begin
    execute p_sql;
  exception when others then v_state := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  return v_state;
end;
$$;

-- 1. staff forging another actor
insert into results select '1. staff cannot insert a row naming another actor', '42501',
  pg_temp.attempt('doctor', format(
    $q$insert into public.audit_log (organisation_id, actor_id, action) values (%L, %L, 'proof.forged')$q$,
    (select v from ids where k='org'), (select v from ids where k='other_patient')));

-- 2. staff self-attributed direct insert still works (transitional)
insert into results select '2. a direct self-attributed insert still works', 'ok',
  pg_temp.attempt('doctor', format(
    $q$insert into public.audit_log (organisation_id, actor_id, action) values (%L, %L, 'proof.self')$q$,
    (select v from ids where k='org'), (select v from ids where k='doctor')));

-- 3. the function stamps actor and organisation
insert into results select '3. record_audit_event succeeds for the patient', 'ok',
  pg_temp.attempt('patient',
    $q$select public.record_audit_event('patient.doctor_summary_requested', 'profiles', null, null, '{"proof":true}'::jsonb)$q$);
insert into results select '3. the row names the patient as actor, in their organisation', 'true',
  exists(select 1 from public.audit_log
          where action = 'patient.doctor_summary_requested' and event ->> 'proof' = 'true'
            and actor_id = (select v from ids where k='patient')
            and organisation_id = (select v from ids where k='org'))::text;

-- 4. allowlist
insert into results select '4. an action off the allowlist is refused', '42501',
  pg_temp.attempt('patient', $q$select public.record_audit_event('admin.role_changed')$q$);

-- 5. a patient cannot write about someone else
insert into results select '5. a patient cannot record an event about another patient', '42501',
  pg_temp.attempt('patient', format(
    $q$select public.record_audit_event('prescription.pdf_downloaded', 'medications', null, %L)$q$,
    (select v from ids where k='other_patient')));

-- 6. a clinician may record about a patient in their organisation
insert into results select '6. a clinician records a download about their patient', 'ok',
  pg_temp.attempt('doctor', format(
    $q$select public.record_audit_event('prescription.pdf_downloaded', 'medications', null, %L, '{"via":"clinician"}'::jsonb)$q$,
    (select v from ids where k='patient')));

-- 7. anon
insert into results select '7. anon cannot execute record_audit_event', '42501',
  pg_temp.attempt('anon', $q$select public.record_audit_event('patient.doctor_summary_requested')$q$);

-- Sabotage: restore the old policy; the forgery from check 1 now succeeds.
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check ((actor_id = (select auth.uid())) or ((organisation_id is not null) and private.is_org_staff(organisation_id)));
insert into results select 'SABOTAGE: with the old policy the forgery succeeds (check 1 would fail)', 'ok',
  pg_temp.attempt('doctor', format(
    $q$insert into public.audit_log (organisation_id, actor_id, action) values (%L, %L, 'proof.forged')$q$,
    (select v from ids where k='org'), (select v from ids where k='other_patient')));

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as verdict
from results order by check_name;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected is distinct from actual;
  if v_fail > 0 then
    raise exception 'audit_log_no_forged_actor: % check(s) failed', v_fail;
  end if;
  if (select count(*) from results) <> 9 then
    raise exception 'audit_log_no_forged_actor: expected 9 checks, got %', (select count(*) from results);
  end if;
end;
$$;

rollback;
