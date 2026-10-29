-- Proof: extra online meeting (5,000 naira, paid members only) and the coordinator booking a Member's monthly meeting
-- (migration *_extra_meeting_and_monthly_booking.sql).
--   A. The product: on sale at 500,000 kobo, hidden from the public price list, every other doctor-time product still cannot be switched on;
--      a Member can start buying one, a Free patient is refused with the Membership message; a credit granted by hand (already active) is
--      not touched by the rule.
--   B. Booking: a Free patient booking an extra meeting for themselves is refused (upgrade_first, "You need..."); a coordinator booking for
--      a Free patient is refused ("This patient needs..."); a Member is let through for themselves and via a coordinator; staff booking for a
--      Free patient are not held to the rule.
--   C. The included monthly meeting: a care coordinator of the patient's organisation sees the offered times and picks one for the Member;
--      the booking is confirmed, free of charge (waived), stamped coordinator_phone and attributed to the coordinator, and the month is
--      marked booked. Another patient, the doctor who made the offer, and a coordinator of another organisation get nothing / are refused.
--   D. SABOTAGE: the coordinator check forced false (the pick is refused); the Membership trigger removed (a Free patient can start buying);
--      the tier gate removed from hold (a Free patient can book themselves). Each must flip, or the proof is vacuous.
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

create function pg_temp.j(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := jsonb_build_object('err', sqlstate, 'msg', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;

create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;

do $$
declare
  v_org uuid; v_org2 uuid; v_admin uuid; v_doc uuid; v_cc uuid; v_cc2 uuid; v_pm uuid; v_pm2 uuid; v_pf uuid; v_prod uuid;
  v0 timestamptz;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_h text; v_r jsonb; v_id text; v_slot uuid; v_slot2 uuid; v_appt uuid; v_cnt integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  -- a clean database has one organisation; the cross-organisation checks must never be skipped, so make a second (rolled back with the rest)
  if v_org2 is null then
    insert into public.organisations (name, type) values ('Proof other organisation', 'direct_consumer') returning id into v_org2;
  end if;
  perform pg_temp.rec('C-pre a second organisation exists for the cross-organisation checks', 'true', (v_org2 is not null and v_org2 <> v_org)::text);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', (current_date - interval '45 years')::date);
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician', (current_date - interval '40 years')::date, 'female');
  v_cc := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator', (current_date - interval '30 years')::date);
  v_pm := pg_temp.mkuser(v_org, 'member', 'patient', (current_date - interval '68 years')::date);
  v_pm2 := pg_temp.mkuser(v_org, 'member-2', 'patient', (current_date - interval '66 years')::date);
  v_pf := pg_temp.mkuser(v_org, 'free', 'patient', (current_date - interval '70 years')::date);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, granted_by, grant_reason, is_test)
  values (v_org, v_pm, 'granted', 'active', now() - interval '1 day', v_admin, 'proof fixture membership', true),
         (v_org, v_pm2, 'granted', 'active', now() - interval '1 day', v_admin, 'proof fixture membership', true);

  update public.consultation_policy_config set config = config || '{"bookingLeadMinutes":5,"bookingHorizonDays":21}'::jsonb where is_active;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty,
                                     indemnity_exempt, indemnity_exempt_by, credential_type, credential_number, credential_verified_at, credential_verified_by, doctor_tier)
  values (v_org, v_doc, 'CPB doctor', true, true, array['en'], now() - interval '10 days', now() + interval '1 year', 'General practice', true, v_admin,
          'MDCN', 'MDCN/CPB-A', now() - interval '5 days', v_admin, 'senior_medical_officer');
  -- the doctor is tied to the two Members (lead) and has confirmed hours tomorrow 09:00-15:00 Lagos
  set local session_replication_role = replica;
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test)
  values (v_org, v_pm, v_doc, 'active', 'admin', 1, true), (v_org, v_pm2, v_doc, 'active', 'admin', 1, true);
  set local session_replication_role = origin;
  v0 := (date_trunc('day', now() at time zone 'Africa/Lagos') + interval '1 day 9 hours') at time zone 'Africa/Lagos';
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, confirmed_by, confirmed_at, is_test)
  values (v_org, v_doc, v0, v0 + interval '6 hours', 'bookable_consultations', 'confirmed', v_admin, now(), true);

  select id into v_prod from public.service_products where code = 'video_visit_credit';

  -- ===== A. the product =====
  perform pg_temp.rec('A1 the extra meeting is on sale at 500000 kobo as "Extra online meeting"', 'true/500000/Extra online meeting',
    (select is_active::text || '/' || price_kobo::text || '/' || name from public.service_products where code = 'video_visit_credit'));
  perform pg_temp.rec('A2 it is not on the public price list (members only)', '0',
    (select count(*)::text from public.public_price_list() where code = 'video_visit_credit'));
  perform pg_temp.rec('A3 another doctor-time product still cannot be switched on (23514)', '23514',
    pg_temp.try($q$update public.service_products set is_active = true where code = 'async_consult_credit'$q$));
  v_id := pg_temp.q_as(v_pm, format($q$select public.record_service_purchase_intent(%L, 'video_visit_credit')::text$q$, v_pm));
  perform pg_temp.rec('A4 a Member can start buying one', 'true', (v_id !~ '^ERR:')::text);
  perform pg_temp.rec('A5 at 500000 kobo', '500000',
    (select amount_kobo::text from public.service_purchases where patient_id = v_pm and service_product_id = v_prod order by created_at desc limit 1));
  v_id := pg_temp.q_as(v_pf, format($q$select public.record_service_purchase_intent(%L, 'video_visit_credit')::text$q$, v_pf));
  perform pg_temp.rec('A6 a Free patient is refused with the Membership message', 'true',
    (v_id like 'ERR:P0001:%extra online meeting is part of Membership%')::text);
  perform pg_temp.rec('A7 nothing was created for the Free patient', '0', (select count(*)::text from public.service_purchases where patient_id = v_pf));
  perform pg_temp.rec('A8 a credit granted by hand (already active) is not stopped by the rule', 'ok',
    pg_temp.try(format($q$insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
                          values (%L, %L, %L, 'active', 500000, 'NGN', 0, now())$q$, v_org, v_pf, v_prod)));
  -- spend that credit so the Free patient is Free-with-no-credit again for section B
  update public.service_purchases set redeemed_at = now(), redeemed_entity_type = 'appointment', redeemed_entity_id = gen_random_uuid() where patient_id = v_pf;

  -- ===== B. booking =====
  v_h := pg_temp.hold_as(v_pf, v_pf, v_doc, v_start);
  perform pg_temp.rec('B1 a Free patient booking an extra meeting themselves is refused ("You need...", upgrade_first)', 'true',
    (v_h like 'ERR P0001:You need to join Membership%|upgrade_first')::text);
  v_h := pg_temp.hold_as(v_cc, v_pf, v_doc, v_start);
  perform pg_temp.rec('B2 a coordinator booking for a Free patient is refused ("This patient needs...", upgrade_first)', 'true',
    (v_h like 'ERR P0001:This patient needs to join Membership%|upgrade_first')::text);
  v_h := pg_temp.hold_as(v_doc, v_pf, v_doc, v_start);
  perform pg_temp.rec('B3 staff booking for a Free patient are held to the rule too (an unpayable hold would never be released)', 'true',
    (v_h like 'ERR P0001:This patient needs to join Membership%|upgrade_first')::text);
  v_h := pg_temp.hold_as(v_pm, v_pm, v_doc, v_start + interval '1 day');
  perform pg_temp.rec('B4 a Member booking for themselves is let through', 'true', (v_h !~ '^ERR')::text);
  v_h := pg_temp.hold_as(v_cc, v_pm, v_doc, v_start + interval '2 days');
  perform pg_temp.rec('B5 a coordinator booking for a Member is let through and stamped coordinator_phone', 'coordinator_phone',
    coalesce((select booked_via from public.appointments where id = case when v_h !~ '^ERR' then v_h::uuid end), v_h));

  -- ===== C. the included monthly meeting, booked by the coordinator =====
  v_r := pg_temp.j(v_doc, format($q$select public.offer_followup_slots(%L, array[%L::timestamptz, %L::timestamptz], 'monthly', null)$q$,
                                 v_pm, v0, v0 + interval '30 minutes'));
  perform pg_temp.rec('C0 the tied doctor offers two times', 'offered|2', (v_r ->> 'status') || '|' || (v_r ->> 'slots'));
  v_r := pg_temp.j(v_cc, format('select public.my_followups(%L)', v_pm));
  perform pg_temp.rec('C1 the coordinator sees one offer with two open times', '1|2',
    jsonb_array_length(v_r -> 'offers')::text || '|' || jsonb_array_length(v_r -> 'offers' -> 0 -> 'slots')::text);
  v_slot := (v_r -> 'offers' -> 0 -> 'slots' -> 0 ->> 'slot_id')::uuid;
  perform pg_temp.rec('C1b the coordinator''s read of the Member''s meeting left a care-access line (booking scope, monthly_offers)', '1',
    (select count(*)::text from public.care_access_events where patient_id = v_pm and actor_profile_id = v_cc and kind = 'record_viewed'
        and scope = 'booking' and metadata ->> 'stage' = 'monthly_offers'));
  v_r := pg_temp.j(v_pf, format('select public.my_followups(%L)', v_pm));
  perform pg_temp.rec('C2 an unrelated patient sees nothing of it', '0', jsonb_array_length(v_r -> 'offers')::text);
  v_r := pg_temp.j(v_doc, format('select public.my_followups(%L)', v_pm));
  perform pg_temp.rec('C3 the doctor who made the offer is not admitted by this function either', '0', jsonb_array_length(v_r -> 'offers')::text);
  if v_org2 is not null then
    v_cc2 := pg_temp.mkuser(v_org2, 'coordinator-other-org', 'care_coordinator', (current_date - interval '30 years')::date);
    -- mkuser leaves the organisation of a profile the signup trigger already made, so set it explicitly
    update public.profiles set organisation_id = v_org2 where id = v_cc2;
    perform pg_temp.rec('C3b the other-organisation coordinator really is in another organisation', 'true',
      (select (organisation_id = v_org2 and organisation_id <> v_org)::text from public.profiles where id = v_cc2));
    v_r := pg_temp.j(v_cc2, format('select public.my_followups(%L)', v_pm));
    perform pg_temp.rec('C4 a coordinator of another organisation sees nothing', '0', jsonb_array_length(v_r -> 'offers')::text);
    v_r := pg_temp.j(v_cc2, format('select public.pick_followup_slot(%L, false)', v_slot));
    perform pg_temp.rec('C5 and cannot pick (42501)', '42501', coalesce(v_r ->> 'err', 'picked'));
  end if;
  v_r := pg_temp.j(v_pf, format('select public.pick_followup_slot(%L, false)', v_slot));
  perform pg_temp.rec('C6 an unrelated patient cannot pick it (42501)', '42501', coalesce(v_r ->> 'err', 'picked'));

  v_r := pg_temp.j(v_cc, format('select public.pick_followup_slot(%L, false)', v_slot));
  perform pg_temp.rec('C7 the coordinator picks the time for the Member', 'booked', coalesce(v_r ->> 'status', v_r ->> 'msg'));
  v_appt := (v_r ->> 'appointment_id')::uuid;
  perform pg_temp.rec('C8 the booking is confirmed and free (waived)', 'confirmed/waived',
    (select status::text || '/' || payment_status::text from public.appointments where id = v_appt));
  perform pg_temp.rec('C9 it is stamped coordinator_phone and attributed to the coordinator', 'coordinator_phone/' || v_cc::text,
    (select booked_via || '/' || booked_by::text from public.appointments where id = v_appt));
  perform pg_temp.rec('C10 the month is marked booked against it', 'booked',
    (select state from public.member_followup_entitlements where patient_id = v_pm and appointment_id = v_appt));
  perform pg_temp.rec('C11 no purchase was made for it', '0', (select count(*)::text from public.service_purchases where patient_id = v_pm and created_at > now() - interval '1 minute' and status = 'active'));
  perform pg_temp.act(v_pm);
  select count(*) into v_cnt from public.appointments where id = v_appt;
  perform pg_temp.back();
  perform pg_temp.rec('C12 the Member sees it on their own list', '1', v_cnt::text);

  -- ===== E. the other two routes to the same product =====
  v_id := pg_temp.q_as(v_pm, format($q$select public.create_sponsored_service_reservation(%L, '+2348012345678', 'Ada')::text$q$, v_prod));
  perform pg_temp.rec('E1 a sponsor cannot reserve an extra meeting (the recipient is only a phone number, so Membership cannot be checked)', 'true',
    (v_id like 'ERR:23514:%extra online meeting can only be bought by a Member for themselves%')::text);
  v_id := pg_temp.try_msg(format($q$insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)$q$, v_org, v_pf, gen_random_uuid()));
  perform pg_temp.rec('E2 the older video-visit request path refuses a Free patient with the Membership message', 'true',
    (v_id like 'P0001:An extra online meeting is part of Membership%')::text);
  v_id := pg_temp.try_msg(format($q$insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)$q$, v_org, v_pm, gen_random_uuid()));
  perform pg_temp.rec('E3 a Member is not stopped by the Membership rule on that path', 'true', (v_id not like '%part of Membership%')::text);

  -- ===== D. SABOTAGE =====
  v_r := pg_temp.j(v_doc, format($q$select public.offer_followup_slots(%L, array[%L::timestamptz], 'monthly', null)$q$, v_pm2, v0 + interval '60 minutes'));
  v_slot2 := (select id from public.followup_offer_slots where offer_id = (v_r ->> 'offer_id')::uuid limit 1);
  execute $s$ create or replace function private.is_care_coordinator_for(p_patient uuid) returns boolean language sql stable security definer set search_path to '' as $b$ select false $b$ $s$;
  v_r := pg_temp.j(v_cc, format('select public.pick_followup_slot(%L, false)', v_slot2));
  perform pg_temp.rec('D1 SABOTAGE coordinator check forced false: the same coordinator is refused (so C7 was the coordinator check)', '42501', coalesce(v_r ->> 'err', 'picked'));
  execute 'drop trigger service_purchases_extra_meeting_members_only on public.service_purchases';
  v_id := pg_temp.q_as(v_pf, format($q$select public.record_service_purchase_intent(%L, 'video_visit_credit')::text$q$, v_pf));
  perform pg_temp.rec('D2 SABOTAGE Membership trigger removed: a Free patient can start buying (so A6 was the trigger)', 'true', (v_id !~ '^ERR:')::text);
  execute replace(pg_get_functiondef('private.pin_video_visit_amount()'::regprocedure), 'if not coalesce(private.patient_is_member(new.patient_id), false) then', 'if false then');
  v_id := pg_temp.try_msg(format($q$insert into public.video_visit_requests (organisation_id, patient_id, slot_id) values (%L, %L, %L)$q$, v_org, v_pf, gen_random_uuid()));
  perform pg_temp.rec('D4 SABOTAGE Membership check removed from the older path: the Free patient is no longer refused with the Membership message (so E2 was that check)', 'true',
    (v_id not like '%part of Membership%')::text);
  execute $s$ create or replace function private.patient_membership_tier(p_patient uuid) returns text language sql stable security definer set search_path to '' as $b$ select 'plus'::text $b$ $s$;
  v_h := pg_temp.hold_as(v_pf, v_pf, v_doc, v_start + interval '4 days');
  perform pg_temp.rec('D3 SABOTAGE tier check satisfied: a Free patient can book themselves (so B1 was the tier gate)', 'true', (v_h !~ '^ERR')::text);

  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'extra meeting proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'extra meeting and monthly booking: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
