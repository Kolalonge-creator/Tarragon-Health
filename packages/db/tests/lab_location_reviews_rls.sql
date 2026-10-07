-- ===========================================================================
-- Verification: 20260924210135_lab_location_reviews
--
-- Proves the review-eligibility gate on public.lab_location_reviews actually
-- discriminates: a patient can only review a lab_provider_locations branch
-- via a lab_orders row they own, that has reached status='resulted', and
-- whose own location_id matches the location being reviewed. Also proves:
--   * a second review on the same lab_order is rejected (one review per
--     completed visit, via the lab_order_id UNIQUE constraint);
--   * a patient cannot read another patient's raw review row, but staff can;
--   * list_lab_location_reviews (the public directory read) surfaces a
--     visible review to a caller who could not read the raw row directly,
--     and list_lab_test_locations' aggregate rating reflects it too;
--   * report_lab_location_review lets any signed-in user flag a review
--     without exposing the report to anyone but staff/admin, and silently
--     absorbs a duplicate flag from the same reporter;
--   * staff hiding a review removes it from the public directory read while
--     the author can still see their own (now-hidden) review, and a
--     non-staff/non-admin patient cannot hide someone else's review;
--   * set_lab_order_location is write-once from the point a review becomes
--     possible (a branch can't be swapped once resulted+set) but still
--     settable for the first time on an already-resulted order (the "forgot
--     to record a branch" case, which is what unlocks reviewing at all);
--   * a caregiver with a can_act_for(book_appointments) grant may record a
--     branch and file a review on a dependent's behalf (attributed to the
--     dependent, never the caregiver, and readable back afterward — this
--     also exercises the real "INSERT ... RETURNING must satisfy the
--     table's own SELECT policy too" interaction found while building this),
--     while a caregiver missing that specific permission cannot do either,
--     proving can_act_for's permission array is actually consulted;
--   * staff can hide a review but a moderation-only trigger blocks them from
--     rewriting its rating/comment via a plain UPDATE;
--   * list_lab_test_locations returns one row per branch, not one per
--     lab_tests row that branch's provider happens to have, when called with
--     no test code (the row-fan-out this migration's LATERAL rewrite fixes);
--   * SABOTAGE: with the INSERT policy's ownership/status/location check
--     weakened, the earlier-blocked cross-patient attack now succeeds —
--     proving the real check was doing real work, not passing vacuously.
--
-- Pattern (same as packages/db/tests/force_safe_patient_order_insert_defaults.sql):
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session — running as the connecting superuser
-- would silently bypass RLS via table ownership.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table llr_result(
  check_name text,
  actor      text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- Declared at top level, not inside a DO block — CREATE TABLE followed by
-- immediate use of that table in the same PL/pgSQL execution is exactly the
-- kind of thing SPI plan caching can trip over; every DO block below only
-- INSERTs into / SELECTs from this, never creates it.
create temporary table llr_fixture(k text primary key, v uuid) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixtures: two patients, one org-staff clinician, a fresh lab provider with
-- two branches (so a location-mismatch attempt has a real second location to
-- point at), a self-bookable bundle already in the catalogue, and three
-- lab_orders rows (patient A resulted, patient A not-yet-resulted, patient B
-- resulted).
-- ---------------------------------------------------------------------------
do $$
declare
  v_org               uuid;
  v_patient_a         uuid := gen_random_uuid();
  v_patient_b         uuid := gen_random_uuid();
  v_staff             uuid := gen_random_uuid();
  v_staff_row         uuid;
  v_caregiver_ok      uuid := gen_random_uuid();
  v_caregiver_no_perm uuid := gen_random_uuid();
  v_provider          uuid;
  v_location          uuid;
  v_location_2        uuid;
  v_bundle            uuid;
  v_test_code_1       text := 'llr_test_' || substr(md5(random()::text), 1, 8);
  v_test_code_2       text := 'llr_test_' || substr(md5(random()::text), 1, 8);
  v_order_a_ok        uuid;
  v_order_a_ok2        uuid;
  v_order_a_open      uuid;
  v_order_a_no_loc    uuid;
  v_order_a_cg_set    uuid;
  v_order_a_cg_review uuid;
  v_order_b_ok        uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  select id into v_bundle from public.panel_bundles where self_bookable limit 1;
  if v_bundle is null then
    raise exception 'no self_bookable panel_bundle available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient_a, 'llr-patient-a@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient_b, 'llr-patient-b@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff,     'llr-staff@example.invalid',     'x', now(), '{}', '{}'),
    (v_caregiver_ok,      'llr-caregiver-ok@example.invalid',      'x', now(), '{}', '{}'),
    (v_caregiver_no_perm, 'llr-caregiver-no-perm@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, sex)
  values
    (v_patient_a, v_org, 'patient', 'LLR Patient A', date '1980-01-01', 'female'),
    (v_patient_b, v_org, 'patient', 'LLR Patient B', date '1985-01-01', 'male'),
    (v_caregiver_ok,      v_org, 'patient', 'LLR Caregiver OK', date '1970-01-01', 'female'),
    (v_caregiver_no_perm, v_org, 'patient', 'LLR Caregiver No Perm', date '1970-01-01', 'male')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = 'patient',
        date_of_birth = excluded.date_of_birth, sex = excluded.sex;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_staff, v_org, 'clinician', 'LLR Clinician')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = 'clinician';

  insert into public.clinical_staff
    (profile_id, organisation_id, active, doctor_tier, full_name, license_verified_at)
  values (v_staff, v_org, true, 'medical_officer', 'LLR Clinician', now())
  returning id into v_staff_row;

  -- v_caregiver_ok genuinely may act for patient A on booking/logistics
  -- actions (book_appointments is present in the permissions array);
  -- v_caregiver_no_perm has a 'manage' grant too but WITHOUT
  -- book_appointments, so it proves can_act_for's permission check is
  -- actually consulted, not just the presence of any grant at all.
  insert into public.profile_access
    (profile_id, grantee_user_id, permission_level, granted_by, permissions)
  values
    (v_patient_a, v_caregiver_ok,      'manage', v_patient_a, array['book_appointments']::public.caregiver_permission[]),
    (v_patient_a, v_caregiver_no_perm, 'manage', v_patient_a, array['view_results']::public.caregiver_permission[]);

  insert into public.lab_providers (name, is_active) values ('LLR Fixture Lab', true)
  returning id into v_provider;

  insert into public.lab_provider_locations (lab_provider_id, name, state, address, is_active)
  values (v_provider, 'LLR Fixture Branch 1', 'Lagos', '1 Fixture Road', true)
  returning id into v_location;

  insert into public.lab_provider_locations (lab_provider_id, name, state, address, is_active)
  values (v_provider, 'LLR Fixture Branch 2', 'Lagos', '2 Fixture Road', true)
  returning id into v_location_2;

  -- Two active tests on the fixture provider — the minimum needed to
  -- reproduce the list_lab_test_locations row-fan-out bug fixed in this
  -- migration (a non-lateral join against lab_tests, filtered only by
  -- provider/is_active, matched every active test row per location
  -- whenever p_test_code was null; section 16 below asserts exactly one
  -- row per location, not two).
  insert into public.lab_tests (provider_id, code, name, price_kobo, is_active)
  values
    (v_provider, v_test_code_1, 'LLR Fixture Test 1', 100000, true),
    (v_provider, v_test_code_2, 'LLR Fixture Test 2', 150000, true);

  -- lab_orders_force_safe_patient_insert (private.force_safe_patient_lab_order_insert)
  -- is a BEFORE INSERT trigger that forces status/transmission to safe
  -- defaults for any insert it doesn't recognise as private.is_org_staff —
  -- which includes this fixture-building block, since no JWT session is
  -- simulated yet at this point. It only guards INSERT, not UPDATE, so a
  -- plain follow-up UPDATE (confirmed against this project before writing
  -- this test) is what actually lands 'resulted'.
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, location_id)
  values (v_org, v_patient_a, v_bundle, 'resulted', v_location)
  returning id into v_order_a_ok;
  update public.lab_orders set status = 'resulted' where id = v_order_a_ok;

  -- A second, still-unreviewed resulted order for patient A, at the same
  -- real location as order_a_ok — needed to isolate the location-mismatch
  -- check on its own: order_a_ok already carries the section-1 review by
  -- the time section 5 runs, and order_a_open is still 'ordered', so either
  -- one alone would fail for a DIFFERENT reason and prove nothing about the
  -- location comparison specifically.
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, location_id)
  values (v_org, v_patient_a, v_bundle, 'resulted', v_location)
  returning id into v_order_a_ok2;
  update public.lab_orders set status = 'resulted' where id = v_order_a_ok2;

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, location_id)
  values (v_org, v_patient_a, v_bundle, 'ordered', v_location)
  returning id into v_order_a_open;

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, location_id)
  values (v_org, v_patient_b, v_bundle, 'resulted', v_location)
  returning id into v_order_b_ok;
  update public.lab_orders set status = 'resulted' where id = v_order_b_ok;

  -- Resulted, no location ever recorded — the "forgot to record a branch
  -- before the result landed" case: set_lab_order_location must still
  -- allow a first-time set here even though status is already 'resulted'.
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, location_id)
  values (v_org, v_patient_a, v_bundle, 'resulted', null)
  returning id into v_order_a_no_loc;
  update public.lab_orders set status = 'resulted' where id = v_order_a_no_loc;

  -- Still 'ordered', no location — the caregiver acting-for target for
  -- set_lab_order_location itself.
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, location_id)
  values (v_org, v_patient_a, v_bundle, 'ordered', null)
  returning id into v_order_a_cg_set;

  -- Resulted, no location — the caregiver acting-for target for the full
  -- set-location-then-review flow.
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, location_id)
  values (v_org, v_patient_a, v_bundle, 'resulted', null)
  returning id into v_order_a_cg_review;
  update public.lab_orders set status = 'resulted' where id = v_order_a_cg_review;

  insert into llr_fixture values
    ('org', v_org), ('patient_a', v_patient_a), ('patient_b', v_patient_b),
    ('staff_profile', v_staff), ('location', v_location), ('location_2', v_location_2),
    ('caregiver_ok', v_caregiver_ok), ('caregiver_no_perm', v_caregiver_no_perm),
    ('order_a_ok', v_order_a_ok), ('order_a_ok2', v_order_a_ok2),
    ('order_a_open', v_order_a_open), ('order_b_ok', v_order_b_ok),
    ('order_a_no_loc', v_order_a_no_loc), ('order_a_cg_set', v_order_a_cg_set),
    ('order_a_cg_review', v_order_a_cg_review);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Legitimate review: patient A reviews their own completed, matching-
--    location order. Must succeed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_order uuid; v_location uuid; v_org uuid; v_review uuid;
  v_rating smallint; v_comment text;
begin
  -- All fixture lookups happen here, before the role switch below — a temp
  -- table created by the connecting superuser has no grant to
  -- `authenticated`, so a query against llr_fixture while impersonating a
  -- patient session fails with a plain permission-denied error.
  select v into v_patient  from llr_fixture where k = 'patient_a';
  select v into v_order    from llr_fixture where k = 'order_a_ok';
  select v into v_location from llr_fixture where k = 'location';
  select v into v_org      from llr_fixture where k = 'org';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating, comment)
  values (v_org, v_patient, v_order, v_location, 5, 'Great service, short wait')
  returning id into v_review;

  reset role;

  select rating, comment into v_rating, v_comment from public.lab_location_reviews where id = v_review;

  insert into llr_result values
    ('legitimate review succeeds', 'patient_a', v_rating::text, '5',
     case when v_rating = 5 and v_comment = 'Great service, short wait' then 'PASS' else 'FAIL' end);
  if v_rating is distinct from 5 then
    raise exception 'BROKEN: the legitimate review path no longer works (rating=%)', v_rating;
  end if;

  insert into llr_fixture values ('review_a', v_review);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Second review on the same order: rejected by the lab_order_id UNIQUE
--    constraint (one review per completed visit).
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_order uuid; v_location uuid; v_org uuid;
  v_failed boolean := false;
begin
  select v into v_patient  from llr_fixture where k = 'patient_a';
  select v into v_order    from llr_fixture where k = 'order_a_ok';
  select v into v_location from llr_fixture where k = 'location';
  select v into v_org      from llr_fixture where k = 'org';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating)
    values (v_org, v_patient, v_order, v_location, 1);
  exception when unique_violation then
    v_failed := true;
  end;

  reset role;

  insert into llr_result values
    ('duplicate review on same order is rejected', 'patient_a', v_failed::text, 'true',
     case when v_failed then 'PASS' else 'FAIL' end);
  if not v_failed then
    raise exception 'HOLE OPEN: a patient filed a second review on an already-reviewed order';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cross-patient attack: patient B claims patient A's completed order.
--    Rejected — the EXISTS ownership check in the INSERT policy fails
--    because lo.patient_id (A) does not match auth.uid() (B).
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_order uuid; v_location uuid; v_org uuid;
  v_failed boolean := false;
begin
  select v into v_patient  from llr_fixture where k = 'patient_b';
  select v into v_order    from llr_fixture where k = 'order_a_ok';
  select v into v_location from llr_fixture where k = 'location';
  select v into v_org      from llr_fixture where k = 'org';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating)
    values (v_org, v_patient, v_order, v_location, 1);
  exception when insufficient_privilege or others then
    v_failed := true;
  end;

  reset role;

  insert into llr_result values
    ('cross-patient review on someone else''s order is rejected', 'patient_b', v_failed::text, 'true',
     case when v_failed then 'PASS' else 'FAIL' end);
  if not v_failed then
    raise exception 'HOLE OPEN: patient B filed a review against patient A''s lab order';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Not-yet-completed order: rejected — status is 'ordered', not 'resulted'.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_order uuid; v_location uuid; v_org uuid;
  v_failed boolean := false;
begin
  select v into v_patient  from llr_fixture where k = 'patient_a';
  select v into v_order    from llr_fixture where k = 'order_a_open';
  select v into v_location from llr_fixture where k = 'location';
  select v into v_org      from llr_fixture where k = 'org';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating)
    values (v_org, v_patient, v_order, v_location, 3);
  exception when insufficient_privilege or others then
    v_failed := true;
  end;

  reset role;

  insert into llr_result values
    ('review on a not-yet-resulted order is rejected', 'patient_a', v_failed::text, 'true',
     case when v_failed then 'PASS' else 'FAIL' end);
  if not v_failed then
    raise exception 'HOLE OPEN: patient A reviewed a lab order that never reached resulted';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Location mismatch: the order really is patient A's and resulted, but
--    the claimed location_id is a different branch than the order recorded.
--    Rejected.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_order uuid; v_location_2 uuid; v_org uuid;
  v_failed boolean := false;
begin
  select v into v_patient    from llr_fixture where k = 'patient_a';
  -- Deliberately order_a_ok2, not order_a_open: it has to be a genuinely
  -- 'resulted' order so this isolates the location comparison specifically,
  -- not the status check section 4 already covers.
  select v into v_order      from llr_fixture where k = 'order_a_ok2';
  select v into v_location_2 from llr_fixture where k = 'location_2';
  select v into v_org        from llr_fixture where k = 'org';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating)
    values (v_org, v_patient, v_order, v_location_2, 4);
  exception when insufficient_privilege or others then
    v_failed := true;
  end;

  reset role;

  insert into llr_result values
    ('location mismatch against the order''s own recorded branch is rejected', 'patient_a', v_failed::text, 'true',
     case when v_failed then 'PASS' else 'FAIL' end);
  if not v_failed then
    raise exception 'HOLE OPEN: a review was filed for a branch that does not match its lab order''s location';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Raw-row SELECT: patient B cannot read patient A's review; org staff can.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient_b uuid; v_staff uuid; v_review uuid;
  v_seen_by_b boolean; v_seen_by_staff boolean;
begin
  select v into v_patient_b from llr_fixture where k = 'patient_b';
  select v into v_staff     from llr_fixture where k = 'staff_profile';
  select v into v_review    from llr_fixture where k = 'review_a';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_seen_by_b := exists (select 1 from public.lab_location_reviews where id = v_review);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_seen_by_staff := exists (select 1 from public.lab_location_reviews where id = v_review);
  reset role;

  insert into llr_result values
    ('non-author patient cannot read the raw review row', 'patient_b', v_seen_by_b::text, 'false',
     case when not v_seen_by_b then 'PASS' else 'FAIL' end);
  insert into llr_result values
    ('org staff can read the raw review row', 'staff', v_seen_by_staff::text, 'true',
     case when v_seen_by_staff then 'PASS' else 'FAIL' end);

  if v_seen_by_b then
    raise exception 'HOLE OPEN: patient B read patient A''s review row directly';
  end if;
  if not v_seen_by_staff then
    raise exception 'BROKEN: org staff cannot read a review for moderation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Public directory read: list_lab_location_reviews surfaces the review to
--    patient B (who cannot read the raw row), and list_lab_test_locations'
--    aggregate reflects the one visible review on this fixture location.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient_b uuid; v_location uuid; v_review uuid;
  v_found boolean; v_avg numeric; v_count int;
begin
  select v into v_patient_b from llr_fixture where k = 'patient_b';
  select v into v_location  from llr_fixture where k = 'location';
  select v into v_review    from llr_fixture where k = 'review_a';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_found := exists (select 1 from public.list_lab_location_reviews(v_location, 20) t where t.id = v_review);
  reset role;

  insert into llr_result values
    ('public directory read surfaces the review to a non-author', 'patient_b', v_found::text, 'true',
     case when v_found then 'PASS' else 'FAIL' end);
  if not v_found then
    raise exception 'BROKEN: list_lab_location_reviews did not surface a visible review';
  end if;

  select t.avg_rating, t.review_count into v_avg, v_count
  from public.list_lab_test_locations(null, null) t
  where t.location_id = v_location;

  insert into llr_result values
    ('list_lab_test_locations aggregate reflects the one visible review', 'system',
     format('avg=%s count=%s', v_avg, v_count), 'avg=5.0 count=1',
     case when v_avg = 5.0 and v_count = 1 then 'PASS' else 'FAIL' end);
  if v_avg is distinct from 5.0 or v_count is distinct from 1 then
    raise exception 'BROKEN: list_lab_test_locations aggregate is %/% for a fixture with exactly one 5-star visible review', v_avg, v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Reporting: patient B flags the review; the report is invisible to
--    patient B but visible to staff; a duplicate flag from the same
--    reporter is absorbed, not duplicated; an empty reason is rejected.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient_b uuid; v_staff uuid; v_review uuid;
  v_report_count_as_b int; v_report_count_as_staff int; v_report_rows_total int;
  v_empty_reason_failed boolean := false;
begin
  select v into v_patient_b from llr_fixture where k = 'patient_b';
  select v into v_staff     from llr_fixture where k = 'staff_profile';
  select v into v_review    from llr_fixture where k = 'review_a';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.report_lab_location_review(v_review, 'This looks like a fake review');
  perform public.report_lab_location_review(v_review, 'Reporting again, same person'); -- duplicate, absorbed
  begin
    perform public.report_lab_location_review(v_review, '');
  exception when others then
    v_empty_reason_failed := true;
  end;
  select count(*) into v_report_count_as_b from public.lab_location_review_reports where review_id = v_review;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_report_count_as_staff from public.lab_location_review_reports where review_id = v_review;
  reset role;

  select count(*) into v_report_rows_total from public.lab_location_review_reports where review_id = v_review;

  insert into llr_result values
    ('reporter cannot read the report row directly', 'patient_b', v_report_count_as_b::text, '0',
     case when v_report_count_as_b = 0 then 'PASS' else 'FAIL' end);
  insert into llr_result values
    ('staff can read the report row', 'staff', v_report_count_as_staff::text, '1',
     case when v_report_count_as_staff = 1 then 'PASS' else 'FAIL' end);
  insert into llr_result values
    ('duplicate report from the same reporter is absorbed, not duplicated', 'system', v_report_rows_total::text, '1',
     case when v_report_rows_total = 1 then 'PASS' else 'FAIL' end);
  insert into llr_result values
    ('reporting with an empty reason is rejected', 'patient_b', v_empty_reason_failed::text, 'true',
     case when v_empty_reason_failed then 'PASS' else 'FAIL' end);

  if v_report_count_as_b <> 0 then
    raise exception 'HOLE OPEN: a reporter can read their own report row directly (%)', v_report_count_as_b;
  end if;
  if v_report_count_as_staff <> 1 then
    raise exception 'BROKEN: staff cannot see a filed report';
  end if;
  if v_report_rows_total <> 1 then
    raise exception 'HOLE OPEN: report_lab_location_review created a duplicate row for the same reporter (%)', v_report_rows_total;
  end if;
  if not v_empty_reason_failed then
    raise exception 'HOLE OPEN: report_lab_location_review accepted an empty reason';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Moderation: a non-staff/non-admin patient cannot hide someone else's
--    review; staff can, and the hidden review then drops out of the public
--    directory read while the author can still see it on their own account.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient_b uuid; v_patient_a uuid; v_staff uuid; v_review uuid; v_location uuid;
  v_rows_updated int;
  v_patient_hide_failed boolean;
  v_found_by_a boolean; v_found_in_directory boolean;
begin
  select v into v_patient_b from llr_fixture where k = 'patient_b';
  select v into v_patient_a from llr_fixture where k = 'patient_a';
  select v into v_staff     from llr_fixture where k = 'staff_profile';
  select v into v_review    from llr_fixture where k = 'review_a';
  select v into v_location  from llr_fixture where k = 'location';

  -- RLS on UPDATE never raises for a USING-clause mismatch — it just matches
  -- zero rows, so the assertion has to be on ROW_COUNT, not on an exception.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_location_reviews
  set status = 'hidden', hidden_by = v_patient_b, hidden_at = now(), hidden_reason = 'spite'
  where id = v_review;
  get diagnostics v_rows_updated = ROW_COUNT;
  reset role;

  v_patient_hide_failed := (v_rows_updated = 0);

  insert into llr_result values
    ('non-staff patient cannot hide another patient''s review', 'patient_b',
     v_patient_hide_failed::text, 'true',
     case when v_patient_hide_failed then 'PASS' else 'FAIL' end);
  if not v_patient_hide_failed then
    raise exception 'HOLE OPEN: patient B hid patient A''s review';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_location_reviews
  set status = 'hidden', hidden_by = v_staff, hidden_at = now(), hidden_reason = 'confirmed abusive'
  where id = v_review;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_found_by_a := exists (select 1 from public.lab_location_reviews where id = v_review and status = 'hidden');
  v_found_in_directory := exists (select 1 from public.list_lab_location_reviews(v_location, 20) t where t.id = v_review);
  reset role;

  insert into llr_result values
    ('staff-hidden review still readable by its own author', 'patient_a', v_found_by_a::text, 'true',
     case when v_found_by_a then 'PASS' else 'FAIL' end);
  insert into llr_result values
    ('staff-hidden review drops out of the public directory read', 'patient_a', v_found_in_directory::text, 'false',
     case when not v_found_in_directory then 'PASS' else 'FAIL' end);

  if not v_found_by_a then
    raise exception 'BROKEN: the review''s own author can no longer see their (now-hidden) review';
  end if;
  if v_found_in_directory then
    raise exception 'HOLE OPEN: a staff-hidden review is still surfaced by list_lab_location_reviews';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Write-once: set_lab_order_location refuses to change the branch on an
--     order that is both 'resulted' and already has a location recorded.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_order uuid; v_location_2 uuid;
  v_failed boolean := false;
begin
  select v into v_patient    from llr_fixture where k = 'patient_a';
  select v into v_order      from llr_fixture where k = 'order_a_ok';
  select v into v_location_2 from llr_fixture where k = 'location_2';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_lab_order_location(v_order, v_location_2);
  exception when others then
    v_failed := true;
  end;
  reset role;

  insert into llr_result values
    ('write-once: changing branch after resulted+set is rejected', 'patient_a', v_failed::text, 'true',
     case when v_failed then 'PASS' else 'FAIL' end);
  if not v_failed then
    raise exception 'HOLE OPEN: patient A changed order_a_ok''s branch after it was resulted and already set';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. First-time set is still allowed after 'resulted' when no branch was
--     ever recorded — this is what unlocks reviewing for a patient who
--     forgot to record one earlier. Must not be blocked by section 10's
--     write-once guard.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_order uuid; v_location uuid;
  v_succeeded boolean := false;
  v_set_location uuid;
begin
  select v into v_patient  from llr_fixture where k = 'patient_a';
  select v into v_order    from llr_fixture where k = 'order_a_no_loc';
  select v into v_location from llr_fixture where k = 'location';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_lab_order_location(v_order, v_location);
    v_succeeded := true;
  exception when others then
    v_succeeded := false;
  end;
  reset role;

  select location_id into v_set_location from public.lab_orders where id = v_order;

  insert into llr_result values
    ('first-time branch set on an already-resulted order succeeds', 'patient_a',
     v_succeeded::text, 'true',
     case when v_succeeded and v_set_location = v_location then 'PASS' else 'FAIL' end);
  if not v_succeeded or v_set_location is distinct from v_location then
    raise exception 'BROKEN: a patient who never recorded a branch cannot set one even after resulted (succeeded=%, set=%)', v_succeeded, v_set_location;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Caregiver without book_appointments permission cannot set a branch on
--     the dependent's order — proves can_act_for's permission array is
--     actually consulted, not just the presence of a 'manage' grant.
-- ---------------------------------------------------------------------------
do $$
declare
  v_caregiver uuid; v_order uuid; v_location uuid;
  v_failed boolean := false;
begin
  select v into v_caregiver from llr_fixture where k = 'caregiver_no_perm';
  select v into v_order     from llr_fixture where k = 'order_a_cg_set';
  select v into v_location  from llr_fixture where k = 'location';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_caregiver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_lab_order_location(v_order, v_location);
  exception when others then
    v_failed := true;
  end;
  reset role;

  insert into llr_result values
    ('caregiver without book_appointments cannot set a branch', 'caregiver_no_perm', v_failed::text, 'true',
     case when v_failed then 'PASS' else 'FAIL' end);
  if not v_failed then
    raise exception 'HOLE OPEN: a caregiver with no book_appointments grant set a branch on patient A''s order';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 13. Caregiver WITH book_appointments can set a branch on the dependent's
--     order, and can later submit a review attributed to the dependent
--     (patient_id stays the real patient, never the caregiver) — the fix
--     for the cross-file-tracer finding that this feature silently broke
--     for every "acting for" session (dashboard-context.ts's subjectId
--     flows straight into these components with no other gate).
-- ---------------------------------------------------------------------------
do $$
declare
  v_caregiver uuid; v_patient uuid; v_org uuid; v_location uuid;
  v_order_set uuid; v_order_review uuid;
  v_set_succeeded boolean := false;
  v_review_id uuid;
  v_review_patient uuid;
begin
  select v into v_caregiver    from llr_fixture where k = 'caregiver_ok';
  select v into v_patient      from llr_fixture where k = 'patient_a';
  select v into v_org          from llr_fixture where k = 'org';
  select v into v_location     from llr_fixture where k = 'location';
  select v into v_order_set    from llr_fixture where k = 'order_a_cg_set';
  select v into v_order_review from llr_fixture where k = 'order_a_cg_review';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_caregiver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_lab_order_location(v_order_set, v_location);
    v_set_succeeded := true;
  exception when others then
    v_set_succeeded := false;
  end;

  perform public.set_lab_order_location(v_order_review, v_location);

  insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating, comment)
  values (v_org, v_patient, v_order_review, v_location, 5, 'Caregiver-filed, on my mother''s behalf')
  returning id into v_review_id;
  reset role;

  select patient_id into v_review_patient from public.lab_location_reviews where id = v_review_id;

  insert into llr_result values
    ('caregiver with book_appointments sets a branch for the dependent', 'caregiver_ok',
     v_set_succeeded::text, 'true',
     case when v_set_succeeded then 'PASS' else 'FAIL' end);
  insert into llr_result values
    ('caregiver-filed review is attributed to the dependent, not the caregiver', 'caregiver_ok',
     v_review_patient::text, v_patient::text,
     case when v_review_patient = v_patient then 'PASS' else 'FAIL' end);

  if not v_set_succeeded then
    raise exception 'BROKEN: a caregiver with book_appointments could not set a branch on the dependent''s order';
  end if;
  if v_review_patient is distinct from v_patient then
    raise exception 'HOLE OPEN: a caregiver-filed review is attributed to % instead of the real patient %', v_review_patient, v_patient;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 14. Caregiver without book_appointments cannot submit a review on the
--     dependent's behalf either (order_a_ok2 is resulted, location set, and
--     still unreviewed — section 5's rejected mismatch attempt never
--     created a row against it).
-- ---------------------------------------------------------------------------
do $$
declare
  v_caregiver uuid; v_patient uuid; v_org uuid; v_location uuid; v_order uuid;
  v_failed boolean := false;
begin
  select v into v_caregiver from llr_fixture where k = 'caregiver_no_perm';
  select v into v_patient   from llr_fixture where k = 'patient_a';
  select v into v_org       from llr_fixture where k = 'org';
  select v into v_location  from llr_fixture where k = 'location';
  select v into v_order     from llr_fixture where k = 'order_a_ok2';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_caregiver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating)
    values (v_org, v_patient, v_order, v_location, 1);
  exception when insufficient_privilege or others then
    v_failed := true;
  end;
  reset role;

  insert into llr_result values
    ('caregiver without book_appointments cannot file a review for the dependent', 'caregiver_no_perm',
     v_failed::text, 'true',
     case when v_failed then 'PASS' else 'FAIL' end);
  if not v_failed then
    raise exception 'HOLE OPEN: a caregiver with no book_appointments grant filed a review for patient A';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 15. Moderation-only UPDATE trigger: staff can hide a review (proven in
--     section 9) but cannot rewrite its rating/comment content — the
--     trigger this migration adds specifically to close that gap, since a
--     plain WITH CHECK role gate can't express "only these columns".
-- ---------------------------------------------------------------------------
do $$
declare
  v_staff uuid; v_review uuid;
  v_rows_updated int;
  v_content_change_failed boolean;
begin
  select v into v_staff  from llr_fixture where k = 'staff_profile';
  select v into v_review from llr_fixture where k = 'review_a';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.lab_location_reviews set rating = 1 where id = v_review;
    get diagnostics v_rows_updated = ROW_COUNT;
    v_content_change_failed := (v_rows_updated = 0);
  exception when others then
    v_content_change_failed := true;
  end;
  reset role;

  insert into llr_result values
    ('staff cannot rewrite a review''s rating via UPDATE', 'staff', v_content_change_failed::text, 'true',
     case when v_content_change_failed then 'PASS' else 'FAIL' end);
  if not v_content_change_failed then
    raise exception 'HOLE OPEN: staff changed a filed review''s rating via a plain UPDATE';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 16. list_lab_test_locations returns each active branch exactly once when
--     called with no test code, even though the fixture provider has two
--     active lab_tests rows — the fan-out bug this migration's LATERAL
--     rewrite fixes (a plain, non-lateral join against lab_tests matched
--     every active test row per location whenever p_test_code was null).
-- ---------------------------------------------------------------------------
do $$
declare
  v_location uuid;
  v_row_count int;
begin
  select v into v_location from llr_fixture where k = 'location';

  select count(*) into v_row_count
  from public.list_lab_test_locations(null, null) t
  where t.location_id = v_location;

  insert into llr_result values
    ('list_lab_test_locations returns one row per branch, not one per test', 'system',
     v_row_count::text, '1',
     case when v_row_count = 1 then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 then
    raise exception 'HOLE OPEN: list_lab_test_locations(null,null) returned % rows for one branch (fixture provider has 2 active lab_tests) — the fan-out bug is back', v_row_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 17. SABOTAGE — weaken the INSERT policy's WITH CHECK to drop the
--     ownership/status/location EXISTS clause, re-run the section-3 attack
--     (patient B claiming patient A's order), and confirm it now succeeds.
--     If it didn't, section 3's PASS proved nothing. Restore the real
--     policy afterwards regardless of outcome.
-- ---------------------------------------------------------------------------
-- ALTER POLICY runs as a plain top-level statement, not inside the DO block
-- below — deliberately, to avoid any question of DDL-inside-PL/pgSQL plan
-- caching. The attack attempt and its bookkeeping are the only things
-- inside a DO block; the policy is weakened immediately before it and
-- restored immediately after, both as bare statements.
alter policy lab_location_reviews_insert on public.lab_location_reviews
  with check (patient_id = (select auth.uid()));

do $$
declare
  v_patient uuid; v_order uuid; v_location uuid; v_org uuid; v_id uuid;
  v_sabotage_succeeded boolean := false;
begin
  select v into v_patient  from llr_fixture where k = 'patient_b';
  -- order_a_ok already carries the section-1 review (UNIQUE lab_order_id
  -- would reject a second one regardless of RLS and make this inconclusive)
  -- — order_a_open is still patient A's order and still unreviewed, so it's
  -- the right target: the weakened policy only checks patient_id, not
  -- ownership/status/location, so it should let this through regardless of
  -- order_a_open's own status or owner.
  select v into v_order    from llr_fixture where k = 'order_a_open';
  select v into v_location from llr_fixture where k = 'location';
  select v into v_org      from llr_fixture where k = 'org';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.lab_location_reviews (organisation_id, patient_id, lab_order_id, location_id, rating)
    values (v_org, v_patient, v_order, v_location, 1)
    returning id into v_id;
    v_sabotage_succeeded := true;
  exception when others then
    v_sabotage_succeeded := false;
  end;
  reset role;

  if v_sabotage_succeeded then
    delete from public.lab_location_reviews where id = v_id;
  end if;

  insert into llr_result values
    ('SABOTAGE: with the check weakened, the cross-patient attack now succeeds',
     'patient_b', v_sabotage_succeeded::text, 'true',
     case when v_sabotage_succeeded then 'PASS' else 'FAIL' end);
  if not v_sabotage_succeeded then
    raise exception 'VACUOUS TEST: with the ownership/status/location check removed, the attack still did not reproduce — section 3 proves nothing';
  end if;
end $$;

-- Restore the real policy — a bare statement for the same DDL-inside-
-- PL/pgSQL reason as above. If the DO block above raised (the vacuous-test
-- case), this line is never reached and the surrounding ROLLBACK discards
-- the weakened policy anyway, so the live policy is never left weakened.
-- Must match the migration's own current text exactly (including the
-- caregiver can_act_for clause and the private.lab_order_matches_review
-- definer-function check) or this "restore" would itself downgrade the
-- live policy for the remainder of the session.
alter policy lab_location_reviews_insert on public.lab_location_reviews
  with check (
    (
      patient_id = (select auth.uid())
      or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission)
    )
    and private.lab_order_matches_review(lab_order_id, patient_id, location_id, organisation_id)
  );

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------
do $$
declare
  v_fail_count int;
  r record;
begin
  raise notice '--- lab_location_reviews_rls results ---';
  for r in select * from llr_result order by check_name loop
    raise notice '[%] % (actor=%, observed=%, expected=%)', r.verdict, r.check_name, r.actor, r.observed, r.expected;
  end loop;

  select count(*) into v_fail_count from llr_result where verdict = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% check(s) failed — see notices above', v_fail_count;
  end if;
end $$;

rollback;

