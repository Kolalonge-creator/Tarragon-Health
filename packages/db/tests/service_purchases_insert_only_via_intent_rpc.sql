-- ===========================================================================
-- Verification: 20260905000123_service_purchases_insert_only_via_intent_rpc
--
-- The hole this closes: public.service_purchases' INSERT policy checked only
-- `purchaser_profile_id = auth.uid() OR private.is_org_staff(...)`, leaving
-- patient_id, service_product_id, status, amount_kobo, purchased_at and
-- expires_at entirely to the caller — and `authenticated` held the table
-- INSERT grant. Any signed-in patient could POST an 'active', ₦0
-- service_purchases row for the ₦50,000 12-week doctor-supported programme
-- (or a senior_case_review_credit claim on senior clinician time), for
-- themselves or for somebody else.
--
-- Nothing in the codebase inserts here directly — every real path goes
-- through the SECURITY DEFINER public.record_service_purchase_intent, which
-- prices the row server-side from service_products. So the policy and the
-- grant were pure attack surface and are removed.
--
-- This script proves:
--   * a patient session can no longer insert into service_purchases at all,
--     for themselves or for anyone else;
--   * record_service_purchase_intent still works from a patient session and
--     still prices the row from service_products rather than from the caller;
--   * the patient can still READ their own purchases (the entitlement check,
--     the dashboard and the payment-failure banner all depend on it);
--   * and a sabotage run — the old policy and grant restored — shows the
--     refusal checks discriminate rather than passing vacuously.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table spir_fixture(k text primary key, v uuid) on commit drop;
create temporary table spir_result(
  check_name text,
  actor      text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: an attacker and an unrelated victim in the same organisation,
-- plus the most expensive recurring paid product on the platform — the one
-- an entitlement forged here would actually be worth stealing.
-- --------------------------------------------------------------------------
do $$
declare
  v_org      uuid;
  v_attacker uuid := gen_random_uuid();
  v_victim   uuid := gen_random_uuid();
  v_product  uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  select id into v_product from public.service_products
  where code = 'chronic_doctor_supported_pack' and is_active;
  if v_product is null then
    raise exception 'chronic_doctor_supported_pack is missing or inactive — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_attacker, 'spir-attacker@example.invalid', 'x', now(), '{}', '{}'),
    (v_victim,   'spir-victim@example.invalid',   'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_attacker, v_org, 'patient', 'SPIR Attacker'), (v_victim, v_org, 'patient', 'SPIR Victim')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = 'patient';

  insert into spir_fixture values
    ('org', v_org), ('attacker', v_attacker), ('victim', v_victim), ('product', v_product);
end $$;

-- ==========================================================================
-- 1. THE ATTACK — free entitlement for self, and for a third party.
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from spir_fixture where k = 'org');
  v_attacker uuid := (select v from spir_fixture where k = 'attacker');
  v_victim   uuid := (select v from spir_fixture where k = 'victim');
  v_product  uuid := (select v from spir_fixture where k = 'product');
  v_self     text;
  v_other    text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);

  begin
    set local role authenticated;
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id,
       status, amount_kobo, currency, purchased_at, expires_at)
    values (v_org, v_attacker, v_attacker, v_product,
            'active', 0, 'NGN', now(), now() + interval '84 days');
    reset role;
    v_self := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_self := sqlstate;
  end;

  begin
    set local role authenticated;
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id,
       status, amount_kobo, currency, purchased_at, expires_at)
    values (v_org, v_victim, v_attacker, v_product,
            'active', 0, 'NGN', now(), now() + interval '84 days');
    reset role;
    v_other := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_other := sqlstate;
  end;

  insert into spir_result values
    ('patient cannot grant themselves a free active entitlement', 'patient',
     v_self, '42501', case when v_self = '42501' then 'PASS' else 'FAIL' end);
  insert into spir_result values
    ('patient cannot grant a third party a free active entitlement', 'patient',
     v_other, '42501', case when v_other = '42501' then 'PASS' else 'FAIL' end);

  if v_self <> '42501' or v_other <> '42501' then
    raise exception 'HOLE OPEN: a patient session could still insert into service_purchases (self=%, other=%)',
      v_self, v_other;
  end if;

  if exists (select 1 from public.service_purchases
             where purchaser_profile_id = v_attacker or patient_id = v_victim) then
    raise exception 'HOLE OPEN: a forged service_purchases row actually landed';
  end if;
end $$;

-- ==========================================================================
-- 2. The one legitimate way in still works, and still prices server-side.
-- ==========================================================================
do $$
declare
  v_attacker uuid := (select v from spir_fixture where k = 'attacker');
  v_id       uuid;
  v_status   text;
  v_amount   bigint;
  v_expected bigint;
  v_visible  int;
begin
  select price_kobo into v_expected from public.service_products
  where code = 'chronic_doctor_supported_pack';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_id := public.record_service_purchase_intent(v_attacker, 'chronic_doctor_supported_pack');

  -- ...and the same session can still read back what it just bought.
  select count(*) into v_visible from public.service_purchases where id = v_id;
  reset role;

  select status::text, amount_kobo into v_status, v_amount
  from public.service_purchases where id = v_id;

  insert into spir_result values
    ('record_service_purchase_intent still records a purchase', 'patient',
     coalesce(v_status, 'no row'), 'pending_payment',
     case when v_status = 'pending_payment' then 'PASS' else 'FAIL' end);
  insert into spir_result values
    ('...priced from service_products, not from the caller', 'patient',
     coalesce(v_amount::text, 'null'), v_expected::text,
     case when v_amount = v_expected then 'PASS' else 'FAIL' end);
  insert into spir_result values
    ('patient can still read their own purchase', 'patient',
     v_visible::text, '1', case when v_visible = 1 then 'PASS' else 'FAIL' end);

  if v_status is distinct from 'pending_payment' or v_amount is distinct from v_expected then
    raise exception 'BROKEN: the legitimate purchase path no longer works (status=%, amount=%)',
      v_status, v_amount;
  end if;
  if v_visible <> 1 then
    raise exception 'BROKEN: a patient can no longer read their own service_purchases row';
  end if;

  delete from public.service_purchases where id = v_id;
end $$;

-- ==========================================================================
-- 3. SABOTAGE — put the old policy and grant back and re-run the attack. If
--    it is still refused, section 1 is passing for some other reason and
--    proves nothing about this migration.
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from spir_fixture where k = 'org');
  v_attacker uuid := (select v from spir_fixture where k = 'attacker');
  v_product  uuid := (select v from spir_fixture where k = 'product');
  v_state    text;
  v_id       uuid;
begin
  grant insert on public.service_purchases to authenticated;
  create policy spir_sabotage_insert on public.service_purchases
    for insert to authenticated
    with check (purchaser_profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id,
       status, amount_kobo, currency, purchased_at, expires_at)
    values (v_org, v_attacker, v_attacker, v_product,
            'active', 0, 'NGN', now(), now() + interval '84 days')
    returning id into v_id;
    reset role;
    v_state := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_state := sqlstate;
  end;

  drop policy spir_sabotage_insert on public.service_purchases;
  revoke insert on public.service_purchases from authenticated;
  if v_id is not null then delete from public.service_purchases where id = v_id; end if;

  insert into spir_result values
    ('sabotage: old policy + grant restored, attack succeeds again (proves the test discriminates)',
     'patient', v_state, 'INSERT ACCEPTED',
     case when v_state = 'INSERT ACCEPTED' then 'PASS' else 'FAIL' end);

  if v_state <> 'INSERT ACCEPTED' then
    raise exception 'VACUOUS TEST: with the old policy and grant restored the attack still failed (%) — section 1 proves nothing',
      v_state;
  end if;
end $$;

select check_name, actor, observed, expected, verdict
from spir_result
order by verdict desc, check_name, actor;

rollback;
