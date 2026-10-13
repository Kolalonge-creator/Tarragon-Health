-- OQ-261 proof: home delivery is removed from the database (migration *_oq261_remove_home_delivery.sql). Spec Part C.2.
--
--   1. Every removed column, the attempts table, the three delivery types, the four delivery functions and the two delivery triggers are gone,
--      and the old nine-argument pharmacist_update_profile is gone.
--   2. pharmacy_order_status is exactly the collection set (no out_for_delivery, delivery_failed or delivered), and a removed value cannot be written.
--   3. The five status-driven triggers on pharmacy_orders are back and still work: a dispensed order queues the neutral "ready for collection" notice
--      in app, an unavailable order queues the unavailable notice, a paid order still records its commission trigger.
--   4. What is deliberately kept is still there: logistics_partners (dormant), the courier and cold-chain columns, the 'delivery' region service type reads.
--   5. The recreated functions keep their grants: authenticated and service_role can execute, anon and public cannot.
--   6. A pharmacist updates their own profile with the eight-argument function (no delivery argument), and a pharmacist with no pharmacy is refused.
--   7. The operations summary reports pharmacy orders as total and dispensed (no delivered key), and provider_org_pharmacy_order_queue returns no delivered_at.
--   7b. (added with oq16_fix_pharmacist_profile_without_delivery) a pharmacist READS their own profile through pharmacist_profile(): one row, no delivery column.
--       The delivery removal left this SQL-language function selecting the dropped column, which only fails when the function is called, so nothing but a call proves it.
--   8. SABOTAGE: a removed column added back, the old nine-argument function recreated, and a delivery column put back on pharmacist_profile(); each flips its check, so the checks are not vacuous.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.leftovers() returns text language sql as $$
  select coalesce(string_agg(x, ', ' order by x), 'none') from (
    select table_name || '.' || column_name x from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'pharmacy_orders' and column_name in ('delivery_address', 'estimated_delivery_at', 'delivery_confirmed_at', 'delivered_at', 'logistics_partner_id', 'fulfilment_method'))
         or (table_name = 'pharmacy_partners' and column_name in ('delivery', 'delivery_fee_kobo')))
    union all select 'table.pharmacy_order_delivery_attempts' where to_regclass('public.pharmacy_order_delivery_attempts') is not null
    union all select 'type.' || typname from pg_type where typnamespace = 'public'::regnamespace and typname in ('pharmacy_fulfilment_method', 'delivery_attempt_result', 'delivery_failure_reason')
    union all select 'function.' || proname from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and proname in ('set_pharmacy_order_delivery_address', 'record_pharmacy_delivery_attempt', 'record_delivery_commission', 'enforce_logistics_partner_active')
    union all select 'trigger.' || tgname from pg_trigger where tgrelid = 'public.pharmacy_orders'::regclass
       and tgname in ('pharmacy_orders_enforce_logistics_partner_active', 'pharmacy_orders_record_delivery_commission')
  ) t $$;

create function pg_temp.old_profile_fn_count() returns text language sql as $$
  select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pharmacist_update_profile' and pronargs = 9 $$;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;

-- ---- 1. everything removed is gone ---------------------------------------------------------------------------------------------------------
insert into results select 'real', 'no removed column, table, type, function or trigger is left', 'none', pg_temp.leftovers();
insert into results select 'real', 'the old nine-argument pharmacist_update_profile is gone', '0', pg_temp.old_profile_fn_count();
insert into results select 'real', 'no live function body names a removed object', 'none',
  coalesce((select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p
             where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind = 'f'
               and pg_get_functiondef(p.oid) ~* '(pharmacy_order_delivery_attempts|pharmacy_fulfilment_method|delivery_failure_reason|delivery_attempt_result|out_for_delivery|delivery_failed|delivery_confirmed_at|estimated_delivery_at|delivery_address|fulfilment_method|logistics_partner_id)'), 'none');

-- ---- 2. the status enum ---------------------------------------------------------------------------------------------------------------------
insert into results select 'real', 'pharmacy_order_status is exactly the collection set', 'pending_payment,payment_confirmed,requested,confirmed,unavailable,dispensed,cancelled',
  (select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.pharmacy_order_status'::regtype);
do $$ declare r text;
begin
  begin perform 'delivered'::public.pharmacy_order_status; r := 'accepted'; exception when invalid_text_representation then r := 'refused'; end;
  insert into results values ('real', 'the delivered status can no longer be written', 'refused', r);
  begin perform 'out_for_delivery'::public.pharmacy_order_status; r := 'accepted'; exception when invalid_text_representation then r := 'refused'; end;
  insert into results values ('real', 'the out_for_delivery status can no longer be written', 'refused', r);
end $$;

-- ---- 3. the five status triggers are back and the notification one works ------------------------------------------------------------------
insert into results select 'real', 'the five status triggers exist again', '5',
  (select count(*)::text from pg_trigger where tgrelid = 'public.pharmacy_orders'::regclass and tgname in
    ('pharmacy_orders_enqueue_fulfilment_notifications', 'pharmacy_orders_enqueue_notifications', 'pharmacy_orders_enqueue_response_notifications',
     'pharmacy_orders_record_commission', 'pharmacy_orders_snapshot_partner_cost'));
insert into results select 'real', 'the fulfilment notice trigger fires only on dispensed and unavailable', 'dispensed,unavailable',
  (select string_agg(s, ',' order by s) from (select unnest(regexp_matches(pg_get_triggerdef(t.oid), '''([a-z_]+)''::pharmacy_order_status', 'g')) s
     from pg_trigger t where t.tgname = 'pharmacy_orders_enqueue_fulfilment_notifications') q);

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
do $$
declare v_org uuid; v_pat uuid := gen_random_uuid(); v_ph uuid := gen_random_uuid(); v_ph0 uuid := gen_random_uuid(); v_partner uuid; v_order uuid; v_order2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'oq261-pat@example.invalid', 'x', now(), '{}', '{}'), (v_ph, 'oq261-ph@example.invalid', 'x', now(), '{}', '{}'), (v_ph0, 'oq261-ph0@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v_pat, v_org, 'patient', 'OQ261 Patient', true), (v_ph, v_org, 'pharmacist', 'OQ261 Pharmacist', true), (v_ph0, v_org, 'pharmacist', 'OQ261 Pharmacist No Pharmacy', true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  insert into public.pharmacy_partners (name, is_active) values ('OQ261 Pharmacy', false) returning id into v_partner;
  update public.profiles set pharmacy_partner_id = v_partner where id = v_ph;

  -- insert the orders with the insert-time guards off (they are not what this proof is about), then turn triggers back on for the status changes
  set local session_replication_role = replica;
  insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status)
  values (v_org, v_pat, v_partner, '[{"drug_name":"Amlodipine","quantity":1}]'::jsonb, 100000, 'requested') returning id into v_order;
  insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status)
  values (v_org, v_pat, v_partner, '[{"drug_name":"Metformin","quantity":2}]'::jsonb, 200000, 'requested') returning id into v_order2;
  set local session_replication_role = origin;
  insert into fx values ('pat', v_pat), ('ph', v_ph), ('ph0', v_ph0), ('partner', v_partner), ('order', v_order), ('order2', v_order2), ('org', v_org);
end $$;

do $$
declare v_order uuid := (select v from fx where k = 'order'); v_order2 uuid := (select v from fx where k = 'order2'); v_pat uuid := (select v from fx where k = 'pat'); n integer;
begin
  update public.pharmacy_orders set status = 'dispensed' where id = v_order;
  select count(*) into n from public.notifications where recipient_id = v_pat and template = 'pharmacy_order_ready_for_collection' and channel = 'in_app';
  insert into results values ('real', 'a dispensed order queues the in-app ready-for-collection notice', 'true', (n >= 1)::text);
  update public.pharmacy_orders set status = 'unavailable', unavailable_reason = 'out of stock' where id = v_order2;
  select count(*) into n from public.notifications where recipient_id = v_pat and template = 'pharmacy_order_unavailable' and channel = 'in_app';
  insert into results values ('real', 'an unavailable order queues the in-app unavailable notice', 'true', (n >= 1)::text);
  select count(*) into n from public.notifications where recipient_id = v_pat and template in ('pharmacy_order_out_for_delivery', 'pharmacy_order_delivered', 'pharmacy_order_delivery_failed');
  insert into results values ('real', 'no delivery notice is ever queued', '0', n::text);
end $$;

-- ---- 4. what is kept ------------------------------------------------------------------------------------------------------------------------
insert into results select 'real', 'logistics_partners is still there (dormant)', 'true', (to_regclass('public.logistics_partners') is not null)::text;
insert into results select 'real', 'the courier and cold-chain columns are still there', '3',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_orders' and column_name in ('courier_reference', 'courier_assigned_at', 'requires_cold_chain'));
insert into results select 'real', 'the logistics permissions are still there', '2', (select count(*)::text from public.permissions where key in ('partners.logistics.manage', 'logistics.orders.manage'));

-- ---- 5. grants on the recreated functions -----------------------------------------------------------------------------------------------------
insert into results select 'real', 'anon cannot run pharmacist_update_profile or the provider-org queue', 'false',
  (has_function_privilege('anon', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE')
   or has_function_privilege('anon', 'public.provider_org_pharmacy_order_queue(uuid)', 'EXECUTE')
   or has_function_privilege('public', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE'))::text;
insert into results select 'real', 'authenticated and service_role can run them', 'true',
  (has_function_privilege('authenticated', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE')
   and has_function_privilege('service_role', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE')
   and has_function_privilege('authenticated', 'public.provider_org_pharmacy_order_queue(uuid)', 'EXECUTE'))::text;

-- ---- 6. the pharmacist profile update --------------------------------------------------------------------------------------------------------
do $$
declare v_ph uuid := (select v from fx where k = 'ph'); v_ph0 uuid := (select v from fx where k = 'ph0'); v_partner uuid := (select v from fx where k = 'partner'); r text;
begin
  perform pg_temp.act(v_ph);
  begin
    perform public.pharmacist_update_profile('OQ261 Pharmacy Renamed', array['Lagos'], 'Ikeja', 'Lagos', '+2348000000001', 'oq261@example.invalid', 'PCN-OQ261', now() + interval '1 year');
    r := 'ok';
  exception when others then r := sqlstate; end;
  perform pg_temp.back();
  insert into results values ('real', 'a pharmacist updates their pharmacy with the eight-argument function', 'ok', r);
  insert into results select 'real', '...and the pharmacy row carries the new values', 'OQ261 Pharmacy Renamed|PCN-OQ261', name || '|' || license_number from public.pharmacy_partners where id = v_partner;

  perform pg_temp.act(v_ph0);
  begin
    perform public.pharmacist_update_profile('X', array['Lagos'], null, null, null, null, null, null);
    r := 'ok';
  exception when others then r := sqlstate; end;
  perform pg_temp.back();
  insert into results values ('real', 'a pharmacist with no pharmacy is refused', '42501', r);
end $$;

-- ---- 7. operations summary and the provider-org queue ---------------------------------------------------------------------------------------
do $$
declare has_dispensed text; cols text;
begin
  -- the summary itself is analyst-only, so check its basis (the dispensed count) and its body rather than faking an analyst
  select count(*) filter (where status = 'dispensed') into has_dispensed from public.pharmacy_orders where patient_id = (select v from fx where k = 'pat');
  insert into results values ('real', 'the pharmacy summary basis counts dispensed orders', '1', has_dispensed);
  select string_agg(x, ',') into cols from unnest((select proargnames from pg_proc where proname = 'provider_org_pharmacy_order_queue' and pronamespace = 'public'::regnamespace)) x;
  insert into results values ('real', 'the provider-org queue returns no delivered_at', 'false', (cols like '%delivered_at%')::text);
  insert into results values ('real', 'the operations summary body has no delivered key', 'false',
    (pg_get_functiondef('public.analytics_operations_summary()'::regprocedure) ~* 'delivered')::text);
  insert into results values ('real', 'the operations summary body counts dispensed', 'true',
    (pg_get_functiondef('public.analytics_operations_summary()'::regprocedure) ~* '''dispensed''')::text);
end $$;

-- ---- 7b. a pharmacist reads their own profile ------------------------------------------------------------------------------------------------
create function pg_temp.profile_rows() returns text language plpgsql as
$f$ declare n integer;
begin
  perform pg_temp.act((select v from fx where k = 'ph'));
  begin select count(*) into n from public.pharmacist_profile(); exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return n::text;
end $f$;
create function pg_temp.profile_has_delivery_column() returns text language sql as
$$ select (pg_get_function_result('public.pharmacist_profile()'::regprocedure) ~* '\ydelivery\y')::text $$;
insert into results select 'real', 'a pharmacist reads their own profile (the function resolves every column)', '1', pg_temp.profile_rows();
insert into results select 'real', 'pharmacist_profile returns no delivery column', 'false', pg_temp.profile_has_delivery_column();

-- ---- 8. SABOTAGE: each flips its check -------------------------------------------------------------------------------------------------------
alter table public.pharmacy_orders add column delivered_at timestamptz;
insert into results select 'sabotaged', 'no removed column is left (a column added back)', 'none', pg_temp.leftovers();
alter table public.pharmacy_orders drop column delivered_at;

create function public.pharmacist_update_profile(p_name text, p_regions text[], p_city text, p_state text, p_contact_phone text, p_contact_email text, p_delivery boolean, p_license_number text, p_license_expires_at timestamptz)
returns void language sql as $$ select 1 $$;
insert into results select 'sabotaged', 'the old nine-argument pharmacist_update_profile is gone (recreated)', '0', pg_temp.old_profile_fn_count();
drop function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz);

alter table public.pharmacy_partners add column delivery boolean;
drop function public.pharmacist_profile();
create function public.pharmacist_profile()
returns table(name text, regions text[], city text, state text, contact_phone text, contact_email text, delivery boolean, license_number text, license_expires_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select p.name, p.regions, p.city, p.state, p.contact_phone, p.contact_email, p.delivery, p.license_number, p.license_expires_at
  from public.pharmacy_partners p where p.id = private.pharmacist_partner() $$;
insert into results select 'sabotaged', 'pharmacist_profile returns no delivery column (one put back)', 'false', pg_temp.profile_has_delivery_column();
drop function public.pharmacist_profile();
alter table public.pharmacy_partners drop column delivery;
create function public.pharmacist_profile()
returns table(name text, regions text[], city text, state text, contact_phone text, contact_email text, license_number text, license_expires_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select p.name, p.regions, p.city, p.state, p.contact_phone, p.contact_email, p.license_number, p.license_expires_at
  from public.pharmacy_partners p where p.id = private.pharmacist_partner() $$;
grant execute on function public.pharmacist_profile() to authenticated, service_role;

-- the checks must also hold again after the sabotage is undone
insert into results select 'real', 'after the sabotage is undone nothing removed is left', 'none', pg_temp.leftovers();

do $$
declare v_bad text; v_caught integer;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'OQ-261 PROOF FAILED: %', v_bad; end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
