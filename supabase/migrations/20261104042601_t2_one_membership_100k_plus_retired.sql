-- Tarragon Health 2.0, Phase 4 (decisions T2-01, T2-02, T2-05, T2-09; founder 2026-11-04): one annual Membership at 100,000 naira,
-- Membership Plus retired, Tarragon-run public testing days closed, employer seats at 90,000 naira granting the Membership. Live on
-- apply (T2-09: "build and go live").
--
-- Counted live before writing (2026-11-04): patient_memberships 2 rows, both test accounts (1 plus, 1 evergreen); employer benefit
-- packages 0; seat pilots 0; open or scheduled testing events 0; organisation member prices: one default row (12,900,000, Plus item).
-- So no real member is moved, re-priced or refunded, and no booking is cancelled. Existing Plus years keep their benefits to their end
-- date (nothing here touches patient_memberships rows).
--
-- 1. Membership (membership_annual_no_panel) is re-priced to 10,000,000 kobo: the open price row is closed and a new one opens at the
--    same instant (prices are versioned, never edited; the prices_immutable trigger allows only this).
-- 2. Membership Plus (membership_annual) and the Plus upgrade (membership_upgrade_plus) stop being sold: catalog_items.active = false.
--    The public catalogue, private.price_quote_calc and public.create_order then refuse them (item_not_available). Their price rows
--    stay as history. The tier module membership_two_member_tiers is deliberately left ON: turning it off makes create_order refuse
--    membership_annual_no_panel and fall back to selling Plus only.
-- 3. Testing days: public.create_testing_event refuses a new public_day. Existing confirmed bookings (none today) are still checked in
--    (check_in_testing_booking is unchanged); employer_visit events are unaffected.
-- 4. Employer seats: the organisation price limits move to the Membership item (version 2: floor 50,000, ceiling 200,000, default
--    90,000); the default organisation member price becomes 9,000,000 kobo on the Membership item; the three seat-price functions that
--    named membership_annual now name membership_annual_no_panel (and the admin's organisation price list reads that item too), so
--    private.grant_org_seat grants the Membership (evergreen) tier.
-- 5. public.my_membership_offer offers the Membership, not the retired Plus item.
-- 6. patient_memberships.tier defaults to 'evergreen' (it defaulted to 'plus' for grandfathering; an admin grant now gives the
--    Membership unless the admin chooses otherwise).
-- The lab panel code 'membership_annual' (lab_panel_versions, lab_orders.panel_code) is a separate identifier and is unchanged.

create function pg_temp.t2p4_patch_fn(p_sig regprocedure, p_pairs text[], p_counts integer[] default null) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer; want integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    want := coalesce(p_counts[(i + 1) / 2], 1);
    if n <> want then raise exception 't2 phase 4 patch of % expected % match(es) for [%], found %', p_sig, want, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

-- 1 and 2. the one Membership at 100,000 naira; Plus and the upgrade no longer sold
do $$
declare
  v_now timestamptz := now();
  it public.catalog_items%rowtype;
  v_old public.prices%rowtype;
begin
  select * into it from public.catalog_items where code = 'membership_annual_no_panel';
  if it.id is null then raise exception 'FAIL: membership_annual_no_panel not found'; end if;
  select * into v_old from public.prices
   where catalog_item_id = it.id and valid_from <= v_now and (valid_to is null or valid_to > v_now)
   order by valid_from desc limit 1;
  if v_old.id is not null then
    update public.prices set valid_to = v_now where id = v_old.id;
  end if;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, valid_from, reason)
  values (it.organisation_id, it.id, 10000000, '{}'::jsonb, v_now,
          'Founder decision T2-01/T2-09 (2026-11-04): one annual Membership at 100,000 naira; Membership Plus retired.');

  update public.catalog_items set active = true, updated_at = v_now where code = 'membership_annual_no_panel';
  update public.catalog_items set active = false, updated_at = v_now where code in ('membership_annual', 'membership_upgrade_plus');
end $$;

-- 3. no new Tarragon-run public testing day
select pg_temp.t2p4_patch_fn('public.create_testing_event(text,date,time without time zone,time without time zone,text,text,text,text,text,integer,uuid,text,uuid,integer)'::regprocedure, array[
  '  if p_kind = ''public_day'' and p_event_date < private.lagos_today() then',
  '  -- T2-02 (2026-11-04): Tarragon no longer runs public testing days; members test at any laboratory and upload the result.
  -- The one exception is a direct database session that asks for it (session_user postgres or supabase_admin and the transaction
  -- setting tarragon.allow_legacy_public_testing_day = on): the proofs that test how existing bookings are honoured still create one.
  -- An API request always runs as the authenticator session, so no app user can reach it.
  if p_kind = ''public_day''
     and not (session_user in (''postgres'', ''supabase_admin'')
              and coalesce(nullif(current_setting(''tarragon.allow_legacy_public_testing_day'', true), ''''), ''off'') = ''on'') then
    raise exception ''testing_public_days_closed'' using errcode = ''22023'';
  end if;
  if p_kind = ''public_day'' and p_event_date < private.lagos_today() then']);

-- 4. employer seats on the Membership item at 90,000 naira
do $$
declare
  v_now timestamptz := now();
  it public.catalog_items%rowtype;
begin
  select * into it from public.catalog_items where code = 'membership_annual_no_panel';
  update public.organisation_price_limits set is_active = false where is_active;
  insert into public.organisation_price_limits (version, rules, is_active, effective_from)
  values (2,
-- organisation-price-limits-begin
$json${"item_code":"membership_annual_no_panel","min_kobo":5000000,"max_kobo":20000000,"default_kobo":9000000}$json$::jsonb,
-- organisation-price-limits-end
          true, current_date);

  update public.organisation_member_prices set valid_to = v_now
   where employer_organisation_id is null and (valid_to is null or valid_to > v_now);
  insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
  values (it.organisation_id, null, it.id, 9000000, v_now,
          'Founder decision T2-05/T2-09 (2026-11-04): an employer seat is the Membership at 90,000 naira per person per year (10% below 100,000).');
end $$;

select pg_temp.t2p4_patch_fn('private.set_organisation_member_price_core(uuid,bigint,text,timestamp with time zone)'::regprocedure, array[
  'code = ''membership_annual'' for update;', 'code = ''membership_annual_no_panel'' for update;']);
select pg_temp.t2p4_patch_fn('public.clear_organisation_member_price(uuid,text,timestamp with time zone)'::regprocedure, array[
  'and code = ''membership_annual'';', 'and code = ''membership_annual_no_panel'';']);
select pg_temp.t2p4_patch_fn('public.organisation_seat_summary(uuid)'::regprocedure, array[
  'where code = ''membership_annual'' order by created_at limit 1;', 'where code = ''membership_annual_no_panel'' order by created_at limit 1;']);

select pg_temp.t2p4_patch_fn('public.admin_organisation_prices()'::regprocedure, array[
  'and code = ''membership_annual'';', 'and code = ''membership_annual_no_panel'';']);

-- 5. the above-target offer sells the Membership
select pg_temp.t2p4_patch_fn('public.my_membership_offer()'::regprocedure, array[
  'ci.code = ''membership_annual'' and ci.active', 'ci.code = ''membership_annual_no_panel'' and ci.active',
  '''catalog_item'', ''membership_annual'',', '''catalog_item'', ''membership_annual_no_panel'',']);

-- 6. a membership granted without a tier is the Membership
alter table public.patient_memberships alter column tier set default 'evergreen';

do $$
declare
  v_now timestamptz := now();
begin
  if (private.current_price((select id from public.catalog_items where code = 'membership_annual_no_panel'))).amount_kobo is distinct from 10000000 then
    raise exception 'FAIL: the Membership is not 100,000 naira';
  end if;
  if exists (select 1 from public.catalog_items where code in ('membership_annual', 'membership_upgrade_plus') and active) then
    raise exception 'FAIL: Membership Plus or the upgrade is still sold';
  end if;
  if (select count(*) from public.organisation_price_limits where is_active) <> 1
     or (select rules ->> 'item_code' from public.organisation_price_limits where is_active) <> 'membership_annual_no_panel' then
    raise exception 'FAIL: the organisation price limits are not on the Membership item';
  end if;
  if not exists (select 1 from public.organisation_member_prices omp join public.catalog_items c on c.id = omp.catalog_item_id
                  where omp.employer_organisation_id is null and c.code = 'membership_annual_no_panel' and omp.amount_kobo = 9000000
                    and omp.valid_from <= v_now and (omp.valid_to is null or omp.valid_to > v_now)) then
    raise exception 'FAIL: the default employer seat is not the Membership at 90,000 naira';
  end if;
  if position('membership_annual''' in pg_get_functiondef('private.set_organisation_member_price_core(uuid,bigint,text,timestamp with time zone)'::regprocedure)) > 0 then
    raise exception 'FAIL: the seat price core still names the Plus item';
  end if;
  if position('membership_annual''' in pg_get_functiondef('public.admin_organisation_prices()'::regprocedure)) > 0 then
    raise exception 'FAIL: the admin organisation price list still reads the Plus item';
  end if;
  if position('testing_public_days_closed' in pg_get_functiondef('public.create_testing_event(text,date,time without time zone,time without time zone,text,text,text,text,text,integer,uuid,text,uuid,integer)'::regprocedure)) = 0 then
    raise exception 'FAIL: new public testing days are not refused';
  end if;
  raise notice 'PASS: t2 one Membership at 100,000 naira, Plus retired';
end $$;
