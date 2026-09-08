-- ===========================================================================
-- Verification: 20260902183059_record_corrections_drop_subject_fks.sql.
--
-- Before that migration, deleting a public.profiles row failed with a
-- foreign-key violation (record_corrections_patient_id_fkey /
-- _corrected_by_fkey), three separate ways:
--   1. Direct delete of a patient's own profiles row (self-referencing
--      patient_id -- the row deleted is the row the correction is about).
--   2. Deleting a profile that cascades into patient-scoped child tables
--      (vitals_readings etc. all "on delete cascade" from profiles) --
--      each cascaded delete's correction insert hits the same violation.
--   3. Deleting a profile that ALREADY has record_corrections history --
--      the FK's own "on delete set null" cleanup is itself an UPDATE,
--      which record_corrections_no_update unconditionally rejects.
--
-- This file exercises all three against a live, unmodified schema.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK -- leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table rcpd_fixture(k text primary key, v uuid) on commit drop;
create temporary table rcpd_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no row in public.organisations -- cannot run this test';
  end if;

  insert into rcpd_fixture(k, v) values ('org', v_org), ('patient', v_patient);

  insert into auth.users
    (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'rcpd-test-patient@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org where id = v_patient;
end $$;

-- ==========================================================================
-- 1. Manifestation #3 first: give the patient PRE-EXISTING record_corrections
--    history before they're ever deleted, by updating one of their own
--    fields (profiles itself is covered by capture_record_correction_trg).
--    This is the "FK's own on-delete-set-null cleanup gets rejected by the
--    append-only guard" case -- it has to exist BEFORE the delete below for
--    that scenario to be real.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rcpd_fixture where k = 'patient');
  v_count   bigint;
begin
  update public.profiles set full_name = 'RCPD Test Patient' where id = v_patient;

  select count(*) into v_count from public.record_corrections
    where table_name = 'profiles' and entity_id = v_patient;

  insert into rcpd_result values
    ('pre-existing correction exists before delete', v_count::text, '>=1',
     case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'SETUP BROKEN: updating the profile did not create a record_corrections row to test against';
  end if;
end $$;

-- ==========================================================================
-- 2. Give the patient a cascaded child row (manifestation #2) and delete
--    the profile directly, as the privileged/service context a real hard-
--    delete tool would run under (public.profiles has no DELETE policy for
--    `authenticated` -- self-service account deletion, if it exists, is not
--    a bare RLS-scoped DELETE). app.audit_actor_id is set to the patient's
--    own id first, standing in for "the deletion was recorded as initiated
--    by this patient" (manifestation #1's corrected_by variant) since
--    auth.uid() is null outside of an authenticated session. The whole
--    point of this test is that the delete below must NOT raise.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from rcpd_fixture where k = 'org');
  v_patient uuid := (select v from rcpd_fixture where k = 'patient');
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm)
  values (v_org, v_patient, 'pulse', 72);

  perform set_config('app.audit_actor_id', v_patient::text, true);
  delete from public.profiles where id = v_patient;

  insert into rcpd_result values
    ('deleting a profile with correction history + cascaded child row + self-as-actor', 'no exception raised', 'no exception raised', 'PASS');
exception
  when others then
    insert into rcpd_result values
      ('deleting a profile with correction history + cascaded child row + self-as-actor', sqlerrm, 'no exception raised', 'FAIL');
    raise exception 'BROKEN: deleting the profile raised: %', sqlerrm;
end $$;

-- ==========================================================================
-- 3. The delete itself, and the cascaded vitals_readings delete, were both
--    captured -- and both still carry the (now-deleted) patient_id, proving
--    the ledger stays queryable by patient even after the subject is gone.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rcpd_fixture where k = 'patient');
  v_count   bigint;
begin
  select count(*) into v_count from public.record_corrections
    where table_name = 'profiles' and entity_id = v_patient and new_values is null;
  insert into rcpd_result values
    ('profiles DELETE captured', v_count::text, '>=1', case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'BROKEN: deleting the profile created no record_corrections row for profiles itself';
  end if;

  select count(*) into v_count from public.record_corrections
    where table_name = 'vitals_readings' and patient_id = v_patient and new_values is null;
  insert into rcpd_result values
    ('cascaded vitals_readings DELETE captured, still linked by patient_id', v_count::text, '>=1',
     case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'BROKEN: the cascaded vitals_readings delete created no record_corrections row linked to the deleted patient';
  end if;

  select count(*) into v_count from public.record_corrections
    where table_name = 'profiles' and entity_id = v_patient and corrected_by = v_patient;
  insert into rcpd_result values
    ('corrected_by still points at the (now-deleted) self-deleting actor', v_count::text, '>=1',
     case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'BROKEN: corrected_by was not captured for the self-service deletion';
  end if;
end $$;

select check_name, observed, expected, verdict
from rcpd_result
order by verdict desc, check_name;

rollback;
