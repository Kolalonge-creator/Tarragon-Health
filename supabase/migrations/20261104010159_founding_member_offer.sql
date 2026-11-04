-- Founding member offer (founder decision 2026-11-04).
--
-- Terms: 10% off the first year of Membership (membership_annual_no_panel) and Membership Plus (membership_annual), 100 places in all,
-- open until the places run out, one use per person, gifts count (the buyer applies the code), and a "Founding member" badge in the app.
-- The terms themselves live on ONE ordinary Membership discount code that an admin creates from /admin/discount-codes with the new
-- badge option; this migration adds only what a code could not already express:
--
--   1. discount_codes.badge (null, or 'founding_member'). Part of what a code gives, so the immutability guard now covers it too.
--      At most one ACTIVE founding code per test flag (partial unique index), so "the founding offer" is never ambiguous.
--   2. admin_create_discount_code gains a trailing p_badge text default null. The 12-argument function is DROPPED and the 13-argument
--      one created in its place, so no overload exists and every existing 12-argument call (the admin action, the S73 proof) still
--      resolves to exactly one function (the CLAUDE.md lesson on overloads and untyped literals).
--      A founding code must be limited to exactly the two Membership items (membership_annual_no_panel, membership_annual): never the
--      upgrade, never anything else, so the public wording stays true.
--   3. public.founding_offer_status(): the public figure for the marketing site (anon + authenticated). It returns only
--      open, places_total, places_left and, while open, the code and its percent (the code is meant to be public; the percent is read
--      from the code so no page ever types it). A place is taken by a REDEEMED redemption: the pricing engine (orders_pricing_effects)
--      moves a redemption to 'redeemed' only when its order is paid, and never back, so an unpaid order (still 'reserved', or 'released'
--      when it lapses) never takes a place, and a refunded order keeps its place, exactly as the engine's own total cap counts it.
--      Counting the same thing the engine counts means the page can never say "places left" while checkout refuses the code.
--   4. public.my_founding_badge(): true when the caller is the BENEFICIARY of a paid (not refunded) order whose code carries the badge.
--
-- Nothing is created live by this migration: there is no founding code until an admin makes one. Before: discount_codes has no badge
-- column and no founding function exists (checked live 2026-11-04).

-- 1. The badge column, its check, and one live founding code at a time ------------------------------------------------------------
alter table public.discount_codes add column badge text;
alter table public.discount_codes add constraint discount_codes_badge_check check (badge is null or badge in ('founding_member'));
create unique index discount_codes_one_live_founding_offer on public.discount_codes (badge, is_test) where badge is not null and status = 'active';

-- The guard, from its LIVE body (pg_get_functiondef, 2026-11-04), with badge added to what can never change.
create or replace function private.discount_codes_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then raise exception 'discount_code_immutable' using errcode = 'P0001'; end if;
  if new.code is distinct from old.code or new.kind is distinct from old.kind or new.percent is distinct from old.percent
     or new.fixed_kobo is distinct from old.fixed_kobo or new.max_discount_kobo is distinct from old.max_discount_kobo
     or new.item_codes is distinct from old.item_codes or new.cohort_id is distinct from old.cohort_id
     or new.max_total_uses is distinct from old.max_total_uses or new.max_uses_per_person is distinct from old.max_uses_per_person
     or new.valid_from is distinct from old.valid_from or new.organisation_id is distinct from old.organisation_id
     or new.is_test is distinct from old.is_test or new.valid_to > old.valid_to
     or new.badge is distinct from old.badge then
    raise exception 'discount_code_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'ended' and new.status <> 'ended' then raise exception 'discount_code_ended' using errcode = 'P0001'; end if;
  return new;
end $function$;

-- 2. admin_create_discount_code with a trailing badge. Drop the old signature first so there is never an overload. -------------
drop function public.admin_create_discount_code(text, text, integer, bigint, bigint, text[], uuid, integer, integer, timestamptz, timestamptz, text);

-- From the LIVE body (pg_get_functiondef, 2026-11-04); added: p_badge, its validation, the one-live-founding-code check, the column, the audit field.
create function public.admin_create_discount_code(p_code text, p_kind text, p_percent integer, p_fixed_kobo bigint, p_max_discount_kobo bigint,
  p_item_codes text[], p_cohort_id uuid, p_max_total_uses integer, p_max_per_person integer, p_valid_from timestamp with time zone,
  p_valid_to timestamp with time zone, p_note text, p_badge text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
  v_code text := private.normalise_discount_code(p_code); v_id uuid; v_try integer := 0;
  v_test boolean := coalesce((select is_test from public.profiles where id = (select auth.uid())), false);
  v_badge text := nullif(btrim(coalesce(p_badge, '')), '');
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  if p_cohort_id is not null and not exists (select 1 from public.sponsor_cohorts where id = p_cohort_id and organisation_id = v_org) then
    raise exception 'discount_code_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_item_codes, '{}')) c where not exists (select 1 from public.catalog_items i where i.organisation_id = v_org and i.code = c)) then
    raise exception 'unknown_item' using errcode = '22023';
  end if;
  if p_code is not null and (v_code is null or char_length(v_code) not between 4 and 24) then raise exception 'discount_code_invalid' using errcode = '22023'; end if;
  if v_badge is not null and v_badge <> 'founding_member' then raise exception 'discount_code_invalid' using errcode = '22023'; end if;
  -- the founder's terms: the first year of Membership and Membership Plus, never the upgrade or any other item, so the public copy is true
  if v_badge = 'founding_member' and (select array_agg(distinct c order by c) from unnest(coalesce(p_item_codes, '{}')) c)
       is distinct from array['membership_annual', 'membership_annual_no_panel'] then
    raise exception 'founding_items_invalid' using errcode = '22023';
  end if;
  -- one live founding offer at a time (the partial unique index enforces it too; this says why instead of 'discount_code_taken')
  if v_badge is not null and exists (select 1 from public.discount_codes d where d.badge = v_badge and d.status = 'active' and d.is_test = v_test) then
    raise exception 'founding_offer_exists' using errcode = '22023';
  end if;
  loop
    v_try := v_try + 1;
    begin
      insert into public.discount_codes (organisation_id, code, kind, percent, fixed_kobo, max_discount_kobo, item_codes, cohort_id, max_total_uses,
                                         max_uses_per_person, valid_from, valid_to, note, created_by, is_test, badge)
      values (v_org, coalesce(v_code, private.new_cohort_code()), p_kind, p_percent, p_fixed_kobo, p_max_discount_kobo, coalesce(p_item_codes, '{}'), p_cohort_id,
              p_max_total_uses, coalesce(p_max_per_person, 1), p_valid_from, p_valid_to, p_note, (select auth.uid()), v_test, v_badge)
      returning id, code into v_id, v_code;
      exit;
    exception when unique_violation then
      -- a chosen code that is taken is the admin's problem; a generated one is retried
      if p_code is not null or v_try >= 5 then raise exception 'discount_code_taken' using errcode = '22023'; end if;
    end;
  end loop;
  perform private.log_audit('pricing.discount_code_created', 'discount_code', v_id,
    jsonb_build_object('kind', p_kind, 'percent', p_percent, 'fixed_kobo', p_fixed_kobo, 'max_total_uses', p_max_total_uses, 'valid_to', p_valid_to, 'badge', v_badge));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $function$;
revoke all on function public.admin_create_discount_code(text, text, integer, bigint, bigint, text[], uuid, integer, integer, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.admin_create_discount_code(text, text, integer, bigint, bigint, text[], uuid, integer, integer, timestamptz, timestamptz, text, text) to authenticated, service_role;

-- The admin list, from its LIVE body (pg_get_functiondef, 2026-11-04), with each code's badge added.
create or replace function public.admin_pricing_overview()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'rules_version', (select version from public.pricing_config where is_active),
    'points_enabled', (private.pricing_rules() -> 'points' ->> 'enabled')::boolean,
    'membership_guard_on', private.go_live_guard_on('membership_billing_enabled'),
    'books', coalesce((select jsonb_agg(jsonb_build_object('id', pb.id, 'name', pb.name, 'status', pb.status, 'sponsor_org_id', pb.sponsor_org_id,
        'entries', coalesce((select jsonb_agg(jsonb_build_object('item_code', i.code, 'rate_kobo', e.rate_kobo, 'sponsor_share_percent', e.sponsor_share_percent,
            'valid_from', e.valid_from, 'valid_to', e.valid_to, 'reason', e.reason) order by e.valid_from desc)
          from public.price_book_entries e join public.catalog_items i on i.id = e.catalog_item_id where e.price_book_id = pb.id), '[]'::jsonb))
        order by pb.created_at desc) from public.price_books pb where pb.organisation_id = v_org), '[]'::jsonb),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'kind', d.kind, 'percent', d.percent, 'fixed_kobo', d.fixed_kobo,
        'status', d.status, 'valid_from', d.valid_from, 'valid_to', d.valid_to, 'max_total_uses', d.max_total_uses, 'max_uses_per_person', d.max_uses_per_person,
        'item_codes', to_jsonb(d.item_codes), 'cohort_id', d.cohort_id, 'badge', d.badge,
        'used', (select count(*) from public.discount_redemptions r where r.discount_code_id = d.id and r.state in ('reserved', 'redeemed') and not r.is_test))
        order by d.created_at desc) from public.discount_codes d where d.organisation_id = v_org and not d.is_test), '[]'::jsonb));
end $function$;

-- 3. The public figure: is the founding offer open, and how many places are left -----------------------------------------------
create function public.founding_offer_status()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  dc public.discount_codes%rowtype;
  v_taken integer;
  v_left integer;
begin
  -- the one live, real founding code (never a test code: a test admin's rehearsal is never the public offer)
  select * into dc from public.discount_codes d
   where d.badge = 'founding_member' and d.status = 'active' and not d.is_test
     and d.valid_from <= now() and d.valid_to > now()
   order by d.created_at desc limit 1;
  if not found then return jsonb_build_object('open', false); end if;
  -- a place is taken only by a redeemed use, which only a PAID order makes (see the header)
  select count(*) into v_taken from public.discount_redemptions r where r.discount_code_id = dc.id and r.state = 'redeemed' and not r.is_test;
  v_left := greatest(dc.max_total_uses - v_taken, 0);
  if v_left = 0 then
    return jsonb_build_object('open', false, 'places_total', dc.max_total_uses, 'places_left', 0);
  end if;
  return jsonb_build_object('open', true, 'places_total', dc.max_total_uses, 'places_left', v_left, 'code', dc.code, 'percent', dc.percent);
end $function$;
revoke all on function public.founding_offer_status() from public;
grant execute on function public.founding_offer_status() to anon, authenticated, service_role;

-- 4. The caller's own badge -----------------------------------------------------------------------------------------------------
create function public.my_founding_badge()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.orders o join public.discount_codes d on d.id = o.discount_code_id
     where o.beneficiary_patient_id = (select auth.uid()) and o.state = 'paid' and d.badge = 'founding_member')
$function$;
revoke all on function public.my_founding_badge() from public, anon;
grant execute on function public.my_founding_badge() to authenticated, service_role;

-- Self-check: the shape this migration promises.
do $$
begin
  if (select count(*) from pg_proc where proname = 'admin_create_discount_code' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'founding offer: admin_create_discount_code must have exactly one signature';
  end if;
  if not has_function_privilege('anon', 'public.founding_offer_status()', 'EXECUTE') then raise exception 'founding offer: anon must read the offer'; end if;
  if has_function_privilege('anon', 'public.my_founding_badge()', 'EXECUTE') then raise exception 'founding offer: anon must not call my_founding_badge'; end if;
  if has_function_privilege('anon', 'public.admin_create_discount_code(text, text, integer, bigint, bigint, text[], uuid, integer, integer, timestamptz, timestamptz, text, text)', 'EXECUTE') then
    raise exception 'founding offer: anon must not create codes';
  end if;
end $$;
