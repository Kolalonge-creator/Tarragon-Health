-- Proof: the older video-visit request route shows the price it charges (migration *_video_visit_price_single_source.sql).
--
-- Proves in one rolled-back transaction:
--   1. public.my_video_visit_price() for a Member returns the same amount the charge trigger pins on a real request insert.
--   2. Changing the product price moves both together; an organisation override wins for that organisation's patient only.
--   3. Switching the price off answers null; anon is refused; private.video_visit_price is not callable by a signed-in user.
--   4. SABOTAGE: restore the pre-fix reading (the organisation-less video_visit_prices row, which is what the screens used to read)
--      and move that row away from the product: the quoted and charged amounts disagree, so check 1 was the single source.
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
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  if p_uid is null then perform pg_temp.act_anon(); else perform pg_temp.act(p_uid); end if;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'vvp-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'VVP ' || p_label, '+23481' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, organisation_id = excluded.organisation_id,
    date_of_birth = excluded.date_of_birth, phone = excluded.phone;
  return v;
end $f$;
-- the amount the charge trigger pins for this patient, read back from a real insert
create function pg_temp.charged(p_org uuid, p_patient uuid) returns text language plpgsql as
$f$ declare v bigint;
begin
  insert into public.video_visit_requests (organisation_id, patient_id) values (p_org, p_patient) returning amount_minor into v;
  return v::text;
exception when others then return 'ERR:' || sqlstate || ':' || sqlerrm;
end $f$;

do $$
declare v_org uuid; v_org2 uuid; v_admin uuid; v_pm uuid; v_pm2 uuid; v_quote text; v_charge text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then
    insert into public.organisations (name, type) values ('Proof other organisation', 'direct_consumer') returning id into v_org2;
  end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pm := pg_temp.mkuser(v_org, 'member', 'patient');
  v_pm2 := pg_temp.mkuser(v_org2, 'member-other-org', 'patient');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, granted_by, grant_reason, is_test)
  values (v_org, v_pm, 'granted', 'active', now() - interval '1 day', v_admin, 'proof fixture membership', true),
         (v_org2, v_pm2, 'granted', 'active', now() - interval '1 day', v_admin, 'proof fixture membership', true);
  delete from public.video_visit_prices where organisation_id is not null;

  -- 1. quoted = charged
  v_quote := pg_temp.q_as(v_pm, $q$select (public.my_video_visit_price() ->> 'amount_minor')$q$);
  v_charge := pg_temp.charged(v_org, v_pm);
  perform pg_temp.rec('1a a Member is quoted a price', 'true', (v_quote ~ '^[0-9]+$')::text);
  perform pg_temp.rec('1b the quoted price is the charged price', v_quote, v_charge);
  perform pg_temp.rec('1c it is the product row', v_quote, (select price_kobo::text from public.service_products where code = 'video_visit_credit'));

  -- 2. a price change moves both; an organisation override wins only for that organisation
  update public.service_products set price_kobo = 912300 where code = 'video_visit_credit';
  perform pg_temp.rec('2a quote follows a product price change', '912300', pg_temp.q_as(v_pm, $q$select (public.my_video_visit_price() ->> 'amount_minor')$q$));
  perform pg_temp.rec('2b charge follows it too', '912300', pg_temp.charged(v_org, v_pm));
  insert into public.video_visit_prices (organisation_id, amount_minor, currency) values (v_org2, 654300, 'NGN');
  perform pg_temp.rec('2c the other organisation''s patient is quoted its override', '654300', pg_temp.q_as(v_pm2, $q$select (public.my_video_visit_price() ->> 'amount_minor')$q$));
  perform pg_temp.rec('2d and charged it', '654300', pg_temp.charged(v_org2, v_pm2));
  perform pg_temp.rec('2e this organisation''s patient is unaffected by that override', '912300', pg_temp.q_as(v_pm, $q$select (public.my_video_visit_price() ->> 'amount_minor')$q$));

  -- 3. off, anon, private
  update public.service_products set is_active = false where code = 'video_visit_credit';
  perform pg_temp.rec('3a price switched off answers null', 'null', coalesce(pg_temp.q_as(v_pm, $q$select public.my_video_visit_price()::text$q$), 'null'));
  update public.service_products set is_active = true where code = 'video_visit_credit';
  perform pg_temp.rec('3b anon is refused', 'ERR:42501', pg_temp.q_as(null, $q$select public.my_video_visit_price()::text$q$));
  perform pg_temp.rec('3c a signed-in user cannot call the private ranking directly', 'ERR:42501', pg_temp.q_as(v_pm, format($q$select (private.video_visit_price(%L)).amount_minor::text$q$, v_org)));

  -- 4. SABOTAGE: the pre-fix reading
  execute $s$ create or replace function public.my_video_visit_price() returns jsonb language sql stable security definer set search_path to '' as $b$
    select jsonb_build_object('amount_minor', v.amount_minor, 'currency', v.currency) from public.video_visit_prices v where v.organisation_id is null $b$ $s$;
  update public.video_visit_prices set amount_minor = 1000000 where organisation_id is null;
  v_quote := pg_temp.q_as(v_pm, $q$select (public.my_video_visit_price() ->> 'amount_minor')$q$);
  v_charge := pg_temp.charged(v_org, v_pm);
  insert into results values ('sabotage', '4 SABOTAGE old reading restored: quoted and charged disagree (so 1b was the single source)', 'true', (v_quote ~ '^[0-9]+$' and v_charge ~ '^[0-9]+$' and v_quote is distinct from v_charge)::text);

  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'video visit price proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'video visit price single source: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
