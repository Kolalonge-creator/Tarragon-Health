-- Care Vouchers, part 7: retire the Health Wallet.
--
-- Leaving a stored-value balance live alongside the voucher model would defeat
-- the entire point of building one, so this deletes the mechanism rather than
-- merely stopping using it — the same discipline as the 2026-07-29 founder
-- removals (delete the enum value, not just the feature).
--
-- ROW COUNTS AT REMOVAL (re-checked live immediately before this migration):
--   health_wallets 0 · wallet_topups 0 · wallet_ledger 0 · wallet_savings_goals 0
--   wallet_compliance_flags 0 · total balance NGN 0.00
-- Nothing is being destroyed and nobody is owed a refund. That is the only
-- reason this can be a plain DROP with no conversion step.
--
-- Three functions are REWRITTEN rather than dropped, because the sponsor
-- product they serve survives the wallet:
--   sponsor_book_care               -> books, then redeems a matching voucher
--   notify_sponsors_of_wallet_spend -> a receipt when a gifted voucher is used
--   queue_sponsor_monthly_reports   -> summarises vouchers, not balances

do $$
declare v_rows bigint;
begin
  select (select count(*) from public.health_wallets)
       + (select count(*) from public.wallet_topups)
       + (select count(*) from public.wallet_ledger)
       + (select count(*) from public.wallet_savings_goals)
    into v_rows;
  if v_rows <> 0 then
    raise exception 'refusing to drop the wallet: % rows exist, this migration assumes none', v_rows;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Rewrites first, so nothing is left pointing at a dropped table.
-- ---------------------------------------------------------------------------

create or replace function public.sponsor_book_care(
  p_beneficiary uuid,
  p_bundle_code text,
  p_facility_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller   uuid := auth.uid();
  v_org      uuid;
  v_bundle   uuid;
  v_price    bigint;
  v_provider uuid;
  v_order    uuid;
  v_voucher  uuid;
  v_paid     boolean := false;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to book care for this person'
      using errcode = '42501';
  end if;

  -- Only ever the self-bookable catalogue. Same narrow door the patient's own
  -- booking card uses, not a general ordering power.
  select pb.id, pb.price_kobo into v_bundle, v_price
    from public.panel_bundles pb
   where pb.code = p_bundle_code and pb.self_bookable;
  if v_bundle is null then
    raise exception 'that check is not available to book directly' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation on file'; end if;

  if p_facility_id is not null then
    select f.lab_provider_id into v_provider
      from public.facilities f
     where f.id = p_facility_id and f.is_active;
  end if;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin,
     panel_bundle_id, facility_id, provider_id)
  values
    (v_org, p_beneficiary, 'pending_payment', v_price, 'patient_initiated',
     v_bundle, p_facility_id, v_provider)
  returning id into v_order;

  -- Settle from an already-bought voucher for THIS service if one is waiting.
  -- Oldest expiry first, so the one closest to lapsing is used before a newer one.
  select id into v_voucher
    from public.care_vouchers
   where beneficiary_profile_id = p_beneficiary
     and kind = 'prepaid_service'
     and panel_bundle_id = v_bundle
     and status = 'active'
     and (expires_at is null or expires_at > now())
   order by expires_at nulls last, created_at
   limit 1;

  if v_voucher is not null then
    perform public.redeem_care_voucher(v_voucher, 'lab', v_order);
    v_paid := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order,
    'paid', v_paid,
    'price_kobo', v_price,
    'voucher_id', v_voucher
  );
end;
$function$;

-- A gift receipt: tell the person who bought a voucher when it actually became
-- care. Money and service category only, never a result — the purchaser has a
-- receipt, not clinical access. in_app + email because a sponsor abroad often
-- has no Nigerian number, and in_app needs no sender to work.
create or replace function private.notify_purchaser_of_voucher_use()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'redeemed' or old.status = 'redeemed' then return new; end if;
  if new.purchaser_profile_id is null
     or new.purchaser_profile_id = new.beneficiary_profile_id then
    return new;
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, source_table, source_id)
  select new.organisation_id, new.purchaser_profile_id, ch, 'voucher_gift_used',
         jsonb_build_object(
           'voucher_number', new.voucher_number,
           'label', coalesce(new.sku_name, 'Care voucher'),
           'beneficiary_name', (select full_name from public.profiles where id = new.beneficiary_profile_id),
           'value_naira', (new.face_value_kobo / 100)::text),
         'care_vouchers', new.id
    from unnest(array['in_app', 'email']::public.notification_channel[]) as ch;
  return new;
exception when others then
  return new; -- a lost receipt is a nuisance; a blocked redemption is a broken product
end;
$$;

create trigger care_vouchers_notify_purchaser
  after update on public.care_vouchers
  for each row execute function private.notify_purchaser_of_voucher_use();

-- Monthly sponsor summary, re-expressed in vouchers. Money, logistics and
-- engagement only, never clinical content, exactly as before.
drop function if exists private.queue_sponsor_monthly_reports();

create function private.queue_sponsor_monthly_reports()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in
    select
      v.purchaser_profile_id                                    as sponsor_id,
      v.beneficiary_profile_id                                  as beneficiary_id,
      min(v.organisation_id::text)::uuid                        as organisation_id,
      (select full_name from public.profiles p where p.id = v.beneficiary_profile_id) as beneficiary_name,
      count(*) filter (where v.status = 'active')               as ready_count,
      count(*) filter (where v.status = 'reserved')             as saving_count,
      count(*) filter (where v.status = 'redeemed'
                         and v.redeemed_at > now() - interval '1 month') as used_this_month,
      sum(v.amount_paid_kobo) filter (where v.created_at > now() - interval '1 month') as spent_kobo
    from public.care_vouchers v
    where v.purchaser_profile_id is not null
      and v.purchaser_profile_id <> v.beneficiary_profile_id
    group by v.purchaser_profile_id, v.beneficiary_profile_id
  loop
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    select v_row.organisation_id, v_row.sponsor_id, ch, 'sponsor_monthly_report',
           jsonb_build_object(
             'beneficiary_name', v_row.beneficiary_name,
             'ready_count', v_row.ready_count,
             'saving_count', v_row.saving_count,
             'used_this_month', v_row.used_this_month,
             'spent_naira', (coalesce(v_row.spent_kobo, 0) / 100)::text)
      from unnest(array['in_app', 'email']::public.notification_channel[]) as ch;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Now drop the wallet itself.
-- ---------------------------------------------------------------------------

drop trigger if exists payment_transactions_credit_wallet on public.payment_transactions;
drop trigger if exists wallet_ledger_sponsor_receipt on public.wallet_ledger;

drop function if exists private.notify_sponsors_of_wallet_spend() cascade;
drop function if exists public.wallet_pay_booking_order(text, uuid) cascade;
drop function if exists public.sponsor_pay_booking_order(uuid, text, uuid) cascade;
drop function if exists public.get_or_create_my_wallet() cascade;
drop function if exists public.get_or_create_wallet_for(uuid) cascade;
drop function if exists public.wallet_kyc_balance_headroom(uuid) cascade;
drop function if exists private.wallet_kyc_max_balance(uuid) cascade;
drop function if exists private.credit_wallet_from_payment_transaction() cascade;
drop function if exists private.can_fund_wallet(uuid, uuid) cascade;
drop function if exists private.wallet_apply(uuid, bigint, public.wallet_entry_type, uuid, text, uuid, uuid, public.commission_type, uuid) cascade;
drop function if exists private.ensure_wallet(uuid) cascade;

alter table public.wellness_points_redemptions drop column if exists wallet_ledger_id;

drop table if exists public.wallet_compliance_flags cascade;
drop table if exists public.wallet_kyc_tier_limits cascade;
drop table if exists public.wallet_savings_goals cascade;
drop table if exists public.wallet_ledger cascade;
drop table if exists public.wallet_topups cascade;
drop table if exists public.health_wallets cascade;

-- The enum dies with the feature, so it cannot grow back through an
-- unreachable member. payment_provider keeps its retired 'wallet' value only
-- because Postgres cannot remove an enum value in place; nothing writes it.
drop type if exists public.wallet_entry_type;

do $$
begin
  if exists (select 1 from pg_tables
             where schemaname = 'public'
               and (tablename like 'wallet%' or tablename = 'health_wallets')) then
    raise exception 'a wallet table survived the removal';
  end if;
  if exists (select 1 from pg_type where typname = 'wallet_entry_type') then
    raise exception 'wallet_entry_type survived the removal';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (p.prosrc ilike '%health_wallets%' or p.prosrc ilike '%wallet_apply%'
           or p.prosrc ilike '%ensure_wallet%' or p.prosrc ilike '%wallet_ledger%')
  ) then
    raise exception 'a function still references the wallet';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'care_vouchers_notify_purchaser') then
    raise exception 'the gift receipt trigger was not attached';
  end if;
end $$;;
