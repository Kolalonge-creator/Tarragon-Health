-- Group screening day payments post to the general ledger (found in review of the outreach build, OD-01..OD-04).
--
-- THE GAP. A screening day's Paystack payment (metadata.kind = 'screening_day_payment') was applied to the day by
-- private.apply_screening_day_payment_from_transaction, but no finance trigger ever handled that kind: finance_post_from_payment
-- returned early (processed_at is never set for these checkout kinds, and no branch named the kind). The money reached Paystack
-- and the day showed "paid in full" while the ledger showed nothing. Live count before: 0 payment_transactions of this kind,
-- 0 screening days of any kind, so there is nothing to backfill.
--
-- THE TREATMENT, by the day's kind, following the closest existing precedent for each:
--   bundle         The group prepays one named Care Voucher per attendee, so it is the voucher treatment exactly:
--                  Dr 1020 cash / Cr 2100 voucher liability. Redemption moves it on as for any other voucher.
--   outreach_paid  The place is the on-day check plus one single-use results consultation credit. A single-use grant has no
--                  window to defer over, so, like a single-use service purchase, it is recognised at the point of sale:
--                  Dr 1020 cash / Cr 4100 service revenue.
--   outreach_free  Never takes a payment (it has no total), so it never reaches here.
-- Correlation is by the provider reference recorded on screening_day_payments before checkout (pending_provider_ref, kept after
-- the payment is applied), so this works whichever AFTER INSERT trigger fires first. No match: left unposted for manual
-- reconciliation, never guessed. A refund of one of these payments already posts through the generic refund branch.
--
-- HOW. finance_post_from_payment is rewritten from its LIVE body by exact, counted text replacements (the
-- 20261102090647_finance_dates_use_lagos_not_utc.sql pattern), so nothing else in that 15k-character function can drift.
-- A dedicated AFTER INSERT trigger calls it for this kind, a sibling of finance_post_voucher_payment and
-- finance_post_service_purchase_payment, with the same failure capture (finance_record_posting_failure).

do $$
declare
  v_def text;
  v_count integer;
  r record;
begin
  v_def := pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure);

  for r in
    select * from (values
      (1, $o$  v_beneficiary uuid;
begin$o$,
          $n$  v_beneficiary uuid;
  v_sd_day public.screening_days%rowtype;
begin$n$),
      (2, $o$not in ('service_purchase', 'voucher_payment', 'sponsored_subscription')$o$,
          $n$not in ('service_purchase', 'voucher_payment', 'sponsored_subscription', 'screening_day_payment')$n$),
      (3, $o$    v_kind := 'sponsored_subscription';
  else
    return;
  end if;$o$,
          $n$    v_kind := 'sponsored_subscription';
  elsif coalesce(txn.raw_payload#>>'{data,metadata,kind}', txn.raw_payload#>>'{metadata,kind}') = 'screening_day_payment' then
    v_kind := 'screening_day';
  else
    return;
  end if;$n$),
      (4, $o$  elsif v_kind = 'sponsored_subscription' then$o$,
          $n$  elsif v_kind = 'screening_day' then
    -- Group screening day: correlate by the provider reference recorded before checkout (see this migration's header).
    v_ref := coalesce(
      txn.raw_payload #>> '{data,reference}',
      txn.raw_payload #>> '{data,object,id}');
    if v_ref is not null then
      select d.* into v_sd_day
        from public.screening_day_payments p
        join public.screening_days d on d.id = p.screening_day_id
       where p.pending_provider_ref = v_ref
       limit 1;
    end if;
    if v_sd_day.id is null then
      return;   -- nothing to correlate against: left for manual reconciliation
    end if;

    if v_sd_day.kind = 'outreach_paid' then
      perform private.finance_post_journal(v_date, v_cur, 'payment', txn.id::text,
        'Outreach health check: ' || v_sd_day.host_name,
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',v_sd_day.organisation_id),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_amount,'organisation_id',v_sd_day.organisation_id,
                             'memo','Paid outreach places: on-day check and one results consultation each')),
        null);
    else
      perform private.finance_post_journal(v_date, v_cur, 'voucher', txn.id::text,
        'Group screening day prepayment: ' || v_sd_day.host_name,
        jsonb_build_array(
          jsonb_build_object('account_code','1020','debit_minor',v_amount,'credit_minor',0,'organisation_id',v_sd_day.organisation_id),
          jsonb_build_object('account_code','2100','debit_minor',0,'credit_minor',v_amount,'organisation_id',v_sd_day.organisation_id)),
        null);
    end if;

  elsif v_kind = 'sponsored_subscription' then$n$)
    ) as t(n, old_text, new_text)
  loop
    v_count := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    if v_count <> 1 then
      raise exception 'screening day ledger: replacement % expected exactly 1 match in finance_post_from_payment, found %', r.n, v_count;
    end if;
    v_def := replace(v_def, r.old_text, r.new_text);
  end loop;

  execute v_def;
end $$;

create function private.finance_on_screening_day_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type::text in ('charge.success', 'checkout.session.completed')
     and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'screening_day_payment'
  then
    begin
      perform private.finance_post_from_payment(new.id);
    exception when others then
      perform private.finance_record_posting_failure(
        new.id, 'finance_on_screening_day_payment', sqlstate, sqlerrm);
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.finance_on_screening_day_payment() from public, anon, authenticated;

create trigger finance_post_screening_day_payment
  after insert on public.payment_transactions
  for each row execute function private.finance_on_screening_day_payment();

do $$
begin
  if pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure) not like '%v_kind := ''screening_day''%' then
    raise exception 'finance_post_from_payment did not gain the screening day branch';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'finance_post_screening_day_payment') then
    raise exception 'the screening day finance trigger was not attached';
  end if;
end $$;
