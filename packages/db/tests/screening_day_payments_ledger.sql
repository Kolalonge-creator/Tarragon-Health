-- Proof: group screening day payments post to the general ledger (migration *_screening_day_payments_post_to_ledger.sql).
--   A. A paid outreach day: the payer records a checkout intent, the verified Paystack charge arrives, the day is paid in full
--      AND one balanced journal entry posts: Dr 1020 cash / Cr 4100 service revenue for the whole amount, under the day's
--      organisation.
--   B. A test-bundle day: the same charge posts as a voucher prepayment, Dr 1020 / Cr 2100.
--   C. A charge whose reference matches no screening day payment posts nothing (left for manual reconciliation) and records no
--      posting failure; a charge.failed for a real reference posts nothing.
--   D. SABOTAGE: the new trigger dropped: a fresh paid charge leaves no journal entry (so A was the trigger).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'sdl-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'SDL ' || p_label, '+23481' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true,
    phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- a verified provider charge, as the Paystack webhook writes it
create function pg_temp.charge(p_org uuid, p_ref text, p_amount bigint, p_event text default 'charge.success') returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values (p_org, 'paystack', 'sdl-' || gen_random_uuid(), p_event::public.payment_transaction_type, p_amount, 'NGN',
          jsonb_build_object('event', p_event, 'data', jsonb_build_object('reference', p_ref, 'amount', p_amount,
                             'metadata', jsonb_build_object('kind', 'screening_day_payment'))))
  returning id into v;
  return v;
end $f$;
create function pg_temp.lines(p_txn uuid) returns text language sql as
$$ select coalesce(string_agg(l.account_code || ':' || l.debit_minor || '/' || l.credit_minor, ',' order by l.account_code), '')
     from public.finance_journal_entries e join public.finance_journal_lines l on l.entry_id = e.id
    where e.source_ref = p_txn::text $$;

do $$
declare
  v_org uuid; v_admin uuid; v_payer uuid; v_paid uuid; v_bundle_day uuid; v_txn uuid; v_r text; v_fail_before integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then select id into v_org from public.organisations order by created_at limit 1; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_payer := pg_temp.mkuser(v_org, 'payer', 'patient');

  -- ===== A. Paid outreach day =====
  v_paid := (pg_temp.q_as(v_admin, format($q$select public.create_outreach_day('outreach_paid', 'Ledger Ltd', null, 'Ikeja', %L, 2) ->> 'screening_day_id'$q$, current_date + 7)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 2, 0, %L)::text$q$, v_paid, v_payer));
  v_r := pg_temp.q_as(v_payer, format($q$select public.record_screening_day_payment_intent(%L, 3000000, 'NGN', 3000000, 'paystack', 'sdl-ref-paid')::text$q$, v_paid));
  perform pg_temp.rec('A0 the payer records the checkout intent', 'true', (v_r !~ '^ERR')::text);
  v_txn := pg_temp.charge(v_org, 'sdl-ref-paid', 3000000);
  perform pg_temp.rec('A1 the charge pays the day in full', '3000000', (select amount_paid_kobo::text from public.screening_days where id = v_paid));
  perform pg_temp.rec('A2 one balanced entry: Dr 1020 cash, Cr 4100 service revenue', '1020:3000000/0,4100:0/3000000', pg_temp.lines(v_txn));
  perform pg_temp.rec('A3 posted as a payment under the day''s organisation', 'payment|true',
    (select e.source || '|' || bool_and(l.organisation_id = v_org)::text
       from public.finance_journal_entries e join public.finance_journal_lines l on l.entry_id = e.id
      where e.source_ref = v_txn::text group by e.source));

  -- ===== B. Test-bundle day: voucher prepayment =====
  insert into public.screening_days (organisation_id, requested_by, kind, host_name, location, event_date, panel_bundle_id,
                                     slots_requested, slots_confirmed, discount_percent, price_per_head_kobo, total_kobo,
                                     payer_profile_id, status, confirmed_by, confirmed_at)
  values (v_org, v_payer, 'bundle', 'Ledger Church', 'Yaba', current_date + 7, (select id from public.panel_bundles limit 1),
          2, 2, 0, 500000, 1000000, v_payer, 'confirmed', v_admin, now())
  returning id into v_bundle_day;
  v_r := pg_temp.q_as(v_payer, format($q$select public.record_screening_day_payment_intent(%L, 1000000, 'NGN', 1000000, 'paystack', 'sdl-ref-bundle')::text$q$, v_bundle_day));
  v_txn := pg_temp.charge(v_org, 'sdl-ref-bundle', 1000000);
  perform pg_temp.rec('B1 a bundle day posts as a voucher prepayment: Dr 1020, Cr 2100', '1020:1000000/0,2100:0/1000000', pg_temp.lines(v_txn));
  perform pg_temp.rec('B2 with the voucher source', 'voucher', (select source from public.finance_journal_entries where source_ref = v_txn::text));

  -- ===== C. Nothing to correlate =====
  select count(*) into v_fail_before from public.finance_posting_failures;
  v_txn := pg_temp.charge(v_org, 'sdl-ref-unknown', 700000);
  perform pg_temp.rec('C1 an unknown reference posts nothing', '', pg_temp.lines(v_txn));
  perform pg_temp.rec('C2 ...and is not recorded as a posting failure', 'true',
    ((select count(*) from public.finance_posting_failures) = v_fail_before)::text);
  v_txn := pg_temp.charge(v_org, 'sdl-ref-paid', 3000000, 'charge.failed');
  perform pg_temp.rec('C3 a failed charge posts nothing', '', pg_temp.lines(v_txn));

  -- ===== D. SABOTAGE =====
  execute 'drop trigger finance_post_screening_day_payment on public.payment_transactions';
  v_paid := (pg_temp.q_as(v_admin, format($q$select public.create_outreach_day('outreach_paid', 'Sabotage Ltd', null, 'Ikeja', %L, 1) ->> 'screening_day_id'$q$, current_date + 7)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 1, 0, %L)::text$q$, v_paid, v_payer));
  v_r := pg_temp.q_as(v_payer, format($q$select public.record_screening_day_payment_intent(%L, 1500000, 'NGN', 1500000, 'paystack', 'sdl-ref-sabotage')::text$q$, v_paid));
  v_txn := pg_temp.charge(v_org, 'sdl-ref-sabotage', 1500000);
  perform pg_temp.rec('D1 SABOTAGE trigger dropped: the day is still paid...', '1500000', (select amount_paid_kobo::text from public.screening_days where id = v_paid));
  perform pg_temp.rec('D2 ...but nothing reaches the ledger (so A2 was the new trigger)', '', pg_temp.lines(v_txn));

  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'screening day ledger proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'screening day ledger: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
