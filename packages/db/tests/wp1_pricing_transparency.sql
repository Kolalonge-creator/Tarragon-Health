-- WP1 proof: pricing transparency (migration *_wp1_pricing_transparency.sql). Competitor gaps B1 (not-included list with prices) and B2 (price-change notice).
-- Proves in one rolled-back transaction:
--   * catalogue_not_included: a priced extra carries the price book price, an extra with no live price, an extra that is switched off, and a words-only entry carry
--     NULL (the screen says "Ask us"); it has the same visibility as the catalogue (closed checkout, an item not on sale, anon: nothing / refused)
--   * catalog_item_extras is immutable apart from closing a row once; an extra must be a patient item of the same organisation; an item cannot list itself;
--     at most 12 open rows; the table is not reachable by a patient or anon
--   * admin_set_item_extras: admin only, needs a reason, closes removed rows (history kept), adds new ones, rejects self / duplicates / unknown items, is audited
--   * the price-change notice: ONE in-app notice for a person who paid the old price and still holds an unfinished entitlement; none for a person who holds
--     nothing, for a sponsor-covered purchase, for a new price equal to the old one or for the first price; a replay cannot write a second one (unique index);
--     a failure to write a notice never blocks the price change and is recorded in audit_log
--   * my_price_change_notices: the person sees only their own, with the old and new price in kobo; anon is refused
--   * (review fixes) the list still shows while checkout is closed; the 12-row cap counts words rows and priced rows together (extras_too_many) and both
--     the row guard and the admin function lock the item first; the payer is told as well as the holder when they differ; the price is still set when the
--     notice write AND the error-log write both fail, and the recorded failure carries the organisation
-- SABOTAGE: the unique index, the notice trigger and the immutability guard dropped, and the old unprotected error handler put back; each check must flip.
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
create function pg_temp.owner_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'wp1-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'WP1 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mk(p_uid uuid, p_code text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.create_order(%L, gen_random_uuid(), null, null, false, null)::text$q$, p_code)) $$;
create function pg_temp.pay(p_ref text, p_amount bigint) returns text language sql as
$$ select pg_temp.svc(format($q$select (public.record_order_payment(%L, %s, 150, %s, 'NGN', 'success', 'webhook', 'evt-1', now(), '{}'::jsonb))->>'result'$q$, p_ref, p_amount, p_amount + 150)) $$;
-- the number of price-change notices a person holds
create function pg_temp.notices(p_uid uuid) returns text language sql as
$$ select count(*)::text from public.notifications where recipient_id = p_uid and template = 'price_change_notice' $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_year uuid; v_extra uuid; v_noprice uuid; v_off uuid; v_inst uuid; v_ref text; v_o jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('clin', pg_temp.mkuser(v_org, 'clin', 'clinician'));
  perform pg_temp.setf('p1', pg_temp.mkuser(v_org, 'p1', 'patient'));
  perform pg_temp.setf('p2', pg_temp.mkuser(v_org, 'p2', 'patient'));
  perform pg_temp.setf('p3', pg_temp.mkuser(v_org, 'p3', 'patient'));
  -- main-dev's two-tier rule allows only the Membership to be active in the real catalog; this proof uses ordinary items, so it is lifted here only
  alter table public.catalog_items drop constraint if exists catalog_items_only_membership_sellable;
  -- a yearly item at 84,000 naira
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
  values (v_org, 'wp1_year', 'care_pack', 'catalog.proof.name', 'catalog.proof.description', 365, false, true) returning id into v_year;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, reason) values (v_org, v_year, 8400000, 'proof');
  -- extras: one on sale with a price, one on sale with no price, one switched off with a price
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'wp1_extra', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_extra;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, reason) values (v_org, v_extra, 1500000, 'proof');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'wp1_noprice', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_noprice;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 'wp1_off', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, false) returning id into v_off;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, reason) values (v_org, v_off, 700000, 'proof');
  perform pg_temp.setf('year', v_year); perform pg_temp.setf('extra', v_extra); perform pg_temp.setf('noprice', v_noprice); perform pg_temp.setf('off', v_off);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'WP1 proof run' where key = 'v5_checkout';
  -- p1 buys the yearly item at 84,000 naira (an entitlement that ends in a year)
  v_o := pg_temp.mk(pg_temp.f('p1'), 'wp1_year')::jsonb;
  v_ref := v_o ->> 'reference';
  perform pg_temp.pay(v_ref, 8400000);
  -- p3 holds a second yearly entitlement that a different person (the payer, as a Care Circle supporter would) bought for them
  v_o := pg_temp.mk(pg_temp.f('p3'), 'wp1_year')::jsonb;
  perform pg_temp.pay(v_o ->> 'reference', 8400000);
  perform pg_temp.setf('payer', pg_temp.mkuser(v_org, 'payer', 'patient'));
  alter table public.orders disable trigger orders_state_machine;
  update public.orders set buyer_profile_id = pg_temp.f('payer') where id = (v_o ->> 'order_id')::uuid;
  alter table public.orders enable trigger orders_state_machine;
end $$;

-- 1. The not-included list: prices come from the price book, never invented ----------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_year uuid := pg_temp.f('year'); v_p2 uuid := pg_temp.f('p2'); r jsonb;
begin
  perform pg_temp.ck('the buyer holds an unfinished entitlement (fixture)', '1',
    (select count(*)::text from public.entitlements where patient_id = pg_temp.f('p1') and state = 'active' and ends_at > now()));
  insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id, sort_order, valid_from) values (v_org, v_year, pg_temp.f('extra'), 1, now() - interval '1 day');
  insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id, sort_order, valid_from) values (v_org, v_year, pg_temp.f('noprice'), 2, now() - interval '1 day');
  insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id, sort_order, valid_from) values (v_org, v_year, pg_temp.f('off'), 3, now() - interval '1 day');
  insert into public.catalog_item_extras (organisation_id, catalog_item_id, label_key, sort_order, valid_from) values (v_org, v_year, 'catalog.notincl.medicines', 0, now() - interval '1 day');
  r := pg_temp.q_as(v_p2, $q$select public.catalogue_not_included('wp1_year')::text$q$)::jsonb;
  perform pg_temp.ck('one item comes back for the code asked for', '1', jsonb_array_length(r)::text);
  perform pg_temp.ck('the words-only entry is first and has no price', 'catalog.notincl.medicines|', (r -> 0 -> 'items' -> 0 ->> 'label_key') || '|' || coalesce(r -> 0 -> 'items' -> 0 ->> 'amount_kobo', ''));
  perform pg_temp.ck('the priced extra carries the price book price', '1500000', r -> 0 -> 'items' -> 1 ->> 'amount_kobo');
  perform pg_temp.ck('an extra on sale with no price is null (Ask us)', 'null', coalesce(r -> 0 -> 'items' -> 2 ->> 'amount_kobo', 'null'));
  perform pg_temp.ck('an extra that is switched off shows no price even though a price row exists', 'null', coalesce(r -> 0 -> 'items' -> 3 ->> 'amount_kobo', 'null'));
  perform pg_temp.ck('an extra''s code is given so the screen can link it', 'wp1_extra', r -> 0 -> 'items' -> 1 ->> 'extra_code');
  perform pg_temp.ck('asking with no code returns every item that is on sale and has a list', 'true',
    (pg_temp.q_as(v_p2, $q$select (jsonb_array_length(public.catalogue_not_included()) >= 1)::text$q$)));
  perform pg_temp.ck('an item that is not on sale shows nothing', '0',
    (select case when pg_temp.owner_sql($q$update public.catalog_items set active = false where code = 'wp1_year'$q$) = 'ok'
                 then pg_temp.q_as(v_p2, $q$select jsonb_array_length(public.catalogue_not_included('wp1_year'))::text$q$) end));
  perform pg_temp.owner_sql($q$update public.catalog_items set active = true where code = 'wp1_year'$q$);
  -- information does not depend on the buying switch: the list is still there while checkout is closed
  perform pg_temp.ck('closed checkout still shows the list', '1',
    (select case when pg_temp.owner_sql($q$update public.platform_modules set is_enabled = false where key = 'v5_checkout'$q$) = 'ok'
                 then pg_temp.q_as(v_p2, $q$select jsonb_array_length(public.catalogue_not_included('wp1_year'))::text$q$) end));
  perform pg_temp.owner_sql($q$update public.platform_modules set is_enabled = true where key = 'v5_checkout'$q$);
  perform pg_temp.ck('anon cannot read the list', '42501', pg_temp.try_anon($q$select public.catalogue_not_included('wp1_year')$q$));
  perform pg_temp.ck('a patient cannot read the table directly', 'true', (pg_temp.q_as(v_p2, 'select count(*)::text from public.catalog_item_extras') like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('anon cannot read the table directly', '42501', pg_temp.try_anon('select * from public.catalog_item_extras'));
end $$;

-- 2. The table is immutable, and an extra must be a sensible one -------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_year uuid := pg_temp.f('year'); v_id uuid; v_inst uuid; i integer;
begin
  select id into v_id from public.catalog_item_extras where catalog_item_id = v_year and label_key = 'catalog.notincl.medicines';
  perform pg_temp.ck('a label cannot be rewritten', 'true', (pg_temp.owner_sql(format($q$update public.catalog_item_extras set label_key = 'catalog.notincl.other' where id = %L$q$, v_id)) like '%extras_immutable%')::text);
  perform pg_temp.ck('a row cannot be deleted', 'true', (pg_temp.owner_sql(format($q$delete from public.catalog_item_extras where id = %L$q$, v_id)) like '%extras_immutable%')::text);
  perform pg_temp.ck('an item cannot list itself', 'true',
    (pg_temp.owner_sql(format($q$insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id) values (%L, %L, %L)$q$, v_org, v_year, v_year)) like '%catalog_item_extras_check%')::text);
  perform pg_temp.ck('a row must be a catalogue item or words, not both and not neither', 'true',
    (pg_temp.owner_sql(format($q$insert into public.catalog_item_extras (organisation_id, catalog_item_id) values (%L, %L)$q$, v_org, v_year)) like '%violates check constraint%')::text);
  perform pg_temp.ck('a bad label key is refused', 'true',
    (pg_temp.owner_sql(format($q$insert into public.catalog_item_extras (organisation_id, catalog_item_id, label_key) values (%L, %L, 'Has Spaces')$q$, v_org, v_year)) like '%violates check constraint%')::text);
  select id into v_inst from public.catalog_items where audience = 'institution' and organisation_id = v_org limit 1;
  perform pg_temp.ck('an institutional item cannot be listed as an extra', 'true',
    (pg_temp.owner_sql(format($q$insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id) values (%L, %L, %L)$q$, v_org, v_year, v_inst)) like '%extras_item_invalid%')::text);
  perform pg_temp.ck('the same extra cannot be open twice on one item', 'true',
    (pg_temp.owner_sql(format($q$insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id) values (%L, %L, %L)$q$, v_org, v_year, pg_temp.f('extra'))) like '%catalog_item_extras_one_item%')::text);
  -- twelve open rows is the most: 4 are open now, add 8 more words, the thirteenth is refused
  for i in 1..8 loop
    insert into public.catalog_item_extras (organisation_id, catalog_item_id, label_key) values (v_org, v_year, 'catalog.notincl.proof' || i);
  end loop;
  perform pg_temp.ck('a thirteenth open row is refused', 'true',
    (pg_temp.owner_sql(format($q$insert into public.catalog_item_extras (organisation_id, catalog_item_id, label_key) values (%L, %L, 'catalog.notincl.proof9')$q$, v_org, v_year)) like '%extras_too_many%')::text);
  -- closing a row once is allowed and only once
  perform pg_temp.ck('a row can be closed', 'ok', pg_temp.owner_sql(format($q$update public.catalog_item_extras set valid_to = now() + interval '1 second' where label_key = 'catalog.notincl.proof8' and catalog_item_id = %L$q$, v_year)));
  perform pg_temp.ck('a closed row cannot be changed again', 'true',
    (pg_temp.owner_sql(format($q$update public.catalog_item_extras set valid_to = now() + interval '2 seconds' where label_key = 'catalog.notincl.proof8' and catalog_item_id = %L$q$, v_year)) like '%extras_immutable%')::text);
  -- tidy: close the filler words so later steps start from the same list
  perform pg_temp.owner_sql(format($q$update public.catalog_item_extras set valid_to = now() + interval '1 second' where label_key like 'catalog.notincl.proof%%' and valid_to is null and catalog_item_id = %L$q$, v_year));
end $$;

-- 3. The admin function --------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_p1 uuid := pg_temp.f('p1'); v_year uuid := pg_temp.f('year');
begin
  perform pg_temp.ck('a patient cannot set extras', 'true', (pg_temp.try_as(v_p1, $q$select public.admin_set_item_extras('wp1_year', '{wp1_extra}', 'A proper reason here')$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('a clinician cannot set extras', 'true', (pg_temp.try_as(pg_temp.f('clin'), $q$select public.admin_set_item_extras('wp1_year', '{wp1_extra}', 'A proper reason here')$q$) like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('anon cannot set extras', '42501', pg_temp.try_anon($q$select public.admin_set_item_extras('wp1_year', '{wp1_extra}', 'A proper reason here')$q$));
  perform pg_temp.ck('a patient cannot read the admin view', 'true', (pg_temp.try_as(v_p1, 'select public.admin_item_extras()') like '%catalogue_not_authorised%')::text);
  perform pg_temp.ck('a short reason is refused', 'true', (pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_year', '{wp1_extra}', 'short')$q$) like '%catalogue_reason_needed%')::text);
  perform pg_temp.ck('an item cannot list itself', 'true', (pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_year', '{wp1_year}', 'A proper reason here')$q$) like '%extras_invalid%')::text);
  perform pg_temp.ck('a repeated code is refused', 'true', (pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_year', '{wp1_extra,wp1_extra}', 'A proper reason here')$q$) like '%extras_invalid%')::text);
  perform pg_temp.ck('an unknown extra is refused', 'true', (pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_year', '{no_such_item}', 'A proper reason here')$q$) like '%extras_invalid%')::text);
  perform pg_temp.ck('an unknown item is refused', 'true', (pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('no_such_item', '{wp1_extra}', 'A proper reason here')$q$) like '%unknown_item%')::text);
  -- keep only wp1_noprice: wp1_extra and wp1_off are closed (history kept), the words-only row is untouched
  perform pg_temp.ck('the admin sets the list', 'ok', pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_year', '{wp1_noprice}', 'Founder reviewed the list')$q$));
  perform pg_temp.ck('only the wanted priced extra is open', 'wp1_noprice',
    (select string_agg(x.code, ',') from public.catalog_item_extras r join public.catalog_items x on x.id = r.extra_item_id where r.catalog_item_id = v_year and r.valid_to is null));
  perform pg_temp.ck('the removed extras are closed, not deleted', '2',
    (select count(*)::text from public.catalog_item_extras r join public.catalog_items x on x.id = r.extra_item_id where r.catalog_item_id = v_year and r.valid_to is not null and x.code in ('wp1_extra', 'wp1_off')));
  perform pg_temp.ck('the words-only row is left alone', '1', (select count(*)::text from public.catalog_item_extras where catalog_item_id = v_year and label_key = 'catalog.notincl.medicines' and valid_to is null));
  perform pg_temp.ck('the change is audited with the reason', '1', (select count(*)::text from public.audit_log where action = 'catalogue.extras_set' and actor_id = v_admin and event ->> 'reason' = 'Founder reviewed the list'));
  perform pg_temp.ck('the admin view lists the open extras and the words', 'wp1_noprice|catalog.notincl.medicines',
    (select (e -> 'extra_codes' ->> 0) || '|' || (e -> 'label_keys' ->> 0) from jsonb_array_elements(pg_temp.q_as(v_admin, 'select public.admin_item_extras()::text')::jsonb) e where e ->> 'code' = 'wp1_year'));
  perform pg_temp.ck('setting the same list again changes nothing and adds no row', '2', (select case when pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_year', '{wp1_noprice}', 'Founder reviewed the list')$q$) = 'ok'
    then (select count(*)::text from public.catalog_item_extras where catalog_item_id = v_year and valid_to is null) end));
end $$;

-- 3b. The cap counts the words rows too, and the trigger takes a lock so two admins cannot both pass the count
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_cap uuid; i integer;
begin
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
  values (v_org, 'wp1_cap', 'care_pack', 'catalog.proof.name', 'catalog.proof.description', 30, false, true) returning id into v_cap;
  for i in 1..11 loop
    insert into public.catalog_item_extras (organisation_id, catalog_item_id, label_key, valid_from) values (v_org, v_cap, 'catalog.notincl.cap' || i, now() - interval '1 day');
  end loop;
  perform pg_temp.ck('eleven words rows plus two priced extras is over the cap and is refused with a clear code', 'true',
    (pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_cap', '{wp1_extra,wp1_noprice}', 'A proper reason here')$q$) like '%extras_too_many%')::text);
  perform pg_temp.ck('nothing was changed by the refused call', '11', (select count(*)::text from public.catalog_item_extras where catalog_item_id = v_cap and valid_to is null));
  perform pg_temp.ck('eleven words rows plus one priced extra is exactly twelve and is allowed', 'ok',
    pg_temp.try_as(v_admin, $q$select public.admin_set_item_extras('wp1_cap', '{wp1_extra}', 'A proper reason here')$q$));
  perform pg_temp.ck('and the twelve are open', '12', (select count(*)::text from public.catalog_item_extras where catalog_item_id = v_cap and valid_to is null));
  perform pg_temp.ck('the row guard locks the item before it counts', 'true', (pg_get_functiondef('private.catalog_item_extras_guard()'::regprocedure) ilike '%for update%')::text);
  perform pg_temp.ck('the admin function locks the item before it counts', 'true', (pg_get_functiondef('public.admin_set_item_extras(text,text[],text)'::regprocedure) ilike '%for update%')::text);
end $$;

-- 4. The price-change notice -----------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_p1 uuid := pg_temp.f('p1'); v_p2 uuid := pg_temp.f('p2'); v_new uuid; r jsonb; v_n text;
begin
  perform pg_temp.ck('nobody has a notice before the price changes', '0', pg_temp.notices(v_p1));
  -- a new price of 129,000 naira starting a second from now (a scheduled change)
  perform pg_temp.ck('the admin sets a new price', 'ok',
    pg_temp.try_as(v_admin, $q$select public.set_item_price('wp1_year', 12900000, '{}', 'Founder confirmed the new price', now() + interval '1 second')$q$));
  select id into v_new from public.prices where catalog_item_id = pg_temp.f('year') and amount_kobo = 12900000;
  perform pg_temp.setf('newprice', v_new);
  perform pg_temp.ck('the person who paid the old price and still holds it gets exactly one notice', '1', pg_temp.notices(v_p1));
  perform pg_temp.ck('a person who holds nothing gets none', '0', pg_temp.notices(v_p2));
  perform pg_temp.ck('the holder of a purchase made by someone else gets one notice', '1', pg_temp.notices(pg_temp.f('p3')));
  perform pg_temp.ck('the person who paid for it gets one notice too', '1', pg_temp.notices(pg_temp.f('payer')));
  perform pg_temp.ck('the payer can read the details', '1', (pg_temp.q_as(pg_temp.f('payer'), 'select jsonb_array_length(public.my_price_change_notices())::text')));
  perform pg_temp.ck('the notice is in-app, non-clinical, and names the price and item only', 'in_app|non_clinical|membership-free',
    (select channel::text || '|' || content_class::text || '|' || case when payload ?& array['price_id', 'item_code'] and (select count(*) from jsonb_object_keys(payload)) = 2 then 'membership-free' else 'unexpected' end
       from public.notifications where recipient_id = v_p1 and template = 'price_change_notice'));
  perform pg_temp.ck('the notice template is registered with neutral words', '1',
    (select count(*)::text from public.notification_template_locales where template_key = 'price_change_notice' and locale = 'en' and channel = 'in_app' and body !~* '(warning|urgent|act now|hurry|last chance)'));
  -- a replay cannot write a second notice for the same price
  perform pg_temp.ck('a second notice for the same price is refused by the database', 'true',
    (pg_temp.owner_sql(format($q$insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
       values (%L, %L, 'in_app', 'pending', 'price_change_notice', jsonb_build_object('price_id', %L, 'item_code', 'wp1_year'), 'non_clinical')$q$, pg_temp.f('org'), v_p1, v_new)) like '%notifications_price_change_once%')::text);
  perform pg_temp.ck('and the same insert with on conflict do nothing writes nothing', '1', pg_temp.notices(v_p1));
  -- the details behind the notice
  r := pg_temp.q_as(v_p1, 'select public.my_price_change_notices()::text')::jsonb;
  perform pg_temp.ck('the person sees one notice', '1', jsonb_array_length(r)::text);
  perform pg_temp.ck('with the old and the new price in whole kobo', '8400000|12900000', (r -> 0 ->> 'paid_list_kobo') || '|' || (r -> 0 ->> 'new_kobo'));
  perform pg_temp.ck('and when what they hold ends', 'true', (select ((r -> 0 ->> 'ends_at')::timestamptz > now() + interval '300 days')::text));
  perform pg_temp.ck('another person sees none of it', '[]', pg_temp.q_as(v_p2, 'select public.my_price_change_notices()::text'));
  perform pg_temp.ck('anon cannot read notices', '42501', pg_temp.try_anon('select public.my_price_change_notices()'));
  -- a price that does not change the amount tells nobody
  perform pg_temp.ck('a new price row with the same amount sends no notice', '1',
    (select case when pg_temp.try_as(v_admin, $q$select public.set_item_price('wp1_year', 12900000, '{}', 'Same amount again, only the date', now() + interval '2 seconds')$q$) = 'ok'
                 then pg_temp.notices(v_p1) end));
  -- once the person has bought at the new price, nothing is shown to them
  perform pg_temp.ck('the first price of a new item tells nobody', '0',
    (select case when pg_temp.owner_sql(format($q$insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active) values (%L, 'wp1_first', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true)$q$, pg_temp.f('org'))) = 'ok'
                 and pg_temp.owner_sql(format($q$insert into public.prices (organisation_id, catalog_item_id, amount_kobo) select %L, id, 100000 from public.catalog_items where code = 'wp1_first'$q$, pg_temp.f('org'))) = 'ok'
                 then (select count(*)::text from public.notifications where template = 'price_change_notice' and payload ->> 'item_code' = 'wp1_first') end));
  -- a sponsor-covered purchase did not pay the list price, so it is not told about it (the arithmetic check is lifted here only, to give the order a share)
  perform pg_temp.ck('fixture: the arithmetic check is lifted for this proof', 'ok', pg_temp.owner_sql('alter table public.orders drop constraint orders_pricing_adds_up'));
  perform pg_temp.owner_sql('alter table public.orders disable trigger orders_state_machine');
  perform pg_temp.ck('fixture: the order is given a sponsor share', 'ok', pg_temp.owner_sql(format($q$update public.orders set sponsor_share_kobo = 100 where buyer_profile_id = %L$q$, v_p1)));
  perform pg_temp.ck('a sponsor-covered purchase sees no notice details', '[]', pg_temp.q_as(v_p1, 'select public.my_price_change_notices()::text'));
  perform pg_temp.ck('a purchase with a sponsor share is not told about a later list price', '1',
    (select case when pg_temp.try_as(v_admin, $q$select public.set_item_price('wp1_year', 13000000, '{}', 'A change that a sponsored purchase should not hear about', now() + interval '2500 milliseconds')$q$) = 'ok'
                 then pg_temp.notices(v_p1) end));
  perform pg_temp.owner_sql(format($q$update public.orders set sponsor_share_kobo = 0 where buyer_profile_id = %L$q$, v_p1));
  perform pg_temp.owner_sql('alter table public.orders enable trigger orders_state_machine');
end $$;

-- 5. A notice that cannot be written never blocks the price ----------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_before integer; v_r text;
begin
  create function pg_temp.refuse_notice() returns trigger language plpgsql as $f$ begin raise exception 'notice_write_blocked'; end $f$;
  create trigger wp1_refuse_notice before insert on public.notifications for each row when (new.template = 'price_change_notice') execute function pg_temp.refuse_notice();
  select count(*) into v_before from public.audit_log where action = 'price_change_notice.error';
  v_r := pg_temp.try_as(v_admin, $q$select public.set_item_price('wp1_year', 13500000, '{}', 'A further change for the failure test', now() + interval '3 seconds')$q$);
  perform pg_temp.ck('the price is set even though its notice could not be written', 'ok', v_r);
  perform pg_temp.ck('the new price exists', '1', (select count(*)::text from public.prices where catalog_item_id = pg_temp.f('year') and amount_kobo = 13500000));
  perform pg_temp.ck('the failure is recorded, not hidden', (v_before + 1)::text, (select count(*)::text from public.audit_log where action = 'price_change_notice.error'));
  -- the error log itself failing must not block the price either
  create function pg_temp.refuse_audit() returns trigger language plpgsql as $f$ begin raise exception 'audit_write_blocked'; end $f$;
  create trigger wp1_refuse_audit before insert on public.audit_log for each row when (new.action = 'price_change_notice.error') execute function pg_temp.refuse_audit();
  v_r := pg_temp.try_as(v_admin, $q$select public.set_item_price('wp1_year', 14200000, '{}', 'A change while both writes fail', now() + interval '3500 milliseconds')$q$);
  perform pg_temp.ck('the price is set even when the failure log cannot be written either', 'ok', v_r);
  perform pg_temp.ck('and that price exists', '1', (select count(*)::text from public.prices where catalog_item_id = pg_temp.f('year') and amount_kobo = 14200000));
  drop trigger wp1_refuse_audit on public.audit_log;
  perform pg_temp.ck('the recorded failure carries the organisation', pg_temp.f('org')::text,
    (select organisation_id::text from public.audit_log where action = 'price_change_notice.error' order by created_at desc limit 1));
  drop trigger wp1_refuse_notice on public.notifications;
end $$;

-- 6. Grants -------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('no new function is executable by anon', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('catalogue_not_included', 'admin_item_extras', 'admin_set_item_extras', 'my_price_change_notices') and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.ck('the notice trigger function is not callable by a patient', 'false', has_function_privilege('authenticated', 'private.notify_price_change()', 'EXECUTE')::text);
  perform pg_temp.ck('RLS is on for the table', 'true', (select relrowsecurity::text from pg_class where oid = 'public.catalog_item_extras'::regclass));
end $$;

-- 7. SABOTAGE: three protections removed; each check must flip -------------------------------------------------------------------------------
-- (d) the old handler: its error log has no organisation and no protection of its own, so a failing log aborts the price
create or replace function private.notify_price_change() returns trigger language plpgsql security definer set search_path = '' as $f$
declare prev public.prices%rowtype;
begin
  select * into prev from public.prices where catalog_item_id = new.catalog_item_id and valid_to = new.valid_from limit 1;
  if not found or prev.amount_kobo = new.amount_kobo then return new; end if;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select e.organisation_id, e.patient_id, 'in_app', 'pending', 'price_change_notice', jsonb_build_object('price_id', new.id, 'item_code', 'x'), 'non_clinical'
      from public.entitlements e join public.orders o on o.id = e.order_id where o.catalog_item_id = new.catalog_item_id and e.state = 'active';
  exception when others then
    insert into public.audit_log (action, entity_type, entity_id, event) values ('price_change_notice.error', 'price', new.id, '{}');
  end;
  return new;
end $f$;
create function pg_temp.refuse_any() returns trigger language plpgsql as $f$ begin raise exception 'write_blocked'; end $f$;
create trigger wp1_sab_notice before insert on public.notifications for each row when (new.template = 'price_change_notice') execute function pg_temp.refuse_any();
create trigger wp1_sab_audit before insert on public.audit_log for each row when (new.action = 'price_change_notice.error') execute function pg_temp.refuse_any();
do $$
begin
  insert into results values ('sabotaged', 'the price is set even when the failure log cannot be written either', 'ok',
    pg_temp.try_as(pg_temp.f('admin'), $q$select public.set_item_price('wp1_year', 14400000, '{}', 'Sabotage: the old handler', now() + interval '3600 milliseconds')$q$));
end $$;
drop trigger wp1_sab_notice on public.notifications;
drop trigger wp1_sab_audit on public.audit_log;
drop index public.notifications_price_change_once;
drop trigger prices_notify_change on public.prices;
drop trigger catalog_item_extras_guard on public.catalog_item_extras;

do $$
declare v_p1 uuid := pg_temp.f('p1'); v_before text; v_id uuid;
begin
  -- (a) with the unique index gone a duplicate notice is accepted
  insert into results values ('sabotaged', 'a second notice for the same price is refused by the database', 'refused',
    case when pg_temp.owner_sql(format($q$insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
       values (%L, %L, 'in_app', 'pending', 'price_change_notice', jsonb_build_object('price_id', %L, 'item_code', 'wp1_year'), 'non_clinical')$q$, pg_temp.f('org'), v_p1, pg_temp.f('newprice'))) like '%price_change_once%' then 'refused' else 'accepted' end);
  -- (b) with the trigger gone a price change tells nobody new
  v_before := pg_temp.notices(pg_temp.f('p1'));
  perform pg_temp.try_as(pg_temp.f('admin'), $q$select public.set_item_price('wp1_year', 14000000, '{}', 'Sabotage price for the proof', now() + interval '4 seconds')$q$);
  insert into results values ('sabotaged', 'a price change writes a notice', 'written', case when pg_temp.notices(pg_temp.f('p1'))::int > v_before::int then 'written' else 'none' end);
  -- (c) with the guard gone a label can be rewritten
  select id into v_id from public.catalog_item_extras where catalog_item_id = pg_temp.f('year') and label_key = 'catalog.notincl.medicines';
  insert into results values ('sabotaged', 'a label cannot be rewritten', 'refused',
    case when pg_temp.owner_sql(format($q$update public.catalog_item_extras set label_key = 'catalog.notincl.other' where id = %L$q$, v_id)) like '%extras_immutable%' then 'refused' else 'accepted' end);
end $$;

do $$
declare v_bad integer; v_caught integer; v_real integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'WP1 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_real from results where phase = 'real';
  if v_real < 60 then raise exception 'VACUOUS TEST: only % checks ran', v_real; end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
