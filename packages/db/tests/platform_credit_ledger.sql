-- ===========================================================================
-- Verification: Platform Credit (20260917100300..20260917100629), extended
-- 20260918 to cover spending platform credit on a pharmacy order
-- (20260917224156_platform_credit_spend_on_pharmacy_order.sql) and a
-- specialist referral (20260917224509_platform_credit_spend_on_specialist_
-- referral.sql) — sections 5-7 below. Neither of those two migrations'
-- own inline self-checks proves the RPCs discriminate correctly either
-- (same reason as the rest of this file: they run as postgres, and
-- RLS/the functions' own auth.uid() checks only bite a real session).
--
-- Proves what the migrations' own inline self-checks could not, because they
-- run as postgres and RLS only bites a real `authenticated` session:
--   * a signed-in patient cannot write platform_credit_balances/
--     platform_credit_ledger_entries/platform_credit_topup_intents directly —
--     every write goes through a SECURITY DEFINER RPC or it doesn't happen;
--   * a patient cannot read another patient's balance, ledger or topup
--     intents;
--   * the bucket-consumption order actually works end to end: a spend draws
--     down promotional (admin-granted) credit before a patient's own
--     paid-in money — the whole point of splitting the balance in two
--     (see 20260917100300's header) — proved with a mixed balance, not just
--     asserted in a comment;
--   * a sabotage run (the old unconstrained grants restored) shows these
--     checks actually discriminate rather than passing vacuously;
--   * (added 2026-09-18) pay_pharmacy_order_on_platform_credit and
--     pay_specialist_referral_on_platform_credit each refuse a caller who
--     is not the order's own patient (cross-patient isolation), refuse an
--     insufficient balance atomically (order status/ledger/balance all
--     unchanged, not partially applied), and — on success — flip the
--     booking row to payment_confirmed with the same four columns the
--     Paystack webhook sets, and stamp the new booking_order_id/
--     booking_order_type columns on the ledger row that funded it.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table pcl_fixture(k text primary key, v uuid) on commit drop;
create temporary table pcl_result(
  check_name text,
  actor      text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixtures: two patients in the same org, one product to spend on.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org      uuid;
  v_patient  uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_third    uuid := gen_random_uuid();
  v_product  uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  select id into v_product from public.service_products
   where is_active and currency = 'NGN' and price_kobo > 0
   order by price_kobo, code
   limit 1;
  if v_product is null then
    raise exception 'no active priced NGN service_product — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'pcl-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other,   'pcl-other@example.invalid',   'x', now(), '{}', '{}'),
    (v_third,   'pcl-third@example.invalid',   'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'PCL Patient'), (v_other, v_org, 'patient', 'PCL Other'),
         (v_third, v_org, 'patient', 'PCL Third')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  insert into pcl_fixture values
    ('org', v_org), ('patient', v_patient), ('other', v_other), ('third', v_third), ('product', v_product);
end $$;

-- ==========================================================================
-- 1. THE ATTACK — a patient session cannot write these tables directly.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from pcl_fixture where k = 'org');
  v_patient uuid := (select v from pcl_fixture where k = 'patient');
  v_balance_write text;
  v_ledger_write  text;
  v_intent_write  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);

  begin
    set local role authenticated;
    insert into public.platform_credit_balances (patient_id, organisation_id, paid_balance_kobo)
    values (v_patient, v_org, 100000000);
    reset role;
    v_balance_write := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_balance_write := sqlstate;
  end;

  begin
    set local role authenticated;
    insert into public.platform_credit_ledger_entries
      (organisation_id, patient_id, entry_type, paid_amount_kobo, balance_after_kobo)
    values (v_org, v_patient, 'topup', 100000000, 100000000);
    reset role;
    v_ledger_write := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_ledger_write := sqlstate;
  end;

  begin
    set local role authenticated;
    insert into public.platform_credit_topup_intents
      (organisation_id, patient_id, purchaser_profile_id, amount_kobo, status)
    values (v_org, v_patient, v_patient, 100000000, 'completed');
    reset role;
    v_intent_write := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_intent_write := sqlstate;
  end;

  insert into pcl_result values
    ('patient cannot insert platform_credit_balances directly', 'patient',
     v_balance_write, '42501', case when v_balance_write = '42501' then 'PASS' else 'FAIL' end);
  insert into pcl_result values
    ('patient cannot insert platform_credit_ledger_entries directly', 'patient',
     v_ledger_write, '42501', case when v_ledger_write = '42501' then 'PASS' else 'FAIL' end);
  insert into pcl_result values
    ('patient cannot insert platform_credit_topup_intents directly', 'patient',
     v_intent_write, '42501', case when v_intent_write = '42501' then 'PASS' else 'FAIL' end);

  if v_balance_write <> '42501' or v_ledger_write <> '42501' or v_intent_write <> '42501' then
    raise exception 'HOLE OPEN: a patient session could write a platform_credit table directly (balance=%, ledger=%, intent=%)',
      v_balance_write, v_ledger_write, v_intent_write;
  end if;

  if exists (select 1 from public.platform_credit_balances where patient_id = v_patient) then
    raise exception 'HOLE OPEN: a forged platform_credit_balances row actually landed';
  end if;
end $$;

-- ==========================================================================
-- 2. A patient cannot read someone else's balance, ledger or topup intents.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from pcl_fixture where k = 'org');
  v_patient uuid := (select v from pcl_fixture where k = 'patient');
  v_other   uuid := (select v from pcl_fixture where k = 'other');
  v_visible int;
begin
  -- Give "other" a real balance to try to peek at.
  perform private.platform_credit_apply(
    p_patient_id := v_other, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 500000, p_description := 'pcl fixture funding'
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_visible from public.platform_credit_balances where patient_id = v_other;
  reset role;

  insert into pcl_result values
    ('patient cannot read another patient''s platform_credit_balances row', 'patient',
     v_visible::text, '0', case when v_visible = 0 then 'PASS' else 'FAIL' end);
  if v_visible <> 0 then
    raise exception 'HOLE OPEN: a patient session could read another patient''s platform credit balance';
  end if;
end $$;

-- ==========================================================================
-- 3. Bucket-consumption order: spend draws promo before paid.
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from pcl_fixture where k = 'org');
  v_patient  uuid := (select v from pcl_fixture where k = 'patient');
  v_before   public.platform_credit_balances%rowtype;
  v_after    public.platform_credit_balances%rowtype;
  v_new_balance bigint;
begin
  -- ₦2,000 promotional grant + ₦5,000 real top-up = ₦7,000 total.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'admin_grant',
    p_amount_kobo := 200000, p_description := 'pcl test grant'
  );
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 500000, p_description := 'pcl test topup'
  );
  select * into v_before from public.platform_credit_balances where patient_id = v_patient;

  if v_before.promo_balance_kobo <> 200000 or v_before.paid_balance_kobo <> 500000 then
    raise exception 'FAIL: fixture funding did not land in the expected buckets (promo=%, paid=%)',
      v_before.promo_balance_kobo, v_before.paid_balance_kobo;
  end if;

  -- Spend ₦3,000 — should take all ₦2,000 of promo, then ₦1,000 of paid.
  v_new_balance := private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'spend',
    p_amount_kobo := 300000, p_description := 'pcl test spend'
  );
  select * into v_after from public.platform_credit_balances where patient_id = v_patient;

  insert into pcl_result values
    ('spend consumes promo balance before paid balance', 'system',
     format('promo=%s paid=%s', v_after.promo_balance_kobo, v_after.paid_balance_kobo),
     'promo=0 paid=400000',
     case when v_after.promo_balance_kobo = 0 and v_after.paid_balance_kobo = 400000 then 'PASS' else 'FAIL' end);

  if v_after.promo_balance_kobo <> 0 or v_after.paid_balance_kobo <> 400000 then
    raise exception 'FAIL: spend did not consume promo before paid (promo=%, paid=%)',
      v_after.promo_balance_kobo, v_after.paid_balance_kobo;
  end if;
  if v_new_balance <> v_after.balance_kobo then
    raise exception 'FAIL: platform_credit_apply''s returned balance (%) does not match the stored one (%)',
      v_new_balance, v_after.balance_kobo;
  end if;

  -- A further spend larger than what's left must be refused, not partially applied.
  begin
    perform private.platform_credit_apply(
      p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'spend',
      p_amount_kobo := 999999999, p_description := 'pcl test overspend'
    );
    raise exception 'FAIL: an overspend beyond the balance was not refused';
  exception when sqlstate 'TH001' then
    null; -- expected
  end;

  select balance_kobo into v_new_balance from public.platform_credit_balances where patient_id = v_patient;
  if v_new_balance <> 400000 then
    raise exception 'FAIL: a refused overspend still changed the balance (now %)', v_new_balance;
  end if;
end $$;

-- ==========================================================================
-- 4. Sabotage — restore the old unconstrained grant and prove check 1 would
--    have caught it (a rolled-back-only proof would pass vacuously otherwise).
-- ==========================================================================
-- Two independent layers guard these tables — the table-level GRANT (check 1
-- above) and RLS having no INSERT-capable policy at all. Re-granting INSERT
-- alone (tried first, below) correctly still fails: RLS has no policy to
-- allow it, so the defence-in-depth is real, not just an artefact of one
-- missing grant. The genuine "old vulnerable shape" — the one
-- service_purchases actually had — is a grant PLUS a permissive policy;
-- restoring both is what should reopen the hole.
do $$
declare
  v_org     uuid := (select v from pcl_fixture where k = 'org');
  v_patient uuid := (select v from pcl_fixture where k = 'patient');
  v_third   uuid := (select v from pcl_fixture where k = 'third');
  v_grant_only text;
  v_write      text;
begin
  grant insert on public.platform_credit_balances to authenticated;

  -- patient_id is FK'd to profiles, so the forged row has to name a real
  -- profile — v_third has no balance row of its own, kept free for exactly
  -- this (a fresh target for both forged-insert attempts below, session
  -- identity itself stays v_patient throughout).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.platform_credit_balances (patient_id, organisation_id, paid_balance_kobo)
    values (v_third, v_org, 100000000);
    reset role;
    v_grant_only := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_grant_only := sqlstate;
  end;

  insert into pcl_result values
    ('defence-in-depth: GRANT alone (no policy) still refuses the insert', 'patient',
     v_grant_only, '42501', case when v_grant_only = '42501' then 'PASS' else 'FAIL' end);
  if v_grant_only <> '42501' then
    raise exception 'RLS alone did not hold once the table GRANT was restored (got %)', v_grant_only;
  end if;

  create policy pcl_sabotage_insert on public.platform_credit_balances
    for insert to authenticated with check (true);

  begin
    set local role authenticated;
    insert into public.platform_credit_balances (patient_id, organisation_id, paid_balance_kobo)
    values (v_third, v_org, 100000000);
    reset role;
    v_write := 'INSERT ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_write := sqlstate;
  end;

  drop policy pcl_sabotage_insert on public.platform_credit_balances;
  revoke insert on public.platform_credit_balances from authenticated;

  insert into pcl_result values
    ('sabotage: restoring GRANT + a permissive policy actually opens the hole', 'patient',
     v_write, 'INSERT ACCEPTED', case when v_write = 'INSERT ACCEPTED' then 'PASS (discriminates)' else 'FAIL (vacuous)' end);

  if v_write <> 'INSERT ACCEPTED' then
    raise exception 'The check-1 proof does not discriminate: sabotaging grant+policy did not reopen the hole (got %)', v_write;
  end if;
end $$;

-- ==========================================================================
-- 5. Fixtures for the booking-order RPCs: a pharmacy order and a specialist
--    referral, both for v_patient, both opening in 'pending_payment'.
-- ==========================================================================
-- specialist_referrals' create-gate (private.enforce_specialist_referral_create,
-- 20260829161238) demands private.is_clinical_tier(organisation_id) — so a
-- real clinical_staff fixture + an impersonated clinician session is needed
-- just to create the row, distinct from the patient session used to pay it.
-- The same clinical_staff row also lets the pharmacy order open as
-- 'clinically_triggered' (ordered_by = the clinician), which skips
-- private.enforce_pharmacy_order_origin's patient_initiated branch entirely
-- (that branch demands every item's drug_name match an active,
-- clinician-source public.medications row for this patient — a real
-- prescription fixture this test has no need to build) while still landing
-- in status='pending_payment', the same state a real patient-initiated
-- order opens in via 20260905000112_force_safe_patient_order_insert_defaults.sql.
do $$
declare
  v_org        uuid := (select v from pcl_fixture where k = 'org');
  v_patient    uuid := (select v from pcl_fixture where k = 'patient');
  v_clinician  uuid := gen_random_uuid();
  v_staff_id   uuid;
  v_pharmacy_order_id uuid;
  v_referral_id       uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clinician, 'pcl-clinician@example.invalid', 'x', now(), '{}', '{}');
  -- auth.users has an AFTER INSERT trigger that auto-provisions a profiles
  -- row (defaults to role='patient') — same reason the org's own patient
  -- fixture above needs ON CONFLICT DO UPDATE.
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_clinician, v_org, 'clinician', 'PCL Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at)
  values (v_org, v_clinician, 'PCL Clinician', true, 'medical_officer', now())
  returning id into v_staff_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician, 'role', 'authenticated')::text, true);

  insert into public.pharmacy_orders
    (organisation_id, patient_id, total_kobo, items, origin, ordered_by, status)
  values (v_org, v_patient, 150000, '[]'::jsonb, 'clinically_triggered', v_staff_id, 'pending_payment')
  returning id into v_pharmacy_order_id;

  if (select status from public.pharmacy_orders where id = v_pharmacy_order_id) <> 'pending_payment' then
    raise exception 'fixture setup FAIL: pharmacy order did not open pending_payment (got %)',
      (select status from public.pharmacy_orders where id = v_pharmacy_order_id);
  end if;

  -- fulfilment must be 'partner', not the default 'self_arranged' —
  -- private.enforce_referral_fulfilment (20260803142941) refuses a nonzero
  -- referral_fee_kobo on a self-arranged referral outright ("the patient
  -- pays the specialist directly"). 'partner' is the same value the
  -- internal-specialist auto-match reuses for a Tarragon-billed referral
  -- (see CLAUDE.md's specialist-referral auto-matching entry).
  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, status, referral_fee_kobo, fulfilment)
  values (v_org, v_patient, 'cardiology', 'pending_payment', 200000, 'partner')
  returning id into v_referral_id;

  if (select status from public.specialist_referrals where id = v_referral_id) <> 'pending_payment' then
    raise exception 'fixture setup FAIL: referral did not stay pending_payment (got %)',
      (select status from public.specialist_referrals where id = v_referral_id);
  end if;

  insert into pcl_fixture values
    ('clinician', v_clinician), ('clinical_staff_id', v_staff_id),
    ('pharmacy_order', v_pharmacy_order_id), ('referral', v_referral_id);
end $$;

-- ==========================================================================
-- 6. pay_pharmacy_order_on_platform_credit
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from pcl_fixture where k = 'org');
  v_patient  uuid := (select v from pcl_fixture where k = 'patient');
  v_other    uuid := (select v from pcl_fixture where k = 'other');
  v_order_id uuid := (select v from pcl_fixture where k = 'pharmacy_order');
  v_result       jsonb;
  v_cross_error  text;
  v_ledger_count_before int;
  v_ledger_count_after  int;
  v_balance_before bigint;
  v_second_order_id uuid;
  v_staff_id uuid := (select v from pcl_fixture where k = 'clinical_staff_id');
begin
  -- v_patient carries a real 400000-kobo balance left over from section 3's
  -- bucket-consumption proof — zero it here so (a) below genuinely tests a
  -- zero balance rather than accidentally having enough.
  update public.platform_credit_balances set paid_balance_kobo = 0, promo_balance_kobo = 0
    where patient_id = v_patient;

  -- (a) Insufficient balance (zero funded so far) is refused atomically:
  -- the order must not move, and no ledger row must appear.
  select count(*) into v_ledger_count_before from public.platform_credit_ledger_entries where patient_id = v_patient;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.pay_pharmacy_order_on_platform_credit(v_order_id) into v_result;
  reset role;

  select count(*) into v_ledger_count_after from public.platform_credit_ledger_entries where patient_id = v_patient;

  insert into pcl_result values
    ('pay_pharmacy_order_on_platform_credit refuses zero balance', 'patient',
     v_result ->> 'reason', 'insufficient_balance',
     case when (v_result ->> 'ok')::boolean is false and (v_result ->> 'reason') = 'insufficient_balance'
          then 'PASS' else 'FAIL' end);
  if (select status from public.pharmacy_orders where id = v_order_id) <> 'pending_payment' then
    raise exception 'FAIL: a refused pharmacy-order spend still changed the order status';
  end if;
  if v_ledger_count_after <> v_ledger_count_before then
    raise exception 'FAIL: a refused pharmacy-order spend still inserted a ledger row (no partial mutation expected)';
  end if;

  -- (b) Cross-patient isolation: v_other (not this order's patient, not
  -- staff) may not pay it, even with plenty of their own platform credit.
  perform private.platform_credit_apply(
    p_patient_id := v_other, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 100000000, p_description := 'pcl cross-patient bait funding'
  );

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.pay_pharmacy_order_on_platform_credit(v_order_id);
    reset role;
    v_cross_error := 'NO ERROR — SPEND WENT THROUGH';
  exception when others then
    begin reset role; exception when others then null; end;
    v_cross_error := sqlstate;
  end;

  insert into pcl_result values
    ('pay_pharmacy_order_on_platform_credit refuses a non-owning patient', 'other patient',
     v_cross_error, '42501', case when v_cross_error = '42501' then 'PASS' else 'FAIL' end);
  if v_cross_error <> '42501' then
    raise exception 'HOLE OPEN: a patient could pay for another patient''s pharmacy order via platform credit (got %)', v_cross_error;
  end if;
  if (select status from public.pharmacy_orders where id = v_order_id) <> 'pending_payment' then
    raise exception 'FAIL: the cross-patient attack attempt still changed the order status';
  end if;

  -- (c) Fund the real owner and pay for real.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 1000000, p_description := 'pcl pharmacy fixture funding'
  );
  select balance_kobo into v_balance_before from public.platform_credit_balances where patient_id = v_patient;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.pay_pharmacy_order_on_platform_credit(v_order_id) into v_result;
  reset role;

  insert into pcl_result values
    ('pay_pharmacy_order_on_platform_credit succeeds with sufficient balance', 'patient',
     v_result::text, 'ok=true', case when (v_result ->> 'ok')::boolean is true then 'PASS' else 'FAIL' end);
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'FAIL: pharmacy-order spend with sufficient balance should succeed, got %', v_result;
  end if;

  if (select status from public.pharmacy_orders where id = v_order_id) <> 'payment_confirmed' then
    raise exception 'FAIL: pharmacy_orders.status was not flipped to payment_confirmed';
  end if;
  if (select payment_provider from public.pharmacy_orders where id = v_order_id) <> 'platform_credit' then
    raise exception 'FAIL: pharmacy_orders.payment_provider was not stamped platform_credit';
  end if;
  if (select pending_payment_provider_ref from public.pharmacy_orders where id = v_order_id) is not null then
    raise exception 'FAIL: pharmacy_orders.pending_payment_provider_ref was not cleared';
  end if;

  if not exists (
    select 1 from public.platform_credit_ledger_entries
    where patient_id = v_patient and booking_order_id = v_order_id and booking_order_type = 'pharmacy'
      and id::text = (select payment_provider_ref from public.pharmacy_orders where id = v_order_id)
  ) then
    raise exception 'FAIL: no ledger entry with booking_order_id/booking_order_type set matches the order''s payment_provider_ref';
  end if;

  if (select balance_kobo from public.platform_credit_balances where patient_id = v_patient) >= v_balance_before then
    raise exception 'FAIL: balance did not decrease after the pharmacy-order spend';
  end if;

  -- (d) Paying an already-confirmed order again is refused, not double-spent.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.pay_pharmacy_order_on_platform_credit(v_order_id) into v_result;
  reset role;
  insert into pcl_result values
    ('pay_pharmacy_order_on_platform_credit refuses an already-paid order', 'patient',
     v_result ->> 'reason', 'not_payable',
     case when (v_result ->> 'ok')::boolean is false and (v_result ->> 'reason') = 'not_payable' then 'PASS' else 'FAIL' end);
  if (v_result ->> 'ok')::boolean is distinct from false or (v_result ->> 'reason') is distinct from 'not_payable' then
    raise exception 'FAIL: paying an already payment_confirmed pharmacy order again should be refused, got %', v_result;
  end if;

  -- (e) Atomic insufficient-balance refusal on a SECOND, fresh order — an
  -- overspend beyond what remains must leave that second order untouched
  -- and insert no ledger row, not partially apply anything.
  insert into public.pharmacy_orders
    (organisation_id, patient_id, total_kobo, items, origin, ordered_by, status)
  values (v_org, v_patient, 999999999, '[]'::jsonb, 'clinically_triggered', v_staff_id, 'pending_payment')
  returning id into v_second_order_id;

  select count(*) into v_ledger_count_before from public.platform_credit_ledger_entries where patient_id = v_patient;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.pay_pharmacy_order_on_platform_credit(v_second_order_id) into v_result;
  reset role;
  select count(*) into v_ledger_count_after from public.platform_credit_ledger_entries where patient_id = v_patient;

  insert into pcl_result values
    ('pay_pharmacy_order_on_platform_credit refuses an overspend atomically', 'patient',
     format('ok=%s reason=%s ledger_delta=%s', v_result ->> 'ok', v_result ->> 'reason', v_ledger_count_after - v_ledger_count_before),
     'ok=false reason=insufficient_balance ledger_delta=0',
     case when (v_result ->> 'ok')::boolean is false and (v_result ->> 'reason') = 'insufficient_balance'
               and v_ledger_count_after = v_ledger_count_before
          then 'PASS' else 'FAIL' end);
  if (select status from public.pharmacy_orders where id = v_second_order_id) <> 'pending_payment' then
    raise exception 'FAIL: an overspend attempt still changed the second pharmacy order''s status';
  end if;

  delete from public.pharmacy_orders where id = v_second_order_id;
end $$;

-- ==========================================================================
-- 7. pay_specialist_referral_on_platform_credit — same checks, retargeted.
-- ==========================================================================
do $$
declare
  v_org         uuid := (select v from pcl_fixture where k = 'org');
  v_patient     uuid := (select v from pcl_fixture where k = 'patient');
  v_other       uuid := (select v from pcl_fixture where k = 'other');
  v_referral_id uuid := (select v from pcl_fixture where k = 'referral');
  v_result      jsonb;
  v_cross_error text;
  v_balance_before bigint;
begin
  -- (a) v_other already holds real platform credit from section 6 — still
  -- must not be able to pay for v_patient's referral.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.pay_specialist_referral_on_platform_credit(v_referral_id);
    reset role;
    v_cross_error := 'NO ERROR — SPEND WENT THROUGH';
  exception when others then
    begin reset role; exception when others then null; end;
    v_cross_error := sqlstate;
  end;

  insert into pcl_result values
    ('pay_specialist_referral_on_platform_credit refuses a non-owning patient', 'other patient',
     v_cross_error, '42501', case when v_cross_error = '42501' then 'PASS' else 'FAIL' end);
  if v_cross_error <> '42501' then
    raise exception 'HOLE OPEN: a patient could pay for another patient''s referral via platform credit (got %)', v_cross_error;
  end if;
  if (select status from public.specialist_referrals where id = v_referral_id) <> 'pending_payment' then
    raise exception 'FAIL: the cross-patient attack attempt still changed the referral status';
  end if;

  -- (b) v_patient has no balance left for this specific referral fee yet
  -- (section 6 spent it down to a small remainder) — refuse atomically.
  update public.platform_credit_balances set paid_balance_kobo = 0, promo_balance_kobo = 0
    where patient_id = v_patient;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.pay_specialist_referral_on_platform_credit(v_referral_id) into v_result;
  reset role;

  insert into pcl_result values
    ('pay_specialist_referral_on_platform_credit refuses insufficient balance', 'patient',
     v_result ->> 'reason', 'insufficient_balance',
     case when (v_result ->> 'ok')::boolean is false and (v_result ->> 'reason') = 'insufficient_balance'
          then 'PASS' else 'FAIL' end);
  if (select status from public.specialist_referrals where id = v_referral_id) <> 'pending_payment' then
    raise exception 'FAIL: a refused referral spend still changed the referral status';
  end if;

  -- (c) Fund and pay for real.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 1000000, p_description := 'pcl referral fixture funding'
  );
  select balance_kobo into v_balance_before from public.platform_credit_balances where patient_id = v_patient;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.pay_specialist_referral_on_platform_credit(v_referral_id) into v_result;
  reset role;

  insert into pcl_result values
    ('pay_specialist_referral_on_platform_credit succeeds with sufficient balance', 'patient',
     v_result::text, 'ok=true', case when (v_result ->> 'ok')::boolean is true then 'PASS' else 'FAIL' end);
  if (v_result ->> 'ok')::boolean is distinct from true then
    raise exception 'FAIL: referral spend with sufficient balance should succeed, got %', v_result;
  end if;

  if (select status from public.specialist_referrals where id = v_referral_id) <> 'payment_confirmed' then
    raise exception 'FAIL: specialist_referrals.status was not flipped to payment_confirmed';
  end if;
  if (select payment_provider from public.specialist_referrals where id = v_referral_id) <> 'platform_credit' then
    raise exception 'FAIL: specialist_referrals.payment_provider was not stamped platform_credit';
  end if;

  if not exists (
    select 1 from public.platform_credit_ledger_entries
    where patient_id = v_patient and booking_order_id = v_referral_id and booking_order_type = 'referral'
      and id::text = (select payment_provider_ref from public.specialist_referrals where id = v_referral_id)
  ) then
    raise exception 'FAIL: no ledger entry with booking_order_id/booking_order_type set matches the referral''s payment_provider_ref';
  end if;

  if (select balance_kobo from public.platform_credit_balances where patient_id = v_patient) >= v_balance_before then
    raise exception 'FAIL: balance did not decrease after the referral spend';
  end if;

  -- (d) Already-paid referral cannot be paid again.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.pay_specialist_referral_on_platform_credit(v_referral_id) into v_result;
  reset role;
  insert into pcl_result values
    ('pay_specialist_referral_on_platform_credit refuses an already-paid referral', 'patient',
     v_result ->> 'reason', 'not_payable',
     case when (v_result ->> 'ok')::boolean is false and (v_result ->> 'reason') = 'not_payable' then 'PASS' else 'FAIL' end);
  if (v_result ->> 'ok')::boolean is distinct from false or (v_result ->> 'reason') is distinct from 'not_payable' then
    raise exception 'FAIL: paying an already payment_confirmed referral again should be refused, got %', v_result;
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
select * from pcl_result order by check_name;

do $$
declare
  v_fails int;
begin
  select count(*) into v_fails from pcl_result where verdict not like 'PASS%';
  if v_fails > 0 then
    raise exception '% check(s) failed — see the result table above', v_fails;
  end if;
  raise notice 'PASS: platform credit RLS + bucket-consumption verification, all % checks green', (select count(*) from pcl_result);
end $$;

rollback;
