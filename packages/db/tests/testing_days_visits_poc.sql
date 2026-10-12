-- Proof: testing days, employer on-site visits and point-of-care results (migration *_testing_days_employer_visits_point_of_care.sql)
-- plus the required screening analytes (migration *_membership_annual_screening_required.sql).
-- Rules: Members only, capacity and waitlist, check-in makes the lab order and the labelled specimen, INV-03 (patient sees only released),
-- the database classifies point-of-care values, the ECG is never auto-read or auto-released, INV-07 neutral notices, I9 aggregate-only
-- with the min_cell rule for the employer, anon never.
-- One rolled-back transaction. Ends with a SABOTAGE section: the patient policy and the release guard are opened and the checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  if r like 'ERR:%' and current_setting('td.debug', true) = 'on' then raise notice 'q_as error: % <= %', r, left(p_sql, 120); end if;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'td-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'TD ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkmember(p_org uuid, p_label text, p_source text default 'granted') returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient');
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, granted_by, grant_reason, is_test)
  values (p_org, v, p_source, 'active', now() - interval '1 day', pg_temp.f('admin'), 'testing days proof member', true);
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'TD ' || p_label, 'MDCN', 'TD-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
-- call a public function as a user and return its text result (or the error)
create function pg_temp.rpc(p_uid uuid, p_call text) returns text language sql as
$$ select pg_temp.q_as(p_uid, 'select (' || p_call || ')::text') $$;
create function pg_temp.err(p_text text) returns text language sql as
$$ select case when p_text like 'ERR:%' then substr(p_text, 5) else 'ok' end $$;
create function pg_temp.notices(p_uid uuid, p_template text) returns text language sql as
$$ select count(*)::text from public.notifications where recipient_id = p_uid and template = p_template and channel = 'in_app' $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_emp uuid; v_admin uuid; v_lab uuid; v_ev uuid; i integer; p uuid; v_roster uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  insert into public.organisations (name, type) values ('TD Employer', 'clinic') returning id into v_emp;
  perform pg_temp.setf('emp', v_emp);
  perform pg_temp.setf('empadmin', pg_temp.mkuser(v_emp, 'empadmin', 'corporate_admin'));
  perform pg_temp.setf('otheradmin', pg_temp.mkuser(v_org, 'otheradmin', 'corporate_admin'));
  perform pg_temp.setf('runner', pg_temp.mkuser(v_org, 'runner', 'care_coordinator'));
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (pg_temp.f('runner'), 'testing_days.run', v_admin);
  perform pg_temp.setf('plainstaff', pg_temp.mkuser(v_org, 'plainstaff', 'care_coordinator'));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  insert into public.lab_providers (name, is_active) values ('TD Lab', true) returning id into v_lab;
  perform pg_temp.setf('lab', v_lab);
  perform pg_temp.setf('m1', pg_temp.mkmember(v_org, 'm1'));
  perform pg_temp.setf('m2', pg_temp.mkmember(v_org, 'm2'));
  perform pg_temp.setf('m3', pg_temp.mkmember(v_org, 'm3'));
  perform pg_temp.setf('m4', pg_temp.mkmember(v_org, 'm4'));
  perform pg_temp.setf('free', pg_temp.mkuser(v_org, 'free', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id)
  values (v_org, pg_temp.f('m1'), pg_temp.f('doc'), pg_temp.f('doc'));
end $$;

-- 1. Grants and who may schedule ------------------------------------------------------------------------------------------
do $$
declare v_m1 uuid := pg_temp.f('m1');
begin
  perform pg_temp.ck('anon cannot list testing days', '42501', pg_temp.try_anon('select public.list_testing_days()'));
  perform pg_temp.ck('anon cannot read results', '42501', pg_temp.try_anon('select public.my_poc_results()'));
  perform pg_temp.ck('a patient cannot read the events table', 'true',
    (pg_temp.q_as(v_m1, 'select count(*) from public.testing_events') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a patient cannot read the ECG table', 'true',
    (pg_temp.q_as(v_m1, 'select count(*) from public.poc_ecg_recordings') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a patient cannot write a result directly', 'true',
    (pg_temp.q_as(v_m1, 'delete from public.poc_results') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a member cannot create a testing day', 'not authorised',
    pg_temp.err(pg_temp.rpc(v_m1, format($q$public.create_testing_event('public_day', current_date + 10, null, null, 'V', 'A', 'Lagos', null, null, 5, %L)$q$, pg_temp.f('lab')))));
  perform pg_temp.ck('station staff without the manage permission cannot create one either', 'not authorised',
    pg_temp.err(pg_temp.rpc(pg_temp.f('runner'), format($q$public.create_testing_event('public_day', current_date + 10, null, null, 'V', 'A', 'Lagos', null, null, 5, %L)$q$, pg_temp.f('lab')))));
  perform pg_temp.ck('the point-of-care panels start unsigned', '0', (select count(*)::text from public.poc_panel_versions where approved_at is not null));
  perform pg_temp.ck('the ECG bucket exists and is private', 'false', (select public::text from storage.buckets where id = 'poc-ecg'));
  perform pg_temp.ck('no storage policy names the ECG bucket', '0', (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%poc-ecg%'));
end $$;

-- 2. Events: venue approval and a lab are needed before a Member can see a day ----------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_ev uuid; v_ev2 uuid; v_evtoday uuid; r text;
begin
  v_ev := pg_temp.rpc(v_admin, format($q$public.create_testing_event('public_day', current_date + 14, '09:00', '15:00', 'Yaba Hall', '1 Yaba Road', 'Lagos', 'Yaba', 'Lagos', 2, %L)$q$, pg_temp.f('lab')))::uuid;
  perform pg_temp.setf('ev', v_ev);
  v_ev2 := pg_temp.rpc(v_admin, format($q$public.create_testing_event('public_day', current_date + 21, '09:00', '15:00', 'Ibadan Hall', '2 Dugbe', 'Ibadan', null, 'Oyo', 5, %L)$q$, pg_temp.f('lab')))::uuid;
  perform pg_temp.setf('ev2', v_ev2);
  v_evtoday := pg_temp.rpc(v_admin, format($q$public.create_testing_event('public_day', (now() at time zone 'Africa/Lagos')::date, '09:00', '15:00', 'Today Hall', '3 Today St', 'Lagos', null, 'Lagos', 10, %L)$q$, pg_temp.f('lab')))::uuid;
  perform pg_temp.setf('evtoday', v_evtoday);
  perform pg_temp.ck('a day in the past is refused', 'testing_event_date_in_past',
    pg_temp.err(pg_temp.rpc(v_admin, format($q$public.create_testing_event('public_day', current_date - 3, null, null, 'V', 'A', 'Lagos', null, null, 5, %L)$q$, pg_temp.f('lab')))));
  perform pg_temp.ck('opening without an approved venue is refused', 'testing_event_needs_lab_and_venue_approval',
    pg_temp.err(pg_temp.rpc(v_admin, format('public.set_testing_event_status(%L, %L)', v_ev, 'open'))));
  perform pg_temp.rpc(v_admin, format('public.approve_testing_event_venue(%L)', v_ev));
  perform pg_temp.rpc(v_admin, format('public.approve_testing_event_venue(%L)', v_ev2));
  perform pg_temp.rpc(v_admin, format('public.approve_testing_event_venue(%L)', v_evtoday));
  perform pg_temp.ck('a Free person is refused the listing', 'membership_required', pg_temp.err(pg_temp.rpc(pg_temp.f('free'), 'public.list_testing_days()')));
  perform pg_temp.ck('a Member sees no day that is not open', '0', jsonb_array_length(pg_temp.rpc(pg_temp.f('m1'), 'public.list_testing_days()')::jsonb)::text);
  perform pg_temp.ck('after approval the day opens', 'ok', pg_temp.err(pg_temp.rpc(v_admin, format('public.set_testing_event_status(%L, %L)', v_ev, 'open'))));
  perform pg_temp.rpc(v_admin, format('public.set_testing_event_status(%L, %L)', v_ev2, 'open'));
  perform pg_temp.rpc(v_admin, format('public.set_testing_event_status(%L, %L)', v_evtoday, 'open'));
  perform pg_temp.ck('a Member now sees the three open days', '3', jsonb_array_length(pg_temp.rpc(pg_temp.f('m1'), 'public.list_testing_days()')::jsonb)::text);
  perform pg_temp.ck('the city filter works', '1', jsonb_array_length(pg_temp.rpc(pg_temp.f('m1'), $q$public.list_testing_days('Ibadan')$q$)::jsonb)::text);
  perform pg_temp.ck('the listing carries seats left', '2',
    (select (x ->> 'seats_left') from jsonb_array_elements(pg_temp.rpc(pg_temp.f('m1'), 'public.list_testing_days()')::jsonb) x where (x ->> 'id') = v_ev::text));
end $$;

-- 3. Booking, capacity, waitlist, cancel, reschedule -------------------------------------------------------------------------
do $$
declare v_ev uuid := pg_temp.f('ev'); v_ev2 uuid := pg_temp.f('ev2'); b1 jsonb; b2 jsonb; b3 jsonb; b4 jsonb;
begin
  b1 := pg_temp.rpc(pg_temp.f('m1'), format('public.book_testing_day(%L)', v_ev))::jsonb;
  b2 := pg_temp.rpc(pg_temp.f('m2'), format('public.book_testing_day(%L)', v_ev))::jsonb;
  b3 := pg_temp.rpc(pg_temp.f('m3'), format('public.book_testing_day(%L)', v_ev))::jsonb;
  perform pg_temp.setf('b1', (b1 ->> 'booking_id')::uuid);
  perform pg_temp.setf('b2', (b2 ->> 'booking_id')::uuid);
  perform pg_temp.setf('b3', (b3 ->> 'booking_id')::uuid);
  perform pg_temp.ck('the first two are confirmed, the third is waitlisted (capacity 2)', 'confirmed,confirmed,waitlisted',
    (b1 ->> 'state') || ',' || (b2 ->> 'state') || ',' || (b3 ->> 'state'));
  perform pg_temp.ck('a Free person cannot book', 'membership_required', pg_temp.err(pg_temp.rpc(pg_temp.f('free'), format('public.book_testing_day(%L)', v_ev))));
  perform pg_temp.ck('a second tap returns the same booking (no double seat)', (b1 ->> 'booking_id'),
    (pg_temp.rpc(pg_temp.f('m1'), format('public.book_testing_day(%L)', v_ev))::jsonb ->> 'booking_id'));
  perform pg_temp.ck('booking a different day while holding one must use reschedule', 'already_booked_use_reschedule',
    pg_temp.err(pg_temp.rpc(pg_temp.f('m1'), format('public.book_testing_day(%L)', v_ev2))));
  perform pg_temp.ck('the member got one neutral confirmation', '1', pg_temp.notices(pg_temp.f('m1'), 'testing_day_confirmed') );
  perform pg_temp.ck('the waitlisted member got the waitlist notice', '1', pg_temp.notices(pg_temp.f('m3'), 'testing_day_waitlisted'));
  perform pg_temp.ck('notices go to in-app, push and email (confirmation)', '3',
    (select count(distinct channel)::text from public.notifications where recipient_id = pg_temp.f('m1') and template = 'testing_day_confirmed'));
  perform pg_temp.ck('no notice names a test, value or condition', '0',
    (select count(*)::text from public.notification_template_locales where template_key like 'testing_day_%'
       and (subject || ' ' || body) ~* '(hiv|hepatitis|blood|ecg|urine|glucose|result|positive|diabet)'));
  perform pg_temp.ck('waitlist position is 1', '1', (select (x ->> 'waitlist_position') from jsonb_array_elements(pg_temp.rpc(pg_temp.f('m3'), 'public.my_testing_bookings()')::jsonb) x limit 1));
  -- cancel: the freed place goes to the person waiting, who is told
  perform pg_temp.rpc(pg_temp.f('m1'), format('public.cancel_testing_booking(%L)', pg_temp.f('b1')));
  perform pg_temp.ck('after a cancel the waitlisted member is confirmed', 'confirmed', (select state from public.testing_event_bookings where id = pg_temp.f('b3')));
  perform pg_temp.ck('...and told once', '1', pg_temp.notices(pg_temp.f('m3'), 'testing_day_promoted'));
  perform pg_temp.ck('another member cannot cancel someone else''s booking', 'booking_not_found',
    pg_temp.err(pg_temp.rpc(pg_temp.f('m4'), format('public.cancel_testing_booking(%L)', pg_temp.f('b2')))));
  -- reschedule to a full day keeps the old place
  b4 := pg_temp.rpc(pg_temp.f('m4'), format('public.book_testing_day(%L)', v_ev2))::jsonb;
  perform pg_temp.setf('b4', (b4 ->> 'booking_id')::uuid);
  perform pg_temp.ck('reschedule to a full day is refused and keeps the old place', 'new_day_full_keep_current|confirmed',
    pg_temp.err(pg_temp.rpc(pg_temp.f('m4'), format('public.reschedule_testing_booking(%L, %L)', pg_temp.f('b4'), v_ev)))
    || '|' || (select state from public.testing_event_bookings where id = pg_temp.f('b4')));
  -- fill ev2 is not needed: move m2 from ev to ev2 (room)
  perform pg_temp.ck('reschedule to a day with room moves the place', 'confirmed',
    pg_temp.rpc(pg_temp.f('m2'), format('public.reschedule_testing_booking(%L, %L)', pg_temp.f('b2'), v_ev2))::jsonb ->> 'state');
  perform pg_temp.ck('the old place is cancelled as rescheduled', 'cancelled|rescheduled',
    (select state || '|' || cancelled_reason from public.testing_event_bookings where id = pg_temp.f('b2')));
end $$;

-- 4. Reminders ---------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('reminders: the service role sends, a signed-in user cannot', 'true',
    (pg_temp.q_as(pg_temp.f('m3'), 'select public.send_testing_day_reminders()') like 'ERR:permission denied%')::text);
  update public.testing_events set event_date = (now() at time zone 'Africa/Lagos')::date + 5 where id = pg_temp.f('ev');
  perform pg_temp.ck('a 7-day reminder goes to the confirmed member', '1', public.send_testing_day_reminders()::text);
  perform pg_temp.ck('...and not twice', '0', public.send_testing_day_reminders()::text);
  update public.testing_events set event_date = (now() at time zone 'Africa/Lagos')::date + 1 where id = pg_temp.f('ev');
  perform pg_temp.ck('a 1-day reminder follows', '1', public.send_testing_day_reminders()::text);
  perform pg_temp.ck('...and not twice', '0', public.send_testing_day_reminders()::text);
end $$;

-- 5. Station A: check-in makes the order and the labelled specimen ------------------------------------------------------------
do $$
declare v_today uuid := pg_temp.f('evtoday'); bk uuid; r jsonb; v_m4 uuid := pg_temp.f('m4');
begin
  perform pg_temp.rpc(pg_temp.f('m4'), format('public.cancel_testing_booking(%L)', pg_temp.f('b4')));
  bk := (pg_temp.rpc(v_m4, format('public.book_testing_day(%L)', v_today))::jsonb ->> 'booking_id')::uuid;
  perform pg_temp.setf('bk', bk);
  perform pg_temp.ck('a plain staff member cannot check anyone in', 'not authorised', pg_temp.err(pg_temp.rpc(pg_temp.f('plainstaff'), format('public.check_in_testing_booking(%L)', bk))));
  perform pg_temp.ck('a member cannot check themselves in', 'not authorised', pg_temp.err(pg_temp.rpc(v_m4, format('public.check_in_testing_booking(%L)', bk))));
  perform pg_temp.ck('check-in on another day is refused', 'not_the_day_of_the_event',
    pg_temp.err(pg_temp.rpc(pg_temp.f('runner'), format('public.check_in_testing_booking(%L)', pg_temp.f('b3')))));
  -- membership lapses before the day: check-in refuses
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'proof lapse for check-in', ends_at = null where patient_id = v_m4;
  perform pg_temp.ck('a lapsed Member is refused at the desk', 'membership_required', pg_temp.err(pg_temp.rpc(pg_temp.f('runner'), format('public.check_in_testing_booking(%L)', bk))));
  update public.patient_memberships set state = 'active', ended_at = null, end_reason = null where patient_id = v_m4;
  r := pg_temp.rpc(pg_temp.f('runner'), format('public.check_in_testing_booking(%L)', bk))::jsonb;
  perform pg_temp.ck('check-in returns a labelled specimen number', 'true', ((r ->> 'specimen_number') like 'SPX-%')::text);
  perform pg_temp.ck('the lab order is the annual panel, at the event''s lab', 'membership_annual|payment_confirmed|true',
    (select panel_code || '|' || status::text || '|' || (provider_id = pg_temp.f('lab'))::text from public.lab_orders where id = (r ->> 'lab_order_id')::uuid));
  perform pg_temp.ck('the specimen is linked to that order and waits for the draw', 'pending_collection',
    (select status::text from public.lab_specimens where id = (r ->> 'specimen_id')::uuid and lab_order_id = (r ->> 'lab_order_id')::uuid));
  perform pg_temp.ck('check-in twice makes no second order', '1|true',
    (select count(*)::text from public.lab_orders where patient_id = v_m4 and panel_code = 'membership_annual')
    || '|' || ((pg_temp.rpc(pg_temp.f('runner'), format('public.check_in_testing_booking(%L)', bk))::jsonb ->> 'already') )::text);
  perform pg_temp.ck('blood draw before check-in is refused', 'booking_not_checked_in',
    pg_temp.err(pg_temp.rpc(pg_temp.f('runner'), format('public.record_testing_blood_draw(%L)', pg_temp.f('b3')))));
  perform pg_temp.rpc(pg_temp.f('runner'), format('public.record_testing_blood_draw(%L)', bk));
  perform pg_temp.ck('station C marks the specimen collected and the order sample_collected', 'collected|sample_collected',
    (select s.status::text || '|' || o.status::text from public.lab_specimens s join public.lab_orders o on o.id = s.lab_order_id where s.id = (r ->> 'specimen_id')::uuid));
  perform pg_temp.ck('the roster shows the specimen number to staff', 'true',
    (pg_temp.rpc(pg_temp.f('runner'), format('public.testing_event_roster(%L)', v_today)) like '%SPX-%')::text);
  -- a Member who already has a live annual order cannot start a second one at the desk
  perform pg_temp.setf('m5', pg_temp.mkmember(pg_temp.f('org'), 'm5'));
  perform set_config('tarragon.testing_day_checkin', 'on', true);
  insert into public.lab_orders (organisation_id, patient_id, provider_id, status, panel_code, fulfilment, transmission, origin)
  values (pg_temp.f('org'), pg_temp.f('m5'), pg_temp.f('lab'), 'pending_payment', 'membership_annual', 'partner', 'awaiting_payment', 'patient_initiated');
  perform set_config('tarragon.testing_day_checkin', 'off', true);
  perform pg_temp.ck('the annual check is once a year', 'annual_check_already_started',
    pg_temp.err(pg_temp.rpc(pg_temp.f('runner'), format('public.check_in_testing_booking(%L)',
      (pg_temp.rpc(pg_temp.f('m5'), format('public.book_testing_day(%L)', v_today))::jsonb ->> 'booking_id')::uuid))));
end $$;

-- 6. Point of care --------------------------------------------------------------------------------------------------------------
do $$
declare bk uuid := pg_temp.f('bk'); v_m4 uuid := pg_temp.f('m4'); runner uuid := pg_temp.f('runner'); r jsonb; ur uuid; hb uuid; ecg uuid; v_doc uuid := pg_temp.f('doc');
        v_task integer;
begin
  -- the patient (m4) must be tied to the doctor for the doctor to act
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id)
  values (pg_temp.f('org'), v_m4, v_doc, v_doc) on conflict do nothing;

  perform pg_temp.ck('a BP with diastolic above systolic is refused', 'bp_reading_out_of_range',
    pg_temp.err(pg_temp.rpc(runner, format($q$public.record_poc_measurements(%L, '{"bp_readings":[{"systolic":80,"diastolic":90}]}')$q$, bk))));
  r := pg_temp.rpc(runner, format($q$public.record_poc_measurements(%L, '{"height_cm":172,"weight_kg":70,"pulse_bpm":72,"spo2_pct":98,"glucose_mmol_l":5.1,"glucose_context":"fasting","bp_readings":[{"systolic":124,"diastolic":80},{"systolic":122,"diastolic":78},{"systolic":120,"diastolic":78}],"equipment":{"bp":"A&D UA-651BLE","glucose":"Accu-Chek Guide"}}')$q$, bk))::jsonb;
  perform pg_temp.ck('measurements: BP x3, glucose, weight, pulse and SpO2 become vitals rows', '7', (r ->> 'vitals_rows'));
  perform pg_temp.ck('...in the existing vitals table, stamped as a device reading', '7',
    (select count(*)::text from public.vitals_readings where patient_id = v_m4 and source = 'device' and note = 'Taken at a testing day'));
  perform pg_temp.ck('BMI is computed (70 / 1.72^2 = 23.7)', '23.7', (r ->> 'bmi'));
  perform pg_temp.ck('measurements twice are refused', 'poc_measurements_already_recorded',
    pg_temp.err(pg_temp.rpc(runner, format($q$public.record_poc_measurements(%L, '{"height_cm":172}')$q$, bk))));

  perform pg_temp.ck('a value not on the strip scale is refused', 'poc_value_not_recognised',
    pg_temp.err(pg_temp.rpc(runner, format($q$public.record_poc_urinalysis(%L, '[{"analyte_code":"glucose","value_text":"5+"}]')$q$, bk))));
  perform pg_temp.ck('an analyte outside the panel is refused (no vitamin D, ferritin or PSA)', 'poc_analyte_not_in_panel',
    pg_temp.err(pg_temp.rpc(runner, format($q$public.record_poc_urinalysis(%L, '[{"analyte_code":"ferritin","value_numeric":50}]')$q$, bk))));
  perform pg_temp.ck('HbA1c above the sanity bound is refused', 'poc_value_out_of_bounds',
    pg_temp.err(pg_temp.rpc(runner, format('public.record_poc_hba1c(%L, 999999)', bk))));
  -- urinalysis: the database classifies; a client-sent flag is ignored; abnormal is held with a task
  ur := pg_temp.rpc(runner, format($q$public.record_poc_urinalysis(%L, '[{"analyte_code":"glucose","value_text":"2+","flag":"normal"},{"analyte_code":"protein","value_text":"trace"},{"analyte_code":"ph","value_numeric":6.5},{"analyte_code":"nitrite","value_text":"negative"}]')$q$, bk))::uuid;
  perform pg_temp.setf('ur', ur);
  perform pg_temp.ck('glucose 2+ is classified abnormal in the database even though the client said normal', 'abnormal',
    (select flag from public.poc_result_items where poc_result_id = ur and analyte_code = 'glucose'));
  perform pg_temp.ck('protein trace is normal, pH 6.5 is normal', 'normal,normal',
    (select string_agg(flag, ',' order by analyte_code) from public.poc_result_items where poc_result_id = ur and analyte_code in ('protein', 'ph')));
  perform pg_temp.ck('the abnormal result is held and a review task exists', 'awaiting_review|1',
    (select release_state from public.poc_results where id = ur) || '|' || (select count(*)::text from public.clinical_tasks where dedup_key = 'poc_result:' || ur));
  perform pg_temp.ck('the patient sees nothing while it is held', '0', pg_temp.q_as(v_m4, 'select count(*)::text from public.poc_results'));
  perform pg_temp.ck('...and the patient function returns no results', '0',
    jsonb_array_length(pg_temp.rpc(v_m4, 'public.my_poc_results()')::jsonb -> 'results')::text);

  -- HbA1c normal, but the panels are unsigned: still held (INV-14)
  hb := pg_temp.rpc(runner, format('public.record_poc_hba1c(%L, 5.2)', bk))::uuid;
  perform pg_temp.setf('hb', hb);
  perform pg_temp.ck('an all-normal HbA1c is HELD while the ranges are unsigned', 'awaiting_review|hba1c normal',
    (select release_state from public.poc_results where id = hb) || '|hba1c ' || (select flag from public.poc_result_items where poc_result_id = hb));
  perform pg_temp.ck('a runner cannot release a result', 'This action is for clinicians', pg_temp.err(pg_temp.rpc(runner, format('public.release_poc_result(%L)', hb))));
  perform pg_temp.ck('a clinician not tied to the patient cannot release it', 'not permitted',
    pg_temp.err(pg_temp.rpc(pg_temp.f('stranger'), format('public.release_poc_result(%L)', hb))));
  perform pg_temp.ck('the guard refuses a release with no reviewer, even for the table owner', '42501',
    pg_temp.try_sql(format($q$update public.poc_results set release_state = 'released', release_reason = 'clinician_review', released_at = now() where id = %L$q$, hb)));
  perform pg_temp.ck('the guard refuses automatic release while the panel is unsigned', '42501',
    pg_temp.try_sql(format($q$update public.poc_results set release_state = 'released', release_reason = 'RES-001', released_at = now() where id = %L$q$, hb)));
  perform pg_temp.ck('the doctor releases the HbA1c', 'ok', pg_temp.err(pg_temp.rpc(v_doc, format('public.release_poc_result(%L, %L)', hb, 'looks fine'))));
  perform pg_temp.ck('...the patient now sees it, with one neutral notice', '1|1',
    jsonb_array_length(pg_temp.rpc(v_m4, 'public.my_poc_results()')::jsonb -> 'results')::text || '|' || pg_temp.notices(v_m4, 'poc_result_ready'));
  perform pg_temp.ck('...and the patient still does not see the abnormal urinalysis', '1',
    jsonb_array_length(pg_temp.rpc(v_m4, 'public.my_poc_results()')::jsonb -> 'results')::text);
  perform pg_temp.ck('a released result is final', '42501',
    pg_temp.try_sql(format($q$update public.poc_results set release_state = 'withheld', reviewed_by = %L, withheld_reason = 'x' where id = %L$q$, v_doc, hb)));
  perform pg_temp.ck('items are append only', '42501', pg_temp.try_sql(format('update public.poc_result_items set flag = %L where poc_result_id = %L', 'normal', ur)));
  perform pg_temp.ck('the doctor withholds the urinalysis with a reason', 'ok', pg_temp.err(pg_temp.rpc(v_doc, format('public.withhold_poc_result(%L, %L)', ur, 'sample contaminated, repeat'))));
  perform pg_temp.ck('...the patient never sees it', '1', jsonb_array_length(pg_temp.rpc(v_m4, 'public.my_poc_results()')::jsonb -> 'results')::text);

  -- ECG
  ecg := pg_temp.rpc(runner, format($q$public.record_poc_ecg(%L, 'ecg/%s.pdf', 'application/pdf', 52000, 'Contec ECG1200G', 'Sinus rhythm (machine text)')$q$, bk, bk))::uuid;
  perform pg_temp.setf('ecg', ecg);
  perform pg_temp.ck('an ECG recording makes a task for a doctor and is not read', 'awaiting_interpretation|1',
    (select release_state from public.poc_ecg_recordings where id = ecg) || '|' || (select count(*)::text from public.clinical_tasks where dedup_key = 'poc_ecg:' || ecg and type = 'ecg_interpretation'));
  perform pg_temp.ck('the machine statement cannot cause a release', '42501',
    pg_temp.try_sql(format($q$update public.poc_ecg_recordings set release_state = 'released' where id = %L$q$, ecg)));
  perform pg_temp.ck('even with a clinician id but no text it cannot release', '23514',
    pg_temp.try_sql(format($q$update public.poc_ecg_recordings set release_state = 'released', interpreted_by = %L, interpreted_at = now(), interpretation_class = 'normal' where id = %L$q$, v_doc, ecg)));
  perform pg_temp.ck('a non-clinician as interpreter is refused by the guard', '42501',
    pg_temp.try_sql(format($q$update public.poc_ecg_recordings set release_state = 'released', interpreted_by = %L, interpreted_at = now(), interpretation_class = 'normal', interpretation = 'fine' where id = %L$q$, pg_temp.f('admin'), ecg)));
  perform pg_temp.ck('the patient cannot see the unread ECG', '0',
    jsonb_array_length(pg_temp.rpc(v_m4, 'public.my_poc_results()')::jsonb -> 'ecgs')::text);
  perform pg_temp.ck('a runner cannot interpret', 'This action is for clinicians', pg_temp.err(pg_temp.rpc(runner, format($q$public.interpret_poc_ecg(%L, 'normal', 'ok')$q$, ecg))));
  perform pg_temp.ck('an untied clinician cannot interpret or open the trace', 'not permitted|not permitted',
    pg_temp.err(pg_temp.rpc(pg_temp.f('stranger'), format($q$public.interpret_poc_ecg(%L, 'normal', 'ok')$q$, ecg))) || '|' ||
    pg_temp.err(pg_temp.rpc(pg_temp.f('stranger'), format('public.poc_ecg_file_path(%L)', ecg))));
  perform pg_temp.ck('the tied doctor can open the trace path', 'true', (pg_temp.rpc(v_doc, format('public.poc_ecg_file_path(%L)', ecg)) like 'ecg/%')::text);
  perform pg_temp.ck('the queue shows the machine statement to the doctor only', 'true',
    (pg_temp.rpc(v_doc, 'public.poc_review_queue()') like '%Sinus rhythm (machine text)%')::text);
  perform pg_temp.ck('the doctor interpretation needs text', 'ecg_interpretation_required', pg_temp.err(pg_temp.rpc(v_doc, format($q$public.interpret_poc_ecg(%L, 'normal', '  ')$q$, ecg))));
  perform pg_temp.ck('the doctor interprets', 'ok', pg_temp.err(pg_temp.rpc(v_doc, format($q$public.interpret_poc_ecg(%L, 'normal', 'Normal sinus rhythm, no acute changes.')$q$, ecg))));
  perform pg_temp.ck('the patient sees the doctor''s words and never the machine''s', 'true|false',
    (pg_temp.rpc(v_m4, 'public.my_poc_results()') like '%Normal sinus rhythm, no acute changes.%')::text || '|' ||
    (pg_temp.rpc(v_m4, 'public.my_poc_results()') like '%machine text%')::text);
  perform pg_temp.ck('the review task was closed', '0',
    (select count(*)::text from public.clinical_tasks where dedup_key = 'poc_ecg:' || ecg and state in ('created', 'offered_to_lead', 'open', 'escalated', 'claimed')));
  perform pg_temp.ck('a read ECG is final', '42501', pg_temp.try_sql(format($q$update public.poc_ecg_recordings set release_state = 'withheld', withheld_reason = 'x' where id = %L$q$, ecg)));
  perform pg_temp.ck('a stranger patient cannot read another''s results', '0',
    jsonb_array_length(pg_temp.rpc(pg_temp.f('m1'), 'public.my_poc_results()')::jsonb -> 'ecgs')::text);
end $$;

-- 7. Employer visits: request, schedule, attendees, aggregate-only ------------------------------------------------------------
do $$
declare v_emp uuid := pg_temp.f('emp'); ea uuid := pg_temp.f('empadmin'); v_admin uuid := pg_temp.f('admin'); ev uuid; i integer; p uuid; rid uuid; ids uuid[] := '{}'; r jsonb; s jsonb;
begin
  perform pg_temp.ck('a member cannot request an employer visit', 'not authorised',
    pg_temp.err(pg_temp.rpc(pg_temp.f('m1'), $q$public.request_employer_visit(current_date + 20, 'Site', 'Lagos', null, 25)$q$)));
  perform pg_temp.ck('a week of notice is needed', 'visit_needs_a_week_notice',
    pg_temp.err(pg_temp.rpc(ea, $q$public.request_employer_visit(current_date + 2, 'Site', 'Lagos', null, 25)$q$)));
  ev := pg_temp.rpc(ea, $q$public.request_employer_visit(current_date + 20, '5 Industrial Rd', 'Lagos', 'Ikeja', 25, 'Staff health day')$q$)::uuid;
  perform pg_temp.setf('vis', ev);
  perform pg_temp.ck('the request is held as requested and is not added to the Members'' list (still the 3 public days)', 'requested|3',
    (select status from public.testing_events where id = ev) || '|' || jsonb_array_length(pg_temp.rpc(pg_temp.f('m1'), 'public.list_testing_days()')::jsonb)::text);
  perform pg_temp.rpc(v_admin, format('public.approve_testing_event_venue(%L)', ev));
  perform pg_temp.ck('staff schedule it', 'ok', pg_temp.err(pg_temp.rpc(v_admin, format('public.set_testing_event_status(%L, %L)', ev, 'scheduled'))));
  perform pg_temp.rpc(v_admin, format('public.set_testing_event_team(%L, %L::jsonb)', ev, jsonb_build_array(jsonb_build_object('profile_id', pg_temp.f('runner'), 'station', 'A'))));
  perform pg_temp.ck('the team is stored', '1', (select count(*)::text from public.testing_event_team where event_id = ev));
  -- 3 roster employees: one Member via employer, one without an account, one Free
  insert into public.employer_roster_members (organisation_id, phone, full_name, claimed_profile_id)
  values (v_emp, '+2348077700001', 'TD Roster Member', pg_temp.mkmember(v_emp, 'rm1', 'employer')) returning id into rid;
  ids := ids || rid;
  insert into public.employer_roster_members (organisation_id, phone, full_name) values (v_emp, '+2348077700002', 'TD Roster NoAcct') returning id into rid;
  ids := ids || rid;
  insert into public.employer_roster_members (organisation_id, phone, full_name, claimed_profile_id)
  values (v_emp, '+2348077700003', 'TD Roster Free', pg_temp.mkuser(v_emp, 'rf', 'patient')) returning id into rid;
  ids := ids || rid;
  r := pg_temp.rpc(v_admin, format('public.add_employer_visit_attendees(%L, %L::uuid[])', ev, ids))::jsonb;
  perform pg_temp.ck('only the claimed Member is added; the others are counted by reason', '1|1|1',
    (r ->> 'added') || '|' || (r ->> 'no_account') || '|' || (r ->> 'not_member'));
  perform pg_temp.ck('the employer admin cannot add attendees', 'not authorised', pg_temp.err(pg_temp.rpc(ea, format('public.add_employer_visit_attendees(%L, %L::uuid[])', ev, ids))));
  s := pg_temp.rpc(ea, 'public.employer_visit_summary()')::jsonb;
  perform pg_temp.ck('with fewer than 20 the employer sees NO count, only that it is suppressed', 'null|true',
    coalesce((s -> 0 ->> 'registered'), 'null') || '|' || (s -> 0 ->> 'suppressed'));
  perform pg_temp.ck('the employer sees their own requested headcount', '25', (s -> 0 ->> 'headcount_requested'));
  perform pg_temp.ck('the summary names nobody', 'false', (s::text ~* '(TD Roster|full_name|patient_id|booking)')::text);
  -- reach 20 attendees
  for i in 1..21 loop
    p := pg_temp.mkmember(v_emp, 'rx' || i, 'employer');
    insert into public.employer_roster_members (organisation_id, phone, full_name, claimed_profile_id)
    values (v_emp, '+23480777' || lpad((10 + i)::text, 5, '0'), 'TD Bulk ' || i, p) returning id into rid;
    ids := ids || rid;
  end loop;
  perform pg_temp.rpc(v_admin, format('public.add_employer_visit_attendees(%L, %L::uuid[])', ev, ids));
  s := pg_temp.rpc(ea, 'public.employer_visit_summary()')::jsonb;
  perform pg_temp.ck('capacity 25 is enforced when adding attendees', '22',
    (select count(*)::text from public.testing_event_bookings where event_id = ev and state = 'confirmed'));
  perform pg_temp.ck('at 20 or more the employer sees the registered count (the flag stays on because checked-in is still under 20)', '22|true',
    (s -> 0 ->> 'registered') || '|' || (s -> 0 ->> 'suppressed'));
  perform pg_temp.ck('checked-in is still under 20 so it is suppressed', 'null', coalesce(s -> 0 ->> 'checked_in', 'null'));
  perform pg_temp.ck('another employer sees none of it', '0', jsonb_array_length(pg_temp.rpc(pg_temp.f('otheradmin'), 'public.employer_visit_summary()')::jsonb)::text);
  perform pg_temp.ck('the employer admin reads no booking rows (RLS: only the person themself)', '0', pg_temp.q_as(ea, 'select count(*)::text from public.testing_event_bookings'));
  perform pg_temp.ck('...and no point-of-care results', '0', pg_temp.q_as(ea, 'select count(*)::text from public.poc_results'));
  perform pg_temp.ck('...and cannot call the staff roster', 'not authorised', pg_temp.err(pg_temp.rpc(ea, format('public.testing_event_roster(%L)', ev))));
end $$;

-- 7b. Visit day: roster employees are checked in on the visit ----------------------------------------------------------------
do $$
declare ev uuid := pg_temp.f('vis'); bk uuid; r jsonb;
begin
  update public.testing_events set event_date = (now() at time zone 'Africa/Lagos')::date, lab_provider_id = pg_temp.f('lab') where id = ev;
  select id into bk from public.testing_event_bookings where event_id = ev and state = 'confirmed' limit 1;
  r := pg_temp.rpc(pg_temp.f('runner'), format('public.check_in_testing_booking(%L)', bk))::jsonb;
  perform pg_temp.ck('an employer-visit attendee is checked in through the same path (order + specimen)', 'true|membership_annual',
    ((r ->> 'specimen_number') like 'SPX-%')::text || '|' || (select panel_code from public.lab_orders where id = (r ->> 'lab_order_id')::uuid));
end $$;

-- 8. Annual screening analytes are required -------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('the active annual panel is version 2', '2', (select version::text from public.lab_panel_versions where panel_code = 'membership_annual' and is_active));
  perform pg_temp.ck('HIV, HBsAg and anti-HCV are all in the panel and none is optional', '3|0',
    (select count(*)::text from public.lab_panel_versions p, jsonb_array_elements(p.analytes) a where p.is_active and a ->> 'code' in ('hiv_screen', 'hbsag', 'hcv_ab'))
    || '|' || (select count(*)::text from public.lab_panel_versions p, jsonb_array_elements(p.analytes) a where p.is_active and coalesce((a ->> 'optional')::boolean, false)));
  perform pg_temp.ck('version 1 is kept (never edited) and inactive', 'false', (select is_active::text from public.lab_panel_versions where panel_code = 'membership_annual' and version = 1));
  perform pg_temp.ck('the lab sign-off was not touched: still unsigned', 'false', private.lab_panels_signed()::text);
end $$;

-- 9. SABOTAGE: open the patient policy and the release guard; the checks must flip ---------------------------------------------
drop policy poc_results_released_own on public.poc_results;
create policy poc_results_released_own on public.poc_results for select to authenticated using (patient_id = (select auth.uid()));
drop trigger poc_results_guard on public.poc_results;
drop trigger poc_ecg_guard on public.poc_ecg_recordings;

do $$
declare v_held uuid := pg_temp.f('ur'); v_ecg uuid;
begin
  -- ur was withheld above; use a fresh held result for the guard sabotage
  insert into results values ('sabotaged', 'the patient policy now shows a held row to the patient', '0',
    pg_temp.q_as(pg_temp.f('m4'), format('select count(*)::text from public.poc_results where id = %L and release_state <> %L', v_held, 'released')));
  insert into results values ('sabotaged', 'with the guard gone an unreviewed release goes through', '42501',
    pg_temp.try_sql(format($q$update public.poc_results set release_state = 'released', release_reason = 'RES-001', released_at = now() where id = %L$q$, pg_temp.f('hb'))));
  -- hb is already released and final; without the guard the update goes through
  insert into results values ('sabotaged', 'with the ECG guard gone a non-clinician can be the interpreter', '42501',
    pg_temp.try_sql(format($q$update public.poc_ecg_recordings set release_state = 'released', interpreted_by = %L, interpreted_at = now(), interpretation_class = 'normal', interpretation = 'fine' where id = %L$q$, pg_temp.f('admin'), pg_temp.f('ecg'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'testing days proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of the checks that should flip', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
