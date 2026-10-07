-- Tarragon Health — Platform Credit, part 5: the accounting.
--
-- Reuses the two liability accounts care_vouchers already established rather
-- than adding new ones (2100 for real customer prepayments, 2600 for
-- promotional/marketing credit nobody paid for) — the economic substance is
-- identical to a voucher's, just a different product shape, and splitting the
-- chart of accounts per feature instead of per economic substance is exactly
-- how a wallet-style balance becomes unauditable. Renamed generically since
-- they now cover more than vouchers. private.finance_post_journal's own
-- source+source_ref idempotency (see 20260725225800) already guarantees a
-- given ledger entry posts to the GL exactly once no matter how many times
-- this trigger fires.

update public.finance_accounts
   set name = 'Customer prepayments',
       description = 'Money customers have paid for a not-yet-delivered service — care vouchers and platform credit alike. Segregated from promotional credit (2600), which nobody paid for.'
 where code = '2100';

update public.finance_accounts
   set name = 'Promotional credit outstanding',
       description = 'Reward/referral vouchers and admin-granted platform credit — a marketing obligation nobody paid cash for, never customer money.'
 where code = '2600';

alter table public.finance_journal_lines drop constraint if exists finance_journal_lines_source_check;
alter table public.finance_journal_entries drop constraint if exists finance_journal_entries_source_check;
alter table public.finance_journal_entries add constraint finance_journal_entries_source_check
  check (source in ('payment','commission','refund','wallet','voucher','platform_credit','revenue_recognition','fx','manual','adjustment','opening'));

create or replace function private.finance_post_platform_credit_ledger_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entry_type = 'topup' then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'platform_credit', 'topup:' || new.id::text,
      'Platform credit top-up',
      jsonb_build_array(
        jsonb_build_object('account_code','1020','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','2100','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
      null);

  elsif new.entry_type = 'admin_grant' then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'platform_credit', 'grant:' || new.id::text,
      coalesce('Platform credit granted — ' || new.description, 'Platform credit granted'),
      jsonb_build_array(
        jsonb_build_object('account_code','6000','debit_minor',new.promo_amount_kobo,'credit_minor',0,
                           'organisation_id',new.organisation_id,'cost_center_code','MARKETING'),
        jsonb_build_object('account_code','2600','debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
      null);

  elsif new.entry_type = 'spend' then
    -- Discharge whichever liability actually funded this spend — one line
    -- pair per bucket touched, both crediting the same revenue account, so
    -- the split between "real money finally earned" and "promotional cost
    -- finally redeemed" survives all the way into the GL.
    if new.paid_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'spend-paid:' || new.id::text,
        'Platform credit spent (customer funds) — ' || coalesce(new.description, 'service purchase'),
        jsonb_build_array(
          jsonb_build_object('account_code','2100','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
    if new.promo_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'spend-promo:' || new.id::text,
        'Platform credit spent (promotional) — ' || coalesce(new.description, 'service purchase'),
        jsonb_build_array(
          jsonb_build_object('account_code','2600','debit_minor',new.promo_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;

  elsif new.entry_type = 'admin_correction' then
    -- Rare and manual by design — post to Refunds payable (2400) as a flag
    -- for finance to settle out of band, rather than guessing whether real
    -- cash actually needs to move. See this migration set's ledger-functions
    -- file for what triggers a correction.
    if new.paid_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'correction-paid:' || new.id::text,
        'Platform credit correction (paid) — ' || coalesce(new.description, 'manual adjustment'),
        jsonb_build_array(
          jsonb_build_object('account_code','2100','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
    if new.promo_amount_kobo > 0 then
      perform private.finance_post_journal(
        current_date, 'NGN'::public.currency, 'platform_credit', 'correction-promo:' || new.id::text,
        'Platform credit correction (promo) — ' || coalesce(new.description, 'manual adjustment'),
        jsonb_build_array(
          jsonb_build_object('account_code','2600','debit_minor',new.promo_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
          jsonb_build_object('account_code','2400','debit_minor',0,'credit_minor',new.promo_amount_kobo,'organisation_id',new.organisation_id)),
        null);
    end if;
  end if;

  return new;
exception when others then
  return new; -- accounting must never block a patient's top-up or spend
end;
$$;

create trigger platform_credit_ledger_entries_finance_post
  after insert on public.platform_credit_ledger_entries
  for each row execute function private.finance_post_platform_credit_ledger_entry();

do $$
begin
  if (select name from public.finance_accounts where code = '2100') <> 'Customer prepayments' then
    raise exception 'account 2100 was not renamed to the generic prepayments label';
  end if;
  if (select name from public.finance_accounts where code = '2600') <> 'Promotional credit outstanding' then
    raise exception 'account 2600 was not renamed to the generic promotional-credit label';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'platform_credit_ledger_entries_finance_post'
  ) then
    raise exception 'the platform credit finance posting trigger was not attached';
  end if;
end $$;
