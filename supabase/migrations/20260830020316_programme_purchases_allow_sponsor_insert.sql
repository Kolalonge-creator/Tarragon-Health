-- Episodic-fee rebuild — correction.
--
-- paySomeonesPlan (apps/web/src/app/(dashboard)/patient/supporting/actions.ts)
-- is a real, live sponsor feature — "the single most-asked-for diaspora
-- action" per its own comment — that put a beneficiary on a paid subscription
-- billed to the sponsor. Left untouched, it would keep creating brand-new
-- subscriptions after this rebuild, directly undermining the point of it.
-- Its replacement (paySomeonesCareProgramme) needs to insert a
-- programme_purchases row for the BENEFICIARY while the SPONSOR is the
-- authenticated caller — the insert policy from
-- 20260830014616_programme_purchases.sql only allowed patient_id =
-- auth.uid(), which blocks this on purpose (nobody should be able to buy an
-- arbitrary stranger a programme). Widen it using
-- private.can_purchase_voucher_for(), the same "self, or someone who granted
-- you access" relationship the Care Voucher gifting path already uses
-- (20260731215226_care_vouchers_purchase_and_layaway.sql) — deliberately not
-- a new, second answer to the same question.

drop policy if exists programme_purchases_insert on public.programme_purchases;
create policy programme_purchases_insert on public.programme_purchases
  for insert to authenticated
  with check (private.can_purchase_voucher_for(patient_id, (select auth.uid())));

do $$
begin
  if not has_table_privilege('authenticated', 'public.programme_purchases', 'INSERT') then
    raise exception 'FAIL: authenticated must still be able to insert programme_purchases';
  end if;
end $$;
