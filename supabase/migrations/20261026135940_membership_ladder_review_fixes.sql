-- Review fixes for the Membership ladder (code review of PR #1253, 2026-10-26). Applies after 20261021183328_remove_membership_instalments.sql.
--
--   1. Duplicate upgrade orders. create_order refuses a second upgrade while one created in the last 24 hours is still open
--      (upgrade_already_open). record_order_payment checks the buyer is still eligible BEFORE it records the payment as a success:
--      an upgrade paid for someone with no current Membership (already upgraded, or lapsed) is a payment mismatch
--      (upgrade_not_applicable), exactly like a wrong-amount payment: the order is NOT marked paid, nothing is booked to deferred revenue,
--      and a person is alerted to refund it. Before, it was marked paid, posted to the ledger and only raised an incident.
--   2. The upgrade remembers which membership it upgraded: orders.upgraded_membership_id. The refund puts back the tier of exactly that
--      membership (and only if it is still plus), and the revenue schedule reads its end date, instead of looking people up by patient.
--      (patient_memberships_one_active already means a patient has one active membership, so this removes a latent mistake rather than a
--      live one.) Live count of upgrade orders before this migration: 0 (the item is inactive and the module is off).
--   3. The care-voucher guard keys on the catalogue: a voucher is refused only when its sku_code is a membership catalogue code, never
--      because a name happens to mention the word. The old rule (name matching) is replaced.
-- Functions are patched from their LIVE definitions, each fragment checked to match exactly once.
-- ROLLBACK: restore the three function bodies from 20261021111211 and the guard from 20261021111904; drop orders.upgraded_membership_id.

alter table public.orders add column upgraded_membership_id uuid references public.patient_memberships (id) on delete set null;
comment on column public.orders.upgraded_membership_id is
  'Only for a membership_upgrade_plus order: the membership whose tier the payment flipped to plus. The refund and the revenue schedule read it.';

create or replace function pg_temp.patch_fn(p_sig regprocedure, p_pairs text[]) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    if n <> 1 then raise exception 'ladder review-fix patch of % expected 1 match for [%], found %', p_sig, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

-- 1a. one open upgrade order at a time
select pg_temp.patch_fn('public.create_order(text,uuid,uuid,text,boolean,bigint)'::regprocedure, array[
  $p$    if v_ben <> v_uid then raise exception 'gift_item_not_allowed' using errcode = 'P0001'; end if;$p$,
  $p$    if v_ben <> v_uid then raise exception 'gift_item_not_allowed' using errcode = 'P0001'; end if;
    if exists (select 1 from public.orders x where x.beneficiary_patient_id = v_ben and x.catalog_item_id = it.id
                and x.state = 'created' and x.created_at > now() - interval '24 hours') then
      raise exception 'upgrade_already_open' using errcode = 'P0001';
    end if;$p$]);

-- 1b and 2. payment: refuse an upgrade nobody can receive, and remember the membership that was upgraded
select pg_temp.patch_fn('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
  $p$  v_ent uuid;
$p$,
  $p$  v_ent uuid;
  v_up uuid;
$p$,
  $p$  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, event_key, raw, verified_at, is_test)$p$,
  $p$  -- An upgrade can only be received by someone with a current Membership (not Plus). Anyone else (already upgraded by another order, or
  -- lapsed) paid money that cannot buy anything: record it as a mismatch, NOT as a paid order, so a person refunds it.
  if exists (select 1 from public.catalog_items ci where ci.id = o.catalog_item_id and ci.code = 'membership_upgrade_plus')
     and not exists (select 1 from public.patient_memberships m
                      where m.patient_id = o.beneficiary_patient_id and m.state = 'active' and m.tier = 'evergreen'
                        and m.ends_at is not null and m.ends_at > now()) then
    return private.record_order_mismatch(o, 'upgrade_not_applicable', p_amount_kobo, p_fee_kobo, p_total_kobo, p_source, p_event_key, p_raw);
  end if;

  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, event_key, raw, verified_at, is_test)$p$,
  $p$    update public.patient_memberships set tier = 'plus'
     where patient_id = o.beneficiary_patient_id and state = 'active' and tier = 'evergreen' and (ends_at is null or ends_at > now());
    if not found then$p$,
  $p$    select m.id into v_up from public.patient_memberships m
     where m.patient_id = o.beneficiary_patient_id and m.state = 'active' and m.tier = 'evergreen' and m.ends_at is not null and m.ends_at > now()
     order by m.ends_at desc, m.starts_at desc limit 1 for update;
    if v_up is not null then
      update public.patient_memberships set tier = 'plus' where id = v_up;
      update public.orders set upgraded_membership_id = v_up where id = o.id;
    end if;
    if v_up is null then$p$]);

-- 2. refund: put back exactly the membership that was upgraded
select pg_temp.patch_fn('public.decide_order_refund(uuid,boolean,text)'::regprocedure, array[
  $p$    update public.patient_memberships set tier = 'evergreen'
     where patient_id = o.beneficiary_patient_id and state = 'active' and tier = 'plus';$p$,
  $p$    update public.patient_memberships set tier = 'evergreen'
     where id = o.upgraded_membership_id and state = 'active' and tier = 'plus';$p$]);

-- 2. revenue schedule: the days left in the membership that was upgraded
select pg_temp.patch_fn('private.post_order_to_ledger(uuid,boolean)'::regprocedure, array[
  $p$(select (m.ends_at at time zone 'Africa/Lagos')::date - v_date from public.patient_memberships m
                                                  where m.patient_id = o.beneficiary_patient_id and m.ends_at is not null
                                                  order by m.starts_at desc limit 1)$p$,
  $p$(select (m.ends_at at time zone 'Africa/Lagos')::date - v_date from public.patient_memberships m
                                                  where m.id = o.upgraded_membership_id and m.ends_at is not null)$p$]);

-- 3. voucher guard: by catalogue code, never by wording
create or replace function private.care_vouchers_not_membership() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.sku_code is not null and exists (select 1 from public.catalog_items c where c.code = new.sku_code and c.kind = 'membership') then
    raise exception 'care_voucher_cannot_be_membership' using errcode = '22023';
  end if;
  return new;
end $$;

do $$
begin
  if pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint)'::regprocedure) not ilike '%upgrade_already_open%'
     or pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%upgrade_not_applicable%'
     or pg_get_functiondef('public.decide_order_refund(uuid,boolean,text)'::regprocedure) not ilike '%o.upgraded_membership_id%'
     or pg_get_functiondef('private.post_order_to_ledger(uuid,boolean)'::regprocedure) not ilike '%m.id = o.upgraded_membership_id%'
     or pg_get_functiondef('private.care_vouchers_not_membership()'::regprocedure) ilike '%~*%' then
    raise exception 'review fixes: a patched function does not carry the change';
  end if;
  if has_function_privilege('anon', 'private.care_vouchers_not_membership()', 'EXECUTE') then raise exception 'review fixes: guard callable by anon'; end if;
end $$;
