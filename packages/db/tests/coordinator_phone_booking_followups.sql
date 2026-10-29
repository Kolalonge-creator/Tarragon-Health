-- Proof: coordinator phone booking follow-ups (migration *_coordinator_phone_booking_followups.sql).
--   1. A Free patient with no credit is refused for a paid item (upgrade_first). With an unspent credit the coordinator can hold it and
--      confirm spends the credit. An expired credit, a redeemed credit and a credit for a different item do not count.
--   2. SABOTAGE: with the credit check forced false the same Free patient with a fresh credit is refused (so the check is what lets them
--      through); forced true, a Free patient with NO credit holds (so the check is also what keeps the refusal). Both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date, p_sex text default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cpb-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, sex)
  values (v, p_org, p_role::public.user_role, 'CPB ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), p_dob, true, p_sex::public.sex)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth,
    full_name = excluded.full_name, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.open_time(p_clin uuid, p_start timestamptz) returns void language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_clin;
  if not exists (select 1 from public.availability_blocks where clinician_id = p_clin and kind = 'bookable_consultations' and state = 'confirmed' and is_test
                  and starts_at <= p_start and ends_at >= p_start + interval '30 minutes') then
    insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
    values (v_org, p_clin, p_start, p_start + interval '2 hours', 'bookable_consultations', 'confirmed', true);
  end if;
end $f$;
-- hold as `p_actor` for `p_patient`; returns the appointment id, or the error as text
create function pg_temp.hold_as(p_actor uuid, p_patient uuid, p_clinician uuid, p_start timestamptz) returns text language plpgsql as
$f$ declare v_org uuid; v_id uuid; v_hint text; v_msg text; v_state text;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  perform pg_temp.open_time(p_clinician, p_start);
  perform pg_temp.act(p_actor);
  begin
    select id into v_id from public.hold_appointment_slot(v_org, p_clinician, 'telemedicine'::public.appointment_type, 'telemedicine',
                                                          p_start, p_start + interval '30 minutes', null, null, null, null, null, p_patient);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text, v_state = returned_sqlstate;
    perform pg_temp.back();
    return 'ERR ' || v_state || ':' || v_msg || '|' || coalesce(v_hint, '');
  end;
  perform pg_temp.back();
  return v_id::text;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_coord uuid; v_free uuid; v_prod uuid; v_other uuid; v_code text;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_h text; v_cred uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', (current_date - interval '45 years')::date);
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician', (current_date - interval '40 years')::date, 'female');
  v_coord := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator', (current_date - interval '30 years')::date);
  v_free := pg_temp.mkuser(v_org, 'free-patient', 'patient', (current_date - interval '70 years')::date);
  update public.consultation_policy_config set config = config || '{"bookingLeadMinutes":5,"bookingHorizonDays":21}'::jsonb where is_active;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty,
                                     indemnity_exempt, indemnity_exempt_by, credential_type, credential_number, credential_verified_at, credential_verified_by, doctor_tier)
  values (v_org, v_doc, 'CPB doctor', true, true, array['en'], now() - interval '10 days', now() + interval '1 year', 'General practice', true, v_admin,
          'MDCN', 'MDCN/CPB-A', now() - interval '5 days', v_admin, 'senior_medical_officer');
  v_code := private.booking_product_code('telemedicine');
  select id into v_prod from public.service_products where code = v_code;
  select id into v_other from public.service_products where code = 'dietitian_consult_credit';

  -- no credit: refused
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start);
  perform pg_temp.rec('Free patient, no credit: refused (upgrade_first)', 'true', (v_h like 'ERR P0001:%|upgrade_first')::text);

  -- credits that do not count: expired, already redeemed, for a different item
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at, expires_at)
  values (v_org, v_free, v_prod, 'active', 100, 'NGN', 0, now() - interval '40 days', now() - interval '1 day');
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at, redeemed_at, redeemed_entity_type, redeemed_entity_id)
  values (v_org, v_free, v_prod, 'active', 100, 'NGN', 0, now() - interval '10 days', now() - interval '5 days', 'appointment', gen_random_uuid());
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  values (v_org, v_free, v_other, 'active', 100, 'NGN', 0, now());
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start);
  perform pg_temp.rec('an expired, a redeemed and a different-item credit do not let a Free patient through', 'true', (v_h like 'ERR P0001:%|upgrade_first')::text);

  -- a real unspent credit
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  values (v_org, v_free, v_prod, 'active', 100, 'NGN', 0, now()) returning id into v_cred;
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start);
  perform pg_temp.rec('Free patient WITH an unspent credit: the coordinator can hold the slot', 'true', (v_h !~ '^ERR')::text);
  perform pg_temp.act(v_coord);
  perform public.confirm_appointment_booking(v_h::uuid);
  perform pg_temp.back();
  perform pg_temp.rec('confirming spends that credit and confirms the booking', 'confirmed/paid',
    (select status::text || '/' || payment_status::text from public.appointments where id = v_h::uuid));
  perform pg_temp.rec('the credit is marked redeemed against the appointment', 'true',
    (select (redeemed_at is not null and redeemed_entity_id = v_h::uuid)::text from public.service_purchases where id = v_cred));
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start + interval '1 day');
  perform pg_temp.rec('with that credit spent the Free patient is refused again', 'true', (v_h like 'ERR P0001:%|upgrade_first')::text);

  -- SABOTAGE
  execute $s$ create or replace function private.has_available_service_credit(p_patient uuid, p_code text) returns boolean language sql stable security definer set search_path to '' as $b$ select false $b$ $s$;
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  values (v_org, v_free, v_prod, 'active', 100, 'NGN', 0, now());
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start + interval '2 days');
  perform pg_temp.rec('SABOTAGE credit check forced false: a Free patient with a fresh credit is refused (so the check is what lets them through)', 'true',
    (v_h like 'ERR P0001:%|upgrade_first')::text);
  execute $s$ create or replace function private.has_available_service_credit(p_patient uuid, p_code text) returns boolean language sql stable security definer set search_path to '' as $b$ select true $b$ $s$;
  update public.service_purchases set redeemed_at = now(), redeemed_entity_type = 'appointment', redeemed_entity_id = gen_random_uuid() where patient_id = v_free and redeemed_at is null;
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start + interval '3 days');
  perform pg_temp.rec('SABOTAGE credit check forced true: a Free patient with NO credit now holds (so the check is what keeps the refusal)', 'true', (v_h !~ '^ERR')::text);

  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'phone booking follow-ups proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'phone booking follow-ups: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
