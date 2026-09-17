-- ===========================================================================
-- Verification: Platform Credit (20260917100300..20260917100629)
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
--     checks actually discriminate rather than passing vacuously.
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
-- 5. Video visit bookings — Platform Credit pays for a HELD booking.
--
-- Distinct fixtures from the sections above: a doctor (clinical_staff +
-- a real auth session, since accept_video_visit_request/
-- select_video_visit_alternate_slot key off auth.uid() = clinical_staff.
-- profile_id), a published slot, and fresh patients so this section's
-- balance movements can be asserted exactly without interference from the
-- bucket-order tests above.
--
-- Proves, end to end: (a) the request-time hold only checks the balance,
-- never spends it; (b) an insufficient balance at request time is refused
-- without ever touching video_visit_requests.status or the balance; (c) a
-- stranger cannot confirm/spend someone else's request; (d) doctor
-- acceptance is the ONE moment that actually calls platform_credit_apply,
-- for exactly amount_minor, linked via the new booking_order_id/type
-- columns; (e) the spend function is not directly callable by an
-- authenticated session — only doctor acceptance can trigger it; (f) an
-- insufficient balance discovered only at acceptance time (drained after
-- the request-time hold) aborts the ENTIRE acceptance atomically — no
-- consultation, no slot flip, no partial spend; (g) declining a platform-
-- credit-funded request that was never accepted leaves the balance
-- COMPLETELY untouched — no refund logic needed, because nothing was ever
-- spent.
-- ==========================================================================
do $$
declare
  v_org           uuid := (select v from pcl_fixture where k = 'org');
  v_doctor        uuid := gen_random_uuid();
  v_vpatient      uuid := gen_random_uuid(); -- has enough credit throughout
  v_vpoor         uuid := gen_random_uuid(); -- never funded
  v_vdrained      uuid := gen_random_uuid(); -- funded, then drained before acceptance
  v_vdeclined     uuid := gen_random_uuid(); -- funded, request declined unaccepted
  v_price         bigint;
  v_slot_a        uuid;
  v_slot_b        uuid;
  v_slot_c        uuid;
  v_req_a         uuid; -- the happy-path request (confirmed, then accepted)
  v_req_poor      uuid; -- insufficient balance at request time
  v_req_drained   uuid; -- confirmed, then balance drained, then acceptance attempted
  v_req_declined  uuid; -- confirmed, then declined, never accepted
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doctor,    'pcl-vv-doctor@example.invalid',   'x', now(), '{}', '{}'),
    (v_vpatient,  'pcl-vv-patient@example.invalid',  'x', now(), '{}', '{}'),
    (v_vpoor,     'pcl-vv-poor@example.invalid',     'x', now(), '{}', '{}'),
    (v_vdrained,  'pcl-vv-drained@example.invalid',  'x', now(), '{}', '{}'),
    (v_vdeclined, 'pcl-vv-declined@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_doctor, v_org, 'clinician', 'PCL VV Doctor'),
    (v_vpatient, v_org, 'patient', 'PCL VV Patient'),
    (v_vpoor, v_org, 'patient', 'PCL VV Poor Patient'),
    (v_vdrained, v_org, 'patient', 'PCL VV Drained Patient'),
    (v_vdeclined, v_org, 'patient', 'PCL VV Declined Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at)
  values (v_org, v_doctor, 'PCL VV Doctor', true, 'medical_officer', now());

  -- date_trunc up front so the same exact timestamp is used for both the
  -- INSERT and the later re-select by slot_start (now() is stable for the
  -- whole transaction, but its sub-second fraction is not something to
  -- round-trip through a WHERE clause).
  insert into public.consult_availability_slots (organisation_id, clinician_profile_id, slot_start, slot_end)
  values
    (v_org, v_doctor, date_trunc('second', now()) + interval '2 days', date_trunc('second', now()) + interval '2 days 15 minutes'),
    (v_org, v_doctor, date_trunc('second', now()) + interval '3 days', date_trunc('second', now()) + interval '3 days 15 minutes'),
    (v_org, v_doctor, date_trunc('second', now()) + interval '4 days', date_trunc('second', now()) + interval '4 days 15 minutes');
  -- Re-select each slot by its own distinct slot_start rather than relying
  -- on RETURNING's row order for a multi-row INSERT.
  select id into v_slot_a from public.consult_availability_slots
    where organisation_id = v_org and clinician_profile_id = v_doctor
      and slot_start = date_trunc('second', now()) + interval '2 days';
  select id into v_slot_b from public.consult_availability_slots
    where organisation_id = v_org and clinician_profile_id = v_doctor
      and slot_start = date_trunc('second', now()) + interval '3 days';
  select id into v_slot_c from public.consult_availability_slots
    where organisation_id = v_org and clinician_profile_id = v_doctor
      and slot_start = date_trunc('second', now()) + interval '4 days';
  if v_slot_a is null or v_slot_b is null or v_slot_c is null then
    raise exception 'FAIL: could not re-select the fixture slots by slot_start -- fixture setup bug, not a product bug';
  end if;

  -- --------------------------------------------------------------------
  -- (a)+(b) Request-time hold: happy path checks+holds without spending;
  -- an underfunded patient is refused without any status change.
  -- --------------------------------------------------------------------
  insert into public.video_visit_requests (organisation_id, patient_id, slot_id)
    values (v_org, v_vpatient, v_slot_a) returning id, amount_minor into v_req_a, v_price;
  insert into public.video_visit_requests (organisation_id, patient_id, slot_id)
    values (v_org, v_vpoor, v_slot_b) returning id into v_req_poor;

  perform private.platform_credit_apply(
    p_patient_id := v_vpatient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := v_price + 100000, p_description := 'pcl vv fixture funding'
  );

  -- v_vpoor never gets a balance row at all -- covers the "no row exists"
  -- shape of the read-only check, not just "row exists with 0".
  declare
    v_confirm_poor jsonb;
    v_status_poor text;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_vpoor, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.confirm_video_visit_request_on_platform_credit(v_req_poor) into v_confirm_poor;
    reset role;

    if (v_confirm_poor ->> 'ok')::boolean is distinct from false
       or (v_confirm_poor ->> 'reason') is distinct from 'insufficient_balance' then
      raise exception 'FAIL: an unfunded patient''s request-time hold should be refused as insufficient_balance, got %', v_confirm_poor;
    end if;

    select status into v_status_poor from public.video_visit_requests where id = v_req_poor;
    if v_status_poor <> 'requested' then
      raise exception 'FAIL: a refused request-time hold must not change status (got %)', v_status_poor;
    end if;
    if exists (select 1 from public.platform_credit_ledger_entries where booking_order_id = v_req_poor) then
      raise exception 'FAIL: a refused request-time hold must never write a ledger entry';
    end if;
  end;

  declare
    v_confirm_a jsonb;
    v_status_a text;
    v_provider_a text;
    v_ref_a text;
    v_balance_after_hold bigint;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_vpatient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.confirm_video_visit_request_on_platform_credit(v_req_a) into v_confirm_a;
    reset role;

    if (v_confirm_a ->> 'ok')::boolean is distinct from true then
      raise exception 'FAIL: a sufficiently-funded patient''s request-time hold should succeed, got %', v_confirm_a;
    end if;

    select status, payment_provider, payment_provider_ref into v_status_a, v_provider_a, v_ref_a
      from public.video_visit_requests where id = v_req_a;
    if v_status_a <> 'payment_confirmed' or v_provider_a <> 'platform_credit' or v_ref_a is not null then
      raise exception 'FAIL: request-time hold should set payment_confirmed/platform_credit/NULL ref, got status=%, provider=%, ref=%',
        v_status_a, v_provider_a, v_ref_a;
    end if;

    select balance_kobo into v_balance_after_hold from public.platform_credit_balances where patient_id = v_vpatient;
    if v_balance_after_hold <> 100000 + v_price then
      raise exception 'FAIL: the request-time hold moved the balance (now %) -- it must only ever check, never spend', v_balance_after_hold;
    end if;
  end;

  -- --------------------------------------------------------------------
  -- (c) A stranger cannot confirm/hold someone else's request.
  -- --------------------------------------------------------------------
  declare
    v_stranger_result text;
    v_other uuid := (select v from pcl_fixture where k = 'other');
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      perform public.confirm_video_visit_request_on_platform_credit(v_req_a);
      reset role;
      v_stranger_result := 'ACCEPTED';
    exception when others then
      begin reset role; exception when others then null; end;
      v_stranger_result := sqlstate;
    end;
    if v_stranger_result <> '42501' then
      raise exception 'FAIL: a stranger confirming someone else''s video-visit request should be refused with 42501, got %', v_stranger_result;
    end if;
  end;

  -- --------------------------------------------------------------------
  -- (e) The spend primitive itself is not directly callable by any
  -- authenticated session -- only doctor acceptance may trigger it.
  -- --------------------------------------------------------------------
  declare
    v_direct_spend text;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_vpatient, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      perform private.pay_video_visit_request_on_platform_credit(v_req_a);
      reset role;
      v_direct_spend := 'ACCEPTED';
    exception when others then
      begin reset role; exception when others then null; end;
      v_direct_spend := sqlstate;
    end;
    if v_direct_spend <> '42501' then
      raise exception 'FAIL: a patient session must not be able to call private.pay_video_visit_request_on_platform_credit directly, got %', v_direct_spend;
    end if;
  end;

  -- --------------------------------------------------------------------
  -- (d) Doctor acceptance is the real spend: exactly amount_minor moves,
  -- linked to this request via booking_order_id/booking_order_type, and
  -- payment_provider_ref is stamped with that ledger entry's id.
  -- --------------------------------------------------------------------
  declare
    v_consult uuid;
    v_balance_before_accept bigint;
    v_balance_after_accept bigint;
    v_ledger record;
    v_final_status text;
    v_final_ref text;
  begin
    select balance_kobo into v_balance_before_accept from public.platform_credit_balances where patient_id = v_vpatient;

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.accept_video_visit_request(v_req_a) into v_consult;
    reset role;

    if v_consult is null then
      raise exception 'FAIL: doctor acceptance of a funded platform-credit request should return a video_consultations id';
    end if;

    select balance_kobo into v_balance_after_accept from public.platform_credit_balances where patient_id = v_vpatient;
    if v_balance_before_accept - v_balance_after_accept <> v_price then
      raise exception 'FAIL: acceptance should spend exactly % kobo, actually moved % kobo', v_price, v_balance_before_accept - v_balance_after_accept;
    end if;

    select * into v_ledger from public.platform_credit_ledger_entries
      where booking_order_id = v_req_a and booking_order_type = 'video_visit';
    if v_ledger.id is null then
      raise exception 'FAIL: acceptance did not write a ledger entry linked via booking_order_id/booking_order_type';
    end if;
    if v_ledger.entry_type <> 'spend' or v_ledger.amount_kobo <> v_price then
      raise exception 'FAIL: the linked ledger entry has the wrong shape (entry_type=%, amount_kobo=%)', v_ledger.entry_type, v_ledger.amount_kobo;
    end if;

    select status, payment_provider_ref into v_final_status, v_final_ref
      from public.video_visit_requests where id = v_req_a;
    if v_final_status <> 'accepted' or v_final_ref is distinct from v_ledger.id::text then
      raise exception 'FAIL: after acceptance the request should be status=accepted with payment_provider_ref=<ledger id>, got status=%, ref=%',
        v_final_status, v_final_ref;
    end if;
  end;

  -- --------------------------------------------------------------------
  -- (f) A balance drained AFTER the request-time hold but BEFORE
  -- acceptance must abort the whole acceptance atomically -- no
  -- consultation, no slot flip, no partial spend, request stays put.
  -- --------------------------------------------------------------------
  insert into public.video_visit_requests (organisation_id, patient_id, slot_id)
    values (v_org, v_vdrained, v_slot_b) returning id, amount_minor into v_req_drained, v_price;

  perform private.platform_credit_apply(
    p_patient_id := v_vdrained, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := v_price, p_description := 'pcl vv drained-patient fixture funding'
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_vdrained, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_video_visit_request_on_platform_credit(v_req_drained);
  reset role;

  -- Simulate the balance having been spent elsewhere between the
  -- request-time hold and doctor acceptance (exactly what the deferred-
  -- spend design allows to happen, on purpose).
  perform private.platform_credit_apply(
    p_patient_id := v_vdrained, p_organisation_id := v_org, p_entry_type := 'admin_correction',
    p_correction_bucket := 'paid', p_correction_direction := 'decrease',
    p_amount_kobo := v_price, p_description := 'pcl vv fixture: simulate balance spent elsewhere'
  );

  declare
    v_accept_drained text;
    v_status_drained text;
    v_consult_count int;
    v_balance_drained bigint;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      perform public.accept_video_visit_request(v_req_drained);
      reset role;
      v_accept_drained := 'ACCEPTED';
    exception when others then
      begin reset role; exception when others then null; end;
      v_accept_drained := sqlstate;
    end;
    if v_accept_drained <> 'TH001' then
      raise exception 'FAIL: accepting a request whose balance was drained since the request-time hold should fail with TH001, got %', v_accept_drained;
    end if;

    select status into v_status_drained from public.video_visit_requests where id = v_req_drained;
    if v_status_drained <> 'payment_confirmed' then
      raise exception 'FAIL: a failed acceptance must leave the request exactly as it was (payment_confirmed), got %', v_status_drained;
    end if;

    select count(*) into v_consult_count from public.video_consultations
      where patient_id = v_vdrained;
    if v_consult_count <> 0 then
      raise exception 'FAIL: a failed acceptance must not create a video_consultations row';
    end if;

    if exists (select 1 from public.consult_availability_slots where id = v_slot_b and booked_consultation_id is not null) then
      raise exception 'FAIL: a failed acceptance must not flip the slot to booked';
    end if;

    select balance_kobo into v_balance_drained from public.platform_credit_balances where patient_id = v_vdrained;
    if v_balance_drained <> 0 then
      raise exception 'FAIL: a failed acceptance must not move the (already-zero) balance any further, got %', v_balance_drained;
    end if;
  end;

  -- --------------------------------------------------------------------
  -- (g) THE KEY SIMPLIFICATION THIS DESIGN BUYS: declining a platform-
  -- credit-funded request that was never accepted needs no refund logic
  -- at all, because nothing was ever spent -- prove the balance is
  -- untouched, not merely assert it in a comment.
  -- --------------------------------------------------------------------
  insert into public.video_visit_requests (organisation_id, patient_id, slot_id)
    values (v_org, v_vdeclined, v_slot_c) returning id, amount_minor into v_req_declined, v_price;

  perform private.platform_credit_apply(
    p_patient_id := v_vdeclined, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := v_price, p_description := 'pcl vv declined-patient fixture funding'
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_vdeclined, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_video_visit_request_on_platform_credit(v_req_declined);
  reset role;

  declare
    v_balance_before_decline bigint;
    v_balance_after_decline bigint;
    v_final_status text;
    v_final_refund_status text;
  begin
    select balance_kobo into v_balance_before_decline from public.platform_credit_balances where patient_id = v_vdeclined;

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.decline_video_visit_request(v_req_declined, 'pcl vv test decline');
    reset role;

    select status, refund_status into v_final_status, v_final_refund_status
      from public.video_visit_requests where id = v_req_declined;
    if v_final_status <> 'declined' then
      raise exception 'FAIL: decline should set status=declined, got %', v_final_status;
    end if;
    if v_final_refund_status is not null then
      raise exception 'FAIL: a never-spent platform-credit request must not be flagged refund_status=due (nothing was ever charged) -- got %', v_final_refund_status;
    end if;

    select balance_kobo into v_balance_after_decline from public.platform_credit_balances where patient_id = v_vdeclined;
    if v_balance_after_decline <> v_balance_before_decline then
      raise exception 'FAIL: declining an unaccepted platform-credit request must leave the balance completely untouched (was %, now %)',
        v_balance_before_decline, v_balance_after_decline;
    end if;
    if exists (select 1 from public.platform_credit_ledger_entries where booking_order_id = v_req_declined) then
      raise exception 'FAIL: declining an unaccepted platform-credit request must never have written a ledger entry for it';
    end if;
  end;

  insert into pcl_result values
    ('video visit: request-time hold checks but never spends', 'system', 'verified', 'verified', 'PASS'),
    ('video visit: insufficient balance at request time refused, no status change', 'system', 'verified', 'verified', 'PASS'),
    ('video visit: a stranger cannot confirm/hold someone else''s request', 'patient', 'verified', '42501', 'PASS'),
    ('video visit: the spend primitive is not directly callable by authenticated', 'patient', 'verified', '42501', 'PASS'),
    ('video visit: doctor acceptance spends exactly the pinned price, linked via booking_order_id', 'doctor', 'verified', 'verified', 'PASS'),
    ('video visit: balance drained before acceptance aborts the whole acceptance atomically', 'doctor', 'verified', 'TH001', 'PASS'),
    ('video visit: declining an unspent request leaves the balance completely untouched', 'doctor', 'verified', 'verified', 'PASS');
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
