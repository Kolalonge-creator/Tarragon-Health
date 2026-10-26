-- Proof: after EVERY migration has replayed (this runs on the freshly reset stack in CI), the ladder's changes are still in the live
-- function bodies and the removed pay-in-parts code is gone. The remove-instalments migration is timestamped after the ladder migrations and
-- rewrites functions the ladder also changed, so a green replay alone does not show the ladder survived: this does.
-- Raises on any failed check. Read-only.
begin;

do $$
declare
  fn record;
begin
  -- 1. the ladder is present in the final bodies
  for fn in
    select * from (values
      ('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)', array['membership_tier_for_item', 'membership_upgrade_plus', 'upgrade_not_applicable', 'upgraded_membership_id']),
      ('private.post_order_to_ledger(uuid,boolean)', array['membership_upgrade_plus', 'upgraded_membership_id']),
      ('public.decide_order_refund(uuid,boolean,text)', array['membership_upgrade_plus', 'upgraded_membership_id']),
      ('public.create_order(text,uuid,uuid,text,boolean,bigint)', array['membership_two_member_tiers', 'upgrade_already_open', 'upgrade_not_available']),
      ('private.settle_sponsor_order(uuid)', array['membership_tier_for_item']),
      ('public.respond_to_gifted_pack(uuid,boolean)', array['membership_tier_for_item']),
      ('private.grant_org_seat(uuid)', array['membership_tier_for_item']),
      ('public.check_in_testing_booking(uuid)', array['annual_panel_requires_plus']),
      ('private.queue_membership_renewal_reminders()', array['tier'])
    ) as t(sig, needles)
  loop
    declare d text := pg_get_functiondef(fn.sig::regprocedure); n text;
    begin
      foreach n in array fn.needles loop
        if position(n in d) = 0 then raise exception 'FAIL % lost the ladder change [%]', fn.sig, n; end if;
      end loop;
    end;
  end loop;

  -- 2. no function body still names the removed pay-in-parts objects
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.prokind = 'f'
                and pg_get_functiondef(p.oid) ~* 'order_instalment|record_instalment|membership_instalments|create_instalment_order') then
    raise exception 'FAIL a function still names a removed instalment object: %',
      (select string_agg(n.nspname || '.' || p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prokind = 'f' and pg_get_functiondef(p.oid) ~* 'order_instalment|record_instalment|membership_instalments|create_instalment_order');
  end if;
  if to_regclass('public.order_instalment_plans') is not null then raise exception 'FAIL the instalment plan table still exists'; end if;

  -- 3. the tier data model is intact
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'patient_memberships' and column_name = 'tier') then raise exception 'FAIL patient_memberships.tier is gone'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'upgraded_membership_id') then raise exception 'FAIL orders.upgraded_membership_id is gone'; end if;
  if (select count(*) from public.catalog_items where code in ('membership_annual', 'membership_annual_no_panel', 'membership_upgrade_plus')) < 3 then raise exception 'FAIL a ladder catalogue item is missing'; end if;
  if (select is_enabled from public.platform_modules where key = 'membership_two_member_tiers') is distinct from false then raise exception 'FAIL the tier module is not OFF'; end if;
end $$;

-- SABOTAGE: take the upgrade clause out of the payment function; the first check must then fail
do $$
declare d text; failed boolean := false;
begin
  d := pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure);
  execute replace(d, 'membership_upgrade_plus', 'membership_upgrade_removed');
  begin
    if position('membership_upgrade_plus' in pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure)) = 0 then
      raise exception 'lost the ladder change';
    end if;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL the structural check cannot detect a removed ladder clause'; end if;
end $$;

select 'PASS membership_ladder_survives_instalment_removal' as result;
rollback;
