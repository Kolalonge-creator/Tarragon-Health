-- Tarragon Health — provenance FK hardening verification
--
-- Proves the 2026-07-30 v3 port's provenance fix: attribution FKs to
-- profiles/clinical_staff were converted from ON DELETE SET NULL to
-- ON DELETE RESTRICT (85 constraints, one data-driven migration). Checks:
--   1. Deleting a clinical_staff row referenced by a real attribution
--      column is now BLOCKED (foreign_key_violation), not silently
--      succeeded with the reference nulled out.
--   2. The normal null-then-set attribution lifecycle is unaffected — an
--      event with no actor at write time still inserts fine (the fix is
--      about erasure-after-the-fact, not about forcing every event to have
--      an actor immediately).
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org uuid;
  v_profile uuid := gen_random_uuid();
  v_staff uuid;
  v_verifier uuid;
  v_patient uuid;
  v_blocked boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where role = 'admin' limit 1;
  select id into v_patient from public.profiles where role = 'patient' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_profile, 'provenance-fk-test@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Provenance FK Test'
    where id = v_profile;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_profile, v_org, 'Provenance FK Test', 'tier_4_senior_registrar', true, true, 'MDCN', 'PROVTEST-001', true, v_verifier, v_verifier, now())
  returning id into v_staff;

  -- Reference this clinical_staff row via a real attribution column with no
  -- extra caller-side guard (patient_timeline.actor_clinical_staff_id, via
  -- the shared record_timeline_event() writer every trigger already uses).
  perform private.record_timeline_event(
    v_org, v_patient, 'care_plan_updated', 'test_source', gen_random_uuid(),
    'Provenance FK test event', 'test summary', now(), v_staff, '{}'::jsonb
  );

  if not exists (select 1 from public.patient_timeline where actor_clinical_staff_id = v_staff) then
    raise exception 'FAIL: fixture setup did not create a referencing patient_timeline row';
  end if;

  -- 1) Attempting to hard-delete the referenced clinical_staff row must now
  -- be BLOCKED, not silently succeed and null the attribution.
  begin
    delete from public.clinical_staff where id = v_staff;
    v_blocked := false;
  exception when foreign_key_violation then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL: deleting a referenced clinical_staff row succeeded instead of being blocked';
  end if;

  if not exists (select 1 from public.patient_timeline where actor_clinical_staff_id = v_staff) then
    raise exception 'FAIL: attribution was altered/lost despite the delete supposedly being blocked';
  end if;
  raise notice 'PASS 1: deleting a referenced clinical_staff row is blocked; attribution intact';

  -- 2) Normal app flow unaffected: an event with NO actor (null attribution)
  -- still writes fine — the guarantee is about erasure-after-the-fact, not
  -- about forcing every event to have an actor at write time.
  perform private.record_timeline_event(
    v_org, v_patient, 'care_plan_updated', 'test_source', gen_random_uuid(),
    'Provenance FK test event 2 (no actor)', 'test summary 2', now(), null, '{}'::jsonb
  );
  if not exists (select 1 from public.patient_timeline where title = 'Provenance FK test event 2 (no actor)' and actor_clinical_staff_id is null) then
    raise exception 'FAIL: a null-attribution write no longer works';
  end if;
  raise notice 'PASS 2: null-attribution writes still work (never-actioned states unaffected)';

  raise notice 'ALL PROVENANCE FK HARDENING CHECKS PASSED';
end $$;

rollback;
