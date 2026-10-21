-- Money reconciliation screen proof (migration *_money_reconciliation_screen.sql).
-- One rolled-back transaction. Proves:
--   1. Every mismatch kind is REPORTED for a row seeded to have exactly that fault (29 kinds, orders/payments/entitlements,
--      the general ledger, refunds, consultation-share reversals, payouts).
--   2. A CLEAN control set (an order paid, entitled, journalled; a refund completed with its cash entry, release and reversal; a payout
--      whose lines, transfer and ledger entry agree) is reported under NO kind.
--   3. Thresholds: a refund processing for less than the stuck window and an order paid inside the grace window are not reported.
--   4. Test rows are left out unless asked for; a test order is never expected in the ledger.
--   5. Access: finance and admin may call the screen; a patient and a signed-out caller are refused (the error is raised, never an empty list).
--   6. Read-only: the functions are STABLE and no table changed by calling them.
--   7. SABOTAGE: the detector emptied (every report flips to absent) and the finance gate removed (a patient is let in). Each must flip.
-- Fixtures are written with triggers off (session_replication_role = replica) so rows can be put in exactly the wrong state; the
-- checks themselves run with triggers on again.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'mrs-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'MRS ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

-- Does the detector report this kind for this subject? (Windows: the live refund policy for stuck-while-sending, 1440 minutes for decided-not-sent, 15 minute grace.)
create function pg_temp.seen(p_kind text, p_subject uuid, p_test boolean default true) returns text language sql as
$$ select case when exists (select 1 from private.money_mismatches(p_test, 1440, 15) m where m.kind = p_kind and m.subject_id = p_subject) then 'reported' else 'absent' end $$;
create function pg_temp.seen_any(p_subject uuid) returns text language sql as
$$ select coalesce((select string_agg(distinct m.kind, ',') from private.money_mismatches(true, 1440, 15) m where m.subject_id = p_subject or m.related_id = p_subject), 'none') $$;
create function pg_temp.delta(p_kind text, p_subject uuid) returns text language sql as
$$ select coalesce((select m.delta_kobo::text from private.money_mismatches(true, 1440, 15) m where m.kind = p_kind and m.subject_id = p_subject limit 1), 'none') $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Fixtures (triggers off)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := gen_random_uuid();
  v_fin uuid; v_adm uuid; v_pat uuid; v_doc uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid(); v_fee uuid := gen_random_uuid(); v_cfg uuid := gen_random_uuid();
  o uuid; r uuid; p uuid; e uuid; l uuid; je uuid; pt uuid; enc uuid; t uuid;
  v_ref text;
begin
  set local session_replication_role = replica;

  select id into v_org from public.organisations limit 1;
  if v_org is null then v_org := gen_random_uuid(); end if;
  v_fin := pg_temp.mkuser(v_org, 'finance', 'finance');
  v_adm := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  perform pg_temp.setf('fin', v_fin); perform pg_temp.setf('adm', v_adm); perform pg_temp.setf('pat', v_pat);

  insert into public.feature_flags (key, label, status) values ('payout_gl_posting', 'Payout ledger posting', 'on') on conflict (key) do update set status = 'on';

  -- helpers inline: order(state, amount, paid hours ago, test) returns id
  -- ===== A. CLEAN CONTROL: paid, paid-for, entitled, journalled =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test)
  values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test)
  values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'clean');
  perform pg_temp.setf('clean_order', o);

  -- ===== B. paid, no entitlement =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'b');
  perform pg_temp.setf('b_order', o);

  -- ===== B2. paid 5 minutes ago, no entitlement yet: inside the grace window, NOT reported =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '5 minutes', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  perform pg_temp.setf('grace_order', o);

  -- ===== C. entitlement on a cancelled order =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, cancelled_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'cancelled', now(), v_ref, false);
  e := gen_random_uuid();
  insert into public.entitlements (id, organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test)
  values (e, v_org, v_pat, o, 'care_pack', now() - interval '1 day', now() + interval '80 days', 3, 'active', false);
  perform pg_temp.setf('c_ent', e);

  -- ===== D. refunded order, entitlement still active =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test, updated_at)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '3 days', v_ref, false, now() - interval '2 days');
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  e := gen_random_uuid();
  insert into public.entitlements (id, organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test)
  values (e, v_org, v_pat, o, 'care_pack', now() - interval '3 days', now() + interval '80 days', 3, 'active', false);
  perform pg_temp.setf('d_ent', e);

  -- ===== E. paid, no payment row =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'e');
  perform pg_temp.setf('e_order', o);

  -- ===== F. payment 400000 against an order of 500000 =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  p := gen_random_uuid();
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (p, v_org, o, 'paystack', v_ref, 400000, 0, 400000, 'success', 'return', false);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'f');
  perform pg_temp.setf('f_pay', p);

  -- ===== G. payment total is not amount + fee =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 1000, 501000, 'paid', now() - interval '2 days', v_ref, false);
  p := gen_random_uuid();
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (p, v_org, o, 'paystack', v_ref, 500000, 1000, 500000, 'success', 'return', false);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'g');
  perform pg_temp.setf('g_pay', p);

  -- ===== H. successful payment on an order still 'created' =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'created', v_ref, false);
  p := gen_random_uuid();
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test, created_at) values (p, v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false, now() - interval '1 day');
  perform pg_temp.setf('h_pay', p);

  -- ===== I. a recorded mismatch payment on an unpaid order =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'created', v_ref, false);
  p := gen_random_uuid();
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, mismatch_reason, source, is_test) values (p, v_org, o, 'paystack', v_ref, 450000, 0, 450000, 'mismatch', 'amount', 'webhook', false);
  perform pg_temp.setf('i_pay', p);

  -- ===== J. paid, no ledger entry (real order) and J2 the same for a TEST order (never expected in the ledger) =====
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', false);
  perform pg_temp.setf('j_order', o);
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, true);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', true);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', true);
  perform pg_temp.setf('j2_test_order', o);

  -- ===== K. refunds. A base paid order for each =====
  -- K1 processing for 3 hours (reported), K1b processing for 30 minutes (inside the window, not reported)
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '3 days', v_ref, false);
  r := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, processing_started_at, is_test) values (r, v_org, o, 500000, 'Stuck refund fixture', 'processing', 'paystack', now() - interval '3 hours', false);
  perform pg_temp.setf('k1_refund', r);
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '3 days', v_ref, false);
  r := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, processing_started_at, is_test) values (r, v_org, o, 500000, 'Fresh refund fixture', 'processing', 'paystack', now() - interval '30 minutes', false);
  perform pg_temp.setf('k1b_refund', r);

  -- K2 completed, Paystack reconcile says mismatch; has cash entry and release so ONLY the Paystack kind applies
  -- K3 completed a day ago with NO cash entry and NO release stamp (two kinds)
  -- K4 CLEAN completed refund: cash entry exists, release stamped
  declare k text; v_stamp timestamptz; v_prov text;
  begin
    foreach k in array array['k2','k3','k4'] loop
      o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
      insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
      values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '4 days', v_ref, false);
      insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
      insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'kpay');
      r := gen_random_uuid();
      v_stamp := case k when 'k3' then null else now() - interval '1 day' end;
      v_prov := case k when 'k2' then 'mismatch' else 'matched' end;
      insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, completed_at, gl_released_at, provider_status, provider_checked_at, is_test)
      values (r, v_org, o, 500000, 'Completed refund fixture ' || k, 'completed', 'paystack', now() - interval '1 day', v_stamp, v_prov, now(), false);
      if k <> 'k3' then
        pt := gen_random_uuid();
        insert into public.payment_transactions (id, provider, provider_event_id, event_type, amount_minor, currency, processed_at, raw_payload)
        values (pt, 'paystack', 'refund:' || v_ref || ':500000', 'refund.processed', 500000, 'NGN', now(), '{}');
        insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'refund', pt::text, 'cash back ' || k);
      end if;
      perform pg_temp.setf(k || '_refund', r);
    end loop;
  end;

  -- K5 a deferred-revenue release posted for a refund that is only 'approved'
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '3 days', v_ref, false);
  r := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, decided_by, decided_at, is_test) values (r, v_org, o, 500000, 'Approved only fixture', 'approved', 'paystack', v_adm, now(), false);
  je := gen_random_uuid();
  insert into public.finance_journal_entries (id, entry_date, period_month, source, source_ref, memo) values (je, current_date, date_trunc('month', current_date)::date, 'adjustment', 'refund_deferred_release:' || r, 'early release');
  insert into public.finance_journal_lines (entry_id, line_no, account_code, debit_minor, credit_minor, organisation_id) values (je, 1, '2000', 120000, 0, v_org), (je, 2, '4900', 0, 120000, v_org);
  perform pg_temp.setf('k5_refund', r);

  -- K6 an earnings reversal for a refund that is only 'approved'
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '3 days', v_ref, false);
  r := gen_random_uuid(); l := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, decided_by, decided_at, is_test) values (r, v_org, o, 500000, 'Approved only fixture 2', 'approved', 'paystack', v_adm, now(), false);
  insert into public.earnings_ledger (id, organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, calculation, earned_at, employment_type, note, created_by, is_test)
  values (l, v_org, v_doc, 'adjustment', 'refund_reversal', gen_random_uuid(), -100000, jsonb_build_object('refund_id', r, 'corrects', gen_random_uuid()), now(), 'contracted', 'Reversal fixture for an approved refund', v_adm, false);
  perform pg_temp.setf('k6_line', l);

  -- ===== L. consultation shares behind a refunded order =====
  -- L1 full refund, share 100000, NOT reversed (reported, delta 100000)
  -- L2 full refund, share 100000, reversed -100000 (clean)
  -- L3 part refund 250000 of 500000, share 100000, reversed -50000 (clean: pro rata)
  -- L4 part refund 250000 of 500000, share 100000, reversed -20000 (reported, delta 30000)
  declare k text; v_ref_amt bigint; v_rev bigint;
  begin
    foreach k in array array['l1','l2','l3','l4'] loop
      v_ref_amt := case when k in ('l3','l4') then 250000 else 500000 end;
      v_rev := case k when 'l1' then 0 when 'l2' then 100000 when 'l3' then 50000 else 20000 end;
      o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
      insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
      values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '4 days', v_ref, false);
      r := gen_random_uuid(); enc := gen_random_uuid(); l := gen_random_uuid();
      insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, completed_at, gl_released_at, provider_status, provider_checked_at, is_test)
      values (r, v_org, o, v_ref_amt, 'Share reversal fixture ' || k, 'completed', 'paystack', now() - interval '1 day', now() - interval '1 day', 'matched', now(), false);
      pt := gen_random_uuid();
      insert into public.payment_transactions (id, provider, provider_event_id, event_type, amount_minor, currency, processed_at, raw_payload)
      values (pt, 'paystack', 'refund:' || v_ref || ':' || v_ref_amt, 'refund.processed', v_ref_amt, 'NGN', now(), '{}');
      insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
      insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'refund', pt::text, 'cash back ' || k);
      insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'lpay');
      insert into public.order_encounter_links (encounter_id, order_id) values (enc, o);
      insert into public.earnings_ledger (id, organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, fee_schedule_version_id, calculation, earned_at, employment_type, is_test, created_at)
      values (l, v_org, v_doc, 'consultation', 'encounter', enc, 100000, v_fee, '{}', now() - interval '2 days', 'contracted', false, now() - interval '2 days');
      if v_rev > 0 then
        insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, calculation, earned_at, employment_type, note, created_by, is_test)
        values (v_org, v_doc, 'adjustment', 'refund_reversal', gen_random_uuid(), -v_rev, jsonb_build_object('refund_id', r, 'corrects', l), now(), 'contracted', 'Reversal fixture ' || k, v_adm, false);
      end if;
      perform pg_temp.setf(k || '_line', l);
    end loop;
  end;

  -- ===== P. payouts =====
  -- P1 clean: lines 200000+100000 = 300000 over 2, transfer success, ledger entry debit 300000
  -- P2 total differs: says 300000, lines add to 250000
  -- P3 succeeded, transfer success, no ledger posting at all
  -- P4 a failed ledger posting
  -- P5 ledger entry debit 200000 against a 300000 posting
  -- P6 transfer reversed after success, no reversing entry
  -- P7 succeeded with only a failed transfer
  declare k text; v_pay uuid; v_amt bigint; v_tstate text; v_post text; v_dr bigint; v_lines bigint; v_n int;
  begin
    insert into public.payouts_config (id, version, is_active, effective_from, rules) values (v_cfg, 900000000 + (random() * 1000000)::int, false, current_date, '{}');
    foreach k in array array['p1','p2','p3','p4','p5','p6','p7'] loop
      v_pay := gen_random_uuid();
      v_lines := case k when 'p2' then 250000 else 300000 end;
      v_tstate := case k when 'p6' then 'reversed' when 'p7' then 'failed' else 'success' end;
      insert into public.payouts (id, organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, state, approved_by, approved_at, recipient_code, payouts_config_id, is_test, updated_at)
      values (v_pay, v_org, gen_random_uuid(), current_date - 7, current_date - 1, 300000, 2, 'succeeded', v_adm, now() - interval '2 days', 'RCP_fixture', v_cfg, false, now() - interval '1 day');
      insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, fee_schedule_version_id, calculation, earned_at, employment_type, payout_id, is_test)
      select v_org, (select clinician_id from public.payouts where id = v_pay), 'task', 'task', gen_random_uuid(), x.a, v_fee, '{}', now() - interval '9 days', 'contracted', v_pay, false
        from (values (case when k = 'p2' then 150000::bigint else 200000::bigint end), (100000::bigint)) x(a);
      insert into public.payout_transfers (payout_id, attempt, reference, state, updated_at) values (v_pay, 1, 'tpo-' || replace(v_pay::text, '-', '') || '-01', v_tstate, now() - interval '1 day');
      if k in ('p1','p5','p6') then
        v_dr := case k when 'p5' then 200000 else 300000 end;
        je := gen_random_uuid();
        insert into public.finance_journal_entries (id, entry_date, period_month, source, source_ref, memo) values (je, current_date, date_trunc('month', current_date)::date, 'payout', 'payout:' || v_pay || ':1:sent', 'sent');
        insert into public.finance_journal_lines (entry_id, line_no, account_code, debit_minor, credit_minor, organisation_id) values (je, 1, '5200', v_dr, 0, v_org), (je, 2, '1000', 0, v_dr, v_org);
        insert into public.payout_gl_postings (payout_id, attempt, kind, status, amount_kobo, journal_entry_id) values (v_pay, 1, 'sent', 'posted', 300000, je);
      elsif k = 'p4' then
        insert into public.payout_gl_postings (payout_id, attempt, kind, status, amount_kobo, error) values (v_pay, 1, 'sent', 'failed', 300000, 'closed period');
      end if;
      perform pg_temp.setf(k, v_pay);
    end loop;
  end;

  -- ===== M. extra controls and kinds added after review =====
  -- M1 fully sponsor-covered order: amount 0, sponsor share 500000, no Paystack payment row by design, journalled, entitled (clean)
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, sponsor_share_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 0, 500000, 0, 0, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'sponsor');
  perform pg_temp.setf('m1_sponsor_order', o);
  -- M1b the same sponsor order with NO ledger entry: reported, and the missing amount is the sponsor share
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, sponsor_share_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 0, 500000, 0, 0, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'care_pack', now() - interval '2 days', now() + interval '80 days', 3, 'active', false);
  perform pg_temp.setf('m1b_sponsor_order', o);
  -- M2 completed refund on an order that never reached the ledger as a payment (cash entry exists)
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'refunded', now() - interval '4 days', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  r := gen_random_uuid(); pt := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, completed_at, gl_released_at, provider_status, provider_checked_at, is_test)
  values (r, v_org, o, 500000, 'Never journalled fixture', 'completed', 'paystack', now() - interval '1 day', now() - interval '1 day', 'matched', now(), false);
  insert into public.payment_transactions (id, provider, provider_event_id, event_type, amount_minor, currency, processed_at, raw_payload) values (pt, 'paystack', 'refund:' || v_ref || ':500000', 'refund.processed', 500000, 'NGN', now(), '{}');
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'refund', pt::text, 'cash back m2');
  perform pg_temp.setf('m2_refund', r);
  -- M3 approved refund, order already refunded, three days with no money back
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paid_at, paystack_reference, is_test, updated_at)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'refunded', now() - interval '5 days', v_ref, false, now() - interval '3 days');
  r := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, decided_by, decided_at, is_test, created_at, updated_at)
  values (r, v_org, o, 500000, 'Approved and unsent fixture', 'approved', 'paystack', v_adm, now() - interval '3 days', false, now() - interval '4 days', now() - interval '3 days');
  perform pg_temp.setf('m3_refund', r);
  -- M4 completed refund, cash posted BY HAND under the documented reference (clean for the cash-posting kind)
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'refunded', now() - interval '4 days', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'm4 pay');
  r := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, completed_at, gl_released_at, provider_status, provider_checked_at, is_test)
  values (r, v_org, o, 500000, 'Hand posted fixture', 'completed', 'paystack', now() - interval '1 day', now() - interval '1 day', 'matched', now(), false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'manual', 'refund:' || r, 'by hand');
  perform pg_temp.setf('m4_refund', r);
  -- M5 completed refund of 500000 whose deferred revenue release was 600000
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'refunded', now() - interval '4 days', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'm5 pay');
  r := gen_random_uuid(); pt := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, completed_at, gl_released_at, provider_status, provider_checked_at, is_test)
  values (r, v_org, o, 500000, 'Over released fixture', 'completed', 'paystack', now() - interval '1 day', now() - interval '1 day', 'matched', now(), false);
  insert into public.payment_transactions (id, provider, provider_event_id, event_type, amount_minor, currency, processed_at, raw_payload) values (pt, 'paystack', 'refund:' || v_ref || ':500000', 'refund.processed', 500000, 'NGN', now(), '{}');
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'refund', pt::text, 'cash back m5');
  je := gen_random_uuid();
  insert into public.finance_journal_entries (id, entry_date, period_month, source, source_ref, memo) values (je, current_date, date_trunc('month', current_date)::date, 'adjustment', 'refund_deferred_release:' || r, 'over release');
  insert into public.finance_journal_lines (entry_id, line_no, account_code, debit_minor, credit_minor, organisation_id) values (je, 1, '2000', 600000, 0, v_org), (je, 2, '4900', 0, 600000, v_org);
  perform pg_temp.setf('m5_refund', r);
  -- M6 a share of 100000 reversed twice (-100000 and -50000)
  l := gen_random_uuid(); r := gen_random_uuid();
  insert into public.earnings_ledger (id, organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, fee_schedule_version_id, calculation, earned_at, employment_type, is_test)
  values (l, v_org, v_doc, 'consultation', 'encounter', gen_random_uuid(), 100000, v_fee, '{}', now() - interval '2 days', 'contracted', false);
  insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, calculation, earned_at, employment_type, note, created_by, is_test) values
    (v_org, v_doc, 'adjustment', 'refund_reversal', gen_random_uuid(), -100000, jsonb_build_object('refund_id', r, 'corrects', l), now(), 'contracted', 'First reversal fixture', v_adm, false),
    (v_org, v_doc, 'adjustment', 'refund_reversal', gen_random_uuid(), -50000, jsonb_build_object('refund_id', gen_random_uuid(), 'corrects', l), now(), 'contracted', 'Second reversal fixture', v_adm, false);
  perform pg_temp.setf('m6_line', l);
  -- M7 a recorded payment mismatch whose reason is the FEE, not the amount: no kobo difference is claimed
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', '');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 'created', v_ref, false);
  p := gen_random_uuid();
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, mismatch_reason, source, is_test) values (p, v_org, o, 'paystack', v_ref, 500000, 9000, 509000, 'mismatch', 'fee', 'webhook', false);
  perform pg_temp.setf('m7_pay', p);

  -- ===== N. instalment plan orders (a part at a time) =====
  -- N1 CLEAN: 500000 in two parts of 250000; part 1 paid and journalled as orderpart:<payment id>; entitled
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', ''); e := gen_random_uuid(); p := gen_random_uuid();
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.order_instalment_plans (id, organisation_id, order_id, patient_id, parts, price_kobo, schedule, schedule_version) values (e, v_org, o, v_pat, 2, 500000, '{}', 1);
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (p, v_org, o, 'paystack', v_ref || '_p1', 250000, 0, 250000, 'success', 'return', false);
  insert into public.order_instalments (organisation_id, plan_id, order_id, seq, amount_kobo, due_at, state, paid_at, payment_id) values (v_org, e, o, 1, 250000, now() - interval '2 days', 'paid', now() - interval '2 days', p);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'membership', now() - interval '2 days', now() + interval '360 days', null, 'active', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'orderpart:' || p, 'n1 part');
  perform pg_temp.setf('n1_order', o); perform pg_temp.setf('n1_pay', p);
  -- N2 the payment recorded for a part is 200000 against a part of 250000; N3 a paid part with no ledger entry
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', ''); e := gen_random_uuid(); p := gen_random_uuid();
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.order_instalment_plans (id, organisation_id, order_id, patient_id, parts, price_kobo, schedule, schedule_version) values (e, v_org, o, v_pat, 2, 500000, '{}', 1);
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test, created_at) values (p, v_org, o, 'paystack', v_ref || '_p1', 200000, 0, 200000, 'success', 'return', false, now() - interval '2 days');
  insert into public.order_instalments (organisation_id, plan_id, order_id, seq, amount_kobo, due_at, state, paid_at, payment_id) values (v_org, e, o, 1, 250000, now() - interval '2 days', 'paid', now() - interval '2 days', p);
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test) values (v_org, v_pat, o, 'membership', now() - interval '2 days', now() + interval '360 days', null, 'active', false);
  perform pg_temp.setf('n2_pay', p);
  -- N4 CLEAN: a per-part refund (refunds.payment_id) of 250000 whose cash entry is keyed on the PART's own charge reference
  o := gen_random_uuid(); v_ref := 'tho_mrs_' || replace(o::text, '-', ''); e := gen_random_uuid(); p := gen_random_uuid();
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'refunded', now() - interval '4 days', v_ref, false);
  insert into public.order_instalment_plans (id, organisation_id, order_id, patient_id, parts, price_kobo, schedule, schedule_version) values (e, v_org, o, v_pat, 2, 500000, '{}', 1);
  insert into public.payments (id, organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test) values (p, v_org, o, 'paystack', v_ref || '_p1', 250000, 0, 250000, 'success', 'return', false);
  insert into public.order_instalments (organisation_id, plan_id, order_id, seq, amount_kobo, due_at, state, paid_at, payment_id) values (v_org, e, o, 1, 250000, now() - interval '4 days', 'paid', now() - interval '4 days', p);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'orderpart:' || p, 'n4 part');
  r := gen_random_uuid(); pt := gen_random_uuid();
  insert into public.refunds (id, organisation_id, order_id, payment_id, refund_group, amount_kobo, reason, state, provider, completed_at, gl_released_at, provider_status, provider_checked_at, is_test)
  values (r, v_org, o, p, gen_random_uuid(), 250000, 'Per part refund fixture', 'completed', 'paystack', now() - interval '1 day', now() - interval '1 day', 'matched', now(), false);
  insert into public.payment_transactions (id, provider, provider_event_id, event_type, amount_minor, currency, processed_at, raw_payload) values (pt, 'paystack', 'refund:' || v_ref || '_p1:250000', 'refund.processed', 250000, 'NGN', now(), '{}');
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'refund', pt::text, 'cash back n4');
  perform pg_temp.setf('n4_refund', r); perform pg_temp.setf('n4_order', o);

  -- ===== O. earnings holds and withholding =====
  -- O1 an open dispute past its answer date on a line that is not in any payout
  l := gen_random_uuid();
  insert into public.earnings_ledger (id, organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, fee_schedule_version_id, calculation, earned_at, employment_type, is_test)
  values (l, v_org, v_doc, 'task', 'task', gen_random_uuid(), 70000, v_fee, '{}', now() - interval '9 days', 'contracted', false);
  insert into public.earnings_disputes (organisation_id, ledger_id, clinician_id, reason_code, request_id, response_due_at, opened_at) values (v_org, l, v_doc, 'wrong_amount', gen_random_uuid(), now() - interval '2 days', now() - interval '5 days');
  perform pg_temp.setf('o1_line', l);
  -- O2 a payout (approved) that includes a line under an open dispute
  declare v_pay2 uuid := gen_random_uuid(); v_pay3 uuid := gen_random_uuid(); v_doc2 uuid := gen_random_uuid();
  begin
    insert into public.payouts (id, organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, state, approved_by, approved_at, recipient_code, payouts_config_id, is_test)
    values (v_pay2, v_org, v_doc2, current_date - 7, current_date - 1, 100000, 1, 'approved', v_adm, now() - interval '1 day', 'RCP_fixture', v_cfg, false);
    l := gen_random_uuid();
    insert into public.earnings_ledger (id, organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, fee_schedule_version_id, calculation, earned_at, employment_type, payout_id, is_test)
    values (l, v_org, v_doc2, 'task', 'task', gen_random_uuid(), 100000, v_fee, '{}', now() - interval '9 days', 'contracted', v_pay2, false);
    insert into public.earnings_disputes (organisation_id, ledger_id, clinician_id, reason_code, request_id, response_due_at, opened_at) values (v_org, l, v_doc2, 'wrong_amount', gen_random_uuid(), now() + interval '2 days', now());
    perform pg_temp.setf('o2_payout', v_pay2);
    -- O3 a payout that was sent while carrying a withholding amount
    insert into public.payouts (id, organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, state, approved_by, approved_at, recipient_code, payouts_config_id, is_test, withholding_kobo)
    values (v_pay3, v_org, gen_random_uuid(), current_date - 7, current_date - 1, 100000, 1, 'sent', v_adm, now() - interval '1 day', 'RCP_fixture', v_cfg, false, 10000);
    insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, fee_schedule_version_id, calculation, earned_at, employment_type, payout_id, is_test)
    select v_org, clinician_id, 'task', 'task', gen_random_uuid(), 100000, v_fee, '{}', now() - interval '9 days', 'contracted', v_pay3, false from public.payouts where id = v_pay3;
    perform pg_temp.setf('o3_payout', v_pay3);
  end;

  set local session_replication_role = origin;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Checks, re-runnable under a phase name so the sabotage can run the same list
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.run_checks(p_phase text) returns void language plpgsql as $f$
declare
  v_fin uuid := pg_temp.f('fin'); v_adm uuid := pg_temp.f('adm'); v_pat uuid := pg_temp.f('pat');
  n_before bigint; n_after bigint;
begin
  -- 1. every kind is reported for the row seeded with that fault
  insert into results values
   (p_phase, 'kind: paid order with no entitlement', 'reported', pg_temp.seen('paid_order_no_entitlement', pg_temp.f('b_order'))),
   (p_phase, 'kind: entitlement on an unpaid order', 'reported', pg_temp.seen('entitlement_no_paid_order', pg_temp.f('c_ent'))),
   (p_phase, 'kind: refunded order, entitlement still active', 'reported', pg_temp.seen('refunded_order_entitlement_active', pg_temp.f('d_ent'))),
   (p_phase, 'kind: paid order with no payment row', 'reported', pg_temp.seen('paid_order_no_payment', pg_temp.f('e_order'))),
   (p_phase, 'kind: payment amount differs from the order', 'reported', pg_temp.seen('payment_amount_differs_from_order', pg_temp.f('f_pay'))),
   (p_phase, 'kind: payment total is not amount plus fee', 'reported', pg_temp.seen('payment_total_inconsistent', pg_temp.f('g_pay'))),
   (p_phase, 'kind: verified payment on an unpaid order', 'reported', pg_temp.seen('payment_success_order_not_paid', pg_temp.f('h_pay'))),
   (p_phase, 'kind: recorded mismatch payment on an unpaid order', 'reported', pg_temp.seen('payment_mismatch_recorded', pg_temp.f('i_pay'))),
   (p_phase, 'kind: paid order with no ledger entry', 'reported', pg_temp.seen('paid_order_no_journal', pg_temp.f('j_order'))),
   (p_phase, 'kind: refund processing past the stuck window', 'reported', pg_temp.seen('refund_processing_stuck', pg_temp.f('k1_refund'))),
   (p_phase, 'kind: refund the weekly Paystack check disagrees with', 'reported', pg_temp.seen('refund_paystack_mismatch', pg_temp.f('k2_refund'))),
   (p_phase, 'kind: completed refund with no cash entry', 'reported', pg_temp.seen('refund_completed_no_cash_posting', pg_temp.f('k3_refund'))),
   (p_phase, 'kind: completed refund, deferred revenue release pending', 'reported', pg_temp.seen('refund_gl_release_pending', pg_temp.f('k3_refund'))),
   (p_phase, 'kind: release posted for a refund that is not completed', 'reported', pg_temp.seen('refund_gl_release_irregular', pg_temp.f('k5_refund'))),
   (p_phase, 'kind: earnings reversal for a refund that is not completed', 'reported', pg_temp.seen('earnings_reversal_irregular', pg_temp.f('k6_line'))),
   (p_phase, 'kind: share not reversed after a full refund', 'reported', pg_temp.seen('consultation_share_not_reversed', pg_temp.f('l1_line'))),
   (p_phase, 'kind: share under-reversed after a part refund', 'reported', pg_temp.seen('consultation_share_not_reversed', pg_temp.f('l4_line'))),
   (p_phase, 'kind: payout total differs from its lines', 'reported', pg_temp.seen('payout_total_differs_from_lines', pg_temp.f('p2'))),
   (p_phase, 'kind: payout succeeded with no ledger posting', 'reported', pg_temp.seen('payout_succeeded_no_gl_posting', pg_temp.f('p3'))),
   (p_phase, 'kind: payout ledger posting failed', 'reported', pg_temp.seen('payout_gl_posting_failed', pg_temp.f('p4'))),
   (p_phase, 'kind: payout ledger entry differs from the payout', 'reported', pg_temp.seen('payout_gl_amount_differs', pg_temp.f('p5'))),
   (p_phase, 'kind: payout returned by the bank with no reversing entry', 'reported', pg_temp.seen('payout_reversed_no_gl_reversal', pg_temp.f('p6'))),
   (p_phase, 'kind: payout succeeded with no successful transfer', 'reported', pg_temp.seen('payout_succeeded_no_successful_transfer', pg_temp.f('p7')));

  -- amounts in kobo
  insert into results values
   (p_phase, 'delta: payment 400000 against price 500000', '-100000', pg_temp.delta('payment_amount_differs_from_order', pg_temp.f('f_pay'))),
   (p_phase, 'delta: payment total 1000 short of amount plus fee', '-1000', pg_temp.delta('payment_total_inconsistent', pg_temp.f('g_pay'))),
   (p_phase, 'delta: unreversed full share', '100000', pg_temp.delta('consultation_share_not_reversed', pg_temp.f('l1_line'))),
   (p_phase, 'delta: part refund expected 50000, reversed 20000', '30000', pg_temp.delta('consultation_share_not_reversed', pg_temp.f('l4_line'))),
   (p_phase, 'delta: payout lines 50000 short', '-50000', pg_temp.delta('payout_total_differs_from_lines', pg_temp.f('p2'))),
   (p_phase, 'delta: payout ledger entry 100000 short', '-100000', pg_temp.delta('payout_gl_amount_differs', pg_temp.f('p5'))),
   (p_phase, 'delta: release posted early is the 2000 debit', '120000', pg_temp.delta('refund_gl_release_irregular', pg_temp.f('k5_refund'))),
   (p_phase, 'delta: the Paystack-side amount is not stored, so the delta is empty', null, (select m.delta_kobo::text from private.money_mismatches(true, 1440, 15) m where m.kind = 'refund_paystack_mismatch' and m.subject_id = pg_temp.f('k2_refund')));

  -- 2. the clean controls appear under no kind at all
  insert into results values
   (p_phase, 'clean: a paid, paid-for, entitled, journalled order', 'none', pg_temp.seen_any(pg_temp.f('clean_order'))),
   (p_phase, 'clean: a completed refund with cash entry and release', 'none', pg_temp.seen_any(pg_temp.f('k4_refund'))),
   (p_phase, 'clean: a full share reversed in full', 'none', pg_temp.seen_any(pg_temp.f('l2_line'))),
   (p_phase, 'clean: a part refund reversed pro rata', 'none', pg_temp.seen_any(pg_temp.f('l3_line'))),
   (p_phase, 'clean: a payout whose lines, transfer and ledger entry agree', 'none', pg_temp.seen_any(pg_temp.f('p1')));

  -- 3. thresholds
  insert into results values
   (p_phase, 'threshold: an order paid 5 minutes ago is inside the grace window', 'none', pg_temp.seen_any(pg_temp.f('grace_order'))),
   (p_phase, 'threshold: a refund sending for 30 minutes is inside the stuck window', 'none', pg_temp.seen_any(pg_temp.f('k1b_refund')));

  -- review additions
  insert into results values
   (p_phase, 'kind: refund cash out with no payment entry in the ledger', 'reported', pg_temp.seen('refund_cash_out_without_payment_entry', pg_temp.f('m2_refund'))),
   (p_phase, 'kind: refund decided, order refunded, money not sent', 'reported', pg_temp.seen('refund_decided_not_sent', pg_temp.f('m3_refund'))),
   (p_phase, 'kind: release larger than the refund', 'reported', pg_temp.seen('refund_gl_release_irregular', pg_temp.f('m5_refund'))),
   (p_phase, 'kind: share reversed by more than it was worth', 'reported', pg_temp.seen('earnings_reversal_irregular', pg_temp.f('m6_line'))),
   (p_phase, 'kind: sponsor-covered order with no ledger entry', 'reported', pg_temp.seen('paid_order_no_journal', pg_temp.f('m1b_sponsor_order'))),
   (p_phase, 'delta: sponsor share is the missing ledger amount', '500000', pg_temp.delta('paid_order_no_journal', pg_temp.f('m1b_sponsor_order'))),
   (p_phase, 'delta: share reversed 50000 too much', '50000', pg_temp.delta('earnings_reversal_irregular', pg_temp.f('m6_line'))),
   (p_phase, 'delta: the release over the refund reports the full release', '600000', pg_temp.delta('refund_gl_release_irregular', pg_temp.f('m5_refund'))),
   (p_phase, 'delta: an amount mismatch reports the difference', '-50000', pg_temp.delta('payment_mismatch_recorded', pg_temp.f('i_pay'))),
   (p_phase, 'delta: a fee mismatch claims no kobo difference', null, (select m.delta_kobo::text from private.money_mismatches(true, 1440, 15) m where m.kind = 'payment_mismatch_recorded' and m.subject_id = pg_temp.f('m7_pay'))),
   (p_phase, 'clean: a fully sponsor-covered order has no payment row by design', 'none', pg_temp.seen_any(pg_temp.f('m1_sponsor_order'))),
   (p_phase, 'clean: a refund cash entry posted by hand under refund:<id> clears the kind', 'absent', pg_temp.seen('refund_completed_no_cash_posting', pg_temp.f('m4_refund'))),
   (p_phase, 'control: an approved refund decided just now is not yet late', 'absent', pg_temp.seen('refund_decided_not_sent', pg_temp.f('k5_refund')));

  -- newer objects: instalment plans, per-part refunds, earnings holds, withholding
  insert into results values
   (p_phase, 'kind: instalment part paid with a different amount', 'reported', pg_temp.seen('instalment_payment_differs_from_part', pg_temp.f('n2_pay'))),
   (p_phase, 'delta: instalment payment 50000 short of its part', '-50000', pg_temp.delta('instalment_payment_differs_from_part', pg_temp.f('n2_pay'))),
   (p_phase, 'kind: instalment part paid with no ledger entry', 'reported', pg_temp.seen('instalment_paid_no_journal', pg_temp.f('n2_pay'))),
   (p_phase, 'control: a part payment is not compared with the whole order price', 'absent', pg_temp.seen('payment_amount_differs_from_order', pg_temp.f('n2_pay'))),
   (p_phase, 'clean: a plan order with its part paid, journalled by part and entitled', 'none', pg_temp.seen_any(pg_temp.f('n1_order'))),
   (p_phase, 'clean: a part payment journalled as orderpart', 'none', pg_temp.seen_any(pg_temp.f('n1_pay'))),
   (p_phase, 'clean: a per-part refund keyed on the part charge, order posted by part', 'none', pg_temp.seen_any(pg_temp.f('n4_refund'))),
   (p_phase, 'kind: dispute answer overdue', 'reported', pg_temp.seen('earnings_dispute_overdue', pg_temp.f('o1_line'))),
   (p_phase, 'kind: payout includes a line under open dispute', 'reported', pg_temp.seen('payout_includes_disputed_line', pg_temp.f('o2_payout'))),
   (p_phase, 'kind: payout sent with a withholding', 'reported', pg_temp.seen('payout_sent_with_withholding', pg_temp.f('o3_payout'))),
   (p_phase, 'delta: withholding amount', '10000', pg_temp.delta('payout_sent_with_withholding', pg_temp.f('o3_payout'))),
   (p_phase, 'control: an open dispute not yet due is not overdue', 'absent', pg_temp.seen('earnings_dispute_overdue', pg_temp.f('o2_payout')));

  -- 4. test rows
  insert into results values
   (p_phase, 'test rows: a test order is never expected in the ledger, even when test rows are included', 'absent', pg_temp.seen('paid_order_no_journal', pg_temp.f('j2_test_order'), true));
end $f$;

select pg_temp.run_checks('real');

-- Access, read-only and test-toggle checks (do not depend on the detector)
do $$
declare
  v_fin uuid := pg_temp.f('fin'); v_adm uuid := pg_temp.f('adm'); v_pat uuid := pg_temp.f('pat');
  n_all bigint; n_page bigint; v_total bigint; v_sum_total bigint; v_cnt1 bigint; v_cnt2 bigint;
begin
  insert into results values ('real', 'access: finance may read the list', 'ok', pg_temp.try_as(v_fin, 'select * from public.money_reconciliation_list(true, null, 10, 0, 1440, 15)'));
  insert into results values ('real', 'access: admin may read the list', 'ok', pg_temp.try_as(v_adm, 'select * from public.money_reconciliation_list(true, null, 10, 0, 1440, 15)'));
  insert into results values ('real', 'access: finance may read the summary', 'ok', pg_temp.try_as(v_fin, 'select * from public.money_reconciliation_summary(true, 1440, 15)'));
  insert into results values ('real', 'access: a patient is refused with an error, not an empty list', '42501', pg_temp.try_as(v_pat, 'select * from public.money_reconciliation_list(true, null, 10, 0, 1440, 15)'));
  insert into results values ('real', 'access: a patient is refused the summary', '42501', pg_temp.try_as(v_pat, 'select * from public.money_reconciliation_summary(true, 1440, 15)'));
  insert into results values ('real', 'access: the private detector is not callable by a client', '42501', pg_temp.try_as(v_fin, 'select * from private.money_mismatches(true, 1440, 15)'));
  insert into results values ('real', 'access: anon cannot execute the list', 'false', has_function_privilege('anon', 'public.money_reconciliation_list(boolean,text,integer,integer,integer,integer)', 'EXECUTE')::text);
  insert into results values ('real', 'access: anon cannot execute the summary', 'false', has_function_privilege('anon', 'public.money_reconciliation_summary(boolean,integer,integer)', 'EXECUTE')::text);
  insert into results values ('real', 'input: a zero stuck window is refused, not treated as no limit', '22023', pg_temp.try_as(v_fin, 'select * from public.money_reconciliation_list(true, null, 10, 0, 0, 15)'));

  -- pagination: pages add up to the total and total_count is the same on every page
  perform pg_temp.act(v_fin);
  select count(*), max(total_count) into n_page, v_total from public.money_reconciliation_list(true, null, 5, 0, 1440, 15);
  select count(*) into n_all from public.money_reconciliation_list(true, null, 200, 0, 1440, 15);
  select count(*) into v_cnt1 from public.money_reconciliation_list(true, 'consultation_share_not_reversed', 50, 0, 1440, 15) where kind = 'consultation_share_not_reversed';
  select coalesce(sum(n), 0) into v_sum_total from public.money_reconciliation_summary(true, 1440, 15);
  select n into v_cnt2 from public.money_reconciliation_summary(true, 1440, 15) where kind = 'consultation_share_not_reversed';
  perform pg_temp.back();
  insert into results values ('real', 'paging: the first page of 5 is full', '5', n_page::text);
  insert into results values ('real', 'paging: total_count equals the whole list', n_all::text, v_total::text);
  insert into results values ('real', 'paging: the summary adds up to the list', n_all::text, v_sum_total::text);
  insert into results values ('real', 'paging: a kind filter and the summary agree', v_cnt1::text, v_cnt2::text);

  -- test rows are left out unless asked for: the same seeded rows are not reported when p_include_test is false only if they are test rows;
  -- the fixture rows are all real (is_test false), so flip one to test and prove it disappears and reappears
  set local session_replication_role = replica;
  update public.orders set is_test = true where id = pg_temp.f('b_order');
  set local session_replication_role = origin;
  insert into results values ('real', 'test toggle: a test order is hidden by default', 'absent', pg_temp.seen('paid_order_no_entitlement', pg_temp.f('b_order'), false));
  insert into results values ('real', 'test toggle: and shown when asked for', 'reported', pg_temp.seen('paid_order_no_entitlement', pg_temp.f('b_order'), true));
  set local session_replication_role = replica;
  update public.orders set is_test = false where id = pg_temp.f('b_order');
  set local session_replication_role = origin;

  -- read-only: calling the screen changes no row anywhere it reads
  select (select count(*) from public.orders) + (select count(*) from public.payments) + (select count(*) from public.refunds)
       + (select count(*) from public.earnings_ledger) + (select count(*) from public.payouts) + (select count(*) from public.finance_journal_entries)
    into n_all;
  perform pg_temp.act(v_fin);
  perform count(*) from public.money_reconciliation_list(true, null, 200, 0, 1440, 15);
  perform count(*) from public.money_reconciliation_summary(true, 1440, 15);
  perform pg_temp.back();
  select (select count(*) from public.orders) + (select count(*) from public.payments) + (select count(*) from public.refunds)
       + (select count(*) from public.earnings_ledger) + (select count(*) from public.payouts) + (select count(*) from public.finance_journal_entries)
    into n_page;
  insert into results values ('real', 'read-only: no row count moved', n_all::text, n_page::text);
  insert into results values ('real', 'read-only: all three functions are STABLE', '3',
    (select count(*)::text from pg_proc where oid in ('public.money_reconciliation_list(boolean,text,integer,integer,integer,integer)'::regprocedure,
       'public.money_reconciliation_summary(boolean,integer,integer)'::regprocedure, 'private.money_mismatches(boolean,integer,integer)'::regprocedure) and provolatile = 's'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- SABOTAGE
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_flipped integer;
begin
  -- (a) the detector emptied: every "reported" must flip to "absent"
  create or replace function private.money_mismatches(p_include_test boolean, p_unsent_minutes integer, p_grace_minutes integer)
  returns table (kind text, severity text, organisation_id uuid, subject_type text, subject_id uuid, related_type text, related_id uuid,
                 delta_kobo bigint, since timestamptz, owner_hint text, detail text)
  language sql stable security definer set search_path = '' as $f$ select null::text, null::text, null::uuid, null::text, null::uuid, null::text, null::uuid, null::bigint, null::timestamptz, null::text, null::text where false $f$;
  perform pg_temp.run_checks('sabotaged');
  -- (b) the finance gate removed: a patient is let in
  create or replace function public.money_reconciliation_summary(p_include_test boolean, p_unsent_minutes integer, p_grace_minutes integer)
  returns table (kind text, severity text, n bigint, delta_abs_kobo bigint, oldest timestamptz)
  language plpgsql stable security definer set search_path = '' as $f$ begin return query select 'x'::text, 'x'::text, 1::bigint, 1::bigint, now(); end $f$;
  insert into results values ('sabotaged', 'access: a patient is refused the summary', '42501', pg_temp.try_as(v_pat, 'select * from public.money_reconciliation_summary(true, 1440, 15)'));
  select count(*) into v_flipped from results r
   where phase = 'sabotaged' and exists (select 1 from results x where x.phase = 'real' and x.check_name = r.check_name and x.expected = r.expected) and r.expected is distinct from r.actual and r.expected <> 'none' and r.expected is not null;
  if v_flipped < 20 then raise exception 'VACUOUS TEST: the sabotage flipped only % checks', v_flipped; end if;
  if not exists (select 1 from results where phase = 'sabotaged' and check_name = 'access: a patient is refused the summary' and expected is distinct from actual) then
    raise exception 'VACUOUS TEST: removing the finance gate did not let the patient in';
  end if;
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Money reconciliation proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || coalesce(expected, 'null') || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
