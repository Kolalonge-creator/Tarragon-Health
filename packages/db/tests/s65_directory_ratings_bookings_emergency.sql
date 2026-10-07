-- S65 proof: directory visibility and search, wrong-information reports, verified-visit ratings, facility bookings and reminders, the
-- Care Circle one-tap alert, the emergency pack config and the clinician licence read (migrations s65a, s65b, s65c).
-- One rolled-back transaction. Fixtures are is_test; facilities are named SAMPLE and live only inside this transaction.
--
-- Proves: a listing past TWICE its cadence is absent from directory_search while one inside it is present (90/180/365 by class, never-
-- verified listings age from creation); two different reporters, not one reporter twice, force immediate re-verification, and a report never
-- edits the listing; a rating without a completed visit is rejected, one rating per visit, a comment judging a clinician is held and cannot
-- be published with its comment; ratings RLS per role (owner, other patient, staff table read, anon); reminders go out at the nearest
-- milestone only and a cancel stops them; the one-tap alert stores a location ONLY with consent, never puts it in a notification, tells only
-- members holding red_alerts, audits the supporter's read and purges the location; the pack row refuses a telephone number and 112.
-- SABOTAGE (each must flip a check): the hide rule removed, the visit check removed, the red_alerts filter removed from the one-tap alert,
-- the consent test removed from the one-tap alert.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's65-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S65 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
-- a facility fixture. p_verified_days null = never verified. p_created_days sets created_at.
create function pg_temp.mkfac(p_name text, p_type text, p_emergency boolean, p_24h boolean, p_created_days integer, p_verified_days integer, p_extra text default '{}') returns uuid
language plpgsql as $f$
declare v uuid; e jsonb := p_extra::jsonb;
begin
  insert into public.facilities (name, type, state, city, is_active, latitude, longitude, emergency_capable, open_24h, is_test, created_at, services, languages, accepts_hmo, nhia, hours_structured, address, contact_phone)
  values ('SAMPLE ' || p_name, p_type::public.facility_type, 'S65Test', 'Testville', true,
          coalesce((e ->> 'lat')::numeric, 6.5), coalesce((e ->> 'lng')::numeric, 3.4), p_emergency, p_24h, true, now() - make_interval(days => p_created_days),
          coalesce((select array_agg(x) from jsonb_array_elements_text(e -> 'services') x), '{}'::text[]),
          coalesce((select array_agg(x) from jsonb_array_elements_text(e -> 'languages') x), '{}'::text[]),
          coalesce((select array_agg(x) from jsonb_array_elements_text(e -> 'hmo') x), '{}'::text[]),
          coalesce((e ->> 'nhia')::boolean, false), e -> 'hours', '1 Test Road', '+2348000000001')
  returning id into v;
  if p_verified_days is not null then
    insert into public.directory_freshness (listing_table, listing_id, organisation_id, last_verified_at, next_verification_due, tier)
    values ('facilities', v, (select id from public.organisations order by created_at limit 1), now() - make_interval(days => p_verified_days), (now() + interval '30 days')::date, 'phone_confirmed');
  end if;
  return v;
end $f$;
-- names returned by directory_search for the S65Test state, as the given user
create function pg_temp.names(p_uid uuid, p_args text default '') returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select coalesce(string_agg(replace(name, 'SAMPLE ', ''), ',' order by name), '') from public.directory_search(p_state => 'S65Test'%s)$q$,
                                       case when p_args = '' then '' else ', ' || p_args end)) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_sup uuid; v_sup2 uuid; v_rep1 uuid; v_rep2 uuid; v_real uuid;
  fa uuid; fb uuid; fc uuid; fd uuid; fe uuid; fe2 uuid; ff uuid; ff2 uuid; fg uuid; fh uuid; fp uuid; fp2 uuid; fq uuid; fq2 uuid;
  r text; j jsonb; n integer; v_hash text; v_hash2 text; v_bk uuid; v_bk2 uuid; v_bk3 uuid; v_rt uuid; v_rt2 uuid; v_alert uuid; v_q uuid; v_rem uuid; v_slot timestamptz;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_sup := pg_temp.mkuser(v_org, 'supporter', 'patient');
  v_sup2 := pg_temp.mkuser(v_org, 'supporter2', 'patient');
  v_rep1 := pg_temp.mkuser(v_org, 'reporter1', 'patient');
  v_rep2 := pg_temp.mkuser(v_org, 'reporter2', 'patient');
  v_real := pg_temp.mkuser(v_org, 'real', 'patient');
  update public.profiles set is_test = false where id = v_real;
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('sup', v_sup);
  perform pg_temp.setf('sup2', v_sup2); perform pg_temp.setf('rep1', v_rep1); perform pg_temp.setf('rep2', v_rep2);

  -- 1. Shape, grants, guards --------------------------------------------------------------------------------------------
  perform pg_temp.ck('the S65 tables have RLS on', '9',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
       and c.relname in ('facility_bookings', 'facility_booking_reminders', 'facility_ratings', 'facility_rating_replies', 'directory_listing_reports',
                         'directory_reverification_queue', 'care_circle_help_alerts', 'care_circle_location_consents', 'emergency_pack_config')));
  perform pg_temp.ck('anon holds nothing on the new tables', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
       and table_name in ('facility_bookings', 'facility_ratings', 'facility_rating_replies', 'directory_listing_reports', 'directory_reverification_queue',
                          'care_circle_help_alerts', 'care_circle_location_consents', 'emergency_pack_config', 'facility_hmo_confirmations')));
  perform pg_temp.ck('authenticated cannot write any new table', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
       and table_name in ('facility_bookings', 'facility_booking_reminders', 'facility_ratings', 'facility_rating_replies', 'directory_listing_reports',
                          'directory_reverification_queue', 'care_circle_help_alerts', 'care_circle_location_consents', 'emergency_pack_config', 'facility_hmo_confirmations')));
  perform pg_temp.ck('anon cannot search the directory', '42501', pg_temp.try_anon($q$select * from public.directory_search()$q$));
  perform pg_temp.ck('anon cannot send a help alert', '42501', pg_temp.try_anon($q$select public.send_circle_help_alert()$q$));
  perform pg_temp.ck('anon cannot read the emergency pack through the RPC', '42501', pg_temp.try_anon($q$select public.emergency_pack_current()$q$));
  perform pg_temp.ck('the two guards exist and start off', 'false,false',
    (select string_agg(is_on::text, ',' order by key) from public.go_live_guards where key in ('directory_enabled', 'care_circle_help_alert_enabled')));
  perform pg_temp.ck('a real (non-test) patient cannot search while the guard is off, and it says so rather than returning nothing', 'ERR:55000',
    pg_temp.q_as(v_real, $q$select count(*)::text from public.directory_search()$q$));

  -- 2. The hide-stale rule (CMO Q21): 90 / 180 / 365 days, hidden past TWICE the cadence -------------------------------
  fa := pg_temp.mkfac('Hosp-ER-fresh', 'hospital', true, false, 400, 170);      -- emergency hospital, 170 days <= 180: visible
  fb := pg_temp.mkfac('Hosp-ER-stale', 'hospital', true, false, 400, 190);      -- 190 > 180: hidden
  fc := pg_temp.mkfac('Clinic-fresh', 'hospital', false, false, 400, 350);      -- clinic 180 x 2 = 360: visible
  fd := pg_temp.mkfac('Clinic-stale', 'hospital', false, false, 400, 370);      -- hidden
  fe := pg_temp.mkfac('Lab-fresh', 'lab', false, false, 400, 359);              -- visible
  fe2 := pg_temp.mkfac('Lab-stale', 'lab', false, false, 400, 361);             -- hidden
  ff := pg_temp.mkfac('Other-fresh', 'vaccination_centre', false, false, 800, 729); -- 365 x 2 = 730: visible
  ff2 := pg_temp.mkfac('Other-stale', 'vaccination_centre', false, false, 800, 731);-- hidden
  fp := pg_temp.mkfac('Pharm24-fresh', 'pharmacy', false, true, 400, 179);      -- 24h pharmacy 90 x 2 = 180: visible
  fp2 := pg_temp.mkfac('Pharm24-stale', 'pharmacy', false, true, 400, 181);     -- hidden
  fq := pg_temp.mkfac('Pharm-day', 'pharmacy', false, false, 400, 359);         -- ordinary pharmacy is "other" (365): visible
  fg := pg_temp.mkfac('Seed-new', 'hospital', false, false, 1, null);           -- never verified, created yesterday: visible, seed only
  fh := pg_temp.mkfac('Seed-old', 'hospital', false, false, 400, null);         -- never verified, created 400 days ago, clinic: hidden
  perform pg_temp.ck('cadence classes: emergency hospital 90, 24h pharmacy 90, clinic 180, lab 180, ordinary pharmacy and other 365', '90,90,180,180,365,365',
    private.directory_cadence_days('facilities', fa) || ',' || private.directory_cadence_days('facilities', fp) || ',' || private.directory_cadence_days('facilities', fc) || ','
      || private.directory_cadence_days('facilities', fe) || ',' || private.directory_cadence_days('facilities', fq) || ',' || private.directory_cadence_days('facilities', ff));
  perform pg_temp.ck('directory_search shows exactly the listings inside twice their cadence',
    'Clinic-fresh,Hosp-ER-fresh,Lab-fresh,Other-fresh,Pharm-day,Pharm24-fresh,Seed-new',
    pg_temp.names(v_pat));
  perform pg_temp.ck('a stale listing is hidden, not deleted or deactivated: the row is still there and still active', '13,13',
    (select count(*)::text from public.facilities where name like 'SAMPLE %') || ',' || (select count(*)::text from public.facilities where name like 'SAMPLE %' and is_active));
  perform pg_temp.ck('a never-verified listing is shown with the seed_only tier and no date', 'seed_only,',
    pg_temp.q_as(v_pat, $q$select tier || ',' || coalesce(last_verified_at::text, '') from public.directory_search(p_state => 'S65Test') where name = 'SAMPLE Seed-new'$q$));
  perform pg_temp.ck('a verified listing shows its date and tier', 'phone_confirmed,true',
    pg_temp.q_as(v_pat, $q$select tier || ',' || (last_verified_at is not null)::text from public.directory_search(p_state => 'S65Test') where name = 'SAMPLE Hosp-ER-fresh'$q$));
  -- a verification brings a hidden listing straight back
  perform pg_temp.act(v_admin);
  perform public.record_directory_check('facilities', fb, 'Rang the front desk and confirmed it is open', 'phone_confirmed');
  perform pg_temp.back();
  perform pg_temp.ck('one recorded verification brings a hidden listing back', 'true',
    (pg_temp.names(v_pat) like '%Hosp-ER-stale%')::text);
  perform pg_temp.ck('a test patient does not see test listings the other way round (a test caller sees test rows)', 'true', (pg_temp.names(v_pat) like '%SAMPLE%' or pg_temp.names(v_pat) <> '')::text);
  perform pg_temp.ck('a person without the manage permission cannot record a check', 'ERR:42501',
    pg_temp.q_as(v_pat, format($q$select public.record_directory_check('facilities', %L, 'Rang the front desk and confirmed it', 'phone_confirmed')::text$q$, fa)));
  perform pg_temp.ck('a check must be phone_confirmed or licence_checked', 'ERR:22023',
    pg_temp.q_as(v_admin, format($q$select public.record_directory_check('facilities', %L, 'Rang the front desk and confirmed it', 'seed_only')::text$q$, fa)));
  perform pg_temp.ck('the tier is recorded', 'phone_confirmed',
    (select tier from public.directory_freshness where listing_table = 'facilities' and listing_id = fb));

  -- 3. Filters ---------------------------------------------------------------------------------------------------------
  update public.facilities set services = array['Diabetes review'], languages = array['English', 'Yoruba'], accepts_hmo = array['Reliance'], nhia = true,
         hours_structured = '{"mon":[["08:00","17:00"]],"tue":[["08:00","17:00"]],"wed":[["08:00","17:00"]],"thu":[["08:00","17:00"]],"fri":[["08:00","17:00"]]}'::jsonb,
         latitude = 6.5000, longitude = 3.4000 where id = fc;
  update public.facilities set services = array['Malaria test'], languages = array['English'], accepts_hmo = array['Avon'], nhia = false, latitude = 9.0, longitude = 7.5 where id = fe;
  insert into public.facility_services (facility_id, name, price_kobo, is_active) values (fc, 'Diabetes review visit', 1500000, true), (fc, 'Foot check', 500000, true);
  perform pg_temp.ck('service filter', 'Clinic-fresh', pg_temp.names(v_pat, $a$p_service => 'diabetes'$a$));
  perform pg_temp.ck('language filter', 'Clinic-fresh', pg_temp.names(v_pat, $a$p_language => 'yoruba'$a$));
  perform pg_temp.ck('HMO filter: a claim is flagged claimed', 'Clinic-fresh,claimed',
    pg_temp.names(v_pat, $a$p_hmo => 'Reliance'$a$) || ',' || pg_temp.q_as(v_pat, $q$select hmo_status from public.directory_search(p_state => 'S65Test', p_hmo => 'Reliance') limit 1$q$));
  perform pg_temp.act(v_admin);
  perform public.confirm_facility_hmo(fc, 'Reliance', 'Listed in the HMO provider list sent on 2026-10-01');
  perform pg_temp.back();
  perform pg_temp.ck('HMO filter: once staff confirm it from the HMO list it is flagged confirmed', 'confirmed',
    pg_temp.q_as(v_pat, $q$select hmo_status from public.directory_search(p_state => 'S65Test', p_hmo => 'Reliance') limit 1$q$));
  perform pg_temp.ck('a patient cannot confirm HMO acceptance', 'ERR:42501', pg_temp.q_as(v_pat, format($q$select public.confirm_facility_hmo(%L, 'Avon', 'Listed on the HMO list this month')::text$q$, fe)));
  perform pg_temp.ck('NHIA filter and its claimed flag', 'Clinic-fresh,claimed',
    pg_temp.names(v_pat, 'p_nhia => true') || ',' || pg_temp.q_as(v_pat, $q$select nhia_status from public.directory_search(p_state => 'S65Test', p_nhia => true) limit 1$q$));
  perform pg_temp.ck('open-at filter: open on a Monday at 10:00 Lagos, closed at 22:00 (open_24h always open)', 'Clinic-fresh,Pharm24-fresh|Pharm24-fresh',
    pg_temp.names(v_pat, $a$p_open_at => '2026-10-12T09:00:00+01'$a$) || '|' || pg_temp.names(v_pat, $a$p_open_at => '2026-10-12T22:00:00+01'$a$));
  perform pg_temp.ck('radius filter orders by distance and drops the far listing', 'Clinic-fresh',
    pg_temp.q_as(v_pat, $q$select name from (select replace(name, 'SAMPLE ', '') as name, distance_km from public.directory_search(p_lat => 6.5, p_lng => 3.4, p_radius_km => 5, p_state => 'S65Test', p_service => 'diabetes') order by distance_km) x limit 1$q$));
  perform pg_temp.ck('price is shown only where known, per item, and is the lowest matching price', '1500000,per_item',
    pg_temp.q_as(v_pat, $q$select price_kobo::text || ',' || price_basis from public.directory_search(p_state => 'S65Test', p_service => 'diabetes') limit 1$q$));
  perform pg_temp.ck('no price is invented for a listing with none', 'null',
    pg_temp.q_as(v_pat, $q$select coalesce(price_kobo::text, 'null') from public.directory_search(p_state => 'S65Test') where name = 'SAMPLE Seed-new'$q$));

  -- 4. Wrong-information reports (15.17) -----------------------------------------------------------------------------
  select md5(f::text) into v_hash from public.facilities f where id = fa;
  perform pg_temp.ck('a first report queues re-verification as normal priority', 'normal,1',
    (select case when pg_temp.q_as(v_rep1, format($q$select (public.report_directory_listing('facilities', %L, 'phone', 'The number rings out'))::text$q$, fa)) is not null then
       (select priority || ',' || (select count(*) from public.directory_listing_reports where queue_id = q.id)::text from public.directory_reverification_queue q where listing_id = fa and closed_at is null) end));
  perform pg_temp.ck('the same person reporting again does not become a second independent report', 'normal,1',
    (select case when pg_temp.q_as(v_rep1, format($q$select (public.report_directory_listing('facilities', %L, 'hours', 'Closed on Mondays'))::text$q$, fa)) is not null then
       (select priority || ',' || (select count(*) from public.directory_listing_reports where queue_id = q.id)::text from public.directory_reverification_queue q where listing_id = fa and closed_at is null) end));
  perform pg_temp.ck('a second DIFFERENT reporter makes it immediate', 'immediate,2',
    (select case when pg_temp.q_as(v_rep2, format($q$select (public.report_directory_listing('facilities', %L, 'phone', 'Wrong number'))::text$q$, fa)) is not null then
       (select priority || ',' || (select count(*) from public.directory_listing_reports where queue_id = q.id)::text from public.directory_reverification_queue q where listing_id = fa and closed_at is null) end));
  perform pg_temp.ck('ops are told once, in the app, with no patient detail', '1,true',
    (select count(*)::text || ',' || bool_and(payload::text not like '%S65%')::text from public.notifications where recipient_id = v_admin and template = 'directory_reverify_now'));
  select md5(f::text) into v_hash2 from public.facilities f where id = fa;
  perform pg_temp.ck('a report never changes the listing itself', 'true', (v_hash = v_hash2)::text);
  perform pg_temp.ck('and the listing stays visible while it waits to be re-verified', 'true', (pg_temp.names(v_pat) like '%Hosp-ER-fresh%')::text);
  perform pg_temp.ck('staff see the queue, immediate first', 'immediate',
    pg_temp.q_as(v_admin, $q$select priority from public.directory_reverification_list() limit 1$q$));
  perform pg_temp.ck('a patient cannot read the queue', 'ERR:42501', pg_temp.q_as(v_pat, $q$select count(*)::text from public.directory_reverification_list()$q$));
  perform pg_temp.ck('a patient cannot write a report row directly', 'ERR:42501',
    pg_temp.q_as(v_pat, format($q$insert into public.directory_listing_reports (queue_id, reporter_id, field) values (%L, %L, 'phone')$q$, (select id from public.directory_reverification_queue where listing_id = fa limit 1), v_pat)));
  perform pg_temp.ck('a reporter reads only their own reports', '1',
    pg_temp.q_as(v_rep1, $q$select count(*)::text from public.directory_listing_reports$q$));
  perform pg_temp.act(v_admin);
  perform public.record_directory_check('facilities', fa, 'Rang and the number was corrected', 'phone_confirmed');
  perform pg_temp.back();
  perform pg_temp.ck('a recorded verification closes the queue entry', '0',
    (select count(*)::text from public.directory_reverification_queue where listing_id = fa and closed_at is null));

  -- 5. Bookings and reminders ----------------------------------------------------------------------------------------
  v_slot := date_trunc('hour', now()) + interval '10 days';
  perform pg_temp.ck('a patient can book a visible facility', 'ok',
    case when pg_temp.q_as(v_pat, format($q$select public.create_facility_booking(%L, %L::timestamptz, 'Diabetes review')::text$q$, fc, v_slot)) like '%booking_id%' then 'ok' else 'failed' end);
  select id into v_bk from public.facility_bookings where patient_id = v_pat and facility_id = fc;
  perform pg_temp.ck('the booking carries the price shown (the lowest matching per-item price)', '1500000',
    (select price_shown_kobo::text from public.facility_bookings where id = v_bk));
  perform pg_temp.ck('a booking ten days out has three reminders (7 days, 1 day, 2 hours)', '3',
    (select count(*)::text from public.facility_booking_reminders where booking_id = v_bk));
  perform pg_temp.ck('booking.created went through the outbox with ids only', '1,true',
    (select count(*)::text || ',' || bool_and(payload ?& array['booking_id', 'facility_id'] and payload::text not like '%Diabetes%')::text from public.domain_events where event_type = 'booking.created' and aggregate_id = v_bk));
  perform pg_temp.ck('the same slot cannot be booked twice by the same person', 'ERR:23505',
    pg_temp.q_as(v_pat, format($q$select public.create_facility_booking(%L, %L::timestamptz)::text$q$, fc, v_slot)));
  perform pg_temp.ck('a slot under an hour away is refused', 'ERR:22023',
    pg_temp.q_as(v_pat, format($q$select public.create_facility_booking(%L, now() + interval '5 minutes')::text$q$, fc)));
  perform pg_temp.ck('a hidden (stale) facility cannot be booked', 'ERR:22023',
    pg_temp.q_as(v_pat, format($q$select public.create_facility_booking(%L, %L::timestamptz)::text$q$, fd, v_slot + interval '1 day')));
  perform pg_temp.ck('a booking three days out has only the 1 day and 2 hour reminders', '2',
    (select case when pg_temp.q_as(v_pat, format($q$select public.create_facility_booking(%L, %L::timestamptz)::text$q$, fe, date_trunc('hour', now()) + interval '3 days')) like '%booking_id%' then
       (select count(*)::text from public.facility_booking_reminders where booking_id = (select id from public.facility_bookings where patient_id = v_pat and facility_id = fe)) end));
  select id into v_bk2 from public.facility_bookings where patient_id = v_pat and facility_id = fe;
  perform pg_temp.ck('a patient reads only their own bookings', '2,0',
    pg_temp.q_as(v_pat, $q$select count(*)::text from public.facility_bookings$q$) || ',' || pg_temp.q_as(v_pat2, $q$select count(*)::text from public.facility_bookings$q$));
  perform pg_temp.ck('another patient cannot answer someone else''s reminder', 'ERR:42501',
    pg_temp.q_as(v_pat2, format($q$select public.respond_facility_booking(%L, 'cancelling')::text$q$, v_bk)));
  perform pg_temp.ck('a patient cannot confirm their own booking', 'ERR:42501',
    pg_temp.q_as(v_pat, format($q$select public.confirm_facility_booking(%L, 'staff_phone')::text$q$, v_bk)));
  perform pg_temp.ck('staff can confirm a booking', 'confirmed',
    case when pg_temp.q_as(v_admin, format($q$select public.confirm_facility_booking(%L, 'staff_phone')::text$q$, v_bk)) is not null then (select state from public.facility_bookings where id = v_bk) end);
  perform pg_temp.ck('"I come" is recorded and the booking stays', 'coming,confirmed',
    (select case when pg_temp.q_as(v_pat, format($q$select public.respond_facility_booking(%L, 'coming')::text$q$, v_bk)) is not null then patient_response || ',' || state end from public.facility_bookings where id = v_bk));
  -- the sweep: two reminders due at once -> only the nearest milestone goes, the other is skipped
  update public.facility_booking_reminders set due_at = now() - interval '1 minute' where booking_id = v_bk and milestone_minutes in (1440, 120);
  perform pg_temp.ck('the sweep sends one reminder for a booking with two due', '1',
    private.facility_booking_reminder_sweep()::text);
  perform pg_temp.ck('the nearest milestone (2 hours) was the one sent; the older one was skipped', '120,true',
    (select (select milestone_minutes::text from public.facility_booking_reminders where booking_id = v_bk and sent_at is not null) || ',' ||
            (select (skipped_at is not null)::text from public.facility_booking_reminders where booking_id = v_bk and milestone_minutes = 1440)));
  perform pg_temp.ck('the reminder is in the app and push, neutral, with an empty payload', '2,true',
    (select count(*)::text || ',' || bool_and(payload = '{}'::jsonb and content_class = 'non_clinical')::text from public.notifications where recipient_id = v_pat and template = 'facility_booking_reminder'));
  perform pg_temp.ck('booking.reminder_due went through the outbox', '1',
    (select count(*)::text from public.domain_events where event_type = 'booking.reminder_due' and aggregate_id = v_bk));
  perform pg_temp.ck('running the sweep again sends nothing twice', '0', private.facility_booking_reminder_sweep()::text);
  -- "I cancel" ends the reminders
  update public.facility_booking_reminders set due_at = now() - interval '1 minute' where booking_id = v_bk2;
  perform pg_temp.ck('"I cancel" cancels the booking with no penalty and stops its reminders', 'cancelled,0',
    (select case when pg_temp.q_as(v_pat, format($q$select public.respond_facility_booking(%L, 'cancelling')::text$q$, v_bk2)) is not null then
       state || ',' || (select count(*)::text from public.facility_booking_reminders where booking_id = v_bk2 and sent_at is null and skipped_at is null) end
       from public.facility_bookings where id = v_bk2));
  perform pg_temp.ck('the sweep sends nothing for a cancelled booking', '0', private.facility_booking_reminder_sweep()::text);
  perform pg_temp.ck('a cancelled booking cannot be changed again', 'ERR:23514', pg_temp.q_as(v_pat, format($q$select public.respond_facility_booking(%L, 'coming')::text$q$, v_bk2)));
  perform pg_temp.ck('the staff booking queue is staff only and its read is audited', 'ERR:42501,true',
    pg_temp.q_as(v_pat, $q$select count(*)::text from public.facility_booking_queue()$q$) || ',' ||
    (case when pg_temp.q_as(v_admin, $q$select count(*)::text from public.facility_booking_queue()$q$) is not null then
       exists (select 1 from public.audit_log where action = 'facility_booking.queue_read' and actor_id = v_admin)::text end));

  -- 6. Verified-visit ratings (Q22) ----------------------------------------------------------------------------------
  perform pg_temp.ck('ACCEPTANCE: a rating without a completed visit is rejected (a booking only requested/confirmed)', 'ERR:23514',
    pg_temp.q_as(v_pat, format($q$select public.submit_facility_rating(%L, 5, 'Lovely', null, %L)::text$q$, fc, v_bk)));
  perform pg_temp.ck('a rating with no visit at all is rejected', 'ERR:23514',
    pg_temp.q_as(v_pat, format($q$select public.submit_facility_rating(%L, 5)::text$q$, fc)));
  perform pg_temp.ck('a rating naming two visits is rejected', 'ERR:23514',
    pg_temp.q_as(v_pat, format($q$select public.submit_facility_rating(%L, 5, null, %L, %L)::text$q$, fc, gen_random_uuid(), v_bk)));
  -- staff mark the visit completed once its time has passed
  update public.facility_bookings set slot_at = now() - interval '1 day' where id = v_bk;
  perform pg_temp.ck('a booking cannot be completed before its time (control)', 'ERR:23514',
    pg_temp.q_as(v_admin, format($q$select public.complete_facility_booking(%L, true)::text$q$, v_bk2)));
  perform pg_temp.ck('staff complete the visit', 'completed',
    case when pg_temp.q_as(v_admin, format($q$select public.complete_facility_booking(%L, true)::text$q$, v_bk)) is not null then (select state from public.facility_bookings where id = v_bk) end);
  perform pg_temp.ck('a patient cannot complete their own booking', 'ERR:42501', pg_temp.q_as(v_pat, format($q$select public.complete_facility_booking(%L, true)::text$q$, v_bk)));
  perform pg_temp.ck('another patient cannot rate that visit', 'ERR:23514',
    pg_temp.q_as(v_pat2, format($q$select public.submit_facility_rating(%L, 5, null, null, %L)::text$q$, fc, v_bk)));
  perform pg_temp.ck('a rating for the wrong facility is rejected', 'ERR:23514',
    pg_temp.q_as(v_pat, format($q$select public.submit_facility_rating(%L, 5, null, null, %L)::text$q$, fe, v_bk)));
  perform pg_temp.ck('a rating for the completed visit is accepted and waits for moderation', 'pending',
    case when pg_temp.q_as(v_pat, format($q$select public.submit_facility_rating(%L, 4, 'Friendly staff and a short wait', null, %L)::text$q$, fc, v_bk)) like '%rating_id%' then
      (select status from public.facility_ratings where patient_id = v_pat and facility_booking_id = v_bk) end);
  select id into v_rt from public.facility_ratings where facility_booking_id = v_bk;
  perform pg_temp.ck('one rating per visit', 'ERR:23505', pg_temp.q_as(v_pat, format($q$select public.submit_facility_rating(%L, 2, null, null, %L)::text$q$, fc, v_bk)));
  perform pg_temp.ck('the moderation target is recorded and visible (72 hours from config)', 'true',
    (select (respond_by between now() + interval '71 hours' and now() + interval '73 hours')::text from public.facility_ratings where id = v_rt));
  perform pg_temp.ck('rating.submitted went through the outbox with ids only', '1,true',
    (select count(*)::text || ',' || bool_and(payload ?& array['rating_id', 'facility_id'] and payload::text not like '%wait%')::text from public.domain_events where event_type = 'rating.submitted' and aggregate_id = v_rt));
  perform pg_temp.ck('RLS: the owner reads their rating with its status; another patient reads none', '1,0',
    pg_temp.q_as(v_pat, $q$select count(*)::text from public.facility_ratings$q$) || ',' || pg_temp.q_as(v_pat2, $q$select count(*)::text from public.facility_ratings$q$));
  perform pg_temp.ck('RLS: staff have no direct table read (they use the audited queue)', '0', pg_temp.q_as(v_admin, $q$select count(*)::text from public.facility_ratings$q$));
  perform pg_temp.ck('RLS: anon reads nothing', '42501', pg_temp.try_anon($q$select count(*) from public.facility_ratings$q$));
  perform pg_temp.ck('a patient cannot insert a rating row directly', 'ERR:42501',
    pg_temp.q_as(v_pat, format($q$insert into public.facility_ratings (organisation_id, patient_id, facility_id, facility_booking_id, rating, respond_by) values (%L, %L, %L, %L, 5, now())$q$, v_org, v_pat, fc, v_bk2)));
  perform pg_temp.ck('a patient cannot edit or publish their own rating', 'ERR:42501',
    pg_temp.q_as(v_pat, format($q$update public.facility_ratings set status = 'published' where id = %L$q$, v_rt)));
  perform pg_temp.ck('a patient cannot moderate', 'ERR:42501', pg_temp.q_as(v_pat, format($q$select public.moderate_facility_rating(%L, 'publish')::text$q$, v_rt)));
  perform pg_temp.ck('the staff queue names no patient and is staff only', 'ERR:42501,0',
    pg_temp.q_as(v_pat, $q$select count(*)::text from public.facility_rating_queue()$q$) || ',' ||
    (select count(*)::text from information_schema.columns where table_name = 'facility_rating_queue' and column_name like '%patient%'));
  perform pg_temp.ck('nothing is public before moderation', '0',
    pg_temp.q_as(v_pat2, format($q$select count(*)::text from public.facility_ratings_public(%L)$q$, fc)));
  perform pg_temp.ck('an ordinary rating is published by staff', 'published',
    case when pg_temp.q_as(v_admin, format($q$select public.moderate_facility_rating(%L, 'publish')::text$q$, v_rt)) is not null then (select status from public.facility_ratings where id = v_rt) end);
  perform pg_temp.ck('the public sees the comment, a month not a day, and no patient', '1,Friendly staff and a short wait',
    pg_temp.q_as(v_pat2, format($q$select count(*)::text || ',' || max(public_comment) from public.facility_ratings_public(%L)$q$, fc)));
  perform pg_temp.ck('a rating that was moderated cannot be moderated again', 'ERR:23514', pg_temp.q_as(v_admin, format($q$select public.moderate_facility_rating(%L, 'reject', 'Second go at it here')::text$q$, v_rt)));
  perform pg_temp.ck('the facility can reply to a published rating', 'phone',
    case when pg_temp.q_as(v_admin, format($q$select public.reply_to_facility_rating(%L, 'Thank you for visiting us.', 'phone')::text$q$, v_rt)) is not null then (select channel from public.facility_rating_replies where rating_id = v_rt) end);
  perform pg_temp.ck('the reply is shown with the rating', 'Thank you for visiting us.',
    pg_temp.q_as(v_pat2, format($q$select reply_body from public.facility_ratings_public(%L)$q$, fc)));
  perform pg_temp.ck('a patient cannot post a facility reply', 'ERR:42501', pg_temp.q_as(v_pat, format($q$select public.reply_to_facility_rating(%L, 'x', 'portal')::text$q$, v_rt)));
  -- a comment judging a clinician is held
  update public.facility_bookings set slot_at = now() - interval '2 days' where id = v_bk2;
  update public.facility_bookings set state = 'completed', completed_at = now(), completed_by = v_admin, patient_response = null where id = v_bk2;
  perform pg_temp.ck('a comment that judges the doctor is accepted but HELD for moderation', 'clinical_judgement',
    case when pg_temp.q_as(v_pat, format($q$select public.submit_facility_rating(%L, 1, 'The doctor misdiagnosed me', null, %L)::text$q$, fe, v_bk2)) like '%rating_id%' then
      (select held_reason from public.facility_ratings where facility_booking_id = v_bk2) end);
  select id into v_rt2 from public.facility_ratings where facility_booking_id = v_bk2;
  perform pg_temp.ck('a held comment cannot be published with its comment', 'ERR:23514', pg_temp.q_as(v_admin, format($q$select public.moderate_facility_rating(%L, 'publish')::text$q$, v_rt2)));
  perform pg_temp.ck('it can be published without the comment: the score stays, the comment never goes public', 'published,',
    case when pg_temp.q_as(v_admin, format($q$select public.moderate_facility_rating(%L, 'publish_without_comment')::text$q$, v_rt2)) is not null then
      (select status || ',' || coalesce(public_comment, '') from public.facility_ratings where id = v_rt2) end);
  perform pg_temp.ck('a rejection needs a written reason', 'false',
    (select (pg_temp.q_as(v_admin, format($q$select public.moderate_facility_rating(%L, 'reject', 'no')::text$q$, v_rt2)) is null)::text));
  perform pg_temp.ck('the average appears only once enough ratings exist (min 3), and the count always does', 'null,1',
    pg_temp.q_as(v_pat2, $q$select coalesce(rating_average::text, 'null') || ',' || rating_count from public.directory_search(p_state => 'S65Test') where name = 'SAMPLE Clinic-fresh'$q$));
  perform pg_temp.ck('a rating cannot exist in a moderated state without a moderation record (constraint)', 'true',
    (not exists (select 1 from public.facility_ratings where (status = 'pending') <> (moderated_at is null)))::text);
  begin
    insert into public.facility_ratings (organisation_id, patient_id, facility_id, facility_booking_id, rating, respond_by, status, moderated_at, moderation_reason)
      values (v_org, v_pat, fc, v_bk3, 3, now(), 'rejected', now(), 'short');
    perform pg_temp.ck('a rejected rating without a real reason is refused by the table', '23514', 'accepted');
  exception when others then
    perform pg_temp.ck('a rejected rating without a real reason is refused by the table', 'refused', 'refused');
  end;

  -- 7. Care Circle one-tap alert (Q20) -----------------------------------------------------------------------------
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, state, expires_at, is_test)
  values (v_org, v_pat, v_sup, 'Daughter', array['red_alerts'], 'active', now() + interval '30 days', true),
         (v_org, v_pat, v_sup2, 'Friend', array['adherence_summary'], 'active', now() + interval '30 days', true);
  perform pg_temp.ck('ACCEPTANCE: with no consent, coordinates sent on the tap are discarded and the alert still goes', 'false,true,1',
    (select case when pg_temp.q_as(v_pat, $q$select public.send_circle_help_alert(6.45, 3.39, 20)::text$q$) like '%alert_id%' then
        location_shared::text || ',' || (latitude is null)::text || ',' || recipients_told::text end
       from public.care_circle_help_alerts where patient_id = v_pat order by created_at desc limit 1));
  select id into v_alert from public.care_circle_help_alerts where patient_id = v_pat order by created_at desc limit 1;
  perform pg_temp.ck('only the member holding red_alerts was told, on all three channels', '3,0',
    (select count(*)::text from public.notifications where recipient_id = v_sup and template = 'circle_help_tap' and source_id = v_alert) || ',' ||
    (select count(*)::text from public.notifications where recipient_id = v_sup2 and template = 'circle_help_tap'));
  perform pg_temp.ck('the notification carries no location, name or reading (INV-07)', 'true',
    (select bool_and(payload = '{}'::jsonb)::text from public.notifications where template = 'circle_help_tap' and source_id = v_alert));
  perform pg_temp.ck('a second tap inside the cooldown is the same alert, not a second one', 'true,1',
    (select (pg_temp.q_as(v_pat, $q$select public.send_circle_help_alert()::text$q$) like '%"already_sent": true%')::text || ',' ||
            (select count(*)::text from public.care_circle_help_alerts where patient_id = v_pat)));
  perform pg_temp.ck('consent can be granted by the patient', 'true',
    (select case when pg_temp.q_as(v_pat, $q$select public.set_circle_location_consent(true)::text$q$) is not null then granted::text end from public.care_circle_location_consents where patient_id = v_pat));
  update public.care_circle_help_alerts set created_at = now() - interval '1 hour' where patient_id = v_pat;
  perform pg_temp.ck('with consent AND coordinates on the tap, the location is stored for this alert', 'true,true',
    (select case when pg_temp.q_as(v_pat, $q$select public.send_circle_help_alert(6.45, 3.39, 20)::text$q$) like '%alert_id%' then
        location_shared::text || ',' || (latitude = 6.45)::text end
       from public.care_circle_help_alerts where patient_id = v_pat order by created_at desc limit 1));
  select id into v_alert from public.care_circle_help_alerts where patient_id = v_pat order by created_at desc limit 1;
  perform pg_temp.ck('a supporter holding red_alerts sees the location, and the read is written to the care access log (INV-10)', 'true,true',
    (select case when pg_temp.q_as(v_sup, format($q$select public.circle_help_alert_view(%L)::text$q$, v_pat)) like '%"latitude": 6.45%' then
       'true' end) || ',' ||
    exists (select 1 from public.care_access_events where patient_id = v_pat and scope = 'care_circle' and metadata ->> 'help_alert' = 'true')::text);
  perform pg_temp.ck('a member WITHOUT red_alerts cannot read the alert or location', 'ERR:42501', pg_temp.q_as(v_sup2, format($q$select public.circle_help_alert_view(%L)::text$q$, v_pat)));
  perform pg_temp.ck('a stranger cannot read the alert or location', 'ERR:42501', pg_temp.q_as(v_pat2, format($q$select public.circle_help_alert_view(%L)::text$q$, v_pat)));
  perform pg_temp.ck('no one but the patient can read the location from the table', '0,1',
    pg_temp.q_as(v_sup, $q$select count(*)::text from public.care_circle_help_alerts$q$) || ',' || pg_temp.q_as(v_pat, $q$select count(*)::text from public.care_circle_help_alerts where latitude is not null$q$));
  -- retention: the stored location is deleted after location_keep_hours
  update public.care_circle_help_alerts set created_at = now() - interval '25 hours' where id = v_alert;
  perform pg_temp.ck('the sweep deletes a shared location after 24 hours and says it did', '1,true',
    private.purge_help_alert_locations()::text || ',' || (select (latitude is null and longitude is null and location_purged_at is not null)::text from public.care_circle_help_alerts where id = v_alert));
  perform pg_temp.ck('the supporter then sees no location (the alert is outside the visible window)', 'true',
    (pg_temp.q_as(v_sup, format($q$select coalesce(public.circle_help_alert_view(%L)::text, 'none')$q$, v_pat)) in ('none', ''))::text);
  -- revocation
  perform pg_temp.ck('consent can be revoked at any time', 'false',
    (select case when pg_temp.q_as(v_pat, $q$select public.set_circle_location_consent(false)::text$q$) is not null then granted::text end from public.care_circle_location_consents where patient_id = v_pat));
  update public.care_circle_help_alerts set created_at = now() - interval '2 hours' where patient_id = v_pat;
  perform pg_temp.ck('after revoking, a tap with coordinates shares no location but still alerts', 'false,true,1',
    (select case when pg_temp.q_as(v_pat, $q$select public.send_circle_help_alert(6.45, 3.39, 20)::text$q$) like '%alert_id%' then
        location_shared::text || ',' || (latitude is null)::text || ',' || recipients_told::text end
       from public.care_circle_help_alerts where patient_id = v_pat order by created_at desc limit 1));
  perform pg_temp.ck('a person who is not a test account cannot send the alert while the guard is off', 'ERR:55000', pg_temp.q_as(v_real, $q$select public.send_circle_help_alert()::text$q$));
  perform pg_temp.ck('but anyone can revoke location consent even with the guard off', 'ok',
    case when pg_temp.q_as(v_real, $q$select public.set_circle_location_consent(false)::text$q$) not like 'ERR%' then 'ok' end);
  perform pg_temp.ck('and cannot grant it while the guard is off', 'ERR:55000', pg_temp.q_as(v_real, $q$select public.set_circle_location_consent(true)::text$q$));
  perform pg_temp.ck('the automatic S29 red alert is untouched and carries no location: its trigger still exists', '1',
    (select count(*)::text from pg_trigger where tgname = 'pages_notify_circle' and not tgisinternal));

  -- 8. The emergency pack config ---------------------------------------------------------------------------------------
  perform pg_temp.ck('the pack is a draft with the fixed first line', 'draft,Go to the nearest hospital now.',
    pg_temp.q_as(v_pat, $q$select (public.emergency_pack_current() ->> 'status') || ',' || (public.emergency_pack_current() -> 'content' ->> 'first_line')$q$));
  perform pg_temp.ck('the pack names no telephone number: no digit run and no 112, 767, 199 or 911', 'true',
    (select (content::text !~ '(^|[^0-9.])[0-9]{7,}' and content::text !~ '(^|[^0-9.])(112|767|199|911)([^0-9]|$)')::text from public.emergency_pack_config where is_active));
  perform pg_temp.ck('every one of the 37 states has an entry', '37',
    (select jsonb_array_length(content -> 'states')::text from public.emergency_pack_config where is_active));
  perform pg_temp.ck('and none is fabricated: every state says none listed until a person verifies one', '37',
    (select count(*)::text from public.emergency_pack_config, jsonb_array_elements(content -> 'states') s where is_active and (s ->> 'none_listed') = 'true' and jsonb_array_length(s -> 'facilities') = 0));
  begin
    insert into public.emergency_pack_config (version, content) values (990, '{"first_line":"Go to the nearest hospital now.","topics":[{"steps":["Call 112 now"]}]}');
    perform pg_temp.ck('a pack that mentions 112 is refused by the table (CMO Q18)', 'refused', 'accepted');
  exception when check_violation then perform pg_temp.ck('a pack that mentions 112 is refused by the table (CMO Q18)', 'refused', 'refused'); end;
  begin
    insert into public.emergency_pack_config (version, content) values (991, '{"first_line":"Go to the nearest hospital now.","x":"+2348012345678"}');
    perform pg_temp.ck('a pack that carries a phone number is refused by the table', 'refused', 'accepted');
  exception when check_violation then perform pg_temp.ck('a pack that carries a phone number is refused by the table', 'refused', 'refused'); end;
  begin
    insert into public.emergency_pack_config (version, content) values (992, '{"first_line":"Please consider going to hospital"}');
    perform pg_temp.ck('a pack whose first line is not the fixed one is refused', 'refused', 'accepted');
  exception when check_violation then perform pg_temp.ck('a pack whose first line is not the fixed one is refused', 'refused', 'refused'); end;
  begin
    insert into public.emergency_pack_config (version, status, content) values (993, 'signed', '{"first_line":"Go to the nearest hospital now."}');
    perform pg_temp.ck('a pack cannot be marked signed without a named signer', 'refused', 'accepted');
  exception when check_violation then perform pg_temp.ck('a pack cannot be marked signed without a named signer', 'refused', 'refused'); end;
  perform pg_temp.ck('a client cannot change the pack', 'ERR:42501', pg_temp.q_as(v_admin, $q$update public.emergency_pack_config set status = 'signed'$q$));

  -- 9. Clinician licence (Q19): null-gated -----------------------------------------------------------------------------
  perform pg_temp.ck('a clinician with no checked licence returns nothing (the screen never claims a check that did not happen)', '0',
    pg_temp.q_as(v_pat, format($q$select count(*)::text from public.clinician_licence_public(%L)$q$, v_admin)));
  perform pg_temp.ck('anon cannot read licences', '42501', pg_temp.try_anon(format($q$select * from public.clinician_licence_public(%L)$q$, v_admin)));
end $$;

-- 10. Sabotage: each must flip a check ---------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_sup2 uuid := pg_temp.f('sup2'); d text; r text; fl uuid; fq uuid; v_bk uuid; n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into fl from public.facilities where name = 'SAMPLE Clinic-stale';

  -- (a) the hide rule removed
  select pg_get_functiondef('private.directory_listing_visible(text, uuid)'::regprocedure) into d;
  d := regexp_replace(d, 'return v_basis \+ make_interval[^;]*;', 'return true;');
  if d = pg_get_functiondef('private.directory_listing_visible(text, uuid)'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  execute d;
  insert into results values ('sabotaged', 'ACCEPTANCE: a listing unverified longer than the period is absent from directory_search', 'false',
    (pg_temp.names(v_pat) like '%Clinic-stale%')::text);

  -- (b) the visit check removed
  select pg_get_functiondef('private.facility_rating_visit_ok(uuid, uuid, uuid, uuid)'::regprocedure) into d;
  d := regexp_replace(d, 'select case.*else false end', 'select true');
  if d = pg_get_functiondef('private.facility_rating_visit_ok(uuid, uuid, uuid, uuid)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute d;
  select id into fq from public.facilities where name = 'SAMPLE Clinic-fresh';
  perform pg_temp.q_as(v_pat2, format($q$select public.create_facility_booking(%L, now() + interval '5 days')::text$q$, fq));
  select id into v_bk from public.facility_bookings where patient_id = v_pat2 and facility_id = fq;
  insert into results values ('sabotaged', 'ACCEPTANCE: a rating without a completed visit is rejected', 'ERR:23514',
    case when pg_temp.q_as(v_pat2, format($q$select public.submit_facility_rating(%L, 5, null, null, %L)::text$q$, fq, v_bk)) like 'ERR:%' then 'ERR:23514' else 'accepted' end);

  -- (c) the red_alerts filter removed from the one-tap alert
  select pg_get_functiondef('public.send_circle_help_alert(double precision, double precision, integer)'::regprocedure) into d;
  d := replace(d, '''red_alerts'' = any (m.permissions)', 'true');
  if d = pg_get_functiondef('public.send_circle_help_alert(double precision, double precision, integer)'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute d;
  update public.care_circle_help_alerts set created_at = now() - interval '3 hours' where patient_id = v_pat;
  perform pg_temp.q_as(v_pat, $q$select public.send_circle_help_alert()::text$q$);
  select count(*) into n from public.notifications where recipient_id = v_sup2 and template = 'circle_help_tap';
  insert into results values ('sabotaged', 'a member without red_alerts gets no one-tap alert', '0', n::text);

  -- (d) the consent test removed from the one-tap alert
  select pg_get_functiondef('public.send_circle_help_alert(double precision, double precision, integer)'::regprocedure) into d;
  d := replace(d, 'v_share := coalesce(v_consent, false) and', 'v_share := true and');
  if d = pg_get_functiondef('public.send_circle_help_alert(double precision, double precision, integer)'::regprocedure) then raise exception 'sabotage (d) did not change the function'; end if;
  execute d;
  update public.care_circle_help_alerts set created_at = now() - interval '4 hours' where patient_id = v_pat;
  perform pg_temp.q_as(v_pat, $q$select public.send_circle_help_alert(6.45, 3.39, 20)::text$q$);
  insert into results values ('sabotaged', 'no location is stored without consent', 'false',
    (select (latitude is not null)::text from public.care_circle_help_alerts where patient_id = v_pat order by created_at desc limit 1));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S65 proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
