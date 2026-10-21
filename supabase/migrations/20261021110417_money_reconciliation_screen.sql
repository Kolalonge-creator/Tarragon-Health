-- Money reconciliation screen: ONE read-only list of places where the money records disagree.
--
-- Operationalises the "one money truth" rule. Paystack payments, orders, payments rows, entitlements, refunds (S26b), earnings_ledger
-- consultation shares and their refund reversals (S30/S30b), payouts and payout transfers (S31), and the general ledger (accounts 1020,
-- 2000, 4100, 4900, 5200 and so on) each hold part of the story. This lists only the places where two of them disagree. It lists
-- MISMATCHES, not everything, so an empty answer means "nothing disagrees", and the page treats a failed read as an error, never as that.
--
-- Read-only by construction: both public functions are STABLE and contain no write. Nothing here moves, posts, reverses, retries or
-- fixes money, and nothing stores a balance (INV-09). Each row says what disagrees, which ids to open, the amount difference in kobo
-- (null where the other side's amount is not stored anywhere, for example the Paystack-side refund amount, which the weekly reconcile
-- compares and keeps only as a verdict), how long it has been wrong, and who is likely to own the fix.
--
-- Thresholds are not constants in SQL. The stuck-refund window is the ONE existing policy (refund_rules.stuck_processing_hours, the same
-- value flag_refund_delays and admin_settle_processing_refund use), so the incident, the settle button and this screen cannot disagree.
-- The other two windows are arguments the page takes from the PROPOSED config key finance.reconciliation.
--
-- Scope: the v5 order path (orders, payments, entitlements, refunds, consultation shares, payouts, ledger entries for those). The legacy
-- per-domain purchases (service_purchases, vouchers, pharmacy, partner billing) are not covered. The functions are platform-wide, like
-- every finance console RPC (private.is_finance() is global); they are not scoped to one organisation.
--
-- Access: private.is_finance() (finance role, super admin, or the delegated finance.view), the same gate as the finance console RPCs.
-- Test rows (is_test) are left out unless the caller asks. Order payment journals are never expected for a test order
-- (private.post_order_to_ledger skips them), so that one kind ignores the toggle.
--
-- Live row counts when written (2026-10-21): orders 0, payments 0, refunds 0, payouts 0, earnings_ledger 0. The proof seeds each kind.

create function private.money_mismatches(p_include_test boolean, p_unsent_minutes integer, p_grace_minutes integer)
returns table (
  kind text, severity text, organisation_id uuid, subject_type text, subject_id uuid, related_type text, related_id uuid,
  delta_kobo bigint, since timestamptz, owner_hint text, detail text
)
language sql stable security definer set search_path = ''
as $$
  -- 1. Paid, but no entitlement: the patient paid and got nothing.
  select 'paid_order_no_entitlement'::text, 'high'::text, o.organisation_id, 'order'::text, o.id, null::text, null::uuid,
         o.amount_kobo, coalesce(o.paid_at, o.updated_at), 'engineering'::text, 'The order is paid but no entitlement exists for it.'::text
    from public.orders o
   where o.state = 'paid' and (p_include_test or not o.is_test)
     and coalesce(o.paid_at, o.updated_at) < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.entitlements e where e.order_id = o.id)
  union all
  -- 2. An entitlement whose order never reached paid.
  select 'entitlement_no_paid_order', 'high', e.organisation_id, 'entitlement', e.id, 'order', o.id,
         o.amount_kobo, e.created_at, 'engineering', 'The entitlement belongs to an order that is ' || o.state || ', not paid.'
    from public.entitlements e join public.orders o on o.id = e.order_id
   where o.state not in ('paid', 'refunded') and (p_include_test or not e.is_test)
  union all
  -- 3. Refunded order whose entitlement is still active.
  select 'refunded_order_entitlement_active', 'high', e.organisation_id, 'entitlement', e.id, 'order', o.id,
         null::bigint, o.updated_at, 'support', 'The order is refunded but the entitlement is still active.'
    from public.entitlements e join public.orders o on o.id = e.order_id
   where o.state = 'refunded' and e.state = 'active' and (p_include_test or not e.is_test)
     and o.updated_at < now() - make_interval(mins => p_grace_minutes)
  union all
  -- 4. Paid order with no successful payment row. A fully sponsor-covered order (amount 0, sponsor share above 0) has no Paystack charge by
  -- design (private.settle_sponsor_order), so it is not expected to have one.
  select 'paid_order_no_payment', 'high', o.organisation_id, 'order', o.id, null, null,
         o.amount_kobo, coalesce(o.paid_at, o.updated_at), 'engineering', 'The order is ' || o.state || ' but no successful payment row exists.'
    from public.orders o
   where o.state in ('paid', 'refunded') and o.amount_kobo > 0 and (p_include_test or not o.is_test)
     and coalesce(o.paid_at, o.updated_at) < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'success')
  union all
  -- 5. Payment amount differs from the order price.
  select 'payment_amount_differs_from_order', 'high', p.organisation_id, 'payment', p.id, 'order', o.id,
         p.amount_kobo - o.amount_kobo, p.created_at, 'finance',
         'The payment is ' || p.amount_kobo || ' kobo but the order price is ' || o.amount_kobo || ' kobo.'
    from public.payments p join public.orders o on o.id = p.order_id
   where p.status = 'success' and p.amount_kobo <> o.amount_kobo and (p_include_test or not p.is_test)
     and not exists (select 1 from public.order_instalments ip where ip.payment_id = p.id)   -- a part is compared with its own part amount (kind below)
  union all
  -- 6. Payment total is not amount plus fee.
  select 'payment_total_inconsistent', 'medium', p.organisation_id, 'payment', p.id, 'order', p.order_id,
         p.total_kobo - (p.amount_kobo + p.fee_kobo), p.created_at, 'finance',
         'The payment total is not the amount plus the fee.'
    from public.payments p
   where p.status = 'success' and p.fee_kobo is not null and p.total_kobo is distinct from p.amount_kobo + p.fee_kobo
     and (p_include_test or not p.is_test)
  union all
  -- 7. A verified payment sits on an order that is not paid.
  select 'payment_success_order_not_paid', 'high', p.organisation_id, 'payment', p.id, 'order', o.id,
         p.amount_kobo, p.created_at, 'engineering', 'A successful payment exists but the order is ' || o.state || '.'
    from public.payments p join public.orders o on o.id = p.order_id
   where p.status = 'success' and o.state in ('created', 'failed', 'cancelled') and (p_include_test or not p.is_test)
     and p.created_at < now() - make_interval(mins => p_grace_minutes)
  union all
  -- 8. A payment the checkout refused as a mismatch (amount, currency or fee), still waiting for a person.
  select 'payment_mismatch_recorded', 'medium', p.organisation_id, 'payment', p.id, 'order', o.id,
         case when p.mismatch_reason = 'amount' then p.amount_kobo - o.amount_kobo end, p.created_at, 'finance',
         'Checkout refused this payment: ' || coalesce(p.mismatch_reason, 'mismatch') || '. The order is ' || o.state || '.'
    from public.payments p join public.orders o on o.id = p.order_id
   where p.status = 'mismatch' and o.state not in ('paid', 'refunded') and (p_include_test or not p.is_test)
  union all
  -- 9. Paid order never reached the general ledger. Test orders are never posted, so they are never expected to be.
  -- The ledger entry is for the buyer part plus any sponsor share (private.post_order_to_ledger), so that is the amount missing.
  select 'paid_order_no_journal', 'high', o.organisation_id, 'order', o.id, null, null,
         o.amount_kobo + o.sponsor_share_kobo, coalesce(o.paid_at, o.updated_at), 'finance', 'The order is paid but has no payment journal entry in the general ledger.'
    from public.orders o
   where o.state = 'paid' and not o.is_test and o.amount_kobo + o.sponsor_share_kobo > 0
     and not exists (select 1 from public.order_instalment_plans pl where pl.order_id = o.id)   -- a plan order is posted per part (kind below)
     and coalesce(o.paid_at, o.updated_at) < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.finance_journal_entries je where je.source = 'payment' and je.source_ref = 'order:' || o.id)
  union all
  -- 10. Refund stuck mid-send. Never retried by machine: a person checks the Paystack dashboard.
  select 'refund_processing_stuck', 'high', r.organisation_id, 'refund', r.id, 'order', r.order_id,
         r.amount_kobo, r.processing_started_at, 'finance', 'The refund has been sending for longer than the stuck window. Check the Paystack dashboard before anything is retried.'
    from public.refunds r
   where r.state = 'processing' and (p_include_test or not r.is_test)
     and r.processing_started_at < now() - make_interval(hours => (private.entitlement_policy('refund_rules') ->> 'stuck_processing_hours')::integer)
  union all
  -- 11. The weekly Paystack reconcile (refund-reconcile) disagrees with our record. Only the verdict is stored, not their amount.
  select 'refund_paystack_mismatch', 'high', r.organisation_id, 'refund', r.id, 'order', r.order_id,
         null::bigint, coalesce(r.provider_checked_at, r.updated_at), 'finance',
         'Paystack check says ' || r.provider_status || ' for a refund that is ' || r.state || '. Their amount is not stored.'
    from public.refunds r
   where r.provider_status in ('mismatch', 'not_found') and r.state in ('processing', 'completed', 'failed') and (p_include_test or not r.is_test)
  union all
  -- 12. Refund completed, cash side never posted (Dr 4900 / Cr 1020 through the refund.processed row).
  -- Cleared by the automatic refund.processed entry, or by a hand-posted Dr 4900 / Cr 1020 entry (source refund or manual) whose reference is
  -- exactly refund:<refund id>, which is what an admin who settles a stuck refund by hand is asked to use.
  select 'refund_completed_no_cash_posting', 'high', r.organisation_id, 'refund', r.id, 'order', r.order_id,
         r.amount_kobo, r.completed_at, 'finance', 'The refund is completed but no refund journal entry exists for the cash going back. If you post it by hand, use the reference refund:' || r.id || '.'
    from public.refunds r
   where r.state = 'completed' and (p_include_test or not r.is_test)
     and r.completed_at < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.finance_journal_entries hj where hj.source in ('refund', 'manual') and hj.source_ref = 'refund:' || r.id)
     and not exists (
       select 1 from public.payment_transactions pt
         join public.finance_journal_entries je on je.source = 'refund' and je.source_ref = pt.id::text
        where pt.event_type::text = 'refund.processed'
          and pt.provider_event_id = 'refund:' || coalesce((select p.provider_reference from public.payments p where p.id = r.payment_id),
                                       (select p.provider_reference from public.payments p where p.order_id = r.order_id and p.status = 'success' limit 1)) || ':' || r.amount_kobo)
  union all
  -- 13. Refund completed, deferred revenue release not yet stamped (the hourly catch-up has not finished it).
  select 'refund_gl_release_pending', 'medium', r.organisation_id, 'refund', r.id, 'order', r.order_id,
         null::bigint, r.completed_at, 'finance', 'The refund is completed but the release of unrecognised deferred revenue is not done.'
    from public.refunds r
   where r.state = 'completed' and r.gl_released_at is null and (p_include_test or not r.is_test)
     and r.completed_at < now() - make_interval(mins => p_grace_minutes)
  union all
  -- 13b. Refund completed for an order that never reached the ledger as a payment: the books show cash going out that never came in
  -- (private.post_order_to_ledger deliberately never posts a refunded order that has no entry; this is the known gap, now visible).
  select 'refund_cash_out_without_payment_entry', 'high', r.organisation_id, 'refund', r.id, 'order', r.order_id,
         r.amount_kobo, r.completed_at, 'finance', 'The refund is completed but the order has no payment journal entry, so the ledger shows cash out with no cash in.'
    from public.refunds r join public.orders o on o.id = r.order_id
   where r.state = 'completed' and not o.is_test and o.amount_kobo > 0 and (p_include_test or not r.is_test)
     and r.completed_at < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.finance_journal_entries je where je.source = 'payment'
                      and je.source_ref in ('order:' || o.id, 'orderpart:' || coalesce(r.payment_id::text, '')))
  union all
  -- 13c. The order is marked refunded (and the entitlement revoked) but the refund was approved or failed and the money has not gone back.
  select 'refund_decided_not_sent', 'high', r.organisation_id, 'refund', r.id, 'order', r.order_id,
         r.amount_kobo, coalesce(r.decided_at, r.updated_at), 'finance',
         'The refund is ' || r.state || ' and the order is already refunded, but nothing has gone back to the card.'
    from public.refunds r join public.orders o on o.id = r.order_id
   where r.state in ('approved', 'failed') and o.state = 'refunded' and (p_include_test or not r.is_test)
     and greatest(coalesce(r.decided_at, r.updated_at), r.updated_at) < now() - make_interval(mins => p_unsent_minutes)
  union all
  -- 14. A deferred revenue release that should not exist: the refund is not completed, or the release is larger than the refund.
  select 'refund_gl_release_irregular', 'high', r.organisation_id, 'refund', r.id, 'journal_entry', je.id,
         x.dr, je.created_at, 'finance',
         case when r.state <> 'completed' then 'A deferred revenue release was posted but the refund is ' || r.state || '.'
              else 'The deferred revenue release is ' || x.dr || ' kobo but the refund is only ' || r.amount_kobo || ' kobo.' end
    from public.finance_journal_entries je
    join public.refunds r on r.id::text = substring(je.source_ref from length('refund_deferred_release:') + 1)
   cross join lateral (select coalesce(sum(jl.debit_minor), 0)::bigint as dr from public.finance_journal_lines jl where jl.entry_id = je.id and jl.account_code = '2000') x
   where je.source = 'adjustment' and je.source_ref like 'refund\_deferred\_release:%' and (r.state <> 'completed' or x.dr > r.amount_kobo)
     and (p_include_test or not r.is_test)
  union all
  -- 15. An earnings reversal that should not exist: its refund is not completed.
  select 'earnings_reversal_irregular', 'high', a.organisation_id, 'earnings_line', a.id, 'refund', r.id,
         abs(a.amount_kobo), a.created_at, 'finance', 'A consultation share was reversed but the refund is ' || r.state || '.'
    from public.earnings_ledger a
    join public.refunds r on r.id::text = a.calculation ->> 'refund_id'
   where a.kind = 'adjustment' and r.state <> 'completed' and (p_include_test or not a.is_test)
  union all
  -- 15b. A consultation share reversed by more than it was worth.
  select 'earnings_reversal_irregular', 'high', l.organisation_id, 'earnings_line', l.id, null, null,
         x.rev - l.amount_kobo, l.created_at, 'finance', 'This consultation share is ' || l.amount_kobo || ' kobo but ' || x.rev || ' kobo of it has been reversed.'
    from public.earnings_ledger l
   cross join lateral (
     select coalesce(sum(-a.amount_kobo), 0)::bigint as rev from public.earnings_ledger a
      where a.clinician_id = l.clinician_id and a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text and a.calculation ? 'refund_id') x
   where l.kind = 'consultation' and l.amount_kobo > 0 and x.rev > l.amount_kobo and (p_include_test or not l.is_test)
  union all
  -- 16. Completed refund, consultation share still standing (fully or in part).
  select 'consultation_share_not_reversed', 'high', l.organisation_id, 'earnings_line', l.id, 'refund', r.id,
         x.expected - y.actual, greatest(r.completed_at, l.created_at), 'finance',
         'The order was refunded; ' || y.actual || ' of the expected ' || x.expected || ' kobo of this consultation share has been reversed.'
    from public.refunds r
    join public.orders o on o.id = r.order_id
    join public.order_encounter_links ol on ol.order_id = o.id
    join public.earnings_ledger l on l.reference_id = ol.encounter_id and l.kind = 'consultation' and l.amount_kobo > 0
   cross join lateral (select case when r.amount_kobo >= o.amount_kobo then l.amount_kobo else (l.amount_kobo * r.amount_kobo) / o.amount_kobo end as expected) x
   cross join lateral (
     select coalesce(sum(-a.amount_kobo), 0)::bigint as actual from public.earnings_ledger a
      where a.clinician_id = l.clinician_id and a.kind = 'adjustment'
        and a.calculation ->> 'corrects' = l.id::text and a.calculation ->> 'refund_id' = r.id::text) y
   where r.state = 'completed' and (p_include_test or not (r.is_test or l.is_test))
     and greatest(r.completed_at, l.created_at) < now() - make_interval(mins => p_grace_minutes)
     and x.expected - y.actual > 0
  union all
  -- 17. Payout total differs from the earnings lines linked to it. Drafts link nothing yet, so they are not checked.
  select 'payout_total_differs_from_lines', 'high', p.organisation_id, 'payout', p.id, null, null,
         x.s - p.amount_kobo, p.updated_at, 'finance',
         'The payout says ' || p.amount_kobo || ' kobo over ' || p.line_count || ' lines; the linked lines add to ' || x.s || ' kobo over ' || x.c || '.'
    from public.payouts p
   cross join lateral (select coalesce(sum(el.amount_kobo), 0)::bigint as s, count(*) as c from public.earnings_ledger el where el.payout_id = p.id) x
   where p.state in ('approved', 'sent', 'succeeded', 'failed', 'reversed') and (p_include_test or not p.is_test)
     and (x.s <> p.amount_kobo or x.c <> p.line_count)
  union all
  -- 18. Payout marked succeeded, but no transfer attempt succeeded.
  select 'payout_succeeded_no_successful_transfer', 'high', p.organisation_id, 'payout', p.id, null, null,
         p.amount_kobo, p.updated_at, 'finance', 'The payout is succeeded but none of its transfer attempts is success.'
    from public.payouts p
   where p.state = 'succeeded' and (p_include_test or not p.is_test)
     and not exists (select 1 from public.payout_transfers t where t.payout_id = p.id and t.state = 'success')
  union all
  -- 19. Payout succeeded, posting to the ledger is on, and nothing was posted or recorded as failed for that attempt.
  select 'payout_succeeded_no_gl_posting', 'high', p.organisation_id, 'payout', p.id, null, null,
         p.amount_kobo, p.updated_at, 'finance', 'The payout succeeded but there is no ledger posting for it.'
    from public.payouts p
    join public.payout_transfers t on t.payout_id = p.id and t.state = 'success'
   where p.state = 'succeeded' and (p_include_test or not p.is_test) and private.provider_flag_on('payout_gl_posting')
     and p.updated_at < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.payout_gl_postings g where g.payout_id = p.id and g.attempt = t.attempt and g.kind = 'sent')
  union all
  -- 20. A ledger posting for a payout attempt failed and is waiting for the retry.
  select 'payout_gl_posting_failed', 'medium', p.organisation_id, 'payout', p.id, null, null,
         g.amount_kobo, g.updated_at, 'finance', 'Posting the ' || g.kind || ' of attempt ' || g.attempt || ' to the ledger failed: ' || coalesce(g.error, 'no reason recorded')
    from public.payout_gl_postings g join public.payouts p on p.id = g.payout_id
   where g.status = 'failed' and (p_include_test or not p.is_test)
  union all
  -- 21. The ledger entry for a payout does not match the payout amount.
  select 'payout_gl_amount_differs', 'high', p.organisation_id, 'payout', p.id, 'journal_entry', g.journal_entry_id,
         x.dr - g.amount_kobo, g.updated_at, 'finance', 'The ledger entry debits ' || x.dr || ' kobo but the posting says ' || g.amount_kobo || ' kobo.'
    from public.payout_gl_postings g join public.payouts p on p.id = g.payout_id
   cross join lateral (select coalesce(sum(jl.debit_minor), 0)::bigint as dr from public.finance_journal_lines jl where jl.entry_id = g.journal_entry_id) x
   where g.status = 'posted' and x.dr <> g.amount_kobo and (p_include_test or not p.is_test)
  union all
  -- 22. The bank returned a payout after success, and the opposite ledger entry is missing.
  select 'payout_reversed_no_gl_reversal', 'high', p.organisation_id, 'payout', p.id, null, null,
         p.amount_kobo, t.updated_at, 'finance', 'The bank returned attempt ' || t.attempt || ' after it was posted as paid, and no reversing entry exists.'
    from public.payout_transfers t
    join public.payouts p on p.id = t.payout_id
    join public.payout_gl_postings s on s.payout_id = p.id and s.attempt = t.attempt and s.kind = 'sent' and s.status = 'posted'
   where t.state = 'reversed' and (p_include_test or not p.is_test)
     and t.updated_at < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.payout_gl_postings g where g.payout_id = p.id and g.attempt = t.attempt and g.kind = 'reversal' and g.status in ('posted', 'skipped'))
  union all
  -- 23. A paid instalment part whose payment is not the amount of that part.
  select 'instalment_payment_differs_from_part', 'high', i.organisation_id, 'payment', p.id, 'order', i.order_id,
         p.amount_kobo - i.amount_kobo, p.created_at, 'finance',
         'Part ' || i.seq || ' is ' || i.amount_kobo || ' kobo but the payment recorded for it is ' || p.amount_kobo || ' kobo.'
    from public.order_instalments i join public.payments p on p.id = i.payment_id
   where i.state = 'paid' and p.amount_kobo <> i.amount_kobo and (p_include_test or not i.is_test)
  union all
  -- 24. A paid instalment part that never reached the ledger (journal reference orderpart:<payment id>).
  select 'instalment_paid_no_journal', 'high', i.organisation_id, 'payment', p.id, 'order', i.order_id,
         i.amount_kobo, p.created_at, 'finance', 'Part ' || i.seq || ' is paid but has no part payment journal entry in the general ledger.'
    from public.order_instalments i join public.payments p on p.id = i.payment_id
   where i.state = 'paid' and not i.is_test
     and p.created_at < now() - make_interval(mins => p_grace_minutes)
     and not exists (select 1 from public.finance_journal_entries je where je.source = 'payment' and je.source_ref = 'orderpart:' || i.payment_id)
  union all
  -- 25. A payout that carries an earnings line with an open dispute. A disputed line is held out of the draft and cannot be disputed once
  -- its payout is approved, so this means the hold did not work.
  select 'payout_includes_disputed_line', 'high', p.organisation_id, 'payout', p.id, 'earnings_line', l.id,
         l.amount_kobo, d.opened_at, 'finance', 'This payout includes an earnings line that is under an open dispute.'
    from public.earnings_disputes d
    join public.earnings_ledger l on l.id = d.ledger_id
    join public.payouts p on p.id = l.payout_id
   where d.state = 'open' and p.state in ('approved', 'sent', 'succeeded') and (p_include_test or not p.is_test)
  union all
  -- 26. A held (disputed) earnings line whose answer is overdue. Not wrong money, but a clinician is waiting and the line is not paying.
  select 'earnings_dispute_overdue', 'medium', l.organisation_id, 'earnings_line', l.id, null, null,
         l.amount_kobo, d.response_due_at, 'finance', 'The clinician questioned this earnings line and the answer is overdue. The line is held out of payouts until it is answered.'
    from public.earnings_disputes d join public.earnings_ledger l on l.id = d.ledger_id
   where d.state = 'open' and d.response_due_at < now() and (p_include_test or not d.is_test)
  union all
  -- 27. A payout with a withholding amount that has been sent. Sending is refused while a withholding is undecided (OQ-193), so this means
  -- it got through.
  select 'payout_sent_with_withholding', 'high', p.organisation_id, 'payout', p.id, null, null,
         p.withholding_kobo, p.updated_at, 'finance', 'The payout was sent although it carries a withholding amount, which must be decided before sending.'
    from public.payouts p
   where p.state in ('sent', 'succeeded') and p.withholding_kobo > 0 and (p_include_test or not p.is_test);
$$;
revoke all on function private.money_mismatches(boolean, integer, integer) from public, anon, authenticated;

-- The list: one page of mismatches, newest-damage-first by age. Raises (never returns an empty list) when the caller is not finance.
create function public.money_reconciliation_list(
  p_include_test boolean, p_kind text, p_limit integer, p_offset integer, p_unsent_minutes integer, p_grace_minutes integer)
returns table (
  kind text, severity text, organisation_id uuid, subject_type text, subject_id uuid, related_type text, related_id uuid,
  delta_kobo bigint, since timestamptz, owner_hint text, detail text, total_count bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_finance() then
    raise exception 'money_reconciliation_not_authorised' using errcode = '42501';
  end if;
  if p_unsent_minutes is null or p_unsent_minutes <= 0 or p_grace_minutes is null or p_grace_minutes < 0 then
    raise exception 'money_reconciliation_bad_threshold' using errcode = '22023';
  end if;
  return query
    select m.kind, m.severity, m.organisation_id, m.subject_type, m.subject_id, m.related_type, m.related_id,
           m.delta_kobo, m.since, m.owner_hint, m.detail, count(*) over ()
      from private.money_mismatches(coalesce(p_include_test, false), p_unsent_minutes, p_grace_minutes) m
     where p_kind is null or m.kind = p_kind
     order by case m.severity when 'high' then 0 else 1 end, m.since nulls last, m.kind, m.subject_id, m.related_id nulls first, m.detail
     limit greatest(least(coalesce(p_limit, 50), 200), 1) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.money_reconciliation_list(boolean, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.money_reconciliation_list(boolean, text, integer, integer, integer, integer) to authenticated;

-- The summary: how many of each kind, so the screen can show counts (and a badge) without paging.
create function public.money_reconciliation_summary(p_include_test boolean, p_unsent_minutes integer, p_grace_minutes integer)
returns table (kind text, severity text, n bigint, delta_abs_kobo bigint, oldest timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_finance() then
    raise exception 'money_reconciliation_not_authorised' using errcode = '42501';
  end if;
  if p_unsent_minutes is null or p_unsent_minutes <= 0 or p_grace_minutes is null or p_grace_minutes < 0 then
    raise exception 'money_reconciliation_bad_threshold' using errcode = '22023';
  end if;
  return query
    select m.kind, m.severity, count(*), coalesce(sum(abs(m.delta_kobo)), 0)::bigint, min(m.since)
      from private.money_mismatches(coalesce(p_include_test, false), p_unsent_minutes, p_grace_minutes) m
     group by m.kind, m.severity
     order by m.severity, m.kind;
end $$;
revoke all on function public.money_reconciliation_summary(boolean, integer, integer) from public, anon;
grant execute on function public.money_reconciliation_summary(boolean, integer, integer) to authenticated;

-- Closing self-check: the screen cannot write, and anon cannot reach it.
do $$
begin
  if has_function_privilege('anon', 'public.money_reconciliation_list(boolean,text,integer,integer,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.money_reconciliation_summary(boolean,integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.money_mismatches(boolean,integer,integer)', 'EXECUTE') then
    raise exception 'money reconciliation: wrong execute grants';
  end if;
  if exists (select 1 from pg_proc where oid in ('public.money_reconciliation_list(boolean,text,integer,integer,integer,integer)'::regprocedure,
        'public.money_reconciliation_summary(boolean,integer,integer)'::regprocedure, 'private.money_mismatches(boolean,integer,integer)'::regprocedure)
        and provolatile <> 's') then
    raise exception 'money reconciliation: a function is not STABLE (read-only)';
  end if;
end $$;
