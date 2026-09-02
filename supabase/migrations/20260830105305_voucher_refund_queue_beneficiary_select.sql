-- §91.10/§91.12 patient financial-profile screen needs a patient to be able
-- to see the status of a refund queued against their own voucher —
-- previously voucher_refund_queue was readable only by admin/vouchers.manage
-- staff. Additive: a second SELECT policy (RLS OR's multiple policies
-- together), the existing staff policy is untouched.
create policy voucher_refund_queue_select_beneficiary on public.voucher_refund_queue
  for select to authenticated
  using (exists (
    select 1 from public.care_vouchers cv
    where cv.id = voucher_id and cv.beneficiary_profile_id = (select auth.uid())
  ));
