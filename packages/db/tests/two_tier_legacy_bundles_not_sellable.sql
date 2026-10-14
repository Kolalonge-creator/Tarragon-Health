-- Two-tier item 8 proof: the legacy screening bundles that duplicate the Membership annual test are not sellable
-- (migration *_two_tier_legacy_screening_bundles_not_sellable.sql).
--
-- Proves in one rolled-back transaction, through the real purchase routes and not only the flags:
--   1. All 7 named bundles are inactive and not self-bookable; their prices are unchanged (not repriced).
--   2. Other self-bookable bundles are untouched (a control: the test can tell a closed door from a missing one).
--   3. purchase_care_voucher, sponsor_book_care and a direct patient-initiated lab order all refuse a retired bundle and
--      accept a still-sellable one.
--   4. The CHECK constraint refuses switching a retired bundle back on.
--   5. SABOTAGE: drop the constraint and re-enable screen_core; the purchase must then succeed, flipping the check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

do $$
declare
  v_org uuid; v_pt uuid := gen_random_uuid(); v_ben uuid := gen_random_uuid(); v_core uuid; v_ok uuid; v_codes text[] := array['screen_core', 'screen_essential', 'screen_advanced', 'screen_comprehensive', 'annual_health_check', 'health_check_basic', 'health_check_comprehensive'];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pt, 'tt8-' || v_pt || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v_pt, v_org, 'patient', 'TT8 patient', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set is_test = true;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_ben, 'tt8b-' || v_ben || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v_ben, v_org, 'patient', 'TT8 beneficiary', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '70 years')::date, true, 'en')
  on conflict (id) do update set is_test = true;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_ben, v_pt, 'manage', v_ben);
  insert into fx values ('pt', v_pt);
  select id into v_core from public.panel_bundles where code = 'screen_core';
  select id into v_ok from public.panel_bundles where code = 'single_hiv';

  perform pg_temp.rec('all 7 bundles exist', '7', (select count(*)::text from public.panel_bundles where code = any (v_codes)));
  perform pg_temp.rec('none is active or self-bookable', '0', (select count(*)::text from public.panel_bundles where code = any (v_codes) and (is_active or self_bookable)));
  perform pg_temp.rec('prices are not changed (screen_core, screen_essential)', '24650000,18100000',
    (select (select price_kobo from public.panel_bundles where code = 'screen_core')::text || ',' || (select price_kobo from public.panel_bundles where code = 'screen_essential')::text));
  perform pg_temp.rec('control: a single-test bundle is still sellable', 'true', (select (is_active and self_bookable)::text from public.panel_bundles where code = 'single_hiv'));
  perform pg_temp.rec('the constraint refuses switching a retired bundle on', '23514', pg_temp.try($q$update public.panel_bundles set self_bookable = true where code = 'screen_core'$q$));
  perform pg_temp.rec('...and refuses activating it', '23514', pg_temp.try($q$update public.panel_bundles set is_active = true where code = 'screen_advanced'$q$));

  perform set_config('request.jwt.claims', json_build_object('sub', v_pt, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  perform pg_temp.rec('a care voucher for a retired bundle is refused', 'P0001', pg_temp.try(format('select public.purchase_care_voucher(%L, %L)', v_pt, v_core)));
  perform pg_temp.rec('control: a care voucher for a sellable bundle works', 'ok', pg_temp.try(format('select public.purchase_care_voucher(%L, %L)', v_pt, v_ok)));
  perform pg_temp.rec('a sponsor booking of a retired bundle is refused', '42501', pg_temp.try(format('select public.sponsor_book_care(%L, ''screen_core'')', v_ben)));
  perform pg_temp.rec('control: a sponsor booking of a sellable bundle works', 'ok', pg_temp.try(format('select public.sponsor_book_care(%L, ''single_hiv'')', v_ben)));
  perform pg_temp.rec('a patient-initiated lab order for a retired bundle is refused', '23514',
    pg_temp.try(format('insert into public.lab_orders (organisation_id, patient_id, status, total_kobo, origin, panel_bundle_id, fulfilment) values (%L, %L, ''ordered'', 0, ''patient_initiated'', %L, ''self_arranged'')', v_org, v_pt, v_core)));
  reset role;
end $$;

-- 5. SABOTAGE
do $$
declare v_pt uuid; v_core uuid;
begin
  select id into v_pt from fx where label = 'pt';
  select id into v_core from public.panel_bundles where code = 'screen_core';
  alter table public.panel_bundles drop constraint panel_bundles_membership_duplicates_not_sellable;
  update public.panel_bundles set self_bookable = true where code = 'screen_core';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into results values ('sabotaged', 'a care voucher for a retired bundle is refused', 'P0001', pg_temp.try(format('select public.purchase_care_voucher(%L, %L)', v_pt, v_core)));
  reset role;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Item 8 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage did not change the matching check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
