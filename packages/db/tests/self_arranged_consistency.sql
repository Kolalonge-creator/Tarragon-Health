-- Consistency sweep regression test: the three RPCs that still assumed
-- Tarragon books and bills a test.
--
-- sponsor_book_care was genuinely BROKEN before 20260803134416 (it inserted a
-- partner-shaped order that enforce_lab_order_origin rejects), and
-- purchase_care_voucher would have taken real money for a Screen that could
-- never be redeemed. This pins both, plus the facility picker refusing a
-- self-arranged order.
--
-- Rolled back. Run from the MAIN checkout:
--   npx supabase db query --linked -f packages/db/tests/self_arranged_consistency.sql

begin;

create temp table r(step text, verdict text) on commit drop;
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid; v_sup uuid; v_bundle uuid; v_fac uuid;
  v_res jsonb; v_order uuid; v_row public.lab_orders%rowtype; v_n int;
begin
  select id, organisation_id into v_pt, v_org from public.profiles
   where role='patient' and organisation_id is not null order by created_at limit 1;
  select id into v_sup from public.profiles
   where role='patient' and organisation_id=v_org and id<>v_pt limit 1;
  select id into v_bundle from public.panel_bundles where code='screen_core';
  select id into v_fac from public.facilities where type='lab' limit 1;
  if v_pt is null or v_sup is null or v_bundle is null or v_fac is null then
    raise exception 'fixture lookup failed - test would be vacuous';
  end if;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_pt, v_sup, 'manage', v_pt)
  on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Previously a hard 23514 for every supporter. Must issue a request again.
  v_res := public.sponsor_book_care(v_pt, 'screen_core', v_fac);
  insert into r values ('1 supporter can request a check again',
    case when (v_res->>'ok')::boolean and (v_res->>'self_arranged')::boolean
         then 'PASS' else 'FAIL - '||v_res::text end);
  v_order := (v_res->>'order_id')::uuid;

  -- ...and it must be genuinely self-arranged, not partner-shaped. The facility
  -- argument is accepted and ignored, which this proves rather than assumes.
  reset role;
  select * into v_row from public.lab_orders where id = v_order;
  insert into r values ('2 the order carries no provider, facility or charge',
    case when v_row.fulfilment='self_arranged' and v_row.provider_id is null
          and v_row.facility_id is null and v_row.total_kobo=0
          and v_row.status='ordered'
         then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sup, 'role','authenticated')::text, true);
  set local role authenticated;

  -- Selling something undeliverable must fail closed.
  begin
    perform public.purchase_care_voucher(v_pt, v_bundle, null);
    insert into r values ('3 cannot buy a voucher for a test we do not sell','FAIL - sold it');
  exception when check_violation then
    insert into r values ('3 cannot buy a voucher for a test we do not sell','PASS');
  end;

  begin
    perform public.set_lab_order_facility(v_order, v_fac);
    insert into r values ('4 no facility to set on a self-arranged order','FAIL - accepted');
  exception when check_violation then
    insert into r values ('4 no facility to set on a self-arranged order','PASS');
  end;

  -- CONTROL: the authorisation gate must still be what does the work. Without a
  -- 'manage' grant this is refused, so case 1 passing means the grant, not a
  -- hole.
  reset role;
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
