-- Proof: Care Coordinator phone booking (migration *_coordinator_phone_booking.sql).
--
-- Proves in one rolled-back transaction:
--   1. coordinator_find_patient: a coordinator finds a patient of their own organisation by phone number or by name and gets name, state, phone
--      and tier only; every hit writes an audit line; a patient, a doctor and anon are refused; a query under 3 characters is refused.
--   2. A Free patient (no membership): a coordinator cannot hold a paid item for them (P0001, hint upgrade_first); the same patient booking
--      for themselves is not touched by that rule.
--   3. A Member: the coordinator's hold is stamped booked_via = coordinator_phone, booked_by = the coordinator; confirm with no credit
--      leaves it 'booked', payment pending, held about 24 hours (not the 30 minute hold).
--   4. Payment lands (the service purchase becomes active): the booking confirms with no session, becomes 'paid', carries an encounter, and the
--      transaction's claim is restored afterwards.
--   5. With a credit already held, the coordinator's booking confirms at once.
--   6. An unpaid phone booking is released after its 24 hours; a patient's own unpaid 'booked' appointment is left alone.
--   7. The patient's own booking is stamped 'self'.
--   4b. A credit inserted already active (sponsor credit, free product) confirms a waiting phone booking too.
--   8. SABOTAGE: tier lookup forced to return a tier (Free patient now holds); payment trigger disabled (booking does not confirm); the audit
--      logger made a no-op (the lookup must refuse, not show details unrecorded); coordinator role removed (the lookup is refused to nobody
--      else, so it must now fail for the same person). Each must flip, or the proof is vacuous.
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
  v_org uuid;
  v_admin uuid; v_doc uuid; v_coord uuid; v_free uuid; v_member uuid; v_phone text;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_h text; v_a uuid; v_row public.appointments%rowtype; v_json jsonb; v_res text;
  v_code text; v_prod uuid; v_purchase uuid; v_cnt integer; v_own uuid; v_soon timestamptz;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;

  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', (current_date - interval '45 years')::date);
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician', (current_date - interval '40 years')::date, 'female');
  v_coord := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator', (current_date - interval '30 years')::date);
  v_free := pg_temp.mkuser(v_org, 'free-patient', 'patient', (current_date - interval '70 years')::date);
  v_member := pg_temp.mkuser(v_org, 'member-patient', 'patient', (current_date - interval '68 years')::date);
  update public.profiles set state = 'Lagos' where id in (v_free, v_member);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (v_org, v_member, 'purchase', 'active', true);

  update public.consultation_policy_config set config = config || '{"bookingLeadMinutes":5,"bookingHorizonDays":21}'::jsonb where is_active;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty,
                                     indemnity_exempt, indemnity_exempt_by, credential_type, credential_number, credential_verified_at, credential_verified_by, doctor_tier)
  values (v_org, v_doc, 'CPB doctor', true, true, array['en'], now() - interval '10 days', now() + interval '1 year', 'General practice', true, v_admin,
          'MDCN', 'MDCN/CPB-A', now() - interval '5 days', v_admin, 'senior_medical_officer');

  v_code := private.booking_product_code('telemedicine');
  select id into v_prod from public.service_products where code = v_code;
  perform pg_temp.rec('the doctor visit has a service product to pay for', 'true', (v_prod is not null)::text);

  -- ===== 1. the lookup =====
  select phone into v_phone from public.profiles where id = v_member;
  perform pg_temp.act(v_coord);
  select to_jsonb(r) into v_json from public.coordinator_find_patient(v_phone) r limit 1;
  perform pg_temp.back();
  perform pg_temp.rec('lookup by phone finds the patient', v_member::text, v_json ->> 'patient_id');
  perform pg_temp.rec('lookup returns exactly name, state, phone and tier', 'full_name,membership_tier,patient_id,phone,state',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_json) k));
  perform pg_temp.rec('lookup shows the state', 'Lagos', v_json ->> 'state');
  perform pg_temp.rec('lookup shows the member tier', 'true', (v_json ->> 'membership_tier' is not null)::text);
  perform pg_temp.act(v_coord);
  select to_jsonb(r) into v_json from public.coordinator_find_patient('CPB free-patient') r limit 1;
  perform pg_temp.back();
  perform pg_temp.rec('lookup by name finds a Free patient, tier null', v_free::text || '/null', (v_json ->> 'patient_id') || '/' || coalesce(v_json ->> 'membership_tier', 'null'));
  perform pg_temp.rec('the lookup is audited against the patient and the coordinator', '1',
    (select count(*)::text from public.care_access_events where patient_id = v_member and actor_profile_id = v_coord and kind = 'record_viewed' and scope = 'booking' and metadata ->> 'stage' = 'lookup'));
  perform pg_temp.act(v_free);
  perform pg_temp.rec('a patient cannot use the lookup (42501)', '42501', pg_temp.try('select * from public.coordinator_find_patient(''CPB member'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a doctor cannot use the lookup (42501)', '42501', pg_temp.try('select * from public.coordinator_find_patient(''CPB member'')'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot use the lookup (42501)', '42501', pg_temp.try('select * from public.coordinator_find_patient(''CPB member'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_coord);
  perform pg_temp.rec('a 2 character query is refused (P0001)', 'P0001', pg_temp.try('select * from public.coordinator_find_patient(''CP'')'));
  perform pg_temp.rec('a wildcard query matches nobody', '0', (select count(*)::text from public.coordinator_find_patient('%%%')));
  perform pg_temp.back();

  -- ===== 2. a Free patient needs to upgrade first =====
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start);
  perform pg_temp.rec('coordinator cannot hold a paid item for a Free patient (P0001, upgrade_first)', 'true',
    (v_h like 'ERR P0001:%join Membership%|upgrade_first')::text);
  v_h := pg_temp.hold_as(v_free, v_free, v_doc, v_start + interval '1 day');
  perform pg_temp.rec('a Free patient booking for themselves is not touched by that rule', 'true', (v_h !~ '^ERR')::text);
  v_own := case when v_h !~ '^ERR' then v_h::uuid end;
  perform pg_temp.rec('the patient''s own booking is stamped self', 'self/' || v_free::text,
    (select booked_via || '/' || booked_by::text from public.appointments where id = v_own));

  -- ===== 3. a Member, no credit: held for payment =====
  v_h := pg_temp.hold_as(v_coord, v_member, v_doc, v_start);
  perform pg_temp.rec('coordinator can hold a paid item for a Member', 'true', (v_h !~ '^ERR')::text);
  v_a := v_h::uuid;
  perform pg_temp.rec('stamped coordinator_phone and booked by the coordinator', 'coordinator_phone/' || v_coord::text,
    (select booked_via || '/' || booked_by::text from public.appointments where id = v_a));
  perform pg_temp.rec('the phone hold is at least 30 minutes', 'true',
    (select (hold_expires_at > now() + interval '29 minutes')::text from public.appointments where id = v_a));
  perform pg_temp.act(v_coord);
  perform public.confirm_appointment_booking(v_a);
  perform pg_temp.back();
  select * into v_row from public.appointments where id = v_a;
  perform pg_temp.rec('with no credit the booking waits for payment', 'booked/pending', v_row.status::text || '/' || v_row.payment_status::text);
  perform pg_temp.rec('and is held about 24 hours', 'true',
    (v_row.hold_expires_at between now() + interval '23 hours' and now() + interval '25 hours')::text);
  perform pg_temp.act(v_member);
  select count(*) into v_cnt from public.appointments where id = v_a;
  perform pg_temp.back();
  perform pg_temp.rec('the patient sees it on their own list', '1', v_cnt::text);

  -- ===== 4. the payment lands =====
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo)
  values (v_org, v_member, v_prod, 'pending_payment', coalesce((select price_kobo from public.service_products where id = v_prod), 0), 'NGN', 0)
  returning id into v_purchase;
  perform set_config('request.jwt.claim.sub', 'before-marker', true);
  update public.service_purchases set status = 'active', purchased_at = now() where id = v_purchase;
  select * into v_row from public.appointments where id = v_a;
  perform pg_temp.rec('payment confirms the phone booking with no session', 'confirmed/paid', v_row.status::text || '/' || v_row.payment_status::text);
  perform pg_temp.rec('no error was recorded', 'null', coalesce(v_row.payment_confirm_error, 'null'));
  perform pg_temp.rec('the confirmed booking has its encounter', '1', (select count(*)::text from public.encounters where appointment_id = v_a));
  perform pg_temp.rec('the transaction claim is restored after the confirm', 'before-marker', current_setting('request.jwt.claim.sub', true));
  perform set_config('request.jwt.claim.sub', '', true);

  -- ===== 4b. a credit INSERTED active (a sponsor's voucher credit, a free product) also confirms a waiting phone booking =====
  v_h := pg_temp.hold_as(v_coord, v_member, v_doc, v_start + interval '7 days');
  perform pg_temp.act(v_coord);
  perform public.confirm_appointment_booking(v_h::uuid);
  perform pg_temp.back();
  perform pg_temp.rec('a second phone booking waits for payment', 'booked', (select status::text from public.appointments where id = v_h::uuid));
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  values (v_org, v_member, v_prod, 'active', coalesce((select price_kobo from public.service_products where id = v_prod), 0), 'NGN', 0, now());
  perform pg_temp.rec('a credit inserted active confirms it with no session', 'confirmed/paid',
    (select status::text || '/' || payment_status::text from public.appointments where id = v_h::uuid));

  -- ===== 5. a credit already held: confirms at once =====
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  values (v_org, v_member, v_prod, 'active', coalesce((select price_kobo from public.service_products where id = v_prod), 0), 'NGN', 0, now());
  v_h := pg_temp.hold_as(v_coord, v_member, v_doc, v_start + interval '2 days');
  perform pg_temp.act(v_coord);
  perform public.confirm_appointment_booking(v_h::uuid);
  perform pg_temp.back();
  perform pg_temp.rec('with a credit in hand the phone booking confirms at once', 'confirmed/paid',
    (select status::text || '/' || payment_status::text from public.appointments where id = v_h::uuid));

  -- ===== 6. an unpaid phone booking is released; a patient''s own unpaid booking is left alone =====
  v_h := pg_temp.hold_as(v_coord, v_member, v_doc, v_start + interval '4 days');
  perform pg_temp.act(v_coord);
  perform public.confirm_appointment_booking(v_h::uuid);
  perform pg_temp.back();
  perform pg_temp.rec('the new phone booking waits for payment', 'booked', (select status::text from public.appointments where id = v_h::uuid));
  update public.appointments set hold_expires_at = now() - interval '1 minute' where id = v_h::uuid;
  update public.appointments set status = 'booked', hold_expires_at = now() - interval '1 minute' where id = v_own;
  perform private.expire_stale_appointment_holds();
  perform pg_temp.rec('after 24 hours the unpaid phone booking is released', 'expired', (select status::text from public.appointments where id = v_h::uuid));
  perform pg_temp.rec('a patient''s own unpaid booked appointment is not touched', 'booked', (select status::text from public.appointments where id = v_own));

  -- the unpaid hold never outlives the appointment's own start (a visit 3 hours away is held 3 hours, not 24)
  v_soon := date_trunc('hour', now()) + interval '3 hours';
  v_h := pg_temp.hold_as(v_coord, v_member, v_doc, v_soon);
  perform pg_temp.act(v_coord);
  perform public.confirm_appointment_booking(v_h::uuid);
  perform pg_temp.back();
  perform pg_temp.rec('a phone booking 3 hours away waits for payment and is held no longer than until its start', 'booked/true',
    (select status::text || '/' || (hold_expires_at <= scheduled_for)::text from public.appointments where id = v_h::uuid));

  -- ===== 8. SABOTAGE =====
  -- (a) tier lookup says everyone has a tier: the Free patient now holds, so the refusal above was the tier check
  execute $s$ create or replace function private.patient_membership_tier(p_patient uuid) returns text language sql stable security definer set search_path to '' as $b$ select 'plus'::text $b$ $s$;
  v_h := pg_temp.hold_as(v_coord, v_free, v_doc, v_start + interval '5 days');
  perform pg_temp.rec('SABOTAGE tier check satisfied: the Free patient now holds (so the refusal was the tier check)', 'true', (v_h !~ '^ERR')::text);

  -- (b) payment trigger off: the booking does not confirm
  execute 'alter table public.service_purchases disable trigger confirm_phone_bookings_after_payment';
  v_h := pg_temp.hold_as(v_coord, v_member, v_doc, v_start + interval '6 days');
  perform pg_temp.act(v_coord);
  perform public.confirm_appointment_booking(v_h::uuid);
  perform pg_temp.back();
  select count(*) into v_cnt from public.appointments where id = v_h::uuid and status = 'booked';
  perform pg_temp.rec('SABOTAGE precondition: the 6 day phone booking is waiting on payment', '1', v_cnt::text);
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo)
  values (v_org, v_member, v_prod, 'pending_payment', 0, 'NGN', 0) returning id into v_purchase;
  update public.service_purchases set status = 'active', purchased_at = now() where id = v_purchase;
  perform pg_temp.rec('SABOTAGE payment trigger off: the paid booking stays unconfirmed (so section 4 proved the trigger)', 'booked',
    (select status::text from public.appointments where id = v_h::uuid));
  execute 'alter table public.service_purchases enable trigger confirm_phone_bookings_after_payment';

  -- (d) the audit write fails: the lookup must show nothing rather than hand over details unrecorded
  execute $s$ create or replace function private.log_care_access(p_patient uuid, p_kind public.care_access_event_kind, p_scope text default null, p_metadata jsonb default '{}'::jsonb, p_actor uuid default null)
              returns void language plpgsql security definer set search_path to '' as $b$ begin return; end $b$ $s$;
  -- a patient nobody has looked up yet: an earlier audit line (within the hour) would otherwise satisfy the check by itself
  perform pg_temp.mkuser(v_org, 'zzaudit-patient', 'patient', (current_date - interval '60 years')::date);
  perform pg_temp.act(v_coord);
  perform pg_temp.rec('SABOTAGE audit logger does nothing: the lookup is refused instead of showing details unrecorded (P0001)', 'P0001',
    pg_temp.try('select * from public.coordinator_find_patient(''CPB zzaudit-patient'')'));
  perform pg_temp.back();

  -- (c) the coordinator loses the role: the lookup is refused for the same person who was served above
  update public.profiles set role = 'patient' where id = v_coord;
  perform pg_temp.act(v_coord);
  perform pg_temp.rec('SABOTAGE coordinator role removed: the same person is now refused the lookup (so the role gate is what served them)', '42501',
    pg_temp.try('select * from public.coordinator_find_patient(''CPB member'')'));
  perform pg_temp.back();

  -- ===== verdict =====
  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'coordinator phone booking proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'coordinator phone booking: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
