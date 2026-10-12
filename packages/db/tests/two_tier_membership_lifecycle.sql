-- Two tiers, nothing between: lifecycle proof (migration *_two_tier_only_free_and_member.sql).
-- Proves in one rolled-back transaction:
--   * the care pack, the paid credits and every per-item doctor-time product are not sellable and cannot be switched back on, are
--     kept (rows and prices intact), purchase intents are refused, and a credit that already exists stays redeemable
--   * grace_days is 14 from versioned config; the ONE "is a Member" function holds through the grace, drops after it, and an
--     open-ended Membership stays a Member
--   * renewal reminders at 30, 14 and 7 days, once each, never a burst for a late-found Membership, never SMS, neutral wording, and
--     an employer-paid Membership gets a message that does not ask to buy
--   * when the grace is over the Membership is lapsed (Free), open tasks and booked follow-ups are NOT dropped and a neutral hand-off
--     task goes to a doctor, records are untouched, a second run changes nothing
--   * a refund ends the Membership on the spot (no grace; the grace is for a year that ends naturally)
-- SABOTAGE: the grace removed from the Member function, and the hand-off removed from the lapse job; both checks must flip.
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
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.owner_try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ml-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'ML ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- a Membership that started a year ago and ends p_ends_in_days from now (negative: ended that long ago)
create function pg_temp.mkmember(p_org uuid, p_patient uuid, p_ends_in_days numeric, p_source text default 'purchase') returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, granted_by, grant_reason, is_test)
  values (p_org, p_patient, p_source, now() - interval '400 days', now() + make_interval(secs => (p_ends_in_days * 86400)::int), case when p_source = 'granted' then pg_temp.f('admin') end,
          case when p_source = 'granted' then 'Granted in the lifecycle proof' end, true)
  returning id into v;
  return v;
end $f$;

do $$
declare v_org uuid; v_item uuid; v_admin uuid;
begin
  select organisation_id, id into v_org, v_item from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('item', v_item);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  for i in 1..9 loop
    perform pg_temp.setf('p' || i, pg_temp.mkuser(v_org, 'p' || i, 'patient'));
  end loop;
end $$;

-- 1. Nothing between Free and Member is for sale ---------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_p1 uuid := pg_temp.f('p1'); v_cr uuid; r text;
begin
  perform pg_temp.ck('no catalogue item other than the Membership is for sale', '0', (select count(*)::text from public.catalog_items where kind <> 'membership' and active));
  perform pg_temp.ck('a care pack cannot be put on sale', 'true',
    (pg_temp.owner_try(format($q$insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, active) values (%L, 'tt_pack', 'care_pack', 'k', 'd', 90, true)$q$, v_org)) like '23514:%')::text);
  perform pg_temp.ck('an inactive care pack row can still exist (kept, not deleted)', 'ok',
    pg_temp.owner_try(format($q$insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, active) values (%L, 'tt_pack', 'care_pack', 'k', 'd', 90, false)$q$, v_org)));
  perform pg_temp.ck('and switching it on is refused by the constraint', 'true',
    (pg_temp.owner_try($q$update public.catalog_items set active = true where code = 'tt_pack'$q$) like '23514:%')::text);
  perform pg_temp.ck('no doctor-time product is for sale except the Members-only second opinion', '0',
    (select count(*)::text from public.service_products where is_active and code <> 'second_opinion_credit' and code ~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$)'));
  perform pg_temp.ck('the doctor-time products are kept, with their prices', 'true',
    (select (count(*) >= 5 and bool_and(price_kobo is not null))::text from public.service_products where code in ('video_visit_credit', 'async_consult_credit', 'second_opinion_credit', 'prescription_renewal_credit', 'result_interpretation_credit')));
  perform pg_temp.ck('video_visit_credit cannot be switched back on', 'true',
    (pg_temp.owner_try($q$update public.service_products set is_active = true where code = 'video_visit_credit'$q$) like '23514:%')::text);
  perform pg_temp.ck('the chronic doctor-supported pack cannot be switched on either', 'true',
    (pg_temp.owner_try($q$update public.service_products set is_active = true where code = 'chronic_doctor_supported_pack'$q$) like '23514:%')::text);
  r := pg_temp.q_as(v_p1, format($q$select public.record_service_purchase_intent(%L, 'video_visit_credit')::text$q$, v_p1));
  perform pg_temp.ck('a patient cannot start buying a video visit credit', 'true', (r like 'ERR:%')::text);
  -- a credit someone already holds stays redeemable
  select id into v_cr from public.service_products where code = 'video_visit_credit';
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, payment_provider, purchased_at, expires_at)
  values (v_org, v_p1, v_p1, v_cr, 'active', 1000000, 'NGN', 'paystack', now() - interval '1 day', now() + interval '60 days');
  perform pg_temp.ck('a credit that already exists is still redeemable', 'true',
    (pg_temp.q_as(v_p1, format($q$select public.redeem_available_service_purchase(%L, 'video_visit_credit', 'appointment', %L)::text$q$, v_p1, gen_random_uuid())) !~ '^ERR:')::text);
end $$;

-- 2. The one Member function and the grace ---------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org');
begin
  perform pg_temp.ck('grace is 14 days from the versioned config', '14', private.membership_grace_days()::text);
  perform pg_temp.mkmember(v_org, pg_temp.f('p2'), 200);      -- inside the year
  perform pg_temp.mkmember(v_org, pg_temp.f('p3'), -5);       -- ended 5 days ago: in the grace
  perform pg_temp.mkmember(v_org, pg_temp.f('p4'), -20);      -- ended 20 days ago: past the grace
  perform pg_temp.ck('a Member inside the year is a Member', 'true', private.patient_is_member(pg_temp.f('p2'))::text);
  perform pg_temp.ck('five days after the year ended is still a Member (grace)', 'true', private.patient_is_member(pg_temp.f('p3'))::text);
  perform pg_temp.ck('twenty days after the year ended is Free', 'false', private.patient_is_member(pg_temp.f('p4'))::text);
  perform pg_temp.ck('a person with no Membership is Free', 'false', private.patient_is_member(pg_temp.f('p1'))::text);
  perform pg_temp.ck('my_membership says so, and that it is the grace', 'true/true',
    (pg_temp.q_as(pg_temp.f('p3'), 'select (public.my_membership() ->> ''is_member'') || ''/'' || (public.my_membership() ->> ''in_grace'')')));
  perform pg_temp.ck('my_membership for the year-in-progress is not the grace', 'true/false',
    (pg_temp.q_as(pg_temp.f('p2'), 'select (public.my_membership() ->> ''is_member'') || ''/'' || (public.my_membership() ->> ''in_grace'')')));
  perform pg_temp.ck('my_membership for the lapsed-by-clock person says Free', 'false',
    (pg_temp.q_as(pg_temp.f('p4'), 'select public.my_membership() ->> ''is_member''')));
end $$;

-- 3. Reminders --------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_m uuid; v_p uuid := pg_temp.f('p5'); v_e uuid := pg_temp.f('p6'); v_late uuid := pg_temp.f('p7');
begin
  v_m := pg_temp.mkmember(v_org, v_p, 29);
  perform pg_temp.setf('m5', v_m);
  perform pg_temp.ck('a Membership ending in 29 days gets the 30 day reminder', '1', private.queue_membership_renewal_reminders()::text);
  perform pg_temp.ck('and not a second one the same day', '0', private.queue_membership_renewal_reminders()::text);
  update public.patient_memberships set ends_at = now() + interval '13 days' where id = v_m;
  perform pg_temp.ck('13 days left: the 14 day reminder', '1', private.queue_membership_renewal_reminders()::text);
  update public.patient_memberships set ends_at = now() + interval '6 days' where id = v_m;
  perform pg_temp.ck('6 days left: the 7 day reminder', '1', private.queue_membership_renewal_reminders()::text);
  update public.patient_memberships set ends_at = now() + interval '2 days' where id = v_m;
  perform pg_temp.ck('and nothing more after the third', '0', private.queue_membership_renewal_reminders()::text);
  perform pg_temp.ck('exactly three reminders for the person, 30 then 14 then 7', '30,14,7',
    (select string_agg(payload ->> 'days_before', ',' order by created_at, (payload ->> 'days_before')::int desc) from public.notifications where recipient_id = v_p and template = 'membership_renewal_reminder'));
  -- found late: one reminder, not a burst
  perform pg_temp.mkmember(v_org, v_late, 3);
  perform pg_temp.ck('a Membership first seen with 3 days left gets one reminder, not three', '1', private.queue_membership_renewal_reminders()::text);
  perform pg_temp.ck('and that one is the 7 day reminder', '7', (select payload ->> 'days_before' from public.notifications where recipient_id = v_late and template = 'membership_renewal_reminder'));
  -- employer-paid: told, not sold to
  perform pg_temp.mkmember(v_org, v_e, 20, 'employer');
  perform pg_temp.ck('an employer-paid Membership is reminded', '1', private.queue_membership_renewal_reminders()::text);
  perform pg_temp.ck('with the wording that does not ask them to buy', 'membership_employer_cover_ending',
    (select template from public.notifications where recipient_id = v_e and template like 'membership%'));
  perform pg_temp.ck('no reminder was ever an SMS', '0', (select count(*)::text from public.notifications where template like 'membership%' and channel::text = 'sms'));
  perform pg_temp.ck('the employer wording does not say buy or purchase', 'true',
    (select bool_and(body !~* '(buy|purchase|pay)') from public.notification_template_locales where template_key = 'membership_employer_cover_ending')::text);
  perform pg_temp.ck('no template carries clinical content', 'true',
    (select bool_and(body !~* '(blood|pressure|diabet|result|medic)') from public.notification_template_locales where template_key in ('membership_renewal_reminder', 'membership_lapsed'))::text);
end $$;

-- 4. Lapse and hand-off -----------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_busy uuid := pg_temp.f('p4'); v_quiet uuid := pg_temp.f('p8'); v_task uuid; v_appt uuid; v_n integer;
begin
  perform pg_temp.mkmember(v_org, v_quiet, -30);
  -- p4 (ended 20 days ago) has an open task and a booked follow-up
  v_task := private.create_clinical_task(v_busy, 'symptom_review');
  insert into public.appointments (organisation_id, patient_id, scheduled_for, status, reason, appointment_type, consultation_method, ends_at)
  values (v_org, v_busy, now() + interval '5 days', 'scheduled', 'monthly follow-up', 'gp', 'telemedicine', now() + interval '5 days 20 minutes') returning id into v_appt;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, logged_by_profile_id, systolic, diastolic)
  values (v_org, v_busy, 'blood_pressure', 'manual', v_busy, 128, 82);

  v_n := private.lapse_expired_memberships();
  perform pg_temp.ck('the job lapses the two past the grace and not the one inside it', '2', v_n::text);
  perform pg_temp.ck('p4 is lapsed', 'lapsed', (select state from public.patient_memberships where patient_id = v_busy));
  perform pg_temp.ck('p3, inside the grace, is still active', 'active', (select state from public.patient_memberships where patient_id = pg_temp.f('p3')));
  perform pg_temp.ck('p4 is Free now', 'false', private.patient_is_member(v_busy)::text);
  perform pg_temp.ck('the open task was not dropped', 'true', (select (state::text not in ('cancelled', 'completed'))::text from public.clinical_tasks where id = v_task));
  perform pg_temp.ck('the booked follow-up was not cancelled', 'scheduled', (select status::text from public.appointments where id = v_appt));
  perform pg_temp.ck('a neutral hand-off task went to a doctor', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = v_busy and type = 'membership_handoff' and state::text not in ('cancelled', 'completed')));
  perform pg_temp.ck('and the person with nothing open gets no hand-off task', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_quiet and type = 'membership_handoff'));
  perform pg_temp.ck('records are untouched', '1', (select count(*)::text from public.vitals_readings where patient_id = v_busy));
  perform pg_temp.ck('the person is told, once, in neutral words', '1', (select count(*)::text from public.notifications where recipient_id = v_busy and template = 'membership_lapsed'));
  perform pg_temp.ck('a second run changes nothing', '0', private.lapse_expired_memberships()::text);
  perform pg_temp.ck('and makes no second hand-off task', '1', (select count(*)::text from public.clinical_tasks where patient_id = v_busy and type = 'membership_handoff'));
  perform pg_temp.ck('a lapsed person can buy again (not blocked as an existing Member)', '0',
    (select count(*)::text from public.patient_memberships where patient_id = v_busy and state = 'active'));
  perform pg_temp.ck('the whole daily job runs and reports', 'true', (private.run_membership_lifecycle() ? 'lapsed')::text);
end $$;

-- 5. A refund ends access at once (no grace) ----------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('p9'); v_item uuid := pg_temp.f('item'); v_admin uuid := pg_temp.f('admin');
        v_price uuid; v_order uuid; v_ref uuid; r text;
begin
  select id into v_price from private.current_price(v_item);
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (v_org, v_pat, v_pat, v_item, v_price, 12000000, 0, 12000000, 'paid', now() - interval '3 days', 'tho_' || replace(gen_random_uuid()::text, '-', ''), true) returning id into v_order;
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, is_test)
  values (v_org, v_pat, v_order, 'membership', now() - interval '3 days', now() + interval '362 days', true);
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
  values (v_org, v_pat, 'purchase', now() - interval '3 days', now() + interval '362 days', true);
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (v_org, v_order, 12000000, 'Refund in the lifecycle proof', v_pat, true) returning id into v_ref;
  r := pg_temp.q_as(v_admin, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_ref));
  perform pg_temp.ck('the refund is approved', 'true', (r !~ '^ERR:')::text);
  perform pg_temp.ck('the entitlement is revoked', 'revoked', (select state from public.entitlements where order_id = v_order));
  perform pg_temp.ck('the Membership is ended on the spot', 'ended', (select state from public.patient_memberships where patient_id = v_pat));
  perform pg_temp.ck('and the person is Free at once, with no grace', 'false', private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('the refunded order and the person are still on record', '1/refunded', (select count(*)::text from public.profiles where id = v_pat) || '/' || (select state from public.orders where id = v_order));
end $$;

-- SABOTAGE 1: take the grace out of the Member function; a person inside the grace must now read as Free
create or replace function private.patient_is_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_memberships m where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= now()
                    and (m.ends_at is null or m.ends_at > now()));
$$;
insert into results values ('sabotaged', 'five days after the year ended is still a Member (grace)', 'true', private.patient_is_member(pg_temp.f('p3'))::text);

-- SABOTAGE 2: take the hand-off out of the lapse job; a person with open work must now lose it silently
do $$
declare d text; v_pat uuid := pg_temp.f('p2'); v_org uuid := pg_temp.f('org');
begin
  d := replace(pg_get_functiondef('private.lapse_expired_memberships'::regproc), $s$perform private.create_clinical_task(r.patient_id, 'membership_handoff', null, 'membership_handoff:' || r.id);$s$, 'null;');
  if d = pg_get_functiondef('private.lapse_expired_memberships'::regproc) then raise exception 'VACUOUS TEST: sabotage text not found'; end if;
  execute d;
  update public.patient_memberships set ends_at = now() - interval '30 days' where patient_id = v_pat;
  perform private.create_clinical_task(v_pat, 'symptom_review');
  perform private.lapse_expired_memberships();
  insert into results values ('sabotaged', 'open work is handed to a doctor when a Membership lapses', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = v_pat and type = 'membership_handoff'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'two-tier lifecycle proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
