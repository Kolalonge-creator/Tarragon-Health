-- Proof: T2-13 (migration *_t2_13_plus_renews_as_membership.sql). A Membership Plus year renews as the 100,000 naira Membership, only
-- after notice; nothing is charged without the member's own action; a gifted Membership activates for the beneficiary with no record
-- access for the sponsor, and the sponsor is reminded at renewal time only while they hold the beneficiary's pay-for-care permission;
-- discount codes never name the retired Plus items.
--   1. No Plus sold: an order for Membership Plus or the upgrade is refused; the Membership is ordered at 10,000,000 kobo.
--   2. Renew by hand: a Plus member's renewal reminder is the Plus notice, naming the Membership at 100,000 naira; buying the Membership
--      while the Plus year runs QUEUES a Membership (evergreen) year from the Plus end date and leaves the Plus year untouched.
--   3. Automatic renewal (switched on only inside this transaction): a Plus year is NOT charged before the notice (plus_notice_pending,
--      no order); after the notice that names 100,000 naira and the card, the renewal order is for the Membership item at 10,000,000
--      kobo, and paying it queues a Membership year; the Plus row keeps its tier and end date.
--   4. Gift: a supporter with only "pay for my care" buys the Membership (10,000,000 kobo); it waits for the beneficiary; once accepted
--      the beneficiary is a Member on the Membership tier; the sponsor can read none of the beneficiary's clinical categories.
--   5. Sponsor reminder: near the end of the gifted year the sponsor gets one reminder with a first name and an end date only; once the
--      beneficiary removes them from the Care Circle, no reminder is sent.
--   6. Discount codes: a founding code must be exactly the Membership; no new code may name a retired Plus item; the guard allows
--      removing a retired item, refuses emptying a code ("every item") and refuses any other change.
--   2b. A Plus member whose membership row is in a second organisation (no catalogue there, as live) still gets the notice at 100,000.
--   5b. A year the beneficiary later bought themselves never reminds the earlier sponsor (the gift row carries its exact order link; the
--       date match for older rows yields to a later self-paid order).
--   SABOTAGE (automatic): (a) the Plus notice gate removed from the renewal charge -> a Plus year is charged without notice, so check 3
--   flips; (b) the Care Circle check removed from the sponsor reminder -> a removed sponsor is reminded, so check 5 flips; (c) the price
--   read from the membership row's organisation -> 2b flips; (d) the most-recent-order rule removed -> 5b flips.

begin;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 't213-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, initcap(p_label) || ' Tester', '+23482' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.pay(p_ref text, p_amount bigint) returns text language sql as
$$ select pg_temp.svc(format($q$select (public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'webhook', 'evt-t213', now(), '{}'::jsonb)) ->> 'result'$q$, p_ref, p_amount, p_amount)) $$;
create function pg_temp.plus_year(p_patient uuid, p_ends interval) returns uuid language plpgsql as $f$ declare v uuid;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', p_patient, 'purchase', 'active', now() + p_ends - interval '365 days', now() + p_ends, true, 'plus')
  returning id into v;
  return v;
end $f$;
create function pg_temp.prepare(p_m uuid) returns jsonb language sql as
$$ select pg_temp.svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, p_m))::jsonb $$;

-- setup: the platform as live (checkout, the tier module and Membership billing on) and one lead doctor
do $$
declare v_admin uuid := pg_temp.mkuser('admin', 'admin'); v_org uuid := '00000000-0000-0000-0000-000000000001'; r text; v_doc uuid; v_cs uuid; c text;
begin
  perform pg_temp.setf('admin', v_admin);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 't2-13 proof'
   where key in ('v5_checkout', 'membership_two_member_tiers');
  r := pg_temp.q_as(v_admin, $q$select public.attest_go_live_condition('membership_billing_enabled', 'refund_path_tested', true, 'T2-13 proof: refund path tested')$q$);
  r := pg_temp.q_as(v_admin, $q$select public.set_go_live_guard('membership_billing_enabled', true, 'T2-13 proof: Membership on sale as live')$q$);
  if r like 'ERR:%' then raise exception 'SETUP: could not open membership billing: %', r; end if;
  v_doc := pg_temp.mkuser('lead', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, is_test)
  values (v_org, v_doc, 'T213 lead', 'MDCN', 'T213-' || substr(v_doc::text, 1, 8), true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, false, true)
  returning id into v_cs;
  foreach c in array array['adult_general', 'hypertension', 'lead_clinician'] loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (v_org, v_cs, c, v_admin, true);
  end loop;
end $$;

-- 1 and 2: no Plus sold; renewing by hand gives the Membership, queued after the Plus year
do $$
declare v_p uuid := pg_temp.mkuser('plushand', 'patient'); v_m uuid; r text; n jsonb; v_end timestamptz;
begin
  r := pg_temp.q_as(pg_temp.mkuser('free', 'patient'), $q$select public.create_order('membership_annual', gen_random_uuid())::text$q$);
  if r not like 'ERR:%item_not_available%' then raise exception 'FAIL 1: Membership Plus can still be ordered: %', r; end if;
  r := pg_temp.q_as(pg_temp.mkuser('free2', 'patient'), $q$select public.create_order('membership_upgrade_plus', gen_random_uuid())::text$q$);
  if r not like 'ERR:%' then raise exception 'FAIL 1: the Plus upgrade can still be ordered: %', r; end if;

  v_m := pg_temp.plus_year(v_p, interval '6 days');
  select ends_at into v_end from public.patient_memberships where id = v_m;
  perform private.queue_membership_renewal_reminders();
  select payload into n from public.notifications where recipient_id = v_p and template = 'membership_plus_renews_as_membership';
  if n is null or n ->> 'amount' <> '100,000' or n ->> 'renews_as' <> 'membership_annual_no_panel' then
    raise exception 'FAIL 2: the Plus member was not sent the Plus notice at the Membership price: %', n;
  end if;
  if exists (select 1 from public.notifications where recipient_id = v_p and template = 'membership_renewal_reminder') then
    raise exception 'FAIL 2: the Plus member also got the plain reminder';
  end if;
  if exists (select 1 from public.orders where beneficiary_patient_id = v_p) then raise exception 'FAIL 2: a reminder created an order'; end if;

  -- by hand, after the Plus year has ended (in the grace), the person buys the Membership: it is the Membership at 10,000,000 kobo
  update public.patient_memberships set starts_at = now() - interval '366 days', ends_at = now() - interval '1 day' where id = v_m;
  r := pg_temp.q_as(v_p, $q$select public.create_order('membership_annual_no_panel', gen_random_uuid())::text$q$);
  if r like 'ERR:%' or (r::jsonb ->> 'amount_kobo')::bigint <> 10000000 then raise exception 'FAIL 2: the Plus member could not renew as the Membership at 100,000 naira: %', r; end if;
  r := pg_temp.pay((select paystack_reference from public.orders where id = (r::jsonb ->> 'order_id')::uuid), 10000000);
  if r <> 'paid' then raise exception 'FAIL 2: the renewal by hand was not paid: %', r; end if;
  if (select tier from public.patient_memberships where patient_id = v_p and state = 'active') <> 'evergreen' then
    raise exception 'FAIL 2: renewing by hand did not give the Membership tier';
  end if;
  if (select tier || '/' || (ends_at = v_end - interval '7 days')::text from public.patient_memberships where id = v_m) is distinct from 'plus/true' then
    raise exception 'FAIL 2: the old Plus row was rewritten';
  end if;
end $$;

-- 2b. a Plus member whose membership row sits in a SECOND organisation (the catalogue lives only in the platform organisation, as live):
--     the notice still names the Membership price, resolved from the patient's profile organisation the way checkout resolves it
do $$
declare v_p uuid := pg_temp.mkuser('plusorg2', 'patient'); v_org2 uuid; v_m uuid; n jsonb;
begin
  insert into public.organisations (name, type) values ('T213 second organisation', 'corporate') returning id into v_org2;
  perform pg_temp.setf('org2', v_org2);
  if exists (select 1 from public.catalog_items where organisation_id = v_org2) then raise exception 'SETUP: the second organisation has a catalogue'; end if;
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values (v_org2, v_p, 'purchase', 'active', now() - interval '359 days', now() + interval '6 days', true, 'plus') returning id into v_m;
  perform pg_temp.setf('plusorg2', v_p);
  perform private.queue_membership_renewal_reminders();
  select payload into n from public.notifications where recipient_id = v_p and template = 'membership_plus_renews_as_membership';
  if n is null or n ->> 'amount' <> '100,000' then
    raise exception 'FAIL 2b: a Plus member whose year sits in a second organisation got no Plus notice at 100,000 naira (%)', n;
  end if;
  if exists (select 1 from public.notifications where recipient_id = v_p and template = 'membership_renewal_reminder') then
    raise exception 'FAIL 2b: the second-organisation Plus member fell back to the plain reminder';
  end if;
end $$;

-- 3. automatic renewal of a Plus year (the module is switched on only inside this transaction)
do $$
declare v_p uuid := pg_temp.mkuser('plusauto', 'patient'); v_m uuid; r jsonb; v_end timestamptz; v_res text; n jsonb;
begin
  perform pg_temp.setf('plusauto', v_p);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pg_temp.f('admin'), activation_note = 't2-13 proof' where key = 'membership_auto_renew';
  v_m := pg_temp.plus_year(v_p, interval '2 days');
  perform pg_temp.setf('plusauto_m', v_m);
  update public.patient_memberships set auto_renew = true, renewal_item_code = 'membership_annual_no_panel', renewal_consent_at = now() - interval '300 days',
         renewal_notified_kobo = 12900000 where id = v_m;
  insert into public.membership_cards (patient_id, organisation_id, authorization_code, email, last4)
  values (v_p, '00000000-0000-0000-0000-000000000001', 'AUTH_t213', 't213@example.invalid', '4081');
  select ends_at into v_end from public.patient_memberships where id = v_m;

  r := pg_temp.prepare(v_m);
  if r ->> 'skip' is distinct from 'plus_notice_pending' then raise exception 'FAIL 3: a Plus year was prepared for charge before the notice: %', r; end if;
  if exists (select 1 from public.orders where renews_membership_id = v_m) then raise exception 'FAIL 3: an order was made before the notice'; end if;

  perform private.queue_membership_renewal_reminders();
  select payload into n from public.notifications where recipient_id = v_p and template = 'membership_plus_auto_renews_as_membership';
  if n is null or n ->> 'amount' <> '100,000' or n ->> 'card_last4' <> '4081' then raise exception 'FAIL 3: the auto-renew Plus notice is missing or wrong: %', n; end if;
  if (select renewal_notified_kobo from public.patient_memberships where id = v_m) <> 10000000 then raise exception 'FAIL 3: the amount shown is not the Membership price'; end if;
  r := pg_temp.prepare(v_m);
  if r ->> 'skip' is distinct from 'plus_notice_pending' then raise exception 'FAIL 3: a notice sent minutes ago was enough to charge: %', r; end if;

  update public.notifications set created_at = now() - interval '3 days' where recipient_id = v_p and template = 'membership_plus_auto_renews_as_membership';
  r := pg_temp.prepare(v_m);
  if r ->> 'order_id' is null or (r ->> 'amount_kobo')::bigint <> 10000000 then raise exception 'FAIL 3: after notice the renewal is not 10,000,000 kobo: %', r; end if;
  if (select ci.code from public.orders o join public.catalog_items ci on ci.id = o.catalog_item_id where o.id = (r ->> 'order_id')::uuid) <> 'membership_annual_no_panel' then
    raise exception 'FAIL 3: the renewal order is not for the Membership item';
  end if;
  v_res := pg_temp.pay(r ->> 'reference', 10000000);
  if v_res <> 'paid' then raise exception 'FAIL 3: the renewal was not recorded: %', v_res; end if;
  if (select tier || '/' || (ends_at = v_end)::text from public.patient_memberships where id = v_m) is distinct from 'plus/true' then
    raise exception 'FAIL 3: the running Plus year was changed by the renewal';
  end if;
  if not exists (select 1 from public.patient_memberships where patient_id = v_p and state = 'scheduled' and tier = 'evergreen' and starts_at = v_end) then
    raise exception 'FAIL 3: the renewal did not queue a Membership year from the Plus end date';
  end if;
end $$;

-- 4 and 5. a gifted Membership: activates for the beneficiary, no record access for the sponsor, sponsor reminder only with consent
do $$
declare v_ben uuid := pg_temp.mkuser('adaeze', 'patient'); v_sp uuid := pg_temp.mkuser('sponsor', 'patient'); v_ref text; v_ent uuid; r text;
        v_cat public.care_access_category; v_m uuid; n jsonb; v_cm uuid;
begin
  perform pg_temp.setf('ben', v_ben); perform pg_temp.setf('sp', v_sp);
  update public.profiles set receives_care = false where id = v_sp;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values ('00000000-0000-0000-0000-000000000001', v_ben, v_sp, 'Son', array['pay_for_care'], now() + interval '400 days', true) returning id into v_cm;
  perform pg_temp.setf('cm', v_cm);

  v_ref := pg_temp.q_as(v_sp, format($q$select (public.create_order('membership_annual_no_panel', gen_random_uuid(), %L)) ->> 'reference'$q$, v_ben));
  if v_ref is null or v_ref like 'ERR:%' then raise exception 'FAIL 4: the sponsor could not buy the Membership for the beneficiary: %', v_ref; end if;
  if (select amount_kobo from public.orders where paystack_reference = v_ref) <> 10000000 then raise exception 'FAIL 4: the gift is not 10,000,000 kobo'; end if;
  r := pg_temp.q_as(v_sp, format($q$select (public.create_order('membership_annual', gen_random_uuid(), %L)) ->> 'reference'$q$, v_ben));
  if r not like 'ERR:%item_not_available%' then raise exception 'FAIL 4: a sponsor can still buy Membership Plus: %', r; end if;
  if pg_temp.pay(v_ref, 10000000) <> 'paid' then raise exception 'FAIL 4: the gift was not paid'; end if;
  if private.patient_is_member(v_ben) then raise exception 'FAIL 4: the gift started before the beneficiary accepted'; end if;
  select e.id into v_ent from public.entitlements e join public.orders o on o.id = e.order_id where o.paystack_reference = v_ref;
  r := pg_temp.q_as(v_ben, format($q$select (public.respond_to_gifted_pack(%L, true)) ->> 'result'$q$, v_ent));
  if r <> 'accepted' then raise exception 'FAIL 4: the beneficiary could not accept: %', r; end if;
  if not private.patient_is_member(v_ben) or (select tier from public.patient_memberships where patient_id = v_ben and state = 'active') <> 'evergreen' then
    raise exception 'FAIL 4: the accepted gift is not the full Membership';
  end if;
  foreach v_cat in array enum_range(null::public.care_access_category) loop
    r := pg_temp.q_as(v_sp, format($q$select private.can_read_clinical(%L::uuid, %L::public.care_access_category)::text$q$, v_ben, v_cat));
    if r is distinct from 'false' then raise exception 'FAIL 4: paying gave the sponsor % access (%)', v_cat, r; end if;
  end loop;
  r := pg_temp.q_as(v_sp, format($q$select private.can_read_clinical(%L::uuid)::text$q$, v_ben));
  if r is distinct from 'false' then raise exception 'FAIL 4: paying gave the sponsor general clinical access (%)', r; end if;

  if (select o.paystack_reference from public.patient_memberships pm join public.orders o on o.id = pm.order_id
       where pm.patient_id = v_ben and pm.state = 'active') is distinct from v_ref then
    raise exception 'FAIL 4: the accepted gift year does not carry the exact link to its order';
  end if;

  -- 5. near the end of the gifted year
  select id into v_m from public.patient_memberships where patient_id = v_ben and state = 'active';
  perform pg_temp.setf('ben_m', v_m);
  update public.patient_memberships set starts_at = now() - interval '360 days', ends_at = now() + interval '5 days' where id = v_m;
  update public.entitlements set starts_at = now() - interval '360 days', ends_at = now() + interval '5 days' where id = v_ent;
  perform private.queue_membership_renewal_reminders();
  if (select count(*) from public.notifications where recipient_id = v_sp and template = 'membership_gift_renewal_reminder') <> 1 then
    raise exception 'FAIL 5: the sponsor was not reminded once';
  end if;
  select payload into n from public.notifications where recipient_id = v_sp and template = 'membership_gift_renewal_reminder';
  if (select array_agg(k order by k) from jsonb_object_keys(n) k) <> array['days_before', 'ends_at', 'first_name'] or n ->> 'first_name' <> 'Adaeze' then
    raise exception 'FAIL 5: the sponsor reminder carries more than a first name and a date: %', n;
  end if;
  if not exists (select 1 from public.notifications where recipient_id = v_ben and template = 'membership_renewal_reminder') then
    raise exception 'FAIL 5: the beneficiary was not reminded';
  end if;

  -- the beneficiary removes the sponsor; the next threshold sends nothing to them
  update public.care_circle_members set state = 'revoked', revoked_at = now(), revoked_by = v_ben where id = v_cm;
  delete from public.membership_renewal_reminders where membership_id = v_m;
  delete from public.notifications where recipient_id in (v_sp, v_ben) and template in ('membership_gift_renewal_reminder', 'membership_renewal_reminder');
  perform private.queue_membership_renewal_reminders();
  if exists (select 1 from public.notifications where recipient_id = v_sp and template = 'membership_gift_renewal_reminder') then
    raise exception 'FAIL 5: a sponsor the beneficiary removed was still reminded';
  end if;
end $$;

-- 5b. the beneficiary later buys a year for themselves: the earlier sponsor is not reminded about it, even when an old gift's dates line up
do $$
declare v_ben uuid := pg_temp.mkuser('chidi', 'patient'); v_sp uuid := pg_temp.mkuser('sponsor2', 'patient'); v_ref text; v_ent uuid; r text; v_m uuid; v_own uuid;
begin
  update public.profiles set receives_care = false where id = v_sp;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values ('00000000-0000-0000-0000-000000000001', v_ben, v_sp, 'Daughter', array['pay_for_care'], now() + interval '800 days', true);
  v_ref := pg_temp.q_as(v_sp, format($q$select (public.create_order('membership_annual_no_panel', gen_random_uuid(), %L)) ->> 'reference'$q$, v_ben));
  if pg_temp.pay(v_ref, 10000000) <> 'paid' then raise exception 'SETUP 5b: the gift was not paid'; end if;
  select e.id into v_ent from public.entitlements e join public.orders o on o.id = e.order_id where o.paystack_reference = v_ref;
  r := pg_temp.q_as(v_ben, format($q$select (public.respond_to_gifted_pack(%L, true)) ->> 'result'$q$, v_ent));
  -- the gifted year is over (and past its grace); they buy the next year themselves. In one proof transaction now() never moves, so the
  -- gift's payment is dated a year back, as it would be in life.
  update public.orders set paid_at = now() - interval '400 days' where paystack_reference = v_ref;
  select id into v_m from public.patient_memberships where patient_id = v_ben and state = 'active';
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'proof: the gifted year has ended', starts_at = now() - interval '400 days', ends_at = now() - interval '30 days' where id = v_m;
  r := pg_temp.q_as(v_ben, $q$select (public.create_order('membership_annual_no_panel', gen_random_uuid())) ->> 'reference'$q$);
  if pg_temp.pay(r, 10000000) <> 'paid' then raise exception 'SETUP 5b: the own purchase was not paid: %', r; end if;
  select id into v_own from public.patient_memberships where patient_id = v_ben and state = 'active';
  perform pg_temp.setf('own_m', v_own); perform pg_temp.setf('sp2', v_sp);
  -- line the old gift entitlement up with the new year so only the "most recent order" rule can tell them apart
  update public.patient_memberships set starts_at = now() - interval '360 days', ends_at = now() + interval '5 days' where id = v_own;
  update public.entitlements set ends_at = now() + interval '5 days' where id = v_ent;
  perform private.queue_membership_renewal_reminders();
  if exists (select 1 from public.notifications where recipient_id = v_sp and template = 'membership_gift_renewal_reminder') then
    raise exception 'FAIL 5b: a year the beneficiary bought themselves reminded their earlier sponsor';
  end if;
  if not exists (select 1 from public.notifications where recipient_id = v_ben and template = 'membership_renewal_reminder') then
    raise exception 'FAIL 5b: the beneficiary was not reminded about their own year';
  end if;
end $$;

-- 6. discount codes
do $$
declare v_admin uuid := pg_temp.f('admin'); r text; v_id uuid;
begin
  r := pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FOUNDT213', 'percent', 10, null, null, array['membership_annual', 'membership_annual_no_panel'], null, 100, 1, now(), now() + interval '90 days', 'proof', 'founding_member')::text$q$);
  if r not like 'ERR:%' then raise exception 'FAIL 6: a founding code naming Plus was accepted: %', r; end if;
  r := pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('PLUST213', 'percent', 10, null, null, array['membership_annual'], null, 100, 1, now(), now() + interval '90 days', 'proof', null)::text$q$);
  if r not like 'ERR:%retired_item%' then raise exception 'FAIL 6: a code on the retired Plus item was accepted: %', r; end if;
  if exists (select 1 from public.discount_codes where badge = 'founding_member' and status = 'active' and is_test) then
    update public.discount_codes set status = 'ended' where badge = 'founding_member' and status = 'active' and is_test;
  end if;
  r := pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FOUNDM213', 'percent', 10, null, null, array['membership_annual_no_panel'], null, 100, 1, now(), now() + interval '90 days', 'proof', 'founding_member')::text$q$);
  if r like 'ERR:%' then raise exception 'FAIL 6: a founding code on the Membership was refused: %', r; end if;

  insert into public.discount_codes (organisation_id, code, kind, percent, item_codes, max_total_uses, max_uses_per_person, valid_from, valid_to, status, is_test)
  values ('00000000-0000-0000-0000-000000000001', 'OLDT213', 'percent', 10, array['membership_annual', 'membership_annual_no_panel'], 10, 1, now(), now() + interval '30 days', 'active', true)
  returning id into v_id;
  begin
    update public.discount_codes set item_codes = '{}' where id = v_id;
    raise exception 'FAIL 6: a code was widened to every item';
  exception when others then if sqlerrm like 'FAIL 6:%' then raise; end if;
  end;
  begin
    update public.discount_codes set item_codes = array['membership_annual_no_panel', 'video_visit_credit'] where id = v_id;
    raise exception 'FAIL 6: a code gained an item';
  exception when others then if sqlerrm like 'FAIL 6:%' then raise; end if;
  end;
  update public.discount_codes set item_codes = array['membership_annual_no_panel'] where id = v_id;
  if (select item_codes from public.discount_codes where id = v_id) <> array['membership_annual_no_panel'] then raise exception 'FAIL 6: the retired item could not be removed'; end if;
end $$;

-- SABOTAGE (a): the Plus notice gate removed -> a Plus year with no notice is charged, so check 3 would catch it
do $$
declare d text := pg_get_functiondef('public.service_prepare_membership_renewal(uuid)'::regprocedure); v_p uuid := pg_temp.mkuser('sabot', 'patient'); v_m uuid; r jsonb;
begin
  d := replace(d, 'if m.tier = ''plus'' and not exists', 'if false and not exists');
  execute d;
  v_m := pg_temp.plus_year(v_p, interval '2 days');
  update public.patient_memberships set auto_renew = true, renewal_item_code = 'membership_annual_no_panel', renewal_consent_at = now() - interval '300 days',
         renewal_notified_kobo = 12900000 where id = v_m;
  insert into public.membership_cards (patient_id, organisation_id, authorization_code, email, last4)
  values (v_p, '00000000-0000-0000-0000-000000000001', 'AUTH_sab', 'sab@example.invalid', '1111');
  r := pg_temp.prepare(v_m);
  if r ->> 'skip' = 'plus_notice_pending' or r ->> 'order_id' is null then
    raise exception 'FAIL sabotage (a): with the gate removed the Plus year still was not charged (%), so check 3 is vacuous', r;
  end if;
end $$;

-- SABOTAGE (b): the Care Circle check removed -> a removed sponsor is reminded, so check 5 would catch it
do $$
declare d text := pg_get_functiondef('private.queue_gift_renewal_reminder(uuid,integer)'::regprocedure); v_m uuid := pg_temp.f('ben_m');
begin
  d := replace(d, $s$if not exists (select 1 from public.care_circle_members c$s$, $s$if false and not exists (select 1 from public.care_circle_members c$s$);
  execute d;
  delete from public.membership_renewal_reminders where membership_id = v_m;
  perform private.queue_membership_renewal_reminders();
  if not exists (select 1 from public.notifications where recipient_id = pg_temp.f('sp') and template = 'membership_gift_renewal_reminder') then
    raise exception 'FAIL sabotage (b): without the consent check the removed sponsor still was not reminded, so check 5 is vacuous';
  end if;
end $$;

-- SABOTAGE (c): the Membership price looked up in the membership row's organisation again -> the second-organisation member gets no
-- Plus notice, so check 2b would catch it
do $$
declare d text := pg_get_functiondef('private.queue_plus_renewal_notice(uuid,integer,boolean,bigint,text)'::regprocedure); v_p uuid := pg_temp.f('plusorg2');
begin
  d := replace(d, $s$private.price_quote_calc(m.patient_id, m.patient_id, 'membership_annual_no_panel', null, false)$s$, $s$private.price_quote_calc(m.patient_id, m.patient_id, 'no_such_item', null, false)$s$);
  d := replace(d, $s$join public.profiles pr on pr.organisation_id = ci.organisation_id$s$, $s$join public.profiles pr on m.organisation_id = ci.organisation_id$s$);
  execute d;
  delete from public.notifications where recipient_id = v_p;
  delete from public.membership_renewal_reminders where membership_id in (select id from public.patient_memberships where patient_id = v_p);
  perform private.queue_membership_renewal_reminders();
  if exists (select 1 from public.notifications where recipient_id = v_p and template = 'membership_plus_renews_as_membership') then
    raise exception 'FAIL sabotage (c): with the price read from the membership organisation the second-organisation notice still went out, so check 2b is vacuous';
  end if;
end $$;

-- SABOTAGE (d): the "most recent order" rule removed -> the earlier sponsor is reminded about a year the beneficiary bought, so 5b catches it
do $$
declare d text := pg_get_functiondef('private.queue_gift_renewal_reminder(uuid,integer)'::regprocedure); v_m uuid := pg_temp.f('own_m');
begin
  d := replace(d, $s$       and o.id = (select x.id from public.orders x$s$, $s$       and o.id <> (select x.id from public.orders x$s$);
  execute d;
  delete from public.membership_renewal_reminders where membership_id = v_m;
  perform private.queue_membership_renewal_reminders();
  if not exists (select 1 from public.notifications where recipient_id = pg_temp.f('sp2') and template = 'membership_gift_renewal_reminder') then
    raise exception 'FAIL sabotage (d): without the most-recent-order rule the earlier sponsor still was not reminded, so check 5b is vacuous';
  end if;
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;

rollback;
