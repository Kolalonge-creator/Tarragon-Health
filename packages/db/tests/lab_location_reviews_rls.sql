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
  v_org          uuid;
  v_patient_a    uuid := gen_random_uuid();
  v_patient_b    uuid := gen_random_uuid();
  v_staff        uuid := gen_random_uuid();
  v_staff_row    uuid;
  v_provider     uuid;
  v_location     uuid;
  v_location_2   uuid;
  v_bundle       uuid;
  v_order_a_ok   uuid;
  v_order_a_ok2  uuid;
  v_order_a_open uuid;
  v_order_b_ok   uuid;
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
    (v_staff,     'llr-staff@example.invalid',     'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, sex)
  values
    (v_patient_a, v_org, 'patient', 'LLR Patient A', date '1980-01-01', 'female'),
    (v_patient_b, v_org, 'patient', 'LLR Patient B', date '1985-01-01', 'male')
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

  insert into public.lab_providers (name, is_active) values ('LLR Fixture Lab', true)
  returning id into v_provider;

  insert into public.lab_provider_locations (lab_provider_id, name, state, address, is_active)
  values (v_provider, 'LLR Fixture Branch 1', 'Lagos', '1 Fixture Road', true)
  returning id into v_location;

  insert into public.lab_provider_locations (lab_provider_id, name, state, address, is_active)
  values (v_provider, 'LLR Fixture Branch 2', 'Lagos', '2 Fixture Road', true)
  returning id into v_location_2;

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

  insert into llr_fixture values
    ('org', v_org), ('patient_a', v_patient_a), ('patient_b', v_patient_b),
    ('staff_profile', v_staff), ('location', v_location), ('location_2', v_location_2),
    ('order_a_ok', v_order_a_ok), ('order_a_ok2', v_order_a_ok2),
    ('order_a_open', v_order_a_open), ('order_b_ok', v_order_b_ok);
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
-- 10. SABOTAGE — weaken the INSERT policy's WITH CHECK to drop the
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
alter policy lab_location_reviews_insert on public.lab_location_reviews
  with check (
    patient_id = (select auth.uid())
    and exists (
      select 1 from public.lab_orders lo
      where lo.id = lab_order_id
        and lo.patient_id = (select auth.uid())
        and lo.status = 'resulted'
        and lo.location_id = lab_location_reviews.location_id
        and lo.organisation_id = lab_location_reviews.organisation_id
    )
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

