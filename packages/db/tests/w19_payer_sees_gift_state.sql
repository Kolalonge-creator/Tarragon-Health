-- W-19 proof (founder D-14): the PAYER of a gift sees its state in my_orders.gift_state, including 'declined' when it is not accepted.
-- NOT EXECUTED LOCALLY when written (Docker was down); CI replay is the first run. Reuses the s29b fixtures and flow.
--   1. Paid and unanswered: the payer sees 'waiting'.   2. The person declines: the payer sees 'declined'.   3. An unanswered gift swept after
--   the window: the payer sees the SAME word 'declined' (cannot tell which it was).   4. Accepted: 'accepted'.   5. The person receiving the gift
--   sees null for gift_state; a stranger sees no row.   6. The payer is still sent no notification; the payload carries no reason and no
--   recipient identity beyond the order row the payer already had.   7. A purchase for oneself has gift_state null.
-- SABOTAGE: the buyer check removed (the recipient would see the field) and the decline mapping removed (the payer would see nothing).
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

-- the gift_state the caller sees for one order: the word, 'null' when the row exists without one, 'none' when there is no row
create function pg_temp.gs(p_uid uuid, p_order uuid) returns text language sql as
$$ select coalesce((select coalesce(x ->> 'gift_state', 'null') from jsonb_array_elements(pg_temp.q_as(p_uid, 'select public.my_orders()::text')::jsonb) x where x ->> 'order_id' = p_order::text), 'none') $$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_sup uuid; v_nope uuid; v_doc1 uuid; v_doc2 uuid; v_doc3 uuid;
  r1 text; r2 text; r3 text; r4 text; e1 uuid; e2 uuid; e3 uuid; o1 uuid; o2 uuid; o3 uuid; v_n integer; v_pat2 uuid;
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
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions) values ('membership_billing_enabled', 'switched_on', v_admin, 'admin', 'proof run', '[]'::jsonb);
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'proof run' where key = 'membership_billing_enabled';
  perform pg_temp.try_as(v_admin, $q$select public.set_catalog_item_active('membership_annual', true, 'Proof run, membership on for testing')$q$);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'W-19 proof run' where key = 'v5_checkout';

  -- 1 waiting
  r1 := pg_temp.gift_order(v_sup, v_pat, 'membership_annual');
  o1 := (select id from public.orders where paystack_reference = r1);
  perform pg_temp.pay(r1, 12900000, 15000, 12915000);
  e1 := pg_temp.ent_of(r1);
  perform pg_temp.ck('1 payer sees waiting', 'waiting', pg_temp.gs(v_sup, o1));
  perform pg_temp.ck('1b the person receiving it sees no gift_state', 'null', pg_temp.gs(v_pat, o1));
  perform pg_temp.ck('1c a stranger sees no row', 'none', pg_temp.gs(v_nope, o1));
  -- 2 declined by the person
  perform pg_temp.ck('2a the person declines', 'declined', pg_temp.respond(v_pat, e1, false));
  perform pg_temp.ck('2b payer sees declined', 'declined', pg_temp.gs(v_sup, o1));
  perform pg_temp.ck('2c the person still sees no gift_state', 'null', pg_temp.gs(v_pat, o1));
  perform pg_temp.ck('2d the payer is still sent no notification', '0', (select count(*)::text from public.notifications where recipient_id = v_sup));
  perform pg_temp.ck('2e the payer row carries no reason and no recipient name', 'false',
    (pg_temp.q_as(v_sup, 'select public.my_orders()::text') ~* '(reason|decline_reason|declined_by|S25 pat)')::text);
  -- 3 swept: the same word
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'proof step' where patient_id = v_pat and state = 'active';
  r3 := pg_temp.gift_order(v_sup, v_pat, 'membership_annual');
  o3 := (select id from public.orders where paystack_reference = r3);
  perform pg_temp.pay(r3, 12900000, 15000, 12915000);
  e3 := pg_temp.ent_of(r3);
  update public.entitlements set created_at = now() - interval '15 days' where id = e3;
  v_n := private.expire_pending_gifts();
  perform pg_temp.ck('3 a swept gift shows the same word to the payer', 'declined', pg_temp.gs(v_sup, o3));
  -- 4 accepted
  r2 := pg_temp.gift_order(v_sup, v_pat, 'membership_annual');
  o2 := (select id from public.orders where paystack_reference = r2);
  perform pg_temp.pay(r2, 12900000, 15000, 12915000);
  e2 := pg_temp.ent_of(r2);
  perform pg_temp.ck('4a accepted', 'accepted', pg_temp.respond(v_pat, e2, true));
  perform pg_temp.ck('4b payer sees accepted', 'accepted', pg_temp.gs(v_sup, o2));
  -- 7 self purchase
  r4 := pg_temp.order_ref(v_pat2, 'membership_annual', gen_random_uuid());
  perform pg_temp.pay(r4, 12900000, 15000, 12915000);
  perform pg_temp.ck('7 a self purchase has no gift_state', 'null', pg_temp.gs(v_pat2, (select id from public.orders where paystack_reference = r4)));
  perform pg_temp.setf('o1', o1);
end $$;

-- SABOTAGE
do $$
declare d text; v_sup uuid := pg_temp.f('sup'); v_pat uuid := pg_temp.f('pat'); o1 uuid := pg_temp.f('o1');
begin
  select pg_get_functiondef('public.my_orders()'::regprocedure) into d;
  d := replace(d, 'case when o.buyer_profile_id = (select auth.uid()) and o.beneficiary_patient_id is not null', 'case when true and o.beneficiary_patient_id is not null');
  if d = pg_get_functiondef('public.my_orders()'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  execute d;
  insert into results values ('sabotaged', 'the recipient must not see gift_state', 'null', pg_temp.gs(v_pat, o1));
  select pg_get_functiondef('public.my_orders()'::regprocedure) into d;
  d := replace(d, 'when ''declined'' then ''declined''', 'when ''declined'' then null');
  if d = pg_get_functiondef('public.my_orders()'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute d;
  insert into results values ('sabotaged', 'the payer must see declined', 'declined', pg_temp.gs(v_sup, o1));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W-19 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
