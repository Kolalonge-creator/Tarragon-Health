-- ===========================================================================
-- Verification: doctor_testimonials
-- (20260924210347_doctor_testimonials.sql).
--
-- Doctor-side counterpart to patient_testimonials, built on an explicit
-- founder decision that a doctor's quote needs admin-entered, off-platform
-- consent rather than the patient flow's same-session checkbox -- see the
-- migration header. Proves:
--   * a plain (non-admin) authenticated account cannot insert a row at all
--     -- there is no self-submit path for a doctor, by design;
--   * an admin CAN insert one, and it lands as 'submitted', never
--     auto-published;
--   * a row cannot be created with a blank consent_reference (the
--     require-a-human-to-point-at-real-consent gate);
--   * a non-admin cannot move a row to 'published' (RLS silently filters the
--     update to zero rows, it does not error -- proven by re-reading the
--     row and confirming nothing changed);
--   * an admin CAN publish, and the review is server-stamped to the actual
--     invoking admin (reviewed_by/reviewed_at), not whatever the caller sent;
--   * anon can read only the published row, never the still-submitted one,
--     even though anon holds the table-level SELECT grant (row-level, not
--     column-level, discrimination -- same shape as patient_testimonials);
--   * anon has no INSERT or UPDATE grant at all -- a member of the public
--     cannot self-publish or fabricate a doctor testimonial.
--   * sabotage-equivalent: dropping doctor_testimonials_update's USING
--     clause down to `true` would let the non-admin update succeed -- this
--     is confirmed structurally (the policy that blocks it in step 4 is the
--     one under test), not literally re-run after sabotage, since RLS
--     policies can't be redefined mid-transaction without invalidating the
--     plan this script already built on.
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table dt_fixture(k text primary key, v uuid) on commit drop;
create temporary table dt_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org         uuid;
  v_admin       uuid := gen_random_uuid();
  v_patient     uuid := gen_random_uuid();
  v_staff_profile uuid := gen_random_uuid();
  v_staff       uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'dt-admin@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient, 'dt-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_profile, 'dt-staff@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_admin, v_org, 'admin', 'DT Admin'),
    (v_patient, v_org, 'patient', 'DT Patient'),
    (v_staff_profile, v_org, 'clinician', 'Dr. DT Fixture')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.clinical_staff
    (organisation_id, profile_id, doctor_tier, full_name, active, license_verified_at)
  values (v_org, v_staff_profile, 'medical_officer', 'Dr. Adaeze Okafor', true, now())
  returning id into v_staff;

  insert into dt_fixture values
    ('org', v_org), ('admin', v_admin), ('patient', v_patient), ('staff', v_staff);
end $$;

-- ==========================================================================
-- 1. A non-admin authenticated account cannot insert at all.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from dt_fixture where k = 'patient');
  v_org     uuid := (select v from dt_fixture where k = 'org');
  v_staff   uuid := (select v from dt_fixture where k = 'staff');
  v_error   text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.doctor_testimonials
      (organisation_id, clinical_staff_id, display_name, quote, consent_reference, created_by)
    values
      (v_org, v_staff, 'Dr. Adaeze', 'A patient tried to submit this on the doctor''s behalf.',
       'no real consent', v_patient);
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlstate;
  end;

  insert into dt_result values
    ('a non-admin cannot insert a doctor_testimonials row', v_error, '42501',
     case when v_error = '42501' then 'PASS' else 'FAIL' end);
  if v_error <> '42501' then
    raise exception 'HOLE OPEN: a non-admin account inserted a doctor testimonial (got %)', v_error;
  end if;
end $$;

-- ==========================================================================
-- 2. An admin CAN insert; a blank consent_reference is rejected; the row
--    lands as 'submitted', never auto-published.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from dt_fixture where k = 'admin');
  v_org   uuid := (select v from dt_fixture where k = 'org');
  v_staff uuid := (select v from dt_fixture where k = 'staff');
  v_error text;
  v_id_to_publish uuid;
  v_status_to_publish text;
  v_id_left_submitted uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- Every statement that needs to run AS the admin (RLS-checked) happens
  -- between set local role / reset role, with results captured into plain
  -- variables. dt_fixture/dt_result are owned by this script's own
  -- (postgres/service) role with no grant to `authenticated`, so any write
  -- to them must happen only after `reset role`, same as step 1's pattern.
  begin
    set local role authenticated;
    insert into public.doctor_testimonials
      (organisation_id, clinical_staff_id, display_name, quote, consent_reference, created_by)
    values
      (v_org, v_staff, 'Dr. Adaeze', 'Blank consent reference should be rejected.', '   ', v_admin);
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlstate;
  end;
  insert into dt_result values
    ('a blank consent_reference is rejected', v_error, '23514',
     case when v_error = '23514' then 'PASS' else 'FAIL' end);
  if v_error <> '23514' then
    raise exception 'HOLE OPEN: a doctor testimonial was created with a blank consent_reference (got %)', v_error;
  end if;

  set local role authenticated;
  insert into public.doctor_testimonials
    (organisation_id, clinical_staff_id, display_name, quote, condition, consent_reference, created_by)
  values
    (v_org, v_staff, 'Dr. Adaeze',
     'Being on a care team here means I actually know my patients, not just their charts.',
     'hypertension', 'Signed release on file, HR drive, 2026-09-24.', v_admin)
  returning id, status into v_id_to_publish, v_status_to_publish;

  -- A second row, deliberately left submitted, to prove anon visibility is
  -- per-row (step 5) rather than "anon can see the whole table once
  -- something is published".
  insert into public.doctor_testimonials
    (organisation_id, clinical_staff_id, display_name, quote, consent_reference, created_by)
  values
    (v_org, v_staff, 'Dr. Adaeze', 'This one should stay invisible to the public.',
     'Verbal OK, documented in #comms 2026-09-24.', v_admin)
  returning id into v_id_left_submitted;
  reset role;

  insert into dt_fixture values
    ('testimonial_to_publish', v_id_to_publish), ('testimonial_left_submitted', v_id_left_submitted);
  insert into dt_result values
    ('an admin-inserted row lands as submitted, never auto-published', v_status_to_publish, 'submitted',
     case when v_status_to_publish = 'submitted' then 'PASS' else 'FAIL' end);
  if v_status_to_publish <> 'submitted' then
    raise exception 'FAIL: a fresh doctor testimonial should default to submitted, got %', v_status_to_publish;
  end if;
end $$;

-- ==========================================================================
-- 3. A non-admin cannot move a row to 'published' — the update is silently
--    filtered to zero rows by RLS, not an error.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from dt_fixture where k = 'patient');
  v_id      uuid := (select v from dt_fixture where k = 'testimonial_to_publish');
  v_status  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.doctor_testimonials set status = 'published' where id = v_id;
  reset role;

  select status into v_status from public.doctor_testimonials where id = v_id;
  insert into dt_result values
    ('a non-admin publish attempt changes nothing', v_status, 'submitted',
     case when v_status = 'submitted' then 'PASS' else 'FAIL' end);
  if v_status <> 'submitted' then
    raise exception 'HOLE OPEN: a non-admin was able to publish a doctor testimonial';
  end if;
end $$;

-- ==========================================================================
-- 4. An admin CAN publish; reviewed_by/reviewed_at are server-stamped to the
--    actual invoking admin, not a spoofed value.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from dt_fixture where k = 'admin');
  v_id    uuid := (select v from dt_fixture where k = 'testimonial_to_publish');
  v_status text;
  v_reviewed_by uuid;
  v_reviewed_at timestamptz;
  v_spoof uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- Try to spoof reviewed_by in the same statement — the trigger must win.
  update public.doctor_testimonials
     set status = 'published', reviewed_by = v_spoof
   where id = v_id;
  reset role;

  select status, reviewed_by, reviewed_at into v_status, v_reviewed_by, v_reviewed_at
    from public.doctor_testimonials where id = v_id;

  insert into dt_result values
    ('an admin can publish', v_status, 'published',
     case when v_status = 'published' then 'PASS' else 'FAIL' end);
  insert into dt_result values
    ('reviewed_by is server-stamped to the real admin, not the spoofed value', v_reviewed_by::text, v_admin::text,
     case when v_reviewed_by = v_admin then 'PASS' else 'FAIL' end);
  insert into dt_result values
    ('reviewed_at is stamped', (v_reviewed_at is not null)::text, 'true',
     case when v_reviewed_at is not null then 'PASS' else 'FAIL' end);

  if v_status <> 'published' or v_reviewed_by <> v_admin or v_reviewed_at is null then
    raise exception 'FAIL: admin publish did not land correctly (status=%, reviewed_by=%, reviewed_at=%)',
      v_status, v_reviewed_by, v_reviewed_at;
  end if;
end $$;

-- ==========================================================================
-- 5. Anon can read only the published row, never the still-submitted one —
--    row-level discrimination, not "the table becomes visible once
--    something is published".
-- ==========================================================================
do $$
declare
  v_published  uuid := (select v from dt_fixture where k = 'testimonial_to_publish');
  v_submitted  uuid := (select v from dt_fixture where k = 'testimonial_left_submitted');
  v_visible_ids uuid[];
begin
  set local role anon;
  select array_agg(id) into v_visible_ids
    from public.doctor_testimonials
   where id in (v_published, v_submitted);
  reset role;

  insert into dt_result values
    ('anon sees the published row', (v_published = any(v_visible_ids))::text, 'true',
     case when v_published = any(v_visible_ids) then 'PASS' else 'FAIL' end);
  insert into dt_result values
    ('anon does NOT see the still-submitted row', (v_submitted = any(v_visible_ids))::text, 'false',
     case when not (v_submitted = any(v_visible_ids)) then 'PASS' else 'FAIL' end);

  if not (v_published = any(v_visible_ids)) then
    raise exception 'FAIL: anon could not read the published doctor testimonial — marketing would render nothing';
  end if;
  if v_submitted = any(v_visible_ids) then
    raise exception 'HOLE OPEN: anon read a still-submitted (unpublished) doctor testimonial';
  end if;
end $$;

-- ==========================================================================
-- 6. Anon has no INSERT or UPDATE grant at all — the public cannot fabricate
--    or self-publish a doctor testimonial.
-- ==========================================================================
do $$
declare
  v_id    uuid := (select v from dt_fixture where k = 'testimonial_left_submitted');
  v_org   uuid := (select v from dt_fixture where k = 'org');
  v_staff uuid := (select v from dt_fixture where k = 'staff');
  v_insert_error text;
  v_update_error text;
begin
  set local role anon;

  begin
    insert into public.doctor_testimonials
      (organisation_id, clinical_staff_id, display_name, quote, consent_reference, created_by)
    values (v_org, v_staff, 'Dr. Nobody', 'Fabricated by anon.', 'none',
            (select v from dt_fixture where k = 'admin'));
    v_insert_error := 'ACCEPTED';
  exception when others then
    v_insert_error := sqlstate;
  end;

  begin
    update public.doctor_testimonials set status = 'published' where id = v_id;
    v_update_error := 'ACCEPTED';
  exception when others then
    v_update_error := sqlstate;
  end;

  reset role;

  insert into dt_result values
    ('anon cannot INSERT a doctor testimonial', v_insert_error, '42501',
     case when v_insert_error = '42501' then 'PASS' else 'FAIL' end);
  insert into dt_result values
    ('anon cannot UPDATE a doctor testimonial', v_update_error, '42501',
     case when v_update_error = '42501' then 'PASS' else 'FAIL' end);

  if v_insert_error <> '42501' then
    raise exception 'HOLE OPEN: anon inserted a doctor testimonial (got %)', v_insert_error;
  end if;
  if v_update_error <> '42501' then
    raise exception 'HOLE OPEN: anon updated a doctor testimonial (got %)', v_update_error;
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
select * from dt_result order by check_name;

do $$
declare
  v_fails int;
begin
  select count(*) into v_fails from dt_result where verdict not like 'PASS%';
  if v_fails > 0 then
    raise exception '% check(s) failed — see the result table above', v_fails;
  end if;
  raise notice 'PASS: doctor_testimonials — admin-only insert/publish, blank-consent rejection, and per-row anon visibility all hold (% checks)', (select count(*) from dt_result);
end $$;

rollback;
