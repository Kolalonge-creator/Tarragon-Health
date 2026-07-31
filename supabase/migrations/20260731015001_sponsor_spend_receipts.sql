-- Tell the person who funded the care that the care happened.
--
-- The Health Wallet already lets anyone with a profile_access grant top up
-- someone else's balance (private.can_fund_wallet, 20260723193547). What it has
-- never done is close the loop. Money went in, money later came out, and the
-- person who put it there found out only if they thought to log in and look.
--
-- That gap is the whole product for a sponsor. Sending money to Nigeria is a
-- solved and fiercely competitive business; what none of those services can do
-- is tell you the money reached care rather than the general run of a
-- household. A receipt naming what was bought, on what date, is the thing being
-- sold. Leaving it as something you have to go and check for yourself gives it
-- away.
--
-- Deliberate choices:
--
--   Who.      Only people who actually put money into this specific wallet, read
--             from sponsor_topup entries, not everyone holding a grant. A next of
--             kin who has never funded anything gets no payment receipts; a
--             sponsor who has does, whether they hold view or manage.
--
--   What.     The service category and the amount. Never a result, a diagnosis, a
--             test name or a clinician. A sponsor is entitled to know their money
--             bought a lab test. They are not thereby entitled to the result, and
--             conflating the two would answer a question nobody asked. The rows
--             therefore stay content_class = 'non_clinical' (the column default)
--             and satisfy the I1 CHECK on every channel.
--
--   Channel.  in_app plus email. Not WhatsApp or SMS: a sponsor abroad frequently
--             has no Nigerian number, and email is the one channel that needs no
--             template approval to reach them. The in_app row needs no sender at
--             all, so the receipt works from the moment this migration lands.
--
--   Failure.  Exception-guarded. This fires inside the same transaction as the
--             debit that pays for someone's lab test. A missing profile row or a
--             malformed payload must never be the reason a payment fails, so the
--             whole body is wrapped and any error is swallowed. A lost receipt is
--             a nuisance; a lost payment is a broken product.
create or replace function private.notify_sponsors_of_wallet_spend()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_owner_id   uuid;
  v_org_id     uuid;
  v_owner_name text;
  v_what       text;
  v_sponsor    uuid;
begin
  if new.entry_type <> 'spend' then
    return new;
  end if;

  begin
    select w.profile_id, w.organisation_id
      into v_owner_id, v_org_id
      from public.health_wallets w
     where w.id = new.wallet_id;

    if v_owner_id is null then
      return new;
    end if;

    select coalesce(nullif(trim(p.full_name), ''), 'someone you support')
      into v_owner_name
      from public.profiles p
     where p.id = v_owner_id;

    v_what := case new.booking_order_type
                when 'lab'       then 'a lab test'
                when 'pharmacy'  then 'medication'
                when 'referral'  then 'a specialist referral'
                else 'care'
              end;

    for v_sponsor in
      select distinct l.actor_profile_id
        from public.wallet_ledger l
       where l.wallet_id = new.wallet_id
         and l.entry_type = 'sponsor_topup'
         and l.actor_profile_id is not null
         and l.actor_profile_id <> v_owner_id
    loop
      insert into public.notifications
        (organisation_id, recipient_id, channel, template, payload, source_table, source_id)
      select
        v_org_id,
        v_sponsor,
        c.channel,
        'sponsor_spend_receipt',
        jsonb_build_object(
          'beneficiary_name', coalesce(v_owner_name, 'someone you support'),
          'what',             v_what,
          'amount_kobo',      abs(new.amount_kobo),
          'balance_kobo',     new.balance_after_kobo,
          'spent_on',         to_char(new.created_at at time zone 'Africa/Lagos', 'DD Mon YYYY')
        ),
        'wallet_ledger',
        new.id
      from (values ('in_app'::public.notification_channel), ('email'::public.notification_channel)) as c(channel);
    end loop;

  exception when others then
    -- Never let a receipt take a payment down with it.
    return new;
  end;

  return new;
end;
$$;

drop trigger if exists notify_sponsors_of_wallet_spend on public.wallet_ledger;
create trigger notify_sponsors_of_wallet_spend
  after insert on public.wallet_ledger
  for each row
  execute function private.notify_sponsors_of_wallet_spend();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'notify_sponsors_of_wallet_spend'
      and tgrelid = 'public.wallet_ledger'::regclass
  ) then
    raise exception 'the sponsor receipt trigger must be attached to wallet_ledger';
  end if;
end $$;
