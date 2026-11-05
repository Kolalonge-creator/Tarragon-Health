-- Proves 20261105103048_audit_log_writes_through_record_audit_event.sql (master architecture assessment finding S2).
--
--  1. A care-team staff member can no longer insert an audit row naming another person as the actor.
--  2. A signed-in caller cannot insert directly at all, even naming themselves (step 2, 20261105135451).
--  3. record_audit_event writes actor = auth.uid() and the caller's organisation for the caller's own doctor summary.
--  4. It refuses an action that is not on its allowlist.
--  5. A patient cannot record a download of another patient's prescription (no access), nor name another patient's medication
--     as the entity of a self-attributed row.
--  6. A clinician records a download for a patient in their organisation.
--  7. anon cannot execute it.
--  8. A caregiver with medication access records a download of the dependant's prescription; the row is filed under the
--     dependant's organisation, not the caregiver's.
--  9. record_audit_events is all-or-nothing: one refused row and none is written.
-- 10. A doctor summary row cannot name another profile.
-- Sabotage: with the old audit_log_insert policy and the INSERT grant restored, the staff forgery in check 1 succeeds.
--
-- Each attempt runs in pg_temp.attempt: the role switch is EXECUTEd so it takes effect before the next statement is planned.

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to authenticated, anon;

create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to authenticated, anon;

insert into public.organisations (id, name, type)
values ('a5e20000-0000-4000-8000-0000000000b0', 'Audit proof org B', (select type from public.organisations order by created_at limit 1))
on conflict (id) do nothing;

insert into ids values
  ('org', (select id from public.organisations where id <> 'a5e20000-0000-4000-8000-0000000000b0' order by created_at limit 1)),
  ('org_b', 'a5e20000-0000-4000-8000-0000000000b0'),
  ('patient', 'a5e20000-0000-4000-8000-000000000001'),
  ('other_patient', 'a5e20000-0000-4000-8000-000000000002'),
  ('doctor', 'a5e20000-0000-4000-8000-000000000003'),
  ('caregiver', 'a5e20000-0000-4000-8000-000000000004'),
  ('dependant', 'a5e20000-0000-4000-8000-000000000005'),
  ('med_patient', 'a5e20000-0000-4000-8000-000000000011'),
  ('med_dependant', 'a5e20000-0000-4000-8000-000000000012'),
  ('med_other', 'a5e20000-0000-4000-8000-000000000013');

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select v, k || '-auditlog@example.invalid', 'x', now(), '{}', '{}'
from ids where k in ('patient', 'other_patient', 'doctor', 'caregiver', 'dependant')
on conflict (id) do nothing;

insert into public.profiles (id, organisation_id, role, full_name)
values ((select v from ids where k='patient'), (select v from ids where k='org'), 'patient', 'Audit Patient'),
       ((select v from ids where k='other_patient'), (select v from ids where k='org'), 'patient', 'Audit Other Patient'),
       ((select v from ids where k='doctor'), (select v from ids where k='org'), 'clinician', 'Audit Doctor'),
       ((select v from ids where k='caregiver'), (select v from ids where k='org'), 'patient', 'Audit Caregiver'),
       ((select v from ids where k='dependant'), (select v from ids where k='org_b'), 'patient', 'Audit Dependant')
on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;

insert into public.medications (id, organisation_id, patient_id, drug_name)
values ((select v from ids where k='med_patient'), (select v from ids where k='org'), (select v from ids where k='patient'), 'Paracetamol'),
       ((select v from ids where k='med_dependant'), (select v from ids where k='org_b'), (select v from ids where k='dependant'), 'Vitamin D'),
       ((select v from ids where k='med_other'), (select v from ids where k='org'), (select v from ids where k='other_patient'), 'Folic acid');

-- The caregiver may see the dependant's medicines (consent triggers bypassed for the fixture, as caregiver_granular_permissions.sql does).
set local session_replication_role = replica;
insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
values ((select v from ids where k='dependant'), (select v from ids where k='caregiver'), 'view', (select v from ids where k='dependant'), true,
        array['view_medication']::public.caregiver_permission[]);
set local session_replication_role = origin;

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

create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;

-- 1. staff forging another actor
insert into results select '01 staff cannot insert a row naming another actor', '42501',
  pg_temp.attempt('doctor', format(
    $q$insert into public.audit_log (organisation_id, actor_id, action) values (%L, %L, 'proof.forged')$q$, pg_temp.id('org'), pg_temp.id('other_patient')));

-- 2. transitional self insert
insert into results select '02 a direct insert is refused even when it names the caller', '42501',
  pg_temp.attempt('doctor', format(
    $q$insert into public.audit_log (organisation_id, actor_id, action) values (%L, %L, 'proof.self')$q$, pg_temp.id('org'), pg_temp.id('doctor')));

-- 3. own doctor summary
insert into results select '03 patient records their own doctor summary', 'ok',
  pg_temp.attempt('patient', format(
    $q$select public.record_audit_event('patient.doctor_summary_requested', 'profiles', %L, %L, '{"proof":true}'::jsonb)$q$,
    pg_temp.id('patient'), pg_temp.id('patient')));
insert into results select '03 the row names the patient as actor, in their organisation', 'true',
  exists(select 1 from public.audit_log where action = 'patient.doctor_summary_requested' and event ->> 'proof' = 'true'
           and actor_id = pg_temp.id('patient') and organisation_id = pg_temp.id('org'))::text;

-- 4. allowlist
insert into results select '04 an action off the allowlist is refused', '42501',
  pg_temp.attempt('patient', $q$select public.record_audit_event('admin.role_changed')$q$);

-- 5. no access / entity of someone else
insert into results select '05 a patient cannot record a download of another patient''s prescription', '42501',
  pg_temp.attempt('patient', format(
    $q$select public.record_audit_event('prescription.pdf_downloaded', 'medications', %L, %L)$q$, pg_temp.id('med_other'), pg_temp.id('other_patient')));
insert into results select '05 a self-attributed row cannot name another patient''s medication', '42501',
  pg_temp.attempt('patient', format(
    $q$select public.record_audit_event('prescription.pdf_downloaded', 'medications', %L)$q$, pg_temp.id('med_other')));

-- 6. clinician in the organisation
insert into results select '06 a clinician records a download for their patient', 'ok',
  pg_temp.attempt('doctor', format(
    $q$select public.record_audit_event('prescription.pdf_downloaded', 'medications', %L, %L, '{"via":"clinician"}'::jsonb)$q$,
    pg_temp.id('med_patient'), pg_temp.id('patient')));

-- 7. anon
insert into results select '07 anon cannot execute record_audit_event', '42501',
  pg_temp.attempt('anon', $q$select public.record_audit_event('patient.doctor_summary_requested')$q$);

-- 8. caregiver, cross-organisation
insert into results select '08 a caregiver with medication access records the dependant''s download', 'ok',
  pg_temp.attempt('caregiver', format(
    $q$select public.record_audit_events('prescription.pdf_downloaded', jsonb_build_array(jsonb_build_object(
      'entity_type', 'medications', 'entity_id', %L, 'subject_patient_id', %L, 'event', '{"via":"caregiver"}'::jsonb)))$q$,
    pg_temp.id('med_dependant'), pg_temp.id('dependant')));
insert into results select '08 that row is filed under the dependant''s organisation, actor = caregiver', 'true',
  exists(select 1 from public.audit_log where action = 'prescription.pdf_downloaded' and event ->> 'via' = 'caregiver'
           and actor_id = pg_temp.id('caregiver') and organisation_id = pg_temp.id('org_b')
           and subject_patient_id = pg_temp.id('dependant'))::text;

-- 9. batch all-or-nothing: one valid row, one refused row
insert into results select '09 a batch with one refused row is refused', '42501',
  pg_temp.attempt('patient', format(
    $q$select public.record_audit_events('prescription.pdf_downloaded', jsonb_build_array(
      jsonb_build_object('entity_type', 'medications', 'entity_id', %L, 'event', '{"batch":"mixed"}'::jsonb),
      jsonb_build_object('entity_type', 'medications', 'entity_id', %L, 'subject_patient_id', %L, 'event', '{"batch":"mixed"}'::jsonb)))$q$,
    pg_temp.id('med_patient'), pg_temp.id('med_other'), pg_temp.id('other_patient')));
insert into results select '09 and none of its rows is written', '0',
  (select count(*) from public.audit_log where event ->> 'batch' = 'mixed')::text;

-- 10. doctor summary on someone else's profile
insert into results select '10 a doctor summary row cannot name another profile', '42501',
  pg_temp.attempt('patient', format(
    $q$select public.record_audit_event('patient.doctor_summary_requested', 'profiles', %L)$q$, pg_temp.id('other_patient')));

-- Sabotage: restore the old policy and the grant; the forgery from check 1 now succeeds.
grant insert on public.audit_log to authenticated;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check ((actor_id = (select auth.uid())) or ((organisation_id is not null) and private.is_org_staff(organisation_id)));
insert into results select '99 SABOTAGE: with the old policy the forgery succeeds (check 01 would fail)', 'ok',
  pg_temp.attempt('doctor', format(
    $q$insert into public.audit_log (organisation_id, actor_id, action) values (%L, %L, 'proof.forged')$q$, pg_temp.id('org'), pg_temp.id('other_patient')));

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as verdict
from results order by check_name;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected is distinct from actual;
  if v_fail > 0 then
    raise exception 'audit_log_no_forged_actor: % check(s) failed', v_fail;
  end if;
  if (select count(*) from results) <> 15 then
    raise exception 'audit_log_no_forged_actor: expected 15 checks, got %', (select count(*) from results);
  end if;
end;
$$;

rollback;
