-- ===========================================================================
-- Proof: Care Circle Phase 5 (20261104214130_care_circle_p5_payer_view_and_metrics.sql)
--   A. my_gifts_paid: the payer sees their own paid gift for someone else: the person's first name, the state word, the Membership dates
--      only once accepted. The person who received it, and a stranger, see nothing of it through this read. No clinical key at all.
--   B. admin_care_circle_metrics: admin only; counts only; test accounts excluded; the counts match the fixtures.
--   SABOTAGE: my_gifts_paid without the buyer filter (a stranger sees the gift); metrics without the admin check (a patient reads them);
--   metrics without the test filter (test rows are counted).
-- BEGIN/ROLLBACK; mints its own fixtures. Orders and entitlements are written with triggers off (the checkout has its own proofs).
-- ===========================================================================
begin;
create temp table results (phase text, check_name text, expected text, actual text);
grant all on results to public;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccp5-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Ccp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.gift(p_pat uuid, p_payer uuid, p_acceptance text, p_sweep boolean, p_test boolean) returns uuid language plpgsql as $f$
declare o uuid := gen_random_uuid(); v_org uuid := (select organisation_id from public.profiles where id = p_pat);
        it public.catalog_items%rowtype; pr uuid;
begin
  select * into it from public.catalog_items where kind = 'membership' order by duration_days desc nulls last limit 1;
  select id into pr from public.prices where catalog_item_id = it.id limit 1;
  set local session_replication_role = replica;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at,
                             paystack_reference, is_test)
  values (o, v_org, p_payer, p_pat, it.id, pr, 100000, 0, 100000, 'paid', now(), 'ccp5_' || replace(o::text, '-', ''), p_test);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, is_test, acceptance, decided_at, decided_by_sweep)
  values (v_org, p_pat, o, 'membership', now(), now() + interval '365 days', p_test, p_acceptance,
          case when p_acceptance in ('accepted', 'declined') then now() end, p_sweep);
  set local session_replication_role = origin;
  return o;
end $f$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  pat uuid; pat2 uuid; payer uuid; stranger uuid; adm uuid; tpat uuid; tpayer uuid; o1 uuid; o2 uuid; r text; v jsonb; d text; v_base jsonb;
begin
  adm := pg_temp.mkuser(v_org, 'admin', 'admin', false);
  -- the baseline: whatever real rows a database already holds; the checks below compare the change
  v_base := pg_temp.q_as(adm, 'select public.admin_care_circle_metrics()::text')::jsonb;
  pat := pg_temp.mkuser(v_org, 'mama', 'patient', false); pat2 := pg_temp.mkuser(v_org, 'papa', 'patient', false);
  payer := pg_temp.mkuser(v_org, 'chidi', 'patient', false); stranger := pg_temp.mkuser(v_org, 'stranger', 'patient', false);
  tpat := pg_temp.mkuser(v_org, 'testpat', 'patient', true); tpayer := pg_temp.mkuser(v_org, 'testpayer', 'patient', true);
  o1 := pg_temp.gift(pat, payer, 'accepted', false, false);
  o2 := pg_temp.gift(pat2, payer, 'declined', true, false);
  perform pg_temp.gift(tpat, tpayer, 'accepted', false, true);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat, payer, 'Son', array['appointments'], now() + interval '30 days', false),
         (v_org, pat2, payer, 'Son', array['appointments'], now() + interval '30 days', false),
         (v_org, tpat, tpayer, 'Son', array['appointments'], now() + interval '30 days', true);

  -- A. the payer's view
  v := pg_temp.q_as(payer, 'select public.my_gifts_paid()::text')::jsonb;
  perform pg_temp.ck('A1 the payer sees both gifts, newest first, by first name', '2', jsonb_array_length(v)::text);
  perform pg_temp.ck('A2 an accepted gift shows its Membership dates', 'Mama/accepted/true',
    (select (e ->> 'name') || '/' || (e ->> 'state') || '/' || (e ->> 'ends_at' is not null)::text from jsonb_array_elements(v) e where (e ->> 'order_id')::uuid = o1));
  perform pg_temp.ck('A3 a gift nobody answered says so, with no dates', 'not_answered/true',
    (select (e ->> 'state') || '/' || (e ->> 'ends_at' is null)::text from jsonb_array_elements(v) e where (e ->> 'order_id')::uuid = o2));
  perform pg_temp.ck('A4 billing keys only, nothing clinical', 'ends_at,name,name_key,order_id,paid_at,refund_state,starts_at,state',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v -> 0) k));
  perform pg_temp.ck('A5 the person who received it, and a stranger, see none of it here', '[]/[]',
    pg_temp.q_as(pat, 'select public.my_gifts_paid()::text') || '/' || pg_temp.q_as(stranger, 'select public.my_gifts_paid()::text'));

  -- B. metrics
  perform pg_temp.ck('B1 a patient cannot read the metrics', 'ERR:42501', pg_temp.q_as(payer, 'select public.admin_care_circle_metrics()::text'));
  v := pg_temp.q_as(adm, 'select public.admin_care_circle_metrics()::text')::jsonb;
  perform pg_temp.ck('B2 adoption counts the two real circles and the one supporter of two (not the test circle)', '2/1/1',
    ((v #>> '{adoption,patients_with_circle}')::int - (v_base #>> '{adoption,patients_with_circle}')::int)::text || '/' ||
    ((v #>> '{adoption,active_supporters}')::int - (v_base #>> '{adoption,active_supporters}')::int)::text || '/' ||
    ((v #>> '{adoption,supporters_of_two_or_more}')::int - (v_base #>> '{adoption,supporters_of_two_or_more}')::int)::text);
  perform pg_temp.ck('B3 commercial counts the two real gifts: one accepted, one not answered; revenue only from the accepted one', '2/1/1/100000',
    ((v #>> '{commercial,gifts_paid}')::int - (v_base #>> '{commercial,gifts_paid}')::int)::text || '/' ||
    ((v #>> '{commercial,gifts_accepted}')::int - (v_base #>> '{commercial,gifts_accepted}')::int)::text || '/' ||
    ((v #>> '{commercial,gifts_not_answered}')::int - (v_base #>> '{commercial,gifts_not_answered}')::int)::text || '/' ||
    ((v #>> '{commercial,gift_revenue_kobo}')::bigint - (v_base #>> '{commercial,gift_revenue_kobo}')::bigint)::text);
  perform pg_temp.ck('B4 the metrics carry no name and no clinical key', 'false', (v::text ~* 'Mama|Chidi|systolic|result|reading')::text);

  -- ---------------- SABOTAGE ----------------
  begin
    select pg_get_functiondef('public.my_gifts_paid()'::regprocedure) into d;
    d := replace(d, 'where o.buyer_profile_id = (select auth.uid())', 'where true');
    if d = pg_get_functiondef('public.my_gifts_paid()'::regprocedure) then raise exception 'sabotage S1 did not change the function'; end if;
    execute d;
    r := pg_temp.q_as(stranger, 'select jsonb_array_length(public.my_gifts_paid())::text');
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 buyer filter removed: a stranger DOES see gifts (flips A5)', 'true', (r::int > 0)::text);
  begin
    select pg_get_functiondef('public.admin_care_circle_metrics()'::regprocedure) into d;
    d := replace(d, 'if not private.is_admin() then', 'if false then');
    if d = pg_get_functiondef('public.admin_care_circle_metrics()'::regprocedure) then raise exception 'sabotage S2 did not change the function'; end if;
    execute d;
    r := pg_temp.q_as(payer, 'select public.admin_care_circle_metrics()::text');
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 admin check removed: a patient DOES read the metrics (flips B1)', 'true', (r like '{%')::text);
  begin
    select pg_get_functiondef('public.admin_care_circle_metrics()'::regprocedure) into d;
    d := replace(d, 'with m as (select * from public.care_circle_members where not is_test)', 'with m as (select * from public.care_circle_members)');
    if d = pg_get_functiondef('public.admin_care_circle_metrics()'::regprocedure) then raise exception 'sabotage S3 did not change the function'; end if;
    execute d;
    v := pg_temp.q_as(adm, 'select public.admin_care_circle_metrics()::text')::jsonb;
    r := ((v #>> '{adoption,patients_with_circle}')::int - (v_base #>> '{adoption,patients_with_circle}')::int)::text;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S3 test filter removed: the test circle IS counted (flips B2)', '3', r);
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer;
begin
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'care_circle_p5_payer_view_and_metrics: % check(s) did not hold', n; end if;
  if (select count(*) from results) < 12 then raise exception 'care_circle_p5_payer_view_and_metrics: fewer checks ran than expected'; end if;
end $$;
rollback;
