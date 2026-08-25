-- Consistency sweep regression test: the three RPCs that still assumed
-- Tarragon books and bills a test.
--
-- sponsor_book_care was genuinely BROKEN before 20260803134416 (it inserted a
-- partner-shaped order that enforce_lab_order_origin rejects at the time), was
-- rewritten there to issue a self-arranged request instead, and is now
-- RESTORED by 20260825185258_lab_partner_fulfilment_restored.sql to the
-- partner-priced version again (Synlab Nigeria, nationwide) — this file pins
-- that restored shape. purchase_care_voucher still fails closed (untouched,
-- out of scope for the 2026-08-25 change) and set_lab_order_facility is now
-- pinned BOTH ways: it refuses a self-arranged order (the dormant path is
-- still legal) and succeeds on the live partner/pending_payment path, which
-- it could not be positively tested against before today.
--
-- Rolled back. Run from the MAIN checkout:
--   npx supabase db query --linked -f packages/db/tests/self_arranged_consistency.sql

begin;

create temp table r(step text, verdict text) on commit drop;
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid; v_sup uuid; v_bundle uuid; v_fac uuid; v_synlab uuid;
  v_res jsonb; v_order uuid; v_order2 uuid; v_self_order uuid;
  v_row public.lab_orders%rowtype; v_row2 public.lab_orders%rowtype; v_n int;
begin
  select id, organisation_id into v_pt, v_org from public.profiles
   where role='patient' and organisation_id is not null order by created_at limit 1;
  select id into v_sup from public.profiles
   where role='patient' and organisation_id=v_org and id<>v_pt limit 1;
  select id into v_bundle from public.panel_bundles where code='screen_core';
  select id into v_synlab from public.lab_providers where name='Synlab Nigeria';
  -- Deliberately the Synlab-linked facility, not just any lab facility: the
  -- assertions below check that sponsor_book_care/set_lab_order_facility
  -- resolve to Synlab specifically, the one active partner.
  select f.id into v_fac from public.facilities f
   join public.lab_providers lp on lp.id = f.lab_provider_id
   where lp.name = 'Synlab Nigeria' and f.is_active limit 1;
  if v_pt is null or v_sup is null or v_bundle is null or v_fac is null or v_synlab is null then
    raise exception 'fixture lookup failed - test would be vacuous';
  end if;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_pt, v_sup, 'manage', v_pt)
  on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Restored: a supporter's request is priced, pending payment, and routed to
  -- Synlab -- not self-arranged any more, and not sold from a voucher because
  -- none exists yet for this beneficiary/bundle.
  v_res := public.sponsor_book_care(v_pt, 'screen_core', v_fac);
  insert into r values ('1 supporter can request and pay for a check again',
    case when (v_res->>'ok')::boolean
          and (v_res->>'order_id') is not null
          and (v_res->>'paid')::boolean = false
          and (v_res->>'price_kobo')::bigint = 6500000
          and (v_res->>'voucher_id') is null
         then 'PASS' else 'FAIL - '||v_res::text end);
  v_order := (v_res->>'order_id')::uuid;

  -- Also prove the no-facility fallback: home collection covers every state,
  -- so a supporter who names no facility still gets a priced, Synlab-routed
  -- order rather than a provider-less one Tarragon can't act on.
  v_res := public.sponsor_book_care(v_pt, 'screen_core', null);
  insert into r values ('1b supporter request with no facility still resolves to Synlab',
    case when (v_res->>'ok')::boolean and (v_res->>'price_kobo')::bigint = 6500000
         then 'PASS' else 'FAIL - '||v_res::text end);
  v_order2 := (v_res->>'order_id')::uuid;

  -- ...and it must be genuinely partner-shaped now, priced and routed, not
  -- the self-arranged shape this pinned before 2026-08-25.
  reset role;
  select * into v_row from public.lab_orders where id = v_order;
  insert into r values ('2 the order is priced, pending payment, and routed to Synlab',
    case when v_row.fulfilment='partner' and v_row.provider_id = v_synlab
          and v_row.facility_id = v_fac and v_row.total_kobo=6500000
          and v_row.status='pending_payment'
         then 'PASS' else 'FAIL' end);

  select * into v_row2 from public.lab_orders where id = v_order2;
  insert into r values ('2b no-facility order still gets provider_id = Synlab',
    case when v_row2.provider_id = v_synlab and v_row2.facility_id is null
          and v_row2.fulfilment='partner' and v_row2.status='pending_payment'
         then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Selling something undeliverable must fail closed -- unchanged by the
  -- 2026-08-25 restoration, purchase_care_voucher is explicitly left alone.
  begin
    perform public.purchase_care_voucher(v_pt, v_bundle, null);
    insert into r values ('3 cannot buy a voucher for a test we do not sell','FAIL - sold it');
  exception when check_violation then
    insert into r values ('3 cannot buy a voucher for a test we do not sell','PASS');
  end;

  -- A self-arranged order (still legal, dormant path) still refuses a
  -- facility pick -- proven on a genuine self_arranged row, not assumed.
  reset role;
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo, fulfilment)
  values (v_org, v_pt, v_bundle, 'patient_initiated', 'ordered', 0, 'self_arranged')
  returning id into v_self_order;

  begin
    perform public.set_lab_order_facility(v_self_order, v_fac);
    insert into r values ('4 no facility to set on a self-arranged order','FAIL - accepted');
  exception when check_violation then
    insert into r values ('4 no facility to set on a self-arranged order','PASS');
  end;

  -- POSITIVE: the live path. v_order2 is partner-fulfilled, pending_payment,
  -- and has no facility yet (the sponsor didn't pick one) -- exactly what
  -- set_lab_order_facility now exists to fill in, and could not be positively
  -- tested while every lab order in the app was self-arranged.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pt, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_lab_order_facility(v_order2, v_fac);
  reset role;

  select * into v_row2 from public.lab_orders where id = v_order2;
  insert into r values ('4b facility can be set on a live partner pending_payment order',
    case when v_row2.facility_id = v_fac and v_row2.provider_id = v_synlab
         then 'PASS' else 'FAIL' end);

  -- CONTROL: the authorisation gate must still be what does the work. Without a
  -- 'manage' grant this is refused, so case 1 passing means the grant, not a
  -- hole.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pt, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.sponsor_book_care(v_sup, 'screen_core', null);
    insert into r values ('5 CONTROL no grant means no request','FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('5 CONTROL no grant means no request','PASS');
  end;
  reset role;

  select count(*) into v_n from public.care_vouchers;
  insert into r values ('6 no voucher was created anywhere',
    case when v_n=0 then 'PASS' else 'FAIL - '||v_n end);
end $$;

select step, verdict from r order by step;

rollback;
