-- ===========================================================================
-- Verification: Preventive Health Check Review SKU
-- (20260922185300_preventive_health_check_review_sku.sql).
--
-- Standing regression coverage per CLAUDE.md's Definition of Done, beyond
-- the migration's own inline self-check. Proves:
--   * the product ships is_active = false (the real go-live blocker —
--     pending Clinical Director sign-off on prevention_intake — is a
--     genuine, live gate, not just a comment);
--   * consequently, a real purchase attempt via
--     record_service_purchase_intent is refused outright;
--   * private.request_preventive_health_check_review (the service_purchases
--     trigger) still works correctly once a purchase DOES reach 'active'
--     (an admin-granted comp today, or any purchase once the product is
--     switched on) — opens/finds the patient's current-year
--     annual_health_checks row and stamps review_requested_at;
--   * it is scoped to THIS product's feature: an unrelated active purchase
--     never sets review_requested_at (sabotage-equivalent — proves the
--     feature-array check actually discriminates, not that the trigger
--     fires on anything);
--   * a purchase that reaches 'active' for a patient who has NEVER opened
--     their free Health Check journey still gets a row opened for them
--     (the open_health_check()-equivalent half of the trigger).
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table phcr_fixture(k text primary key, v uuid) on commit drop;
create temporary table phcr_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_other_patient uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'phcr-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other_patient, 'phcr-other@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'PHCR Patient'), (v_other_patient, v_org, 'patient', 'PHCR Other Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into phcr_fixture values ('org', v_org), ('patient', v_patient), ('other_patient', v_other_patient);
end $$;

-- ==========================================================================
-- 1. The product ships is_active = false — a genuine, live purchase gate.
-- ==========================================================================
do $$
declare
  v_is_active boolean;
  v_error text;
  v_patient uuid := (select v from phcr_fixture where k = 'patient');
begin
  select is_active into v_is_active from public.service_products where code = 'preventive_health_check_review';
  insert into phcr_result values
    ('preventive_health_check_review ships is_active = false', v_is_active::text, 'false',
     case when v_is_active is false then 'PASS' else 'FAIL' end);
  if v_is_active is not false then
    raise exception 'FAIL: preventive_health_check_review should ship is_active = false pending Clinical Director sign-off';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.record_service_purchase_intent(v_patient, 'preventive_health_check_review');
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlerrm;
  end;

  insert into phcr_result values
    ('a real purchase attempt is refused while the product is inactive', v_error, 'is not available',
     case when v_error <> 'ACCEPTED' and position('is not available' in v_error) > 0 then 'PASS' else 'FAIL' end);
  if v_error = 'ACCEPTED' then
    raise exception 'HOLE OPEN: a purchase of the not-yet-signed-off preventive_health_check_review was accepted';
  end if;
end $$;

-- ==========================================================================
-- 2. The trigger itself: an active purchase (however it got there — an
--    admin comp today, since the product can't be bought normally yet)
--    opens/finds the patient's current-year check and stamps
--    review_requested_at, even for a patient who never opened the free
--    journey at all.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from phcr_fixture where k = 'org');
  v_patient uuid := (select v from phcr_fixture where k = 'patient');
  v_product uuid;
  v_year integer := extract(year from (now() at time zone 'Africa/Lagos'))::int;
  v_requested_at timestamptz;
  v_row_year integer;
begin
  select id into v_product from public.service_products where code = 'preventive_health_check_review';

  if exists (select 1 from public.annual_health_checks where patient_id = v_patient and year = v_year) then
    raise exception 'fixture setup FAIL: the fresh patient already has a Health Check row before any purchase';
  end if;

  insert into public.service_purchases
    (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_product, 'active', 1500000, 'NGN', now(), now() + interval '90 days');

  select review_requested_at, year into v_requested_at, v_row_year
    from public.annual_health_checks where patient_id = v_patient and year = v_year;

  insert into phcr_result values
    ('purchase opens a Health Check row for a patient who never started the free journey', v_row_year::text, v_year::text,
     case when v_row_year = v_year then 'PASS' else 'FAIL' end);
  if v_row_year is null then
    raise exception 'FAIL: the trigger did not open this year''s annual_health_checks row for a brand-new patient';
  end if;

  insert into phcr_result values
    ('purchase stamps review_requested_at', (v_requested_at is not null)::text, 'true',
     case when v_requested_at is not null then 'PASS' else 'FAIL' end);
  if v_requested_at is null then
    raise exception 'FAIL: an active preventive_health_check_review purchase did not set review_requested_at — the trigger is dead';
  end if;
end $$;

-- ==========================================================================
-- 3. Sabotage-equivalent: an UNRELATED active purchase (any other paid
--    product) for a different fresh patient must NEVER set
--    review_requested_at — proves the feature-array scoping discriminates,
--    it does not fire on any purchase reaching 'active'.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from phcr_fixture where k = 'org');
  v_other   uuid := (select v from phcr_fixture where k = 'other_patient');
  v_other_product uuid;
  v_year integer := extract(year from (now() at time zone 'Africa/Lagos'))::int;
  v_requested_at timestamptz;
  v_row_exists boolean;
begin
  select id into v_other_product from public.service_products
   where code <> 'preventive_health_check_review' and is_active and price_kobo > 0
   order by code limit 1;
  if v_other_product is null then
    raise notice 'SKIP: no other active priced product to test scoping against';
  else
    insert into public.service_purchases
      (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
    values
      (v_org, v_other, v_other_product, 'active', 250000, 'NGN', now(), now() + interval '90 days');

    select review_requested_at into v_requested_at
      from public.annual_health_checks where patient_id = v_other and year = v_year;
    v_row_exists := exists (select 1 from public.annual_health_checks where patient_id = v_other and year = v_year);

    insert into phcr_result values
      ('an unrelated product purchase never opens a Health Check row', v_row_exists::text, 'false',
       case when v_row_exists is false then 'PASS' else 'FAIL' end);
    if v_row_exists is true then
      raise exception 'HOLE OPEN: buying an unrelated product opened a Health Check row — the feature-array scoping is broken';
    end if;

    insert into phcr_result values
      ('an unrelated product purchase never sets review_requested_at', (v_requested_at is null)::text, 'true',
       case when v_requested_at is null then 'PASS' else 'FAIL' end);
    if v_requested_at is not null then
      raise exception 'HOLE OPEN: an unrelated product purchase set review_requested_at';
    end if;
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
select * from phcr_result order by check_name;

do $$
declare
  v_fails int;
begin
  select count(*) into v_fails from phcr_result where verdict not like 'PASS%';
  if v_fails > 0 then
    raise exception '% check(s) failed — see the result table above', v_fails;
  end if;
  raise notice 'PASS: Preventive Health Check Review SKU — inactive-product gate holds, trigger opens/scopes correctly, all % checks green', (select count(*) from phcr_result);
end $$;

rollback;
