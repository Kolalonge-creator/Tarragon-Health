-- Proof: outreach health checks on group screening days (migration *_outreach_screening_days.sql, decisions OD-01 to OD-04).
--   A. Creating: an admin creates a free and a paid outreach day; a patient cannot; anon cannot call any outreach function.
--   B. Confirming: a free day confirms with no price, total or payer; a paid day is priced from the active outreach price
--      (1,500,000 kobo a head, less any discount); the price can only be changed by an admin with a change note, as a new version.
--   C. Free day: an attendee is registered without any payment, enrolled to their own account, and gets ONE self-arranged yearly-panel
--      lab order (no provider, nothing billed) and NO consultation credit. Enrolling twice is refused. A voucher cannot be issued.
--   D. Paid day: enrolment is refused until the group has paid in full; once paid, the attendee gets the lab order and exactly one
--      extra-meeting credit, active, expiring in 60 days, which the booking rule counts (has_available_service_credit) although they
--      are not a Member. An attendee who already has a yearly-panel order in flight gets it reused, not a second one.
--   E. Vitals: on-site staff holding only screening_days.run record readings into vitals_readings (taken now, staff-logged, outreach
--      note); a second recording, a recording before enrolment and a patient caller are all refused.
--   F. Privacy (I9): the attendee reads their own enrolment; another patient and the paying contact read none, though the payer still
--      sees the slot list.
--   H. Fixes from review: a paid day cannot be confirmed without a named patient payer; a slot registered with a phone number
--      links only to the account holding that number; an implausible reading (54 for 5.4) is refused; the consultation credit
--      carries no amount (the group's payment is the money); an untouched outreach lab form does not stop a later Member
--      starting their own yearly panel, while one already acted on still does.
--   G. SABOTAGE: the enrolment policy opened (the payer now reads the enrolment, so F was the policy); the on-site permission check
--      forced true (a patient can enrol someone, so A/E refusals were that check); the outreach flag removed from the lab-order origin
--      rule (enrolment can no longer create the order, so C relied on that exact exception); the untouched-outreach exclusion
--      removed from start_annual_bundle (the form blocks the panel again, so H5 was that exclusion).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'osd-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'OSD ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true,
    phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- run p_sql as p_uid, returning the first column as text, or 'ERR <sqlstate>:<message>'
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_can(p_sig text) returns text language sql as
$$ select has_function_privilege('anon', p_sig, 'EXECUTE')::text $$;

do $$
declare
  v_org uuid; v_admin uuid; v_runner uuid; v_payer uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_other uuid;
  v_free uuid; v_paid uuid; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_r text; v_order uuid; v_order2 uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    select id into v_org from public.organisations order by created_at limit 1;
  end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_runner := pg_temp.mkuser(v_org, 'runner', 'care_coordinator');
  v_payer := pg_temp.mkuser(v_org, 'payer', 'patient');
  v_p1 := pg_temp.mkuser(v_org, 'attendee-1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'attendee-2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'attendee-3', 'patient');
  v_other := pg_temp.mkuser(v_org, 'bystander', 'patient');
  update public.profiles set phone = '+2348011111111' where id = v_p1;
  -- the on-site runner holds only screening_days.run, not the commercial permission
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_runner, 'screening_days.run', v_admin);

  -- ===== A. Creating =====
  v_r := pg_temp.q_as(v_admin, format($q$select (public.create_outreach_day('outreach_free', 'Proof Church', '+2348012345678', 'Surulere', %L, 5) ->> 'screening_day_id')$q$, current_date + 7));
  v_free := v_r::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select (public.create_outreach_day('outreach_paid', 'Proof Ltd', null, 'Ikeja', %L, 2) ->> 'screening_day_id')$q$, current_date + 7));
  v_paid := v_r::uuid;
  perform pg_temp.rec('A1 an admin creates a free and a paid outreach day', 'outreach_free,outreach_paid',
    (select string_agg(kind, ',' order by kind) from public.screening_days where id in (v_free, v_paid)));
  perform pg_temp.rec('A2 neither carries a test bundle', '0',
    (select count(*)::text from public.screening_days where id in (v_free, v_paid) and panel_bundle_id is not null));
  v_r := pg_temp.q_as(v_p1, format($q$select public.create_outreach_day('outreach_free', 'X', null, 'Y', %L, 3)::text$q$, current_date + 7));
  perform pg_temp.rec('A3 a patient cannot create one', 'true', (v_r like 'ERR 42501:%')::text);
  v_r := pg_temp.q_as(v_runner, format($q$select public.create_outreach_day('outreach_free', 'X', null, 'Y', %L, 3)::text$q$, current_date + 7));
  perform pg_temp.rec('A4 nor can on-site staff without the commercial permission', 'true', (v_r like 'ERR 42501:%')::text);
  perform pg_temp.rec('A5 anon cannot create, enrol or record vitals', 'false,false,false',
    pg_temp.anon_can('public.create_outreach_day(text,text,text,text,date,integer,text)') || ',' ||
    pg_temp.anon_can('public.enrol_outreach_attendee(uuid,uuid)') || ',' ||
    pg_temp.anon_can('public.record_outreach_vitals(uuid,jsonb)'));

  -- ===== B. Confirming =====
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 5, null)::text$q$, v_free));
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 2, 0)::text$q$, v_paid));
  perform pg_temp.rec('H1 a paid day cannot be confirmed without a named payer', 'true', (v_r like 'ERR 22023:%name the person who will pay%')::text);
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 2, 0, %L)::text$q$, v_paid, v_runner));
  perform pg_temp.rec('H2 ...and the payer must be a patient account', 'true', (v_r like 'ERR 22023:%name the person who will pay%')::text);
  perform pg_temp.rec('B1 a free day confirms with no price, total or payer', 'confirmed|||',
    (select status || '|' || coalesce(price_per_head_kobo::text, '') || '|' || coalesce(total_kobo::text, '') || '|' || coalesce(payer_profile_id::text, '')
       from public.screening_days where id = v_free));
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 2, 0, %L)::text$q$, v_paid, v_payer));
  perform pg_temp.rec('B2 a paid day is priced from the active outreach price (2 x 1,500,000)', '1500000|3000000',
    (select price_per_head_kobo || '|' || total_kobo from public.screening_days where id = v_paid));
  v_r := pg_temp.q_as(v_runner, $q$select public.set_outreach_day_price(2000000, 'a runner trying to change the price')::text$q$);
  perform pg_temp.rec('B3 only an admin can change the price', 'true', (v_r like 'ERR 42501:%')::text);
  v_r := pg_temp.q_as(v_admin, $q$select public.set_outreach_day_price(2000000, 'short')::text$q$);
  perform pg_temp.rec('B4 a change needs a real change note', 'true', (v_r like 'ERR 22023:%')::text);
  v_r := pg_temp.q_as(v_admin, $q$select public.set_outreach_day_price(2000000, 'proof: a new version replaces the old one')::text$q$);
  perform pg_temp.rec('B5 a change is a new active version; the old one stays as history', '1|2000000|2',
    (select count(*) filter (where is_active) || '|' || max(price_per_head_kobo) filter (where is_active) || '|' || count(*)
       from public.outreach_day_prices));
  perform pg_temp.rec('B6 ...and the already-confirmed day keeps its frozen price', '1500000',
    (select price_per_head_kobo::text from public.screening_days where id = v_paid));

  -- ===== C. Free day =====
  v_r := pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Attendee One', '+2348011111111')::text$q$, v_free));
  v_s1 := v_r::uuid;
  perform pg_temp.rec('C1 on-site staff register an attendee on a free day with no payment', 'true', (v_s1 is not null)::text);
  v_r := pg_temp.q_as(v_runner, format($q$select public.record_outreach_vitals(%L, '{"weight_kg": 70}'::jsonb)::text$q$, v_s1));
  perform pg_temp.rec('C2 vitals cannot be recorded before enrolment', 'true', (v_r like 'ERR 22023:%enrol the attendee%')::text);
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s1, v_p2));
  perform pg_temp.rec('H3 a slot registered with a phone number links only to the account holding it', 'true',
    (v_r like 'ERR 22023:%does not match%')::text);
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s1, v_p1));
  v_order := (select lab_order_id from public.outreach_enrolments where slot_id = v_s1);
  perform pg_temp.rec('C3 enrolment makes one self-arranged yearly-panel order, unbilled, with no lab named', 'membership_annual|self_arranged|patient_initiated|0||ordered',
    (select panel_code || '|' || fulfilment || '|' || origin || '|' || total_kobo || '|' || coalesce(provider_id::text, '') || '|' || status
       from public.lab_orders where id = v_order));
  perform pg_temp.rec('C4 a free place has no consultation credit', 'true',
    (select (consult_purchase_id is null)::text from public.outreach_enrolments where slot_id = v_s1));
  perform pg_temp.rec('C5 the slot is marked enrolled, with no voucher', 'issued|true|',
    (select status || '|' || outreach_enrolled || '|' || coalesce(voucher_id::text, '') from public.screening_day_slots where id = v_s1));
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s1, v_p1));
  perform pg_temp.rec('C6 enrolling the same slot again is refused', 'true', (v_r like 'ERR 22023:%already enrolled%')::text);
  v_r := pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Bystander', null)::text$q$, v_free));
  v_s4 := v_r::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.issue_screening_day_voucher(%L, %L)::text$q$, v_s4, v_other));
  perform pg_temp.rec('C7 a voucher cannot be issued on an outreach day', 'true', (v_r like 'ERR 22023:%no voucher%')::text);
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s4, v_runner));
  perform pg_temp.rec('C8 only a patient account can be enrolled', 'true', (v_r like 'ERR 22023:%own Tarragon account%')::text);

  -- ===== D. Paid day =====
  v_r := pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Paid One', null)::text$q$, v_paid));
  perform pg_temp.rec('D1 an unpaid paid day takes no attendees', 'true', (v_r like 'ERR %paid for in full%')::text);
  update public.screening_days set amount_paid_kobo = total_kobo where id = v_paid;   -- the group's Paystack payment, simulated
  v_s2 := pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Paid One', null)::text$q$, v_paid))::uuid;
  v_s3 := pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Paid Two', null)::text$q$, v_paid))::uuid;
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s2, v_p2));
  perform pg_temp.rec('D2 the paid attendee gets one active extra-meeting credit, expiring in 60 days, paid by the group', 'video_visit_credit|active|0|60|true',
    (select prod.code || '|' || sp.status || '|' || sp.amount_kobo || '|' || round(extract(epoch from (sp.expires_at - sp.purchased_at)) / 86400) || '|' ||
            (sp.purchaser_profile_id = v_payer)::text
       from public.outreach_enrolments e join public.service_purchases sp on sp.id = e.consult_purchase_id
       join public.service_products prod on prod.id = sp.service_product_id where e.slot_id = v_s2));
  perform pg_temp.rec('D3 ...which the booking rule counts though they are not a Member', 'true|true',
    (private.patient_membership_tier(v_p2) is null)::text || '|' || private.has_available_service_credit(v_p2, 'video_visit_credit')::text);
  -- attendee one, already enrolled on the free day, comes to the paid day too: their lab form is reused
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s3, v_p1));
  v_order2 := (select lab_order_id from public.outreach_enrolments where slot_id = v_s3);
  perform pg_temp.rec('D4 an attendee with a yearly-panel order in flight gets it reused, not a second one', 'true|1',
    (v_order2 = v_order)::text || '|' ||
    (select count(*)::text from public.lab_orders where patient_id = v_p1 and panel_code = 'membership_annual'));

  -- ===== E. Vitals =====
  v_r := pg_temp.q_as(v_runner, format($q$select public.record_outreach_vitals(%L,
           '{"bp_readings": [{"systolic": 128, "diastolic": 82}, {"systolic": 126, "diastolic": 80}], "glucose_mmol_l": 5.4, "weight_kg": 72.5}'::jsonb)::text$q$, v_s2));
  perform pg_temp.rec('E1 on-site staff record readings into vitals_readings, staff-logged, with the outreach note', '4|4',
    (select count(*)::text from public.vitals_readings where patient_id = v_p2 and logged_by_profile_id = v_runner
        and note = 'Taken at an outreach health check' and taken_at > now() - interval '1 minute') || '|' ||
    (select coalesce(array_length(vitals_reading_ids, 1), 0)::text from public.outreach_enrolments where slot_id = v_s2));
  v_r := pg_temp.q_as(v_runner, format($q$select public.record_outreach_vitals(%L, '{"weight_kg": 73}'::jsonb)::text$q$, v_s2));
  perform pg_temp.rec('E2 a second recording is refused', 'true', (v_r like 'ERR 22023:vitals_already_recorded%')::text);
  v_r := pg_temp.q_as(v_runner, format($q$select public.record_outreach_vitals(%L, '{"glucose_mmol_l": 54}'::jsonb)::text$q$, v_s3));
  perform pg_temp.rec('H4 an implausible reading (54 for 5.4) is refused', 'true', (v_r like 'ERR 22023:reading_out_of_range%')::text);
  v_r := pg_temp.q_as(v_p1, format($q$select public.record_outreach_vitals(%L, '{"weight_kg": 73}'::jsonb)::text$q$, v_s1));
  perform pg_temp.rec('E3 a patient cannot record vitals', 'true', (v_r like 'ERR 42501:%')::text);
  v_r := pg_temp.q_as(v_p1, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s4, v_other));
  perform pg_temp.rec('E4 a patient cannot enrol anyone', 'true', (v_r like 'ERR 42501:%')::text);

  -- ===== F. Privacy =====
  perform pg_temp.rec('F1 the attendee reads their own enrolment', '1',
    pg_temp.q_as(v_p2, format($q$select count(*)::text from public.outreach_enrolments where slot_id = %L$q$, v_s2)));
  perform pg_temp.rec('F2 another patient reads none', '0',
    pg_temp.q_as(v_other, $q$select count(*)::text from public.outreach_enrolments$q$));
  perform pg_temp.rec('F3 the paying contact reads no enrolment...', '0',
    pg_temp.q_as(v_payer, $q$select count(*)::text from public.outreach_enrolments$q$));
  perform pg_temp.rec('F4 ...though they still see the slot list they paid for', '2',
    pg_temp.q_as(v_payer, format($q$select count(*)::text from public.screening_day_slots where screening_day_id = %L$q$, v_paid)));

  -- ===== H. The yearly panel after an outreach lab form =====
  -- attendee three has an untouched outreach lab form from the free day
  v_s5 := pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Attendee Three', null)::text$q$, v_free))::uuid;
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s5, v_p3));
  v_r := pg_temp.q_as(v_p2, $q$select public.start_annual_bundle()::text$q$);
  perform pg_temp.rec('H5 an untouched outreach lab form does not stop the patient starting their own yearly panel', 'true', (v_r !~ '^ERR')::text);
  update public.lab_orders set status = 'sample_collected' where id = v_order;   -- attendee one acted on theirs
  v_r := pg_temp.q_as(v_p1, $q$select public.start_annual_bundle()::text$q$);
  perform pg_temp.rec('H6 one already acted on still counts as this year''s panel', 'true', (v_r like 'ERR 22023:annual_bundle_already_started%')::text);

  -- ===== G. SABOTAGE =====
  execute replace(pg_get_functiondef('public.start_annual_bundle(uuid,uuid)'::regprocedure),
                  ' and not private.is_untouched_outreach_panel_order(o.id)', '');
  v_r := pg_temp.q_as(v_p3, $q$select public.start_annual_bundle()::text$q$);
  perform pg_temp.rec('G4 SABOTAGE exclusion removed: the untouched outreach form blocks the panel again (so H5 was the exclusion)', 'true',
    (v_r like 'ERR 22023:annual_bundle_already_started%')::text);
  execute 'drop policy outreach_enrolments_select on public.outreach_enrolments';
  execute 'create policy outreach_enrolments_select on public.outreach_enrolments for select to authenticated using (true)';
  perform pg_temp.rec('G1 SABOTAGE enrolment policy opened: the payer now reads enrolments (so F3 was the policy)', '2',
    pg_temp.q_as(v_payer, format($q$select count(*)::text from public.outreach_enrolments where screening_day_id = %L$q$, v_paid)));
  execute $s$ create or replace function private.can_run_outreach_day() returns boolean language sql stable security definer set search_path = '' as $b$ select true $b$ $s$;
  v_r := pg_temp.q_as(v_p1, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s4, v_other));
  perform pg_temp.rec('G2 SABOTAGE on-site check forced true: a patient can enrol someone (so E4 was that check)', 'true', (v_r not like 'ERR 42501:%')::text);
  execute replace(pg_get_functiondef('private.enforce_lab_order_origin()'::regprocedure),
                  $x$or (coalesce(current_setting('tarragon.outreach_enrol', true), '') = 'on' and new.fulfilment = 'self_arranged')$x$, '');
  v_r := pg_temp.q_as(v_admin, format($q$select public.add_screening_day_slot(%L, 'Late', null)::text$q$, v_free));
  -- a fresh attendee with no lab order of any kind, so the enrolment really has to create one
  v_r := pg_temp.q_as(v_admin, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_r::uuid,
                                      pg_temp.mkuser(v_org, 'attendee-4', 'patient')));
  perform pg_temp.rec('G3 SABOTAGE outreach flag removed from the origin rule: enrolment can no longer make the order (so C3 used that exception)', 'true',
    (v_r like 'ERR 23514:%')::text);

  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'outreach screening days proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'outreach screening days: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
