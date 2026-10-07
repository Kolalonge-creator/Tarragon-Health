-- S29b proof: a gifted care pack or Membership waits for the patient's acceptance (migration *_s29b_gifted_care_pack_acceptance.sql).
-- Proves: a gift that grants a lead is paid but PENDING: order.paid carries care_pack = false and gift_pending = true (so the S18 lead
-- handler ignores it), no Membership starts, the patient is asked once and the payer sees nothing; only the patient can answer;
-- accepting starts the Membership and emits order.paid (care_pack = true) once, replaying changes nothing; declining closes the
-- entitlement, starts nothing and opens a finance incident to refund the payer (the payer is not told); an unanswered gift is treated
-- as declined after the configured days; a purchase for oneself is unchanged; grants.
-- SABOTAGE: the gift detection removed (a gift would assign a lead at once) and the patient check removed (a stranger could answer);
-- both checks must flip.
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
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
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
-- run a statement as the service role; returns the text of the result or 'ERR:' || message
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's25-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S25 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, is_test)
  values (p_org, v, 'S25 ' || p_label, 'MDCN', 'S25-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, 'employed'::public.staff_employment_type, 2, false, true)
  returning id into s;
  foreach c in array array['adult_general', 'hypertension', 'lead_clinician'] loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
-- pay an order as the service role. p_amount/p_fee/p_total default to the order's own price and a 150 kobo fee.
create function pg_temp.pay(p_ref text, p_amount bigint, p_fee bigint, p_total bigint, p_cur text default 'NGN', p_src text default 'webhook') returns text language sql as
$$ select pg_temp.svc(format($q$select public.record_order_payment(%L, %s, %s, %s, %L, 'success', %L, 'evt-1', now(), '{}'::jsonb)::text$q$,
                              p_ref, p_amount, p_fee, p_total, p_cur, p_src)) $$;
create function pg_temp.res(p text) returns text language sql as $$ select (p::jsonb) ->> 'result' $$;
create function pg_temp.order_ref(p_uid uuid, p_code text, p_key uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select (public.create_order(%L, %L))->>'reference'$q$, p_code, p_key)) $$;


create function pg_temp.addmember(p_org uuid, p_pat uuid, p_sup uuid, p_perms text[]) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (p_org, p_pat, p_sup, 'Daughter', p_perms, now() + interval '90 days', true) returning id into v;
  return v;
end $f$;
create function pg_temp.gift_order(p_buyer uuid, p_ben uuid, p_code text) returns text language sql as
$$ select pg_temp.q_as(p_buyer, format($q$select (public.create_order(%L, gen_random_uuid(), %L))->>'reference'$q$, p_code, p_ben)) $$;
create function pg_temp.respond(p_uid uuid, p_ent uuid, p_accept boolean) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select (public.respond_to_gifted_pack(%L, %L))->>'result'$q$, p_ent, p_accept)) $$;
create function pg_temp.ent_of(p_ref text) returns uuid language sql as
$$ select e.id from public.entitlements e join public.orders o on o.id = e.order_id where o.paystack_reference = p_ref $$;
create function pg_temp.mkprice(p_org uuid) returns void language sql as $$ select 1 $$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_sup uuid; v_nope uuid; v_doc1 uuid; v_doc2 uuid; v_doc3 uuid;
  r1 text; r2 text; r3 text; r4 text; e1 uuid; e2 uuid; e3 uuid; o1 uuid; o2 uuid; o3 uuid; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient');
  v_sup := pg_temp.mkuser(v_org, 'sup', 'patient');
  v_nope := pg_temp.mkuser(v_org, 'nope', 'patient');
  update public.profiles set receives_care = false where id = v_sup;
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('sup', v_sup); perform pg_temp.setf('nope', v_nope); perform pg_temp.setf('org', v_org);
  perform pg_temp.addmember(v_org, v_pat, v_sup, array['pay_for_care']);
  v_doc1 := pg_temp.mkdoc(v_org, 'lead1', v_admin);
  v_doc2 := pg_temp.mkdoc(v_org, 'lead2', v_admin);
  v_doc3 := pg_temp.mkdoc(v_org, 'lead3', v_admin);
  perform pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('membership_annual', true, 'Proof run, membership on for testing')$q$);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S29b proof run' where key = 'v5_checkout';

  perform pg_temp.ck('the migration added the acceptance column', 'true',
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entitlements' and column_name = 'acceptance'))::text);
  perform pg_temp.ck('anon cannot answer a gift', '42501', pg_temp.try_anon($q$select public.respond_to_gifted_pack(gen_random_uuid(), true)$q$));
  perform pg_temp.ck('anon cannot list gifts', '42501', pg_temp.try_anon($q$select public.my_pending_gifts()$q$));
  perform pg_temp.ck('a signed-in user cannot record a payment', 'true',
    (pg_temp.q_as(v_pat, $q$select public.record_order_payment('tho_x', 1, 0, 1, 'NGN', 'success', 'webhook')::text$q$) like '%permission denied%')::text);

  -- 1. A gift that grants a lead is paid but pending ------------------------------------------------------------------------
  r1 := pg_temp.gift_order(v_sup, v_pat, 'membership_annual');
  perform pg_temp.ck('a member with pay_for_care orders a Membership for the patient', 'true', (r1 ~ '^tho_[0-9a-f]{32}$')::text);
  o1 := (select id from public.orders where paystack_reference = r1);
  perform pg_temp.ck('paying it', 'paid', pg_temp.res(pg_temp.pay(r1, 10000000, 15000, 10015000)));
  e1 := pg_temp.ent_of(r1);
  perform pg_temp.ck('the entitlement is pending acceptance', 'pending', (select acceptance from public.entitlements where id = e1));
  perform pg_temp.ck('order.paid does not ask for a lead', 'false', (select payload ->> 'care_pack' from public.domain_events where event_type = 'order.paid' and aggregate_id = o1 and idempotency_key = 'order:' || o1));
  perform pg_temp.ck('and says the gift is pending', 'true', (select payload ->> 'gift_pending' from public.domain_events where event_type = 'order.paid' and aggregate_id = o1 and idempotency_key = 'order:' || o1));
  perform pg_temp.ck('no Membership has started', 'false', (select private.patient_is_member(v_pat)::text));
  perform pg_temp.ck('no lead-slot incident for a gift that is only pending', '0', (select count(*)::text from public.ops_incidents where external_reference = 'order-no-lead-slot:' || o1));
  perform pg_temp.ck('the patient is asked once, in the app, with nothing in the payload', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_gift_waiting' and payload = '{}'::jsonb));
  perform pg_temp.ck('and is not also sent the plain paid-for-you notice', '0', (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_paid_for_you'));
  perform pg_temp.ck('the patient lists the pending gift', 'true', (pg_temp.q_as(v_pat, 'select public.my_pending_gifts()::text') like '%' || e1::text || '%')::text);
  perform pg_temp.ck('the payer lists none', '[]', pg_temp.q_as(v_sup, 'select public.my_pending_gifts()::text'));
  perform pg_temp.ck('only the patient can answer: the payer is told not found', 'not_found', pg_temp.respond(v_sup, e1, true));
  perform pg_temp.ck('and so is a stranger', 'not_found', pg_temp.respond(v_nope, e1, true));
  perform pg_temp.ck('nothing changed for either', 'pending', (select acceptance from public.entitlements where id = e1));

  -- 2. Decline ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('the patient declines', 'declined', pg_temp.respond(v_pat, e1, false));
  perform pg_temp.ck('the entitlement is closed', 'declined/revoked', (select acceptance || '/' || state from public.entitlements where id = e1));
  perform pg_temp.ck('no Membership started', 'false', (select private.patient_is_member(v_pat)::text));
  perform pg_temp.ck('no lead was ever asked for', '0',
    (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = o1 and (payload ->> 'care_pack') = 'true'));
  perform pg_temp.ck('finance gets one incident to refund the payer', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'order-gift-declined:' || o1 and status not in ('resolved', 'closed')));
  perform pg_temp.ck('the payer is told nothing', '0', (select count(*)::text from public.notifications where recipient_id = v_sup));
  perform pg_temp.ck('answering again changes nothing', 'declined', pg_temp.respond(v_pat, e1, true));
  perform pg_temp.ck('the declined gift is no longer listed', '[]', pg_temp.q_as(v_pat, 'select public.my_pending_gifts()::text'));

  -- 3. Accept -------------------------------------------------------------------------------------------------------------------
  r2 := pg_temp.gift_order(v_sup, v_pat, 'membership_annual');
  o2 := (select id from public.orders where paystack_reference = r2);
  perform pg_temp.pay(r2, 10000000, 15000, 10015000);
  e2 := pg_temp.ent_of(r2);
  perform pg_temp.ck('a second gift is pending', 'pending', (select acceptance from public.entitlements where id = e2));
  perform pg_temp.ck('the patient accepts', 'accepted', pg_temp.respond(v_pat, e2, true));
  perform pg_temp.ck('accepting again changes nothing', 'accepted', pg_temp.respond(v_pat, e2, true));
  perform pg_temp.ck('the Membership starts on acceptance', 'true', (select private.patient_is_member(v_pat)::text));
  perform pg_temp.ck('and runs a year from the day of the yes', 'true',
    (select (ends_at between now() + interval '364 days' and now() + interval '366 days') from public.patient_memberships where patient_id = v_pat and state = 'active')::text);
  perform pg_temp.ck('the entitlement runs from the yes too', 'true', (select (starts_at > now() - interval '1 minute') from public.entitlements where id = e2)::text);
  perform pg_temp.ck('accepting asks for a lead exactly once, under its own key', '1',
    (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = o2 and idempotency_key = 'order-accepted:' || o2 and (payload ->> 'care_pack') = 'true'));
  perform pg_temp.ck('the original payment event stays a pending gift', 'false',
    (select payload ->> 'care_pack' from public.domain_events where event_type = 'order.paid' and aggregate_id = o2 and idempotency_key = 'order:' || o2));
  perform pg_temp.ck('the payer still sees only their own orders', '2', pg_temp.q_as(v_sup, 'select count(*)::text from public.orders'));

  -- 4. An unanswered gift is treated as declined ------------------------------------------------------------------------------
  update public.care_circle_members set expires_at = now() + interval '90 days' where patient_id = v_pat;
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'proof step: reset the membership' where patient_id = v_pat and state = 'active';
  r3 := pg_temp.gift_order(v_sup, v_pat, 'membership_annual');
  o3 := (select id from public.orders where paystack_reference = r3);
  perform pg_temp.pay(r3, 10000000, 15000, 10015000);
  e3 := pg_temp.ent_of(r3);
  perform pg_temp.ck('a third gift is pending', 'pending', (select acceptance from public.entitlements where id = e3));
  v_n := private.expire_pending_gifts();
  perform pg_temp.ck('a gift younger than the window is left alone', '0', v_n::text);
  -- S29d: 14 days to answer, with one reminder on day 7
  update public.entitlements set created_at = now() - interval '10 days' where id = e3;
  v_n := private.expire_pending_gifts();
  v_n := v_n + private.expire_pending_gifts();
  perform pg_temp.ck('ten days in, the gift is still waiting', 'pending', (select acceptance from public.entitlements where id = e3));
  perform pg_temp.ck('and the patient has had one reminder, not two', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_gift_waiting' and source_table = 'entitlements' and source_id = e3 and payload = '{}'::jsonb));
  update public.entitlements set created_at = now() - interval '15 days' where id = e3;
  v_n := private.expire_pending_gifts();
  perform pg_temp.ck('an unanswered gift is swept', '1', v_n::text);
  perform pg_temp.ck('it is declined and revoked', 'declined/revoked', (select acceptance || '/' || state from public.entitlements where id = e3));
  perform pg_temp.ck('finance gets an incident to refund the payer', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'order-gift-declined:' || o3 and status not in ('resolved', 'closed')));
  perform pg_temp.ck('a swept gift cannot then be accepted', 'declined', pg_temp.respond(v_pat, e3, true));

  -- 5. Buying for yourself is unchanged ---------------------------------------------------------------------------------------
  r4 := pg_temp.order_ref(v_pat2, 'membership_annual', gen_random_uuid());
  perform pg_temp.pay(r4, 10000000, 15000, 10015000);
  perform pg_temp.ck('a self purchase needs no acceptance', 'not_needed', (select acceptance from public.entitlements where id = pg_temp.ent_of(r4)));
  perform pg_temp.ck('a self purchase makes a Member at once', 'true', (select private.patient_is_member(v_pat2)::text));
  perform pg_temp.ck('and asks for a lead at once', 'true',
    (select payload ->> 'care_pack' from public.domain_events where event_type = 'order.paid' and idempotency_key = 'order:' || (select id from public.orders where paystack_reference = r4)));
end $$;

-- SABOTAGE ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_sup uuid := pg_temp.f('sup'); v_nope uuid := pg_temp.f('nope'); v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat');
  d text; r text; v_pat3 uuid; e uuid; res text;
begin
  -- the patient check removed: a stranger could answer for the patient
  v_pat3 := pg_temp.mkuser(v_org, 'pat3', 'patient');
  perform pg_temp.addmember(v_org, v_pat3, v_sup, array['pay_for_care']);
  r := pg_temp.gift_order(v_sup, v_pat3, 'membership_annual');
  perform pg_temp.pay(r, 10000000, 15000, 10015000);
  e := pg_temp.ent_of(r);
  select pg_get_functiondef('public.respond_to_gifted_pack(uuid, boolean)'::regprocedure) into d;
  d := replace(d, 'and patient_id = (select auth.uid()) for update', 'for update');
  if d = pg_get_functiondef('public.respond_to_gifted_pack(uuid, boolean)'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  execute d;
  res := pg_temp.respond(v_nope, e, false);
  insert into results values ('sabotaged', 'a stranger cannot answer for the patient', 'not_found', res);

  -- the gift detection removed: a gift would assign a lead at once
  select pg_get_functiondef('public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)'::regprocedure) into d;
  d := replace(d, 'o.buyer_profile_id <> o.beneficiary_patient_id', 'false');
  if d = pg_get_functiondef('public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute d;
  v_pat3 := pg_temp.mkuser(v_org, 'pat4', 'patient');
  perform pg_temp.addmember(v_org, v_pat3, v_sup, array['pay_for_care']);
  r := pg_temp.gift_order(v_sup, v_pat3, 'membership_annual');
  perform pg_temp.pay(r, 10000000, 15000, 10015000);
  insert into results values ('sabotaged', 'a gift waits for the patient (no lead asked for at once)', 'pending', (select acceptance from public.entitlements where id = pg_temp.ent_of(r)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S29b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
