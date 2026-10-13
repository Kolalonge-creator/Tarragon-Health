-- Two-tier code-review decisions (2026-10-12), one rolled-back transaction. Migrations:
--   *_two_tier_refund_window_and_immediate_end, *_two_tier_one_member_rule_and_legacy_conversion, *_two_tier_grace_followup_booking,
--   *_two_tier_renewals_included_second_opinion_member_only.
--   R. Refund: refused after 21 days, filed inside it; approving it ends the Membership at once (state ended, Free, entitlement
--      revoked, offers withdrawn, booked follow-up cancelled, months closed, hand-off task); a Membership from an organisation seat
--      is not ended by a personal refund.
--   L. Legacy holders: a programme holder and a plan-feature purchaser are NOT Members until converted; conversion makes a real
--      Membership with the holder's own end date (no free year), is idempotent, skips existing Members and expired holders, and an
--      admin profile is never a Member.
--   G. Grace booking: a Member inside the 14 day grace is offered and can pick exactly one follow-up (month 13); a second is refused;
--      a lapsed person and a refunded (ended) person cannot.
--   P. Renewals are decided at the monthly review: the standalone request is closed for a Member (told so), a Free person is told it is
--      part of Membership, a held credit still works for a non-Member; a Member adds a note to the next review (Free refused, too long
--      refused, nothing notified); the second opinion is hidden from the anonymous public price list.
--   S. Second opinion: sold at 500,000 kobo to a Member only; Free, lapsed and ended refused by the purchase function AND by the
--      table trigger; no other doctor-time product can be switched on.
-- SABOTAGE (each must flip its check): the refund window removed; the immediate end replaced by the old grace; the legacy clause put
--   back into patient_is_member_at; the grace row creation removed; the Member closure removed from the renewal trigger; the Member
--   check removed from the second-opinion trigger and function; the second opinion filter removed from the public price list.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table tm(k text primary key, v timestamptz) on commit drop;
grant all on tm to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.t(p text) returns timestamptz language sql as $$ select v from tm where k = p $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
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
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.owner_try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.exec_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rd-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'RD ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_label text, p_admin uuid, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'RD ' || p_label, 'MDCN', 'RD-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, p_admin, true);
  return v;
end $f$;
-- a Membership: starts_ago_days ago, ends in p_ends_in_days (negative: ended that long ago), and tied to the lead doctor
create function pg_temp.mkmember(p_org uuid, p_patient uuid, p_starts_ago_days numeric, p_ends_in_days numeric, p_source text default 'purchase') returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, granted_by, grant_reason, is_test)
  values (p_org, p_patient, p_source, now() - make_interval(secs => (p_starts_ago_days * 86400)::int), now() + make_interval(secs => (p_ends_in_days * 86400)::int),
          case when p_source = 'granted' then pg_temp.f('admin') end, case when p_source = 'granted' then 'Granted in the review decisions proof' end, true)
  returning id into v;
  return v;
end $f$;
create function pg_temp.tie(p_org uuid, p_patient uuid, p_doc uuid) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test)
  values (p_org, p_patient, p_doc, 'active', 'admin', 1, true);
  set local session_replication_role = origin;
end $f$;
-- a paid membership order with its entitlement; returns the order id
create function pg_temp.mkorder(p_org uuid, p_patient uuid, p_paid_days_ago numeric) returns uuid
language plpgsql as $f$
declare v_item uuid; v_price uuid; v_order uuid;
begin
  select id into v_item from public.catalog_items where code = 'membership_annual' and organisation_id = p_org limit 1;
  select id into v_price from private.current_price(v_item);
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (p_org, p_patient, p_patient, v_item, v_price, 12000000, 0, 12000000, 'paid', now() - make_interval(secs => (p_paid_days_ago * 86400)::int),
          'rd_' || replace(gen_random_uuid()::text, '-', ''), true) returning id into v_order;
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, is_test)
  values (p_org, p_patient, v_order, 'membership', now() - make_interval(secs => (p_paid_days_ago * 86400)::int), now() + interval '300 days', true);
  return v_order;
end $f$;

-- 0. Fixtures ------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_d uuid; v0 timestamptz;
begin
  select organisation_id into v_org from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_d := pg_temp.mkstaff(v_org, 'doc', v_admin, 'senior_medical_officer');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('d', v_d);
  v0 := (date_trunc('day', now() at time zone 'Africa/Lagos') + interval '1 day 9 hours') at time zone 'Africa/Lagos';
  insert into tm values ('v0', v0);
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, confirmed_by, confirmed_at, is_test)
  values (v_org, v_d, v0, v0 + interval '6 hours', 'bookable_consultations', 'confirmed', v_admin, now(), true);
  perform pg_temp.setf('free', pg_temp.mkuser(v_org, 'free', 'patient'));
end $$;

-- R. Refund -----------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_d uuid := pg_temp.f('d');
        late uuid; ok uuid; o_late uuid; o_ok uuid; r text; v_ref uuid; v_mem uuid; v0 timestamptz := pg_temp.t('v0');
        v_appt uuid; v_off jsonb; seat uuid; o_seat uuid;
begin
  ok := pg_temp.mkuser(v_org, 'refund_ok', 'patient'); late := pg_temp.mkuser(v_org, 'refund_late', 'patient');
  perform pg_temp.tie(v_org, ok, v_d);
  perform pg_temp.setf('refund_ok', ok); perform pg_temp.setf('refund_late', late);
  perform pg_temp.ck('R0 the window is 21 days from versioned config', '21', private.membership_refund_window_days()::text);

  o_late := pg_temp.mkorder(v_org, late, 22);
  r := pg_temp.q_as(late, format($q$select public.request_order_refund(%L, 'Changed my mind later')::text$q$, o_late));
  perform pg_temp.ck('R1 22 days after purchase the refund is refused with a plain word', 'outside_refund_window', (r::jsonb ->> 'result'));
  perform pg_temp.ck('R1b and nothing is filed', '0', (select count(*)::text from public.refunds where order_id = o_late));

  o_ok := pg_temp.mkorder(v_org, ok, 20);
  v_mem := pg_temp.mkmember(v_org, ok, 20, 345);
  r := pg_temp.q_as(ok, format($q$select public.request_order_refund(%L, 'Changed my mind in time')::text$q$, o_ok));
  perform pg_temp.ck('R2 20 days after purchase it is filed', 'requested', (r::jsonb ->> 'result'));
  select id into v_ref from public.refunds where order_id = o_ok;

  -- an open offer and a booked follow-up that the end must cancel
  v_off := private.create_followup_offer(v_d, ok, array[v0 + interval '60 minutes', v0 + interval '90 minutes']::timestamptz[], 'monthly', null);
  perform pg_temp.ck('R3 the Member was offered times', 'offered', v_off ->> 'status');
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status, payment_status)
  values (v_org, ok, v_d, 'gp', 'in_person', now() + interval '2 days', now() + interval '2 days 15 minutes', 'confirmed', 'not_required') returning id into v_appt;
  update public.member_followup_entitlements set state = 'booked', appointment_id = v_appt where membership_id = v_mem and month_index = 2;
  perform pg_temp.ck('R4 before the refund: a Member', 'true', private.patient_is_member(ok)::text);

  r := pg_temp.q_as(v_admin, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_ref));
  perform pg_temp.ck('R5 approved', 'approved/true', (r::jsonb ->> 'result') || '/' || (r::jsonb ->> 'membership_ended'));
  perform pg_temp.ck('R6 the Membership is ENDED, not in a grace', 'ended', (select state from public.patient_memberships where id = v_mem));
  perform pg_temp.ck('R7 the person is Free at once', 'false', private.patient_is_member(ok)::text);
  perform pg_temp.ck('R8 the entitlement is revoked', 'revoked', (select state from public.entitlements where order_id = o_ok));
  perform pg_temp.ck('R9 the open offer is withdrawn', '0', (select count(*)::text from public.followup_offers where patient_id = ok and status = 'open'));
  perform pg_temp.ck('R10 the booked follow-up is cancelled', 'provider_cancelled', (select status::text from public.appointments where id = v_appt));
  perform pg_temp.ck('R11 no month is left bookable', '0', (select count(*)::text from public.member_followup_entitlements where membership_id = v_mem and state in ('available', 'booked')));
  perform pg_temp.ck('R12 a hand-off task goes to a doctor', '1', (select count(*)::text from public.clinical_tasks where patient_id = ok and type = 'membership_handoff'));
  perform pg_temp.ck('R13 the end is audited', '1', (select count(*)::text from public.audit_log where entity_id = v_mem and action = 'membership.ended_now'));

  -- an organisation seat is not ended by a personal refund
  seat := pg_temp.mkuser(v_org, 'seat', 'patient');
  o_seat := pg_temp.mkorder(v_org, seat, 5);
  perform pg_temp.mkmember(v_org, seat, 5, 360, 'employer');
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test) values (v_org, o_seat, 12000000, 'seat proof refund', seat, true) returning id into v_ref;
  perform pg_temp.q_as(v_admin, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_ref));
  perform pg_temp.ck('R14 an organisation seat Membership is untouched by a personal refund', 'active/true',
    (select state from public.patient_memberships where patient_id = seat) || '/' || private.patient_is_member(seat)::text);
end $$;

-- L. Legacy holders ---------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_prog uuid; a uuid; b uuid; c uuid; e uuid; adm uuid := pg_temp.f('admin'); v_sp uuid; v_pp uuid; n integer; v_end timestamptz; noend uuid;
begin
  select id into v_prog from public.chronic_condition_programmes limit 1;
  a := pg_temp.mkuser(v_org, 'leg_prog', 'patient'); b := pg_temp.mkuser(v_org, 'leg_plan', 'patient');
  c := pg_temp.mkuser(v_org, 'leg_member', 'patient'); e := pg_temp.mkuser(v_org, 'leg_expired', 'patient');
  perform pg_temp.setf('leg_prog', a); perform pg_temp.setf('leg_plan', b);
  noend := pg_temp.mkuser(v_org, 'leg_noend', 'patient');
  -- the programme pricing and protocol triggers are bypassed for this legacy fixture only (a programme cannot be activated without a signed protocol)
  set local session_replication_role = replica;
  insert into public.programme_purchases (organisation_id, patient_id, programme_id, status, price_kobo, duration_weeks, starts_at, ends_at, purchased_at)
  values (v_org, a, v_prog, 'active', 100, 12, current_date - 10, current_date + 40, now() - interval '10 days');
  set local session_replication_role = origin;
  select id into v_sp from public.service_products where code = 'complete_pack';
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, payment_provider, purchased_at, expires_at)
  values (v_org, b, b, v_sp, 'active', 100, 'NGN', 'paystack', now() - interval '2 days', now() + interval '60 days');
  -- already a Member: skipped. Expired plan purchase: not converted.
  perform pg_temp.mkmember(v_org, c, 10, 300);
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, payment_provider, purchased_at, expires_at)
  values (v_org, c, c, v_sp, 'active', 100, 'NGN', 'paystack', now() - interval '2 days', now() + interval '60 days'),
         (v_org, e, e, v_sp, 'active', 100, 'NGN', 'paystack', now() - interval '90 days', now() - interval '3 days');
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, payment_provider, purchased_at, expires_at)
  values (v_org, noend, noend, v_sp, 'active', 100, 'NGN', 'paystack', now() - interval '2 days', null);

  perform pg_temp.ck('L1 a programme holder is NOT a Member before conversion (one meaning of Member)', 'false', private.patient_is_member(a)::text);
  perform pg_temp.ck('L2 a plan-feature purchaser is NOT a Member before conversion', 'false', private.patient_is_member(b)::text);
  perform pg_temp.ck('L3 an admin profile is not a Member', 'false', private.patient_is_member(adm)::text);

  n := private.convert_legacy_programme_holders();
  perform pg_temp.ck('L4 the programme holder, the plan purchaser and the no-end-date holder are converted (not the Member, not the expired)', '3', n::text);
  select ends_at into v_end from public.patient_memberships where patient_id = a;
  perform pg_temp.ck('L5 the programme holder keeps THEIR end date, no free year', 'true',
    (v_end = ((select ends_at + 1 from public.programme_purchases where patient_id = a)::timestamp at time zone 'Africa/Lagos'))::text);
  perform pg_temp.ck('L6 source and state', 'legacy_conversion/active', (select source || '/' || state from public.patient_memberships where patient_id = a));
  perform pg_temp.ck('L7 the plan purchaser ends when their purchase does', 'true',
    (select (abs(extract(epoch from (m.ends_at - sp.expires_at))) < 1)::text from public.patient_memberships m, public.service_purchases sp where m.patient_id = b and sp.patient_id = b));
  perform pg_temp.ck('L8 both are Members now', 'true/true', private.patient_is_member(a)::text || '/' || private.patient_is_member(b)::text);
  perform pg_temp.ck('L9 the monthly follow-up months exist', 'true', (select (count(*) >= 1)::text from public.member_followup_entitlements where patient_id = a));
  perform pg_temp.ck('L10 one audit row each', '3', (select count(*)::text from public.audit_log where action = 'membership.legacy_conversion' and entity_id in (select id from public.patient_memberships where patient_id in (a, b, noend))));
  perform pg_temp.ck('L5b a holder with no end date gets a full 365 days from conversion (config), not 90', 'true',
    (select (abs(extract(epoch from (m.ends_at - (now() + interval '365 days')))) < 5)::text from public.patient_memberships m where m.patient_id = noend));
  perform pg_temp.ck('L5c and it is flagged in the audit row', 'true/365', (select (event ->> 'no_end_date_default_applied') || '/' || (event ->> 'default_days') from public.audit_log where action = 'membership.legacy_conversion' and entity_id = (select id from public.patient_memberships where patient_id = noend)));
  perform pg_temp.ck('L11 a second run converts nobody (idempotent)', '0', private.convert_legacy_programme_holders()::text);
  perform pg_temp.ck('L12 the existing Member kept their own membership only', '1', (select count(*)::text from public.patient_memberships where patient_id = c));
  perform pg_temp.ck('L13 the expired holder was not converted', '0', (select count(*)::text from public.patient_memberships where patient_id = e));
end $$;

-- G. Grace booking ---------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_d uuid := pg_temp.f('d'); v0 timestamptz := pg_temp.t('v0');
        g uuid; l uuid; rf uuid; v_off jsonb; v_slot uuid; r jsonb; v_mem uuid;
begin
  g := pg_temp.mkuser(v_org, 'grace', 'patient'); l := pg_temp.mkuser(v_org, 'lapsed', 'patient');
  perform pg_temp.tie(v_org, g, v_d); perform pg_temp.tie(v_org, l, v_d);
  perform pg_temp.setf('grace', g);
  v_mem := pg_temp.mkmember(v_org, g, 370, -3);     -- the year ended 3 days ago: inside the 14 day grace
  perform pg_temp.mkmember(v_org, l, 380, -20);     -- ended 20 days ago: past the grace
  perform pg_temp.ck('G0 a Member in grace is a Member; a lapsed person is not', 'true/false', private.patient_is_member(g)::text || '/' || private.patient_is_member(l)::text);

  begin
    v_off := private.create_followup_offer(v_d, g, array[v0 + interval '60 minutes', v0 + interval '90 minutes']::timestamptz[], 'monthly', null);
  exception when others then v_off := jsonb_build_object('err', sqlerrm);
  end;
  perform pg_temp.ck('G1 a Member in the grace can be offered times', 'offered', coalesce(v_off ->> 'status', v_off ->> 'err'));
  perform pg_temp.ck('G2 exactly one grace month exists (month 13)', '1', (select count(*)::text from public.member_followup_entitlements where membership_id = v_mem and month_index = 13));

  select id into v_slot from public.followup_offer_slots where offer_id = (v_off ->> 'offer_id')::uuid order by starts_at limit 1;
  perform pg_temp.act(g);
  begin r := public.pick_followup_slot(v_slot, false); exception when others then r := jsonb_build_object('err', sqlerrm); end;
  perform pg_temp.back();
  perform pg_temp.ck('G3 the Member in the grace can pick and the follow-up is booked', 'booked', coalesce(r ->> 'status', r ->> 'err'));
  perform pg_temp.ck('G4 month 13 is booked', 'booked', (select state from public.member_followup_entitlements where membership_id = v_mem and month_index = 13));
  perform pg_temp.ck('G5 a second offer in the grace is refused (exactly one)', 'true',
    (pg_temp.owner_try(format($q$select private.create_followup_offer(%L, %L, array[%L::timestamptz, %L::timestamptz], 'monthly', null)$q$, v_d, g, v0 + interval '150 minutes', v0 + interval '180 minutes')) like 'P0001:%')::text);
  -- consumed normally
  update public.member_followup_entitlements set state = 'consumed', consumed_at = now(), consumed_reason = 'completed' where membership_id = v_mem and month_index = 13;
  perform pg_temp.ck('G6 ensure does not hand out a second grace month', '0', private.ensure_followup_entitlements(v_mem)::text);

  begin v_off := private.create_followup_offer(v_d, l, array[v0 + interval '60 minutes', v0 + interval '90 minutes']::timestamptz[], 'monthly', null);
  exception when others then v_off := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.ck('G7 a lapsed person cannot be offered times', 'P0001', v_off ->> 'err');
  rf := (select id from public.profiles where id = pg_temp.f('refund_ok'));
  begin v_off := private.create_followup_offer(v_d, rf, array[v0 + interval '60 minutes', v0 + interval '90 minutes']::timestamptz[], 'monthly', null);
  exception when others then v_off := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.ck('G8 a person whose Membership was ended by a refund cannot be offered times', 'P0001', v_off ->> 'err');
end $$;

-- P. Renewals ---------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); fr uuid := pg_temp.f('free'); mb uuid; cr uuid; m1 uuid; m2 uuid; m3 uuid; r text; v_note uuid; v_sp uuid; n0 integer;
begin
  mb := pg_temp.mkuser(v_org, 'renew_member', 'patient');
  cr := pg_temp.mkuser(v_org, 'renew_credit', 'patient');
  perform pg_temp.mkmember(v_org, mb, 10, 300);
  perform pg_temp.setf('renew_member', mb);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (v_org, fr, 'RD Amlodipine', '5mg', 'once daily', true, 'clinician') returning id into m1;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (v_org, mb, 'RD Metformin', '500mg', 'twice daily', true, 'clinician') returning id into m2;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (v_org, cr, 'RD Losartan', '50mg', 'once daily', true, 'clinician') returning id into m3;
  perform pg_temp.setf('med_member', m2);
  r := pg_temp.exec_as(fr, format($q$insert into public.prescription_renewal_requests (patient_id, organisation_id, medication_id) values (%L, %L, %L)$q$, fr, v_org, m1));
  perform pg_temp.ck('P1 a Free person is told renewal is part of Membership', 'true', (r like 'P0001:%Membership%')::text);
  r := pg_temp.exec_as(mb, format($q$insert into public.prescription_renewal_requests (patient_id, organisation_id, medication_id) values (%L, %L, %L)$q$, mb, v_org, m2));
  perform pg_temp.ck('P2 a Member cannot file a standalone renewal request: the doctor reviews renewals at the monthly call', 'true', (r like 'P0001:%monthly call%')::text);
  perform pg_temp.ck('P2b and nothing was filed', '0', (select count(*)::text from public.prescription_renewal_requests where patient_id = mb));
  -- P2c: a row created on the Member's behalf (no patient session: a doctor, staff or service job) is the monthly-review route and passes
  insert into public.prescription_renewal_requests (patient_id, organisation_id, medication_id) values (mb, v_org, m2);
  perform pg_temp.ck('P2c a doctor, staff or service insert for a Member is allowed', '1', (select count(*)::text from public.prescription_renewal_requests where patient_id = mb));
  delete from public.prescription_renewal_requests where patient_id = mb;
  -- a credit someone already holds keeps working for a non-Member
  select id into v_sp from public.service_products where code = 'prescription_renewal_credit';
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, payment_provider, purchased_at, expires_at)
  values (v_org, cr, cr, v_sp, 'active', 500000, 'NGN', 'paystack', now() - interval '1 day', now() + interval '60 days');
  r := pg_temp.exec_as(cr, format($q$insert into public.prescription_renewal_requests (patient_id, organisation_id, medication_id) values (%L, %L, %L)$q$, cr, v_org, m3));
  perform pg_temp.ck('P3 a non-Member with a held renewal credit can still use it', 'ok', r);

  -- the optional note for the next review
  perform pg_temp.ck('P4 a Free person cannot add a review note', 'true',
    (pg_temp.q_as(fr, format($q$select public.add_review_note(%L, 'please renew')::text$q$, m1)) like 'ERR:%Membership%')::text);
  v_note := pg_temp.q_as(mb, format($q$select public.add_review_note(%L, 'Running low in two weeks, please renew')::text$q$, m2))::uuid;
  perform pg_temp.ck('P5 a Member can add a note about one of their medicines', 'true', (v_note is not null)::text);
  perform pg_temp.ck('P6 the Member can read their own note', '1', pg_temp.q_as(mb, 'select count(*)::text from public.member_review_notes'));
  perform pg_temp.ck('P7 another person cannot', '0', pg_temp.q_as(fr, 'select count(*)::text from public.member_review_notes'));
  perform pg_temp.ck('P8 a note about someone else''s medicine is refused', 'true',
    (pg_temp.q_as(mb, format($q$select public.add_review_note(%L, 'x')::text$q$, m1)) like 'ERR:%not on your list%')::text);
  perform pg_temp.ck('P9 a note over 500 characters is refused', 'true',
    (pg_temp.q_as(mb, format($q$select public.add_review_note(null, %L)::text$q$, repeat('a', 501))) like 'ERR:%between 1 and 500%')::text);
  perform pg_temp.ck('P10 the note notifies no one (INV-07: nothing reaches a phone)', '0',
    (select count(*)::text from public.notifications where created_at >= now() - interval '1 minute' and payload::text like '%Running low%'));
  perform pg_temp.ck('P11 the table cannot be written directly, and anon has nothing', 'true',
    ((pg_temp.exec_as(mb, format($q$insert into public.member_review_notes (organisation_id, patient_id, note) values (%L, %L, 'direct')$q$, v_org, mb)) like '42501:%')
     and not has_table_privilege('anon', 'public.member_review_notes', 'SELECT'))::text);
  -- the tenth note in a month is the last
  for n0 in 1..9 loop
    perform pg_temp.q_as(mb, format($q$select public.add_review_note(null, 'note %s')::text$q$, n0));
  end loop;
  perform pg_temp.ck('P12 an eleventh note in 31 days is refused', 'true',
    (pg_temp.q_as(mb, $q$select public.add_review_note(null, 'one too many')::text$q$) like 'ERR:%several notes%')::text);
end $$;

-- the second opinion is never on the anonymous public price list
do $$
declare n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select count(*) into n from public.public_price_list() where code = 'second_opinion_credit';
  reset role;
  perform pg_temp.ck('P13 the anonymous price list never shows the Members-only second opinion', '0', n::text);
end $$;

-- S. Second opinion --------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); fr uuid := pg_temp.f('free'); mb uuid := pg_temp.f('renew_member'); lp uuid; v_id text; v_sp uuid;
begin
  lp := pg_temp.mkuser(v_org, 'so_lapsed', 'patient');
  perform pg_temp.mkmember(v_org, lp, 400, -30);
  perform pg_temp.ck('S1 the price is 500,000 kobo and it is for sale', '500000/true',
    (select price_kobo::text || '/' || is_active::text from public.service_products where code = 'second_opinion_credit'));
  v_id := pg_temp.q_as(mb, format($q$select public.record_service_purchase_intent(%L, 'second_opinion_credit')::text$q$, mb));
  perform pg_temp.ck('S2 a Member can start buying one', 'true', (v_id !~ '^ERR:')::text);
  perform pg_temp.ck('S2b at 500,000 kobo', '500000', (select amount_kobo::text from public.service_purchases where id = v_id::uuid));
  perform pg_temp.ck('S3 a Free person is refused with the Membership message', 'true',
    (pg_temp.q_as(fr, format($q$select public.record_service_purchase_intent(%L, 'second_opinion_credit')::text$q$, fr)) like 'ERR:%Membership%')::text);
  perform pg_temp.ck('S4 a lapsed person is refused', 'true',
    (pg_temp.q_as(lp, format($q$select public.record_service_purchase_intent(%L, 'second_opinion_credit')::text$q$, lp)) like 'ERR:%Membership%')::text);
  perform pg_temp.ck('S5 a person whose Membership was refunded is refused', 'true',
    (pg_temp.q_as(pg_temp.f('refund_ok'), format($q$select public.record_service_purchase_intent(%L, 'second_opinion_credit')::text$q$, pg_temp.f('refund_ok'))) like 'ERR:%Membership%')::text);
  select id into v_sp from public.service_products where code = 'second_opinion_credit';
  perform pg_temp.ck('S6 no other route can sell it to a Free person (table trigger)', 'true',
    (pg_temp.owner_try(format($q$insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
        values (%L, %L, %L, %L, 'pending_payment', 500000, 'NGN')$q$, v_org, fr, fr, v_sp)) like 'P0001:%Membership%')::text);
  perform pg_temp.ck('S7 every other doctor-time product stays closed', 'true',
    (pg_temp.owner_try($q$update public.service_products set is_active = true where code = 'video_visit_credit'$q$) like '23514:%')::text);
  perform pg_temp.ck('S8 and so does the old renewal credit', 'true',
    (pg_temp.owner_try($q$update public.service_products set is_active = true where code = 'prescription_renewal_credit'$q$) like '23514:%')::text);
end $$;

-- SABOTAGE ------------------------------------------------------------------------------------------------------------------
-- 1. the refund window removed
do $$
declare d text; late uuid := pg_temp.f('refund_late'); o uuid; r text;
begin
  d := replace(pg_get_functiondef('public.request_order_refund(uuid,text)'::regprocedure),
    $s$(o.paid_at is null or now() > o.paid_at + make_interval(days => v_days))$s$, 'false');
  if d = pg_get_functiondef('public.request_order_refund(uuid,text)'::regprocedure) then raise exception 'VACUOUS TEST: window text not found'; end if;
  execute d;
  select id into o from public.orders where beneficiary_patient_id = late;
  r := pg_temp.q_as(late, format($q$select public.request_order_refund(%L, 'Changed my mind later again')::text$q$, o));
  perform pg_temp.sab('SAB1 a late refund is refused by the window', 'outside_refund_window', coalesce((r::jsonb ->> 'result'), r));
end $$;
-- 2. the legacy clause put back
do $$
declare a uuid;
begin
  a := pg_temp.mkuser(pg_temp.f('org'), 'sab_leg', 'patient');
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, payment_provider, purchased_at, expires_at)
  select pg_temp.f('org'), a, a, id, 'active', 100, 'NGN', 'paystack', now(), now() + interval '30 days' from public.service_products where code = 'complete_pack';
  create or replace function private.patient_is_member(p_patient uuid) returns boolean language sql stable security definer set search_path = ''
    as $f$ select private.patient_is_member_at(p_patient, now()) or private.patient_has_feature_access(p_patient, 'async_doctor_visit') $f$;
  perform pg_temp.sab('SAB2 a plan-only purchaser is not a Member (one meaning)', 'false', private.patient_is_member(a)::text);
  perform pg_temp.sab('SAB2b an admin is not a Member', 'false', private.patient_is_member(pg_temp.f('admin'))::text);
  create or replace function private.patient_is_member(p_patient uuid) returns boolean language sql stable security definer set search_path = ''
    as $f$ select private.patient_is_member_at(p_patient, now()) $f$;
end $$;
-- 3. the grace row creation removed
do $$
declare d text; g uuid := pg_temp.f('grace'); mid uuid;
begin
  select id into mid from public.patient_memberships where patient_id = g;
  delete from public.member_followup_entitlements where membership_id = mid and month_index = 13;
  d := replace(pg_get_functiondef('private.ensure_followup_entitlements(uuid)'::regprocedure), 'm.ends_at <= now() and m.ends_at + make_interval(days => v_grace) > now()', 'false');
  if d = pg_get_functiondef('private.ensure_followup_entitlements(uuid)'::regprocedure) then raise exception 'VACUOUS TEST: grace text not found'; end if;
  execute d;
  perform pg_temp.sab('SAB3 the grace month is created', '1', private.ensure_followup_entitlements(mid)::text);
end $$;
-- 4. the Member closure removed from the renewal trigger
do $$
declare d text; mb uuid := pg_temp.f('renew_member'); m uuid; r text;
begin
  d := replace(pg_get_functiondef('private.enforce_prescription_renewal_entitlement_or_credit()'::regprocedure), 'if private.patient_is_member(new.patient_id) then', 'if false then');
  if d = pg_get_functiondef('private.enforce_prescription_renewal_entitlement_or_credit()'::regprocedure) then raise exception 'VACUOUS TEST: renewal text not found'; end if;
  execute d;
  select id into m from public.medications where patient_id = mb limit 1;
  r := pg_temp.exec_as(mb, format($q$insert into public.prescription_renewal_requests (patient_id, organisation_id, medication_id) values (%L, %L, %L)$q$, mb, pg_temp.f('org'), m));
  perform pg_temp.sab('SAB4 a Member standalone renewal is refused', 'P0001', left(r, 5));
end $$;
-- 5. the Member check removed from the second-opinion trigger and function
do $$
declare d text; fr uuid := pg_temp.f('free'); v_sp uuid; r text;
begin
  d := replace(pg_get_functiondef('private.second_opinion_members_only()'::regprocedure), 'if not v_member then', 'if false then');
  if d = pg_get_functiondef('private.second_opinion_members_only()'::regprocedure) then raise exception 'VACUOUS TEST: second opinion text not found'; end if;
  execute d;
  select id into v_sp from public.service_products where code = 'second_opinion_credit';
  r := pg_temp.owner_try(format($q$insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
        values (%L, %L, %L, %L, 'pending_payment', 500000, 'NGN')$q$, pg_temp.f('org'), fr, fr, v_sp));
  perform pg_temp.sab('SAB5 a Free person cannot be sold a second opinion', 'P0001', left(r, 5));
end $$;
-- 6. the immediate end replaced by the old grace
do $$
declare d text; v_ok uuid; v_mem uuid;
begin
  v_ok := pg_temp.mkuser(pg_temp.f('org'), 'sab_refund', 'patient');
  v_mem := pg_temp.mkmember(pg_temp.f('org'), v_ok, 5, 360);
  d := replace(pg_get_functiondef('private.end_membership_now(uuid,uuid,text)'::regprocedure), $s$set state = 'ended', ended_at = now(), ended_by = p_by, end_reason = p_reason$s$, $s$set ends_at = greatest(now(), starts_at + interval '1 second')$s$);
  if d = pg_get_functiondef('private.end_membership_now(uuid,uuid,text)'::regprocedure) then raise exception 'VACUOUS TEST: end text not found'; end if;
  execute d;
  perform private.end_membership_now(v_mem, pg_temp.f('admin'), 'sabotage run for the proof');
  perform pg_temp.sab('SAB6 after a refund the person is Free at once', 'false', private.patient_is_member(v_ok)::text);
end $$;

-- 7. the second opinion filter removed from the public price list
do $$
declare d text; n integer;
begin
  d := replace(pg_get_functiondef('public.public_price_list()'::regprocedure), $s$ and p.code <> 'second_opinion_credit'$s$, '');
  if d = pg_get_functiondef('public.public_price_list()'::regprocedure) then raise exception 'VACUOUS TEST: price list text not found'; end if;
  execute d;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select count(*) into n from public.public_price_list() where code = 'second_opinion_credit';
  reset role;
  perform pg_temp.sab('SAB7 the second opinion stays off the anonymous list', '0', n::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'two-tier review decisions proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 7 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 8 checks: %', v_caught,
      (select string_agg(check_name, '; ') from results where phase = 'sabotaged' and expected is not distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when phase = 'real' and expected = actual then 'PASS' when phase = 'sabotaged' and expected is distinct from actual then 'PASS (caught)' else 'FAIL' end as result
from results order by phase desc, check_name;

rollback;
