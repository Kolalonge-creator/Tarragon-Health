-- Proof: Membership ladder foundation (migration *_membership_evergreen_ladder_foundation.sql).
-- Proves, in one rolled-back transaction that raises on any failed check:
--   * tier column: default 'plus', CHECK refuses any other value
--   * private.membership_tier_for_item: membership_annual -> plus; the Membership code and anything unknown -> evergreen
--   * private.patient_membership_tier: evergreen / plus for a current Member, null for Free and for a lapsed or ended Membership,
--     plus wins if a person somehow holds both
--   * private.patient_is_member is true for BOTH tiers (Membership is a Member for every safety purpose) and does not read the tier
--   * prices: Membership 8,400,000 and Membership Plus 12,900,000 kobo in force, the old 12,000,000 row closed not edited; the
--     Membership item exists and is inactive
--   * the tier helpers are not callable by anon or authenticated
--   * every Membership-creating function carries the tier stamp and the testing-day check-in carries the panel gate
-- SABOTAGE: patient_membership_tier is replaced by a version that always answers 'plus'; the Membership check must flip.
begin;

create function pg_temp.mk(p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'eg-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', 'patient', 'EG ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = 'patient', is_test = true, is_active = true;
  return v;
end $f$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

do $$
declare a uuid := pg_temp.mk('evergreen'); b uuid := pg_temp.mk('plus'); c uuid := pg_temp.mk('free'); d uuid := pg_temp.mk('lapsed'); e uuid := pg_temp.mk('both');
begin
  insert into fx values ('a', a), ('b', b), ('c', c), ('d', d), ('e', e);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', a, 'purchase', 'active', now() - interval '1 day', now() + interval '300 days', true, 'evergreen');
  -- no tier given: must default to plus
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test)
  values ('00000000-0000-0000-0000-000000000001', b, 'purchase', 'active', now() - interval '1 day', now() + interval '300 days', true);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, ended_at, end_reason, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', d, 'purchase', 'ended', now() - interval '400 days', now() - interval '30 days', now() - interval '30 days', 'proof: ended', true, 'evergreen');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', e, 'purchase', 'active', now() - interval '1 day', now() + interval '300 days', true, 'evergreen');
end $$;

do $$
declare a uuid := (select v from fx where k = 'a'); b uuid := (select v from fx where k = 'b'); c uuid := (select v from fx where k = 'c');
        d uuid := (select v from fx where k = 'd'); e uuid := (select v from fx where k = 'e'); r text;
begin
  if (select tier from public.patient_memberships where patient_id = b) <> 'plus' then raise exception 'FAIL default tier is not plus'; end if;
  begin
    update public.patient_memberships set tier = 'gold' where patient_id = a;
    raise exception 'FAIL the CHECK accepted tier gold';
  exception when check_violation then null; end;

  if private.membership_tier_for_item('membership_annual') <> 'plus' then raise exception 'FAIL membership_annual is not plus'; end if;
  if private.membership_tier_for_item('membership_annual_no_panel') <> 'evergreen' then raise exception 'FAIL no_panel is not evergreen'; end if;
  if private.membership_tier_for_item('whatever') <> 'evergreen' or private.membership_tier_for_item(null) <> 'evergreen' then
    raise exception 'FAIL an unknown code did not fall to evergreen';
  end if;

  if private.patient_membership_tier(a) is distinct from 'evergreen' then raise exception 'FAIL evergreen member reports %', private.patient_membership_tier(a); end if;
  if private.patient_membership_tier(b) is distinct from 'plus' then raise exception 'FAIL plus member reports %', private.patient_membership_tier(b); end if;
  if private.patient_membership_tier(c) is not null then raise exception 'FAIL a Free person has a tier'; end if;
  if private.patient_membership_tier(d) is not null then raise exception 'FAIL an ended membership still has a tier'; end if;

  if not (private.patient_is_member(a) and private.patient_is_member(b)) then raise exception 'FAIL both tiers must be Member'; end if;
  if private.patient_is_member(c) or private.patient_is_member(d) then raise exception 'FAIL Free or ended counted as Member'; end if;
  if pg_get_functiondef('private.patient_is_member_at(uuid,timestamptz)'::regprocedure) ilike '%tier%' then raise exception 'FAIL patient_is_member reads the tier'; end if;

  -- patient_memberships_one_active already makes two active rows for one person impossible, so no "holds both" case exists
  begin
    insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
    values ('00000000-0000-0000-0000-000000000001', e, 'purchase', 'active', now() - interval '1 hour', now() + interval '10 days', true, 'plus');
    raise exception 'FAIL a second active membership was accepted';
  exception when unique_violation then null; end;
end $$;

do $$
declare v_plus uuid; v_eg uuid; v_old_closed boolean;
begin
  select id into v_plus from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  select id into v_eg from public.catalog_items where code = 'membership_annual_no_panel' order by created_at limit 1;
  if v_eg is null then raise exception 'FAIL the Membership item does not exist'; end if;
  if (select active from public.catalog_items where id = v_eg) then raise exception 'FAIL the Membership item is active'; end if;
  if (select amount_kobo from public.prices where catalog_item_id = v_eg and valid_to is null) <> 8400000 then raise exception 'FAIL Membership price'; end if;
  if (select amount_kobo from public.prices where catalog_item_id = v_plus and valid_to is null) <> 12900000 then raise exception 'FAIL Membership Plus price'; end if;
  select exists (select 1 from public.prices where catalog_item_id = v_plus and amount_kobo = 12000000 and valid_to is not null) into v_old_closed;
  if not v_old_closed then raise exception 'FAIL the 12,000,000 row was not closed (or was edited)'; end if;
  if (select count(*) from public.prices where catalog_item_id = v_plus and valid_to is null) <> 1 then raise exception 'FAIL more than one open Plus price'; end if;

  if has_function_privilege('anon', 'private.patient_membership_tier(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.patient_membership_tier(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.membership_tier_for_item(text)', 'EXECUTE') or has_function_privilege('authenticated', 'private.membership_tier_for_item(text)', 'EXECUTE') then
    raise exception 'FAIL a tier helper is callable by a client role';
  end if;

  if pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('private.settle_sponsor_order(uuid)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure) not ilike '%membership_tier_for_item%'
     or pg_get_functiondef('private.grant_org_seat(uuid)'::regprocedure) not ilike '%membership_tier_for_item%' then
    raise exception 'FAIL a Membership-creating path does not stamp the tier';
  end if;
  if pg_get_functiondef('public.check_in_testing_booking(uuid)'::regprocedure) not ilike '%annual_panel_requires_plus%' then raise exception 'FAIL the panel gate is missing'; end if;
end $$;

-- SABOTAGE: a tier function that always says plus must make the Membership check flip
create or replace function private.patient_membership_tier(p_patient uuid) returns text language sql stable security definer set search_path = ''
as $$ select 'plus'::text $$;
do $$
declare a uuid := (select v from fx where k = 'a');
begin
  -- the real assertion (an Membership member reports evergreen) must now be false: that is the flip this test depends on
  if not (private.patient_membership_tier(a) is distinct from 'evergreen') then raise exception 'FAIL the Membership check did not flip under sabotage'; end if;
end $$;

select 'PASS membership_evergreen_ladder_foundation' as result;
rollback;
