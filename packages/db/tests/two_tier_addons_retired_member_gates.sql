-- Two tiers, part 2 proof (migration *_two_tier_retire_addons_and_member_gates.sql).
-- Proves in one rolled-back transaction:
--   * the AI coach pass and continuous monitoring are not sellable, cannot be switched back on, and a purchase intent is refused;
--     a pass or monitoring already held is honoured until it expires
--   * the AI coach stays free for everyone (feature true, the global limit applies) and a held pass still raises it
--   * continuous monitoring and the other doctor-time features are Member benefits that follow private.patient_is_member: a Member
--     and a person inside the 14 day grace have them, a Free or lapsed person does not, and nothing recurses
--   * private.risk_is_current_member uses the same one rule, grace included, at a point in time
-- SABOTAGE: the Member block removed from the feature gate, and the grace removed from the point-in-time function; both must flip.
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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
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
create function pg_temp.owner_try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ag-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'AG ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkmember(p_org uuid, p_patient uuid, p_ends_in_days numeric) returns void
language plpgsql as $f$
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
  values (p_org, p_patient, 'purchase', now() - interval '400 days', now() + make_interval(secs => (p_ends_in_days * 86400)::int), true);
end $f$;
create function pg_temp.hold(p_org uuid, p_patient uuid, p_code text) returns void
language plpgsql as $f$
begin
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, payment_provider, purchased_at, expires_at)
  select p_org, p_patient, p_patient, id, 'active', 100, 'NGN', 'paystack', now() - interval '1 day', now() + interval '30 days' from public.service_products where code = p_code;
end $f$;

do $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('free', pg_temp.mkuser(v_org, 'free'));
  perform pg_temp.setf('mem', pg_temp.mkuser(v_org, 'mem'));
  perform pg_temp.setf('grace', pg_temp.mkuser(v_org, 'grace'));
  perform pg_temp.setf('lapsed', pg_temp.mkuser(v_org, 'lapsed'));
  perform pg_temp.setf('pass', pg_temp.mkuser(v_org, 'pass'));
  perform pg_temp.setf('mon', pg_temp.mkuser(v_org, 'mon'));
  perform pg_temp.mkmember(v_org, pg_temp.f('mem'), 200);
  perform pg_temp.mkmember(v_org, pg_temp.f('grace'), -5);
  perform pg_temp.mkmember(v_org, pg_temp.f('lapsed'), -20);
  perform pg_temp.hold(v_org, pg_temp.f('pass'), 'ai_coach_daily_pass_30d');
  perform pg_temp.hold(v_org, pg_temp.f('mon'), 'continuous_monitoring_90d');
end $$;

-- 1. Not for sale -------------------------------------------------------------------------------------------------------------
do $$
declare v_free uuid := pg_temp.f('free');
begin
  perform pg_temp.ck('the AI coach pass and continuous monitoring are off', '0',
    (select count(*)::text from public.service_products where is_active and code ~ '(^ai_coach_daily_pass_30d$|^continuous_monitoring_)'));
  perform pg_temp.ck('both rows are kept, priced', '2', (select count(*)::text from public.service_products where code in ('ai_coach_daily_pass_30d', 'continuous_monitoring_90d') and price_kobo > 0));
  perform pg_temp.ck('the AI coach pass cannot be switched back on', 'true',
    (pg_temp.owner_try($q$update public.service_products set is_active = true where code = 'ai_coach_daily_pass_30d'$q$) like '23514:%')::text);
  perform pg_temp.ck('continuous monitoring cannot be switched back on', 'true',
    (pg_temp.owner_try($q$update public.service_products set is_active = true where code = 'continuous_monitoring_90d'$q$) like '23514:%')::text);
  perform pg_temp.ck('a patient cannot start buying the pass', 'true',
    (pg_temp.q_as(v_free, format($q$select public.record_service_purchase_intent(%L, 'ai_coach_daily_pass_30d')::text$q$, v_free)) like 'ERR:%')::text);
  perform pg_temp.ck('a patient cannot start buying monitoring', 'true',
    (pg_temp.q_as(v_free, format($q$select public.record_service_purchase_intent(%L, 'continuous_monitoring_90d')::text$q$, v_free)) like 'ERR:%')::text);
end $$;

-- 2. The AI coach is free; a held pass is honoured -------------------------------------------------------------------------------
do $$
declare v_global integer;
begin
  select daily_limit into v_global from public.ai_coach_access_rules where patient_id is null and organisation_id = pg_temp.f('org');
  perform pg_temp.ck('the AI coach is free for a Free patient', 'true', private.patient_has_feature_access(pg_temp.f('free'), 'ai_coach')::text);
  perform pg_temp.ck('and its daily limit is the global free limit', coalesce(v_global::text, 'null'), coalesce(pg_temp.q_as(pg_temp.f('free'), 'select public.get_ai_coach_daily_limit()::text'), 'null'));
  perform pg_temp.ck('a pass already held still raises the limit to 100 until it expires', '100', pg_temp.q_as(pg_temp.f('pass'), 'select public.get_ai_coach_daily_limit()::text'));
  perform pg_temp.ck('monitoring already held still grants clinician review until it expires', 'true', private.patient_has_feature_access(pg_temp.f('mon'), 'clinician_review')::text);
end $$;

-- 3. Monitoring and the doctor-time features follow Membership -------------------------------------------------------------------
do $$
declare feat text; v_ok text; v_free text; v_grace text; v_lapsed text;
begin
  perform pg_temp.ck('a Free patient has no clinician review', 'false', private.patient_has_feature_access(pg_temp.f('free'), 'clinician_review')::text);
  perform pg_temp.ck('a Free patient is not paged for (red event gate)', 'false', private.patient_has_feature_access(pg_temp.f('free'), 'vitals_red_flag_doctor_escalation')::text);
  perform pg_temp.ck('an unknown patient is paged for (fail closed)', 'true', private.patient_has_feature_access(null, 'vitals_red_flag_doctor_escalation')::text);
  foreach feat in array array['clinician_review', 'doctor_checkin', 'chronic_doctor_supported_track', 'result_document_review', 'multi_condition_review', 'annual_review', 'vitals_red_flag_doctor_escalation'] loop
    v_ok := private.patient_has_feature_access(pg_temp.f('mem'), feat)::text;
    v_grace := private.patient_has_feature_access(pg_temp.f('grace'), feat)::text;
    v_lapsed := private.patient_has_feature_access(pg_temp.f('lapsed'), feat)::text;
    perform pg_temp.ck('a Member / in grace / lapsed for ' || feat, 'true/true/false', v_ok || '/' || v_grace || '/' || v_lapsed);
  end loop;
  perform pg_temp.ck('the legacy async_doctor_visit check does not recurse for a Member', 'true', private.patient_is_member(pg_temp.f('mem'))::text);
  perform pg_temp.ck('and is false for a Free patient', 'false', private.patient_is_member(pg_temp.f('free'))::text);
end $$;

-- 4. One rule, at a point in time -------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('risk helper: a Member now', 'true', private.risk_is_current_member(pg_temp.f('mem'), now())::text);
  perform pg_temp.ck('risk helper: five days after the year ended is still a Member (grace)', 'true', private.risk_is_current_member(pg_temp.f('grace'), now())::text);
  perform pg_temp.ck('risk helper: twenty days after is not', 'false', private.risk_is_current_member(pg_temp.f('lapsed'), now())::text);
  perform pg_temp.ck('risk helper: a point inside the year is a Member', 'true', private.risk_is_current_member(pg_temp.f('lapsed'), now() - interval '60 days')::text);
  perform pg_temp.ck('risk helper: before the Membership began is not', 'false', private.risk_is_current_member(pg_temp.f('mem'), now() - interval '500 days')::text);
  perform pg_temp.ck('the helper and patient_is_member agree for all four people', 'true/true/true/true',
    (private.risk_is_current_member(pg_temp.f('mem'), now()) = private.patient_is_member(pg_temp.f('mem')))::text || '/' ||
    (private.risk_is_current_member(pg_temp.f('grace'), now()) = private.patient_is_member(pg_temp.f('grace')))::text || '/' ||
    (private.risk_is_current_member(pg_temp.f('lapsed'), now()) = private.patient_is_member(pg_temp.f('lapsed')))::text || '/' ||
    (private.risk_is_current_member(pg_temp.f('free'), now()) = private.patient_is_member(pg_temp.f('free')))::text);
end $$;

-- SABOTAGE 1: take the Member block out of the feature gate; a Member must now lose clinician review
do $$
declare d text;
begin
  d := replace(pg_get_functiondef('private.patient_has_feature_access'::regproc),
    'if p_patient_id is not null and private.patient_is_member(p_patient_id) then return true; end if;', 'null;');
  if d = pg_get_functiondef('private.patient_has_feature_access'::regproc) then raise exception 'VACUOUS TEST: sabotage text not found'; end if;
  execute d;
  insert into results values ('sabotaged', 'a Member has clinician review (continuous monitoring is a Member benefit)', 'true', private.patient_has_feature_access(pg_temp.f('mem'), 'clinician_review')::text);
end $$;

-- SABOTAGE 2: take the grace out of the point-in-time rule; a person inside the grace must now read as Free
create or replace function private.patient_is_member_at(p_patient uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_memberships m where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= p_at
                    and (m.ends_at is null or m.ends_at > p_at));
$$;
insert into results values ('sabotaged', 'risk helper: five days after the year ended is still a Member (grace)', 'true', private.risk_is_current_member(pg_temp.f('grace'), now())::text);

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'two-tier add-ons proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
